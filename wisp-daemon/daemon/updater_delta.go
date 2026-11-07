package daemon

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net"
	"net/http"
	"os"
	"path/filepath"
	"sort"
	"strconv"
	"strings"
	"sync"
	"sync/atomic"
	"time"
)

// Delta system updates: only what changed.
//
// Most of a new Wisp OS is the same as the old one (Chromium alone is most of
// the system), so a release can carry the system as zchunk files: the
// partitions cut into chunks by content, each with its hash, compressed one by
// one. The delta .swu holds only their headers (the chunk lists). swupdate
// reads the running slot, finds the chunks it already has, and asks for the
// rest by byte range from http://127.0.0.1:8893 (baked into the build:
// SUPERBIRD_OTA_DELTA_URL_BASE), then writes the new slot from both.
//
// That address is rangeProxy, here, for the length of the install. It fetches
// the asked-for ranges from the release (several at once where they sit close
// together), and keeps every piece it fetched in the data partition: a drive
// that ends mid-update loses nothing, the next one serves those pieces locally
// and fetches only the rest. swupdate checks every chunk's hash; a delta that
// fails for any reason but the connection falls back to the whole system.
//
// Release assets, next to wisp-os-<v>.swu:
//
//	wisp-os-<v>-delta.swu    the chunk lists (a few MB)
//	wisp-os-<v>-system.zck   the root partition, chunked (fetched by range)
//	wisp-os-<v>-boot.zck     the boot partition, chunked (fetched by range)

const deltaProxyAddr = "127.0.0.1:8893"

const (
	// ranges this close together come down as one request
	deltaMergeGap = 256 << 10
	// and one request asks for at most this much
	deltaMaxSpan = 8 << 20
	// a storage link from GitHub's redirect is good for a few minutes
	deltaLinkLife = 4 * time.Minute
)

var errDeltaOffline = errors.New("couldn't reach the update's pieces")

type deltaAssets struct {
	swu, system, boot *ghAsset
}

// the delta pieces of system version v on the release, or nil without all three
func deltaAssetsFor(rel *ghRelease, v string) *deltaAssets {
	find := func(name string) *ghAsset {
		for i := range rel.Assets {
			if rel.Assets[i].Name == name {
				return &rel.Assets[i]
			}
		}
		return nil
	}
	base := "wisp-os-" + v
	d := &deltaAssets{find(base + "-delta.swu"), find(base + "-system.zck"), find(base + "-boot.zck")}
	if d.swu == nil || d.system == nil || d.boot == nil {
		return nil
	}
	return d
}

// installDelta writes system offer to slot target from the running slot plus what changed
func (u *updater) installDelta(ctx context.Context, rel *ghRelease, offer *systemOffer, d *deltaAssets, target string) error {
	name := "delta-" + offer.version
	dir := filepath.Join(u.osDir, name)
	// an older offer's leftovers, or a whole-system download: make room
	u.clearSystemDownloads(name)
	if err := os.MkdirAll(dir, 0o755); err != nil {
		return err
	}
	want, err := u.expectedDigest(ctx, rel, d.swu)
	if err != nil {
		return err
	}
	u.setState(func(s *UpdateState) {
		s.Phase, s.Step = "downloading", "Downloading the list of changes"
		s.BytesDone, s.BytesTotal, s.SpeedBps = 0, d.swu.Size, 0
	})
	swu := filepath.Join(dir, d.swu.Name)
	got, err := u.download(ctx, d.swu, swu)
	if err != nil {
		return fmt.Errorf("%w: %v", errDeltaOffline, err)
	}
	if !strings.EqualFold(got, want) {
		_ = os.Remove(swu)
		return errors.New("delta failed verification (checksum mismatch)")
	}

	proxy := newRangeProxy(u, dir, map[string]*ghAsset{
		"/system.img.zck": d.system,
		"/boot.vfat.zck":  d.boot,
	})
	ln, err := net.Listen("tcp", u.deltaAddr)
	if err != nil {
		return fmt.Errorf("delta: %v", err)
	}
	srv := &http.Server{Handler: proxy, ReadHeaderTimeout: 30 * time.Second}
	go func() { _ = srv.Serve(ln) }()
	defer func() { _ = srv.Close() }()

	u.setState(func(s *UpdateState) {
		s.Phase, s.Percent, s.Step = "installing", 0, "Finding what changed"
		s.BytesDone, s.BytesTotal, s.SpeedBps = 0, 0, 0
	})
	u.log.Infof("update: writing system %s to slot %s from slot %s plus what changed", offer.version, target, otherSlot(target))
	err = u.applySystem(ctx, swu, target)
	fetched, kept := proxy.fetched.Load(), proxy.served.Load()-proxy.fetched.Load()
	if err != nil {
		if proxy.upstreamErr.Load() != nil {
			return fmt.Errorf("%w: %v", errDeltaOffline, err)
		}
		return fmt.Errorf("delta write failed: %w", err)
	}
	u.log.Infof("update: system %s written: %d MB downloaded, %d MB from earlier tries", offer.version, fetched>>20, max(kept, 0)>>20)
	return nil
}

