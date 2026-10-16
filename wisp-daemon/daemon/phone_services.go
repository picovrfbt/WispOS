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

// Music services beside Spotify (YouTube Music), through the companion app.
// Their libraries are read on the phone, which holds the sign-in; this asks it
// for a page and passes the answer (names, covers, ids) to the UI, and asks it
// to play something, which it opens in the service's own app.

// MusicService is one service as Home's source switch sees it
type MusicService struct {
	Id       string                `json:"id"`
	Name     string                `json:"name"`
	Enabled  bool                  `json:"enabled"`
	SignedIn bool                  `json:"signed_in"`
	Sections []MusicServiceSection `json:"sections,omitempty"`
}

type MusicServiceSection struct {
	Id   string `json:"id"`
	Name string `json:"name"`
}

const serviceBrowseTimeout = 25 * time.Second

var ErrServiceFailed = errors.New("the music service couldn't load that")

// serviceReply is the phone's "svc_items" answer to one request
type serviceReply struct {
	Items json.RawMessage `json:"items"`
	Error string          `json:"error"`
	// for svc_now and svc_like: the song playing, by the service's id, and whether it's liked
	Current string `json:"current,omitempty"`
	Liked   *bool  `json:"liked,omitempty"`
	// the song's shape, 0-100 heights, where the service has one (SoundCloud)
	Waveform []int `json:"waveform,omitempty"`
	// the song's cover, for an app that doesn't hand its own to the phone
	Image string `json:"image,omitempty"`
}

// ServiceNow is /services/now: the song playing in a service's app on the
// phone, whether it's liked there, and what's up next
type ServiceNow struct {
	Service string          `json:"service"`
	Current string          `json:"current,omitempty"`
	Liked   *bool           `json:"liked,omitempty"`
	Items   json.RawMessage `json:"items"`
	// for a waveform progress bar (SoundCloud)
	Waveform []int `json:"waveform,omitempty"`
	// the cover by link, when the phone's app sent none
	Image string `json:"image,omitempty"`
}

var ErrNotAService = errors.New("the phone isn't playing a music service Wisp reads")

// serviceOfApp is the music service whose app (any build of it) this package is
func serviceOfApp(pkg string) string {
	switch {
	case strings.Contains(pkg, "youtube.music"):
		return "ytmusic"
	case strings.Contains(pkg, "soundcloud"):
		return "soundcloud"
	}
	return ""
}

func (n *navRelay) applyServices(services []MusicService) {
	if len(services) > 8 {
		services = services[:8]
	}
	for i := range services {
		services[i].Name = clipRunes(services[i].Name, 40)
	}
	n.update(func(s *NavState) { s.Services = services })
}

// ServiceBrowse asks the phone for one page of a service's library, or a
// search when id is "search:<kind>:<words>"
func (n *navRelay) ServiceBrowse(ctx context.Context, service, id string) (json.RawMessage, error) {
	r, err := n.askPhone(ctx, map[string]any{"type": "svc_browse", "service": service, "id": id})
	if err != nil {
		return nil, err
	}
	if len(r.Items) == 0 {
		return json.RawMessage("[]"), nil
	}
	return r.Items, nil
}

// ServiceNow asks the phone about the song playing in a service's app
func (n *navRelay) ServiceNow(ctx context.Context) (ServiceNow, error) {
	m := n.Media()
	svc := serviceOfApp(m.App)
	if !m.Present || svc == "" || m.Title == "" {
		return ServiceNow{}, ErrNotAService
	}
	r, err := n.askPhone(ctx, map[string]any{
		"type": "svc_now", "service": svc, "title": m.Title, "artist": m.Artist, "app": m.App,
	})
	if err != nil {
		return ServiceNow{}, err
	}
	items := r.Items
	if len(items) == 0 {
		items = json.RawMessage("[]")
	}
	wave := r.Waveform
	if len(wave) > 400 {
		wave = nil
	}
	for i, h := range wave {
		wave[i] = max(0, min(100, h))
	}
	img := r.Image
	if !strings.HasPrefix(img, "https://") || len(img) > 500 {
		img = ""
	}
	return ServiceNow{Service: svc, Current: r.Current, Liked: r.Liked, Items: items, Waveform: wave, Image: img}, nil
}

// ServiceLike likes (or un-likes) a song in the service's library
func (n *navRelay) ServiceLike(ctx context.Context, service, current string, like bool) error {
	_, err := n.askPhone(ctx, map[string]any{"type": "svc_like", "service": service, "current": current, "like": like})
	return err
}

// askPhone sends one request and waits for the phone's svc_items answer to it
func (n *navRelay) askPhone(ctx context.Context, payload map[string]any) (serviceReply, error) {
	n.mu.Lock()
	c := n.conn
	if c == nil {
		n.mu.Unlock()
		return serviceReply{}, ErrNoNavPhone
	}
	n.svcSeq++
	req := n.svcSeq
	ch := make(chan serviceReply, 1)
	if n.svcWaiting == nil {
		n.svcWaiting = map[int]chan serviceReply{}
	}
	n.svcWaiting[req] = ch
	n.mu.Unlock()
	defer func() {
		n.mu.Lock()
		delete(n.svcWaiting, req)
		n.mu.Unlock()
	}()

	payload["req"] = req
	msg, _ := json.Marshal(payload)
	wctx, cancel := context.WithTimeout(ctx, 5*time.Second)
	err := c.Write(wctx, websocket.MessageText, msg)
	cancel()
	if err != nil {
		return serviceReply{}, err
	}
	select {
	case r := <-ch:
		if r.Error != "" {
			return serviceReply{}, errors.New(r.Error)
		}
		return r, nil
	case <-ctx.Done():
		return serviceReply{}, ctx.Err()
	case <-time.After(serviceBrowseTimeout):
		return serviceReply{}, ErrServiceFailed
	}
}

