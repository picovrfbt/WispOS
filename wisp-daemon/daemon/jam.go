package daemon

import (
	"bufio"
	"bytes"
	"context"
	"crypto/rand"
	"encoding/base32"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"math"
	"net/http"
	"sort"
	"strings"
	"sync"
	"time"
	"unicode/utf8"
)

// Passengers pick the music: the Car Thing shows a QR code; a passenger scans
// it and gets a page on Wisp's website (docs/jam.html) where they search,
// add songs to Up next and vote to skip. Their phones aren't on the Car
// Thing's network, so the two talk through ntfy (ntfy.sh by default, a free,
// open-source message relay; config jam.server for another): the page
// publishes to <topic>-in, the Car Thing answers on <topic>-out. The topic is
// random and new for every session, so only people who scanned the code can
// take part. The Car Thing does the searching and queueing itself: no one
// gets near your Spotify account, and only song searches and picks pass
// through the relay.
//
// Passengers can pick from Spotify and from the phone's other services
// (YouTube Music, SoundCloud) when you're signed in to them. Those play in
// their own apps on the phone, which take no queue from outside, so the
// passengers' picks wait in Wisp's own line (jam_line.go) and each starts on
// its service as the song before it ends.

const (
	jamDefaultServer = "https://ntfy.sh"
	jamPage          = "https://picovrfbt.github.io/WispOS/jam.html"
	jamMaxAge        = 8 * time.Hour
	jamActive        = 20 * time.Minute // a passenger counts this long after their last message
	jamQueueEvery    = 15 * time.Second // per passenger
	jamSearchEvery   = 2 * time.Second  // per passenger
	jamMaxResults    = 8
	jamMaxLine       = 30 // songs waiting
)

const (
	ApiEventTypeJamState    ApiEventType = "jam/state"
	ApiEventTypeJamActivity ApiEventType = "jam/activity"
)

// JamState is GET /jam and the jam/state event
type JamState struct {
	Active     bool     `json:"active"`
	URL        string   `json:"url,omitempty"`
	Passengers []string `json:"passengers"`
	// skip votes for the song playing, and how many it takes
	Votes  int `json:"votes"`
	Needed int `json:"needed"`
	// the passengers' songs waiting to play
	Waiting int `json:"waiting"`
	// when Spotify runs out and starts its own picks, it plays more like the passengers' instead
	Steer bool `json:"steer"`
	// songs the passengers added, to keep as a playlist (stays after the session ends until saved or forgotten)
	Picks int `json:"picks"`
}

type jamPassenger struct {
	name     string
	seen     time.Time
	queued   time.Time
	searched time.Time
}

type jamService struct {
	app    *App
	client *http.Client
	server func() string
	// the phone, for YouTube Music and SoundCloud; nil or nil-returning without it
	nav func() NavHandler

	mu         sync.Mutex
	topic      string
	started    time.Time
	cancel     context.CancelFunc
	passengers map[string]*jamPassenger
	voteTrack  string
	votes      map[string]bool
	nowSent    string // what "now" last said, so it's only sent on a change
	// songs from the passengers' searches, by service and id, so a pick is one the Car Thing found
	found map[string]jamItem
	jamLine
	steer bool
	// every song added this session, kept after it ends until saved or forgotten (jam_save.go)
	picks []jamItem

	// the relay: the newest healthy one, and the one this session started on (jam_relay.go)
	rmu      sync.Mutex
	chosen   string
	sessBase string
}

func newJamService(app *App, server func() string) *jamService {
	return &jamService{app: app, client: &http.Client{Timeout: 15 * time.Second}, server: server, steer: true}
}

func (j *jamService) phone() NavHandler {
	if j.nav == nil {
		return nil
	}
	return j.nav()
}

// base: the relay this session uses, picked as it starts (jam_relay.go)
func (j *jamService) base() string {
	if j.server != nil {
		if s := strings.TrimRight(strings.TrimSpace(j.server()), "/"); strings.HasPrefix(s, "https://") {
			return s
		}
	}
	j.rmu.Lock()
	defer j.rmu.Unlock()
	switch {
	case j.sessBase != "":
		return j.sessBase
	case j.chosen != "":
		return j.chosen
	}
	return jamDefaultServer
}

