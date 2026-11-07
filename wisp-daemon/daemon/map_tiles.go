package daemon

import (
	"bytes"
	"context"
	"errors"
	"fmt"
	"image"
	"image/jpeg"
	_ "image/png"
	"io"
	"math"
	"net/http"
	"os"
	"path/filepath"
	"strconv"
	"sync"
	"sync/atomic"
	"time"

	librespot "github.com/devgianlu/go-librespot"
)

// The map's tiles, kept on the Car Thing. The UI asks for /map/tile/z/x/y;
// each OpenStreetMap tile is downloaded once, darkened here once (the screen
// used to run a CSS filter over the whole map on every frame, which the Car
// Thing's GPU felt) and kept in the data partition, so a road driven before
// draws at once and with no connection. Ahead of the car it quietly fetches
// the tiles around it and along the route, a few at a time, so the map is
// there before the car is. Kept modest for the OSM tile policy: nothing past
// zoom 17, a small ring around the car, the route only at 15 and 16.

const (
	tileCacheMax    = 150 << 20
	tileUnusedFor   = 60 * 24 * time.Hour
	tileMaxDownload = 1 << 20
	tileSweepEvery  = 200
	tileMaxZoom     = 19
	// at most this many tiles queued for fetching ahead
	tilePrefetchMax = 600
	tileUA          = "WispOS/1 (Car Thing navigation; github.com/picovrfbt/WispOS)"
	tileSource      = "https://tile.openstreetmap.org/%d/%d/%d.png"
)

type tileKey struct{ z, x, y int }

type tileCache struct {
	dir    string
	log    librespot.Logger
	client *http.Client
	source string

	mu       sync.Mutex
	inflight map[tileKey]*coverCall
	written  int
	// what the car last asked for ahead, so the same area isn't queued twice
	lastNear tileKey
	queue    chan tileKey
	queued   map[tileKey]bool
	// downloads at once: what's on screen, plus the ahead fetcher
	slots chan struct{}
}

var activeTiles atomic.Pointer[tileCache]

func newTileCache(dir string, log librespot.Logger) *tileCache {
	return &tileCache{
		dir:      dir,
		log:      log,
		client:   &http.Client{Timeout: 20 * time.Second},
		source:   tileSource,
		inflight: map[tileKey]*coverCall{},
		queue:    make(chan tileKey, tilePrefetchMax),
		queued:   map[tileKey]bool{},
		slots:    make(chan struct{}, 4),
	}
}

func tileCacheDir() string {
	if onDevice {
		return "/var/cache/wisp/tiles"
	}
	return filepath.Join(os.TempDir(), "wisp-tiles")
}

func (k tileKey) valid() bool {
	n := 1 << k.z
	return k.z >= 0 && k.z <= tileMaxZoom && k.x >= 0 && k.x < n && k.y >= 0 && k.y < n
}

func (c *tileCache) pathFor(k tileKey) string {
	return filepath.Join(c.dir, strconv.Itoa(k.z), strconv.Itoa(k.x), strconv.Itoa(k.y)+".jpg")
}

// tileAt is the tile a point falls in at a zoom
func tileAt(lat, lng float64, z int) tileKey {
	n := float64(int(1) << z)
	lat = math.Max(-85.05, math.Min(85.05, lat))
	x := int((lng + 180) / 360 * n)
	r := lat * math.Pi / 180
	y := int((1 - math.Log(math.Tan(r)+1/math.Cos(r))/math.Pi) / 2 * n)
	last := int(n) - 1
	return tileKey{z, max(0, min(x, last)), max(0, min(y, last))}
}

// get returns the file for a tile, fetching and darkening it first if need be
func (c *tileCache) get(ctx context.Context, k tileKey) (string, error) {
	p := c.pathFor(k)
	if st, err := os.Stat(p); err == nil {
		if time.Since(st.ModTime()) > 24*time.Hour {
			now := time.Now()
			_ = os.Chtimes(p, now, now)
		}
		return p, nil
	}

	c.mu.Lock()
	if call, ok := c.inflight[k]; ok {
		c.mu.Unlock()
		select {
		case <-call.done:
			return call.path, call.err
		case <-ctx.Done():
			return "", ctx.Err()
		}
	}
	call := &coverCall{done: make(chan struct{})}
	c.inflight[k] = call
	c.mu.Unlock()

	call.path, call.err = c.fetch(k, p)
	close(call.done)
	c.mu.Lock()
	delete(c.inflight, k)
	c.written++
	sweep := c.written%tileSweepEvery == 0
	c.mu.Unlock()
	if sweep {
		go func() {
			if total := sweepDir(c.dir, tileCacheMax, tileUnusedFor); total >= 0 {
				c.log.Infof("map: tile cache trimmed to %d MB", total>>20)
			}
		}()
	}
	return call.path, call.err
}

