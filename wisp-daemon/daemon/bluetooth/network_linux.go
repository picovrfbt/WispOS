//go:build linux

package bluetooth

import (
	"context"
	"fmt"
	"net"
	"syscall"
	"time"

	"github.com/vishvananda/netlink"
	"golang.org/x/sys/unix"
)

// kernel interfaces: netlink link/route watching and the BT mgmt socket.
// network_other.go stubs these so the daemon builds on a dev machine.

func (m *Manager) monitorNetworkInterfaces() {
	linkUpdates := make(chan netlink.LinkUpdate)
	done := make(chan struct{})

	if err := netlink.LinkSubscribe(linkUpdates, done); err != nil {
		m.log.WithError(err).Error("bluetooth: failed to subscribe to netlink updates")
		return
	}

	go func() {
		for update := range linkUpdates {
			if update.Header.Type == syscall.RTM_DELLINK && update.Link.Attrs().Name == panInterface {
				if m.consumeSelfTeardown() {
					m.log.Debug("bluetooth: bnep0 removed by our own forced reconnect, not counting as a drop")
					continue
				}
				m.log.Info("bluetooth: bnep0 interface removed")
				m.markNetworkDrop()
				if m.emit != nil {
					m.emit(EventNetworkDisconnect, nil)
				}
				m.tryRecoverPan()
			}
		}
	}()
}

// watchMgmtDisconnects opens the mgmt control channel and feeds disconnect reasons into the manager
func (m *Manager) watchMgmtDisconnects() error {
	fd, err := unix.Socket(unix.AF_BLUETOOTH, unix.SOCK_RAW|unix.SOCK_CLOEXEC, unix.BTPROTO_HCI)
	if err != nil {
		return fmt.Errorf("mgmt socket: %w", err)
	}
	if err := unix.Bind(fd, &unix.SockaddrHCI{Dev: hciDevNone, Channel: hciChannelControl}); err != nil {
		_ = unix.Close(fd)
		return fmt.Errorf("mgmt bind: %w", err)
	}

	go func() {
		defer func() { _ = unix.Close(fd) }()
		buf := make([]byte, 1024)
		for {
			n, err := unix.Read(fd, buf)
			if err != nil {
				if err == unix.EINTR {
					continue
				}
				m.log.WithError(err).Warn("bluetooth: mgmt event socket died, disconnect reasons unavailable")
				return
			}
			opcode, addr, addrType, reason, ok := parseMgmtEvent(buf[:n])
			if !ok {
				continue
			}
			switch opcode {
			case mgmtEvDeviceConnected:
				if isLEAddrType(addrType) {
					m.noteLELink(addr, true)
				}
			case mgmtEvDeviceDisconnected:
				if isLEAddrType(addrType) {
					m.noteLELink(addr, false)
				}
				m.handleDisconnectReason(addr, reason)
			}
		}
	}()

	m.log.Info("bluetooth: mgmt disconnect-reason watcher active")
	return nil
}

func probeVia(iface string) bool {
	d := net.Dialer{
		Timeout: probeTimeout,
		Control: func(network, address string, c syscall.RawConn) error {
			var bindErr error
			if err := c.Control(func(fd uintptr) {
				bindErr = unix.BindToDevice(int(fd), iface)
			}); err != nil {
				return err
			}
			return bindErr
		},
	}
	ctx, cancel := context.WithTimeout(context.Background(), probeTimeout)
	defer cancel()
	conn, err := d.DialContext(ctx, "tcp", probeTarget)
	if err != nil {
		return false
	}
	_ = conn.Close()
	return true
}

// returns bnep0s default route or nil
func panDefaultRoute() *netlink.Route {
	link, err := netlink.LinkByName(panInterface)
	if err != nil {
		return nil
	}
	routes, err := netlink.RouteList(link, netlink.FAMILY_V4)
	if err != nil {
		return nil
	}
	for i := range routes {
		if isDefaultDst(routes[i].Dst) && routes[i].Gw != nil {
			return &routes[i]
		}
	}
	return nil
}

func otherDefaultRouteIface() string {
	routes, err := netlink.RouteList(nil, netlink.FAMILY_V4)
	if err != nil {
		return ""
	}
	for _, r := range routes {
		if !isDefaultDst(r.Dst) || r.Gw == nil {
			continue
		}
		link, err := netlink.LinkByIndex(r.LinkIndex)
		if err != nil || link.Attrs().Name == panInterface {
			continue
		}
		return link.Attrs().Name
	}
	return ""
}

// replaces bnep0 default route with the given metric
func (m *Manager) setPanRouteMetric(metric int) error {
	route := panDefaultRoute()
	if route == nil {
		return nil
	}
	if route.Priority == metric {
		return nil
	}
	newRoute := *route
	newRoute.Priority = metric
	if err := netlink.RouteAdd(&newRoute); err != nil && err != unix.EEXIST {
		return err
	}
	return netlink.RouteDel(route)
}

func (m *Manager) routeArbiterLoop() {
	var state routeHealthState
	ticker := time.NewTicker(probeInterval)
	defer ticker.Stop()

	for range ticker.C {
		route := panDefaultRoute()
		if route == nil {
			state.reset()
			continue
		}
		if state.demoted && route.Priority == 0 {
			state.reset()
		}

		alt := otherDefaultRouteIface()
		altOK := alt != "" && probeVia(alt)
		panOK := probeVia(panInterface)

		switch state.tick(panOK, altOK, time.Now()) {
		case actionDemote:
			m.log.Warnf("bluetooth: %s default route unhealthy (TCP dead %d probes, %s healthy), demoting to metric %d",
				panInterface, demoteAfter, alt, demotedMetric)
			if err := m.setPanRouteMetric(demotedMetric); err != nil {
				m.log.WithError(err).Warnf("bluetooth: failed to demote %s route", panInterface)
				state.reset() // try again next round
			}
		case actionRestore:
			m.log.Infof("bluetooth: %s recovered (%d clean probes, %s hold-down), restoring primary route",
				panInterface, restoreAfter, restoreHoldDown)
			if err := m.setPanRouteMetric(0); err != nil {
				m.log.WithError(err).Warnf("bluetooth: failed to restore %s route", panInterface)
			}
		}
	}
}

// tetherRouteDemoted reports whether bnep0's default route is demoted, and whether there is one
func tetherRouteDemoted() (demoted, ok bool) {
	r := panDefaultRoute()
	if r == nil {
		return false, false
	}
	return r.Priority >= demotedMetric, true
}

// PanGateway is the tethering phone's address on bnep0, or "" without a tether
func PanGateway() string {
	r := panDefaultRoute()
	if r == nil || r.Gw == nil {
		return ""
	}
	return r.Gw.String()
}
