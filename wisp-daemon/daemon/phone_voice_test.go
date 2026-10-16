package daemon

import (
	"context"
	"errors"
	"testing"
)

func TestPhoneVoiceSayNeedsWordsAndAPhone(t *testing.T) {
	n := newTestRelay(&navEvents{})
	if err := n.Say(context.Background(), "   ", 1, 1); !errors.Is(err, ErrNothingToSay) {
		t.Fatalf("blank text: want ErrNothingToSay, got %v", err)
	}
	if err := n.Say(context.Background(), "Playing Midnight City", 1, 0.6); !errors.Is(err, ErrNoNavPhone) {
		t.Fatalf("no phone: want ErrNoNavPhone, got %v", err)
	}
}

func TestPhoneVoiceStatusReachesTheUI(t *testing.T) {
	ev := &navEvents{}
	n := newTestRelay(ev)
	n.applyVoiceStatus(phoneVoiceStatusMessage{State: "downloading", Percent: 140})
	if s := n.Status(); s.VoiceState != "downloading" || s.VoicePercent != 100 {
		t.Fatalf("want downloading at a sane percent, got %+v", s)
	}
	n.applyVoiceStatus(phoneVoiceStatusMessage{State: "exploded"})
	if s := n.Status(); s.VoiceState != "downloading" {
		t.Fatal("an unknown state must be ignored")
	}
	n.applyVoiceStatus(phoneVoiceStatusMessage{State: "ready"})
	if s := n.Status(); s.VoiceState != "ready" || ev.count(ApiEventTypeNav) != 2 {
		t.Fatalf("ready should reach the UI, got %+v", s)
	}
}

func TestWispVoiceSetting(t *testing.T) {
	cases := map[string]bool{
		``:                              false,
		`{"wispVoice":"off"}`:           false,
		`{"wispVoice":"confirmations"}`: true,
		`{"wispVoice":"everything"}`:    true,
	}
	for blob, want := range cases {
		if got := wispVoiceFromSettings([]byte(blob)); got != want {
			t.Errorf("wispVoiceFromSettings(%s) = %v, want %v", blob, got, want)
		}
	}
}
