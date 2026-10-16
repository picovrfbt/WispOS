package daemon

import (
	"context"
	"crypto/sha1"
	"encoding/base64"
	"encoding/hex"
	"encoding/json"
	"errors"
	"net/http"
	"strings"
	"time"

	"github.com/coder/websocket"
)

// What the phone itself is playing, outside Spotify: YouTube, a podcast app,
// anything with a media session. The companion app reads the phone's active
// media session and sends it over the same connection as navigation; the art
// comes along as a data URL once per change and is served from here, so the
// event the UI gets on every play/pause stays small.

const (
	// the phone's media changed (track, play state, app); art is at /phone/media/art
	ApiEventTypePhoneMedia ApiEventType = "phone/media"

	phoneMediaMaxArtBytes = 192 << 10
	phoneMediaMaxText     = 300
)

// PhoneMedia is /phone/media and the phone/media event
type PhoneMedia struct {
	// a media session is up on the phone (and the companion app is connected)
	Present bool `json:"present"`
	// package and label of the app that owns the session, e.g. "YouTube"
	App     string `json:"app,omitempty"`
	AppName string `json:"app_name,omitempty"`
	Title   string `json:"title,omitempty"`
	Artist  string `json:"artist,omitempty"`
	Album   string `json:"album,omitempty"`
	Playing bool   `json:"playing"`
	// position at PositionAt (epoch ms); the UI runs the clock on from there while playing
	PositionMs int64 `json:"position_ms"`
	PositionAt int64 `json:"position_at"`
	DurationMs int64 `json:"duration_ms"`
	// the app takes a seek (YouTube does, most radio apps don't)
	CanSeek bool `json:"can_seek"`
	// changes with the cover; empty when there is none and the UI draws a gradient
	ArtId     string `json:"art_id,omitempty"`
	UpdatedAt int64  `json:"updated_at"`
}

// phoneMediaMessage is a "media" message from the companion app
type phoneMediaMessage struct {
	Present    bool   `json:"present"`
	App        string `json:"app"`
	AppName    string `json:"app_name"`
	Title      string `json:"title"`
	Artist     string `json:"artist"`
	Album      string `json:"album"`
	Playing    bool   `json:"playing"`
	PositionMs int64  `json:"position_ms"`
	DurationMs int64  `json:"duration_ms"`
	CanSeek    bool   `json:"can_seek"`
	// data:image/jpeg;base64,... when the cover changed; absent keeps the last one, "" clears it
	Art *string `json:"art"`
}

var phoneMediaActions = map[string]bool{
	"play": true, "pause": true, "toggle": true, "next": true, "prev": true,
	"volume_up": true, "volume_down": true,
}

var ErrBadMediaAction = errors.New("unknown media action")

func (n *navRelay) Media() PhoneMedia {
	n.mu.Lock()
	defer n.mu.Unlock()
	return n.media
}

func (n *navRelay) MediaArt() ([]byte, string) {
	n.mu.Lock()
	defer n.mu.Unlock()
	return n.mediaArt, n.mediaArtType
}

// MediaControl forwards a transport or volume command to the phone's session
func (n *navRelay) MediaControl(ctx context.Context, action string) error {
	if !phoneMediaActions[action] {
		return ErrBadMediaAction
	}
	n.mu.Lock()
	c := n.conn
	n.mu.Unlock()
	if c == nil {
		return ErrNoNavPhone
	}
	msg, _ := json.Marshal(map[string]string{"type": "media_control", "action": action})
	return c.Write(ctx, websocket.MessageText, msg)
}

// MediaSeek moves the phone's player to a position, clamped to the track
func (n *navRelay) MediaSeek(ctx context.Context, positionMs int64) error {
	n.mu.Lock()
	c := n.conn
	media := n.media
	n.mu.Unlock()
	if c == nil {
		return ErrNoNavPhone
	}
	if !media.Present || !media.CanSeek {
		return ErrBadMediaAction
	}
	positionMs = min(max(positionMs, 0), media.DurationMs)
	msg, _ := json.Marshal(map[string]any{"type": "media_control", "action": "seek", "position_ms": positionMs})
	if err := c.Write(ctx, websocket.MessageText, msg); err != nil {
		return err
	}
	// show the new spot now rather than when the phone's next update lands
	n.mu.Lock()
	if n.media.Present {
		n.media.PositionMs, n.media.PositionAt = positionMs, time.Now().UnixMilli()
		n.media.UpdatedAt = n.media.PositionAt
	}
	snapshot := n.media
	n.mu.Unlock()
	if n.emit != nil {
		n.emit(&ApiEvent{Type: ApiEventTypePhoneMedia, Data: snapshot})
	}
	return nil
}

