package daemon

import (
	"context"
	"crypto/tls"
	"encoding/json"
	"fmt"
	"net/http"
	"net/http/httptest"
	"strings"
	"sync"
	"sync/atomic"
	"testing"
	"time"

	librespot "github.com/devgianlu/go-librespot"
)

// Spotify for the line: what's playing there, and every command it got
type lineSpotify struct {
	*StubApiServer
	mu       sync.Mutex
	active   bool
	paused   bool
	track    string
	left     int64 // ms
	autoplay bool
	did      []string
}

func (f *lineSpotify) Submit(_ context.Context, t ApiRequestType, data any) (any, error) {
	f.mu.Lock()
	defer f.mu.Unlock()
	switch t {
	case ApiRequestTypeObserverStatus:
		if !f.active {
			return map[string]any{"active": false}, nil
		}
		return map[string]any{"active": true, "track_uri": f.track, "track_name": "Song " + f.track, "track_artist": "Band",
			"is_playing": !f.paused, "is_paused": f.paused, "duration": int64(200000), "position": 200000 - f.left, "track_autoplay": f.autoplay}, nil
	case ApiRequestTypeSearch:
		return []searchTrackResult{{Uri: "spotify:track:s1", Name: "Spotify One", Artist: "A"}, {Uri: "spotify:track:s2", Name: "Spotify Two", Artist: "B"}}, nil
	case ApiRequestTypeTrackRadio:
		f.did = append(f.did, fmt.Sprint("radio ", data))
		return "spotify:playlist:radio", nil
	case ApiRequestTypePlay:
		f.did = append(f.did, "play "+data.(ApiRequestDataPlay).Uri)
		return nil, nil
	case ApiRequestTypeAddToQueue:
		f.did = append(f.did, fmt.Sprint("queue ", data))
		return nil, nil
	case ApiRequestTypePause:
		f.paused = true
		f.did = append(f.did, "pause")
		return nil, nil
	case ApiRequestTypeResume:
		f.paused = false
		f.did = append(f.did, "resume")
		return nil, nil
	case ApiRequestTypeNext:
		f.did = append(f.did, "next")
		return nil, nil
	case ApiRequestTypeCreatePlaylist:
		d := data.(ApiRequestDataCreatePlaylist)
		f.did = append(f.did, "create "+d.Name+" | "+d.Description+" | "+strings.Join(d.Uris, " "))
		return "spotify:playlist:new", nil
	}
	return nil, fmt.Errorf("unexpected %s", t)
}

func (f *lineSpotify) Emit(*ApiEvent) {}

func (f *lineSpotify) set(fn func(f *lineSpotify)) {
	f.mu.Lock()
	defer f.mu.Unlock()
	fn(f)
}

func (f *lineSpotify) took() string {
	f.mu.Lock()
	defer f.mu.Unlock()
	s := strings.Join(f.did, ", ")
	f.did = nil
	return s
}

// the phone, with YouTube Music signed in
type linePhone struct {
	NavHandler
	mu    sync.Mutex
	media PhoneMedia
	did   []string
}

func (p *linePhone) Status() NavState {
	return NavState{Connected: true, Services: []MusicService{{Id: "ytmusic", Name: "YouTube Music", Enabled: true, SignedIn: true}, {Id: "soundcloud", Enabled: true}}}
}

func (p *linePhone) Media() PhoneMedia {
	p.mu.Lock()
	defer p.mu.Unlock()
	return p.media
}

func (p *linePhone) ServiceBrowse(_ context.Context, svc, id string) (json.RawMessage, error) {
	if svc != "ytmusic" || !strings.HasPrefix(id, "search:song:") {
		return nil, fmt.Errorf("unexpected %s %s", svc, id)
	}
	return json.RawMessage(`[{"name":"Tube One","sub":"C","video":"v1","image":"https://i.ytimg.com/v1.jpg"},{"name":"An album","id":"MPRE"},{"name":"Tube Two","sub":"D","video":"v2"}]`), nil
}

