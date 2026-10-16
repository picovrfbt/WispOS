package daemon

import (
	"context"
	"encoding/json"
	"errors"
	"net/http"

	"github.com/coder/websocket"
)

// Calls on the Car Thing, kept small: the car's hands-free does the talking,
// the Car Thing shows who's calling with Answer and Decline, then a timer and
// Hang up. The companion app sends "call" as the phone's call state changes
// and takes "call_control" back.

const ApiEventTypePhoneCall ApiEventType = "phone/call"

// PhoneCall is /phone/call and the phone/call event
type PhoneCall struct {
	// "idle", "ringing" or "active"
	State string `json:"state"`
	// the caller as the phone names them; empty when it doesn't know
	Name string `json:"name,omitempty"`
	// when an active call was picked up (epoch ms), for the timer
	Since int64 `json:"since,omitempty"`
}

var callActions = map[string]bool{"answer": true, "decline": true, "hangup": true}

var ErrBadCallAction = errors.New("unknown call action")

func (n *navRelay) Call() PhoneCall {
	n.mu.Lock()
	defer n.mu.Unlock()
	if n.call.State == "" {
		return PhoneCall{State: "idle"}
	}
	return n.call
}

// CallControl answers, declines or hangs up through the phone
func (n *navRelay) CallControl(ctx context.Context, action string) error {
	if !callActions[action] {
		return ErrBadCallAction
	}
	n.mu.Lock()
	c := n.conn
	n.mu.Unlock()
	if c == nil {
		return ErrNoNavPhone
	}
	msg, _ := json.Marshal(map[string]string{"type": "call_control", "action": action})
	return c.Write(ctx, websocket.MessageText, msg)
}

func (n *navRelay) applyCall(c PhoneCall) {
	switch c.State {
	case "ringing", "active":
	default:
		c = PhoneCall{State: "idle"}
	}
	c.Name = clipRunes(c.Name, 80)
	n.mu.Lock()
	changed := n.call != c
	n.call = c
	n.mu.Unlock()
	if changed && n.emit != nil {
		n.emit(&ApiEvent{Type: ApiEventTypePhoneCall, Data: c})
	}
}

func (s *ConcreteApiServer) registerCallRoutes(m *http.ServeMux, handler func() NavHandler) {
	m.HandleFunc("GET /phone/call", func(w http.ResponseWriter, r *http.Request) {
		h := handler()
		if h == nil {
			w.WriteHeader(http.StatusServiceUnavailable)
			return
		}
		w.Header().Set("Content-Type", "application/json")
		_ = json.NewEncoder(w).Encode(h.Call())
	})
	// 400 for an unknown action, 503 with no phone to send it to
	m.HandleFunc("POST /phone/call", func(w http.ResponseWriter, r *http.Request) {
		var body struct {
			Action string `json:"action"`
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
		err := h.CallControl(r.Context(), body.Action)
		switch {
		case errors.Is(err, ErrBadCallAction):
			w.WriteHeader(http.StatusBadRequest)
		case err != nil:
			w.WriteHeader(http.StatusServiceUnavailable)
		default:
			w.WriteHeader(http.StatusNoContent)
		}
	})
}
