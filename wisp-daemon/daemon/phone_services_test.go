package daemon

import (
	"context"
	"encoding/json"
	"fmt"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"

	"github.com/coder/websocket"
	librespot "github.com/devgianlu/go-librespot"
)

// a fake companion app: says what it offers, answers a browse, and refuses a bad one
func TestServiceBrowseRoundTrip(t *testing.T) {
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		c, err := websocket.Accept(w, r, nil)
		if err != nil {
			return
		}
		defer func() { _ = c.CloseNow() }()
		_ = c.Write(r.Context(), websocket.MessageText, []byte(
			`{"type":"svc_status","services":[{"id":"ytmusic","name":"YouTube Music","enabled":true,"signed_in":true,"sections":[{"id":"playlists","name":"Playlists"}]}]}`))
		for {
			_, data, err := c.Read(r.Context())
			if err != nil {
				return
			}
			var m struct {
				Type string `json:"type"`
				Req  int    `json:"req"`
				Id   string `json:"id"`
			}
			_ = json.Unmarshal(data, &m)
			if m.Type == "svc_now" {
				_ = c.Write(r.Context(), websocket.MessageText, []byte(`{"type":"svc_items","req":`+itoa(m.Req)+
					`,"current":"v1","liked":true,"waveform":[5,120,-3],"items":[{"name":"Next One","video":"v2"}]}`))
				continue
			}
			if m.Type == "svc_like" {
				_ = c.Write(r.Context(), websocket.MessageText, []byte(`{"type":"svc_items","req":`+itoa(m.Req)+`,"items":[],"liked":false}`))
				continue
			}
			if m.Type != "svc_browse" {
				continue
			}
			reply := `{"type":"svc_items","req":` + itoa(m.Req) + `,"items":[{"name":"Late Night Drive","playlist":"PL1"}]}`
			if m.Id == "broken" {
				reply = `{"type":"svc_items","req":` + itoa(m.Req) + `,"error":"YouTube Music signed you out"}`
			}
			_ = c.Write(r.Context(), websocket.MessageText, []byte(reply))
		}
	}))
	defer srv.Close()

	n := newNavRelay(NavConfig{Enabled: true, PhoneURL: "ws" + strings.TrimPrefix(srv.URL, "http") + "/nav"},
		&librespot.NullLogger{}, (&navEvents{}).emit, func() string { return "" })
	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()
	go n.run(ctx)

	deadline := time.Now().Add(3 * time.Second)
	for time.Now().Before(deadline) && len(n.Status().Services) == 0 {
		time.Sleep(20 * time.Millisecond)
	}
	if s := n.Status().Services; len(s) != 1 || s[0].Id != "ytmusic" || !s[0].SignedIn {
		t.Fatalf("the phone's services should reach the state, got %+v", s)
	}

	items, err := n.ServiceBrowse(ctx, "ytmusic", "playlists")
	if err != nil || !strings.Contains(string(items), "Late Night Drive") {
		t.Fatalf("browse: %s %v", items, err)
	}
	if _, err := n.ServiceBrowse(ctx, "ytmusic", "broken"); err == nil || !strings.Contains(err.Error(), "signed you out") {
		t.Fatalf("the phone's error should come back, got %v", err)
	}

	// nothing from a service playing: not asked
	if _, err := n.ServiceNow(ctx); err != ErrNotAService {
		t.Fatalf("with nothing playing there's nothing to ask, got %v", err)
	}
	n.mu.Lock()
	n.media = PhoneMedia{Present: true, App: "app.morphe.android.apps.youtube.music", Title: "Midnight City", Artist: "M83"}
	n.mu.Unlock()
	now, err := n.ServiceNow(ctx)
	if err != nil || now.Service != "ytmusic" || now.Current != "v1" || now.Liked == nil || !*now.Liked ||
		!strings.Contains(string(now.Items), "Next One") || fmt.Sprint(now.Waveform) != "[5 100 0]" {
		t.Fatalf("now: %+v %v", now, err)
	}
	if err := n.ServiceLike(ctx, "ytmusic", "v1", false); err != nil {
		t.Fatal(err)
	}
}

func TestServiceOfApp(t *testing.T) {
	for pkg, want := range map[string]string{
		"com.google.android.apps.youtube.music":   "ytmusic",
		"app.revanced.android.apps.youtube.music": "ytmusic",
		"com.soundcloud.android":                  "soundcloud",
		"com.google.android.youtube":              "",
		"com.pocketcasts":                         "",
	} {
		if got := serviceOfApp(pkg); got != want {
			t.Errorf("%s: got %q want %q", pkg, got, want)
		}
	}
	if spotifyTrackID("phone-abc") || !spotifyTrackID("4uLU6hMCjMI75M1A2tKUQC") {
		t.Fatal("only Spotify ids go to Spotify's lyrics")
	}
}

func itoa(i int) string {
	b, _ := json.Marshal(i)
	return string(b)
}
