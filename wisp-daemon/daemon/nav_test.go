package daemon

import (
	"context"
	"net/http"
	"net/http/httptest"
	"strings"
	"sync"
	"testing"
	"time"

	"github.com/coder/websocket"
	librespot "github.com/devgianlu/go-librespot"
)

type navEvents struct {
	mu  sync.Mutex
	evs []*ApiEvent
}

func (e *navEvents) emit(ev *ApiEvent) {
	e.mu.Lock()
	e.evs = append(e.evs, ev)
	e.mu.Unlock()
}

func (e *navEvents) count(t ApiEventType) int {
	e.mu.Lock()
	defer e.mu.Unlock()
	n := 0
	for _, ev := range e.evs {
		if ev.Type == t {
			n++
		}
	}
	return n
}

func newTestRelay(ev *navEvents) *navRelay {
	return newNavRelay(NavConfig{Enabled: true}, &librespot.NullLogger{}, ev.emit, func() string { return "" })
}

func TestNavApplyTurn(t *testing.T) {
	ev := &navEvents{}
	n := newTestRelay(ev)
	n.apply(navMessage{Type: "nav", Active: true, Title: " 500 ft ", Text: "Turn right onto Main St",
		SubText: "12 min · 5.1 mi", Icon: "data:image/png;base64,AAAA"})
	s := n.Status()
	if !s.Active || s.Title != "500 ft" || s.Text != "Turn right onto Main St" || s.Icon == "" {
		t.Fatalf("unexpected state %+v", s)
	}
	if ev.count(ApiEventTypeNav) != 1 {
		t.Fatalf("want one nav event, got %d", ev.count(ApiEventTypeNav))
	}
	// the same turn again is not a change
	n.apply(navMessage{Type: "nav", Active: true, Title: "500 ft", Text: "Turn right onto Main St",
		SubText: "12 min · 5.1 mi", Icon: "data:image/png;base64,AAAA"})
	if ev.count(ApiEventTypeNav) != 1 {
		t.Fatal("an unchanged turn must not emit")
	}
	n.apply(navMessage{Type: "nav", Active: false})
	if s := n.Status(); s.Active || s.Title != "" || s.Icon != "" {
		t.Fatalf("ending navigation must clear the turn, got %+v", s)
	}
}

func TestNavRejectsBadInput(t *testing.T) {
	n := newTestRelay(&navEvents{})
	n.apply(navMessage{Type: "nav", Active: true, Title: strings.Repeat("x", 500),
		Icon: "javascript:alert(1)"})
	s := n.Status()
	if len([]rune(s.Title)) != navMaxTextRunes {
		t.Fatalf("title not clipped: %d runes", len([]rune(s.Title)))
	}
	if s.Icon != "" {
		t.Fatal("non-png icon must be dropped")
	}
	for _, fix := range [][2]float64{{91, 0}, {0, 181}, {0, 0}} {
		n.apply(navMessage{Type: "location", Lat: fix[0], Lng: fix[1]})
		if n.Status().Location != nil {
			t.Fatalf("fix %v must be rejected", fix)
		}
	}
}

func TestNavLocationIsItsOwnEvent(t *testing.T) {
	ev := &navEvents{}
	n := newTestRelay(ev)
	n.apply(navMessage{Type: "location", Lat: 40.7, Lng: -74.0, Bearing: 90, Speed: 12})
	if ev.count(ApiEventTypeNavLocation) != 1 || ev.count(ApiEventTypeNav) != 0 {
		t.Fatalf("a fix should only emit nav/location")
	}
	if loc := n.Status().Location; loc == nil || loc.Lat != 40.7 {
		t.Fatalf("location not stored: %+v", loc)
	}
}

// end to end against a fake companion app
func TestNavRelayConnectsToPhone(t *testing.T) {
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		c, err := websocket.Accept(w, r, nil)
		if err != nil {
			return
		}
		defer func() { _ = c.CloseNow() }()
		_ = c.Write(r.Context(), websocket.MessageText,
			[]byte(`{"type":"nav","active":true,"title":"0.3 mi","text":"Exit 12"}`))
		<-r.Context().Done()
	}))
	defer srv.Close()

	ev := &navEvents{}
	n := newNavRelay(NavConfig{Enabled: true, PhoneURL: "ws" + strings.TrimPrefix(srv.URL, "http") + "/nav"},
		&librespot.NullLogger{}, ev.emit, func() string { return "" })
	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()
	go n.run(ctx)

	deadline := time.Now().Add(3 * time.Second)
	for time.Now().Before(deadline) {
		if s := n.Status(); s.Connected && s.Title == "0.3 mi" {
			return
		}
		time.Sleep(20 * time.Millisecond)
	}
	t.Fatalf("relay never picked up the phone's turn: %+v", n.Status())
}

