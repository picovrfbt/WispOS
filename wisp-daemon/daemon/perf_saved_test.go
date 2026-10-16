package daemon

import (
	"encoding/json"
	"os"
	"path/filepath"
	"strings"
	"testing"

	librespot "github.com/devgianlu/go-librespot"
)

func testPerf(t *testing.T) (*perfMode, string) {
	root := t.TempDir()
	pol := filepath.Join(root, "sys/devices/system/cpu/cpufreq/policy0")
	_ = os.MkdirAll(pol, 0o755)
	_ = os.WriteFile(filepath.Join(pol, "scaling_governor"), []byte("schedutil\n"), 0o644)
	p := newPerfMode(&librespot.NullLogger{})
	p.root = root
	p.chromeState = filepath.Join(root, "Local State")
	_ = os.WriteFile(p.chromeState, []byte(`{"browser":{"enabled_labs_experiments":["some-flag"]},"other":1}`), 0o600)
	p.restartChrome = func(edit func()) { edit() }
	p.run = func(string, ...string) error { return nil }
	p.renice = func(int) {}
	return p, pol
}

func TestPerformanceModeOnAndBack(t *testing.T) {
	p, pol := testPerf(t)
	restarts := 0
	p.restartChrome = func(edit func()) { restarts++; edit() }

	p.Set(true)
	if g, _ := os.ReadFile(filepath.Join(pol, "scaling_governor")); strings.TrimSpace(string(g)) != "performance" {
		t.Fatalf("governor: %q", g)
	}
	b, _ := os.ReadFile(p.chromeState)
	var st map[string]any
	_ = json.Unmarshal(b, &st)
	labs := labsOf(st)
	if !strings.Contains(strings.Join(labs, ","), "enable-gpu-rasterization@1") || !strings.Contains(strings.Join(labs, ","), "some-flag") {
		t.Fatalf("flags should add ours and keep others: %v", labs)
	}
	if st["other"] == nil {
		t.Fatal("the rest of Local State must be kept")
	}
	p.Set(true)
	if restarts != 1 {
		t.Fatalf("the screen restarts only when the setting changes, got %d", restarts)
	}

	p.Set(false)
	if g, _ := os.ReadFile(filepath.Join(pol, "scaling_governor")); strings.TrimSpace(string(g)) != "schedutil" {
		t.Fatalf("governor should go back, got %q", g)
	}
	b, _ = os.ReadFile(p.chromeState)
	_ = json.Unmarshal(b, &st)
	if got := strings.Join(labsOf(st), ","); got != "some-flag" {
		t.Fatalf("our flags out, the user's kept: %q", got)
	}
}

func TestPerformanceModeOffAtStartLeavesTheBrowserAlone(t *testing.T) {
	p, _ := testPerf(t)
	restarts := 0
	p.restartChrome = func(edit func()) { restarts++; edit() }
	p.Set(false)
	if restarts != 0 {
		t.Fatal("nothing to change, so no screen restart")
	}
}

func TestChromePids(t *testing.T) {
	proc := t.TempDir()
	for pid, name := range map[string]string{"10": "chrome", "11": "go-librespot", "12": "chromium"} {
		_ = os.MkdirAll(filepath.Join(proc, pid), 0o755)
		_ = os.WriteFile(filepath.Join(proc, pid, "comm"), []byte(name+"\n"), 0o644)
	}
	if got := chromePids(proc); len(got) != 2 {
		t.Fatalf("the browser's processes only, got %v", got)
	}
}

func TestPerformanceModeDefaultsOn(t *testing.T) {
	for body, want := range map[string]bool{
		``:                          true,
		`{}`:                        true,
		`{"performanceMode":true}`:  true,
		`{"performanceMode":false}`: false,
	} {
		if got := performanceFromSettings([]byte(body)); got != want {
			t.Errorf("%q: got %v want %v", body, got, want)
		}
	}
}
