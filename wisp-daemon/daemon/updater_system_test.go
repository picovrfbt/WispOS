package daemon

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"strings"
	"sync"
	"testing"
	"time"
)

// a fake GitHub whose latest release carries a system update, serving Range requests
func fakeSystemGitHub(t *testing.T, tag, sysName string, swu []byte, digest string) (*httptest.Server, *[]string) {
	t.Helper()
	var mu sync.Mutex
	var ranges []string
	var srv *httptest.Server
	srv = httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		switch r.URL.Path {
		case "/repos/me/Wisp/releases/latest":
			_ = json.NewEncoder(w).Encode(ghRelease{
				TagName: tag,
				Body:    "- New system",
				Assets: []ghAsset{{
					Name: sysName, URL: srv.URL + "/asset/sys", Size: int64(len(swu)), Digest: digest,
				}},
			})
		case "/asset/sys":
			mu.Lock()
			ranges = append(ranges, r.Header.Get("Range"))
			mu.Unlock()
			var from int
			if rg := r.Header.Get("Range"); rg != "" {
				_, _ = fmt.Sscanf(rg, "bytes=%d-", &from)
				w.Header().Set("Content-Range", fmt.Sprintf("bytes %d-%d/%d", from, len(swu)-1, len(swu)))
				w.WriteHeader(http.StatusPartialContent)
			}
			_, _ = w.Write(swu[from:])
		default:
			w.WriteHeader(http.StatusNotFound)
		}
	}))
	t.Cleanup(srv.Close)
	return srv, &ranges
}

type systemCalls struct {
	mu       sync.Mutex
	wrote    []string
	switched []string
	reboots  int
	fail     error
}

func systemUpdater(t *testing.T, srv *httptest.Server, osVer string) (*updater, *systemCalls) {
	u, _ := testUpdater(t, srv, "")
	c := &systemCalls{}
	u.systemOS = true
	u.osDir = t.TempDir()
	u.osVersion = func() string { return osVer }
	u.bootID = func() string { return "boot-1" }
	u.slot = func() string { return "a" }
	u.applySystem = func(_ context.Context, swu, slot string) error {
		c.mu.Lock()
		defer c.mu.Unlock()
		if c.fail != nil {
			return c.fail
		}
		if !fileExists(swu) {
			return errors.New("no file")
		}
		c.wrote = append(c.wrote, slot)
		return nil
	}
	u.switchSlot = func(s string) error {
		c.mu.Lock()
		c.switched = append(c.switched, s)
		c.mu.Unlock()
		return nil
	}
	u.reboot = func() {
		c.mu.Lock()
		c.reboots++
		c.mu.Unlock()
	}
	u.focusMode = func() bool { return false }
	return u, c
}

func waitPhase(t *testing.T, u *updater, ok func(UpdateState) bool) UpdateState {
	t.Helper()
	deadline := time.Now().Add(5 * time.Second)
	for time.Now().Before(deadline) {
		if s := u.Status(); ok(s) {
			return s
		}
		time.Sleep(10 * time.Millisecond)
	}
	t.Fatalf("timed out, state %+v", u.Status())
	return UpdateState{}
}

func TestSystemUpdateOffered(t *testing.T) {
	swu := []byte("system image")
	srv, _ := fakeSystemGitHub(t, "v1.0.6", "wisp-os-v1.0.6.swu", swu, "sha256:"+sha(swu))

	u, _ := systemUpdater(t, srv, "v1.0.0")
	u.Check(context.Background())
	s := u.Status()
	if !s.Available || s.System == nil || s.System.Version != "v1.0.6" || s.System.Size != int64(len(swu)) {
		t.Fatalf("system update not offered: %+v", s)
	}

	// already on it, or on the original firmware: nothing to offer
	u, _ = systemUpdater(t, srv, "v1.0.6")
	u.Check(context.Background())
	if s := u.Status(); s.System != nil {
		t.Errorf("same version offered: %+v", s.System)
	}
	u, _ = systemUpdater(t, srv, "v1.0.0")
	u.systemOS = false
	u.Check(context.Background())
	if s := u.Status(); s.System != nil {
		t.Errorf("offered on the original firmware: %+v", s.System)
	}

	// one that failed here before isn't offered again
	u, _ = systemUpdater(t, srv, "v1.0.0")
	_ = os.WriteFile(filepath.Join(u.osDir, "bad-v1.0.6"), []byte("x"), 0o644)
	u.Check(context.Background())
	if s := u.Status(); s.System != nil {
		t.Errorf("bad version offered: %+v", s.System)
	}
}

