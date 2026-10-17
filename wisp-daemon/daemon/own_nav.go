package daemon

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"math"
	"net/http"
	"net/url"
	"os"
	"sort"
	"strings"
	"sync"
	"time"
)

// Wisp's own directions, worked out here instead of on the phone, from free,
// keyless OpenStreetMap services: places by name from Photon (komoot), places
// nearby by kind from Overpass, and routes, with alternatives, from OSRM's
// public server. The phone only sends where it is ("location", as it does for
// the map), so it needs nothing more than that.
//
// It fills the same NavState and route line Google Maps' directions do (plus
// the turn's shape and the one after), so the screens, "when do we get
// there", and add-ons work unchanged, and says turns through Wisp's voice as
// Settings → Navigation → Spoken directions allows. The services are used
// gently: a search when you ask, one route plan per trip, a new route at most
// every 30 s when you leave it.

const (
	ownNavUA           = "Wisp/1.0 (+https://github.com/picovrfbt/WispOS)"
	ownNavGeocodeURL   = "https://photon.komoot.io/api/"
	ownNavNearbyURL    = "https://overpass-api.de/api/interpreter"
	ownNavRouteURL     = "https://router.project-osrm.org/route/v1/driving/"
	ownNavOffRouteM    = 50.0
	ownNavRerouteEvery = 30 * time.Second
	ownNavArriveM      = 35.0
	ownNavNearbyM      = 8000
	ownNavMaxRecents   = 6
	ownNavPreviewPts   = 400
)

// ErrOwnNavNotFound: the search found nowhere by that name
var ErrOwnNavNotFound = errors.New("couldn't find that place")

// ErrOwnNavNoFix: no position from the phone yet
var ErrOwnNavNoFix = errors.New("no location from the phone")

var navRecentsPath = sysPath("/var/local/wisp/nav_recents.json", "/var/local/mira/nav_recents.json")

// NavPlace is somewhere to go: a search result, a recent place, the destination
type NavPlace struct {
	Name    string  `json:"name"`
	Address string  `json:"address,omitempty"`
	Lat     float64 `json:"lat"`
	Lng     float64 `json:"lng"`
	// from where the car is, for results
	DistanceM float64 `json:"distance_m,omitempty"`
	// "Open 24 hours", when the map says so
	Open string `json:"open,omitempty"`
}

// NavPlanRoute is one way there, for the route planner
type NavPlanRoute struct {
	DurationS float64      `json:"duration_s"`
	DistanceM float64      `json:"distance_m"`
	Via       string       `json:"via,omitempty"`
	Points    [][2]float64 `json:"points"`
}

type ownNavStep struct {
	text  string  // "Turn left onto Pine Ave"
	road  string  // "Pine Ave"
	kind  string  // "left", "slight-right", "roundabout", "arrive", …
	at    float64 // metres along the route where it happens
	said1 bool    // the heads-up
	said2 bool    // as it comes
}

type plannedRoute struct {
	pts      [][2]float64
	cum      []float64 // metres along the route at each point
	total    float64
	duration float64
	steps    []ownNavStep
	via      string
}

type ownNav struct {
	relay  *navRelay
	client *http.Client
	// overridable in tests
	geocodeURL, nearbyURL, routeURL string
	// Settings → Navigation → Spoken directions: "all", "turns" or "off"
	voice func() string

	mu       sync.Mutex
	active   bool
	dest     NavPlace
	avoid    []string
	r        plannedRoute
	next     int // the step coming up
	along    float64
	idx      int // the route point we're past
	off      int
	rerouted time.Time
	arrived  bool
	busy     bool
	// the last plan, waiting for Start
	plan     []plannedRoute
	planDest NavPlace
}

func newOwnNav(relay *navRelay) *ownNav {
	return &ownNav{
		relay: relay, client: &http.Client{Timeout: 12 * time.Second},
		geocodeURL: ownNavGeocodeURL, nearbyURL: ownNavNearbyURL, routeURL: ownNavRouteURL,
	}
}

// Active: Wisp is giving directions (the phone's are set aside meanwhile)
func (o *ownNav) Active() bool {
	o.mu.Lock()
	defer o.mu.Unlock()
	return o.active
}

func (o *ownNav) here() (*NavLocation, error) {
	loc := o.relay.Status().Location
	if loc == nil {
		return nil, ErrOwnNavNoFix
	}
	return loc, nil
}

