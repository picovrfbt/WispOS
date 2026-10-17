package daemon

import (
	"archive/zip"
	"bytes"
	"context"
	"crypto/sha256"
	"embed"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net"
	"net/http"
	"net/url"
	"os"
	"path"
	"path/filepath"
	"regexp"
	"sort"
	"strings"
	"sync"
	"time"
)

// Community add-ons: small web pages that open full-screen from Home (a
// forecast, a big clock, trip gauges). Each one is a folder with addon.json
// and index.html, installed from a reviewed catalog in Wisp's repo
// (addons/catalog.json): the catalog lists each add-on's zip and its
// checksum, so nothing installs that hasn't been through a pull request.
//
// An add-on runs in a sandboxed frame with no access to Wisp itself: its
// pages are served with a policy that forbids any network request, and the
// API refuses requests from inside a sandbox (Origin "null"). What it may
// know (what's playing, the weather, roughly where you are, directions) and
// which sites it may reach come from its manifest, through a small bridge the
// Car Thing's screen runs (wisp-ui/src/components/Addons). It only exists
// while it's open, so installed add-ons cost no memory.

const (
	addonMaxZip      = 2 << 20
	addonMaxUnpacked = 4 << 20
	addonMaxFiles    = 64
	addonFetchMax    = 256 << 10
	addonFetchTime   = 8 * time.Second
	addonCatalogTTL  = 10 * time.Minute
)

var addonIDPattern = regexp.MustCompile(`^[a-z0-9][a-z0-9-]{1,39}$`)
var addonPathPattern = regexp.MustCompile(`^[A-Za-z0-9._-]+(?:/[A-Za-z0-9._-]+)*$`)

// what an add-on may be told; anything else in a manifest is refused
var addonPermissions = map[string]bool{"now_playing": true, "weather": true, "location": true, "nav": true}

// AddonManifest is addon.json
type AddonManifest struct {
	ID          string `json:"id"`
	Name        string `json:"name"`
	Version     string `json:"version"`
	Author      string `json:"author"`
	Description string `json:"description"`
	// the page that opens, inside the folder (index.html when empty)
	Entry string `json:"entry,omitempty"`
	// what it may ask the Car Thing for
	Permissions []string `json:"permissions,omitempty"`
	// the sites it may fetch from, through Wisp ("api.open-meteo.com")
	Network []string `json:"network,omitempty"`
}

func (m *AddonManifest) validate() error {
	if !addonIDPattern.MatchString(m.ID) {
		return fmt.Errorf("add-on id %q isn't lowercase letters, digits and dashes", m.ID)
	}
	if strings.TrimSpace(m.Name) == "" || len(m.Name) > 40 {
		return errors.New("add-on needs a name of 40 characters or fewer")
	}
	if len(m.Description) > 200 || len(m.Author) > 60 || len(m.Version) > 20 {
		return errors.New("add-on description, author or version is too long")
	}
	if m.Entry == "" {
		m.Entry = "index.html"
	}
	if !addonPathPattern.MatchString(m.Entry) || strings.Contains(m.Entry, "..") {
		return fmt.Errorf("add-on entry %q isn't a plain path", m.Entry)
	}
	for _, p := range m.Permissions {
		if !addonPermissions[p] {
			return fmt.Errorf("add-on asks for %q, which Wisp doesn't offer", p)
		}
	}
	if len(m.Network) > 8 {
		return errors.New("add-on lists too many sites")
	}
	for _, h := range m.Network {
		if !validAddonHost(h) {
			return fmt.Errorf("add-on site %q isn't a public host name", h)
		}
	}
	return nil
}

// a public DNS name: no addresses, no localhost, no ports
func validAddonHost(h string) bool {
	if h == "" || len(h) > 100 || strings.ContainsAny(h, ":/@ ") || net.ParseIP(h) != nil {
		return false
	}
	if h == "localhost" || strings.HasSuffix(h, ".local") || strings.HasSuffix(h, ".localhost") || !strings.Contains(h, ".") {
		return false
	}
	return regexp.MustCompile(`^[a-z0-9.-]+$`).MatchString(h)
}

