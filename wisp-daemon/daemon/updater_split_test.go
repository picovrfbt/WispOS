package daemon

import (
	"archive/tar"
	"bytes"
	"compress/gzip"
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"os"
	"os/exec"
	"path/filepath"
	"runtime"
	"strings"
	"sync"
	"testing"
)

var testFonts = map[string]string{
	"ui/fonts/Inter-Regular.woff2": "inter regular bytes",
	"ui/fonts/NotoSansJP-VF.woff2": strings.Repeat("big font ", 500),
	"ui/fonts/sub/extra.woff2":     "nested",
}

func tarOf(t *testing.T, files map[string]string, gz bool) []byte {
	t.Helper()
	var buf bytes.Buffer
	var w = &buf
	var tw *tar.Writer
	var zw *gzip.Writer
	if gz {
		zw = gzip.NewWriter(w)
		tw = tar.NewWriter(zw)
	} else {
		tw = tar.NewWriter(w)
	}
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
	if zw != nil {
		_ = zw.Close()
	}
	return buf.Bytes()
}

// writes the fonts under dir/fonts (as a UI folder) and returns their digest
func plantFonts(t *testing.T, uiDir string) string {
	t.Helper()
	for name, body := range testFonts {
		p := filepath.Join(uiDir, filepath.FromSlash(strings.TrimPrefix(name, "ui/")))
		_ = os.MkdirAll(filepath.Dir(p), 0o755)
		if err := os.WriteFile(p, []byte(body), 0o644); err != nil {
			t.Fatal(err)
		}
	}
	d, err := fontsDigest(filepath.Join(uiDir, "fonts"))
	if err != nil {
		t.Fatal(err)
	}
	return d
}

// a release with the split assets; records which were downloaded
func splitRelease(t *testing.T, tag, fontsDigestHex string) (*httptest.Server, *[]string) {
	t.Helper()
	core := tarOf(t, map[string]string{
		"go-librespot":  "#!/bin/sh\n",
		"ui/index.html": "<html></html>",
		"version.txt":   tag + "\n",
		"fonts.sha256":  fontsDigestHex + "\n",
	}, true)
	fonts := tarOf(t, testFonts, false)
	var mu sync.Mutex
	var fetched []string
	var srv *httptest.Server
	srv = httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		switch r.URL.Path {
		case "/repos/me/Wisp/releases/latest":
			_ = json.NewEncoder(w).Encode(ghRelease{TagName: tag, Assets: []ghAsset{
				{Name: "wisp-core-" + tag + ".tar.gz", URL: srv.URL + "/core", Size: int64(len(core)), Digest: "sha256:" + sha(core)},
				{Name: "wisp-fonts-" + fontsDigestHex[:12] + ".tar", URL: srv.URL + "/fonts", Size: int64(len(fonts)), Digest: "sha256:" + sha(fonts)},
			}})
		case "/core":
			mu.Lock()
			fetched = append(fetched, "core")
			mu.Unlock()
			_, _ = w.Write(core)
		case "/fonts":
			mu.Lock()
			fetched = append(fetched, "fonts")
			mu.Unlock()
			_, _ = w.Write(fonts)
		default:
			w.WriteHeader(http.StatusNotFound)
		}
	}))
	t.Cleanup(srv.Close)
	return srv, &fetched
}

func installSplit(t *testing.T, srv *httptest.Server, flashed string) *updater {
	t.Helper()
	old := flashedUIDir
	flashedUIDir = flashed
	t.Cleanup(func() { flashedUIDir = old })
	u, _ := testUpdater(t, srv, "")
	u.Check(context.Background())
	if !u.Status().Available {
		t.Fatalf("a core-only release should count as an update: %+v", u.Status())
	}
	u.mu.Lock()
	rel := u.release
	u.mu.Unlock()
	err := u.install(context.Background(), rel)
	// switching over needs symlinks, which Windows test runs can't make
	if err != nil && !(runtime.GOOS == "windows" && strings.Contains(err.Error(), "symlink")) {
		t.Fatalf("install: %v", err)
	}
	return u
}

