package daemon

import (
	"encoding/json"
	"net/http"
)

// The phone's battery, from the companion app as it changes: the UI shows a
// small battery while the phone isn't charging and warns when it runs low.

const ApiEventTypePhoneBattery ApiEventType = "phone/battery"

// PhoneBattery is /phone/battery and the phone/battery event
type PhoneBattery struct {
	// false until the phone has said, and again once it's gone
	Known    bool `json:"known"`
	Level    int  `json:"level"`
	Charging bool `json:"charging"`
}

func (n *navRelay) Battery() PhoneBattery {
	n.mu.Lock()
	defer n.mu.Unlock()
	return n.battery
}

func (n *navRelay) applyBattery(b PhoneBattery) {
	b.Known = true
	b.Level = min(max(b.Level, 0), 100)
	n.mu.Lock()
	changed := n.battery != b
	n.battery = b
	n.mu.Unlock()
	if changed && n.emit != nil {
		n.emit(&ApiEvent{Type: ApiEventTypePhoneBattery, Data: b})
	}
}

// clearBattery: the phone went away, and with it what its battery said
func (n *navRelay) clearBattery() {
	n.mu.Lock()
	had := n.battery.Known
	n.battery = PhoneBattery{}
	n.mu.Unlock()
	if had && n.emit != nil {
		n.emit(&ApiEvent{Type: ApiEventTypePhoneBattery, Data: PhoneBattery{}})
	}
}

func (s *ConcreteApiServer) registerBatteryRoutes(m *http.ServeMux, handler func() NavHandler) {
	m.HandleFunc("GET /phone/battery", func(w http.ResponseWriter, r *http.Request) {
		h := handler()
		if h == nil {
			w.WriteHeader(http.StatusServiceUnavailable)
			return
		}
		w.Header().Set("Content-Type", "application/json")
		_ = json.NewEncoder(w).Encode(h.Battery())
	})
}