// AddonCatalogEntry is one add-on the catalog offers
type AddonCatalogEntry struct {
	AddonManifest
	// the zip, relative to the catalog or a full https URL, and its checksum
	Zip    string `json:"zip"`
	SHA256 string `json:"sha256"`
	Size   int64  `json:"size"`
}

type addonStore struct {
	dir  string
	repo func() string
	log  interface {
		Infof(string, ...any)
		Warnf(string, ...any)
	}
	client *http.Client

	// another catalog than Wisp's repo's (a local one, to try add-ons out)
	catalogFrom string

	mu        sync.Mutex
	catalog   []AddonCatalogEntry
	catalogAt time.Time
	busy      map[string]bool
}

// addonsDir: on the data partition on a Car Thing, beside the config elsewhere
func addonsDir() string {
	if onDevice || wispOS {
		return "/var/local/wisp/addons"
	}
	d, err := os.UserConfigDir()
	if err != nil {
		d = os.TempDir()
	}
	return filepath.Join(d, "wisp", "addons")
}

func newAddonStore(dir string, repo func() string, log interface {
	Infof(string, ...any)
	Warnf(string, ...any)
}) *addonStore {
	return &addonStore{dir: dir, repo: repo, log: log, client: &http.Client{Timeout: 30 * time.Second}, busy: map[string]bool{}}
}

func (s *addonStore) catalogURL() string {
	if s.catalogFrom != "" {
		return s.catalogFrom
	}
	return "https://raw.githubusercontent.com/" + s.repo() + "/main/addons/catalog.json"
}

// Installed lists the add-ons on the Car Thing, by name
func (s *addonStore) Installed() []AddonManifest {
	entries, err := os.ReadDir(s.dir)
	if err != nil {
		return []AddonManifest{}
	}
	out := []AddonManifest{}
	for _, e := range entries {
		if !e.IsDir() || !addonIDPattern.MatchString(e.Name()) {
			continue
		}
		m, err := readAddonManifest(filepath.Join(s.dir, e.Name()))
		if err != nil || m.ID != e.Name() {
			continue
		}
		out = append(out, *m)
	}
	sort.Slice(out, func(i, j int) bool { return strings.ToLower(out[i].Name) < strings.ToLower(out[j].Name) })
	return out
}

func readAddonManifest(dir string) (*AddonManifest, error) {
	b, err := os.ReadFile(filepath.Join(dir, "addon.json"))
	if err != nil {
		return nil, err
	}
	var m AddonManifest
	if err := json.Unmarshal(b, &m); err != nil {
		return nil, err
	}
	return &m, m.validate()
}

func (s *addonStore) manifest(id string) (*AddonManifest, error) {
	if !addonIDPattern.MatchString(id) {
		return nil, errors.New("no such add-on")
	}
	return readAddonManifest(filepath.Join(s.dir, id))
}

// Catalog is what can be installed, fetched now and then from Wisp's repo
func (s *addonStore) Catalog(ctx context.Context) ([]AddonCatalogEntry, error) {
	s.mu.Lock()
	if s.catalog != nil && time.Since(s.catalogAt) < addonCatalogTTL {
		c := s.catalog
		s.mu.Unlock()
		return c, nil
	}
	s.mu.Unlock()
	body, err := s.get(ctx, s.catalogURL(), 256<<10)
	if err != nil {
		return nil, err
	}
	var doc struct {
		Addons []AddonCatalogEntry `json:"addons"`
	}
	if err := json.Unmarshal(body, &doc); err != nil {
		return nil, fmt.Errorf("the add-on catalog isn't readable: %w", err)
	}
	out := doc.Addons[:0]
	for _, e := range doc.Addons {
		if e.validate() == nil && len(e.SHA256) == 64 {
			out = append(out, e)
		}
	}
	s.mu.Lock()
	s.catalog, s.catalogAt = out, time.Now()
	s.mu.Unlock()
	return out, nil
}

