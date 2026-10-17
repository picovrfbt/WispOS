package daemon

import "testing"

func TestThinkActionValid(t *testing.T) {
	good := []thinkAction{
		{Action: "play", Query: "Daft Punk", Kind: "artist"},
		{Action: "play", Query: "chill", Kind: "mood"},
		{Action: "queue", Query: "Starboy"},
		{Action: "answer", Say: "It's 3:15"},
		{Action: "next"},
		{Action: "navigate", Query: "the nearest gas station"},
		{Action: "none", Say: "I can't do that yet"},
	}
	for _, a := range good {
		if !a.valid() {
			t.Errorf("%+v should be allowed", a)
		}
	}
	bad := []thinkAction{
		{Action: "delete_everything"},
		{Action: "play"},                              // nothing to play
		{Action: "play", Query: "x", Kind: "podcast"}, // not a kind Wisp searches
		{Action: "answer"},                            // nothing to say
		{Action: "call", Query: ""},
	}
	for _, a := range bad {
		if a.valid() {
			t.Errorf("%+v should be refused", a)
		}
	}
}

func TestLooksLikeCommand(t *testing.T) {
	for _, s := range []string{"play daft punk", "next", "turn it up", "queue starboy", "pause"} {
		if !looksLikeCommand(s) {
			t.Errorf("%q is a command", s)
		}
	}
	for _, s := range []string{"i'm feeling kind of tired", "what should i listen to", "tell me a joke", ""} {
		if looksLikeCommand(s) {
			t.Errorf("%q isn't a plain command", s)
		}
	}
}

func TestThinkDelivery(t *testing.T) {
	n := &navRelay{}
	// no phone: nothing to ask
	if _, err := n.Think(t.Context(), "hi", thinkContext{}); err == nil {
		t.Fatal("no phone should be an error")
	}
	if s := n.ThinkStatus(); s.State != "off" {
		t.Fatalf("status without a phone: %+v", s)
	}
	// an answer for nobody is dropped quietly
	n.deliverThink(42, thinkAction{Action: "next"})
}
