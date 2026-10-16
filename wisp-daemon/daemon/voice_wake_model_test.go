package daemon

import (
	"os"
	"path/filepath"
	"strings"
	"testing"

	librespot "github.com/devgianlu/go-librespot"
)

func wakeTestService(t *testing.T, model string, files ...string) (*voiceService, string) {
	t.Helper()
	dir := t.TempDir()
	for _, f := range files {
		if err := os.WriteFile(filepath.Join(dir, f), nil, 0o644); err != nil {
			t.Fatal(err)
		}
	}
	app := &App{log: &librespot.NullLogger{}}
	return &voiceService{app: app, cfg: VoiceConfig{ModelDir: dir, WakeModel: model}}, dir
}

func TestWakeModelPath(t *testing.T) {
	v, dir := wakeTestService(t, "hey_roadie.tflite", "hey_mira.tflite", "hey_roadie.tflite")
	if got := v.wakeModelPath(); got != filepath.Join(dir, "hey_roadie.tflite") {
		t.Fatalf("custom model: got %s", got)
	}

	v, dir = wakeTestService(t, "", "hey_mira.tflite")
	if got := v.wakeModelPath(); got != filepath.Join(dir, "hey_mira.tflite") {
		t.Fatalf("unset with only Mira's shipped: got %s", got)
	}

	// Wisp's own wake word wins when both are shipped
	v, dir = wakeTestService(t, "", "hey_mira.tflite", "okay_wisp.tflite")
	if got := v.wakeModelPath(); got != filepath.Join(dir, "okay_wisp.tflite") {
		t.Fatalf("unset should be Okay Wisp: got %s", got)
	}
	v, dir = wakeTestService(t, "hey_roadi.tflite", "hey_mira.tflite", "okay_wisp.tflite")
	if got := v.wakeModelPath(); got != filepath.Join(dir, "okay_wisp.tflite") {
		t.Fatalf("a typo should fall back to Okay Wisp: got %s", got)
	}

	// a typo must not leave the device deaf
	v, dir = wakeTestService(t, "hey_roadi.tflite", "hey_mira.tflite")
	if got := v.wakeModelPath(); got != filepath.Join(dir, "hey_mira.tflite") {
		t.Fatalf("missing model should fall back: got %s", got)
	}

	abs := filepath.Join(t.TempDir(), "custom.tflite")
	_ = os.WriteFile(abs, nil, 0o644)
	v, _ = wakeTestService(t, abs, "hey_mira.tflite")
	if got := v.wakeModelPath(); got != abs {
		t.Fatalf("absolute path: got %s", got)
	}
}

func TestSherpaArgs(t *testing.T) {
	dir := t.TempDir()
	md := filepath.Join(dir, "zipformer", "small")
	if err := os.MkdirAll(md, 0o755); err != nil {
		t.Fatal(err)
	}
	// Mira's server: everything in order
	old := sherpaArgs("sherpa_asr_server", md, "e", "d", "j", "t")
	if len(old) != 6 || old[0] != "e" || old[5] != sherpaMethod {
		t.Fatalf("positional args: %v", old)
	}
	// Wisp's: named, with the settings file when it's there
	got := strings.Join(sherpaArgs("wisp_asr_server", md, "e", "d", "j", "t"), " ")
	if !strings.Contains(got, "--type offline-transducer --encoder e --decoder d --joiner j --tokens t") || strings.Contains(got, "--provider-config") {
		t.Fatalf("named args: %s", got)
	}
	conf := filepath.Join(dir, "zipformer", "ort.conf")
	if err := os.WriteFile(conf, []byte("EnableCpuMemArena=0"), 0o644); err != nil {
		t.Fatal(err)
	}
	if got := strings.Join(sherpaArgs("wisp_asr_server", md, "e", "d", "j", "t"), " "); !strings.Contains(got, "--provider-config "+conf) {
		t.Fatalf("settings file not passed: %s", got)
	}
}

func TestSpeechModelMemoryRules(t *testing.T) {
	if !memPressured(40, 0) || !memPressured(300, 22) || memPressured(150, 2) || memPressured(-1, 0) {
		t.Fatal("pressure rule")
	}
	if !canAutoReload(250, 0) || canAutoReload(150, 0) || canAutoReload(250, 5) {
		t.Fatal("reload rule")
	}
	psi := "some avg10=31.50 avg60=20.00 avg300=5.00 total=1\nfull avg10=22.04 avg60=9.10 avg300=2.00 total=1\n"
	if got := parseFullAvg10(psi); got != 22.04 {
		t.Fatalf("psi: %v", got)
	}
}