func TestSystemAssetNames(t *testing.T) {
	for name, want := range map[string]bool{
		"wisp-os-v1.0.6.swu":        true,
		"wisp-os-v1.0.6.swu.sha256": false,
		"wisp-os-1.0.6.swu":         false,
		"wisp-os-v1.0.swu":          false,
		"wisp-app-v1.0.6.tar.gz":    false,
	} {
		if got := systemAssetRe.MatchString(name); got != want {
			t.Errorf("%s: %v", name, got)
		}
	}
}

func TestSystemUpdateInBackground(t *testing.T) {
	swu := bytes.Repeat([]byte("wisp os "), 4096)
	srv, _ := fakeSystemGitHub(t, "v1.0.6", "wisp-os-v1.0.6.swu", swu, "sha256:"+sha(swu))
	u, c := systemUpdater(t, srv, "v1.0.0")
	u.Check(context.Background())
	if err := u.Install(); err != nil {
		t.Fatal(err)
	}
	s := waitPhase(t, u, func(s UpdateState) bool { return s.RestartPending != "" || s.Phase == "error" })
	if s.Phase == "error" {
		t.Fatalf("install failed: %s", s.Error)
	}
	if s.RestartPending != "v1.0.6" || s.Available || s.System != nil {
		t.Fatalf("state after the write: %+v", s)
	}
	if len(c.wrote) != 1 || c.wrote[0] != "b" {
		t.Fatalf("wrote %v, want the other slot (b)", c.wrote)
	}
	if c.reboots != 0 {
		t.Fatal("a background install restarted the Car Thing")
	}
	if fileExists(filepath.Join(u.osDir, "wisp-os-v1.0.6.swu.part")) {
		t.Error("download left behind")
	}
	p := u.readSystemPending()
	if p == nil || p.Version != "v1.0.6" || p.From != "v1.0.0" || p.FromSlot != "a" || p.Boot != "boot-1" {
		t.Fatalf("pending %+v", p)
	}
	// a check now doesn't offer it again
	u.Check(context.Background())
	if s := u.Status(); s.Available || s.System != nil {
		t.Errorf("written system offered again: %+v", s)
	}
	// Restart now
	if err := u.Restart(); err != nil {
		t.Fatal(err)
	}
	waitPhase(t, u, func(UpdateState) bool { c.mu.Lock(); defer c.mu.Unlock(); return c.reboots == 1 })
}

func TestSystemUpdateFocusedRestarts(t *testing.T) {
	swu := []byte("system image")
	srv, _ := fakeSystemGitHub(t, "v1.0.6", "wisp-os-v1.0.6.swu", swu, "sha256:"+sha(swu))
	u, c := systemUpdater(t, srv, "v1.0.0")
	u.slot = func() string { return "b" }
	u.focusMode = func() bool { return true }
	u.Check(context.Background())
	if err := u.Install(); err != nil {
		t.Fatal(err)
	}
	waitPhase(t, u, func(s UpdateState) bool { return s.Phase == "restarting" })
	waitPhase(t, u, func(UpdateState) bool { c.mu.Lock(); defer c.mu.Unlock(); return c.reboots == 1 })
	if len(c.wrote) != 1 || c.wrote[0] != "a" {
		t.Fatalf("wrote %v, want a", c.wrote)
	}
}

func TestSystemUpdateBadDownload(t *testing.T) {
	swu := []byte("system image")
	srv, _ := fakeSystemGitHub(t, "v1.0.6", "wisp-os-v1.0.6.swu", swu, "sha256:"+sha([]byte("something else")))
	u, c := systemUpdater(t, srv, "v1.0.0")
	u.Check(context.Background())
	_ = u.Install()
	s := waitPhase(t, u, func(s UpdateState) bool { return s.Phase == "error" })
	if !strings.Contains(s.Error, "damaged") || len(c.wrote) != 0 {
		t.Fatalf("state %+v, wrote %v", s, c.wrote)
	}
	if fileExists(filepath.Join(u.osDir, "wisp-os-v1.0.6.swu.part")) {
		t.Error("a damaged download is kept for resuming")
	}
}

func TestSystemDownloadCarriesOn(t *testing.T) {
	swu := bytes.Repeat([]byte("0123456789"), 5000)
	srv, ranges := fakeSystemGitHub(t, "v1.0.6", "wisp-os-v1.0.6.swu", swu, "sha256:"+sha(swu))
	u, c := systemUpdater(t, srv, "v1.0.0")
	// the last drive got this far
	_ = os.WriteFile(filepath.Join(u.osDir, "wisp-os-v1.0.6.swu.part"), swu[:20000], 0o644)
	// and an older offer's leftovers make room
	_ = os.WriteFile(filepath.Join(u.osDir, "wisp-os-v1.0.5.swu.part"), []byte("old"), 0o644)
	u.Check(context.Background())
	_ = u.Install()
	s := waitPhase(t, u, func(s UpdateState) bool { return s.RestartPending != "" || s.Phase == "error" })
	if s.Phase == "error" {
		t.Fatalf("install failed: %s", s.Error)
	}
	if len(*ranges) != 1 || (*ranges)[0] != "bytes=20000-" {
		t.Fatalf("requests %q, want one carrying on from 20000", *ranges)
	}
	if len(c.wrote) != 1 || fileExists(filepath.Join(u.osDir, "wisp-os-v1.0.5.swu.part")) {
		t.Fatalf("wrote %v; old download kept: %v", c.wrote, fileExists(filepath.Join(u.osDir, "wisp-os-v1.0.5.swu.part")))
	}
}

