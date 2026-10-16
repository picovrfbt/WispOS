// fake-nav-phone stands in for the Car Thing Nav Android app: it serves the same
// ws://…:3679/nav protocol and "drives" a recorded route (route.json, from the
// OSRM demo server) with Google-Maps-style turn notifications and 1 Hz fixes.
//
//	go run ./cmd/fake-nav-phone -speedup 4
//
// then point the daemon at it with nav.phone_url: ws://127.0.0.1:3679/nav
package main

import (
	"bytes"
	"context"
	_ "embed"
	"encoding/base64"
	"encoding/json"
	"flag"
	"fmt"
	"image"
	"image/color"
	"image/png"
	"log"
	"math"
	"net/http"
	"sync"
	"time"

	"github.com/coder/websocket"
)

//go:embed route.json
var routeJSON []byte

type step struct {
	Type     string       `json:"type"`
	Modifier string       `json:"modifier"`
	Name     string       `json:"name"`
	Distance float64      `json:"distance"`
	Duration float64      `json:"duration"`
	Geometry [][2]float64 `json:"geometry"` // lng, lat
}

type route struct {
	Distance float64 `json:"distance"`
	Duration float64 `json:"duration"`
	Steps    []step  `json:"steps"`
}

// one point along the drive
type point struct {
	lat, lng float64
	at       float64 // metres from the start
	step     int     // the step this stretch belongs to
}

func main() {
	addr := flag.String("addr", "127.0.0.1:3679", "listen address")
	speedup := flag.Float64("speedup", 4, "drive this many times faster than real time")
	flag.Parse()

	var r route
	if err := json.Unmarshal(routeJSON, &r); err != nil {
		log.Fatal(err)
	}
	pts, maneuverAt := flatten(r)

	h := &hub{conns: map[*websocket.Conn]bool{}}
	http.HandleFunc("/nav", h.serve)
	go func() { log.Fatal(http.ListenAndServe(*addr, nil)) }()
	log.Printf("fake phone on ws://%s/nav, driving %.1f km at %gx", *addr, r.Distance/1000, *speedup)

	for {
		drive(h, r, pts, maneuverAt, *speedup)
		h.send(map[string]any{"type": "nav", "active": false})
		log.Print("arrived; restarting in 10s")
		time.Sleep(10 * time.Second)
	}
}

// flatten turns the steps into one polyline plus where each maneuver happens
func flatten(r route) ([]point, []float64) {
	var pts []point
	maneuverAt := make([]float64, len(r.Steps))
	dist := 0.0
	for i, s := range r.Steps {
		maneuverAt[i] = dist
		for j, c := range s.Geometry {
			p := point{lat: c[1], lng: c[0], step: i}
			if len(pts) > 0 {
				if j == 0 {
					continue // shared with the previous step's last point
				}
				dist += haversine(pts[len(pts)-1], p)
			}
			p.at = dist
			pts = append(pts, p)
		}
	}
	return pts, maneuverAt
}

func drive(h *hub, r route, pts []point, maneuverAt []float64, speedup float64) {
	total := pts[len(pts)-1].at
	pos := 0.0
	start := time.Now()
	for pos < total {
		i := segmentAt(pts, pos)
		a, b := pts[i], pts[i+1]
		f := 0.0
		if b.at > a.at {
			f = (pos - a.at) / (b.at - a.at)
		}
		lat, lng := a.lat+(b.lat-a.lat)*f, a.lng+(b.lng-a.lng)*f

		// the step we're on ends at the next maneuver
		next := b.step
		if maneuverAt[next] <= pos && next+1 < len(r.Steps) {
			next++
		}
		s := r.Steps[a.step]
		speed := 10.0
		if s.Duration > 0 {
			speed = s.Distance / s.Duration
		}

		elapsed := time.Since(start).Seconds() * speedup
		remainingS := math.Max(0, r.Duration-elapsed)
		eta := time.Now().Add(time.Duration(remainingS/speedup) * time.Second)
		h.setTurn(map[string]any{
			"type":     "nav",
			"active":   true,
			"title":    formatDistance(maneuverAt[next] - pos),
			"text":     instruction(r.Steps[next]),
			"sub_text": fmt.Sprintf("%.0f min · %s · %s", math.Ceil(remainingS/60), formatDistance(total-pos), eta.Format("3:04 PM")),
			"icon":     arrowPNG(r.Steps[next]),
		})
		h.send(map[string]any{
			"type": "location", "lat": lat, "lng": lng,
			"bearing": bearing(a, b), "speed": speed, "accuracy": 5,
		})

		time.Sleep(time.Second)
		pos += speed * speedup
	}
}

func segmentAt(pts []point, pos float64) int {
	for i := 0; i < len(pts)-2; i++ {
		if pts[i+1].at >= pos {
			return i
		}
	}
	return len(pts) - 2
}

func instruction(s step) string {
	onto := ""
	if s.Name != "" {
		onto = " onto " + s.Name
	}
	switch s.Type {
	case "arrive":
		return "Arrive at your destination"
	case "new name", "continue":
		return "Continue" + onto
	case "turn", "end of road", "fork", "on ramp", "off ramp":
		return "Turn " + s.Modifier + onto
	default:
		return "Head " + s.Modifier + onto
	}
}

