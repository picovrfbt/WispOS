package daemon

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"mime"
	"mime/multipart"
	"net"
	"net/http"
	"net/http/httptest"
	"strings"
	"sync"
	"sync/atomic"
	"testing"
)

// a release with the whole system and its delta; the pieces are served by
// single range only (as GitHub's storage does), behind a redirect
type deltaRelease struct {
	srv                    *httptest.Server
	full, delta, sys, boot []byte
	pieceHits              atomic.Int64
	fullHits               atomic.Int64
	broken                 atomic.Bool
}

func fakeDeltaGitHub(t *testing.T) *deltaRelease {
	t.Helper()
	d := &deltaRelease{
		full:  bytes.Repeat([]byte("full system "), 1000),
		delta: []byte("chunk lists"),
		sys:   make([]byte, 3<<20),
		boot:  bytes.Repeat([]byte("boot"), 5000),
	}
	for i := range d.sys {
		d.sys[i] = byte(i * 7)
	}
	serveRange := func(w http.ResponseWriter, r *http.Request, body []byte) {
		if d.broken.Load() {
			w.WriteHeader(http.StatusBadGateway)
			return
		}
		var from, to int
		if _, err := fmt.Sscanf(r.Header.Get("Range"), "bytes=%d-%d", &from, &to); err != nil || strings.Contains(r.Header.Get("Range"), ",") {
			// whole files and multi-range requests aren't what the proxy should send
			w.WriteHeader(http.StatusBadRequest)
			return
		}
		d.pieceHits.Add(1)
		w.Header().Set("Content-Range", fmt.Sprintf("bytes %d-%d/%d", from, to, len(body)))
		w.WriteHeader(http.StatusPartialContent)
		_, _ = w.Write(body[from : to+1])
	}
	d.srv = httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		u := d.srv.URL
		switch r.URL.Path {
		case "/repos/me/Wisp/releases/latest":
			_ = json.NewEncoder(w).Encode(ghRelease{TagName: "v1.0.6", Assets: []ghAsset{
				{Name: "wisp-os-v1.0.6.swu", URL: u + "/asset/full", Size: int64(len(d.full)), Digest: "sha256:" + sha(d.full)},
				{Name: "wisp-os-v1.0.6-delta.swu", URL: u + "/asset/delta", Size: int64(len(d.delta)), Digest: "sha256:" + sha(d.delta)},
				{Name: "wisp-os-v1.0.6-system.zck", URL: u + "/asset/sys", Size: int64(len(d.sys)), Digest: "sha256:" + sha(d.sys)},
				{Name: "wisp-os-v1.0.6-boot.zck", URL: u + "/asset/boot", Size: int64(len(d.boot)), Digest: "sha256:" + sha(d.boot)},
			}})
		case "/asset/full":
			d.fullHits.Add(1)
			_, _ = w.Write(d.full)
		case "/asset/delta":
			_, _ = w.Write(d.delta)
		case "/asset/sys":
			http.Redirect(w, r, u+"/storage/sys", http.StatusFound)
		case "/storage/sys":
			serveRange(w, r, d.sys)
		case "/asset/boot":
			// no redirect: the asset link serves ranges itself
			serveRange(w, r, d.boot)
		default:
			w.WriteHeader(http.StatusNotFound)
		}
	}))
	t.Cleanup(d.srv.Close)
	return d
}

func freeAddr(t *testing.T) string {
	t.Helper()
	l, err := net.Listen("tcp", "127.0.0.1:0")
	if err != nil {
		t.Fatal(err)
	}
	a := l.Addr().String()
	_ = l.Close()
	return a
}

// what swupdate's delta handler does: several ranges in one request, read back as multipart
func getRanges(addr, path string, ranges ...[2]int) ([][]byte, error) {
	var parts []string
	for _, r := range ranges {
		parts = append(parts, fmt.Sprintf("%d-%d", r[0], r[1]))
	}
	req, _ := http.NewRequest("GET", "http://"+addr+path, nil)
	req.Header.Set("Range", "bytes="+strings.Join(parts, ","))
	resp, err := http.DefaultClient.Do(req)
	if err != nil {
		return nil, err
	}
	defer func() { _ = resp.Body.Close() }()
	if resp.StatusCode != http.StatusPartialContent {
		return nil, fmt.Errorf("status %s", resp.Status)
	}
	if len(ranges) == 1 {
		b, err := io.ReadAll(resp.Body)
		return [][]byte{b}, err
	}
	_, params, err := mime.ParseMediaType(resp.Header.Get("Content-Type"))
	if err != nil {
		return nil, err
	}
	mr := multipart.NewReader(resp.Body, params["boundary"])
	var out [][]byte
	for {
		p, err := mr.NextPart()
		if err == io.EOF {
			return out, nil
		}
		if err != nil {
			return nil, err
		}
		b, _ := io.ReadAll(p)
		want := fmt.Sprintf("bytes %d-%d/", ranges[len(out)][0], ranges[len(out)][1])
		if !strings.HasPrefix(p.Header.Get("Content-Range"), want) {
			return nil, fmt.Errorf("part %d: Content-Range %q", len(out), p.Header.Get("Content-Range"))
		}
		out = append(out, b)
	}
}

