package daemon

import (
	"context"
	"encoding/json"
	"errors"
	"net/http"
	"strings"
	"time"

	"github.com/coder/websocket"
)

// Wisp's spoken voice. The Car Thing has no speaker, so the companion app
// speaks: it holds the voice (Piper "Alan", fetched once from the Wisp
// releases) and plays it through the phone into the car, ducking the music.
// The Car Thing asks it to keep the voice ready while Settings → Wisp's voice
// is on, and says what to speak; the phone reports how the voice download is
// going, which the UI shows in Settings.

const (
	voiceSayMaxRunes = 300
	voiceSpeedMin    = 0.5
	voiceSpeedMax    = 2.0
)

var ErrNothingToSay = errors.New("nothing to say")

// Say asks the phone to speak, at a speed from 0.5x to 2x and a volume from
// 0.1 to 1 (Wisp's own level, separate from the music's)
func (n *navRelay) Say(ctx context.Context, text string, speed, volume float64) error {
	text = clipRunes(text, voiceSayMaxRunes)
	if text == "" {
		return ErrNothingToSay
	}
	if speed < voiceSpeedMin || speed > voiceSpeedMax {
		speed = 1
	}
	if volume <= 0 || volume > 1 {
		volume = 1
	}
	volume = max(volume, 0.1)
	n.mu.Lock()
	c := n.conn
	n.mu.Unlock()
	if c == nil {
		return ErrNoNavPhone
	}
	msg, _ := json.Marshal(map[string]any{"type": "say", "text": text, "speed": speed, "volume": volume})
	return c.Write(ctx, websocket.MessageText, msg)
}

// SetVoiceWanted keeps the phone's voice ready (downloaded, loaded) or lets it go
func (n *navRelay) SetVoiceWanted(on bool) {
	n.mu.Lock()
	changed := n.voiceWanted != on
	n.voiceWanted = on
	c := n.conn
	n.mu.Unlock()
	if changed && c != nil {
		go n.sendVoiceWanted(c, on)
	}
}

func (n *navRelay) sendVoiceWanted(c *websocket.Conn, on bool) {
	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()
	msg, _ := json.Marshal(map[string]any{"type": "voice_wanted", "enabled": on})
	if err := c.Write(ctx, websocket.MessageText, msg); err != nil {
		n.log.Debugf("nav: voice setting not sent: %v", err)
	}
}

// phoneVoiceStatusMessage is the phone's "voice_status": where its voice is
type phoneVoiceStatusMessage struct {
	// absent | downloading | ready | failed
	State   string `json:"state"`
	Percent int    `json:"percent"`
	Error   string `json:"error"`
}

var phoneVoiceStates = map[string]bool{"absent": true, "downloading": true, "ready": true, "failed": true}

func (n *navRelay) applyVoiceStatus(m phoneVoiceStatusMessage) {
	if !phoneVoiceStates[m.State] {
		return
	}
	pct := min(max(m.Percent, 0), 100)
	why := clipRunes(m.Error, 120)
	n.update(func(s *NavState) {
		s.VoiceState, s.VoicePercent, s.VoiceError = m.State, pct, why
	})
}

// wispVoiceFromSettings: Settings → Wisp's voice is anything but off
func wispVoiceFromSettings(body []byte) bool {
	var s struct {
		Voice *string `json:"wispVoice"`
	}
	return json.Unmarshal(body, &s) == nil && s.Voice != nil && *s.Voice != "" && *s.Voice != "off"
}

func (s *ConcreteApiServer) registerPhoneVoiceRoutes(m *http.ServeMux) {
	// 400 for nothing to say, 503 with no phone app to say it
	m.HandleFunc("POST /phone/say", func(w http.ResponseWriter, r *http.Request) {
		var body struct {
			Text   string  `json:"text"`
			Speed  float64 `json:"speed"`
			Volume float64 `json:"volume"`
		}
		if err := jsonDecode(r, &body); err != nil || strings.TrimSpace(body.Text) == "" {
			w.WriteHeader(http.StatusBadRequest)
			return
		}
		s.navMu.RLock()
		h := s.navFn
		s.navMu.RUnlock()
		if h == nil {
			w.WriteHeader(http.StatusServiceUnavailable)
			return
		}
		switch err := h.Say(r.Context(), body.Text, body.Speed, body.Volume); {
		case errors.Is(err, ErrNothingToSay):
			w.WriteHeader(http.StatusBadRequest)
		case err != nil:
			w.WriteHeader(http.StatusServiceUnavailable)
		default:
			w.WriteHeader(http.StatusNoContent)
		}
	})
}