func TestNavWakeSpotifyReachesPhone(t *testing.T) {
	got := make(chan string, 1)
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		c, err := websocket.Accept(w, r, nil)
		if err != nil {
			return
		}
		defer func() { _ = c.CloseNow() }()
		_, msg, err := c.Read(r.Context())
		if err == nil {
			got <- string(msg)
		}
	}))
	defer srv.Close()

	n := newNavRelay(NavConfig{Enabled: true, PhoneURL: "ws" + strings.TrimPrefix(srv.URL, "http") + "/nav"},
		&librespot.NullLogger{}, nil, func() string { return "" })
	if err := n.WakeSpotify(context.Background()); err != ErrNoNavPhone {
		t.Fatalf("with no phone want ErrNoNavPhone, got %v", err)
	}
	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()
	go n.run(ctx)

	deadline := time.Now().Add(3 * time.Second)
	for !n.Status().Connected && time.Now().Before(deadline) {
		time.Sleep(20 * time.Millisecond)
	}
	if err := n.WakeSpotify(ctx); err != nil {
		t.Fatalf("wake: %v", err)
	}
	select {
	case msg := <-got:
		if msg != `{"type":"wake_spotify"}` {
			t.Fatalf("phone got %q", msg)
		}
	case <-time.After(3 * time.Second):
		t.Fatal("the phone never got the wake")
	}
}

// a voice play wakes Spotify quietly first, so it isn't opened over the map
func TestNavWakeSpotifyQuietSaysSo(t *testing.T) {
	got := make(chan string, 1)
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		c, err := websocket.Accept(w, r, nil)
		if err != nil {
			return
		}
		defer func() { _ = c.CloseNow() }()
		_, msg, err := c.Read(r.Context())
		if err == nil {
			got <- string(msg)
		}
	}))
	defer srv.Close()

	n := newNavRelay(NavConfig{Enabled: true, PhoneURL: "ws" + strings.TrimPrefix(srv.URL, "http") + "/nav"},
		&librespot.NullLogger{}, nil, func() string { return "" })
	if err := n.WakeSpotifyQuiet(context.Background()); err != ErrNoNavPhone {
		t.Fatalf("with no phone want ErrNoNavPhone, got %v", err)
	}
	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()
	go n.run(ctx)

	deadline := time.Now().Add(3 * time.Second)
	for !n.Status().Connected && time.Now().Before(deadline) {
		time.Sleep(20 * time.Millisecond)
	}
	if err := n.WakeSpotifyQuiet(ctx); err != nil {
		t.Fatalf("wake: %v", err)
	}
	select {
	case msg := <-got:
		if msg != `{"type":"wake_spotify","quiet":true}` {
			t.Fatalf("phone got %q", msg)
		}
	case <-time.After(3 * time.Second):
		t.Fatal("the phone never got the wake")
	}
}

func TestNavHelloCarriesThePhonesTimeZone(t *testing.T) {
	ev := &navEvents{}
	n := newTestRelay(ev)
	off := func(v int) *int { return &v }
	n.apply(navMessage{Type: "hello", TzOffsetMin: off(-240)})
	if s := n.Status(); s.TzOffsetMin == nil || *s.TzOffsetMin != -240 {
		t.Fatalf("want the phone's offset, got %+v", s.TzOffsetMin)
	}
	n.apply(navMessage{Type: "hello", TzOffsetMin: off(-240)})
	if ev.count(ApiEventTypeNav) != 1 {
		t.Fatal("the same offset again is not a change")
	}
	n.apply(navMessage{Type: "hello", TzOffsetMin: off(99999)})
	if s := n.Status(); *s.TzOffsetMin != -240 {
		t.Fatal("an impossible offset must be ignored")
	}
}

func TestNavHelloHandsTheTimeZoneOn(t *testing.T) {
	n := newTestRelay(&navEvents{})
	got := 99999
	n.onTimeZone = func(off int) { got = off }
	off := -300
	n.apply(navMessage{Type: "hello", TzOffsetMin: &off})
	if got != -300 {
		t.Fatalf("the phone's zone should reach the app, got %d", got)
	}
}