// State: whether a session's on, the link for its QR, who's in
func (j *jamService) State() JamState {
	j.mu.Lock()
	defer j.mu.Unlock()
	return j.stateLocked()
}

func (j *jamService) stateLocked() JamState {
	st := JamState{Passengers: []string{}, Steer: j.steer, Needed: 1, Picks: len(j.picks)}
	if j.topic == "" {
		return st
	}
	st.Active = true
	st.URL = jamPage + "#" + j.topic
	if b := j.base(); b != jamDefaultServer {
		st.URL += "@" + strings.TrimPrefix(b, "https://")
	}
	for _, p := range j.activeLocked() {
		st.Passengers = append(st.Passengers, p.name)
	}
	sort.Strings(st.Passengers)
	st.Votes = len(j.votes)
	st.Needed = j.neededLocked()
	st.Waiting = len(j.line)
	return st
}

// SetSteer: whether Spotify's autoplay carries on from the passengers' songs
func (j *jamService) SetSteer(on bool) JamState {
	j.mu.Lock()
	j.steer = on
	j.mu.Unlock()
	j.emitState()
	return j.State()
}

func (j *jamService) activeLocked() []*jamPassenger {
	var out []*jamPassenger
	for _, p := range j.passengers {
		if time.Since(p.seen) < jamActive {
			out = append(out, p)
		}
	}
	return out
}

// half the passengers (rounded up) skip a song; one is enough on your own
func (j *jamService) neededLocked() int {
	return max(1, int(math.Ceil(float64(len(j.activeLocked()))/2)))
}

func (j *jamService) emitState() {
	j.app.server.Emit(&ApiEvent{Type: ApiEventTypeJamState, Data: j.State()})
}

func (j *jamService) activity(text string) {
	j.app.server.Emit(&ApiEvent{Type: ApiEventTypeJamActivity, Data: map[string]string{"text": text}})
}

// Start opens a session with a new topic (or keeps the one that's open)
func (j *jamService) Start() JamState {
	j.mu.Lock()
	if j.topic != "" {
		st := j.stateLocked()
		j.mu.Unlock()
		return st
	}
	j.found = map[string]jamItem{}
	j.jamLine = jamLine{}
	j.picks = nil
	b := make([]byte, 15)
	_, _ = rand.Read(b)
	j.topic = "wisp" + strings.ToLower(base32.StdEncoding.WithPadding(base32.NoPadding).EncodeToString(b))
	j.started = time.Now()
	j.passengers = map[string]*jamPassenger{}
	j.votes = map[string]bool{}
	j.voteTrack, j.nowSent = "", ""
	ctx, cancel := context.WithCancel(context.Background())
	j.cancel = cancel
	topic := j.topic
	j.mu.Unlock()
	j.rmu.Lock()
	j.sessBase = ""
	j.rmu.Unlock()
	base := j.base()
	j.rmu.Lock()
	j.sessBase = base
	j.rmu.Unlock()
	go j.listen(ctx, topic)
	go j.follow(ctx, topic)
	go j.feed(ctx, topic)
	j.app.log.Infof("jam: passengers can pick the music")
	j.emitState()
	return j.State()
}

// Stop ends the session; the passengers' pages say so
func (j *jamService) Stop() {
	j.mu.Lock()
	topic, cancel := j.topic, j.cancel
	j.topic, j.cancel = "", nil
	j.mu.Unlock()
	if topic == "" {
		return
	}
	cancel()
	go func() {
		ctx, c := context.WithTimeout(context.Background(), 10*time.Second)
		defer c()
		_ = j.publish(ctx, topic, map[string]any{"t": "ended"})
	}()
	j.emitState()
}

func (j *jamService) current(topic string) bool {
	j.mu.Lock()
	defer j.mu.Unlock()
	return j.topic == topic && time.Since(j.started) < jamMaxAge
}