func formatDistance(m float64) string {
	ft := m * 3.28084
	if ft < 1000 {
		return fmt.Sprintf("%.0f ft", math.Max(50, math.Round(ft/50)*50))
	}
	return fmt.Sprintf("%.1f mi", m/1609.34)
}

func haversine(a, b point) float64 {
	const R = 6371000.0
	la1, la2 := a.lat*math.Pi/180, b.lat*math.Pi/180
	dLa, dLo := la2-la1, (b.lng-a.lng)*math.Pi/180
	h := math.Sin(dLa/2)*math.Sin(dLa/2) + math.Cos(la1)*math.Cos(la2)*math.Sin(dLo/2)*math.Sin(dLo/2)
	return 2 * R * math.Asin(math.Sqrt(h))
}

func bearing(a, b point) float64 {
	la1, la2 := a.lat*math.Pi/180, b.lat*math.Pi/180
	dLo := (b.lng - a.lng) * math.Pi / 180
	y := math.Sin(dLo) * math.Cos(la2)
	x := math.Cos(la1)*math.Sin(la2) - math.Sin(la1)*math.Cos(la2)*math.Cos(dLo)
	return math.Mod(math.Atan2(y, x)*180/math.Pi+360, 360)
}

// arrows

var arrowCache sync.Map

// a white arrow turned to the maneuver, like the one Google Maps posts
func arrowPNG(s step) string {
	angle := map[string]float64{
		"left": -90, "right": 90, "slight left": -45, "slight right": 45,
		"sharp left": -135, "sharp right": 135, "uturn": 180,
	}[s.Modifier]
	if s.Type == "arrive" || s.Type == "new name" || s.Type == "continue" {
		angle = 0
	}
	if v, ok := arrowCache.Load(angle); ok {
		return v.(string)
	}
	const n = 96
	img := image.NewNRGBA(image.Rect(0, 0, n, n))
	// an up-pointing arrow in unit coords, centred on the origin
	shape := [][2]float64{{0, -0.42}, {0.3, -0.05}, {0.11, -0.05}, {0.11, 0.42}, {-0.11, 0.42}, {-0.11, -0.05}, {-0.3, -0.05}}
	rad := angle * math.Pi / 180
	poly := make([][2]float64, len(shape))
	for i, p := range shape {
		poly[i] = [2]float64{p[0]*math.Cos(rad) - p[1]*math.Sin(rad), p[0]*math.Sin(rad) + p[1]*math.Cos(rad)}
	}
	for y := 0; y < n; y++ {
		for x := 0; x < n; x++ {
			px, py := (float64(x)+0.5)/n-0.5, (float64(y)+0.5)/n-0.5
			if inside(poly, px, py) {
				img.Set(x, y, color.NRGBA{255, 255, 255, 255})
			}
		}
	}
	var buf bytes.Buffer
	_ = png.Encode(&buf, img)
	url := "data:image/png;base64," + base64.StdEncoding.EncodeToString(buf.Bytes())
	arrowCache.Store(angle, url)
	return url
}

func inside(poly [][2]float64, x, y float64) bool {
	in := false
	for i, j := 0, len(poly)-1; i < len(poly); j, i = i, i+1 {
		a, b := poly[i], poly[j]
		if (a[1] > y) != (b[1] > y) && x < (b[0]-a[0])*(y-a[1])/(b[1]-a[1])+a[0] {
			in = !in
		}
	}
	return in
}

// fan-out to connected Car Things

type hub struct {
	mu    sync.Mutex
	conns map[*websocket.Conn]bool
	turn  []byte
	fix   []byte
}

func (h *hub) serve(w http.ResponseWriter, r *http.Request) {
	c, err := websocket.Accept(w, r, nil)
	if err != nil {
		return
	}
	log.Printf("car thing connected from %s", r.RemoteAddr)
	h.mu.Lock()
	h.conns[c] = true
	hello, _ := json.Marshal(map[string]any{"type": "hello", "app": "fake-nav-phone", "version": 1})
	for _, m := range [][]byte{hello, h.turn, h.fix} {
		if m != nil {
			_ = c.Write(r.Context(), websocket.MessageText, m)
		}
	}
	h.mu.Unlock()
	// the car only listens; reading notices when it goes away
	for {
		if _, _, err := c.Read(r.Context()); err != nil {
			break
		}
	}
	h.mu.Lock()
	delete(h.conns, c)
	h.mu.Unlock()
	log.Print("car thing disconnected")
}

func (h *hub) setTurn(msg map[string]any) {
	b, _ := json.Marshal(msg)
	h.mu.Lock()
	same := bytes.Equal(b, h.turn)
	h.mu.Unlock()
	if !same {
		h.send(msg)
	}
}

func (h *hub) send(msg map[string]any) {
	b, _ := json.Marshal(msg)
	h.mu.Lock()
	defer h.mu.Unlock()
	switch msg["type"] {
	case "nav":
		h.turn = b
	case "location":
		h.fix = b
	}
	for c := range h.conns {
		ctx, cancel := context.WithTimeout(context.Background(), 2*time.Second)
		_ = c.Write(ctx, websocket.MessageText, b)
		cancel()
	}
}
