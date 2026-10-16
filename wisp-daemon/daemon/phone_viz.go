package daemon

import (
	"context"
	"encoding/json"
	"net/http"
	"time"

	"github.com/coder/websocket"
)

// The visualizer: the companion app measures what the phone is playing and
// sends 24 bands about 20 times a second ("viz"), passed straight on to the UI.
// It only measures while the UI is showing a visualizer: the UI says so with
// POST /phone/viz, which goes to the phone as "viz_wanted" (and again when the
// phone reconnects). Whether the phone can measure at all comes back as
// "viz_status".

const (
	ApiEventTypePhoneViz       ApiEventType = "phone/viz"
	ApiEventTypePhoneVizStatus ApiEventType = "phone/viz-status"

	vizMaxFrameBytes = 1 << 10
)

// VizStatus is GET /phone/viz and the phone/viz-status event
type VizStatus struct {
	Available bool   `json:"available"`
	Why       string `json:"why,omitempty"`
	// the phone has answered since the UI asked
	Known bool `json:"known"`
}

func (n *navRelay) SetVizWanted(on bool) error {
	n.mu.Lock()
	n.vizWanted = on
	c := n.conn
	n.mu.Unlock()
	if c == nil {
		return ErrNoNavPhone
	}
	go n.sendVizWanted(c, on)
	return nil
}

func (n *navRelay) sendVizWanted(c *websocket.Conn, on bool) {
	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()
	msg, _ := json.Marshal(map[string]any{"type": "viz_wanted", "enabled": on})
	if err := c.Write(ctx, websocket.MessageText, msg); err != nil {
		n.log.Debugf("nav: visualizer request not sent: %v", err)
	}
}

func (n *navRelay) VizStatus() VizStatus {
	n.mu.Lock()
	defer n.mu.Unlock()
	return n.vizStatus
}

// applyViz passes a frame on as it is (a few numbers, checked to be an object)
func (n *navRelay) applyViz(data []byte) {
	if len(data) > vizMaxFrameBytes || n.emit == nil {
		return
	}
	var frame map[string]any
	if json.Unmarshal(data, &frame) != nil {
		return
	}
	delete(frame, "type")
	out, err := json.Marshal(frame)
	if err != nil {
		return
	}
	n.emit(&ApiEvent{Type: ApiEventTypePhoneViz, Data: json.RawMessage(out)})
}

func (n *navRelay) applyVizStatus(s VizStatus) {
	s.Known = true
	s.Why = clipRunes(s.Why, 120)
	n.mu.Lock()
	changed := n.vizStatus != s
	n.vizStatus = s
	n.mu.Unlock()
	if changed && n.emit != nil {
		n.emit(&ApiEvent{Type: ApiEventTypePhoneVizStatus, Data: s})
	}
}

func (s *ConcreteApiServer) registerVizRoutes(m *http.ServeMux, handler func() NavHandler) {
	m.HandleFunc("GET /phone/viz", func(w http.ResponseWriter, r *http.Request) {
		h := handler()
		if h == nil {
			w.WriteHeader(http.StatusServiceUnavailable)
			return
		}
		w.Header().Set("Content-Type", "application/json")
		_ = json.NewEncoder(w).Encode(h.VizStatus())
	})
	// {"enabled": true} while a visualizer is on screen; 503 with no phone
	m.HandleFunc("POST /phone/viz", func(w http.ResponseWriter, r *http.Request) {
		var body struct {
			Enabled bool `json:"enabled"`
		}
		if err := jsonDecode(r, &body); err != nil {
			w.WriteHeader(http.StatusBadRequest)
			return
		}
		h := handler()
		if h == nil {
			w.WriteHeader(http.StatusServiceUnavailable)
			return
		}
		if err := h.SetVizWanted(body.Enabled); err != nil {
			w.WriteHeader(http.StatusServiceUnavailable)
			return
		}
		w.WriteHeader(http.StatusNoContent)
	})
}
