package daemon

import (
	"encoding/json"
	"io/fs"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"strings"
	"testing"

	librespot "github.com/devgianlu/go-librespot"
)

// TestAddonPreview serves add-ons for the Car Thing's screen running on a PC
// (wisp-ui's `npm run dev`), to try them out without a Car Thing:
//
//	WISP_ADDON_PREVIEW=../../addons go test -run TestAddonPreview -timeout 0 ./daemon
//
// Every add-on folder there is installed except those named in
// WISP_ADDON_PREVIEW_SKIP (comma separated), which stay in the catalog to
// install; the catalog is that folder's catalog.json. A sample location,
// directions and weather stand in for the phone.
func TestAddonPreview(t *testing.T) {
	src := os.Getenv("WISP_ADDON_PREVIEW")
	if src == "" {
		t.Skip("set WISP_ADDON_PREVIEW to an add-ons folder")
	}
	skip := map[string]bool{}
	for _, id := range strings.Split(os.Getenv("WISP_ADDON_PREVIEW_SKIP"), ",") {
		skip[id] = true
	}
	store := newAddonStore(t.TempDir(), func() string { return "" }, quietLog{})
	entries, _ := os.ReadDir(src)
	for _, e := range entries {
		if !e.IsDir() || skip[e.Name()] || !fileExists(filepath.Join(src, e.Name(), "addon.json")) {
			continue
		}
		from := filepath.Join(src, e.Name())
		_ = filepath.WalkDir(from, func(p string, d fs.DirEntry, err error) error {
			if err != nil || d.IsDir() {
				return err
			}
			rel, _ := filepath.Rel(from, p)
			dst := filepath.Join(store.dir, e.Name(), rel)
			_ = os.MkdirAll(filepath.Dir(dst), 0o755)
			b, _ := os.ReadFile(p)
			return os.WriteFile(dst, b, 0o644)
		})
	}
	catalog := httptest.NewTLSServer(http.FileServer(http.Dir(src)))
	defer catalog.Close()
	store.client = catalog.Client()
	store.catalogFrom = catalog.URL + "/catalog.json"

	srv := &ConcreteApiServer{log: &librespot.NullLogger{}}
	mux := http.NewServeMux()
	srv.registerAddonRoutes(mux, func() *addonStore { return store })
	js := func(v any) http.HandlerFunc {
		return func(w http.ResponseWriter, r *http.Request) {
			w.Header().Set("Content-Type", "application/json")
			_ = json.NewEncoder(w).Encode(v)
		}
	}
	mux.HandleFunc("GET /observer/status", js(map[string]any{"active": false, "devices": []any{}, "utc_offset_min": -420}))
	mux.HandleFunc("GET /nav/status", js(map[string]any{
		"connected": true, "active": true, "title": "600 ft", "text": "Turn left onto Pine Ave",
		"sub_text": "12 min · 5.1 mi · 3:45 PM", "updated_at": 0,
		"location": map[string]any{"lat": 33.7701, "lng": -118.1937, "speed": 15.6, "bearing": 0, "accuracy": 5},
	}))
	mux.HandleFunc("GET /weather", js(map[string]any{"temp": 68, "unit": "F", "code": 1, "summary": "Mostly clear", "is_day": true}))
	t.Logf("add-ons on http://127.0.0.1:3678 (installed: %d)", len(store.Installed()))
	if err := http.ListenAndServe("127.0.0.1:3678", refuseSandboxed(mux)); err != nil {
		t.Fatal(err)
	}
}
