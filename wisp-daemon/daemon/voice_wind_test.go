package daemon

import (
	"encoding/binary"
	"math"
	"math/rand"
	"os"
	"path/filepath"
	"testing"
)

const testRate = 16000

// speech-ish: a few voiced tones in the speech band, coming and going like syllables
func speechish(n int, amp float64) []float64 {
	x := make([]float64, n)
	for i := range x {
		t := float64(i) / testRate
		syll := 0.5 + 0.5*math.Sin(2*math.Pi*4*t)
		x[i] = amp * syll * (0.5*math.Sin(2*math.Pi*220*t) + 0.3*math.Sin(2*math.Pi*660*t) + 0.2*math.Sin(2*math.Pi*1500*t))
	}
	return x
}

// wind: loud low rumble (filtered noise) in gusts
func windish(n int, amp float64, seed int64) []float64 {
	r := rand.New(rand.NewSource(seed))
	x := make([]float64, n)
	lp := 0.0
	a := 1 - math.Exp(-2*math.Pi*60/testRate)
	for i := range x {
		lp += a * (r.NormFloat64() - lp)
		t := float64(i) / testRate
		gust := math.Max(0, math.Sin(2*math.Pi*1.3*t)+0.4*math.Sin(2*math.Pi*3.1*t))
		x[i] = amp * 12 * lp * gust
	}
	return x
}

func mix(a, b []float64) []float64 {
	out := make([]float64, len(a))
	for i := range a {
		out[i] = math.Max(-1, math.Min(1, a[i]+b[i]))
	}
	return out
}

func writeTestWav(t *testing.T, x []float64) string {
	t.Helper()
	p := filepath.Join(t.TempDir(), "clip.wav")
	data := make([]byte, len(x)*2)
	for i, s := range x {
		binary.LittleEndian.PutUint16(data[i*2:], uint16(int16(s*32767)))
	}
	h := make([]byte, 44)
	copy(h, "RIFF")
	binary.LittleEndian.PutUint32(h[4:], uint32(36+len(data)))
	copy(h[8:], "WAVEfmt ")
	binary.LittleEndian.PutUint32(h[16:], 16)
	binary.LittleEndian.PutUint16(h[20:], 1)
	binary.LittleEndian.PutUint16(h[22:], 1)
	binary.LittleEndian.PutUint32(h[24:], testRate)
	binary.LittleEndian.PutUint32(h[28:], testRate*2)
	binary.LittleEndian.PutUint16(h[32:], 2)
	binary.LittleEndian.PutUint16(h[34:], 16)
	copy(h[36:], "data")
	binary.LittleEndian.PutUint32(h[40:], uint32(len(data)))
	if err := os.WriteFile(p, append(h, data...), 0o644); err != nil {
		t.Fatal(err)
	}
	return p
}

func TestWindLevels(t *testing.T) {
	n := testRate * 3
	calm := speechish(n, 0.3)
	// steady road hum: low but quiet and even
	hum := make([]float64, n)
	for i := range hum {
		hum[i] = 0.02 * math.Sin(2*math.Pi*45*float64(i)/testRate)
	}
	cases := []struct {
		name string
		x    []float64
		want windLevel
	}{
		{"speech", calm, windNone},
		{"speech over road hum", mix(calm, hum), windNone},
		{"speech in a breeze", mix(calm, windish(n, 0.25, 1)), windSome},
		{"speech in a gale", mix(speechish(n, 0.15), windish(n, 0.8, 2)), windStrong},
	}
	for _, c := range cases {
		r, err := measureWind(writeTestWav(t, c.x))
		if err != nil {
			t.Fatal(err)
		}
		t.Logf("%s: share %.2f, %.1f dB, gust %.2f", c.name, r.lowShare, r.lowDb, r.gust)
		if got := r.level(); got != c.want {
			t.Errorf("%s: %s (share %.2f, %.1f dB, gust %.2f), want %s", c.name, got, r.lowShare, r.lowDb, r.gust, c.want)
		}
	}
}

func TestWindyMessage(t *testing.T) {
	v := &voiceService{}
	if got := v.windyMessage("Sorry, I didn't catch that"); got != "Sorry, I didn't catch that" {
		t.Errorf("calm: %q", got)
	}
	v.wind.Store(int32(windSome))
	if got := v.windyMessage("Sorry, I didn’t catch that"); got == "Sorry, I didn’t catch that" {
		t.Error("windy message not swapped")
	}
	if got := v.windyMessage("Couldn't find that"); got != "Couldn't find that" {
		t.Errorf("other message changed: %q", got)
	}
}