// rangeProxy serves the release's zchunk files to swupdate by byte range,
// keeping what it fetched
type rangeProxy struct {
	u     *updater
	files map[string]*deltaFile
	// bytes fetched from the release, and served to swupdate
	fetched, served atomic.Int64
	// the last fetch that failed for good: the connection, not the delta
	upstreamErr atomic.Pointer[error]
	reportAt    atomic.Int64
}

type deltaFile struct {
	asset *ghAsset
	// the kept pieces: a sparse copy of the file, and which spans of it are filled
	path, spansPath string

	mu    sync.Mutex
	spans []span
	// where GitHub's asset link redirects to (storage), and when it was looked up;
	// "" with linkAt set: the asset link serves ranges itself
	link   string
	linkAt time.Time
}

// span is [From, To)
type span struct {
	From int64 `json:"from"`
	To   int64 `json:"to"`
}

func newRangeProxy(u *updater, dir string, assets map[string]*ghAsset) *rangeProxy {
	p := &rangeProxy{u: u, files: map[string]*deltaFile{}}
	for path, a := range assets {
		f := &deltaFile{
			asset:     a,
			path:      filepath.Join(dir, a.Name),
			spansPath: filepath.Join(dir, a.Name+".spans"),
		}
		if b, err := os.ReadFile(f.spansPath); err == nil && fileExists(f.path) {
			_ = json.Unmarshal(b, &f.spans)
		}
		p.files[path] = f
	}
	return p
}

func (p *rangeProxy) ServeHTTP(w http.ResponseWriter, r *http.Request) {
	f := p.files[r.URL.Path]
	if f == nil || (r.Method != http.MethodGet && r.Method != http.MethodHead) {
		http.NotFound(w, r)
		return
	}
	ranges, err := parseByteRanges(r.Header.Get("Range"), f.asset.Size)
	if err != nil {
		w.Header().Set("Content-Range", fmt.Sprintf("bytes */%d", f.asset.Size))
		http.Error(w, err.Error(), http.StatusRequestedRangeNotSatisfiable)
		return
	}
	if err := p.ensure(r.Context(), f, ranges); err != nil {
		p.u.log.Infof("update: delta pieces: %v", err)
		http.Error(w, "upstream: "+err.Error(), http.StatusBadGateway)
		return
	}
	file, err := os.Open(f.path)
	if err != nil {
		http.Error(w, err.Error(), http.StatusInternalServerError)
		return
	}
	defer func() { _ = file.Close() }()

	if len(ranges) == 1 {
		rg := ranges[0]
		w.Header().Set("Content-Type", "application/octet-stream")
		w.Header().Set("Content-Range", fmt.Sprintf("bytes %d-%d/%d", rg.From, rg.To-1, f.asset.Size))
		w.Header().Set("Content-Length", strconv.FormatInt(rg.To-rg.From, 10))
		w.WriteHeader(http.StatusPartialContent)
		if r.Method == http.MethodGet {
			n, _ := io.Copy(w, io.NewSectionReader(file, rg.From, rg.To-rg.From))
			p.served.Add(n)
		}
		return
	}
	const boundary = "wisp-delta-ranges"
	w.Header().Set("Content-Type", "multipart/byteranges; boundary="+boundary)
	w.WriteHeader(http.StatusPartialContent)
	if r.Method != http.MethodGet {
		return
	}
	for _, rg := range ranges {
		_, _ = fmt.Fprintf(w, "--%s\r\nContent-Type: application/octet-stream\r\nContent-Range: bytes %d-%d/%d\r\n\r\n",
			boundary, rg.From, rg.To-1, f.asset.Size)
		n, err := io.Copy(w, io.NewSectionReader(file, rg.From, rg.To-rg.From))
		p.served.Add(n)
		if err != nil {
			return
		}
		_, _ = io.WriteString(w, "\r\n")
	}
	_, _ = fmt.Fprintf(w, "--%s--\r\n", boundary)
}