func (s *addonStore) get(ctx context.Context, u string, max int64) ([]byte, error) {
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, u, nil)
	if err != nil {
		return nil, err
	}
	resp, err := s.client.Do(req)
	if err != nil {
		return nil, err
	}
	defer func() { _ = resp.Body.Close() }()
	if resp.StatusCode != http.StatusOK {
		return nil, fmt.Errorf("%s answered %s", req.URL.Host, resp.Status)
	}
	b, err := io.ReadAll(io.LimitReader(resp.Body, max+1))
	if err != nil {
		return nil, err
	}
	if int64(len(b)) > max {
		return nil, errors.New("too large")
	}
	return b, nil
}

// Install downloads an add-on from the catalog, checks it and puts it in place
func (s *addonStore) Install(ctx context.Context, id string) (*AddonManifest, error) {
	cat, err := s.Catalog(ctx)
	if err != nil {
		return nil, err
	}
	var entry *AddonCatalogEntry
	for i := range cat {
		if cat[i].ID == id {
			entry = &cat[i]
		}
	}
	if entry == nil {
		return nil, errors.New("that add-on isn't in the catalog")
	}
	s.mu.Lock()
	if s.busy[id] {
		s.mu.Unlock()
		return nil, errors.New("already installing")
	}
	s.busy[id] = true
	s.mu.Unlock()
	defer func() { s.mu.Lock(); delete(s.busy, id); s.mu.Unlock() }()

	zipURL, err := resolveAddonZip(s.catalogURL(), entry.Zip)
	if err != nil {
		return nil, err
	}
	data, err := s.get(ctx, zipURL, addonMaxZip)
	if err != nil {
		return nil, err
	}
	sum := sha256.Sum256(data)
	if !strings.EqualFold(hex.EncodeToString(sum[:]), entry.SHA256) {
		return nil, errors.New("the add-on didn't match its checksum")
	}
	return s.installZip(id, data)
}

// resolveAddonZip: a catalog's zip path, relative to the catalog or https
func resolveAddonZip(catalog, zipRef string) (string, error) {
	base, err := url.Parse(catalog)
	if err != nil {
		return "", err
	}
	ref, err := url.Parse(zipRef)
	if err != nil {
		return "", err
	}
	u := base.ResolveReference(ref)
	if u.Scheme != "https" {
		return "", errors.New("add-ons only download over https")
	}
	return u.String(), nil
}

