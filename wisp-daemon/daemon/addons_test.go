package daemon

import (
	"archive/zip"
	"bytes"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"net"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"strings"
	"testing"
)

type quietLog struct{}

func (quietLog) Infof(string, ...any) {}
func (quietLog) Warnf(string, ...any) {}

func addonZip(t *testing.T, files map[string]string) []byte {
	t.Helper()
	var buf bytes.Buffer
	w := zip.NewWriter(&buf)
	for name, body := range files {
		f, err := w.Create(name)
		if err != nil {
			t.Fatal(err)
		}
		_, _ = f.Write([]byte(body))
	}
	if err := w.Close(); err != nil {
		t.Fatal(err)
	}
	return buf.Bytes()
}

func manifestJSON(m AddonManifest) string {
	b, _ := json.Marshal(m)
	return string(b)
}

func TestAddonManifestRules(t *testing.T) {
	ok := AddonManifest{ID: "forecast", Name: "Forecast", Version: "1.0", Permissions: []string{"location", "weather"}, Network: []string{"api.open-meteo.com"}}
	if err := ok.validate(); err != nil || ok.Entry != "index.html" {
		t.Fatalf("a good manifest: %v (entry %q)", err, ok.Entry)
	}
	bad := []AddonManifest{
		{ID: "Bad ID", Name: "x"},
		{ID: "x1", Name: ""},
		{ID: "x1", Name: "x", Entry: "../../etc/passwd"},
		{ID: "x1", Name: "x", Permissions: []string{"settings"}},
		{ID: "x1", Name: "x", Network: []string{"127.0.0.1"}},
		{ID: "x1", Name: "x", Network: []string{"localhost"}},
		{ID: "x1", Name: "x", Network: []string{"router.local"}},
		{ID: "x1", Name: "x", Network: []string{"example.com:8080"}},
		{ID: "x1", Name: "x", Image: "../up.png"},
		{ID: "x1", Name: "x", Image: "preview.svg"},
	}
	for _, m := range bad {
		if m.validate() == nil {
			t.Errorf("%+v should be refused", m)
		}
	}
}

func TestAddonInstallZip(t *testing.T) {
	s := newAddonStore(t.TempDir(), func() string { return "x/y" }, quietLog{})
	m := AddonManifest{ID: "clock", Name: "Big clock", Version: "1"}
	good := addonZip(t, map[string]string{"addon.json": manifestJSON(m), "index.html": "<p>hi</p>", "img/face.svg": "<svg/>"})
	got, err := s.installZip("clock", good)
	if err != nil || got.ID != "clock" {
		t.Fatalf("install: %v", err)
	}
	if list := s.Installed(); len(list) != 1 || list[0].Name != "Big clock" {
		t.Fatalf("installed: %+v", list)
	}
	// a second install replaces the first
	m.Version = "2"
	if _, err := s.installZip("clock", addonZip(t, map[string]string{"addon.json": manifestJSON(m), "index.html": "v2"})); err != nil {
		t.Fatal(err)
	}
	if b, _ := os.ReadFile(filepath.Join(s.dir, "clock", "index.html")); string(b) != "v2" {
		t.Fatalf("not replaced: %q", b)
	}

	refused := map[string][]byte{
		"a path out of the folder": addonZip(t, map[string]string{"addon.json": manifestJSON(m), "index.html": "x", "../escape.txt": "x"}),
		"a different id":           addonZip(t, map[string]string{"addon.json": manifestJSON(AddonManifest{ID: "other", Name: "x"}), "index.html": "x"}),
		"no page":                  addonZip(t, map[string]string{"addon.json": manifestJSON(m)}),
		"not a zip":                []byte("hello"),
	}
	for why, z := range refused {
		if _, err := s.installZip("clock", z); err == nil {
			t.Errorf("%s should be refused", why)
		}
	}
	// a refused install leaves the installed one alone
	if b, _ := os.ReadFile(filepath.Join(s.dir, "clock", "index.html")); string(b) != "v2" {
		t.Fatalf("a failed install touched the old one: %q", b)
	}
	if err := s.Remove("clock"); err != nil || len(s.Installed()) != 0 {
		t.Fatalf("remove: %v", err)
	}
}