func TestSplitUpdateCopiesFontsAlreadyHere(t *testing.T) {
	flashed := t.TempDir()
	digest := plantFonts(t, flashed)
	srv, fetched := splitRelease(t, "v99.0.0", digest)
	u := installSplit(t, srv, flashed)
	if strings.Join(*fetched, ",") != "core" {
		t.Fatalf("only the core should download, got %v", *fetched)
	}
	got, err := fontsDigest(filepath.Join(u.appDir, "v99.0.0", "ui", "fonts"))
	if err != nil || got != digest {
		t.Fatalf("the update should have the same fonts, got %q (%v)", got, err)
	}
}

func TestSplitUpdateDownloadsFontsItLacks(t *testing.T) {
	flashed := t.TempDir() // no fonts there
	digest, _ := func() (string, error) {
		d := t.TempDir()
		return plantFonts(t, d), nil
	}()
	srv, fetched := splitRelease(t, "v99.0.0", digest)
	u := installSplit(t, srv, flashed)
	if strings.Join(*fetched, ",") != "core,fonts" {
		t.Fatalf("core then fonts should download, got %v", *fetched)
	}
	if got, _ := fontsDigest(filepath.Join(u.appDir, "v99.0.0", "ui", "fonts")); got != digest {
		t.Fatal("downloaded fonts should match the digest")
	}
}

// make-app-bundle.sh names the fonts in shell; it must agree with fontsDigest
func TestFontsDigestMatchesTheBundleScript(t *testing.T) {
	if runtime.GOOS == "windows" {
		t.Skip("the bundle script runs on Linux")
	}
	if _, err := exec.LookPath("sha256sum"); err != nil {
		t.Skip("no sha256sum")
	}
	ui := t.TempDir()
	want := plantFonts(t, ui)
	script := `cd "$1" && find . -type f | sed 's|^\./||' | LC_ALL=C sort | while IFS= read -r f; do printf '%s %s\n' "$(sha256sum "$f" | cut -d' ' -f1)" "$f"; done | sha256sum | cut -d' ' -f1`
	out, err := exec.Command("sh", "-c", script, "sh", filepath.Join(ui, "fonts")).Output()
	if err != nil {
		t.Fatal(err)
	}
	if got := strings.TrimSpace(string(out)); got != want {
		t.Fatalf("shell digest %s, Go digest %s", got, want)
	}
}

func TestBundlesFollowTheDaemonsArchitecture(t *testing.T) {
	rel := &ghRelease{TagName: "v1.2.3", Assets: []ghAsset{
		{Name: "wisp-app-v1.2.3.tar.gz"}, {Name: "wisp-core-v1.2.3.tar.gz"},
		{Name: "wisp-app-v1.2.3-arm64.tar.gz"}, {Name: "wisp-core-v1.2.3-arm64.tar.gz"},
	}}
	old := bundleArch
	t.Cleanup(func() { bundleArch = old })

	bundleArch = archSuffix("arm")
	if a := coreAsset(rel); a == nil || a.Name != "wisp-core-v1.2.3.tar.gz" {
		t.Fatalf("32-bit core: %v", a)
	}
	bundleArch = archSuffix("arm64")
	if a := coreAsset(rel); a == nil || a.Name != "wisp-core-v1.2.3-arm64.tar.gz" {
		t.Fatalf("64-bit core: %v", a)
	}
	if a := bundleAsset(rel); a == nil || a.Name != "wisp-app-v1.2.3-arm64.tar.gz" {
		t.Fatalf("64-bit bundle: %v", a)
	}
	// a release without 64-bit bundles offers a 64-bit Car Thing nothing
	only32 := &ghRelease{TagName: "v1.2.3", Assets: rel.Assets[:2]}
	if coreAsset(only32) != nil || bundleAsset(only32) != nil {
		t.Fatal("a 64-bit Car Thing took a 32-bit bundle")
	}
}
