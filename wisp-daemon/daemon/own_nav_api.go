package daemon

import (
	"encoding/json"
	"errors"
	"io"
	"net/http"
	"strings"
)

// The route planner's side of Wisp's own directions (own_nav.go):
//
//	GET  /nav/search?q=…  or  ?cat=gas|food|coffee|parking|charging|groceries
//	GET  /nav/recents
//	POST /nav/plan   {name, address, lat, lng, avoid_highways, avoid_tolls} → {routes}
//	POST /nav/start  {route, google}   the planned route with Wisp, or to Google Maps
//	POST /nav/stop
//
// 503 without the phone's position, 404 for nothing found, 502 when a map
// service didn't answer.
func (s *ConcreteApiServer) registerOwnNavRoutes(m *http.ServeMux, handler func() NavHandler) {
	own := func(w http.ResponseWriter) *ownNav {
		if n, ok := handler().(*navRelay); ok && n != nil && n.own != nil {
			return n.own
		}
		w.WriteHeader(http.StatusServiceUnavailable)
		return nil
	}
	fail := func(w http.ResponseWriter, err error) {
		code := http.StatusBadGateway
		switch {
		case errors.Is(err, ErrOwnNavNoFix), errors.Is(err, ErrNoNavPhone):
			code = http.StatusServiceUnavailable
		case errors.Is(err, ErrOwnNavNotFound):
			code = http.StatusNotFound
		}
		w.Header().Set("Content-Type", "application/json")
		w.WriteHeader(code)
		_ = json.NewEncoder(w).Encode(map[string]string{"error": err.Error()})
	}
	writeJSON := func(w http.ResponseWriter, v any) {
		w.Header().Set("Content-Type", "application/json")
		_ = json.NewEncoder(w).Encode(v)
	}
	m.HandleFunc("GET /nav/search", func(w http.ResponseWriter, r *http.Request) {
		o := own(w)
		if o == nil {
			return
		}
		q, cat := strings.TrimSpace(r.URL.Query().Get("q")), r.URL.Query().Get("cat")
		if q == "" && cat == "" || len(q) > 120 {
			w.WriteHeader(http.StatusBadRequest)
			return
		}
		places, err := o.Search(r.Context(), q, cat)
		if err != nil {
			fail(w, err)
			return
		}
		writeJSON(w, map[string]any{"places": places})
	})
	m.HandleFunc("GET /nav/recents", func(w http.ResponseWriter, r *http.Request) {
		if o := own(w); o != nil {
			writeJSON(w, map[string]any{"places": o.Recents()})
		}
	})
	m.HandleFunc("POST /nav/plan", func(w http.ResponseWriter, r *http.Request) {
		o := own(w)
		if o == nil {
			return
		}
		var body struct {
			NavPlace
			AvoidHighways bool `json:"avoid_highways"`
			AvoidTolls    bool `json:"avoid_tolls"`
		}
		if json.NewDecoder(io.LimitReader(r.Body, 8192)).Decode(&body) != nil || !validFix(body.Lat, body.Lng) {
			w.WriteHeader(http.StatusBadRequest)
			return
		}
		var avoid []string
		if body.AvoidHighways {
			avoid = append(avoid, "motorway")
		}
		if body.AvoidTolls {
			avoid = append(avoid, "toll")
		}
		body.Name = clipRunes(firstOf(body.Name, "your destination"), 80)
		body.Address = clipRunes(body.Address, 120)
		routes, err := o.Plan(r.Context(), body.NavPlace, avoid)
		if err != nil {
			fail(w, err)
			return
		}
		writeJSON(w, map[string]any{"routes": routes})
	})
	m.HandleFunc("POST /nav/start", func(w http.ResponseWriter, r *http.Request) {
		o := own(w)
		if o == nil {
			return
		}
		var body struct {
			Route  int  `json:"route"`
			Google bool `json:"google"`
		}
		if json.NewDecoder(io.LimitReader(r.Body, 1024)).Decode(&body) != nil {
			w.WriteHeader(http.StatusBadRequest)
			return
		}
		if err := o.StartPlanned(r.Context(), body.Route, body.Google); err != nil {
			fail(w, err)
			return
		}
		w.WriteHeader(http.StatusNoContent)
	})
	m.HandleFunc("POST /nav/stop", func(w http.ResponseWriter, r *http.Request) {
		if o := own(w); o != nil {
			o.Stop()
			w.WriteHeader(http.StatusNoContent)
		}
	})
}