func TestSystemWriteFails(t *testing.T) {
	swu := []byte("system image")
	srv, _ := fakeSystemGitHub(t, "v1.0.6", "wisp-os-v1.0.6.swu", swu, "sha256:"+sha(swu))
	u, c := systemUpdater(t, srv, "v1.0.0")
	c.fail = errors.New("swupdate: exit status 1")
	u.Check(context.Background())
	_ = u.Install()
	waitPhase(t, u, func(s UpdateState) bool { return s.Phase == "error" })
	if u.readSystemPending() != nil || c.reboots != 0 {
		t.Fatal("a failed write still switched")
	}
}

func writePending(t *testing.T, u *updater, p systemPending) {
	t.Helper()
	b, _ := json.Marshal(p)
	if err := os.WriteFile(filepath.Join(u.osDir, "pending.json"), b, 0o644); err != nil {
		t.Fatal(err)
	}
}

func TestSystemStartupSameBoot(t *testing.T) {
	srv, _ := fakeSystemGitHub(t, "v1.0.6", "x", nil, "")
	u, _ := systemUpdater(t, srv, "v1.0.0")
	writePending(t, u, systemPending{Version: "v1.0.6", From: "v1.0.0", FromSlot: "a", Boot: "boot-1"})
	u.systemStartup(context.Background())
	if s := u.Status(); s.RestartPending != "v1.0.6" {
		t.Fatalf("a daemon restart forgot the written system: %+v", s)
	}
}

func TestSystemStartupTookOver(t *testing.T) {
	srv, _ := fakeSystemGitHub(t, "v1.0.6", "x", nil, "")
	u, c := systemUpdater(t, srv, "v1.0.6")
	u.bootID = func() string { return "boot-2" }
	writePending(t, u, systemPending{Version: "v1.0.6", From: "v1.0.0", FromSlot: "a", Boot: "boot-1"})
	u.systemStartup(context.Background())
	u.Confirm()
	// polled with Stat: a read open at the moment of the delete stops it on Windows
	pending := filepath.Join(u.osDir, "pending.json")
	deadline := time.Now().Add(2 * time.Second)
	for fileExists(pending) && time.Now().Before(deadline) {
		time.Sleep(10 * time.Millisecond)
	}
	if fileExists(pending) {
		t.Fatal("confirmed system still pending")
	}
	c.mu.Lock()
	defer c.mu.Unlock()
	if len(c.switched) != 0 || c.reboots != 0 || u.rolledBack() != nil {
		t.Fatalf("switched %v, reboots %d, rolled back %+v", c.switched, c.reboots, u.rolledBack())
	}
}

func TestSystemStartupWentBack(t *testing.T) {
	srv, _ := fakeSystemGitHub(t, "v1.0.6", "x", nil, "")
	// u-boot gave up on the new slot: still the old system
	u, _ := systemUpdater(t, srv, "v1.0.0")
	u.bootID = func() string { return "boot-2" }
	writePending(t, u, systemPending{Version: "v1.0.6", From: "v1.0.0", FromSlot: "a", Boot: "boot-1"})
	u.systemStartup(context.Background())
	if u.readSystemPending() != nil {
		t.Error("pending kept")
	}
	if !fileExists(filepath.Join(u.osDir, "bad-v1.0.6")) {
		t.Error("failed version not marked bad")
	}
	r := u.rolledBack()
	if r == nil || r.Kind != "system" || r.From != "v1.0.6" || r.To != "v1.0.0" {
		t.Fatalf("rolled back %+v", r)
	}
}

func TestRestartWithNothingWaiting(t *testing.T) {
	srv, _ := fakeSystemGitHub(t, "v1.0.6", "x", nil, "")
	u, c := systemUpdater(t, srv, "v1.0.0")
	if err := u.Restart(); err == nil || c.reboots != 0 {
		t.Fatal("restarted with nothing waiting")
	}
}

func TestOtherSlot(t *testing.T) {
	if otherSlot("a") != "b" || otherSlot("b") != "a" || otherSlot("") != "a" {
		t.Fatal("otherSlot")
	}
}
