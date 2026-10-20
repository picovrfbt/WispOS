package daemon

import (
	"encoding/json"
	"io"
	"net/http"
	"net/http/httptest"
	"path/filepath"
	"strings"
	"sync"
	"testing"

	librespot "github.com/devgianlu/go-librespot"
)

func TestStepText(t *testing.T) {
	step := func(typ, mod, name string, exit int) osrmStep {
		var s osrmStep
		s.Maneuver.Type, s.Maneuver.Modifier, s.Name, s.Maneuver.Exit = typ, mod, name, exit
		return s
	}
	for _, c := range []struct {
		s    osrmStep
		want string
	}{
		{step("turn", "left", "Pine Ave", 0), "Turn left onto Pine Ave"},
		{step("turn", "slight right", "Ocean Blvd", 0), "Bear right onto Ocean Blvd"},
		{step("turn", "uturn", "", 0), "Make a U-turn"},
		{step("off ramp", "right", "Exit 12", 0), "Take the exit on the right onto Exit 12"},
		{step("roundabout", "", "Main St", 2), "At the roundabout, take the second exit onto Main St"},
		{step("arrive", "", "", 0), "Arrive at the beach"},
		{step("new name", "straight", "PCH", 0), "Continue onto PCH"},
	} {
		if got := stepText(c.s, "the beach"); got != c.want {
			t.Errorf("%+v: %q, want %q", c.s.Maneuver, got, c.want)
		}
	}
	if distanceWords(180) != "600 ft" || distanceWords(1609.344*2.3) != "2.3 mi" || spokenDistance(560) != "a quarter mile" || spokenDistance(150) != "500 feet" || minutesWords(3700) != "1 hr 2 min" {
		t.Error("words")
	}
}

// a straight road north, a left turn after 1 km, then 500 m west to the end
func TestOwnNavTrip(t *testing.T) {
	old := navRecentsPath
	navRecentsPath = filepath.Join(t.TempDir(), "recents.json")
	defer func() { navRecentsPath = old }()
	var routes int
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.Header.Get("User-Agent") == "" {
			t.Error("no User-Agent")
		}
		if strings.HasPrefix(r.URL.Path, "/geo") {
			_, _ = w.Write([]byte(`{"features":[{"geometry":{"coordinates":[-0.0045,0.009]},"properties":{"name":"The Beach","city":"Long Beach"}}]}`))
			return
		}
		routes++
		_, _ = w.Write([]byte(`{"code":"Ok","routes":[{"distance":1500,"duration":120,
			"geometry":{"coordinates":[[0,0],[0,0.009],[-0.0045,0.009]]},
			"legs":[{"steps":[
				{"name":"North St","maneuver":{"type":"depart","location":[0,0]}},
				{"name":"West Ave","maneuver":{"type":"turn","modifier":"left","location":[0,0.009]}},
				{"name":"","maneuver":{"type":"arrive","location":[-0.0045,0.009]}}]}]}]}`))
	}))
	defer srv.Close()

	var mu sync.Mutex
	var said []string
	var n *navRelay
	n = newNavRelay(NavConfig{}, &librespot.NullLogger{}, func(e *ApiEvent) {
		if e.Type == ApiEventTypeVoice {
			mu.Lock()
			said = append(said, e.Data.(ApiEventDataVoice).Text)
			mu.Unlock()
		}
	}, nil)
	n.own.geocodeURL, n.own.routeURL = srv.URL+"/geo", srv.URL+"/route/"
	n.own.voice = func() string { return "all" }
	n.apply(navMessage{Type: "location", Lat: 0.00001, Lng: 0.00001, Speed: 15})

	name, err := n.own.Start(t.Context(), "the beach")
	if err != nil || name != "The Beach" {
		t.Fatalf("start: %q %v", name, err)
	}
	st := n.Status()
	if !st.Active || st.Text != "Turn left onto West Ave" || !strings.HasPrefix(st.Title, "0.6 mi") || n.Route().Kind != "full" {
		t.Fatalf("first turn: %+v", st)
	}
	// the phone's own (Google Maps) directions don't trample Wisp's meanwhile
	n.apply(navMessage{Type: "nav", Active: true, Title: "x", Text: "google"})
	if n.Status().Text == "google" {
		t.Fatal("the phone's directions replaced Wisp's")
	}
	// driving north: 200 m before the turn it's announced, then said as it comes
	for _, lat := range []float64{0.004, 0.0072, 0.0086} {
		n.apply(navMessage{Type: "location", Lat: lat, Lng: 0, Speed: 15})
	}
	mu.Lock()
	got := strings.Join(said, " | ")
	mu.Unlock()
	if !strings.Contains(got, "In a quarter mile, turn left onto West Ave") || !strings.Contains(got, "| Turn left onto West Ave") {
		t.Fatalf("spoken: %s", got)
	}
	// past the turn: the arrival is next
	n.apply(navMessage{Type: "location", Lat: 0.009, Lng: -0.001, Speed: 15})
	if s := n.Status(); s.Text != "Arrive at The Beach" {
		t.Fatalf("after the turn: %+v", s)
	}
	// there
	n.apply(navMessage{Type: "location", Lat: 0.009, Lng: -0.0045, Speed: 2})
	if s := n.Status(); s.Title != "Arrived" {
		t.Fatalf("arrival: %+v", s)
	}
	n.own.Stop()
	if n.Status().Active || n.own.Active() || n.Route().Kind != "" {
		t.Fatal("stop should clear it")
	}
	if routes != 1 {
		t.Fatalf("%d routes asked for; one trip is one", routes)
	}
	if rec := n.own.Recents(); len(rec) != 1 || rec[0].Name != "The Beach" {
		t.Fatalf("recents: %+v", rec)
	}
}