func (p *linePhone) ServicePlay(_ context.Context, svc, _, video, title string) error {
	p.mu.Lock()
	defer p.mu.Unlock()
	p.did = append(p.did, "play "+svc+" "+video)
	p.media = PhoneMedia{Present: true, App: "com.google.android.apps.youtube.music", Title: title, Artist: "C", Playing: true, DurationMs: 180000, PositionMs: 0, PositionAt: time.Now().UnixMilli()}
	return nil
}

func (p *linePhone) MediaControl(_ context.Context, action string) error {
	p.mu.Lock()
	defer p.mu.Unlock()
	p.did = append(p.did, action)
	if action == "pause" {
		p.media.Playing = false
	}
	return nil
}

func (p *linePhone) took() string {
	p.mu.Lock()
	defer p.mu.Unlock()
	s := strings.Join(p.did, ", ")
	p.did = nil
	return s
}

func newLineJam(t *testing.T) (*jamService, *lineSpotify, *linePhone) {
	sp := &lineSpotify{StubApiServer: &StubApiServer{log: &librespot.NullLogger{}}, active: true, track: "spotify:track:driver", left: 90000}
	ph := &linePhone{}
	j := newJamService(&App{server: sp, log: &librespot.NullLogger{}}, nil)
	j.nav = func() NavHandler { return ph }
	j.mu.Lock()
	j.topic = "wisptest"
	j.found = map[string]jamItem{}
	j.mu.Unlock()
	return j, sp, ph
}

// skips the wait after a change over, as if the apps had caught up
func (j *jamService) settled() {
	j.mu.Lock()
	j.settle = time.Time{}
	j.mu.Unlock()
}

func TestJamSearchEverywhere(t *testing.T) {
	j, _, _ := newLineJam(t)
	if got := j.services(); strings.Join(got, ",") != "spotify,ytmusic" {
		t.Fatalf("services %v (SoundCloud isn't signed in)", got)
	}
	items := j.search(context.Background(), "one", "")
	var got []string
	for _, it := range items {
		got = append(got, it.Svc+":"+it.Title)
	}
	// they take turns; the album isn't a song
	if strings.Join(got, ", ") != "spotify:Spotify One, ytmusic:Tube One, spotify:Spotify Two, ytmusic:Tube Two" {
		t.Fatalf("results %v", got)
	}
	if items[1].Image != "https://i.ytimg.com/v1.jpg" {
		t.Fatalf("cover %q", items[1].Image)
	}
	if only := j.search(context.Background(), "one", "ytmusic"); len(only) != 2 || only[0].Svc != "ytmusic" {
		t.Fatalf("one service: %v", only)
	}
	if none := j.search(context.Background(), "one", "soundcloud"); none != nil {
		t.Fatal("a service that isn't signed in isn't searched")
	}
}

func TestJamLineAcrossServices(t *testing.T) {
	j, sp, ph := newLineJam(t)
	ctx := context.Background()
	j.add(jamItem{Svc: "ytmusic", ID: "v1", Title: "Tube One"})
	j.add(jamItem{Svc: "spotify", ID: "spotify:track:s1", Title: "Spotify One"})

	// the driver's song has a while to go: nothing yet
	j.step(ctx, false)
	if got := sp.took() + ph.took(); got != "" {
		t.Fatalf("too soon: %s", got)
	}
	// near its end: Spotify pauses and YouTube Music plays the passenger's song
	sp.set(func(f *lineSpotify) { f.left = 1000 })
	j.step(ctx, false)
	if got := sp.took(); got != "pause" {
		t.Fatalf("spotify: %s", got)
	}
	if got := ph.took(); got != "play ytmusic v1" {
		t.Fatalf("phone: %s", got)
	}
	if st := j.State(); st.Waiting != 1 {
		t.Fatalf("waiting %d", st.Waiting)
	}

	// the YouTube song nears its end: back to Spotify, with the Spotify pick next
	j.settled()
	ph.mu.Lock()
	ph.media.PositionMs, ph.media.PositionAt = 179000, time.Now().UnixMilli()
	ph.mu.Unlock()
	j.step(ctx, false)
	if got := ph.took(); got != "pause" {
		t.Fatalf("phone: %s", got)
	}
	if got := sp.took(); got != "queue spotify:track:s1, next, resume" {
		t.Fatalf("spotify: %s", got)
	}
	// it's on: the line's empty and the song counts for steering
	j.settled()
	sp.set(func(f *lineSpotify) { f.track, f.left = "spotify:track:s1", 150000 })
	j.step(ctx, false)
	if st := j.State(); st.Waiting != 0 {
		t.Fatalf("waiting %d", st.Waiting)
	}

	// Spotify runs out and autoplays: it plays the radio of the passenger's song instead
	sp.set(func(f *lineSpotify) { f.track, f.autoplay = "spotify:track:auto", true })
	j.step(ctx, false)
	if got := sp.took(); got != "radio spotify:track:s1, play spotify:playlist:radio" {
		t.Fatalf("steer: %s", got)
	}
	// once per autoplay run
	j.settled()
	j.step(ctx, false)
	if got := sp.took(); got != "" {
		t.Fatalf("steered again: %s", got)
	}
}