func TestAddonCatalogInstallChecksTheChecksum(t *testing.T) {
	m := AddonManifest{ID: "clock", Name: "Big clock", Version: "1"}
	z := addonZip(t, map[string]string{"addon.json": manifestJSON(m), "index.html": "x"})
	sum := sha256.Sum256(z)
	right := hex.EncodeToString(sum[:])
	for _, c := range []struct {
		sha string
		ok  bool
	}{{right, true}, {strings.Repeat("0", 64), false}} {
		srv := httptest.NewTLSServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			if strings.HasSuffix(r.URL.Path, "catalog.json") {
				_ = json.NewEncoder(w).Encode(map[string]any{"addons": []AddonCatalogEntry{{AddonManifest: m, Zip: "dist/clock-1.zip", SHA256: c.sha}}})
				return
			}
			_, _ = w.Write(z)
		}))
		s := newAddonStore(t.TempDir(), func() string { return "x/y" }, quietLog{})
		s.client = srv.Client()
		// the catalog from the test server instead of GitHub
		s.mu.Lock()
		s.catalog = nil
		s.mu.Unlock()
		cat, err := func() ([]AddonCatalogEntry, error) {
			body, err := s.get(t.Context(), srv.URL+"/addons/catalog.json", 1<<20)
			if err != nil {
				return nil, err
			}
			var doc struct {
				Addons []AddonCatalogEntry `json:"addons"`
			}
			return doc.Addons, json.Unmarshal(body, &doc)
		}()
		if err != nil || len(cat) != 1 {
			t.Fatal(err)
		}
		data, err := s.get(t.Context(), srv.URL+"/addons/"+cat[0].Zip, addonMaxZip)
		if err != nil {
			t.Fatal(err)
		}
		got := sha256.Sum256(data)
		matches := strings.EqualFold(hex.EncodeToString(got[:]), cat[0].SHA256)
		if matches != c.ok {
			t.Errorf("checksum %s: matches=%v", c.sha[:8], matches)
		}
		srv.Close()
	}
}

func TestResolveAddonZip(t *testing.T) {
	cat := "https://raw.githubusercontent.com/picovrfbt/WispOS/main/addons/catalog.json"
	if u, err := resolveAddonZip(cat, "dist/clock-1.zip"); err != nil || u != "https://raw.githubusercontent.com/picovrfbt/WispOS/main/addons/dist/clock-1.zip" {
		t.Fatalf("%s %v", u, err)
	}
	if _, err := resolveAddonZip(cat, "http://example.com/x.zip"); err == nil {
		t.Fatal("plain http should be refused")
	}
}

func TestAddonFetchOnlyItsOwnSites(t *testing.T) {
	s := newAddonStore(t.TempDir(), func() string { return "x/y" }, quietLog{})
	m := AddonManifest{ID: "forecast", Name: "Forecast", Network: []string{"api.open-meteo.com"}}
	if _, err := s.installZip("forecast", addonZip(t, map[string]string{"addon.json": manifestJSON(m), "index.html": "x"})); err != nil {
		t.Fatal(err)
	}
	for _, u := range []string{
		"https://evil.example.com/steal",
		"http://api.open-meteo.com/v1/forecast",
		"https://api.open-meteo.com:8443/x",
		"https://user@api.open-meteo.com/x",
		"file:///etc/passwd",
	} {
		if _, _, _, err := s.Fetch(t.Context(), "forecast", u); err == nil {
			t.Errorf("%s should be refused", u)
		}
	}
	if _, _, _, err := s.Fetch(t.Context(), "nope", "https://api.open-meteo.com/"); err == nil {
		t.Error("an add-on that isn't installed can't fetch")
	}
}

func TestPublicIP(t *testing.T) {
	for _, ip := range []string{"127.0.0.1", "192.168.137.1", "10.0.0.5", "172.16.42.2", "169.254.1.1", "100.64.0.1", "::1", "fe80::1"} {
		if publicIP(net.ParseIP(ip)) {
			t.Errorf("%s isn't public", ip)
		}
	}
	for _, ip := range []string{"1.1.1.1", "142.250.80.46", "2606:4700::1111"} {
		if !publicIP(net.ParseIP(ip)) {
			t.Errorf("%s is public", ip)
		}
	}
}