func (j *jamService) publish(ctx context.Context, topic string, msg map[string]any) error {
	b, err := json.Marshal(msg)
	if err != nil {
		return err
	}
	req, err := http.NewRequestWithContext(ctx, http.MethodPost, j.base()+"/"+topic+"-out", bytes.NewReader(b))
	if err != nil {
		return err
	}
	req.Header.Set("User-Agent", ownNavUA)
	resp, err := j.client.Do(req)
	if err != nil {
		return err
	}
	_ = resp.Body.Close()
	if resp.StatusCode != http.StatusOK {
		return fmt.Errorf("the relay answered %s", resp.Status)
	}
	return nil
}

// listen follows <topic>-in for as long as the session lasts, coming back after drops
func (j *jamService) listen(ctx context.Context, topic string) {
	since := "all"
	wait := time.Second
	for ctx.Err() == nil && j.current(topic) {
		next, err := j.listenOnce(ctx, topic, since)
		if next != "" {
			since = next
			wait = time.Second
		}
		if ctx.Err() != nil {
			return
		}
		if err != nil {
			j.app.log.Debugf("jam: relay: %v", err)
		}
		select {
		case <-ctx.Done():
			return
		case <-time.After(wait):
		}
		wait = min(wait*2, 30*time.Second)
	}
	if ctx.Err() == nil {
		// eight hours on: the session ends by itself
		j.Stop()
	}
}

func (j *jamService) listenOnce(ctx context.Context, topic, since string) (string, error) {
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, j.base()+"/"+topic+"-in/json?since="+since, nil)
	if err != nil {
		return "", err
	}
	req.Header.Set("User-Agent", ownNavUA)
	// a stream: no overall timeout, the relay sends keepalives
	resp, err := (&http.Client{Transport: j.client.Transport}).Do(req)
	if err != nil {
		return "", err
	}
	defer func() { _ = resp.Body.Close() }()
	if resp.StatusCode != http.StatusOK {
		return "", fmt.Errorf("the relay answered %s", resp.Status)
	}
	last := ""
	sc := bufio.NewScanner(io.LimitReader(resp.Body, 64<<20))
	sc.Buffer(make([]byte, 0, 8192), 16384)
	for sc.Scan() {
		var ev struct {
			ID      string `json:"id"`
			Event   string `json:"event"`
			Message string `json:"message"`
		}
		if json.Unmarshal(sc.Bytes(), &ev) != nil || ev.Event != "message" {
			continue
		}
		last = ev.ID
		j.handle(ctx, topic, ev.Message)
	}
	return last, sc.Err()
}

type jamRequest struct {
	T    string `json:"t"`
	From string `json:"from"`
	Name string `json:"name"`
	ID   int    `json:"id"`
	Q    string `json:"q"`
	URI  string `json:"uri"`
	// the service: spotify, ytmusic or soundcloud ("" is Spotify for a pick, everywhere for a search)
	Svc string `json:"svc"`
	// a hello that only says the page is still open
	Keep bool `json:"keep"`
	// the song's name and artist, for "Sam added …"
	Title  string `json:"title"`
	Artist string `json:"artist"`
}