// Start finds where and goes there the fastest way: "take me to …" by voice
func (o *ownNav) Start(ctx context.Context, where string) (string, error) {
	loc, err := o.here()
	if err != nil {
		return "", err
	}
	places, err := o.Search(ctx, where, "")
	if err != nil {
		return "", err
	}
	p := places[0]
	routes, err := o.fetchRoutes(ctx, loc.Lat, loc.Lng, p, nil, false)
	if err != nil {
		return "", err
	}
	o.begin(p, nil, routes[0])
	return p.Name, nil
}

// Plan works out up to three ways to p, for the route planner to show
func (o *ownNav) Plan(ctx context.Context, p NavPlace, avoid []string) ([]NavPlanRoute, error) {
	loc, err := o.here()
	if err != nil {
		return nil, err
	}
	routes, err := o.fetchRoutes(ctx, loc.Lat, loc.Lng, p, avoid, true)
	if err != nil {
		return nil, err
	}
	o.mu.Lock()
	o.plan, o.planDest, o.avoid = routes, p, avoid
	o.mu.Unlock()
	out := make([]NavPlanRoute, len(routes))
	for i, r := range routes {
		out[i] = NavPlanRoute{DurationS: r.duration, DistanceM: r.total, Via: r.via, Points: thinRoute(r.pts, ownNavPreviewPts)}
	}
	return out, nil
}

// StartPlanned starts the planned route i with Wisp, or hands the destination
// to Google Maps on the phone
func (o *ownNav) StartPlanned(ctx context.Context, i int, google bool) error {
	o.mu.Lock()
	if i < 0 || i >= len(o.plan) {
		o.mu.Unlock()
		return errors.New("no such route; plan it again")
	}
	r, p, avoid := o.plan[i], o.planDest, o.avoid
	o.mu.Unlock()
	if google {
		o.Stop()
		o.remember(p)
		return o.relay.Navigate(ctx, fmt.Sprintf("%.6f,%.6f", p.Lat, p.Lng))
	}
	o.begin(p, avoid, r)
	return nil
}

func (o *ownNav) begin(p NavPlace, avoid []string, r plannedRoute) {
	o.mu.Lock()
	o.active, o.arrived = true, false
	o.dest, o.avoid, o.r = p, avoid, r
	o.next, o.along, o.idx, o.off = 0, 0, 0, 0
	o.rerouted = time.Now()
	o.mu.Unlock()
	o.remember(p)
	o.relay.setRoute("full", r.pts)
	o.publish()
}

// Stop ends the directions and clears them from the screen
func (o *ownNav) Stop() {
	o.mu.Lock()
	was := o.active
	o.active = false
	o.mu.Unlock()
	if !was {
		return
	}
	o.relay.update(func(s *NavState) { clearTurn(s) })
	o.relay.setRoute("", nil)
}

func clearTurn(s *NavState) {
	s.Active, s.Title, s.Text, s.SubText, s.Icon = false, "", "", "", ""
	s.Own, s.Maneuver, s.Then, s.ThenManeuver = false, "", "", ""
}

// ---------------------------------------------------------------- finding places

func (o *ownNav) get(ctx context.Context, method, u string, body io.Reader, v any) error {
	req, err := http.NewRequestWithContext(ctx, method, u, body)
	if err != nil {
		return err
	}
	req.Header.Set("User-Agent", ownNavUA)
	if body != nil {
		req.Header.Set("Content-Type", "application/x-www-form-urlencoded")
	}
	resp, err := o.client.Do(req)
	if err != nil {
		return err
	}
	defer func() { _ = resp.Body.Close() }()
	if resp.StatusCode != http.StatusOK {
		return fmt.Errorf("%s answered %s", req.URL.Host, resp.Status)
	}
	return json.NewDecoder(io.LimitReader(resp.Body, 4<<20)).Decode(v)
}

// the kinds of place "Where to?" offers, as OpenStreetMap tags them
var navCategories = map[string]struct{ query, label string }{
	"gas":       {`nwr["amenity"="fuel"]`, "Gas station"},
	"food":      {`nwr["amenity"~"^(restaurant|fast_food)$"]`, "Restaurant"},
	"coffee":    {`nwr["amenity"="cafe"]`, "Café"},
	"parking":   {`nwr["amenity"="parking"]["access"!~"^(private|customers)$"]`, "Parking"},
	"charging":  {`nwr["amenity"="charging_station"]`, "EV charging"},
	"groceries": {`nwr["shop"~"^(supermarket|greengrocer)$"]`, "Grocery store"},
}