func (c *tileCache) fetch(k tileKey, dst string) (string, error) {
	c.slots <- struct{}{}
	defer func() { <-c.slots }()

	req, err := http.NewRequest("GET", fmt.Sprintf(c.source, k.z, k.x, k.y), nil)
	if err != nil {
		return "", err
	}
	req.Header.Set("User-Agent", tileUA)
	resp, err := c.client.Do(req)
	if err != nil {
		return "", err
	}
	defer func() { _ = resp.Body.Close() }()
	if resp.StatusCode != http.StatusOK {
		return "", fmt.Errorf("tile: %s", resp.Status)
	}
	body, err := io.ReadAll(io.LimitReader(resp.Body, tileMaxDownload+1))
	if err != nil {
		return "", err
	}
	if len(body) > tileMaxDownload {
		return "", errors.New("tile too large")
	}
	img, _, err := image.Decode(bytes.NewReader(body))
	if err != nil {
		return "", err
	}
	var buf bytes.Buffer
	if err := jpeg.Encode(&buf, darkenTile(img), &jpeg.Options{Quality: 82}); err != nil {
		return "", err
	}
	if err := os.MkdirAll(filepath.Dir(dst), 0o755); err != nil {
		return "", err
	}
	tmp := dst + ".tmp"
	if err := os.WriteFile(tmp, buf.Bytes(), 0o644); err != nil {
		return "", err
	}
	if err := os.Rename(tmp, dst); err != nil {
		_ = os.Remove(tmp)
		return "", err
	}
	return dst, nil
}

// darkenTile is the night look the map had as a CSS filter: invert(1)
// hue-rotate(180deg) brightness(0.9) contrast(0.85) saturate(0.6), done once.
func darkenTile(src image.Image) *image.RGBA {
	b := src.Bounds()
	dst := image.NewRGBA(image.Rect(0, 0, b.Dx(), b.Dy()))
	// OSM's tiles are paletted: darken the palette once, then just look it up
	if pal, ok := src.(*image.Paletted); ok {
		lut := make([][3]uint8, len(pal.Palette))
		for i, col := range pal.Palette {
			r, g, bl, _ := col.RGBA()
			lut[i] = darkenRGB(r, g, bl)
		}
		for y := 0; y < b.Dy(); y++ {
			for x := 0; x < b.Dx(); x++ {
				v := lut[pal.ColorIndexAt(b.Min.X+x, b.Min.Y+y)]
				i := dst.PixOffset(x, y)
				dst.Pix[i], dst.Pix[i+1], dst.Pix[i+2], dst.Pix[i+3] = v[0], v[1], v[2], 255
			}
		}
		return dst
	}
	for y := 0; y < b.Dy(); y++ {
		for x := 0; x < b.Dx(); x++ {
			r, g, bl, _ := src.At(b.Min.X+x, b.Min.Y+y).RGBA()
			v := darkenRGB(r, g, bl)
			i := dst.PixOffset(x, y)
			dst.Pix[i], dst.Pix[i+1], dst.Pix[i+2], dst.Pix[i+3] = v[0], v[1], v[2], 255
		}
	}
	return dst
}

// darkenRGB is the filter on one colour, given as 16-bit channels
func darkenRGB(r, g, bl uint32) [3]uint8 {
	clamp := func(v float64) float64 { return math.Max(0, math.Min(1, v)) }
	// hue-rotate(180deg) as the filter spec's matrix
	hr := [3][3]float64{{-0.574, 1.430, 0.144}, {0.426, 0.430, 0.144}, {0.426, 1.430, -0.856}}
	const s = 0.6
	sat := [3][3]float64{
		{0.213 + 0.787*s, 0.715 - 0.715*s, 0.072 - 0.072*s},
		{0.213 - 0.213*s, 0.715 + 0.285*s, 0.072 - 0.072*s},
		{0.213 - 0.213*s, 0.715 - 0.715*s, 0.072 + 0.928*s},
	}
	mul := func(m [3][3]float64, v [3]float64) [3]float64 {
		var o [3]float64
		for i := range 3 {
			o[i] = clamp(m[i][0]*v[0] + m[i][1]*v[1] + m[i][2]*v[2])
		}
		return o
	}
	v := [3]float64{1 - float64(r)/65535, 1 - float64(g)/65535, 1 - float64(bl)/65535}
	v = mul(hr, v)
	for i := range v {
		v[i] = clamp((clamp(v[i]*0.9)-0.5)*0.85 + 0.5)
	}
	v = mul(sat, v)
	return [3]uint8{uint8(v[0]*255 + 0.5), uint8(v[1]*255 + 0.5), uint8(v[2]*255 + 0.5)}
}