// deliverServiceReply hands the phone's answer to whoever asked
func (n *navRelay) deliverServiceReply(req int, r serviceReply) {
	n.mu.Lock()
	ch := n.svcWaiting[req]
	n.mu.Unlock()
	if ch != nil {
		select {
		case ch <- r:
		default:
		}
	}
}

// ServicePlay asks the phone to play a playlist (or a song) in the service's app;
// title is the song's, so the phone can check that one is what started
func (n *navRelay) ServicePlay(ctx context.Context, service, playlist, video, title string) error {
	n.mu.Lock()
	c := n.conn
	n.mu.Unlock()
	if c == nil {
		return ErrNoNavPhone
	}
	msg, _ := json.Marshal(map[string]any{
		"type": "svc_play", "service": service, "playlist": playlist, "video": video, "title": title,
	})
	return c.Write(ctx, websocket.MessageText, msg)
}

func validServiceID(s string) bool {
	if s == "" || len(s) > 32 {
		return false
	}
	for _, r := range s {
		if !(r >= 'a' && r <= 'z' || r >= '0' && r <= '9' || r == '-' || r == '_') {
			return false
		}
	}
	return true
}

func (s *ConcreteApiServer) registerPhoneServiceRoutes(m *http.ServeMux) {
	handler := func() NavHandler {
		s.navMu.RLock()
		defer s.navMu.RUnlock()
		return s.navFn
	}
	m.HandleFunc("GET /services/{service}/browse", func(w http.ResponseWriter, r *http.Request) {
		svc := r.PathValue("service")
		id := strings.TrimSpace(r.URL.Query().Get("id"))
		if !validServiceID(svc) || id == "" || len(id) > 200 {
			w.WriteHeader(http.StatusBadRequest)
			return
		}
		h := handler()
		if h == nil {
			w.WriteHeader(http.StatusServiceUnavailable)
			return
		}
		items, err := h.ServiceBrowse(r.Context(), svc, id)
		w.Header().Set("Content-Type", "application/json")
		switch {
		case errors.Is(err, ErrNoNavPhone):
			w.WriteHeader(http.StatusServiceUnavailable)
			_, _ = w.Write([]byte(`{"error":"phone not connected"}`))
		case err != nil:
			w.WriteHeader(http.StatusBadGateway)
			_ = json.NewEncoder(w).Encode(map[string]string{"error": clipRunes(err.Error(), 160)})
		default:
			_, _ = w.Write([]byte(`{"items":`))
			_, _ = w.Write(items)
			_, _ = w.Write([]byte(`}`))
		}
	})
	// the song playing in a service's app: 404 when the phone isn't playing one
	m.HandleFunc("GET /services/now", func(w http.ResponseWriter, r *http.Request) {
		h := handler()
		if h == nil {
			w.WriteHeader(http.StatusServiceUnavailable)
			return
		}
		now, err := h.ServiceNow(r.Context())
		w.Header().Set("Content-Type", "application/json")
		switch {
		case errors.Is(err, ErrNotAService):
			w.WriteHeader(http.StatusNotFound)
			_, _ = w.Write([]byte(`{"error":"not a music service"}`))
		case errors.Is(err, ErrNoNavPhone):
			w.WriteHeader(http.StatusServiceUnavailable)
			_, _ = w.Write([]byte(`{"error":"phone not connected"}`))
		case err != nil:
			w.WriteHeader(http.StatusBadGateway)
			_ = json.NewEncoder(w).Encode(map[string]string{"error": clipRunes(err.Error(), 160)})
		default:
			_ = json.NewEncoder(w).Encode(now)
		}
	})
	m.HandleFunc("POST /services/{service}/like", func(w http.ResponseWriter, r *http.Request) {
		svc := r.PathValue("service")
		var body struct {
			Current string `json:"current"`
			Like    bool   `json:"like"`
		}
		if !validServiceID(svc) || jsonDecode(r, &body) != nil || body.Current == "" || len(body.Current) > 100 {
			w.WriteHeader(http.StatusBadRequest)
			return
		}
		h := handler()
		if h == nil {
			w.WriteHeader(http.StatusServiceUnavailable)
			return
		}
		if err := h.ServiceLike(r.Context(), svc, body.Current, body.Like); err != nil {
			w.Header().Set("Content-Type", "application/json")
			w.WriteHeader(http.StatusBadGateway)
			_ = json.NewEncoder(w).Encode(map[string]string{"error": clipRunes(err.Error(), 160)})
			return
		}
		w.Header().Set("Content-Type", "application/json")
		_ = json.NewEncoder(w).Encode(map[string]bool{"liked": body.Like})
	})
	m.HandleFunc("POST /services/{service}/play", func(w http.ResponseWriter, r *http.Request) {
		svc := r.PathValue("service")
		var body struct {
			Playlist string `json:"playlist"`
			Video    string `json:"video"`
			Title    string `json:"title"`
		}
		if !validServiceID(svc) || jsonDecode(r, &body) != nil || (body.Playlist == "" && body.Video == "") {
			w.WriteHeader(http.StatusBadRequest)
			return
		}
		h := handler()
		if h == nil {
			w.WriteHeader(http.StatusServiceUnavailable)
			return
		}
		if err := h.ServicePlay(r.Context(), svc, clipRunes(body.Playlist, 100), clipRunes(body.Video, 40), clipRunes(body.Title, 200)); err != nil {
			w.WriteHeader(http.StatusServiceUnavailable)
			return
		}
		w.WriteHeader(http.StatusNoContent)
	})
}