func deltaUpdater(t *testing.T, d *deltaRelease) (*updater, *systemCalls, *[]string) {
	u, c := systemUpdater(t, d.srv, "v1.0.0")
	u.resumeWait = 0
	u.deltaAddr = freeAddr(t)
	var mu sync.Mutex
	var applied []string
	u.applySystem = func(_ context.Context, swu, slot string) error {
		mu.Lock()
		applied = append(applied, swu)
		mu.Unlock()
		if !strings.Contains(swu, "-delta.swu") {
			c.wrote = append(c.wrote, slot)
			return nil
		}
		got, err := getRanges(u.deltaAddr, "/system.img.zck", [2]int{0, 9}, [2]int{100, 199}, [2]int{2 << 20, 2<<20 + 4095})
		if err != nil {
			return err
		}
		if !bytes.Equal(got[0], d.sys[0:10]) || !bytes.Equal(got[1], d.sys[100:200]) || !bytes.Equal(got[2], d.sys[2<<20:2<<20+4096]) {
			return errors.New("wrong bytes")
		}
		one, err := getRanges(u.deltaAddr, "/boot.vfat.zck", [2]int{4, 11})
		if err != nil {
			return err
		}
		if !bytes.Equal(one[0], d.boot[4:12]) {
			return errors.New("wrong boot bytes")
		}
		c.wrote = append(c.wrote, slot)
		return nil
	}
	return u, c, &applied
}

func TestDeltaSystemUpdate(t *testing.T) {
	d := fakeDeltaGitHub(t)
	u, c, applied := deltaUpdater(t, d)
	u.Check(context.Background())
	if err := u.Install(); err != nil {
		t.Fatal(err)
	}
	s := waitPhase(t, u, func(s UpdateState) bool { return s.RestartPending != "" || s.Phase == "error" })
	if s.Phase == "error" {
		t.Fatalf("install failed: %s", s.Error)
	}
	if len(*applied) != 1 || !strings.HasSuffix((*applied)[0], "-delta.swu") || len(c.wrote) != 1 || c.wrote[0] != "b" {
		t.Fatalf("applied %v, wrote %v", *applied, c.wrote)
	}
	if d.fullHits.Load() != 0 {
		t.Error("downloaded the whole system as well")
	}
	// 0-9 and 100-199 are close enough for one request, the third is its own; boot
	// takes one plus the look at whether its link redirects
	if n := d.pieceHits.Load(); n != 4 {
		t.Errorf("%d piece requests, want 4", n)
	}
	if fileExists(u.osDir + "/delta-v1.0.6") {
		t.Error("delta pieces left behind after the write")
	}
}

func TestDeltaFallsBackToTheWholeSystem(t *testing.T) {
	d := fakeDeltaGitHub(t)
	u, c, applied := deltaUpdater(t, d)
	inner := u.applySystem
	u.applySystem = func(ctx context.Context, swu, slot string) error {
		if strings.Contains(swu, "-delta.swu") {
			*applied = append(*applied, swu)
			return errors.New("swupdate: exit status 1")
		}
		return inner(ctx, swu, slot)
	}
	u.Check(context.Background())
	_ = u.Install()
	s := waitPhase(t, u, func(s UpdateState) bool { return s.RestartPending != "" || s.Phase == "error" })
	if s.Phase == "error" {
		t.Fatalf("install failed: %s", s.Error)
	}
	if len(*applied) != 2 || d.fullHits.Load() == 0 || len(c.wrote) != 1 {
		t.Fatalf("applied %v, full downloads %d, wrote %v", *applied, d.fullHits.Load(), c.wrote)
	}
}

func TestDeltaOfflineWaitsInsteadOfTheWholeSystem(t *testing.T) {
	d := fakeDeltaGitHub(t)
	d.broken.Store(true)
	u, _, _ := deltaUpdater(t, d)
	u.Check(context.Background())
	_ = u.Install()
	waitPhase(t, u, func(s UpdateState) bool { return s.Phase == "error" })
	if d.fullHits.Load() != 0 {
		t.Fatal("a dropped connection fell back to the 200 MB download")
	}
	if !fileExists(u.osDir + "/delta-v1.0.6") {
		t.Fatal("the delta's kept pieces were thrown away")
	}
}