// Search: places called q, or of the kind cat, nearest first
func (o *ownNav) Search(ctx context.Context, q, cat string) ([]NavPlace, error) {
	loc, err := o.here()
	if err != nil {
		return nil, err
	}
	var out []NavPlace
	if cat != "" {
		out, err = o.nearby(ctx, cat, loc.Lat, loc.Lng)
	} else {
		out, err = o.geocode(ctx, q, loc.Lat, loc.Lng)
	}
	if err != nil {
		return nil, err
	}
	if len(out) == 0 {
		return nil, ErrOwnNavNotFound
	}
	return out, nil
}

func (o *ownNav) geocode(ctx context.Context, q string, lat, lng float64) ([]NavPlace, error) {
	v := url.Values{"q": {q}, "limit": {"6"}, "lat": {fmt.Sprintf("%.4f", lat)}, "lon": {fmt.Sprintf("%.4f", lng)}, "lang": {"en"}}
	var doc struct {
		Features []struct {
			Geometry struct {
				Coordinates [2]float64 `json:"coordinates"`
			} `json:"geometry"`
			Properties map[string]any `json:"properties"`
		} `json:"features"`
	}
	if err := o.get(ctx, http.MethodGet, o.geocodeURL+"?"+v.Encode(), nil, &doc); err != nil {
		return nil, err
	}
	here := [2]float64{lat, lng}
	var out []NavPlace
	for _, f := range doc.Features {
		p := func(k string) string { s, _ := f.Properties[k].(string); return s }
		la, ln := f.Geometry.Coordinates[1], f.Geometry.Coordinates[0]
		if !validFix(la, ln) {
			continue
		}
		street := strings.TrimSpace(p("housenumber") + " " + p("street"))
		name := p("name")
		if name == "" {
			name = street
		}
		if name == "" {
			name = q
		}
		addr := street
		if c := p("city"); c != "" && !strings.EqualFold(c, name) {
			addr = strings.Trim(addr+" · "+c, " ·")
		}
		if strings.EqualFold(addr, name) {
			addr = ""
		}
		out = append(out, NavPlace{Name: name, Address: addr, Lat: la, Lng: ln, DistanceM: metres(here, [2]float64{la, ln})})
	}
	return out, nil
}

func (o *ownNav) nearby(ctx context.Context, cat string, lat, lng float64) ([]NavPlace, error) {
	c, ok := navCategories[cat]
	if !ok {
		return nil, fmt.Errorf("no kind of place called %q", cat)
	}
	q := fmt.Sprintf("[out:json][timeout:10];%s(around:%d,%.5f,%.5f);out center 40;", c.query, ownNavNearbyM, lat, lng)
	var doc struct {
		Elements []struct {
			Lat    float64                     `json:"lat"`
			Lon    float64                     `json:"lon"`
			Center *struct{ Lat, Lon float64 } `json:"center"`
			Tags   map[string]string           `json:"tags"`
		} `json:"elements"`
	}
	if err := o.get(ctx, http.MethodPost, o.nearbyURL, strings.NewReader(url.Values{"data": {q}}.Encode()), &doc); err != nil {
		return nil, err
	}
	here := [2]float64{lat, lng}
	var out []NavPlace
	for _, e := range doc.Elements {
		la, ln := e.Lat, e.Lon
		if e.Center != nil {
			la, ln = e.Center.Lat, e.Center.Lon
		}
		if !validFix(la, ln) {
			continue
		}
		t := e.Tags
		name := firstOf(t["name"], t["brand"], t["operator"], c.label)
		addr := strings.TrimSpace(t["addr:housenumber"] + " " + t["addr:street"])
		p := NavPlace{Name: name, Address: addr, Lat: la, Lng: ln, DistanceM: metres(here, [2]float64{la, ln})}
		if t["opening_hours"] == "24/7" {
			p.Open = "Open 24 hours"
		}
		out = append(out, p)
	}
	sort.Slice(out, func(i, j int) bool { return out[i].DistanceM < out[j].DistanceM })
	if len(out) > 8 {
		out = out[:8]
	}
	return out, nil
}

