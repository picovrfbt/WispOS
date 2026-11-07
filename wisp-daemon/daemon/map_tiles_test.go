package daemon

import (
	"bytes"
	"context"
	"image"
	"image/color"
	"image/png"
	"net/http"
	"net/http/httptest"
	"os"
	"strings"
	"sync/atomic"
	"testing"
	"time"

	librespot "github.com/devgianlu/go-librespot"
)

func TestTileAt(t *testing.T) {
	// central London at zoom 16
	if got := tileAt(51.5074, -0.1278, 16); got != (tileKey{16, 32744, 21792}) {
		t.Fatalf("tileAt = %+v", got)
	}
	if !(tileKey{0, 0, 0}).valid() || (tileKey{2, 4, 0}).valid() || (tileKey{20, 0, 0}).valid() {
		t.Fatal("valid() wrong")
	}
}

func TestDarkenRGB(t *testing.T) {
	// the light map's land goes dark and its dark text goes light
	land := darkenRGB(0xf2f2, 0xefef, 0xe9e9)
	if land[0] > 80 || land[1] > 80 || land[2] > 80 {
		t.Fatalf("land not dark: %v", land)
	}
	if text := darkenRGB(0x2020, 0x2020, 0x2020); text[0] < 150 {
		t.Fatalf("text not light: %v", text)
	}
}

func tilePNG() []byte {
	pal := image.NewPaletted(image.Rect(0, 0, 4, 4), color.Palette{color.White, color.Black})
	pal.SetColorIndex(1, 1, 1)
	var buf bytes.Buffer
	_ = png.Encode(&buf, pal)
	return buf.Bytes()
}

func TestTileCacheFetchesOnce(t *testing.T) {
	var hits atomic.Int32
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		hits.Add(1)
		if !strings.HasPrefix(r.Header.Get("User-Agent"), "WispOS") {
			t.Errorf("no user agent")
		}
		_, _ = w.Write(tilePNG())
	}))
	defer srv.Close()

	c := newTileCache(t.TempDir(), &librespot.NullLogger{})
	c.source = srv.URL + "/%d/%d/%d.png"
	for range 2 {
		p, err := c.get(context.Background(), tileKey{15, 1, 2})
		if err != nil {
			t.Fatal(err)
		}
		f, _ := os.Open(p)
		img, _, err := image.Decode(f)
		_ = f.Close()
		if err != nil {
			t.Fatal(err)
		}
		// white land came out dark
		if r, _, _, _ := img.At(0, 0).RGBA(); r>>8 > 60 {
			t.Fatalf("tile not darkened: %d", r>>8)
		}
	}
	if hits.Load() != 1 {
		t.Fatalf("downloaded %d times", hits.Load())
	}
}

func TestTilePrefetch(t *testing.T) {
	var hits atomic.Int32
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		hits.Add(1)
		_, _ = w.Write(tilePNG())
	}))
	defer srv.Close()

	c := newTileCache(t.TempDir(), &librespot.NullLogger{})
	c.source = srv.URL + "/%d/%d/%d.png"
	c.nearCar(51.5074, -0.1278)
	// 5x5 at 16 and 15, 3x3 at 17
	if n := len(c.queue); n != 59 {
		t.Fatalf("queued %d", n)
	}
	// the same area again queues nothing more
	c.nearCar(51.5075, -0.1279)
	if n := len(c.queue); n != 59 {
		t.Fatalf("queued again: %d", n)
	}

	c.queue = make(chan tileKey, tilePrefetchMax)
	c.queued = map[tileKey]bool{}
	c.alongRoute([][2]float64{{51.50, -0.13}, {51.52, -0.10}})
	if len(c.queue) == 0 {
		t.Fatal("route queued nothing")
	}
	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()
	go c.run(ctx)
	deadline := time.Now().Add(10 * time.Second)
	for len(c.queue) > 0 && time.Now().Before(deadline) {
		time.Sleep(20 * time.Millisecond)
	}
	if hits.Load() == 0 {
		t.Fatal("nothing fetched")
	}
}