func TestRangeProxyKeepsPieces(t *testing.T) {
	d := fakeDeltaGitHub(t)
	u, _ := systemUpdater(t, d.srv, "v1.0.0")
	dir := t.TempDir()
	asset := &ghAsset{Name: "wisp-os-v1.0.6-system.zck", URL: d.srv.URL + "/asset/sys", Size: int64(len(d.sys))}
	serve := func() string {
		p := newRangeProxy(u, dir, map[string]*ghAsset{"/system.img.zck": asset})
		srv := httptest.NewServer(p)
		t.Cleanup(srv.Close)
		return strings.TrimPrefix(srv.URL, "http://")
	}
	addr := serve()
	if _, err := getRanges(addr, "/system.img.zck", [2]int{1000, 1999}); err != nil {
		t.Fatal(err)
	}
	before := d.pieceHits.Load()
	// the Car Thing turned off; the next drive's proxy has the same pieces
	addr = serve()
	got, err := getRanges(addr, "/system.img.zck", [2]int{1000, 1999})
	if err != nil {
		t.Fatal(err)
	}
	if !bytes.Equal(got[0], d.sys[1000:2000]) || d.pieceHits.Load() != before {
		t.Fatalf("kept piece fetched again (%d requests)", d.pieceHits.Load()-before)
	}
	// part kept, part new: only the new part is fetched
	if got, err = getRanges(addr, "/system.img.zck", [2]int{1500, 400000}); err != nil || !bytes.Equal(got[0], d.sys[1500:400001]) {
		t.Fatalf("overlapping range: %v", err)
	}
	if d.pieceHits.Load() != before+1 {
		t.Fatalf("%d requests for the new part", d.pieceHits.Load()-before)
	}
}

func TestRangeProxyRefusesBadRanges(t *testing.T) {
	d := fakeDeltaGitHub(t)
	u, _ := systemUpdater(t, d.srv, "v1.0.0")
	p := newRangeProxy(u, t.TempDir(), map[string]*ghAsset{"/system.img.zck": {Name: "s", URL: d.srv.URL + "/asset/sys", Size: 100}})
	srv := httptest.NewServer(p)
	defer srv.Close()
	for _, rg := range []string{"", "bytes=200-300", "bytes=5-1", "items=0-1"} {
		req, _ := http.NewRequest("GET", srv.URL+"/system.img.zck", nil)
		if rg != "" {
			req.Header.Set("Range", rg)
		}
		resp, err := http.DefaultClient.Do(req)
		if err != nil {
			t.Fatal(err)
		}
		_ = resp.Body.Close()
		if resp.StatusCode != http.StatusRequestedRangeNotSatisfiable {
			t.Errorf("%q: %s", rg, resp.Status)
		}
	}
	resp, _ := http.Get(srv.URL + "/etc/passwd")
	if resp.StatusCode != http.StatusNotFound {
		t.Errorf("other path: %s", resp.Status)
	}
	_ = resp.Body.Close()
}

func TestSpans(t *testing.T) {
	have := addSpan(nil, span{10, 20})
	have = addSpan(have, span{30, 40})
	have = addSpan(have, span{20, 25})
	if fmt.Sprint(have) != "[{10 25} {30 40}]" {
		t.Fatalf("addSpan %v", have)
	}
	if got := fmt.Sprint(subtractSpans(span{0, 50}, have)); got != "[{0 10} {25 30} {40 50}]" {
		t.Fatalf("subtract %s", got)
	}
	if got := subtractSpans(span{12, 24}, have); len(got) != 0 {
		t.Fatalf("covered range still missing %v", got)
	}
	if got := fmt.Sprint(mergeSpans([]span{{100, 200}, {0, 10}, {50, 60}, {10000, 10010}}, 100, 1000)); got != "[{0 200} {10000 10010}]" {
		t.Fatalf("merge %s", got)
	}
	if got := fmt.Sprint(mergeSpans([]span{{0, 600}, {650, 1200}}, 100, 1000)); got != "[{0 600} {650 1200}]" {
		t.Fatalf("merge past the cap %s", got)
	}
}

func TestDeltaAssets(t *testing.T) {
	rel := &ghRelease{Assets: []ghAsset{{Name: "wisp-os-v1.0.6-delta.swu"}, {Name: "wisp-os-v1.0.6-system.zck"}}}
	if deltaAssetsFor(rel, "v1.0.6") != nil {
		t.Fatal("delta without its boot pieces")
	}
	rel.Assets = append(rel.Assets, ghAsset{Name: "wisp-os-v1.0.6-boot.zck"})
	if deltaAssetsFor(rel, "v1.0.6") == nil || deltaAssetsFor(rel, "v1.0.7") != nil {
		t.Fatal("delta assets")
	}
	// the delta's names aren't taken for whole systems
	if systemAssetRe.MatchString("wisp-os-v1.0.6-delta.swu") {
		t.Fatal("delta read as a whole system")
	}
}
