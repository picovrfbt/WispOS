package daemon

import (
	"os"
	"path/filepath"
	"strings"
	"testing"

	librespot "github.com/devgianlu/go-librespot"
)

func fakeZone(t *testing.T, root string, i int, name string, milliC string) {
	t.Helper()
	d := filepath.Join(root, "sys/class/thermal", "thermal_zone"+string(rune('0'+i)))
	_ = os.MkdirAll(d, 0o755)
	_ = os.WriteFile(filepath.Join(d, "type"), []byte(name+"\n"), 0o644)
	_ = os.WriteFile(filepath.Join(d, "temp"), []byte(milliC+"\n"), 0o644)
	_ = os.WriteFile(filepath.Join(d, "trip_point_0_temp"), []byte("85000\n"), 0o644)
	_ = os.WriteFile(filepath.Join(d, "trip_point_0_type"), []byte("passive\n"), 0o644)
}

func TestThermalHotWithAGap(t *testing.T) {
	root := t.TempDir()
	tw := newThermalWatch(&librespot.NullLogger{}, nil)
	tw.root = root
	var told []bool
	tw.onHot = func(h bool) { told = append(told, h) }

	fakeZone(t, root, 0, "soc_thermal", "41700")
	fakeZone(t, root, 1, "ddr_thermal", "41800")
	st := tw.check()
	if len(st.Zones) != 2 || st.Zones[0].TempC != 41.7 || st.Hot || st.Zones[0].Trips[0].Type != "passive" {
		t.Fatalf("readings: %+v", st)
	}
	for _, step := range []struct {
		milli string
		hot   bool
	}{{"85200", true}, {"80000", true}, {"74000", false}} {
		fakeZone(t, root, 0, "soc_thermal", step.milli)
		if got := tw.check().Hot; got != step.hot {
			t.Fatalf("at %s hot=%v, want %v", step.milli, got, step.hot)
		}
	}
	if len(told) != 2 || !told[0] || told[1] {
		t.Fatalf("told hot then cool once each, got %v", told)
	}
}

func TestPerformanceModeStepsAsideWhenHotAndRestoresExactly(t *testing.T) {
	p, pol := testPerf(t)
	gov := filepath.Join(pol, "scaling_governor")
	p.Set(true)
	if p.SetHot(true) != true {
		t.Fatal("on and hot: it steps aside")
	}
	if g, _ := os.ReadFile(gov); strings.TrimSpace(string(g)) != "schedutil" {
		t.Fatalf("hot: back to the original, got %q", g)
	}
	p.SetHot(false)
	if g, _ := os.ReadFile(gov); strings.TrimSpace(string(g)) != "performance" {
		t.Fatalf("cooled: full speed again, got %q", g)
	}

	// a restart in between: the original comes back from disk, not a guess
	_ = os.WriteFile(filepath.Join(pol, "scaling_available_governors"), []byte("ondemand conservative\n"), 0o644)
	q := newPerfMode(&librespot.NullLogger{})
	q.root, q.chromeState, q.restartChrome = p.root, p.chromeState, func(edit func()) { edit() }
	q.run = func(string, ...string) error { return nil }
	q.renice = func(int) {}
	q.Set(false)
	if g, _ := os.ReadFile(gov); strings.TrimSpace(string(g)) != "schedutil" {
		t.Fatalf("restored from the saved one, got %q", g)
	}
}
