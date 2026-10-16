package daemon

import (
	"bytes"
	"context"
	"crypto/sha1"
	"encoding/hex"
	"errors"
	"fmt"
	"image"
	"image/color"
	"image/jpeg"
	_ "image/png"
	"io"
	"io/fs"
	"net/http"
	"net/url"
	"os"
	"path/filepath"
	"sort"
	"strconv"
	"strings"
	"sync"
	"time"

	librespot "github.com/devgianlu/go-librespot"
)

// Covers kept on the Car Thing. The UI asks for /img?u=<cover url>&s=<px>;
// each cover is downloaded once, shrunk to the size the screen shows it at
// (small images decode several times faster on the Car Thing's chip), and
// kept in the data partition, where updates don't touch it and it works with
// no connection. The cache looks after its own size: covers unused for a month
// go, the oldest go first past coverCacheMax, and it shrinks further when the
// partition runs low.

const (
	coverCacheMax     = 100 << 20
	coverCacheLowDisk = 300 // MB free below which the cache keeps only half
	coverUnusedFor    = 30 * 24 * time.Hour
	coverMaxDownload  = 6 << 20
	coverSweepEvery   = 40 // new covers between sweeps
)

// the sizes the UI asks for: list rows, small art, the player, full size
var coverSizes = []int{64, 160, 300, 640}

// where covers may come from: the services' image hosts, nothing else
var coverHosts = []string{
	"scdn.co", "spotifycdn.com", "googleusercontent.com", "ggpht.com", "ytimg.com",
	"sndcdn.com", "mzstatic.com",
}

type coverCache struct {
	dir    string
	log    librespot.Logger
	client *http.Client
	max    int64

	mu       sync.Mutex
	inflight map[string]*coverCall
	written  int
	// at most this many downloads at once, so browsing Home doesn't swamp the tether
	slots chan struct{}
}

type coverCall struct {
	done chan struct{}
	path string
	err  error
}

func newCoverCache(dir string, log librespot.Logger) *coverCache {
	return &coverCache{
		dir:      dir,
		log:      log,
		client:   &http.Client{Timeout: 20 * time.Second},
		max:      coverCacheMax,
		inflight: map[string]*coverCall{},
		slots:    make(chan struct{}, 3),
	}
}

func coverCacheDir() string {
	if onDevice {
		return "/var/cache/wisp/covers"
	}
	return filepath.Join(os.TempDir(), "wisp-covers")
}

// coverSize rounds a request up to a size the cache keeps
func coverSize(s int) int {
	for _, c := range coverSizes {
		if s <= c {
			return c
		}
	}
	return coverSizes[len(coverSizes)-1]
}

func allowedCoverURL(raw string) (*url.URL, bool) {
	u, err := url.Parse(raw)
	if err != nil || u.Scheme != "https" || u.Host == "" || len(raw) > 1000 {
		return nil, false
	}
	host := strings.ToLower(u.Hostname())
	for _, h := range coverHosts {
		if host == h || strings.HasSuffix(host, "."+h) {
			return u, true
		}
	}
	return nil, false
}

// Spotify serves each album cover at 640, 300 and 64 px under one id: ask for
// the smallest that still fills the size wanted, rather than shrinking 640
var spotifyCoverSizes = []struct {
	px     int
	prefix string
}{{64, "ab67616d00004851"}, {300, "ab67616d00001e02"}, {640, "ab67616d0000b273"}}

func sizedSource(raw string, size int) string {
	const base = "https://i.scdn.co/image/"
	if !strings.HasPrefix(raw, base) {
		return raw
	}
	id := strings.TrimPrefix(raw, base)
	for _, v := range spotifyCoverSizes {
		if strings.HasPrefix(id, v.prefix) {
			rest := strings.TrimPrefix(id, v.prefix)
			for _, w := range spotifyCoverSizes {
				if w.px >= size {
					return base + w.prefix + rest
				}
			}
			return raw
		}
	}
	return raw
}