func TestOwnNavSetting(t *testing.T) {
	if !ownNavFromSettings([]byte(`{"navEngine":"wisp"}`)) || ownNavFromSettings([]byte(`{}`)) || ownNavFromSettings(nil) {
		t.Fatal("setting")
	}
	u, ok := understand("stop navigation")
	if !ok || u.what != doNavStop {
		t.Fatal("stop navigation")
	}
	_ = json.Valid
}

func TestOwnNavPlanAndNearby(t *testing.T) {
	old := navRecentsPath
	navRecentsPath = filepath.Join(t.TempDir(), "recents.json")
	defer func() { navRecentsPath = old }()
	var lastRoute string
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if strings.HasPrefix(r.URL.Path, "/overpass") {
			b, _ := io.ReadAll(r.Body)
			if !strings.Contains(string(b), "fuel") {
				t.Errorf("overpass query: %s", b)
			}
			_, _ = w.Write([]byte(`{"elements":[
				{"lat":0.02,"lon":0,"tags":{"name":"Far Gas"}},
				{"type":"way","center":{"lat":0.003,"lon":0},"tags":{"brand":"Shell","addr:street":"Atlantic Ave","addr:housenumber":"700","opening_hours":"24/7"}}]}`))
			return
		}
		lastRoute = r.URL.RawQuery
		_, _ = w.Write([]byte(`{"code":"Ok","routes":[
			{"distance":1000,"duration":120,"geometry":{"coordinates":[[0,0],[0,0.009]]},"legs":[{"steps":[{"name":"Ocean Blvd","distance":1000,"maneuver":{"type":"depart","location":[0,0]}},{"name":"","maneuver":{"type":"arrive","location":[0,0.009]}}]}]},
			{"distance":1400,"duration":180,"geometry":{"coordinates":[[0,0],[0.002,0.005],[0,0.009]]},"legs":[{"steps":[{"name":"Pine Ave","distance":1400,"maneuver":{"type":"depart","location":[0,0]}},{"name":"","maneuver":{"type":"arrive","location":[0,0.009]}}]}]}]}`))
	}))
	defer srv.Close()
	n := newNavRelay(NavConfig{}, &librespot.NullLogger{}, nil, nil)
	n.own.nearbyURL, n.own.routeURL = srv.URL+"/overpass", srv.URL+"/route/"
	if _, err := n.own.Search(t.Context(), "", "gas"); err != ErrOwnNavNoFix {
		t.Fatalf("no fix: %v", err)
	}
	n.apply(navMessage{Type: "location", Lat: 0.00001, Lng: 0.00001})
	places, err := n.own.Search(t.Context(), "", "gas")
	if err != nil || len(places) != 2 || places[0].Name != "Shell" || places[0].Open != "Open 24 hours" || places[0].Address != "700 Atlantic Ave" {
		t.Fatalf("nearest first: %+v %v", places, err)
	}
	routes, err := n.own.Plan(t.Context(), places[0], []string{"motorway", "toll"})
	if err != nil || len(routes) != 2 || routes[0].Via != "Ocean Blvd" || routes[1].Via != "Pine Ave" {
		t.Fatalf("plan: %+v %v", routes, err)
	}
	if !strings.Contains(lastRoute, "alternatives=2") || !strings.Contains(lastRoute, "exclude=motorway,toll") {
		t.Fatalf("route query: %s", lastRoute)
	}
	// the second route, with Wisp
	if err := n.own.StartPlanned(t.Context(), 1, false); err != nil || !n.own.Active() || len(n.Route().Points) != 3 {
		t.Fatalf("start: %v", err)
	}
	if s := n.Status(); !s.Own || s.Maneuver != "arrive" {
		t.Fatalf("state: %+v", s)
	}
	// to Google Maps: needs the phone, and ends Wisp's own
	if err := n.own.StartPlanned(t.Context(), 0, true); err != ErrNoNavPhone || n.own.Active() {
		t.Fatalf("google without a phone: %v", err)
	}
	if err := n.own.StartPlanned(t.Context(), 7, false); err == nil {
		t.Fatal("no such route")
	}
}