func TestRefuseSandboxed(t *testing.T) {
	h := refuseSandboxed(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) { w.WriteHeader(204) }))
	for _, c := range []struct {
		path, origin string
		code         int
	}{
		{"/player/next", "null", 403},
		{"/settings", "null", 403},
		{"/addons/fetch", "null", 403},
		{"/addons/files/clock/index.html", "null", 204},
		{"/addons/sdk.js", "null", 204},
		{"/player/next", "http://localhost", 204},
		{"/player/next", "", 204},
	} {
		r := httptest.NewRequest("POST", c.path, nil)
		if c.origin != "" {
			r.Header.Set("Origin", c.origin)
		}
		w := httptest.NewRecorder()
		h.ServeHTTP(w, r)
		if w.Code != c.code {
			t.Errorf("%s from %q: %d, want %d", c.path, c.origin, w.Code, c.code)
		}
	}
}

func TestAddonFilesCarryThePolicy(t *testing.T) {
	s := newAddonStore(t.TempDir(), func() string { return "x/y" }, quietLog{})
	m := AddonManifest{ID: "clock", Name: "Clock"}
	if _, err := s.installZip("clock", addonZip(t, map[string]string{"addon.json": manifestJSON(m), "index.html": "<p>hi</p>"})); err != nil {
		t.Fatal(err)
	}
	srv := &ConcreteApiServer{}
	mux := http.NewServeMux()
	srv.registerAddonRoutes(mux, func() *addonStore { return s })
	for path, want := range map[string]int{
		"/addons/files/clock/index.html":   200,
		"/addons/files/clock/addon.json":   200,
		"/addons/files/clock/../other/x":   404,
		"/addons/files/nope/index.html":    404,
		"/addons/files/clock/missing.html": 404,
	} {
		w := httptest.NewRecorder()
		mux.ServeHTTP(w, httptest.NewRequest("GET", path, nil))
		if want == 404 && w.Code != 200 {
			continue // refused, one way or another
		}
		if w.Code != want {
			t.Errorf("%s: %d, want %d", path, w.Code, want)
		}
		if want == 200 && !strings.Contains(w.Header().Get("Content-Security-Policy"), "connect-src 'none'") {
			t.Errorf("%s served without the add-on policy", path)
		}
	}
	w := httptest.NewRecorder()
	mux.ServeHTTP(w, httptest.NewRequest("GET", "/addons/sdk.js", nil))
	if w.Code != 200 || !strings.Contains(w.Body.String(), "window.Wisp") {
		t.Errorf("sdk: %d", w.Code)
	}
}

func TestAddonCatalogImageChecksTheChecksum(t *testing.T) {
	pic := []byte("\x89PNG picture")
	sum := sha256.Sum256(pic)
	for _, c := range []struct {
		sha string
		ok  bool
	}{{hex.EncodeToString(sum[:]), true}, {strings.Repeat("0", 64), false}} {
		m := AddonManifest{ID: "clock", Name: "Big clock", Version: "1", Image: "preview.png"}
		srv := httptest.NewTLSServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			if strings.HasSuffix(r.URL.Path, "catalog.json") {
				_ = json.NewEncoder(w).Encode(map[string]any{"addons": []AddonCatalogEntry{{
					AddonManifest: m, Zip: "dist/clock-1.zip", SHA256: strings.Repeat("a", 64),
					ImageURL: "dist/clock-1.png", ImageSHA256: c.sha,
				}}})
				return
			}
			_, _ = w.Write(pic)
		}))
		s := newAddonStore(t.TempDir(), func() string { return "x/y" }, quietLog{})
		s.client = srv.Client()
		s.catalogFrom = srv.URL + "/addons/catalog.json"
		b, ctype, err := s.CatalogImage(t.Context(), "clock")
		if c.ok && (err != nil || string(b) != string(pic) || ctype != "image/png") {
			t.Errorf("good picture: %v %q", err, ctype)
		}
		if !c.ok && err == nil {
			t.Error("a picture that doesn't match its checksum should be refused")
		}
		if _, _, err := s.CatalogImage(t.Context(), "nope"); err == nil {
			t.Error("an add-on not in the catalog has no picture")
		}
		srv.Close()
	}
}