func (n *navRelay) applyMedia(msg phoneMediaMessage) {
	var art []byte
	artType := ""
	artGiven := msg.Art != nil
	if artGiven && *msg.Art != "" {
		art, artType = decodeArtDataURL(*msg.Art)
	}

	n.mu.Lock()
	before := n.media
	if !msg.Present {
		n.media = PhoneMedia{}
		n.mediaArt, n.mediaArtType = nil, ""
	} else {
		m := PhoneMedia{
			Present:    true,
			App:        clipRunes(msg.App, phoneMediaMaxText),
			AppName:    clipRunes(msg.AppName, phoneMediaMaxText),
			Title:      clipRunes(msg.Title, phoneMediaMaxText),
			Artist:     clipRunes(msg.Artist, phoneMediaMaxText),
			Album:      clipRunes(msg.Album, phoneMediaMaxText),
			Playing:    msg.Playing,
			PositionMs: max(0, msg.PositionMs),
			PositionAt: time.Now().UnixMilli(),
			DurationMs: max(0, msg.DurationMs),
			CanSeek:    msg.CanSeek && msg.DurationMs > 0,
			ArtId:      before.ArtId,
		}
		if artGiven {
			n.mediaArt, n.mediaArtType = art, artType
			m.ArtId = ""
			if art != nil {
				sum := sha1.Sum(art)
				m.ArtId = hex.EncodeToString(sum[:8])
			}
		}
		n.media = m
	}
	changed := mediaChanged(before, n.media)
	if changed {
		n.media.UpdatedAt = time.Now().UnixMilli()
	}
	snapshot := n.media
	n.mu.Unlock()

	if changed && n.emit != nil {
		n.emit(&ApiEvent{Type: ApiEventTypePhoneMedia, Data: snapshot})
	}
}

// clearMedia drops the phone's media with the connection that carried it
func (n *navRelay) clearMedia() {
	n.applyMedia(phoneMediaMessage{Present: false})
}

// a position report alone (same track, same state) is not worth an event; the
// UI's clock already has it, and the phone resends on every seek
func mediaChanged(a, b PhoneMedia) bool {
	a.UpdatedAt, b.UpdatedAt = 0, 0
	if a.Playing == b.Playing && a.Title == b.Title && a.Artist == b.Artist && a.App == b.App {
		drift := (b.PositionMs - a.PositionMs) - (b.PositionAt - a.PositionAt)
		if !a.Playing {
			drift = b.PositionMs - a.PositionMs
		}
		if drift > -1500 && drift < 1500 {
			a.PositionMs, a.PositionAt = b.PositionMs, b.PositionAt
		}
	}
	return a != b
}

// decodeArtDataURL takes a jpeg/png data URL; anything else (or too big) is no art
func decodeArtDataURL(u string) ([]byte, string) {
	for _, t := range []string{"image/jpeg", "image/png"} {
		prefix := "data:" + t + ";base64,"
		if strings.HasPrefix(u, prefix) {
			b, err := base64.StdEncoding.DecodeString(u[len(prefix):])
			if err != nil || len(b) == 0 || len(b) > phoneMediaMaxArtBytes {
				return nil, ""
			}
			return b, t
		}
	}
	return nil, ""
}

func (s *ConcreteApiServer) registerPhoneMediaRoutes(m *http.ServeMux) {
	s.registerPhoneVoiceRoutes(m)
	s.registerPhoneServiceRoutes(m)
	handler := func() NavHandler {
		s.navMu.RLock()
		defer s.navMu.RUnlock()
		return s.navFn
	}
	s.registerDriveRoutes(m, handler)
	s.registerCallRoutes(m, handler)
	s.registerBatteryRoutes(m, handler)
	s.registerRouteRoutes(m, handler)
	s.registerVizRoutes(m, handler)
	m.HandleFunc("GET /phone/media", func(w http.ResponseWriter, r *http.Request) {
		h := handler()
		if h == nil {
			w.WriteHeader(http.StatusServiceUnavailable)
			return
		}
		w.Header().Set("Content-Type", "application/json")
		_ = json.NewEncoder(w).Encode(h.Media())
	})
	m.HandleFunc("GET /phone/media/art", func(w http.ResponseWriter, r *http.Request) {
		h := handler()
		if h == nil {
			w.WriteHeader(http.StatusServiceUnavailable)
			return
		}
		art, typ := h.MediaArt()
		if art == nil {
			w.WriteHeader(http.StatusNotFound)
			return
		}
		w.Header().Set("Content-Type", typ)
		// the UI bakes it into a blurred backdrop in a canvas, which needs CORS
		w.Header().Set("Access-Control-Allow-Origin", "*")
		// the UI asks with ?v=<art_id>, so a URL never changes meaning
		w.Header().Set("Cache-Control", "max-age=3600")
		_, _ = w.Write(art)
	})
	// 400 for an unknown action, 503 with no phone app to send it to
	m.HandleFunc("POST /phone/media/control", func(w http.ResponseWriter, r *http.Request) {
		var body struct {
			Action string `json:"action"`
			// with action "seek"
			PositionMs int64 `json:"position_ms"`
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
		var err error
		if body.Action == "seek" {
			err = h.MediaSeek(r.Context(), body.PositionMs)
		} else {
			err = h.MediaControl(r.Context(), body.Action)
		}
		switch {
		case errors.Is(err, ErrBadMediaAction):
			w.WriteHeader(http.StatusBadRequest)
		case err != nil:
			w.WriteHeader(http.StatusServiceUnavailable)
		default:
			w.WriteHeader(http.StatusNoContent)
		}
	})
}
