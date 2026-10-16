package daemon

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"strconv"
	"strings"
	"sync"
	"testing"
	"time"

	"github.com/coder/websocket"
	librespot "github.com/devgianlu/go-librespot"
)

// serves body, cutting the first answer off halfway, and honours "bytes=N-"
func flakyFileServer(t *testing.T, body []byte) (*httptest.Server, *[]string) {
	t.Helper()
	var mu sync.Mutex
	var ranges []string
	first := true
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		mu.Lock()
		ranges = append(ranges, r.Header.Get("Range"))
		cut := first
		first = false
		mu.Unlock()
		from := 0
		if rg := r.Header.Get("Range"); rg != "" {
			n, err := strconv.Atoi(strings.TrimSuffix(strings.TrimPrefix(rg, "bytes="), "-"))
			if err != nil || n >= len(body) {
				w.WriteHeader(http.StatusRequestedRangeNotSatisfiable)
				return
			}
			from = n
		}
		if cut {
			// promise the whole file, send half, hang up
			conn, buf, _ := w.(http.Hijacker).Hijack()
			_, _ = fmt.Fprintf(buf, "HTTP/1.1 200 OK\r\nContent-Length: %d\r\n\r\n", len(body))
			_, _ = buf.Write(body[:len(body)/2])
			_ = buf.Flush()
			_ = conn.Close()
			return
		}
		w.Header().Set("Content-Length", strconv.Itoa(len(body)-from))
		if from > 0 {
			w.Header().Set("Content-Range", fmt.Sprintf("bytes %d-%d/%d", from, len(body)-1, len(body)))
			w.WriteHeader(http.StatusPartialContent)
		}
		_, _ = w.Write(body[from:])
	}))
	t.Cleanup(srv.Close)
	return srv, &ranges
}

func quickUpdater(t *testing.T) *updater {
	u := newUpdater(UpdateConfig{Enabled: true, Repo: "me/Wisp"}, &librespot.NullLogger{}, (&navEvents{}).emit, nil)
	u.appDir = t.TempDir()
	u.restart = func() {}
	u.resumeWait = time.Millisecond
	return u
}

func TestDownloadResumesAfterADrop(t *testing.T) {
	body := bytes.Repeat([]byte("wisp-update-"), 40_000)
	srv, ranges := flakyFileServer(t, body)
	u := quickUpdater(t)
	dst := filepath.Join(u.appDir, "dl")
	got, err := u.downloadFrom(context.Background(), srv.URL+"/asset", false, int64(len(body)), dst)
	if err != nil {
		t.Fatal(err)
	}
	if got != sha(body) {
		t.Fatal("a resumed download must hash the same as the whole file")
	}
	if b, _ := os.ReadFile(dst); !bytes.Equal(b, body) {
		t.Fatal("the resumed file differs")
	}
	if len(*ranges) != 2 || (*ranges)[0] != "" || !strings.HasPrefix((*ranges)[1], "bytes=") || (*ranges)[1] == "bytes=0-" {
		t.Fatalf("the second request should carry on from where the first stopped, got %q", *ranges)
	}
}

func TestDownloadGivesUpOnARefusal(t *testing.T) {
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(http.StatusNotFound)
	}))
	defer srv.Close()
	u := quickUpdater(t)
	if _, err := u.downloadFrom(context.Background(), srv.URL, false, 10, filepath.Join(u.appDir, "dl")); err == nil {
		t.Fatal("a 404 is final")
	}
}

// a fake companion app: says it can relay, then fetches by "downloading" and
// pointing at a file server on the same host
func fakeRelayPhone(t *testing.T, fileURL string, fail bool) (*navRelay, *[]map[string]any) {
	t.Helper()
	var mu sync.Mutex
	var asked []map[string]any
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		c, err := websocket.Accept(w, r, nil)
		if err != nil {
			return
		}
		defer func() { _ = c.CloseNow() }()
		_ = c.Write(r.Context(), websocket.MessageText, []byte(`{"type":"caps","update_relay":true}`))
		for {
			_, data, err := c.Read(r.Context())
			if err != nil {
				return
			}
			var m map[string]any
			_ = json.Unmarshal(data, &m)
			if m["type"] != "update_fetch" {
				continue
			}
			mu.Lock()
			asked = append(asked, m)
			mu.Unlock()
			req := int(m["req"].(float64))
			_ = c.Write(r.Context(), websocket.MessageText, []byte(fmt.Sprintf(
				`{"type":"update_fetch_progress","req":%d,"done":5,"total":10,"speed":100}`, req)))
			if fail {
				_ = c.Write(r.Context(), websocket.MessageText, []byte(fmt.Sprintf(
					`{"type":"update_fetch_error","req":%d,"error":"GitHub answered 403"}`, req)))
				continue
			}
			port := strings.TrimPrefix(fileURL[strings.LastIndex(fileURL, ":"):], ":")
			_ = c.Write(r.Context(), websocket.MessageText, []byte(fmt.Sprintf(
				`{"type":"update_fetch_ready","req":%d,"port":%s,"path":"/update/k/wisp-core.tar.gz"}`, req, port)))
		}
	}))
	t.Cleanup(srv.Close)
	n := newNavRelay(NavConfig{Enabled: true, PhoneURL: "ws" + strings.TrimPrefix(srv.URL, "http") + "/nav"},
		&librespot.NullLogger{}, (&navEvents{}).emit, func() string { return "" })
	ctx, cancel := context.WithCancel(context.Background())
	t.Cleanup(cancel)
	go n.run(ctx)
	deadline := time.Now().Add(3 * time.Second)
	for time.Now().Before(deadline) && !n.RelayAvailable() {
		time.Sleep(10 * time.Millisecond)
	}
	if !n.RelayAvailable() {
		t.Fatal("the phone said it can relay")
	}
	return n, &asked
}