func (c *coverCache) pathFor(raw string, size int) string {
	sum := sha1.Sum([]byte(raw))
	key := hex.EncodeToString(sum[:])
	return filepath.Join(c.dir, key[:2], fmt.Sprintf("%s-%d", key, size))
}

// get returns the file for a cover at a size, fetching and shrinking it first if need be
func (c *coverCache) get(ctx context.Context, raw string, size int) (string, error) {
	p := c.pathFor(raw, size)
	if st, err := os.Stat(p); err == nil {
		// used: it moves to the back of the line for deletion (once an hour is enough)
		if time.Since(st.ModTime()) > time.Hour {
			now := time.Now()
			_ = os.Chtimes(p, now, now)
		}
		return p, nil
	}

	c.mu.Lock()
	if call, ok := c.inflight[p]; ok {
		c.mu.Unlock()
		select {
		case <-call.done:
			return call.path, call.err
		case <-ctx.Done():
			return "", ctx.Err()
		}
	}
	call := &coverCall{done: make(chan struct{})}
	c.inflight[p] = call
	c.mu.Unlock()

	call.path, call.err = c.fetch(raw, size, p)
	close(call.done)
	c.mu.Lock()
	delete(c.inflight, p)
	c.written++
	sweep := c.written%coverSweepEvery == 0
	c.mu.Unlock()
	if sweep {
		go c.sweep()
	}
	return call.path, call.err
}

func (c *coverCache) fetch(raw string, size int, dst string) (string, error) {
	c.slots <- struct{}{}
	defer func() { <-c.slots }()

	req, err := http.NewRequest("GET", sizedSource(raw, size), nil)
	if err != nil {
		return "", err
	}
	req.Header.Set("User-Agent", "wisp-covers")
	resp, err := c.client.Do(req)
	if err != nil {
		return "", err
	}
	defer func() { _ = resp.Body.Close() }()
	if resp.StatusCode != http.StatusOK {
		return "", fmt.Errorf("cover: %s", resp.Status)
	}
	body, err := io.ReadAll(io.LimitReader(resp.Body, coverMaxDownload+1))
	if err != nil {
		return "", err
	}
	if len(body) > coverMaxDownload {
		return "", errors.New("cover too large")
	}
	// shrunk when it's bigger than wanted and readable; kept as it came otherwise
	// (a format Go can't read still caches, it just isn't shrunk)
	out := body
	if img, _, err := image.Decode(bytes.NewReader(body)); err == nil {
		b := img.Bounds()
		if b.Dx() > size || b.Dy() > size {
			var buf bytes.Buffer
			if jpeg.Encode(&buf, shrink(img, size), &jpeg.Options{Quality: 86}) == nil {
				out = buf.Bytes()
			}
		}
	}
	if err := os.MkdirAll(filepath.Dir(dst), 0o755); err != nil {
		return "", err
	}
	tmp := dst + ".tmp"
	if err := os.WriteFile(tmp, out, 0o644); err != nil {
		return "", err
	}
	if err := os.Rename(tmp, dst); err != nil {
		_ = os.Remove(tmp)
		return "", err
	}
	return dst, nil
}

// shrink scales an image so its longer side is size, averaging the pixels each
// new one covers (a box filter: sharp enough at these sizes, and quick)
func shrink(src image.Image, size int) image.Image {
	b := src.Bounds()
	sw, sh := b.Dx(), b.Dy()
	dw, dh := size, size
	if sw > sh {
		dh = max(1, sh*size/sw)
	} else {
		dw = max(1, sw*size/sh)
	}
	dst := image.NewRGBA(image.Rect(0, 0, dw, dh))
	ycc, isYCC := src.(*image.YCbCr)
	for y := 0; y < dh; y++ {
		y0 := b.Min.Y + y*sh/dh
		y1 := max(y0+1, b.Min.Y+(y+1)*sh/dh)
		for x := 0; x < dw; x++ {
			x0 := b.Min.X + x*sw/dw
			x1 := max(x0+1, b.Min.X+(x+1)*sw/dw)
			var r, g, bl, n uint32
			for yy := y0; yy < y1; yy++ {
				for xx := x0; xx < x1; xx++ {
					var cr, cg, cb uint32
					if isYCC {
						// straight from the planes: far quicker than At() on a JPEG
						yi := ycc.YOffset(xx, yy)
						ci := ycc.COffset(xx, yy)
						r8, g8, b8 := color.YCbCrToRGB(ycc.Y[yi], ycc.Cb[ci], ycc.Cr[ci])
						cr, cg, cb = uint32(r8), uint32(g8), uint32(b8)
					} else {
						r16, g16, b16, _ := src.At(xx, yy).RGBA()
						cr, cg, cb = r16>>8, g16>>8, b16>>8
					}
					r += cr
					g += cg
					bl += cb
					n++
				}
			}
			i := dst.PixOffset(x, y)
			dst.Pix[i] = uint8(r / n)
			dst.Pix[i+1] = uint8(g / n)
			dst.Pix[i+2] = uint8(bl / n)
			dst.Pix[i+3] = 255
		}
	}
	return dst
}