// parseByteRanges reads "bytes=a-b,c-d" (b and d inclusive) into spans within size, in the order asked
func parseByteRanges(h string, size int64) ([]span, error) {
	spec, ok := strings.CutPrefix(strings.TrimSpace(h), "bytes=")
	if !ok || spec == "" {
		return nil, errors.New("needs a byte range")
	}
	var out []span
	for _, part := range strings.Split(spec, ",") {
		a, b, ok := strings.Cut(strings.TrimSpace(part), "-")
		if !ok {
			return nil, fmt.Errorf("bad range %q", part)
		}
		from, err1 := strconv.ParseInt(a, 10, 64)
		to := size - 1
		var err2 error
		if b != "" {
			to, err2 = strconv.ParseInt(b, 10, 64)
		}
		if err1 != nil || err2 != nil || from < 0 || from > to || from >= size {
			return nil, fmt.Errorf("bad range %q", part)
		}
		out = append(out, span{from, min(to, size-1) + 1})
	}
	if len(out) > 2000 {
		return nil, errors.New("too many ranges")
	}
	return out, nil
}

// ensure has every range in the kept copy, fetching what's missing
func (p *rangeProxy) ensure(ctx context.Context, f *deltaFile, ranges []span) error {
	f.mu.Lock()
	defer f.mu.Unlock()
	var missing []span
	for _, r := range ranges {
		missing = append(missing, subtractSpans(r, f.spans)...)
	}
	if len(missing) == 0 {
		return nil
	}
	file, err := os.OpenFile(f.path, os.O_RDWR|os.O_CREATE, 0o644)
	if err != nil {
		return err
	}
	defer func() { _ = file.Close() }()
	for _, s := range mergeSpans(missing, deltaMergeGap, deltaMaxSpan) {
		if err := p.fetch(ctx, f, file, s); err != nil {
			if ctx.Err() == nil {
				p.upstreamErr.Store(&err)
			}
			return err
		}
		f.spans = addSpan(f.spans, s)
		if b, err := json.Marshal(f.spans); err == nil {
			_ = os.WriteFile(f.spansPath, b, 0o644)
		}
	}
	return nil
}

// fetch copies span s of the asset into file, retrying a dropped connection
func (p *rangeProxy) fetch(ctx context.Context, f *deltaFile, file *os.File, s span) error {
	var last error
	for try := 0; try < downloadAttempts; try++ {
		if try > 0 {
			select {
			case <-ctx.Done():
				return ctx.Err()
			case <-time.After(p.u.resumeWait * time.Duration(1<<min(try, 4))):
			}
		}
		link, auth, err := p.link(ctx, f)
		if err != nil {
			last = err
			continue
		}
		req, err := http.NewRequestWithContext(ctx, "GET", link, nil)
		if err != nil {
			return err
		}
		if auth {
			p.u.authorize(req, "application/octet-stream")
		} else {
			req.Header.Set("User-Agent", "wisp-updater")
		}
		req.Header.Set("Range", fmt.Sprintf("bytes=%d-%d", s.From, s.To-1))
		resp, err := p.u.client.Do(req)
		if err != nil {
			last = err
			continue
		}
		if resp.StatusCode != http.StatusPartialContent {
			_ = resp.Body.Close()
			last = fmt.Errorf("pieces: %s", resp.Status)
			// a storage link that ran out: look it up again
			f.link, f.linkAt = "", time.Time{}
			continue
		}
		n, err := io.Copy(io.NewOffsetWriter(file, s.From), io.LimitReader(resp.Body, s.To-s.From))
		_ = resp.Body.Close()
		p.fetched.Add(n)
		p.report()
		if err == nil && n == s.To-s.From {
			return nil
		}
		if err == nil {
			err = io.ErrUnexpectedEOF
		}
		last = err
		// what did arrive is kept: carry on from there
		if n > 0 {
			got := span{s.From, s.From + n}
			f.spans = addSpan(f.spans, got)
			s.From += n
		}
	}
	return last
}

