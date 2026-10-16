package daemon

import (
	"os"
	"path/filepath"
	"runtime"
	"strings"
	"testing"

	librespot "github.com/devgianlu/go-librespot"
)

// an unpacked update on disk, whole enough to run
func fakeUnpacked(t *testing.T, appDir, tag string) {
	t.Helper()
	d := filepath.Join(appDir, tag)
	for name, body := range map[string]string{"go-librespot": "bin", "ui/index.html": "<html>", "version.txt": tag} {
		p := filepath.Join(d, name)
		if err := os.MkdirAll(filepath.Dir(p), 0o755); err != nil {
			t.Fatal(err)
		}
		if err := os.WriteFile(p, []byte(body), 0o755); err != nil {
			t.Fatal(err)
		}
	}
}

func rollbackUpdater(t *testing.T) *updater {
	if runtime.GOOS == "windows" {
		t.Skip("symlinks need privileges on Windows; the device is Linux")
	}
	u := newUpdater(UpdateConfig{Enabled: true, Repo: "me/Wisp"}, &librespot.NullLogger{}, (&navEvents{}).emit, nil)
	u.appDir = t.TempDir()
	u.restart = func() {}
	return u
}

func TestFallBackGoesToTheUpdateBefore(t *testing.T) {
	u := rollbackUpdater(t)
	fakeUnpacked(t, u.appDir, "v0.2.22")
	if err := u.activate("v0.2.22"); err != nil {
		t.Fatal(err)
	}
	// the UI came up on v0.2.22
	_ = os.Remove(filepath.Join(u.appDir, "pending"))
	fakeUnpacked(t, u.appDir, "v0.2.23")
	if err := u.activate("v0.2.23"); err != nil {
		t.Fatal(err)
	}
	u.fallBack("not confirmed by the UI")

	if cur, _ := os.Readlink(filepath.Join(u.appDir, "current")); cur != "v0.2.22" {
		t.Fatalf("should be back on v0.2.22, current is %q", cur)
	}
	if !fileExists(filepath.Join(u.appDir, "v0.2.23", ".bad")) {
		t.Fatal("the update that didn't come up is marked bad")
	}
	rb := u.Status().RolledBack
	if rb == nil || rb.From != "v0.2.23" || rb.To != "v0.2.22" || !strings.Contains(rb.Why, "confirmed") {
		t.Fatalf("the UI should hear what happened, got %+v", rb)
	}
	u.ClearRolledBack()
	if u.Status().RolledBack != nil {
		t.Fatal("told once")
	}
}

func TestFallBackSkipsAnUnconfirmedUpdateBefore(t *testing.T) {
	u := rollbackUpdater(t)
	fakeUnpacked(t, u.appDir, "v0.2.22")
	_ = u.activate("v0.2.22")
	// v0.2.22 was never confirmed: it's no safe place to go back to
	fakeUnpacked(t, u.appDir, "v0.2.23")
	_ = u.activate("v0.2.23")
	u.fallBack("not confirmed by the UI")
	if fileExists(filepath.Join(u.appDir, "current")) {
		t.Fatal("with nothing safe before it, back to the flashed copy")
	}
	if rb := u.Status().RolledBack; rb == nil || rb.To != "" {
		t.Fatalf("the UI should hear it went back to the flashed copy, got %+v", rb)
	}
}

func TestFallBackSkipsABadUpdateBefore(t *testing.T) {
	u := rollbackUpdater(t)
	fakeUnpacked(t, u.appDir, "v0.2.22")
	_ = u.activate("v0.2.22")
	_ = os.Remove(filepath.Join(u.appDir, "pending"))
	fakeUnpacked(t, u.appDir, "v0.2.23")
	_ = u.activate("v0.2.23")
	// it went bad since (the service script's crash loop)
	_ = os.WriteFile(filepath.Join(u.appDir, "v0.2.22", ".bad"), []byte("crash loop\n"), 0o644)
	u.fallBack("not confirmed by the UI")
	if fileExists(filepath.Join(u.appDir, "current")) {
		t.Fatal("a bad update is no place to go back to")
	}
}

func TestANewerFlashIsNotARollBack(t *testing.T) {
	u := rollbackUpdater(t)
	fakeUnpacked(t, u.appDir, "v0.2.22")
	_ = u.activate("v0.2.22")
	u.fallBack("superseded by flash v0.3.0")
	if u.Status().RolledBack != nil {
		t.Fatal("a newer flash taking over isn't something to warn about")
	}
}