func firstOf(s ...string) string {
	for _, x := range s {
		if x = strings.TrimSpace(x); x != "" {
			return x
		}
	}
	return ""
}

// ---------------------------------------------------------------- recent places

// Recents: where Wisp has taken you lately, newest first
func (o *ownNav) Recents() []NavPlace {
	b, err := os.ReadFile(navRecentsPath)
	if err != nil {
		return []NavPlace{}
	}
	var out []NavPlace
	if json.Unmarshal(b, &out) != nil {
		return []NavPlace{}
	}
	if loc := o.relay.Status().Location; loc != nil {
		for i := range out {
			out[i].DistanceM = metres([2]float64{loc.Lat, loc.Lng}, [2]float64{out[i].Lat, out[i].Lng})
		}
	}
	return out
}

func (o *ownNav) remember(p NavPlace) {
	list := o.Recents()
	keep := []NavPlace{{Name: p.Name, Address: p.Address, Lat: p.Lat, Lng: p.Lng}}
	for _, r := range list {
		if metres([2]float64{r.Lat, r.Lng}, [2]float64{p.Lat, p.Lng}) < 50 {
			continue
		}
		r.DistanceM = 0
		keep = append(keep, r)
		if len(keep) == ownNavMaxRecents {
			break
		}
	}
	if b, err := json.Marshal(keep); err == nil {
		_ = os.WriteFile(navRecentsPath, b, 0o644)
	}
}

// ---------------------------------------------------------------- routes

type osrmStep struct {
	Name     string  `json:"name"`
	Ref      string  `json:"ref"`
	Distance float64 `json:"distance"`
	Maneuver struct {
		Type     string     `json:"type"`
		Modifier string     `json:"modifier"`
		Exit     int        `json:"exit"`
		Location [2]float64 `json:"location"`
	} `json:"maneuver"`
}

func (o *ownNav) fetchRoutes(ctx context.Context, fromLat, fromLng float64, to NavPlace, avoid []string, alternatives bool) ([]plannedRoute, error) {
	u := fmt.Sprintf("%s%.6f,%.6f;%.6f,%.6f?overview=full&geometries=geojson&steps=true", o.routeURL, fromLng, fromLat, to.Lng, to.Lat)
	if alternatives {
		u += "&alternatives=2"
	}
	if len(avoid) > 0 {
		u += "&exclude=" + strings.Join(avoid, ",")
	}
	var doc struct {
		Code   string `json:"code"`
		Routes []struct {
			Distance float64 `json:"distance"`
			Duration float64 `json:"duration"`
			Geometry struct {
				Coordinates [][2]float64 `json:"coordinates"`
			} `json:"geometry"`
			Legs []struct {
				Summary string     `json:"summary"`
				Steps   []osrmStep `json:"steps"`
			} `json:"legs"`
		} `json:"routes"`
	}
	if err := o.get(ctx, http.MethodGet, u, nil, &doc); err != nil {
		return nil, err
	}
	var out []plannedRoute
	for _, r := range doc.Routes {
		if len(r.Geometry.Coordinates) < 2 {
			continue
		}
		pts := make([][2]float64, 0, len(r.Geometry.Coordinates))
		for _, c := range r.Geometry.Coordinates {
			pts = append(pts, [2]float64{c[1], c[0]})
		}
		pts = thinRoute(pts, navMaxRoutePoints)
		cum := make([]float64, len(pts))
		for i := 1; i < len(pts); i++ {
			cum[i] = cum[i-1] + metres(pts[i-1], pts[i])
		}
		pr := plannedRoute{pts: pts, cum: cum, total: cum[len(cum)-1], duration: r.Duration}
		byRoad := map[string]float64{}
		if len(r.Legs) > 0 {
			for _, s := range r.Legs[0].Steps {
				road := firstOf(s.Name, s.Ref)
				if road != "" {
					byRoad[road] += s.Distance
				}
				if s.Maneuver.Type == "depart" {
					continue
				}
				at := cum[nearestPoint(pts, [2]float64{s.Maneuver.Location[1], s.Maneuver.Location[0]})]
				pr.steps = append(pr.steps, ownNavStep{text: stepText(s, to.Name), road: road, kind: stepKind(s), at: at})
			}
		}
		// "via" the road it spends longest on
		best := 0.0
		for road, d := range byRoad {
			if d > best || (d == best && road < pr.via) {
				best, pr.via = d, road
			}
		}
		out = append(out, pr)
	}
	if doc.Code != "Ok" || len(out) == 0 {
		return nil, errors.New("no way there by road")
	}
	return out, nil
}

