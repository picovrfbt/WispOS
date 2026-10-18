package daemon

import (
	"archive/tar"
	"bytes"
	"compress/gzip"
	"context"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"errors"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"runtime"
	"strings"
	"testing"
	"time"

	librespot "github.com/devgianlu/go-librespot"
)

func makeBundle(t *testing.T, files map[string]string) []byte {
	t.Helper()
	var buf bytes.Buffer
	gz := gzip.NewWriter(&buf)
	tw := tar.NewWriter(gz)
	for name, body := range files {
		mode := int64(0o644)
		if name == "go-librespot" {
			mode = 0o755
		}
		if err := tw.WriteHeader(&tar.Header{Name: name, Mode: mode, Size: int64(len(body)), Typeflag: tar.TypeReg}); err != nil {
			t.Fatal(err)
		}
		_, _ = tw.Write([]byte(body))
	}
	_ = tw.Close()
	_ = gz.Close()
	return buf.Bytes()
}

func goodBundle(t *testing.T, tag string) []byte {
	return makeBundle(t, map[string]string{
		"go-librespot":  "#!/bin/sh\n",
		"ui/index.html": "<html></html>",
		"version.txt":   tag + "\n",
	})
}

// a fake GitHub serving one release with the bundle
func fakeGitHub(t *testing.T, tag string, bundle []byte, digest string, wantToken string) *httptest.Server {
	t.Helper()
	var srv *httptest.Server
	srv = httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if wantToken != "" && r.Header.Get("Authorization") != "Bearer "+wantToken {
			w.WriteHeader(http.StatusNotFound)
			return
		}
		switch r.URL.Path {
		case "/repos/me/Wisp/releases/latest":
			_ = json.NewEncoder(w).Encode(ghRelease{
				TagName: tag,
				Body:    "What's new\n- Faster playlists\n* Phone media covers\nnot a bullet",
				Assets: []ghAsset{{
					Name: "wisp-app-" + tag + ".tar.gz", URL: srv.URL + "/asset/1",
					Size: int64(len(bundle)), Digest: digest,
				}},
			})
		case "/asset/1":
			if r.Header.Get("Accept") != "application/octet-stream" {
				w.WriteHeader(http.StatusBadRequest)
				return
			}
			_, _ = w.Write(bundle)
		default:
			w.WriteHeader(http.StatusNotFound)
		}
	}))
	t.Cleanup(srv.Close)
	return srv
}

func testUpdater(t *testing.T, srv *httptest.Server, token string) (*updater, *navEvents) {
	ev := &navEvents{}
	u := newUpdater(UpdateConfig{Enabled: true, Repo: "me/Wisp"}, &librespot.NullLogger{}, ev.emit, nil)
	u.apiBase = srv.URL
	u.appDir = t.TempDir()
	u.version = func() string { return "v0.2.4" }
	u.restart = func() {}
	if token != "" {
		u.phoneToken = token
	}
	return u, ev
}

func sha(b []byte) string {
	s := sha256.Sum256(b)
	return hex.EncodeToString(s[:])
}

func TestUpdaterCheckFindsNewerRelease(t *testing.T) {
	bundle := goodBundle(t, "v99.0.0")
	srv := fakeGitHub(t, "v99.0.0", bundle, "sha256:"+sha(bundle), "tok")
	u, ev := testUpdater(t, srv, "tok")
	var published string
	u.publish = func(latest string, _ []string) { published = latest }
	u.Check(context.Background())
	s := u.Status()
	if !s.Available || s.Latest != "v99.0.0" || s.Phase != "idle" || published != "v99.0.0" {
		t.Fatalf("unexpected state %+v (published %q)", s, published)
	}
	if len(s.Highlights) != 2 || s.Highlights[0] != "Faster playlists" {
		t.Fatalf("highlights %v", s.Highlights)
	}
	if ev.count(ApiEventTypeUpdate) == 0 {
		t.Fatal("check should emit update state")
	}
}

func TestUpdaterMissingReleaseIsAnError(t *testing.T) {
	bundle := goodBundle(t, "v99.0.0")
	// a repo that answers 404 without a token, as a private or missing one does
	srv := fakeGitHub(t, "v99.0.0", bundle, "", "tok")
	u, _ := testUpdater(t, srv, "")
	u.Check(context.Background())
	s := u.Status()
	if s.Phase != "error" || !strings.Contains(s.Error, "no release") || s.Available {
		t.Fatalf("want a no-release error, got %+v", s)
	}
}

