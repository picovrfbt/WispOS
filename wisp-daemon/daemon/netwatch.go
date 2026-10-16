package daemon

import (
	"context"
	"fmt"
	"net"
	"sort"
	"strings"
	"time"

	librespot "github.com/devgianlu/go-librespot"
)

// Watches the device's network addresses for one that went away: a Bluetooth
// tether that dropped and came back (a new interface, often a new address)
// leaves every open connection to Spotify on a dead socket. Nothing errors
// until the access point's two-minute pong check, so playback commands, track
// loading and the library all hang in the meantime. Whenever an address the
// device had is gone, onLost runs once the network has settled.

const (
	netWatchEvery  = 3 * time.Second
	netWatchSettle = 4 * time.Second
)

// netAddrs is "iface#index addr" for every non-loopback IPv4 address that's up
func netAddrs() map[string]bool {
	out := map[string]bool{}
	ifaces, err := net.Interfaces()
	if err != nil {
		return out
	}
	for _, ifc := range ifaces {
		if ifc.Flags&net.FlagUp == 0 || ifc.Flags&net.FlagLoopback != 0 {
			continue
		}
		addrs, _ := ifc.Addrs()
		for _, a := range addrs {
			if ipn, ok := a.(*net.IPNet); ok && ipn.IP.To4() != nil {
				out[fmt.Sprintf("%s#%d %s", ifc.Name, ifc.Index, ipn.IP)] = true
			}
		}
	}
	return out
}

// lostAddrs lists what was in before and isn't in now
func lostAddrs(before, now map[string]bool) []string {
	var lost []string
	for k := range before {
		if !now[k] {
			lost = append(lost, k)
		}
	}
	sort.Strings(lost)
	return lost
}

func watchNetworkChanges(ctx context.Context, log librespot.Logger, read func() map[string]bool, onLost func()) {
	prev := read()
	var pending []string
	var since time.Time
	t := time.NewTicker(netWatchEvery)
	defer t.Stop()
	for {
		select {
		case <-ctx.Done():
			return
		case <-t.C:
		}
		now := read()
		if lost := lostAddrs(prev, now); len(lost) > 0 {
			pending = append(pending, lost...)
			since = time.Now()
		}
		prev = now
		// wait for the network to settle (the tether's new address) before reconnecting
		if len(pending) > 0 && time.Since(since) >= netWatchSettle && len(now) > 0 {
			log.Infof("network: lost %s, reconnecting to Spotify now", strings.Join(pending, ", "))
			pending = nil
			onLost()
		}
	}
}
