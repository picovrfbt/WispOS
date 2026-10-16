package daemon

import (
	"context"
	"encoding/json"
	"errors"
	"net/http"

	"github.com/coder/websocket"
)

// Drive Mode: music that follows the driving. The companion app plays it and
// reads the drive from the phone's sensors; the Car Thing picks the genre and
// shows the music's parts. This only carries the two ways: the UI's commands
// to the phone, and the phone's live state ("drive_state", ~12 a second) back
// to the UI as the drive/state event.

const (
	ApiEventTypeDriveState ApiEventType = "drive/state"

	// a state message is a handful of numbers; anything bigger isn't one
	driveMaxStateBytes = 2 << 10
)

var driveGenres = map[string]bool{"ethereal": true, "cinematic": true, "lofi": true}

var ErrBadDriveCommand = errors.New("unknown drive command")

// DriveCommand sends start (with a genre), stop, pause or resume to the phone
func (n *navRelay) DriveCommand(ctx context.Context, action, genre string) error {
	switch action {
	case "start":
		if !driveGenres[genre] {
			return ErrBadDriveCommand
		}
	case "stop", "pause", "resume":
		genre = ""
	default:
		return ErrBadDriveCommand
	}
	n.mu.Lock()
	c := n.conn
	n.mu.Unlock()
	if c == nil {
		return ErrNoNavPhone
	}
	msg, _ := json.Marshal(map[string]string{"type": "drive", "action": action, "genre": genre})
	return c.Write(ctx, websocket.MessageText, msg)
}

// DriveState is the phone's last word on the drive, or nil
func (n *navRelay) DriveState() json.RawMessage {
	n.mu.Lock()
	defer n.mu.Unlock()
	return n.driveState
}

// applyDriveState passes a "drive_state" message on to the UI as it is (it's
// only numbers and a genre, checked here to be a JSON object of a sane size)
func (n *navRelay) applyDriveState(data []byte) {
	if len(data) > driveMaxStateBytes {
		return
	}
	var state map[string]any
	if err := json.Unmarshal(data, &state); err != nil {
		return
	}
	delete(state, "type")
	out, err := json.Marshal(state)
	if err != nil {
		return
	}
	n.mu.Lock()
	n.driveState = out
	n.mu.Unlock()
	if n.emit != nil {
		n.emit(&ApiEvent{Type: ApiEventTypeDriveState, Data: json.RawMessage(out)})
	}
}

// clearDriveState: the phone went away, so the drive did too
func (n *navRelay) clearDriveState() {
	n.mu.Lock()
	had := n.driveState != nil
	n.driveState = nil
	n.mu.Unlock()
	if had && n.emit != nil {
		n.emit(&ApiEvent{Type: ApiEventTypeDriveState, Data: json.RawMessage(`{"playing":false,"gone":true}`)})
	}
}

func (s *ConcreteApiServer) registerDriveRoutes(m *http.ServeMux, handler func() NavHandler) {
	m.HandleFunc("GET /drive/state", func(w http.ResponseWriter, r *http.Request) {
		h := handler()
		if h == nil {
			w.WriteHeader(http.StatusServiceUnavailable)
			return
		}
		st := h.DriveState()
		if st == nil {
			w.WriteHeader(http.StatusNoContent)
			return
		}
		w.Header().Set("Content-Type", "application/json")
		_, _ = w.Write(st)
	})
	command := func(action string) http.HandlerFunc {
		return func(w http.ResponseWriter, r *http.Request) {
			var body struct {
				Genre string `json:"genre"`
			}
			if action == "start" {
				if err := jsonDecode(r, &body); err != nil {
					w.WriteHeader(http.StatusBadRequest)
					return
				}
			}
			h := handler()
			if h == nil {
				w.WriteHeader(http.StatusServiceUnavailable)
				return
			}
			err := h.DriveCommand(r.Context(), action, body.Genre)
			switch {
			case errors.Is(err, ErrBadDriveCommand):
				w.WriteHeader(http.StatusBadRequest)
			case err != nil:
				// 503: no companion app to play it
				w.WriteHeader(http.StatusServiceUnavailable)
			default:
				w.WriteHeader(http.StatusNoContent)
			}
		}
	}
	for _, a := range []string{"start", "stop", "pause", "resume"} {
		m.HandleFunc("POST /drive/"+a, command(a))
	}
}