func TestUpdaterIgnoresTheOldPrivateRepo(t *testing.T) {
	bundle := goodBundle(t, "v99.0.0")
	srv := fakeGitHub(t, "v99.0.0", bundle, "", "")
	u, _ := testUpdater(t, srv, "")
	want := u.repo()
	// an older companion app still names the private repo
	u.SetPhoneAuth("picovrfbt/Wisp", "")
	if got := u.repo(); got != want {
		t.Fatalf("the old private repo should be ignored: got %q, want %q", got, want)
	}
	u.SetPhoneAuth("someone/fork", "")
	if got := u.repo(); got != "someone/fork" {
		t.Fatalf("a fork should be followed: got %q", got)
	}
}

func TestUpdaterDownloadVerifiesChecksum(t *testing.T) {
	bundle := goodBundle(t, "v99.0.0")
	srv := fakeGitHub(t, "v99.0.0", bundle, "sha256:"+strings.Repeat("0", 64), "")
	u, _ := testUpdater(t, srv, "")
	u.Check(context.Background())
	u.mu.Lock()
	rel := u.release
	u.mu.Unlock()
	err := u.install(context.Background(), rel)
	if err == nil || !strings.Contains(err.Error(), "verification") {
		t.Fatalf("a wrong checksum must stop the install, got %v", err)
	}
	if fileExists(filepath.Join(u.appDir, "v99.0.0")) {
		t.Fatal("nothing may be unpacked from a bundle that failed verification")
	}
}

func TestUpdaterUnpackRejectsEscapesAndIncompleteBundles(t *testing.T) {
	u, _ := testUpdater(t, httptest.NewServer(http.NotFoundHandler()), "")
	write := func(b []byte) string {
		p := filepath.Join(t.TempDir(), "b.tar.gz")
		_ = os.WriteFile(p, b, 0o644)
		return p
	}
	escape := makeBundle(t, map[string]string{"../evil": "x", "go-librespot": "", "ui/index.html": "", "version.txt": "v1.0.0"})
	if err := u.unpack(write(escape), "v1.0.0"); err == nil || !strings.Contains(err.Error(), "outside") {
		t.Fatalf("a path escaping the bundle must be refused, got %v", err)
	}
	missing := makeBundle(t, map[string]string{"go-librespot": "", "version.txt": "v1.0.0"})
	if err := u.unpack(write(missing), "v1.0.0"); err == nil || !strings.Contains(err.Error(), "ui/index.html") {
		t.Fatalf("a bundle without the UI must be refused, got %v", err)
	}
	wrongVer := goodBundle(t, "v2.0.0")
	if err := u.unpack(write(wrongVer), "v1.0.0"); err == nil {
		t.Fatal("a bundle whose version.txt disagrees with the tag must be refused")
	}
	if err := u.unpack(write(goodBundle(t, "v1.0.0")), "v1.0.0"); err != nil {
		t.Fatalf("a good bundle should unpack: %v", err)
	}
	if !fileExists(filepath.Join(u.appDir, "v1.0.0", "ui", "index.html")) {
		t.Fatal("the UI should be in place")
	}
	if err := u.unpack(write(goodBundle(t, "../x")), "../x"); err == nil {
		t.Fatal("a tag that isn't a plain name must be refused")
	}
}

func TestUpdaterInstallActivates(t *testing.T) {
	if runtime.GOOS == "windows" {
		t.Skip("symlinks need privileges on Windows; the device is Linux")
	}
	bundle := goodBundle(t, "v99.0.0")
	srv := fakeGitHub(t, "v99.0.0", bundle, "sha256:"+sha(bundle), "")
	u, _ := testUpdater(t, srv, "")
	u.Check(context.Background())
	u.mu.Lock()
	rel := u.release
	u.mu.Unlock()
	if err := u.install(context.Background(), rel); err != nil {
		t.Fatal(err)
	}
	if target, _ := os.Readlink(filepath.Join(u.appDir, "current")); target != "v99.0.0" {
		t.Fatalf("current should point at the update, got %q", target)
	}
	if b, _ := os.ReadFile(filepath.Join(u.appDir, "pending")); strings.TrimSpace(string(b)) != "v99.0.0" {
		t.Fatal("a fresh install must wait for the UI to confirm it")
	}
	u.fallBack("test")
	if fileExists(filepath.Join(u.appDir, "current")) {
		t.Fatal("falling back must drop current")
	}
}

func TestReleaseHighlightsAndTags(t *testing.T) {
	if got := releaseHighlights("- a\n- b\n- c\n- d\n- e\n- f"); len(got) != 5 {
		t.Fatalf("highlights cap at 5, got %d", len(got))
	}
	for _, ok := range []string{"v0.2.4", "v1.0.0-beta.1"} {
		if !validTag(ok) {
			t.Fatalf("%s should be a valid tag", ok)
		}
	}
	for _, bad := range []string{"", "../x", "a/b", ".hidden", "v1 0"} {
		if validTag(bad) {
			t.Fatalf("%q should be refused", bad)
		}
	}
}

