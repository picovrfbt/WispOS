package daemon

import (
	"context"
	"encoding/json"
	"net/http"
	"os"
	"path/filepath"
	"sort"
	"strconv"
	"strings"
	"sync"
	"time"

	librespot "github.com/devgianlu/go-librespot"
)

// The Car Thing's temperature sensors (/sys/class/thermal), for Settings →
// Temperatures and the red thermometer that shows while it's hot. "Hot" is the
// processor at thermalHotC, the kernel's own target, where it starts slowing
// itself: Performance mode steps aside then (perf_mode.go), and comes back
// once it's down to thermalCoolC.

const (
	ApiEventTypeThermal ApiEventType = "system/thermal"

	thermalHotC   = 85.0
	thermalCoolC  = 75.0
	thermalEvery  = 10 * time.Second
	thermalSocKey = "soc_thermal"
)

// ThermalTrip is one of a sensor's limits: the kernel's passive, hot or critical
type ThermalTrip struct {
	TempC float64 `json:"temp_c"`
	Type  string  `json:"type"`
}

// ThermalZone is one sensor
type ThermalZone struct {
	// the kernel's name: soc_thermal, ddr_thermal, ...
	Name  string        `json:"name"`
	TempC float64       `json:"temp_c"`
	Trips []ThermalTrip `json:"trips,omitempty"`
}

// ThermalState is /system/thermal and the system/thermal event
type ThermalState struct {
	Zones []ThermalZone `json:"zones"`
	// the processor reached thermalHotC and hasn't cooled to thermalCoolC yet
	Hot bool `json:"hot"`
	// Performance mode is stepping aside for the heat
	BackedOff bool  `json:"backed_off"`
	At        int64 `json:"at"`
}

type thermalWatch struct {
	root string
	log  librespot.Logger
	emit func(*ApiEvent)
	// told when it turns hot and cool again (Performance mode's back-off)
	onHot func(hot bool)

	mu    sync.Mutex
	state ThermalState
}

func newThermalWatch(log librespot.Logger, emit func(*ApiEvent)) *thermalWatch {
	root := "/"
	// a desktop build can be pointed at made-up sensors, to see the screens with them
	if r := os.Getenv("WISP_FAKE_SYSFS"); r != "" && !onDevice {
		root = r
	}
	return &thermalWatch{root: root, log: log, emit: emit}
}

func readMilliC(p string) (float64, bool) {
	b, err := os.ReadFile(p)
	if err != nil {
		return 0, false
	}
	n, err := strconv.ParseFloat(strings.TrimSpace(string(b)), 64)
	if err != nil {
		return 0, false
	}
	return n / 1000, true
}

// read takes every sensor as it is now
func (t *thermalWatch) read() []ThermalZone {
	dirs, _ := filepath.Glob(filepath.Join(t.root, "sys/class/thermal/thermal_zone*"))
	sort.Strings(dirs)
	zones := []ThermalZone{}
	for _, d := range dirs {
		name, err := os.ReadFile(filepath.Join(d, "type"))
		if err != nil {
			continue
		}
		temp, ok := readMilliC(filepath.Join(d, "temp"))
		if !ok {
			continue
		}
		z := ThermalZone{Name: strings.TrimSpace(string(name)), TempC: temp}
		for i := 0; ; i++ {
			tc, ok := readMilliC(filepath.Join(d, "trip_point_"+strconv.Itoa(i)+"_temp"))
			if !ok {
				break
			}
			typ, _ := os.ReadFile(filepath.Join(d, "trip_point_"+strconv.Itoa(i)+"_type"))
			z.Trips = append(z.Trips, ThermalTrip{TempC: tc, Type: strings.TrimSpace(string(typ))})
		}
		zones = append(zones, z)
	}
	return zones
}

// check reads the sensors and decides hot or not, with the gap between
// thermalHotC and thermalCoolC so it doesn't flicker at the line
func (t *thermalWatch) check() ThermalState {
	zones := t.read()
	t.mu.Lock()
	was := t.state.Hot
	hot := was
	for _, z := range zones {
		if z.Name != thermalSocKey {
			continue
		}
		switch {
		case z.TempC >= thermalHotC:
			hot = true
		case z.TempC <= thermalCoolC:
			hot = false
		}
	}
	t.state.Zones, t.state.Hot, t.state.At = zones, hot, time.Now().UnixMilli()
	st := t.state
	t.mu.Unlock()
	if hot != was {
		t.log.Infof("thermal: processor %s", map[bool]string{true: "hot, Performance mode steps aside", false: "cooled down"}[hot])
		if t.onHot != nil {
			t.onHot(hot)
		}
		// the backed-off flag may have moved with it
		st = t.Status()
		if t.emit != nil {
			t.emit(&ApiEvent{Type: ApiEventTypeThermal, Data: st})
		}
	}
	return st
}

func (t *thermalWatch) setBackedOff(b bool) {
	t.mu.Lock()
	t.state.BackedOff = b
	t.mu.Unlock()
}

func (t *thermalWatch) Status() ThermalState {
	t.mu.Lock()
	defer t.mu.Unlock()
	return t.state
}

func (t *thermalWatch) run(ctx context.Context) {
	for {
		t.check()
		select {
		case <-ctx.Done():
			return
		case <-time.After(thermalEvery):
		}
	}
}

func (s *ConcreteApiServer) SetThermal(t *thermalWatch) {
	s.thermalMu.Lock()
	s.thermal = t
	s.thermalMu.Unlock()
}

func (s *ConcreteApiServer) registerThermalRoutes(m *http.ServeMux) {
	// fresh readings on each ask (Settings polls it while the list is open)
	m.HandleFunc("GET /system/thermal", func(w http.ResponseWriter, r *http.Request) {
		s.thermalMu.RLock()
		t := s.thermal
		s.thermalMu.RUnlock()
		w.Header().Set("Content-Type", "application/json")
		if t == nil {
			_ = json.NewEncoder(w).Encode(ThermalState{Zones: []ThermalZone{}})
			return
		}
		_ = json.NewEncoder(w).Encode(t.check())
	})
}