func (j *jamService) handle(ctx context.Context, topic, raw string) {
	var r jamRequest
	if len(raw) > 2048 || json.Unmarshal([]byte(raw), &r) != nil {
		return
	}
	if len(r.From) < 8 || len(r.From) > 40 {
		return
	}
	given := strings.TrimSpace(r.Name)
	if !utf8.ValidString(given) {
		given = ""
	}
	j.mu.Lock()
	if j.topic != topic {
		j.mu.Unlock()
		return
	}
	p := j.passengers[r.From]
	isNew := p == nil || time.Since(p.seen) >= jamActive
	if p == nil {
		p = &jamPassenger{name: "A passenger"}
		j.passengers[r.From] = p
	}
	// a name once said stays until they give another
	if given != "" {
		p.name = clipRunes(given, 24)
	}
	p.seen = time.Now()
	name := p.name
	j.mu.Unlock()
	if isNew {
		j.activity(name + " joined")
		j.emitState()
	}
	reply := func(msg map[string]any) {
		msg["to"] = r.From
		if err := j.publish(ctx, topic, msg); err != nil {
			j.app.log.Debugf("jam: reply not sent: %v", err)
		}
	}

	switch r.T {
	case "hello":
		// a page saying it's still there needs nothing back: the relay counts every message sent
		if r.Keep && !isNew {
			return
		}
		j.mu.Lock()
		j.nowSent = "" // they need to know what's on
		j.mu.Unlock()
		j.sendNow(ctx, topic)

	case "search":
		q := strings.TrimSpace(r.Q)
		if q == "" || len(q) > 100 || !j.allow(r.From, func(p *jamPassenger) *time.Time { return &p.searched }, jamSearchEvery) {
			return
		}
		items := j.search(ctx, q, r.Svc)
		out := make([]map[string]string, 0, len(items))
		for _, it := range items {
			m := map[string]string{"svc": it.Svc, "uri": it.ID, "title": it.Title, "artist": it.Artist}
			if it.Image != "" {
				m["image"] = it.Image
			}
			out = append(out, m)
		}
		reply(map[string]any{"t": "results", "id": r.ID, "items": out})

	case "queue":
		svc := r.Svc
		if svc == "" {
			svc = jamSpotify
		}
		j.mu.Lock()
		it, ok := j.found[svc+" "+r.URI]
		full := len(j.line) >= jamMaxLine
		j.mu.Unlock()
		if !ok {
			// a Spotify song from an older page, without a search behind it
			if svc != jamSpotify || !strings.HasPrefix(r.URI, "spotify:track:") || len(r.URI) > 60 {
				return
			}
			it = jamItem{Svc: jamSpotify, ID: r.URI, Title: clipRunes(strings.TrimSpace(r.Title), 80), Artist: clipRunes(strings.TrimSpace(r.Artist), 60)}
		}
		if full {
			reply(map[string]any{"t": "full", "id": r.ID})
			return
		}
		if !j.allow(r.From, func(p *jamPassenger) *time.Time { return &p.queued }, jamQueueEvery) {
			reply(map[string]any{"t": "wait", "id": r.ID})
			return
		}
		it.By = name
		pos := j.add(it)
		if it.Title != "" {
			text := name + " added " + it.Title
			if it.Svc != jamSpotify {
				text += " (" + jamServiceName(it.Svc) + ")"
			}
			j.activity(text)
		}
		j.emitState()
		// one message for everyone: the new Up next, with the "added" for whoever added it
		j.sendNowWith(ctx, topic, map[string]any{"to": r.From, "id": r.ID, "title": it.Title, "pos": pos})
		// a song can go to Spotify's queue straight away
		j.step(ctx, false)

	case "skip":
		n := j.observe(ctx)
		if n.key == "" || r.URI != n.key {
			return
		}
		j.mu.Lock()
		if j.voteTrack != n.key {
			j.voteTrack, j.votes = n.key, map[string]bool{}
		}
		j.votes[r.From] = true
		votes, needed := len(j.votes), j.neededLocked()
		skip := votes >= needed
		if skip {
			j.votes = map[string]bool{}
		}
		j.nowSent = ""
		j.mu.Unlock()
		if skip {
			if j.step(ctx, true) {
				j.activity("Skipped by the passengers' vote")
			}
		} else {
			j.activity(fmt.Sprintf("%s voted to skip (%d of %d)", name, votes, needed))
		}
		j.emitState()
		j.sendNow(ctx, topic)
	}
}

// allow: at most one of this kind of request per every, per passenger
func (j *jamService) allow(from string, at func(*jamPassenger) *time.Time, every time.Duration) bool {
	j.mu.Lock()
	defer j.mu.Unlock()
	p := j.passengers[from]
	if p == nil {
		return false
	}
	t := at(p)
	if time.Since(*t) < every {
		return false
	}
	*t = time.Now()
	return true
}

// sendNow tells the passengers what's playing (and where), the skip votes,
// what's waiting and where they can search, when any of it changed
func (j *jamService) sendNow(ctx context.Context, topic string) {
	j.sendNowWith(ctx, topic, nil)
}