// ---------------------------------------------------------------- following

// onFix follows a new position from the phone along the route
func (o *ownNav) onFix(loc NavLocation) {
	o.mu.Lock()
	r := &o.r
	if !o.active || len(r.pts) < 2 {
		o.mu.Unlock()
		return
	}
	here := [2]float64{loc.Lat, loc.Lng}
	// the nearest part of the route, looking ahead of where we were
	best, bestD, bestAlong := o.idx, math.Inf(1), o.along
	end := min(len(r.pts)-1, o.idx+400)
	for i := max(0, o.idx-5); i < end; i++ {
		p, t := projectOnto(r.pts[i], r.pts[i+1], here)
		if d := metres(here, p); d < bestD {
			best, bestD, bestAlong = i, d, r.cum[i]+t*(r.cum[i+1]-r.cum[i])
		}
	}
	o.idx, o.along = best, bestAlong
	for o.next < len(r.steps) && r.steps[o.next].at <= o.along+5 {
		o.next++
	}
	// off the route for a few fixes in a row (allowing for the GPS's error): a new way
	if bestD > ownNavOffRouteM+loc.Accuracy && loc.Speed > 1 {
		o.off++
	} else {
		o.off = 0
	}
	reroute := o.off >= 3 && time.Since(o.rerouted) > ownNavRerouteEvery && !o.busy
	if reroute {
		o.busy = true
	}
	arrived := !o.arrived && (r.total-o.along < ownNavArriveM || metres(here, [2]float64{o.dest.Lat, o.dest.Lng}) < ownNavArriveM)
	if arrived {
		o.arrived = true
	}
	var say, sayKind string
	if !arrived && o.next < len(r.steps) {
		s := &r.steps[o.next]
		left := s.at - o.along
		soon := math.Max(45, loc.Speed*9) // about 9 seconds out
		switch {
		case !s.said2 && left <= soon:
			s.said1, s.said2 = true, true
			say, sayKind = s.text, "turn"
		case !s.said1 && left <= math.Max(300, math.Min(1300, loc.Speed*45)) && left > soon*1.5:
			// a heads-up about 45 seconds out
			s.said1 = true
			say, sayKind = "In "+spokenDistance(left)+", "+lowerFirst(s.text), "heads"
		}
	}
	dest, avoid := o.dest, o.avoid
	o.mu.Unlock()

	if arrived {
		o.say("You've arrived at "+dest.Name, "turn")
		o.relay.update(func(s *NavState) {
			clearTurn(s)
			s.Active, s.Own, s.Title, s.Text, s.Maneuver = true, true, "Arrived", dest.Name, "arrive"
		})
		time.AfterFunc(20*time.Second, o.Stop)
		return
	}
	if say != "" {
		o.say(say, sayKind)
	}
	o.publish()
	if reroute {
		go func() {
			ctx, cancel := context.WithTimeout(context.Background(), 15*time.Second)
			defer cancel()
			routes, err := o.fetchRoutes(ctx, loc.Lat, loc.Lng, dest, avoid, false)
			o.mu.Lock()
			o.busy = false
			o.rerouted = time.Now()
			still := o.active && o.dest == dest
			if err == nil && still {
				o.r = routes[0]
				o.next, o.along, o.idx, o.off = 0, 0, 0, 0
			}
			o.mu.Unlock()
			if err != nil {
				o.relay.log.Warnf("nav: new route failed: %v", err)
				return
			}
			if still {
				o.relay.setRoute("full", routes[0].pts)
				o.say("Finding a new route", "heads")
				o.publish()
			}
		}()
	}
}