// link is where to ask for the asset's ranges: GitHub's asset URL redirects to
// storage, looked up once every few minutes (each range then costs one round
// trip, not two). auth: the request goes to GitHub itself, with the token
func (p *rangeProxy) link(ctx context.Context, f *deltaFile) (string, bool, error) {
	if !f.linkAt.IsZero() && time.Since(f.linkAt) < deltaLinkLife {
		if f.link == "" {
			return f.asset.URL, true, nil
		}
		return f.link, false, nil
	}
	req, err := http.NewRequestWithContext(ctx, "GET", f.asset.URL, nil)
	if err != nil {
		return "", false, err
	}
	p.u.authorize(req, "application/octet-stream")
	req.Header.Set("Range", "bytes=0-0")
	c := *p.u.client
	c.CheckRedirect = func(*http.Request, []*http.Request) error { return http.ErrUseLastResponse }
	resp, err := c.Do(req)
	if err != nil {
		return "", false, err
	}
	_, _ = io.Copy(io.Discard, io.LimitReader(resp.Body, 4096))
	_ = resp.Body.Close()
	switch {
	case resp.StatusCode >= 300 && resp.StatusCode < 400 && resp.Header.Get("Location") != "":
		f.link, f.linkAt = resp.Header.Get("Location"), time.Now()
		return f.link, false, nil
	case resp.StatusCode == http.StatusPartialContent:
		f.link, f.linkAt = "", time.Now()
		return f.asset.URL, true, nil
	}
	return "", false, fmt.Errorf("pieces: %s", resp.Status)
}

// report puts the download on the update screen, at most once a second
func (p *rangeProxy) report() {
	now := time.Now().UnixMilli()
	if last := p.reportAt.Load(); now-last < 1000 || !p.reportAt.CompareAndSwap(last, now) {
		return
	}
	mb := float64(p.fetched.Load()) / (1 << 20)
	p.u.setState(func(s *UpdateState) {
		s.Step = fmt.Sprintf("Downloading what changed (%.0f MB so far)", mb)
		s.BytesDone = p.fetched.Load()
	})
}

// subtractSpans is the parts of r not covered by have (sorted, merged)
func subtractSpans(r span, have []span) []span {
	var out []span
	at := r.From
	for _, h := range have {
		if h.To <= at {
			continue
		}
		if h.From >= r.To {
			break
		}
		if h.From > at {
			out = append(out, span{at, h.From})
		}
		at = max(at, h.To)
		if at >= r.To {
			return out
		}
	}
	if at < r.To {
		out = append(out, span{at, r.To})
	}
	return out
}

// addSpan puts s into the sorted, merged list have
func addSpan(have []span, s span) []span {
	have = append(have, s)
	sort.Slice(have, func(i, j int) bool { return have[i].From < have[j].From })
	out := have[:0]
	for _, h := range have {
		if n := len(out); n > 0 && h.From <= out[n-1].To {
			out[n-1].To = max(out[n-1].To, h.To)
			continue
		}
		out = append(out, h)
	}
	return out
}

// mergeSpans joins spans less than gap apart into fetches of at most maxSpan
func mergeSpans(ss []span, gap, maxSpan int64) []span {
	sort.Slice(ss, func(i, j int) bool { return ss[i].From < ss[j].From })
	var out []span
	for _, s := range ss {
		if n := len(out); n > 0 && s.From-out[n-1].To <= gap && max(s.To, out[n-1].To)-out[n-1].From <= maxSpan {
			out[n-1].To = max(out[n-1].To, s.To)
			continue
		}
		out = append(out, s)
	}
	return out
}