// sendNowWith sends "now" carrying ack, the answer to a passenger's pick (always sent)
func (j *jamService) sendNowWith(ctx context.Context, topic string, ack map[string]any) {
	n := j.observe(ctx)
	msg := map[string]any{"t": "now"}
	if ack != nil {
		msg["ack"] = ack
	}
	if n.key != "" {
		msg["uri"] = n.key
		msg["svc"] = n.where
		msg["title"] = n.title
		msg["artist"] = n.artist
		if strings.HasPrefix(n.image, "https://") {
			msg["image"] = n.image
		}
	}
	svcs := j.services()
	list := make([]map[string]string, 0, len(svcs))
	for _, s := range svcs {
		list = append(list, map[string]string{"id": s, "name": jamServiceName(s)})
	}
	msg["services"] = list
	j.mu.Lock()
	if j.voteTrack != n.key {
		j.voteTrack, j.votes = n.key, map[string]bool{}
	}
	msg["votes"], msg["needed"] = len(j.votes), j.neededLocked()
	next := make([]map[string]string, 0, min(len(j.line), 10))
	for _, it := range j.line[:min(len(j.line), 10)] {
		next = append(next, map[string]string{"svc": it.Svc, "title": it.Title, "artist": it.Artist, "by": it.By})
	}
	msg["next"] = next
	key := fmt.Sprint(n.key, msg["votes"], msg["needed"], j.lineSeq, svcs)
	if key == j.nowSent && ack == nil {
		j.mu.Unlock()
		return
	}
	j.nowSent = key
	j.mu.Unlock()
	if err := j.publish(ctx, topic, msg); err != nil {
		j.app.log.Debugf("jam: now not sent: %v", err)
	}
}

// follow keeps the passengers' "now playing" current (only changes are sent)
func (j *jamService) follow(ctx context.Context, topic string) {
	t := time.NewTicker(4 * time.Second)
	defer t.Stop()
	for {
		select {
		case <-ctx.Done():
			return
		case <-t.C:
			j.mu.Lock()
			anyone := len(j.activeLocked()) > 0
			j.mu.Unlock()
			if anyone {
				j.sendNow(ctx, topic)
			}
		}
	}
}

// POST /jam/start, POST /jam/stop, GET /jam
func (s *ConcreteApiServer) registerJamRoutes(m *http.ServeMux, jam func() *jamService) {
	writeJSON := func(w http.ResponseWriter, v any) {
		w.Header().Set("Content-Type", "application/json")
		_ = json.NewEncoder(w).Encode(v)
	}
	get := func(w http.ResponseWriter) *jamService {
		j := jam()
		if j == nil {
			w.WriteHeader(http.StatusServiceUnavailable)
		}
		return j
	}
	m.HandleFunc("GET /jam", func(w http.ResponseWriter, r *http.Request) {
		if j := get(w); j != nil {
			writeJSON(w, j.State())
		}
	})
	m.HandleFunc("POST /jam/start", func(w http.ResponseWriter, r *http.Request) {
		if j := get(w); j != nil {
			writeJSON(w, j.Start())
		}
	})
	// the passengers' songs as a private Spotify playlist; 404 with none
	m.HandleFunc("POST /jam/save", func(w http.ResponseWriter, r *http.Request) {
		j := get(w)
		if j == nil {
			return
		}
		saved, err := j.Save(r.Context())
		switch {
		case errors.Is(err, ErrJamNothingToSave):
			w.WriteHeader(http.StatusNotFound)
		case err != nil:
			j.app.log.Warnf("jam: save: %v", err)
			w.WriteHeader(http.StatusBadGateway)
		default:
			writeJSON(w, saved)
		}
	})
	m.HandleFunc("POST /jam/forget", func(w http.ResponseWriter, r *http.Request) {
		if j := get(w); j != nil {
			j.Forget()
			w.WriteHeader(http.StatusNoContent)
		}
	})
	// {"on": bool}: Spotify's autoplay carries on from the passengers' songs, or not
	m.HandleFunc("POST /jam/steer", func(w http.ResponseWriter, r *http.Request) {
		var body struct {
			On bool `json:"on"`
		}
		if json.NewDecoder(io.LimitReader(r.Body, 1024)).Decode(&body) != nil {
			w.WriteHeader(http.StatusBadRequest)
			return
		}
		if j := get(w); j != nil {
			writeJSON(w, j.SetSteer(body.On))
		}
	})
	m.HandleFunc("POST /jam/stop", func(w http.ResponseWriter, r *http.Request) {
		if j := get(w); j != nil {
			j.Stop()
			w.WriteHeader(http.StatusNoContent)
		}
	})
}