// installZip unpacks into a new folder and swaps it in, so a failed install
// leaves the old version untouched
func (s *addonStore) installZip(id string, data []byte) (*AddonManifest, error) {
	zr, err := zip.NewReader(bytes.NewReader(data), int64(len(data)))
	if err != nil {
		return nil, fmt.Errorf("the add-on isn't a zip: %w", err)
	}
	if len(zr.File) > addonMaxFiles {
		return nil, errors.New("the add-on has too many files")
	}
	if err := os.MkdirAll(s.dir, 0o755); err != nil {
		return nil, err
	}
	tmp, err := os.MkdirTemp(s.dir, ".install-")
	if err != nil {
		return nil, err
	}
	defer func() { _ = os.RemoveAll(tmp) }()
	var total int64
	for _, f := range zr.File {
		name := strings.TrimPrefix(f.Name, "./")
		if f.FileInfo().IsDir() {
			continue
		}
		if !addonPathPattern.MatchString(name) || strings.Contains(name, "..") {
			return nil, fmt.Errorf("the add-on has an odd file name %q", f.Name)
		}
		if f.FileInfo().Mode()&os.ModeSymlink != 0 {
			return nil, errors.New("the add-on has a link in it")
		}
		total += int64(f.UncompressedSize64)
		if total > addonMaxUnpacked {
			return nil, errors.New("the add-on is too large unpacked")
		}
		dst := filepath.Join(tmp, filepath.FromSlash(name))
		if err := os.MkdirAll(filepath.Dir(dst), 0o755); err != nil {
			return nil, err
		}
		rc, err := f.Open()
		if err != nil {
			return nil, err
		}
		out, err := os.OpenFile(dst, os.O_CREATE|os.O_WRONLY|os.O_TRUNC, 0o644)
		if err != nil {
			_ = rc.Close()
			return nil, err
		}
		_, err = io.Copy(out, io.LimitReader(rc, addonMaxUnpacked))
		_ = rc.Close()
		_ = out.Close()
		if err != nil {
			return nil, err
		}
	}
	m, err := readAddonManifest(tmp)
	if err != nil {
		return nil, fmt.Errorf("the add-on's addon.json: %w", err)
	}
	if m.ID != id {
		return nil, errors.New("the add-on's id doesn't match the catalog")
	}
	if !fileExists(filepath.Join(tmp, filepath.FromSlash(m.Entry))) {
		return nil, errors.New("the add-on's page is missing")
	}
	final := filepath.Join(s.dir, id)
	old := final + ".old"
	_ = os.RemoveAll(old)
	if fileExists(final) {
		if err := os.Rename(final, old); err != nil {
			return nil, err
		}
	}
	if err := os.Rename(tmp, final); err != nil {
		_ = os.Rename(old, final)
		return nil, err
	}
	_ = os.RemoveAll(old)
	s.log.Infof("add-ons: installed %s %s", m.ID, m.Version)
	return m, nil
}

func (s *addonStore) Remove(id string) error {
	if !addonIDPattern.MatchString(id) {
		return errors.New("no such add-on")
	}
	s.log.Infof("add-ons: removed %s", id)
	return os.RemoveAll(filepath.Join(s.dir, id))
}

// Fetch gets a page for an add-on from one of the sites its manifest lists
func (s *addonStore) Fetch(ctx context.Context, id, raw string) (int, string, []byte, error) {
	m, err := s.manifest(id)
	if err != nil {
		return 0, "", nil, err
	}
	u, err := url.Parse(raw)
	if err != nil || u.Scheme != "https" || u.User != nil || u.Port() != "" {
		return 0, "", nil, errors.New("add-ons may only fetch https pages")
	}
	allowed := false
	for _, h := range m.Network {
		if strings.EqualFold(u.Hostname(), h) {
			allowed = true
		}
	}
	if !allowed {
		return 0, "", nil, fmt.Errorf("%s isn't one of this add-on's sites", u.Hostname())
	}
	ctx, cancel := context.WithTimeout(ctx, addonFetchTime)
	defer cancel()
	req, _ := http.NewRequestWithContext(ctx, http.MethodGet, u.String(), nil)
	req.Header.Set("User-Agent", "Wisp-addon/"+id)
	// no redirects to somewhere it didn't list, and never to an address on the
	// Car Thing, the phone or the home network, whatever the name says
	client := &http.Client{Transport: publicOnlyTransport(), CheckRedirect: func(r *http.Request, _ []*http.Request) error {
		if !strings.EqualFold(r.URL.Hostname(), u.Hostname()) || r.URL.Scheme != "https" {
			return errors.New("redirected off the add-on's site")
		}
		return nil
	}}
	resp, err := client.Do(req)
	if err != nil {
		return 0, "", nil, err
	}
	defer func() { _ = resp.Body.Close() }()
	b, err := io.ReadAll(io.LimitReader(resp.Body, addonFetchMax+1))
	if err != nil {
		return 0, "", nil, err
	}
	if len(b) > addonFetchMax {
		return 0, "", nil, errors.New("the page is too large for an add-on")
	}
	return resp.StatusCode, resp.Header.Get("Content-Type"), b, nil
}

