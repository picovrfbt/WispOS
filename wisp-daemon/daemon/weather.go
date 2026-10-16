package daemon

import (
	"context"
	"encoding/json"
	"fmt"
	"math"
	"net/http"
	"sync"
	"time"
)

// The weather where you are, for the idle screen. From Open-Meteo, which
// needs no account or key; it's sent only the phone's last location rounded
// to about a kilometre, and asked at most every weatherEvery.

const (
	weatherEvery = 15 * time.Minute
	weatherAPI   = "https://api.open-meteo.com/v1/forecast"
)

// Weather is /weather
type Weather struct {
	// in the unit asked for
	Temp float64 `json:"temp"`
	Unit string  `json:"unit"`
	// the WMO weather code, and it in words
	Code    int    `json:"code"`
	Summary string `json:"summary"`
	IsDay   bool   `json:"is_day"`
	At      int64  `json:"at"`
}

type weatherCache struct {
	client *http.Client
	api    string

	mu   sync.Mutex
	last *Weather
	key  string
}

func newWeatherCache() *weatherCache {
	return &weatherCache{client: &http.Client{Timeout: 10 * time.Second}, api: weatherAPI}
}

// weatherSummary is a WMO weather code in a few words
func weatherSummary(code int) string {
	switch {
	case code == 0:
		return "Clear"
	case code == 1:
		return "Mostly clear"
	case code == 2:
		return "Partly cloudy"
	case code == 3:
		return "Cloudy"
	case code == 45 || code == 48:
		return "Fog"
	case code >= 51 && code <= 57:
		return "Drizzle"
	case code >= 61 && code <= 67:
		return "Rain"
	case code >= 71 && code <= 77:
		return "Snow"
	case code >= 80 && code <= 82:
		return "Showers"
	case code == 85 || code == 86:
		return "Snow showers"
	case code >= 95:
		return "Thunderstorms"
	}
	return ""
}

func (w *weatherCache) get(ctx context.Context, lat, lng float64, unit string) (*Weather, error) {
	// about a kilometre: close enough for weather, no closer
	rlat, rlng := math.Round(lat*100)/100, math.Round(lng*100)/100
	key := fmt.Sprintf("%.2f,%.2f,%s", rlat, rlng, unit)
	w.mu.Lock()
	if w.last != nil && w.key == key && time.Since(time.UnixMilli(w.last.At)) < weatherEvery {
		cached := *w.last
		w.mu.Unlock()
		return &cached, nil
	}
	w.mu.Unlock()

	tempUnit := "fahrenheit"
	if unit == "C" {
		tempUnit = "celsius"
	}
	url := fmt.Sprintf("%s?latitude=%.2f&longitude=%.2f&current=temperature_2m,weather_code,is_day&temperature_unit=%s",
		w.api, rlat, rlng, tempUnit)
	req, err := http.NewRequestWithContext(ctx, "GET", url, nil)
	if err != nil {
		return nil, err
	}
	resp, err := w.client.Do(req)
	if err != nil {
		return nil, err
	}
	defer func() { _ = resp.Body.Close() }()
	if resp.StatusCode != http.StatusOK {
		return nil, fmt.Errorf("weather: %s", resp.Status)
	}
	var body struct {
		Current struct {
			Temp  float64 `json:"temperature_2m"`
			Code  int     `json:"weather_code"`
			IsDay int     `json:"is_day"`
		} `json:"current"`
	}
	if err := json.NewDecoder(resp.Body).Decode(&body); err != nil {
		return nil, err
	}
	out := &Weather{
		Temp: math.Round(body.Current.Temp), Unit: unit, Code: body.Current.Code,
		Summary: weatherSummary(body.Current.Code), IsDay: body.Current.IsDay == 1,
		At: time.Now().UnixMilli(),
	}
	w.mu.Lock()
	w.last, w.key = out, key
	w.mu.Unlock()
	return out, nil
}

func (s *ConcreteApiServer) registerWeatherRoutes(m *http.ServeMux) {
	weather := newWeatherCache()
	// 204 while the phone hasn't said where it is
	m.HandleFunc("GET /weather", func(w http.ResponseWriter, r *http.Request) {
		s.navMu.RLock()
		nav := s.navFn
		s.navMu.RUnlock()
		if nav == nil {
			w.WriteHeader(http.StatusNoContent)
			return
		}
		loc := nav.Status().Location
		if loc == nil {
			w.WriteHeader(http.StatusNoContent)
			return
		}
		unit := "F"
		if r.URL.Query().Get("unit") == "C" {
			unit = "C"
		}
		wx, err := weather.get(r.Context(), loc.Lat, loc.Lng, unit)
		if err != nil {
			w.WriteHeader(http.StatusBadGateway)
			return
		}
		w.Header().Set("Content-Type", "application/json")
		_ = json.NewEncoder(w).Encode(wx)
	})
}