// publish puts the next turn, the one after and the time left on the screen
func (o *ownNav) publish() {
	o.mu.Lock()
	if !o.active || o.arrived {
		o.mu.Unlock()
		return
	}
	r := &o.r
	title, text, kind, then, thenKind := "", "Continue to "+o.dest.Name, "straight", "", ""
	if o.next < len(r.steps) {
		s := r.steps[o.next]
		title, text, kind = distanceWords(s.at-o.along), s.text, s.kind
		if o.next+1 < len(r.steps) {
			n := r.steps[o.next+1]
			then, thenKind = firstOf(n.road, n.text), n.kind
			if n.kind == "arrive" {
				then = o.dest.Name
			}
		}
	} else {
		title = distanceWords(r.total - o.along)
	}
	left := math.Max(0, r.total-o.along)
	secs := 0.0
	if r.total > 0 {
		secs = r.duration * left / r.total
	}
	o.mu.Unlock()
	st := o.relay.Status()
	off := 0
	if st.TzOffsetMin != nil {
		off = *st.TzOffsetMin
	}
	eta := time.Now().UTC().Add(time.Duration(secs)*time.Second + time.Duration(off)*time.Minute)
	sub := fmt.Sprintf("%s · %s · %s", minutesWords(secs), milesWords(left), eta.Format("3:04 PM"))
	o.relay.update(func(s *NavState) {
		s.Active, s.Title, s.Text, s.SubText, s.Icon = true, title, text, sub, ""
		s.Own, s.Maneuver, s.Then, s.ThenManeuver = true, kind, then, thenKind
	})
}

// say speaks through Wisp's voice, as Settings → Navigation → Spoken directions allows:
// "all" (heads-ups and turns), "turns" (only as each comes), "off"
func (o *ownNav) say(text, kind string) {
	mode := "all"
	if o.voice != nil {
		mode = o.voice()
	}
	if mode == "off" || (mode == "turns" && kind != "turn") || o.relay.emit == nil {
		return
	}
	o.relay.emit(&ApiEvent{Type: ApiEventTypeVoice, Data: ApiEventDataVoice{State: "answer", Text: text}})
}

// ownNavFromSettings: Settings → Navigation → Directions by: Wisp
func ownNavFromSettings(body []byte) bool {
	var s struct {
		NavEngine string `json:"navEngine"`
	}
	return json.Unmarshal(body, &s) == nil && s.NavEngine == "wisp"
}

// navVoiceFromSettings: Settings → Navigation → Spoken directions
func navVoiceFromSettings(body []byte) string {
	var s struct {
		NavVoice string `json:"navVoice"`
	}
	if json.Unmarshal(body, &s) == nil && (s.NavVoice == "turns" || s.NavVoice == "off") {
		return s.NavVoice
	}
	return "all"
}

// ---------------------------------------------------------------- words

// stepKind: the turn's shape, for its arrow
func stepKind(s osrmStep) string {
	mod := s.Maneuver.Modifier
	side := strings.TrimPrefix(strings.TrimPrefix(mod, "slight "), "sharp ")
	switch s.Maneuver.Type {
	case "arrive":
		return "arrive"
	case "roundabout", "rotary", "roundabout turn", "exit roundabout", "exit rotary":
		return "roundabout"
	case "merge", "new name", "continue", "notification":
		if mod == "uturn" {
			return "uturn"
		}
		if strings.HasPrefix(mod, "slight") || mod == "left" || mod == "right" {
			return "slight-" + side
		}
		return "straight"
	case "on ramp", "off ramp", "fork":
		if side == "left" || side == "right" {
			return "slight-" + side
		}
		return "straight"
	}
	switch {
	case mod == "uturn":
		return "uturn"
	case mod == "straight" || mod == "":
		return "straight"
	case strings.HasPrefix(mod, "slight"):
		return "slight-" + side
	case strings.HasPrefix(mod, "sharp"):
		return "sharp-" + side
	}
	return side
}

// stepText: an OSRM step in words, "Turn left onto Pine Ave"
func stepText(s osrmStep, dest string) string {
	road := s.Name
	if road == "" {
		road = s.Ref
	}
	onto := ""
	if road != "" {
		onto = " onto " + road
	}
	mod := s.Maneuver.Modifier
	side := strings.TrimPrefix(strings.TrimPrefix(mod, "slight "), "sharp ")
	switch s.Maneuver.Type {
	case "arrive":
		return "Arrive at " + dest
	case "turn", "end of road":
		switch {
		case mod == "uturn":
			return "Make a U-turn"
		case mod == "straight":
			return "Continue straight" + onto
		case strings.HasPrefix(mod, "slight"):
			return "Bear " + side + onto
		case strings.HasPrefix(mod, "sharp"):
			return "Turn sharp " + side + onto
		}
		return "Turn " + mod + onto
	case "merge":
		return "Merge" + onto
	case "on ramp":
		return "Take the ramp" + onto
	case "off ramp":
		if side == "left" || side == "right" {
			return "Take the exit on the " + side + onto
		}
		return "Take the exit" + onto
	case "fork":
		if side == "left" || side == "right" {
			return "Keep " + side + onto
		}
		return "Keep going" + onto
	case "roundabout", "rotary":
		if s.Maneuver.Exit > 0 {
			return fmt.Sprintf("At the roundabout, take the %s exit%s", ordinal(s.Maneuver.Exit), onto)
		}
		return "Go through the roundabout" + onto
	case "new name", "continue":
		if mod == "uturn" {
			return "Make a U-turn"
		}
		if side == "left" || side == "right" {
			return "Keep " + side + onto
		}
		return "Continue" + onto
	}
	if side == "left" || side == "right" {
		return "Turn " + side + onto
	}
	return "Continue" + onto
}

