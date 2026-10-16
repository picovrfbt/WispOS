package daemon

import (
	"encoding/json"
	"math"
	"net/http"
	"sort"
	"sync"
	"time"
)

// Sunrise and sunset where you are, for night mode's "Auto": worked out here
// from the date and the phone's last location (the sunrise equation, good to
// a few minutes), so it needs no connection. The last location is kept in
// memory, so a drive with no signal still knows when it gets dark.

// SunState is /sun
type SunState struct {
	Night bool `json:"night"`
	// when it next changes (epoch ms); 0 in a polar day or night
	Next    int64 `json:"next"`
	Sunrise int64 `json:"sunrise,omitempty"`
	Sunset  int64 `json:"sunset,omitempty"`
}

type sunEvent struct {
	at   time.Time
	rise bool
}

const julianUnixEpoch = 2440587.5

func toJulian(t time.Time) float64 { return float64(t.UnixMilli())/86400000 + julianUnixEpoch }

func fromJulian(j float64) time.Time {
	return time.UnixMilli(int64(math.Round((j - julianUnixEpoch) * 86400000)))
}

// sunDay is the solar day n (days since 2000-01-01 noon) at longitude lng:
// its sunrise and sunset, or polar (always day, or always night)
func sunDay(n float64, lat, lng float64) (rise, set time.Time, polarDay, polarNight bool) {
	rad := math.Pi / 180
	jStar := n - lng/360
	m := math.Mod(357.5291+0.98560028*jStar, 360)
	c := 1.9148*math.Sin(m*rad) + 0.02*math.Sin(2*m*rad) + 0.0003*math.Sin(3*m*rad)
	lambda := math.Mod(m+c+180+102.9372, 360)
	transit := 2451545 + jStar + 0.0053*math.Sin(m*rad) - 0.0069*math.Sin(2*lambda*rad)
	sinDec := math.Sin(lambda*rad) * math.Sin(23.4397*rad)
	cosDec := math.Cos(math.Asin(sinDec))
	cosW := (math.Sin(-0.833*rad) - math.Sin(lat*rad)*sinDec) / (math.Cos(lat*rad) * cosDec)
	switch {
	case cosW < -1:
		return time.Time{}, time.Time{}, true, false
	case cosW > 1:
		return time.Time{}, time.Time{}, false, true
	}
	w := math.Acos(cosW) / rad
	return fromJulian(transit - w/360), fromJulian(transit + w/360), false, false
}

// sunAt says whether it's night at now, when that next changes, and today's
// sunrise and sunset
func sunAt(now time.Time, lat, lng float64) SunState {
	base := math.Round(toJulian(now) - 2451545.0 + 0.0008)
	var events []sunEvent
	var polarDay, polarNight bool
	for d := -1.0; d <= 1; d++ {
		rise, set, pd, pn := sunDay(base+d, lat, lng)
		if d == 0 {
			polarDay, polarNight = pd, pn
		}
		if !rise.IsZero() {
			events = append(events, sunEvent{rise, true}, sunEvent{set, false})
		}
	}
	if len(events) == 0 || (polarDay && polarNight) {
		return SunState{Night: polarNight}
	}
	sort.Slice(events, func(i, j int) bool { return events[i].at.Before(events[j].at) })
	out := SunState{Night: polarNight}
	for i, e := range events {
		if e.at.After(now) {
			out.Next = e.at.UnixMilli()
			// before a sunrise is night; before a sunset is day
			out.Night = e.rise
			if i > 0 && events[i-1].rise == e.rise {
				// two of a kind in a row (near the poles): go by the earlier one
				out.Night = !events[i-1].rise
			}
			break
		}
	}
	for _, e := range events {
		local := e.at.Sub(now)
		if local > -24*time.Hour && local < 24*time.Hour {
			if e.rise && (out.Sunrise == 0 || absDur(local) < absDur(time.UnixMilli(out.Sunrise).Sub(now))) {
				out.Sunrise = e.at.UnixMilli()
			}
			if !e.rise && (out.Sunset == 0 || absDur(local) < absDur(time.UnixMilli(out.Sunset).Sub(now))) {
				out.Sunset = e.at.UnixMilli()
			}
		}
	}
	return out
}

func absDur(d time.Duration) time.Duration {
	if d < 0 {
		return -d
	}
	return d
}

func (s *ConcreteApiServer) registerSunRoutes(m *http.ServeMux) {
	var mu sync.Mutex
	var lastLat, lastLng float64
	known := false
	// 204 until the phone has said where it is, ever
	m.HandleFunc("GET /sun", func(w http.ResponseWriter, r *http.Request) {
		s.navMu.RLock()
		nav := s.navFn
		s.navMu.RUnlock()
		mu.Lock()
		if nav != nil {
			if loc := nav.Status().Location; loc != nil {
				lastLat, lastLng, known = loc.Lat, loc.Lng, true
			}
		}
		lat, lng, ok := lastLat, lastLng, known
		mu.Unlock()
		if !ok {
			w.WriteHeader(http.StatusNoContent)
			return
		}
		w.Header().Set("Content-Type", "application/json")
		_ = json.NewEncoder(w).Encode(sunAt(time.Now(), lat, lng))
	})
}
