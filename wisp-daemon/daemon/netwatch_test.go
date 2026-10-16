package daemon

import (
	"context"
	"sync/atomic"
	"testing"
	"time"

	librespot "github.com/devgianlu/go-librespot"
)

func TestLostAddrs(t *testing.T) {
	before := map[string]bool{"bnep0#7 10.13.231.160": true, "usb0#3 172.16.42.2": true}
	// the tether came back as a new interface with the same address: still lost
	now := map[string]bool{"bnep0#9 10.13.231.160": true, "usb0#3 172.16.42.2": true}
	if got := lostAddrs(before, now); len(got) != 1 || got[0] != "bnep0#7 10.13.231.160" {
		t.Fatalf("got %v", got)
	}
	// only additions (USB picked up an address): nothing lost
	if got := lostAddrs(now, map[string]bool{"bnep0#9 10.13.231.160": true, "usb0#3 172.16.42.2": true, "usb0#3 192.168.137.46": true}); len(got) != 0 {
		t.Fatalf("an added address is not a loss: %v", got)
	}
}

func TestWatchNetworkChangesReconnectsOnceSettled(t *testing.T) {
	var state atomic.Value
	state.Store(map[string]bool{"bnep0#7 10.13.231.160": true})
	read := func() map[string]bool { return state.Load().(map[string]bool) }
	var fired atomic.Int32
	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()
	go watchNetworkChanges(ctx, &librespot.NullLogger{}, read, func() { fired.Add(1) })
	time.Sleep(100 * time.Millisecond)
	state.Store(map[string]bool{"bnep0#9 10.13.231.161": true})
	deadline := time.Now().Add(netWatchEvery*3 + netWatchSettle)
	for fired.Load() == 0 && time.Now().Before(deadline) {
		time.Sleep(200 * time.Millisecond)
	}
	if fired.Load() != 1 {
		t.Fatalf("want one reconnect after the tether came back, got %d", fired.Load())
	}
}