// publicOnlyTransport dials only public addresses
func publicOnlyTransport() *http.Transport {
	d := &net.Dialer{Timeout: 5 * time.Second}
	return &http.Transport{
		Proxy: nil,
		DialContext: func(ctx context.Context, network, addr string) (net.Conn, error) {
			host, port, err := net.SplitHostPort(addr)
			if err != nil {
				return nil, err
			}
			ips, err := net.DefaultResolver.LookupIPAddr(ctx, host)
			if err != nil {
				return nil, err
			}
			for _, ip := range ips {
				if publicIP(ip.IP) {
					return d.DialContext(ctx, network, net.JoinHostPort(ip.IP.String(), port))
				}
			}
			return nil, fmt.Errorf("%s isn't on the public internet", host)
		},
		TLSHandshakeTimeout: 5 * time.Second,
	}
}

func publicIP(ip net.IP) bool {
	return !(ip.IsLoopback() || ip.IsPrivate() || ip.IsLinkLocalUnicast() || ip.IsLinkLocalMulticast() ||
		ip.IsUnspecified() || ip.IsMulticast() || ip.IsInterfaceLocalMulticast() ||
		// carrier-grade NAT, which phones' tethering uses
		(ip.To4() != nil && ip.To4()[0] == 100 && ip.To4()[1]&0xc0 == 64))
}

// ---------------------------------------------------------------- serving

//go:embed addon_sdk.js
var addonSDK embed.FS

// addonPolicy: an add-on page may run its own scripts and styles and show its
// own images, and nothing else: no requests anywhere, no forms, no frames
// ('self' as well as the address: behind a proxy the daemon sees another host)
func addonPolicy(base string) string {
	own := "'self' " + base
	return "default-src 'none'; script-src 'unsafe-inline' " + own + "; style-src 'unsafe-inline' " + own +
		"; img-src data: blob: " + own + "; font-src data: " + own + "; media-src data: " + own +
		"; connect-src 'none'; form-action 'none'; frame-src 'none'; base-uri 'none'"
}

