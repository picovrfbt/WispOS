package daemon

import (
	"testing"
	"time"
)

func near(t *testing.T, what string, got int64, want time.Time) {
	t.Helper()
	d := time.UnixMilli(got).Sub(want)
	if d < -6*time.Minute || d > 6*time.Minute {
		t.Fatalf("%s: got %s, want about %s", what, time.UnixMilli(got).UTC(), want.UTC())
	}
}

func TestSunNewYorkSummer(t *testing.T) {
	// New York, 2026-06-21: sunrise 5:25 EDT, sunset 20:31 EDT
	edt := time.FixedZone("EDT", -4*3600)
	noon := time.Date(2026, 6, 21, 12, 0, 0, 0, edt)
	s := sunAt(noon, 40.71, -74.01)
	if s.Night {
		t.Fatal("noon is day")
	}
	near(t, "sunrise", s.Sunrise, time.Date(2026, 6, 21, 5, 25, 0, 0, edt))
	near(t, "sunset", s.Sunset, time.Date(2026, 6, 21, 20, 31, 0, 0, edt))
	near(t, "next change", s.Next, time.Date(2026, 6, 21, 20, 31, 0, 0, edt))

	late := sunAt(time.Date(2026, 6, 21, 22, 0, 0, 0, edt), 40.71, -74.01)
	if !late.Night {
		t.Fatal("10pm is night")
	}
	near(t, "next sunrise", late.Next, time.Date(2026, 6, 22, 5, 25, 0, 0, edt))
}

func TestSunLondonWinter(t *testing.T) {
	// London, 2026-12-21: sunrise 8:04, sunset 15:54 (GMT)
	s := sunAt(time.Date(2026, 12, 21, 16, 30, 0, 0, time.UTC), 51.51, -0.13)
	if !s.Night {
		t.Fatal("half past four in December is dark")
	}
	near(t, "sunset", s.Sunset, time.Date(2026, 12, 21, 15, 54, 0, 0, time.UTC))
	near(t, "next sunrise", s.Next, time.Date(2026, 12, 22, 8, 5, 0, 0, time.UTC))
}

func TestSunPolar(t *testing.T) {
	// Tromsø in midsummer: the sun never sets
	day := sunAt(time.Date(2026, 6, 21, 23, 0, 0, 0, time.UTC), 69.65, 18.96)
	if day.Night {
		t.Fatal("midnight sun is day")
	}
	// and in midwinter it never rises
	night := sunAt(time.Date(2026, 12, 21, 11, 0, 0, 0, time.UTC), 69.65, 18.96)
	if !night.Night {
		t.Fatal("polar night is night")
	}
}
