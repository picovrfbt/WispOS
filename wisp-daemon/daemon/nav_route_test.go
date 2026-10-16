package daemon

import (
	"testing"
)

func TestNavRouteTakesTheLineAndBumpsTheRevision(t *testing.T) {
	ev := &navEvents{}
	n := newTestRelay(ev)
	n.applyRoute([]byte(`{"type":"route","kind":"full","points":[[33.77,-118.19],[33.78,-118.18],[33.79,-118.17]]}`))
	r := n.Route()
	if r.Kind != "full" || r.Rev != 1 || len(r.Points) != 3 || r.Points[2] != [2]float64{33.79, -118.17} {
		t.Fatalf("route %+v", r)
	}
	if s := n.Status(); s.RouteRev != 1 || s.RouteKind != "full" {
		t.Fatalf("state rev %d kind %q", s.RouteRev, s.RouteKind)
	}
	if ev.count(ApiEventTypeNav) == 0 {
		t.Fatal("no nav event for the new route")
	}
}

func TestNavRouteClearsOnNone(t *testing.T) {
	n := newTestRelay(&navEvents{})
	n.applyRoute([]byte(`{"kind":"next","points":[[1,1],[1.001,1.001]]}`))
	n.applyRoute([]byte(`{"kind":"none"}`))
	r := n.Route()
	if r.Kind != "" || len(r.Points) != 0 || r.Rev != 2 {
		t.Fatalf("route %+v", r)
	}
	if s := n.Status(); s.RouteKind != "" || s.RouteRev != 2 {
		t.Fatalf("state %+v", s)
	}
	// clearing what's already clear changes nothing
	n.applyRoute([]byte(`{"kind":"none"}`))
	if n.Route().Rev != 2 {
		t.Fatal("a second clear bumped the revision")
	}
}

func TestNavRouteRefusesBadLines(t *testing.T) {
	n := newTestRelay(&navEvents{})
	for _, bad := range []string{
		`{"kind":"full","points":[[33.77,-118.19]]}`,         // one point is no line
		`{"kind":"full","points":[[33.77,-118.19],[95,10]]}`, // off the globe
		`{"kind":"full","points":[[0,0],[33.78,-118.18]]}`,   // null island
		`{"kind":"full","points":"nope"}`,
	} {
		n.applyRoute([]byte(bad))
	}
	if r := n.Route(); r.Kind != "" || r.Rev != 0 {
		t.Fatalf("took a bad line: %+v", r)
	}
}