// ---------------------------------------------------------------- ahead of the car

// enqueue adds tiles to fetch ahead, skipping ones already kept or queued
func (c *tileCache) enqueue(keys []tileKey) {
	c.mu.Lock()
	defer c.mu.Unlock()
	for _, k := range keys {
		if !k.valid() || c.queued[k] {
			continue
		}
		if _, err := os.Stat(c.pathFor(k)); err == nil {
			continue
		}
		select {
		case c.queue <- k:
			c.queued[k] = true
		default:
			return // full: the rest waits for the next fix
		}
	}
}

// nearCar queues the tiles around the car when it reaches a new area: two
// tiles each way at the zooms the map drives at, one at street level
func (c *tileCache) nearCar(lat, lng float64) {
	at := tileAt(lat, lng, 16)
	c.mu.Lock()
	same := at == c.lastNear
	c.lastNear = at
	c.mu.Unlock()
	if same {
		return
	}
	var keys []tileKey
	for _, zr := range []struct{ z, r int }{{16, 2}, {15, 2}, {17, 1}} {
		t := tileAt(lat, lng, zr.z)
		for dy := -zr.r; dy <= zr.r; dy++ {
			for dx := -zr.r; dx <= zr.r; dx++ {
				keys = append(keys, tileKey{zr.z, t.x + dx, t.y + dy})
			}
		}
	}
	c.enqueue(keys)
}

// alongRoute queues the tiles the route passes through at 15 and 16, from the start
func (c *tileCache) alongRoute(pts [][2]float64) {
	var keys []tileKey
	seen := map[tileKey]bool{}
	add := func(k tileKey) {
		if !seen[k] {
			seen[k] = true
			keys = append(keys, k)
		}
	}
	for i, p := range pts {
		for _, z := range []int{16, 15} {
			add(tileAt(p[0], p[1], z))
			// long straight stretches can skip a tile between points
			if i > 0 {
				q := pts[i-1]
				add(tileAt((p[0]+q[0])/2, (p[1]+q[1])/2, z))
			}
		}
		if len(keys) >= tilePrefetchMax {
			break
		}
	}
	c.enqueue(keys)
}

// run fetches the queued tiles one at a time, a little apart, so the tether
// and the tile servers barely notice
func (c *tileCache) run(ctx context.Context) {
	for {
		select {
		case <-ctx.Done():
			return
		case k := <-c.queue:
			_, err := c.get(ctx, k)
			c.mu.Lock()
			delete(c.queued, k)
			c.mu.Unlock()
			if err != nil {
				// offline or refused: back off rather than burn through the queue
				time.Sleep(5 * time.Second)
				continue
			}
			time.Sleep(150 * time.Millisecond)
		}
	}
}

func (s *ConcreteApiServer) registerMapRoutes(m *http.ServeMux) {
	tiles := newTileCache(tileCacheDir(), s.log)
	activeTiles.Store(tiles)
	go tiles.run(context.Background())
	m.HandleFunc("GET /map/tile/{z}/{x}/{y}", func(w http.ResponseWriter, r *http.Request) {
		z, ez := strconv.Atoi(r.PathValue("z"))
		x, ex := strconv.Atoi(r.PathValue("x"))
		y, ey := strconv.Atoi(r.PathValue("y"))
		k := tileKey{z, x, y}
		if ez != nil || ex != nil || ey != nil || !k.valid() {
			w.WriteHeader(http.StatusBadRequest)
			return
		}
		path, err := tiles.get(r.Context(), k)
		if err != nil {
			w.WriteHeader(http.StatusBadGateway)
			return
		}
		// a week in the browser too, so panning back is instant
		w.Header().Set("Cache-Control", "public, max-age=604800")
		w.Header().Set("Content-Type", "image/jpeg")
		http.ServeFile(w, r, path)
	})
}
