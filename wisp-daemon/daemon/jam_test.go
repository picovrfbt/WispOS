package daemon

import (
	"context"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"net/http/httptest"
	"os"
	"strings"
	"sync"
	"testing"
	"time"

	librespot "github.com/devgianlu/go-librespot"
)

// a Car Thing's API that searches, queues and skips, and keeps what it emitted
type jamFakeServer struct {
	*StubApiServer
	mu      sync.Mutex
	queued  []string
	skipped int
	events  []string
	track   string
}

func (f *jamFakeServer) Submit(_ context.Context, t ApiRequestType, data any) (any, error) {
	f.mu.Lock()
	defer f.mu.Unlock()
	switch t {
	case ApiRequestTypeSearch:
		return []searchTrackResult{{Uri: "spotify:track:aaa", Name: "Midnight City", Artist: "M83"}, {Uri: "spotify:track:bbb", Name: "Wait", Artist: "M83"}}, nil
	case ApiRequestTypeAddToQueue:
		f.queued = append(f.queued, data.(string))
		return nil, nil
	case ApiRequestTypeNext:
		f.skipped++
		f.track = "spotify:track:next"
		return nil, nil
	case ApiRequestTypeObserverStatus:
		return map[string]any{"active": true, "track_uri": f.track, "track_name": "Song", "track_artist": "Band"}, nil
	}
	return nil, fmt.Errorf("unexpected %s", t)
}

func (f *jamFakeServer) Emit(ev *ApiEvent) {
	f.mu.Lock()
	defer f.mu.Unlock()
	if ev.Type == ApiEventTypeJamActivity {
		f.events = append(f.events, ev.Data.(map[string]string)["text"])
	}
}

// a relay like ntfy: messages posted to <topic>-in stream to the Car Thing;
// what it posts to <topic>-out is kept
type fakeRelay struct {
	mu  sync.Mutex
	in  chan string
	out []map[string]any
}

func (r *fakeRelay) handler(t *testing.T) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, req *http.Request) {
		switch {
		case req.Method == http.MethodGet && strings.HasSuffix(req.URL.Path, "-in/json"):
			fl := w.(http.Flusher)
			w.WriteHeader(http.StatusOK)
			fl.Flush()
			n := 0
			for {
				select {
				case <-req.Context().Done():
					return
				case m := <-r.in:
					n++
					b, _ := json.Marshal(map[string]any{"id": fmt.Sprint(n), "event": "message", "message": m})
					_, _ = w.Write(append(b, '\n'))
					fl.Flush()
				}
			}
		case req.Method == http.MethodPost && strings.HasSuffix(req.URL.Path, "-out"):
			b, _ := io.ReadAll(req.Body)
			var m map[string]any
			if json.Unmarshal(b, &m) != nil {
				t.Errorf("not JSON: %s", b)
			}
			r.mu.Lock()
			r.out = append(r.out, m)
			r.mu.Unlock()
		default:
			http.NotFound(w, req)
		}
	})
}

func (r *fakeRelay) waitFor(t *testing.T, what string, to string) map[string]any {
	t.Helper()
	deadline := time.Now().Add(3 * time.Second)
	for time.Now().Before(deadline) {
		r.mu.Lock()
		for i, m := range r.out {
			if m["t"] == what && (to == "" || m["to"] == to) {
				r.out = append(r.out[:i], r.out[i+1:]...)
				r.mu.Unlock()
				return m
			}
		}
		r.mu.Unlock()
		time.Sleep(20 * time.Millisecond)
	}
	t.Fatalf("no %q message", what)
	return nil
}

