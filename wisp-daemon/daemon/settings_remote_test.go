package daemon

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"sort"
	"strings"
	"testing"
	"time"

	"github.com/coder/websocket"
	librespot "github.com/devgianlu/go-librespot"
)

func TestMergeRemoteSettingsAppliesWhatTheCarThingAllows(t *testing.T) {
	current := []byte(`{"v":1,"brightness":5,"autoBrightness":true,"presets":{"1":{"kind":"playlist"}},"nightMode":"off"}`)
	patch := []byte(`{"brightness":8,"autoBrightness":false,"nightMode":"auto","voiceSpeed":1.3,"lyricOffsetMs":-150,"uiScalePct":110}`)
	out, refused, err := mergeRemoteSettings(current, patch)
	if err != nil || len(refused) > 0 {
		t.Fatalf("err %v, refused %v", err, refused)
	}
	var got map[string]any
	if err := json.Unmarshal(out, &got); err != nil {
		t.Fatal(err)
	}
	want := map[string]any{"brightness": 8.0, "autoBrightness": false, "nightMode": "auto", "voiceSpeed": 1.3, "lyricOffsetMs": -150.0, "uiScalePct": 110.0, "v": 1.0}
	for k, v := range want {
		if got[k] != v {
			t.Errorf("%s = %v, want %v", k, got[k], v)
		}
	}
	// what the phone can't set is kept as it was
	if _, ok := got["presets"]; !ok {
		t.Error("presets lost")
	}
}

func TestMergeRemoteSettingsRefusesWhatItDoesNotAllow(t *testing.T) {
	current := []byte(`{"v":1,"brightness":5}`)
	patch := []byte(`{"brightness":11,"uiScalePct":112,"nightMode":"sometimes","presets":{},"checkinConsent":"granted","voiceSpeed":"fast","showLyrics":"yes"}`)
	out, refused, err := mergeRemoteSettings(current, patch)
	if err != nil {
		t.Fatal(err)
	}
	if out != nil {
		t.Errorf("nothing valid, yet it wrote %s", out)
	}
	sort.Strings(refused)
	want := []string{"brightness", "checkinConsent", "nightMode", "presets", "showLyrics", "uiScalePct", "voiceSpeed"}
	if len(refused) != len(want) {
		t.Fatalf("refused %v, want %v", refused, want)
	}
	for i := range want {
		if refused[i] != want[i] {
			t.Fatalf("refused %v, want %v", refused, want)
		}
	}
}

func TestMergeRemoteSettingsKeepsGoodChangesBesideBadOnes(t *testing.T) {
	out, refused, err := mergeRemoteSettings([]byte(`{"v":1}`), []byte(`{"tempUnit":"C","brightness":0}`))
	if err != nil || len(refused) != 1 || refused[0] != "brightness" {
		t.Fatalf("err %v refused %v", err, refused)
	}
	var got map[string]any
	_ = json.Unmarshal(out, &got)
	if got["tempUnit"] != "C" {
		t.Errorf("tempUnit %v", got["tempUnit"])
	}
}

func TestMergeRemoteSettingsNeedsTheCarThingsOwnFirst(t *testing.T) {
	if _, _, err := mergeRemoteSettings(nil, []byte(`{"brightness":3}`)); err != errNoSettingsYet {
		t.Fatalf("err %v", err)
	}
}

func TestMergeRemoteSettingsMakesFirstBootDefaultsAChoice(t *testing.T) {
	out, _, err := mergeRemoteSettings([]byte(`{"v":1,"seeded_defaults":true}`), []byte(`{"brightness":3}`))
	if err != nil {
		t.Fatal(err)
	}
	// a phone change is the user's: kept, and backed up to the phone
	if !userSettings(out) {
		t.Errorf("still marked as defaults: %s", out)
	}
}

func TestRemoteSettingsKeepWholeNumbersWhole(t *testing.T) {
	out, _, _ := mergeRemoteSettings([]byte(`{"v":1}`), []byte(`{"volumeStepPct":4,"voiceVolumePct":60}`))
	if string(out) != `{"v":1,"voiceVolumePct":60,"volumeStepPct":4}` {
		t.Errorf("got %s", out)
	}
}

// the phone's settings page, over the real link: what it sends reaches the handler
func TestNavRelayPassesThePhonesSettingsOn(t *testing.T) {
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		c, err := websocket.Accept(w, r, nil)
		if err != nil {
			return
		}
		defer func() { _ = c.CloseNow() }()
		_ = c.Write(r.Context(), websocket.MessageText, []byte(`{"type":"settings_set","settings":{"brightness":7}}`))
		<-r.Context().Done()
	}))
	defer srv.Close()

	got := make(chan string, 1)
	n := newNavRelay(NavConfig{Enabled: true, PhoneURL: "ws" + strings.TrimPrefix(srv.URL, "http") + "/nav"},
		&librespot.NullLogger{}, (&navEvents{}).emit, func() string { return "" })
	n.onSettingsSet = func(patch []byte) { got <- string(patch) }
	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()
	go n.run(ctx)

	select {
	case p := <-got:
		if p != `{"brightness":7}` {
			t.Fatalf("patch %s", p)
		}
	case <-time.After(3 * time.Second):
		t.Fatal("the phone's settings never arrived")
	}
}