func ordinal(n int) string {
	switch n {
	case 1:
		return "first"
	case 2:
		return "second"
	case 3:
		return "third"
	case 4:
		return "fourth"
	case 5:
		return "fifth"
	}
	return fmt.Sprintf("%dth", n)
}

// distanceWords: "600 ft", "0.3 mi", "12 mi"
func distanceWords(m float64) string {
	if m < 0 {
		m = 0
	}
	ft := m * 3.28084
	if ft < 1000 {
		return fmt.Sprintf("%d ft", int(math.Round(ft/50))*50)
	}
	return milesWords(m)
}

// spokenDistance: how far, the way it's said: "650 feet", "a quarter mile", "half a mile", "2 miles"
func spokenDistance(m float64) string {
	ft := m * 3.28084
	mi := m / 1609.344
	switch {
	case ft < 1000:
		return fmt.Sprintf("%d feet", int(math.Round(ft/50))*50)
	case mi < 0.35:
		return "a quarter mile"
	case mi < 0.75:
		return "half a mile"
	case mi < 1.5:
		return "1 mile"
	}
	return fmt.Sprintf("%d miles", int(math.Round(mi)))
}

func milesWords(m float64) string {
	mi := m / 1609.344
	if mi < 10 {
		return fmt.Sprintf("%.1f mi", mi)
	}
	return fmt.Sprintf("%d mi", int(math.Round(mi)))
}

func minutesWords(secs float64) string {
	mins := int(math.Round(secs / 60))
	if mins < 60 {
		return fmt.Sprintf("%d min", max(1, mins))
	}
	return fmt.Sprintf("%d hr %d min", mins/60, mins%60)
}

// ---------------------------------------------------------------- geometry

// metres between two [lat, lng]s (an equirectangular approximation: fine at road scale)
func metres(a, b [2]float64) float64 {
	const r = 6371000.0
	lat := (a[0] + b[0]) / 2 * math.Pi / 180
	dx := (b[1] - a[1]) * math.Pi / 180 * math.Cos(lat)
	dy := (b[0] - a[0]) * math.Pi / 180
	return r * math.Hypot(dx, dy)
}

// projectOnto: the nearest point to p on segment ab, and how far along it (0..1)
func projectOnto(a, b, p [2]float64) ([2]float64, float64) {
	k := math.Cos((a[0] + b[0]) / 2 * math.Pi / 180)
	ax, ay, bx, by, px, py := a[1]*k, a[0], b[1]*k, b[0], p[1]*k, p[0]
	dx, dy := bx-ax, by-ay
	l := dx*dx + dy*dy
	t := 0.0
	if l > 0 {
		t = math.Max(0, math.Min(1, ((px-ax)*dx+(py-ay)*dy)/l))
	}
	return [2]float64{a[0] + t*(b[0]-a[0]), a[1] + t*(b[1]-a[1])}, t
}

func nearestPoint(pts [][2]float64, p [2]float64) int {
	best, bestD := 0, math.Inf(1)
	for i, q := range pts {
		if d := metres(p, q); d < bestD {
			best, bestD = i, d
		}
	}
	return best
}

// thinRoute keeps at most n points, always the first and last
func thinRoute(pts [][2]float64, n int) [][2]float64 {
	if len(pts) <= n {
		return pts
	}
	out := make([][2]float64, 0, n)
	step := float64(len(pts)-1) / float64(n-1)
	for i := 0; i < n; i++ {
		out = append(out, pts[int(math.Round(float64(i)*step))])
	}
	return out
}
