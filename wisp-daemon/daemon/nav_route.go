package daemon

import (
	"encoding/json"
	"net/http"
)

// The route line on the map, worked out by the companion app (Google Maps
// doesn't share its own): the whole trip when a destination was shared to the
// app ("full"), otherwise the road to the next turn ("next"). It can run to a
// couple of thousand points, so it isn't in every nav event: the state carries
// its revision and the UI fetches /nav/route when that changes.

// navMaxRoutePoints caps what the phone may send (it simplifies to well under)
const navMaxRoutePoints = 5000

// NavRoute is /nav/route
type NavRoute struct {
	// "full" (the trip), "next" (to the next turn) or "" (none)
	Kind string `json:"kind"`
	// bumped on every change; matches NavState.RouteRev
	Rev int `json:"rev"`
	// [lat, lng] pairs, start to end
	Points [][2]float64 `json:"points"`
}

type navRouteMessage struct {
	Kind   string       `json:"kind"`
	Points [][2]float64 `json:"points"`
}

func (n *navRelay) Route() NavRoute {
	n.mu.Lock()
	defer n.mu.Unlock()
	r := n.route
	r.Points = append([][2]float64(nil), r.Points...)
	return r
}

// applyRoute takes the phone's route, or clears it on a kind of "none"
func (n *navRelay) applyRoute(data []byte) {
	if n.own != nil && n.own.Active() {
		return
	}
	var m navRouteMessage
	if json.Unmarshal(data, &m) != nil {
		return
	}
	kind := m.Kind
	if kind != "full" && kind != "next" {
		kind = ""
	}
	var pts [][2]float64
	if kind != "" {
		if len(m.Points) < 2 || len(m.Points) > navMaxRoutePoints {
			return
		}
		pts = make([][2]float64, 0, len(m.Points))
		for _, p := range m.Points {
			if !validFix(p[0], p[1]) {
				return
			}
			pts = append(pts, p)
		}
	}
	n.setRoute(kind, pts)
}

func (n *navRelay) setRoute(kind string, pts [][2]float64) {
	n.mu.Lock()
	if kind == "" && n.route.Kind == "" {
		n.mu.Unlock()
		return
	}
	rev := n.route.Rev + 1
	n.route = NavRoute{Kind: kind, Rev: rev, Points: pts}
	n.mu.Unlock()
	n.update(func(s *NavState) {
		s.RouteRev = rev
		s.RouteKind = kind
	})
}

func (s *ConcreteApiServer) registerRouteRoutes(m *http.ServeMux, handler func() NavHandler) {
	m.HandleFunc("GET /nav/route", func(w http.ResponseWriter, r *http.Request) {
		h := handler()
		if h == nil {
			w.WriteHeader(http.StatusServiceUnavailable)
			return
		}
		w.Header().Set("Content-Type", "application/json")
		_ = json.NewEncoder(w).Encode(h.Route())
	})
}