func TestJamDetourEndsBackOnSpotify(t *testing.T) {
	j, sp, ph := newLineJam(t)
	ctx := context.Background()
	j.add(jamItem{Svc: "ytmusic", ID: "v1", Title: "Tube One"})
	sp.set(func(f *lineSpotify) { f.left = 1000 })
	j.step(ctx, false)
	sp.took()
	ph.took()
	// the passenger's song ends and YouTube Music moves on to its own: the driver's music comes back
	j.settled()
	ph.mu.Lock()
	ph.media.PositionMs = 178000
	ph.mu.Unlock()
	j.step(ctx, false) // near the end: ready
	ph.mu.Lock()
	ph.media.Title, ph.media.PositionMs = "YouTube's own pick", 0
	ph.mu.Unlock()
	j.step(ctx, false)
	if got := ph.took(); got != "pause" {
		t.Fatalf("phone: %s", got)
	}
	if got := sp.took(); got != "resume" {
		t.Fatalf("spotify: %s", got)
	}
}

func TestJamSpotifyOnlyUsesItsQueue(t *testing.T) {
	j, sp, _ := newLineJam(t)
	ctx := context.Background()
	j.add(jamItem{Svc: "spotify", ID: "spotify:track:s1"})
	j.add(jamItem{Svc: "spotify", ID: "spotify:track:s2"})
	j.step(ctx, false)
	j.step(ctx, false)
	// one at a time: the next goes in once this one's playing
	if got := sp.took(); got != "queue spotify:track:s1" {
		t.Fatalf("spotify: %s", got)
	}
	sp.set(func(f *lineSpotify) { f.track = "spotify:track:s1" })
	j.step(ctx, false)
	if got := sp.took(); got != "queue spotify:track:s2" {
		t.Fatalf("spotify: %s", got)
	}
	// a skip vote with the next one queued: Spotify's next
	if !j.step(ctx, true) || sp.took() != "next" {
		t.Fatal("skip")
	}
}

func TestJamSteerOff(t *testing.T) {
	j, sp, _ := newLineJam(t)
	j.SetSteer(false)
	j.mu.Lock()
	j.onSpotify = []string{"spotify:track:s1"}
	j.mu.Unlock()
	sp.set(func(f *lineSpotify) { f.autoplay = true })
	j.step(context.Background(), false)
	if got := sp.took(); got != "" {
		t.Fatalf("steer off still steered: %s", got)
	}
}