func TestUpdateComesThroughThePhone(t *testing.T) {
	body := bytes.Repeat([]byte("core"), 50_000)
	var phoneServed, githubServed int
	files := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path == "/update/k/wisp-core.tar.gz" {
			phoneServed++
			_, _ = w.Write(body)
			return
		}
		githubServed++
		_, _ = w.Write(body)
	}))
	defer files.Close()
	n, asked := fakeRelayPhone(t, files.URL, false)
	u := quickUpdater(t)
	u.relay = n
	asset := &ghAsset{Name: "wisp-core-v9.tar.gz", URL: "https://api.github.com/repos/me/Wisp/releases/assets/7",
		Size: int64(len(body)), Digest: "sha256:" + sha(body)}
	got, err := u.download(context.Background(), asset, filepath.Join(u.appDir, "dl"))
	if err != nil {
		t.Fatal(err)
	}
	if got != sha(body) || phoneServed != 1 || githubServed != 0 {
		t.Fatalf("should come from the phone alone: sum ok=%v phone=%d github=%d", got == sha(body), phoneServed, githubServed)
	}
	if len(*asked) != 1 || (*asked)[0]["url"] != asset.URL || (*asked)[0]["sha256"] != sha(body) {
		t.Fatalf("the phone should be asked for the asset and its checksum, got %v", *asked)
	}
	if s := u.Status().Step; !strings.Contains(s, "from your phone") {
		t.Fatalf("the step should say it's copying from the phone, got %q", s)
	}
}

func TestUpdateFallsBackWhenThePhoneCant(t *testing.T) {
	body := bytes.Repeat([]byte("core"), 1000)
	var githubServed int
	files := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		githubServed++
		_, _ = w.Write(body)
	}))
	defer files.Close()
	n, _ := fakeRelayPhone(t, files.URL, true)
	u := quickUpdater(t)
	u.relay = n
	asset := &ghAsset{Name: "wisp-core-v9.tar.gz", URL: files.URL + "/asset/7", Size: int64(len(body)), Digest: "sha256:" + sha(body)}
	got, err := u.download(context.Background(), asset, filepath.Join(u.appDir, "dl"))
	if err != nil || got != sha(body) || githubServed != 1 {
		t.Fatalf("should download directly after the phone fails: err=%v github=%d", err, githubServed)
	}
}

func TestRelayURLStaysOnThePhone(t *testing.T) {
	if u, err := relayURL("192.168.44.1", 3680, "/update/abc/wisp-core-v1.tar.gz"); err != nil || u != "http://192.168.44.1:3680/update/abc/wisp-core-v1.tar.gz" {
		t.Fatalf("got %q %v", u, err)
	}
	for _, p := range []string{"/etc/passwd", "/update/../x", ""} {
		if _, err := relayURL("192.168.44.1", 3680, p); err == nil {
			t.Fatalf("%q must be refused", p)
		}
	}
	if _, err := relayURL("", 3680, "/update/a/b"); err == nil {
		t.Fatal("no host, no relay")
	}
}

// "download on the Car Thing instead" mid-way: the route and the words change,
// and "through your phone instead" goes back
func TestSwitchingTheDownloadRoute(t *testing.T) {
	body := bytes.Repeat([]byte("core"), 50_000)
	release := make(chan struct{})
	var githubServed int
	files := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path == "/update/k/wisp-core.tar.gz" {
			// the phone's copy hangs until the switch cuts it off
			select {
			case <-release:
			case <-r.Context().Done():
			}
			return
		}
		githubServed++
		_, _ = w.Write(body)
	}))
	defer files.Close()
	defer close(release)
	n, _ := fakeRelayPhone(t, files.URL, false)
	u := quickUpdater(t)
	u.relay = n
	asset := &ghAsset{Name: "wisp-core-v9.tar.gz", URL: files.URL + "/asset/7", Size: int64(len(body)), Digest: "sha256:" + sha(body)}
	u.setState(func(s *UpdateState) { s.Step = "Downloading" })

	done := make(chan error, 1)
	go func() {
		_, err := u.download(context.Background(), asset, filepath.Join(u.appDir, "dl"))
		done <- err
	}()
	deadline := time.Now().Add(3 * time.Second)
	for time.Now().Before(deadline) && u.Status().Step != "Copying from your phone" {
		time.Sleep(10 * time.Millisecond)
	}
	if st := u.Status(); st.Via != "phone" || !st.CanRelay {
		t.Fatalf("should be copying from the phone first, got %+v", st)
	}
	u.Direct()
	if err := <-done; err != nil {
		t.Fatal(err)
	}
	st := u.Status()
	if githubServed != 1 || st.Via != "direct" || st.Step != "Downloading" {
		t.Fatalf("after the switch it comes from GitHub, with words to say so: github=%d %+v", githubServed, st)
	}
	u.Relay()
	if u.direct.Load() {
		t.Fatal("\"through your phone instead\" goes back")
	}
}