func TestUpdaterPhoneAuthDoesNotDeadlock(t *testing.T) {
	bundle := goodBundle(t, "v99.0.0")
	srv := fakeGitHub(t, "v99.0.0", bundle, "sha256:"+sha(bundle), "tok")
	u, _ := testUpdater(t, srv, "")
	done := make(chan UpdateState, 1)
	go func() {
		u.SetPhoneAuth("me/Wisp", "tok")
		done <- u.Status()
	}()
	select {
	case s := <-done:
		if !s.HasToken {
			t.Fatalf("the phone's token should count, got %+v", s)
		}
	case <-time.After(3 * time.Second):
		t.Fatal("SetPhoneAuth deadlocked")
	}
}

func TestUpdaterAutoInstallWaitsForQuietAndSkipsBadReleases(t *testing.T) {
	bundle := goodBundle(t, "v99.0.0")
	srv := fakeGitHub(t, "v99.0.0", bundle, "sha256:"+sha(bundle), "")
	u, _ := testUpdater(t, srv, "")
	u.Check(context.Background())

	quiet := false
	asked := 0
	u.autoOK = func() bool { asked++; return quiet }
	u.maybeAutoInstall()
	if u.busy() || u.autoTried != "" {
		t.Fatal("must not install while something is playing")
	}

	// a release that already rolled back here is never tried again
	_ = os.MkdirAll(filepath.Join(u.appDir, "v99.0.0"), 0o755)
	_ = os.WriteFile(filepath.Join(u.appDir, "v99.0.0", ".bad"), []byte("crash loop\n"), 0o644)
	quiet = true
	before := asked
	u.maybeAutoInstall()
	if asked != before || u.autoTried != "" {
		t.Fatal("a release marked bad must not install automatically")
	}

	_ = os.Remove(filepath.Join(u.appDir, "v99.0.0", ".bad"))
	u.maybeAutoInstall()
	if u.autoTried != "v99.0.0" {
		t.Fatal("a quiet moment should start the install")
	}
	// let the install start and finish before the temp dir goes
	for i := 0; i < 100 && u.Status().Phase == "idle"; i++ {
		time.Sleep(20 * time.Millisecond)
	}
	for i := 0; i < 250 && u.busy(); i++ {
		time.Sleep(20 * time.Millisecond)
	}
}

func TestAutoInstallSettingDefaultsOn(t *testing.T) {
	if !autoInstallFromSettings(nil) || !autoInstallFromSettings([]byte(`{"v":1}`)) {
		t.Fatal("automatic installs are on unless turned off")
	}
	if autoInstallFromSettings([]byte(`{"autoInstallUpdates":false}`)) {
		t.Fatal("the setting should turn them off")
	}
}

func TestUpdaterReportsFocusAndProgress(t *testing.T) {
	bundle := goodBundle(t, "v99.0.0")
	// a wrong checksum stops it after the download, on any OS
	srv := fakeGitHub(t, "v99.0.0", bundle, "sha256:"+strings.Repeat("0", 64), "")
	for _, background := range []bool{false, true} {
		u, _ := testUpdater(t, srv, "")
		u.focusMode = func() bool { return !background }
		u.Check(context.Background())
		u.mu.Lock()
		rel := u.release
		u.mu.Unlock()
		if err := u.install(context.Background(), rel); err != nil {
			// what Install does with a failure
			u.setState(func(s *UpdateState) { s.Phase, s.Error = "error", err.Error() })
		}
		s := u.Status()
		if s.Focus == background || s.Installing != "v99.0.0" || s.BytesTotal != int64(len(bundle)) {
			t.Fatalf("background=%v: unexpected state %+v", background, s)
		}
		if s.Step != "Checking the download" {
			t.Fatalf("the step should say where it stopped, got %q", s.Step)
		}
		if u.Focused() {
			t.Fatal("nothing is running now, so nothing holds the Car Thing")
		}
	}
	if !updateInBackgroundFromSettings(nil) || updateInBackgroundFromSettings([]byte(`{"updateInBackground":false}`)) {
		t.Fatal("updates install in the background unless the setting says otherwise")
	}
}

func TestUpdateErrText(t *testing.T) {
	for in, want := range map[string]string{
		`Get "https://api.github.com/x": dial tcp: lookup api.github.com: no such host`: "Couldn't reach the internet. Check the phone's connection and try again",
		"download failed verification (checksum mismatch)":                              "The download was damaged. Try again",
		"not enough space (12 MB free)":                                                 "Not enough room on the Car Thing for the update",
		"bundle is missing VERSION":                                                     "This update is broken. Wait for the next one",
		"an update is already in progress":                                              "an update is already in progress",
	} {
		if got := updateErrText(errors.New(in)); got != want {
			t.Errorf("%q: got %q", in, got)
		}
	}
}