// sweep deletes covers unused for coverUnusedFor, then the least recently used
// until the cache is under its limit (half of it while the disk is low)
func (c *coverCache) sweep() {
	if total := sweepDir(c.dir, c.max, coverUnusedFor); total >= 0 {
		c.log.Infof("covers: cache trimmed to %d MB", total>>20)
	}
}

// sweepDir keeps a cache folder in bounds: files unused (by modification time)
// for longer than unusedFor go, then the least recently used until it's under
// 80% of limit, half the limit while the disk is low. Returns the size left
// when it had to trim, -1 when it didn't
func sweepDir(dir string, limit int64, unusedFor time.Duration) int64 {
	type entry struct {
		path string
		size int64
		used time.Time
	}
	var all []entry
	var total int64
	cutoff := time.Now().Add(-unusedFor)
	_ = filepath.WalkDir(dir, func(p string, d fs.DirEntry, err error) error {
		if err != nil || d.IsDir() {
			return nil
		}
		info, err := d.Info()
		if err != nil {
			return nil
		}
		if strings.HasSuffix(p, ".tmp") || info.ModTime().Before(cutoff) {
			_ = os.Remove(p)
			return nil
		}
		all = append(all, entry{p, info.Size(), info.ModTime()})
		total += info.Size()
		return nil
	})
	if free := diskFreeMB(dir); free > 0 && free < coverCacheLowDisk {
		limit /= 2
	}
	if total <= limit {
		return -1
	}
	sort.Slice(all, func(i, j int) bool { return all[i].used.Before(all[j].used) })
	// down to 80% of the limit, so the next few files don't set it off again
	for _, e := range all {
		if total <= limit*8/10 {
			break
		}
		if os.Remove(e.path) == nil {
			total -= e.size
		}
	}
	return total
}

// run sweeps soon after start and then daily, besides the sweeps new covers set off
func (c *coverCache) run(ctx context.Context) {
	timer := time.NewTimer(2 * time.Minute)
	defer timer.Stop()
	for {
		select {
		case <-ctx.Done():
			return
		case <-timer.C:
			c.sweep()
			timer.Reset(24 * time.Hour)
		}
	}
}

func (s *ConcreteApiServer) registerCoverRoutes(m *http.ServeMux) {
	covers := newCoverCache(coverCacheDir(), s.log)
	go covers.run(context.Background())
	m.HandleFunc("GET /img", func(w http.ResponseWriter, r *http.Request) {
		raw := r.URL.Query().Get("u")
		if _, ok := allowedCoverURL(raw); !ok {
			w.WriteHeader(http.StatusBadRequest)
			return
		}
		size, _ := strconv.Atoi(r.URL.Query().Get("s"))
		path, err := covers.get(r.Context(), raw, coverSize(max(size, 1)))
		if err != nil {
			w.WriteHeader(http.StatusBadGateway)
			return
		}
		// a cover at a url never changes: the browser can keep it as long as it likes
		w.Header().Set("Cache-Control", "public, max-age=31536000, immutable")
		http.ServeFile(w, r, path)
	})
}
