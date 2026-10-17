package daemon

import (
	"path/filepath"
	"testing"

	"github.com/coder/websocket"
)

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

func TestModelOfferOnce(t *testing.T) {
	old := modelOfferPath
	modelOfferPath = filepath.Join(t.TempDir(), "model_offer_shown")
	defer func() { modelOfferPath = old }()

	n := &navRelay{}
	v := &voiceService{app: &App{nav: n}}
	// no phone: no offer
	if _, ok := v.modelOffer(); ok {
		t.Fatal("offer without a phone")
	}
	n.conn = &websocket.Conn{}
	// a phone with a model, or one still checking: no offer
	for _, s := range []ThinkStatus{{State: "ready", Model: "nano"}, {State: "downloading", Model: "nano"}, {State: "unavailable"}} {
		n.applyThinkStatus(s)
		if _, ok := v.modelOffer(); ok {
			t.Fatalf("offer with %+v", s)
		}
	}
	// no Nano and nothing downloaded: once, then never again
	n.applyThinkStatus(ThinkStatus{State: "unavailable", OfferMB: 345})
	if o, ok := v.modelOffer(); !ok || o.SizeMB != 345 {
		t.Fatalf("expected the offer, got %+v %v", o, ok)
	}
	if _, ok := v.modelOffer(); ok {
		t.Fatal("offered twice")
	}
}
