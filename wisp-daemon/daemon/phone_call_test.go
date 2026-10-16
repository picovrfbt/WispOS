package daemon

import (
	"context"
	"errors"
	"testing"
)

func TestCallStatesReachTheUI(t *testing.T) {
	ev := &navEvents{}
	n := newTestRelay(ev)
	if n.Call().State != "idle" {
		t.Fatal("no call to start with")
	}
	n.applyCall(PhoneCall{State: "ringing", Name: "Sam"})
	n.applyCall(PhoneCall{State: "ringing", Name: "Sam"})
	n.applyCall(PhoneCall{State: "active", Name: "Sam", Since: 1000})
	if c := n.Call(); c.State != "active" || c.Since != 1000 {
		t.Fatalf("unexpected call %+v", c)
	}
	// anything else from the phone is "no call"
	n.applyCall(PhoneCall{State: "weird"})
	if n.Call().State != "idle" {
		t.Fatal("an unknown state is no call")
	}
	if ev.count(ApiEventTypePhoneCall) != 3 {
		t.Fatalf("want 3 events (a repeat says nothing), got %d", ev.count(ApiEventTypePhoneCall))
	}
}

func TestCallControlChecks(t *testing.T) {
	n := newTestRelay(&navEvents{})
	if err := n.CallControl(context.Background(), "transfer"); !errors.Is(err, ErrBadCallAction) {
		t.Fatalf("unknown action: %v", err)
	}
	if err := n.CallControl(context.Background(), "answer"); !errors.Is(err, ErrNoNavPhone) {
		t.Fatalf("no phone: %v", err)
	}
}

func TestBatteryFromThePhone(t *testing.T) {
	ev := &navEvents{}
	n := newTestRelay(ev)
	if n.Battery().Known {
		t.Fatal("unknown until the phone says")
	}
	n.applyBattery(PhoneBattery{Level: 140, Charging: false})
	n.applyBattery(PhoneBattery{Level: 100, Charging: false})
	if b := n.Battery(); !b.Known || b.Level != 100 {
		t.Fatalf("unexpected battery %+v", b)
	}
	n.clearBattery()
	if n.Battery().Known || ev.count(ApiEventTypePhoneBattery) != 2 {
		t.Fatalf("a gone phone's battery is forgotten once; events %d", ev.count(ApiEventTypePhoneBattery))
	}
}

func TestVizFramesPassThrough(t *testing.T) {
	ev := &navEvents{}
	n := newTestRelay(ev)
	if err := n.SetVizWanted(true); !errors.Is(err, ErrNoNavPhone) {
		t.Fatalf("no phone to ask: %v", err)
	}
	n.applyViz([]byte(`{"type":"viz","b":[1,2,3],"l":40,"beat":true}`))
	n.applyViz([]byte(`nope`))
	if ev.count(ApiEventTypePhoneViz) != 1 {
		t.Fatalf("want one frame through, got %d", ev.count(ApiEventTypePhoneViz))
	}
	n.applyVizStatus(VizStatus{Available: false, Why: "This phone doesn't allow the visualizer"})
	if s := n.VizStatus(); !s.Known || s.Available {
		t.Fatalf("unexpected status %+v", s)
	}
}
