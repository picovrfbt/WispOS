package daemon

import (
	"bytes"
	"context"
	"image"
	"image/color"
	"image/jpeg"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"testing"
	"time"

	librespot "github.com/devgianlu/go-librespot"
)

func testCover(t *testing.T, w, h int) []byte {
	t.Helper()
	img := image.NewRGBA(image.Rect(0, 0, w, h))
	for y := 0; y < h; y++ {
		for x := 0; x < w; x++ {
			img.Set(x, y, color.RGBA{uint8(x), uint8(y), 120, 255})
		}
	}
	var buf bytes.Buffer
	if err := jpeg.Encode(&buf, img, nil); err != nil {
		t.Fatal(err)
	}
	return buf.Bytes()
}

func TestCoverCacheShrinksOnceAndKeeps(t *testing.T) {
	body := testCover(t, 640, 640)
	hits := 0
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		hits++
		_, _ = w.Write(body)
	}))
	defer srv.Close()
	c := newCoverCache(t.TempDir(), &librespot.NullLogger{})
	for i := 0; i < 3; i++ {
		p, err := c.get(context.Background(), srv.URL+"/cover", 300)
		if err != nil {
			t.Fatal(err)
		}
		b, _ := os.ReadFile(p)
		img, err := jpeg.Decode(bytes.NewReader(b))
		if err != nil || img.Bounds().Dx() != 300 || img.Bounds().Dy() != 300 {
			t.Fatalf("want a 300px cover, got %v %v", img.Bounds(), err)
		}
	}
	if hits != 1 {
		t.Fatalf("a cached cover is downloaded once, got %d", hits)
	}
}

func TestCoverSweepDropsStaleAndOldest(t *testing.T) {
	dir := t.TempDir()
	c := newCoverCache(dir, &librespot.NullLogger{})
	c.max = 3000
	write := func(name string, age time.Duration) string {
		p := filepath.Join(dir, "ab", name)
		_ = os.MkdirAll(filepath.Dir(p), 0o755)
		_ = os.WriteFile(p, make([]byte, 1000), 0o644)
		at := time.Now().Add(-age)
		_ = os.Chtimes(p, at, at)
		return p
	}
	stale := write("stale", 40*24*time.Hour)
	oldest := write("old", 3*time.Hour)
	older := write("older", 2*time.Hour)
	newest := write("new", time.Minute)
	extra := write("new2", time.Second)
	c.sweep()
	for p, want := range map[string]bool{stale: false, oldest: false, older: false, newest: true, extra: true} {
		if fileExists(p) != want {
			t.Errorf("%s kept=%v, want %v", filepath.Base(p), fileExists(p), want)
		}
	}
}

func TestCoverURLsAndSizes(t *testing.T) {
	for raw, ok := range map[string]bool{
		"https://i.scdn.co/image/ab67616d0000b273abc":   true,
		"https://lh3.googleusercontent.com/x=w544-h544": true,
		"https://i1.sndcdn.com/artworks-x-t300x300.jpg": true,
		"http://i.scdn.co/image/x":                      false,
		"https://evil.example/x.jpg":                    false,
		"https://scdn.co.evil.example/x.jpg":            false,
		"https://localhost/phone/media/art":             false,
	} {
		if _, got := allowedCoverURL(raw); got != ok {
			t.Errorf("%s: allowed=%v, want %v", raw, got, ok)
		}
	}
	if got := sizedSource("https://i.scdn.co/image/ab67616d0000b273abc", 64); got != "https://i.scdn.co/image/ab67616d00004851abc" {
		t.Errorf("64px wants Spotify's 64px cover, got %s", got)
	}
	if got := sizedSource("https://i.scdn.co/image/ab67616d0000b273abc", 160); got != "https://i.scdn.co/image/ab67616d00001e02abc" {
		t.Errorf("160px wants the 300px cover, got %s", got)
	}
	if coverSize(100) != 160 || coverSize(1000) != 640 || coverSize(64) != 64 {
		t.Error("sizes round up to the kept ones")
	}
}