func TestJamSession(t *testing.T) {
	relay := &fakeRelay{in: make(chan string, 16)}
	srv := httptest.NewTLSServer(relay.handler(t))
	defer srv.Close()
	fake := &jamFakeServer{StubApiServer: &StubApiServer{log: &librespot.NullLogger{}}, track: "spotify:track:now"}
	app := &App{server: fake, log: &librespot.NullLogger{}}
	j := newJamService(app, func() string { return srv.URL })
	j.client = srv.Client()

	st := j.Start()
	defer j.Stop()
	if !st.Active || !strings.HasPrefix(st.URL, jamPage+"#wisp") {
		t.Fatalf("start: %+v", st)
	}
	topic := st.URL[strings.Index(st.URL, "#")+1 : strings.Index(st.URL, "@")]
	if again := j.Start(); again.URL != st.URL {
		t.Fatal("a second start keeps the session")
	}
	send := func(m map[string]any) {
		b, _ := json.Marshal(m)
		relay.in <- string(b)
	}

	send(map[string]any{"t": "hello", "from": "passenger-1", "name": "Sam"})
	if now := relay.waitFor(t, "now", ""); now["title"] != "Song" || now["needed"] != float64(1) {
		t.Fatalf("now: %v", now)
	}
	// still here: a keep-alive gets nothing back
	send(map[string]any{"t": "hello", "keep": true, "from": "passenger-1"})
	send(map[string]any{"t": "search", "from": "passenger-1", "id": 1, "q": "midnight city"})
	res := relay.waitFor(t, "results", "passenger-1")
	if items := res["items"].([]any); len(items) != 2 || items[0].(map[string]any)["title"] != "Midnight City" {
		t.Fatalf("results: %v", res)
	}
	send(map[string]any{"t": "queue", "from": "passenger-1", "id": 2, "uri": "spotify:track:aaa", "title": "Midnight City"})
	// the "added" rides on the next "now", for everyone, addressed inside to whoever added it
	for {
		now := relay.waitFor(t, "now", "")
		if ack, _ := now["ack"].(map[string]any); ack != nil {
			if ack["to"] != "passenger-1" || ack["pos"] != float64(1) {
				t.Fatalf("ack: %v", ack)
			}
			break
		}
	}
	// again straight away: too soon
	send(map[string]any{"t": "queue", "from": "passenger-1", "id": 3, "uri": "spotify:track:bbb", "title": "Wait"})
	relay.waitFor(t, "wait", "passenger-1")
	// not a track: ignored
	send(map[string]any{"t": "queue", "from": "passenger-2", "name": "Alex", "id": 4, "uri": "spotify:playlist:x"})

	// Alex is in too (the bad queue still counted them): two passengers, so a
	// skip takes two votes
	waitUntil(t, func() bool { return len(j.State().Passengers) == 2 })
	if st := j.State(); st.Passengers[0] != "Alex" || st.Passengers[1] != "Sam" || st.Needed != 1 {
		t.Fatalf("passengers: %+v", st)
	}
	send(map[string]any{"t": "skip", "from": "passenger-1", "uri": "spotify:track:now"})
	waitUntil(t, func() bool { return fake.get().skipped == 1 })
	f := fake.get()
	if len(f.queued) != 1 || f.queued[0] != "spotify:track:aaa" {
		t.Fatalf("queued %v", f.queued)
	}
	got := strings.Join(f.events, " | ")
	if !strings.Contains(got, "Sam joined") || !strings.Contains(got, "Sam added Midnight City") || !strings.Contains(got, "Skipped by the passengers' vote") {
		t.Fatalf("activity: %s", got)
	}
	j.Stop()
	relay.waitFor(t, "ended", "")
	if j.State().Active {
		t.Fatal("stopped")
	}
	_ = topic
}

type jamSnapshot struct {
	queued  []string
	skipped int
	events  []string
}

func (f *jamFakeServer) get() jamSnapshot {
	f.mu.Lock()
	defer f.mu.Unlock()
	return jamSnapshot{append([]string(nil), f.queued...), f.skipped, append([]string(nil), f.events...)}
}

func waitUntil(t *testing.T, ok func() bool) {
	t.Helper()
	deadline := time.Now().Add(3 * time.Second)
	for !ok() {
		if time.Now().After(deadline) {
			t.Fatal("timed out")
		}
		time.Sleep(20 * time.Millisecond)
	}
}

func TestJamByVoice(t *testing.T) {
	for _, c := range []struct{ said, want string }{
		{"let the passengers pick the music", doJamStart},
		{"let everyone pick", doJamStart},
		{"start passenger mode", doJamStart},
		{"stop passenger mode", doJamStop},
		{"end the jam", doJamStop},
	} {
		if u, ok := understand(c.said); !ok || u.what != c.want {
			t.Errorf("%q: %+v %v", c.said, u, ok)
		}
	}
}

// TestJamLive runs a session through the real relay, with a fake Car Thing
// behind it, for trying docs/jam.html by hand: WISP_JAM_LIVE=1 go test -run TestJamLive -v
func TestJamLive(t *testing.T) {
	if os.Getenv("WISP_JAM_LIVE") == "" {
		t.Skip("set WISP_JAM_LIVE=1")
	}
	// Spotify mid-song, and a phone with YouTube Music signed in
	sp := &lineSpotify{StubApiServer: &StubApiServer{log: &librespot.NullLogger{}}, active: true, track: "spotify:track:now", left: 120000}
	ph := &linePhone{}
	j := newJamService(&App{server: sp, log: &librespot.NullLogger{}}, nil)
	j.nav = func() NavHandler { return ph }
	if r := os.Getenv("WISP_JAM_RELAY"); r != "" {
		j.server = func() string { return r } // a relay to try, e.g. Wisp's own
	}
	st := j.Start()
	defer j.Stop()
	j.add(jamItem{Svc: "ytmusic", ID: "v9", Title: "Tube Song", Artist: "Someone", By: "Alex"})
	j.add(jamItem{Svc: "spotify", ID: "spotify:track:s9", Title: "A Spotify Song", Artist: "Band", By: "Maya"})
	fmt.Println("JAM_URL", st.URL)
	time.Sleep(75 * time.Second)
	fmt.Println("JAM_RESULT", sp.took(), "|", ph.took(), "| waiting", j.State().Waiting)
}
