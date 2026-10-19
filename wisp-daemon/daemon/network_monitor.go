package daemon

import (
	"context"
	"net"
	"os/exec"
	"time"

	"github.com/vishvananda/netlink"

	librespot "github.com/devgianlu/go-librespot"
)

// pinged once a second to test internet reachability
const networkMonitorTarget = "1.1.1.1"

// tried over TCP when the ping fails, so one blocked or slow address isn't "offline"
// (and over IPv6, for a phone on a mobile network with no IPv4)
var networkMonitorConfirm = []string{"1.1.1.1:443", "8.8.8.8:443", "[2606:4700:4700::1111]:443"}

// linkUp reports whether a network interface exists and is up
func linkUp(name string) bool {
	link, err := netlink.LinkByName(name)
	return err == nil && link.Attrs().Flags&net.FlagUp != 0
}

// startNetworkMonitor pings + emits network_status on transition
func startNetworkMonitor(log librespot.Logger, server ApiServer, onTransition func(online bool)) {
	const (
		interval = 1 * time.Second
		// a phone with its screen off can take a few seconds to pass traffic
		// over the Bluetooth tether; that isn't the internet going away
		failThreshold  = 4
		rebroadcastSec = 15
	)

	go func() {
		var (
			online        bool
			failCount     int
			emitted       bool
			tickSinceEmit int
		)

		ping := func() bool {
			ctx, cancel := context.WithTimeout(context.Background(), 2500*time.Millisecond)
			defer cancel()
			cmd := exec.CommandContext(ctx, "ping", "-c", "1", "-W", "2", networkMonitorTarget)
			return cmd.Run() == nil
		}

		confirm := func() bool {
			for _, addr := range networkMonitorConfirm {
				conn, err := net.DialTimeout("tcp", addr, 3*time.Second)
				if err == nil {
					_ = conn.Close()
					return true
				}
			}
			return false
		}

		emit := func(status string) {
			server.Emit(&ApiEvent{
				Type: ApiEventTypeNetworkStatus,
				Data: map[string]any{
					"status": status,
					"usb":    linkUp("usb0"),
					"bt":     linkUp("bnep0"),
				},
			})
			tickSinceEmit = 0
		}

		for {
			ok := ping()
			if !ok {
				ok = confirm()
			}
			if ok {
				failCount = 0
				if !online || !emitted {
					online = true
					emitted = true
					log.Info("network: online")
					emit("online")
					if onTransition != nil {
						onTransition(true)
					}
				}
			} else {
				failCount++
				if failCount >= failThreshold && (online || !emitted) {
					online = false
					emitted = true
					log.Warn("network: offline")
					emit("offline")
					if onTransition != nil {
						onTransition(false)
					}
				}
			}

			// re-broadcast for late WS clients, only once we've determined a state
			if emitted {
				tickSinceEmit++
				if tickSinceEmit >= rebroadcastSec {
					if online {
						emit("online")
					} else {
						emit("offline")
					}
				}
			}

			time.Sleep(interval)
		}
	}()
}
