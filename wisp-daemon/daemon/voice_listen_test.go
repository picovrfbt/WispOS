package daemon

import (
	"errors"
	"testing"

	librespot "github.com/devgianlu/go-librespot"
)

func TestListenNow(t *testing.T) {
	app := &App{log: &librespot.NullLogger{}}

	// voice on, wake word off in the config: nothing to signal
	v := &voiceService{app: app, cfg: VoiceConfig{Wake: false}}
	if err := v.ListenNow(); !errors.Is(err, ErrVoiceUnavailable) {
		t.Fatalf("wake off: want ErrVoiceUnavailable, got %v", err)
	}

	// the user muted the mic
	v = &voiceService{app: app, cfg: VoiceConfig{Wake: true}}
	v.wakeEnabled.Store(false)
	if err := v.ListenNow(); !errors.Is(err, ErrVoiceMicOff) {
		t.Fatalf("mic off: want ErrVoiceMicOff, got %v", err)
	}

	// mic on but the listener isn't running (starting up, or crashed)
	v.wakeEnabled.Store(true)
	if err := v.ListenNow(); !errors.Is(err, ErrVoiceUnavailable) {
		t.Fatalf("no listener: want ErrVoiceUnavailable, got %v", err)
	}
}