func TestJamFavorites(t *testing.T) {
	j, sp, _ := newLineJam(t)
	j.add(jamItem{Svc: "spotify", ID: "spotify:track:s2", Title: "Spotify Two", By: "Sam"})
	j.add(jamItem{Svc: "ytmusic", ID: "v1", Title: "Spotify One (Official Video)", Artist: "A - Topic", By: "Alex"})
	j.add(jamItem{Svc: "ytmusic", ID: "v2", Title: "Nothing Like It", By: "Alex"})
	j.add(jamItem{Svc: "spotify", ID: "spotify:track:s2", Title: "Spotify Two", By: "Sam"}) // again: once
	// the session ends; the songs stay until saved
	j.mu.Lock()
	j.topic = ""
	j.mu.Unlock()
	if st := j.State(); st.Active || st.Picks != 3 {
		t.Fatalf("after the end: %+v", st)
	}
	saved, err := j.Save(context.Background())
	if err != nil {
		t.Fatal(err)
	}
	if saved.Songs != 2 || saved.Missing != 1 || saved.Uri != "spotify:playlist:new" || !strings.HasPrefix(saved.Name, "Car jam · ") {
		t.Fatalf("saved %+v", saved)
	}
	if got := sp.took(); !strings.HasSuffix(got, " | Songs Alex and Sam picked in the car, with Wisp. | spotify:track:s2 spotify:track:s1") {
		t.Fatalf("created: %s", got)
	}
	if j.State().Picks != 0 {
		t.Fatal("forgotten once saved")
	}
	if _, err := j.Save(context.Background()); err != ErrJamNothingToSave {
		t.Fatalf("again: %v", err)
	}
}

func TestSongWords(t *testing.T) {
	for in, want := range map[string]string{
		"Midnight City (Official Video)":      "midnight city",
		"Midnight City [Lyrics]":              "midnight city",
		"Get Lucky feat. Pharrell Williams":   "get lucky",
		"Don't Stop Me Now - Remastered 2011": "dont stop me now remastered 2011",
		"Blinding Lights | Official Audio":    "blinding lights",
	} {
		if got := songWords(in); got != want {
			t.Errorf("%q: %q", in, got)
		}
	}
}

func TestJamEndKeepsPicksForTheOffer(t *testing.T) {
	j, sp, _ := newLineJam(t)
	j.server = func() string { return "https://127.0.0.1:1" } // the "ended" note goes nowhere
	j.mu.Lock()
	j.cancel = func() {}
	j.mu.Unlock()
	j.add(jamItem{Svc: "spotify", ID: "spotify:track:s2", Title: "Spotify Two"})
	j.Stop()
	time.Sleep(100 * time.Millisecond)
	if got := sp.took(); got != "" {
		t.Fatalf("saved without being asked: %s", got)
	}
	if st := j.State(); st.Active || st.Picks != 1 {
		t.Fatalf("after the end: %+v", st)
	}
	j.Forget()
	if j.State().Picks != 0 {
		t.Fatal("forgotten")
	}
}

func TestJamRelayPick(t *testing.T) {
	var healthy atomic.Bool
	relay := httptest.NewTLSServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path == "/v1/health" && healthy.Load() {
			_, _ = w.Write([]byte(`{"healthy":true}`))
			return
		}
		http.NotFound(w, r)
	}))
	defer relay.Close()
	list := httptest.NewTLSServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		// one with a path and one not https are skipped
		_, _ = w.Write([]byte(`{"relays":["` + relay.URL + `/sub", "http://not-https.example", "` + relay.URL + `"]}`))
	}))
	defer list.Close()
	j, _, _ := newLineJam(t)
	j.client = &http.Client{Transport: &http.Transport{TLSClientConfig: &tls.Config{InsecureSkipVerify: true}}, Timeout: 5 * time.Second}
	j.mu.Lock()
	j.topic = ""
	j.mu.Unlock()

	healthy.Store(true)
	j.pickRelay(context.Background(), list.URL)
	if j.base() != relay.URL {
		t.Fatalf("picked %s", j.base())
	}
	// a session keeps the relay it started on, whatever's picked later
	st := j.Start()
	defer func() {
		j.mu.Lock()
		j.topic = ""
		j.cancel()
		j.mu.Unlock()
	}()
	if !strings.HasSuffix(st.URL, "@"+strings.TrimPrefix(relay.URL, "https://")) {
		t.Fatalf("link %s", st.URL)
	}
	healthy.Store(false)
	j.pickRelay(context.Background(), list.URL)
	if j.base() != relay.URL {
		t.Fatalf("session moved to %s", j.base())
	}
}
