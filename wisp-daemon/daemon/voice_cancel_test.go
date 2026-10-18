package daemon

import (
	"context"
	"testing"

	librespot "github.com/devgianlu/go-librespot"
)

// a voice service whose events land in the returned channel
func cancelTestVoice(t *testing.T, settings string) (*voiceService, chan *ApiEvent) {
	t.Helper()
	events := make(chan *ApiEvent, 32)
	srv := &ConcreteApiServer{log: &librespot.NullLogger{}}
	srv.clients = []*wsClient{{send: events}}
	app := &App{log: &librespot.NullLogger{}, server: srv, state: &librespot.AppState{}}
	if settings != "" {
		app.state.Settings = []byte(settings)
	}
	ctx, cancel := context.WithCancel(context.Background())
	t.Cleanup(cancel)
	return &voiceService{app: app, ctx: ctx, cancel: cancel, hushCh: make(chan string, 8)}, events
}

func voiceStates(events chan *ApiEvent) []string {
	var out []string
	for {
		select {
		case e := <-events:
			if d, ok := e.Data.(ApiEventDataVoice); ok {
				out = append(out, d.State)
			}
		default:
			return out
		}
	}
}

func TestListenMusicSetting(t *testing.T) {
	for body, want := range map[string]string{
		``:                        "lower",
		`{"v":1}`:                 "lower",
		`{"listenMusic":"pause"}`: "pause",
		`{"listenMusic":"off"}`:   "off",
		`{"listenMusic":"shout"}`: "lower",
		`{"listenMusic":"lower"}`: "lower",
	} {
		if got := listenMusicFromSettings([]byte(body)); got != want {
			t.Errorf("%s: got %q, want %q", body, got, want)
		}
	}
}

func TestHushLowersThenBringsTheMusicBack(t *testing.T) {
	v, _ := cancelTestVoice(t, `{"listenMusic":"pause"}`)
	v.hush(true)
	v.hush(false)
	v.hush(false) // already back: nothing more to send
	if got := []string{<-v.hushCh, <-v.hushCh}; got[0] != "pause" || got[1] != "off" {
		t.Fatalf("sent %v, want [pause off]", got)
	}
	if len(v.hushCh) != 0 {
		t.Fatal("a second 'off' was sent")
	}

	// left alone in Settings: nothing sent at all
	v, _ = cancelTestVoice(t, `{"listenMusic":"off"}`)
	v.hush(true)
	v.hush(false)
	if len(v.hushCh) != 0 {
		t.Fatal("the music was touched with the setting off")
	}
}

func TestCancelDropsWhatTheCommandWouldSay(t *testing.T) {
	v, events := cancelTestVoice(t, "")
	stopped := false
	v.busy, v.gen = true, 7
	v.activeGen.Store(7)
	v.flowCancel = func() { stopped = true }
	v.hushed.Store(true)

	v.Cancel()
	if !stopped {
		t.Fatal("the command being worked on was not stopped")
	}
	if <-v.hushCh != "off" {
		t.Fatal("the music was not brought back")
	}
	// the cancelled command finishing late says nothing
	v.emit("playing", "Some Song")
	v.emit("error", "Sorry, I didn't catch that")
	if got := voiceStates(events); len(got) != 1 || got[0] != "idle" {
		t.Fatalf("events %v, want just [idle]", got)
	}

	// the next command talks again
	v.activeGen.Store(8)
	v.emit("playing", "Next Song")
	if got := voiceStates(events); len(got) != 1 || got[0] != "playing" {
		t.Fatalf("events %v, want [playing]", got)
	}
}