func (s *ConcreteApiServer) registerAddonRoutes(m *http.ServeMux, store func() *addonStore) {
	writeJSON := func(w http.ResponseWriter, v any) {
		w.Header().Set("Content-Type", "application/json")
		_ = json.NewEncoder(w).Encode(v)
	}
	fail := func(w http.ResponseWriter, code int, err error) {
		w.Header().Set("Content-Type", "application/json")
		w.WriteHeader(code)
		_ = json.NewEncoder(w).Encode(map[string]string{"error": err.Error()})
	}
	m.HandleFunc("GET /addons", func(w http.ResponseWriter, r *http.Request) {
		writeJSON(w, map[string]any{"addons": store().Installed()})
	})
	m.HandleFunc("GET /addons/catalog", func(w http.ResponseWriter, r *http.Request) {
		c, err := store().Catalog(r.Context())
		if err != nil {
			fail(w, http.StatusBadGateway, err)
			return
		}
		writeJSON(w, map[string]any{"addons": c})
	})
	m.HandleFunc("POST /addons/install", func(w http.ResponseWriter, r *http.Request) {
		var body struct {
			ID string `json:"id"`
		}
		if json.NewDecoder(io.LimitReader(r.Body, 4096)).Decode(&body) != nil {
			fail(w, http.StatusBadRequest, errors.New("which add-on?"))
			return
		}
		mf, err := store().Install(r.Context(), body.ID)
		if err != nil {
			fail(w, http.StatusBadGateway, err)
			return
		}
		s.Emit(&ApiEvent{Type: ApiEventTypeAddonsChanged})
		writeJSON(w, mf)
	})
	m.HandleFunc("POST /addons/remove", func(w http.ResponseWriter, r *http.Request) {
		var body struct {
			ID string `json:"id"`
		}
		if json.NewDecoder(io.LimitReader(r.Body, 4096)).Decode(&body) != nil {
			fail(w, http.StatusBadRequest, errors.New("which add-on?"))
			return
		}
		if err := store().Remove(body.ID); err != nil {
			fail(w, http.StatusBadRequest, err)
			return
		}
		s.Emit(&ApiEvent{Type: ApiEventTypeAddonsChanged})
		w.WriteHeader(http.StatusNoContent)
	})
	// the screen asks on an add-on's behalf, after checking what it may do
	m.HandleFunc("POST /addons/fetch", func(w http.ResponseWriter, r *http.Request) {
		var body struct {
			ID  string `json:"id"`
			URL string `json:"url"`
		}
		if json.NewDecoder(io.LimitReader(r.Body, 8192)).Decode(&body) != nil {
			fail(w, http.StatusBadRequest, errors.New("bad request"))
			return
		}
		code, ctype, b, err := store().Fetch(r.Context(), body.ID, body.URL)
		if err != nil {
			fail(w, http.StatusForbidden, err)
			return
		}
		writeJSON(w, map[string]any{"status": code, "content_type": ctype, "body": string(b)})
	})
	m.HandleFunc("GET /addons/sdk.js", func(w http.ResponseWriter, r *http.Request) {
		b, _ := addonSDK.ReadFile("addon_sdk.js")
		w.Header().Set("Content-Type", "text/javascript; charset=utf-8")
		w.Header().Set("Cache-Control", "no-cache")
		_, _ = w.Write(b)
	})
	m.HandleFunc("GET /addons/files/{id}/{path...}", func(w http.ResponseWriter, r *http.Request) {
		id, p := r.PathValue("id"), r.PathValue("path")
		if !addonIDPattern.MatchString(id) || !addonPathPattern.MatchString(p) || strings.Contains(p, "..") {
			http.NotFound(w, r)
			return
		}
		f, err := os.Open(filepath.Join(store().dir, id, filepath.FromSlash(p)))
		if err != nil {
			http.NotFound(w, r)
			return
		}
		defer func() { _ = f.Close() }()
		st, err := f.Stat()
		if err != nil || st.IsDir() {
			http.NotFound(w, r)
			return
		}
		base := "http://" + r.Host + "/addons/"
		w.Header().Set("Content-Security-Policy", addonPolicy(base))
		w.Header().Set("X-Content-Type-Options", "nosniff")
		w.Header().Set("Referrer-Policy", "no-referrer")
		w.Header().Set("Cache-Control", "no-cache")
		if ct := addonContentType(p); ct != "" {
			w.Header().Set("Content-Type", ct)
		}
		// ServeContent, not ServeFile: that one sends index.html off to its folder
		http.ServeContent(w, r, p, st.ModTime(), f)
	})
}

func addonContentType(p string) string {
	switch strings.ToLower(path.Ext(p)) {
	case ".html", ".htm":
		return "text/html; charset=utf-8"
	case ".js", ".mjs":
		return "text/javascript; charset=utf-8"
	case ".css":
		return "text/css; charset=utf-8"
	case ".json":
		return "application/json"
	case ".svg":
		return "image/svg+xml"
	case ".png":
		return "image/png"
	case ".jpg", ".jpeg":
		return "image/jpeg"
	case ".webp":
		return "image/webp"
	case ".woff2":
		return "font/woff2"
	}
	return ""
}

// ApiEventTypeAddonsChanged: one was installed or removed
const ApiEventTypeAddonsChanged ApiEventType = "addons/changed"

// refuseSandboxed turns away API calls from inside a sandboxed frame (an
// add-on): only its own files and the SDK are for it
func refuseSandboxed(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.Header.Get("Origin") == "null" && !strings.HasPrefix(r.URL.Path, "/addons/files/") && r.URL.Path != "/addons/sdk.js" {
			http.Error(w, "not from an add-on", http.StatusForbidden)
			return
		}
		next.ServeHTTP(w, r)
	})
}