func TestOwnNavVoiceModes(t *testing.T) {
	var said []string
	n := newNavRelay(NavConfig{}, &librespot.NullLogger{}, func(e *ApiEvent) {
		if e.Type == ApiEventTypeVoice {
			said = append(said, e.Data.(ApiEventDataVoice).Text)
		}
	}, nil)
	for _, c := range []struct {
		mode string
		want int
	}{{"all", 2}, {"turns", 1}, {"off", 0}} {
		said = nil
		m := c.mode
		n.own.voice = func() string { return m }
		n.own.say("In half a mile, turn left", "heads")
		n.own.say("Turn left", "turn")
		if len(said) != c.want {
			t.Errorf("%s: said %v", c.mode, said)
		}
	}
	if navVoiceFromSettings([]byte(`{"navVoice":"turns"}`)) != "turns" || navVoiceFromSettings(nil) != "all" {
		t.Error("setting")
	}
}

// an address typed in the Wisp app opens Where to? on it; blank ones don't
func TestNavFind(t *testing.T) {
	var got []NavFind
	n := newNavRelay(NavConfig{}, &librespot.NullLogger{}, func(e *ApiEvent) {
		if e.Type == ApiEventTypeNavFind {
			got = append(got, e.Data.(NavFind))
		}
	}, nil)
	n.find(NavFind{Query: "  12 Oak Street  "})
	n.find(NavFind{Query: "   "})
	n.find(NavFind{Query: strings.Repeat("a", 300)})
	if len(got) != 2 || got[0].Query != "12 Oak Street" || len([]rune(got[1].Query)) != 120 {
		t.Fatalf("finds: %+v", got)
	}
	b, _ := json.Marshal(got[0])
	if string(b) != `{"q":"12 Oak Street"}` {
		t.Fatalf("json: %s", b)
	}
}
