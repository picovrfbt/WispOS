package daemon

import (
	"context"
	"encoding/json"
	"errors"
	"strings"
	"testing"
)

func TestDriveCommandChecks(t *testing.T) {
	n := newTestRelay(&navEvents{})
	if err := n.DriveCommand(context.Background(), "start", "polka"); !errors.Is(err, ErrBadDriveCommand) {
		t.Fatalf("unknown genre: %v", err)
	}
	if err := n.DriveCommand(context.Background(), "explode", ""); !errors.Is(err, ErrBadDriveCommand) {
		t.Fatalf("unknown action: %v", err)
	}
	// a good command with no phone to send it to
	if err := n.DriveCommand(context.Background(), "start", "ethereal"); !errors.Is(err, ErrNoNavPhone) {
		t.Fatalf("no phone: %v", err)
	}
}

func TestDriveStatePassesThrough(t *testing.T) {
	ev := &navEvents{}
	n := newTestRelay(ev)
	n.applyDriveState([]byte(`{"type":"drive_state","genre":"cinematic","playing":true,"level":0.5,` +
		`"clarity":0.8,"parts":{"drums":0.7,"bass":0.9,"melody":0.6,"choir":0.3},"gps":true,"speed_mph":41}`))
	if ev.count(ApiEventTypeDriveState) != 1 {
		t.Fatalf("want one event, got %d", ev.count(ApiEventTypeDriveState))
	}
	var got map[string]any
	if err := json.Unmarshal(n.DriveState(), &got); err != nil {
		t.Fatal(err)
	}
	if got["genre"] != "cinematic" || got["speed_mph"] != 41.0 || got["type"] != nil {
		t.Fatalf("unexpected state %v", got)
	}

	// not JSON, or far too big: dropped
	n.applyDriveState([]byte(`not json`))
	n.applyDriveState([]byte(`{"pad":"` + strings.Repeat("x", 4096) + `"}`))
	if ev.count(ApiEventTypeDriveState) != 1 {
		t.Fatal("bad states must not reach the UI")
	}

	// the phone went away: the UI hears so once
	n.clearDriveState()
	n.clearDriveState()
	if ev.count(ApiEventTypeDriveState) != 2 || n.DriveState() != nil {
		t.Fatal("a lost phone should clear the drive once")
	}
}
