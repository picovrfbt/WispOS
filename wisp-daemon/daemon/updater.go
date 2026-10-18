package daemon

import (
	"archive/tar"
	"compress/gzip"
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net"
	"net/http"
	"os"
	"os/exec"
	"path"
	"path/filepath"
	"strings"
	"sync"
	"sync/atomic"
	"time"

	librespot "github.com/devgianlu/go-librespot"
)

// Over-the-air updates of the app layer (this daemon and the UI) from the
// GitHub releases of Wisp's public repo (or a fork's).
//
// The read-only system partition keeps the version that was flashed. An update
// unpacks into the writable data partition:
//
//	/var/local/wisp/app/<tag>/{go-librespot, ui/, version.txt}
//	/var/local/wisp/app/current -> <tag>
//
// and the go-librespot and wisp-ui services run from `current` when it is
// there and sound. Three ways back: the service script gives up on a daemon
// that keeps crashing, an update the UI never confirms (POST /update/confirm)
// within updateConfirmWindow is dropped, and a flash of something at least as
// new as the update wins over it. A dropped update goes back to the update
// before it when that one was confirmed and is still sound (`previous`), else
// to the flashed copy, and the UI is told once (`rolled-back.json`).

const (
	ApiEventTypeUpdate ApiEventType = "update/state"

	// often enough that a new release's card shows up the same drive
	updateCheckEvery    = time.Hour
	updateAutoEvery     = 10 * time.Minute
	updateConfirmWindow = 3 * time.Minute
	updateMaxBundle     = 200 << 20
	updateAppDir        = "/var/local/wisp/app"
)

// the version the firmware was flashed as
var updateBuiltinVer = sysPath("/etc/wisp/version.txt", "/etc/mira/version.txt")

type UpdateConfig struct {
	Enabled bool
	// owner/name of the GitHub repo whose releases carry wisp-app-<tag>.tar.gz
	Repo string
	// a token for a private repo, in a file; the companion app can also hand one over
	TokenFile string
}

// UpdateState is /update/status and the update/state event
type UpdateState struct {
	Current string `json:"current"`
	Latest  string `json:"latest,omitempty"`
	// Latest is newer than Current and has a bundle to install
	Available  bool     `json:"available"`
	Highlights []string `json:"highlights,omitempty"`
	// idle | checking | downloading | installing | restarting | error
	Phase   string `json:"phase"`
	Percent int    `json:"percent,omitempty"`
	Error   string `json:"error,omitempty"`
	// what the install is doing right now, in words, for the updating screen
	Step string `json:"step,omitempty"`
	// the download: bytes so far, of how many, and how fast (bytes a second)
	BytesDone  int64 `json:"bytes_done,omitempty"`
	BytesTotal int64 `json:"bytes_total,omitempty"`
	SpeedBps   int64 `json:"speed_bps,omitempty"`
	// the install has the Car Thing to itself: the UI shows only the updating
	// screen and the daemon holds its own background syncing, so the download
	// gets all the Bluetooth bandwidth (Settings → Update in the background off)
	Focus bool `json:"focus,omitempty"`
	// the release being installed
	Installing string `json:"installing,omitempty"`
	// how it's coming while it downloads: "phone" (through the companion app) or "direct"
	Via string `json:"via,omitempty"`
	// the companion app is there to download through (the screen's "through your phone" button)
	CanRelay bool `json:"can_relay,omitempty"`
	// a token is known (needed for a private repo)
	HasToken  bool  `json:"has_token"`
	CheckedAt int64 `json:"checked_at,omitempty"`
	// an update didn't come up and was undone; the UI says so once, then
	// POST /update/rolled-back clears it
	RolledBack *RollBack `json:"rolled_back,omitempty"`
}

// RollBack is an update that didn't come up and what took its place
type RollBack struct {
	From string `json:"from"`
	// the update gone back to, or "" for the version installed over USB
	To  string `json:"to"`
	Why string `json:"why"`
	At  int64  `json:"at"`
}

type ghAsset struct {
	Name   string `json:"name"`
	URL    string `json:"url"`
	Size   int64  `json:"size"`
	Digest string `json:"digest"`
}

type ghRelease struct {
	TagName string    `json:"tag_name"`
	Body    string    `json:"body"`
	Draft   bool      `json:"draft"`
	Assets  []ghAsset `json:"assets"`
}

type updater struct {
	cfg  UpdateConfig
	log  librespot.Logger
	emit func(*ApiEvent)
	// mirrors latest/highlights into the persisted status fields the UI's update card reads
	publish func(latest string, highlights []string)
	client  *http.Client
	apiBase string
	appDir  string
	// the running version (appVersion; tests swap it)
	version func() string
	// says whether a found update may install itself now: the setting is on
	// and nothing is playing or navigating. nil never does
	autoOK func() bool
	// whether an install takes the Car Thing over (true) or runs in the background
	focusMode func() bool
	// brings the services back up on the new version (restartServices; tests swap it,
	// since on any Linux it ends the process)
	restart func()
	// the companion app, which can download an update for the Car Thing (update_relay.go)
	relay phoneRelay
	// how long a broken download waits before it resumes (tests shorten it)
	resumeWait time.Duration
	// "download directly" was asked for: no more going through the phone this run
	direct atomic.Bool
	// cancels the download under way, when the route is switched
	legCancel context.CancelFunc

	mu         sync.Mutex
	phoneRepo  string
	phoneToken string
	release    *ghRelease
	state      UpdateState
	confirmed  chan struct{}
	confirmOne sync.Once
	// the release auto-install already went for this run, so a failure isn't retried every tick
	autoTried string
}

func newUpdater(cfg UpdateConfig, log librespot.Logger, emit func(*ApiEvent), publish func(string, []string)) *updater {
	u := &updater{
		cfg:        cfg,
		log:        log,
		emit:       emit,
		publish:    publish,
		client:     &http.Client{Timeout: 10 * time.Minute},
		apiBase:    "https://api.github.com",
		appDir:     updateAppDir,
		version:    appVersion,
		confirmed:  make(chan struct{}),
		resumeWait: 2 * time.Second,
	}
	u.restart = u.restartServices
	u.state = UpdateState{Current: u.version(), Phase: "idle"}
	return u
}

// appVersion is the version running now: an installed update's, or the flashed one
func appVersion() string {
	if exe, err := os.Executable(); err == nil {
		if b, err := os.ReadFile(filepath.Join(filepath.Dir(exe), "version.txt")); err == nil {
			if v := strings.TrimSpace(string(b)); v != "" {
				return v
			}
		}
	}
	return firmwareVersion()
}

func builtinVersion() string {
	b, err := os.ReadFile(updateBuiltinVer)
	if err != nil {
		return ""
	}
	return strings.TrimSpace(string(b))
}

// SetPhoneAuth takes the repo/token the companion app holds for the user
func (u *updater) SetPhoneAuth(repo, token string) {
	u.mu.Lock()
	changed := u.phoneToken != token || u.phoneRepo != repo
	u.phoneRepo, u.phoneToken = strings.TrimSpace(repo), strings.TrimSpace(token)
	u.mu.Unlock()
	if changed {
		// read before setState: its callback runs under u.mu, and token()
		// takes u.mu too (calling it inside deadlocked the updater and the
		// phone link that delivered the token)
		hasToken := u.token() != ""
		u.setState(func(s *UpdateState) { s.HasToken = hasToken })
		go u.Check(context.Background())
	}
}

// oldPrivateRepo is where Wisp lived before it went public; older companion
// apps still name it, and Wisp now follows its default repo instead
const oldPrivateRepo = "picovrfbt/Wisp"

func (u *updater) repo() string {
	u.mu.Lock()
	defer u.mu.Unlock()
	if u.phoneRepo != "" && !strings.EqualFold(u.phoneRepo, oldPrivateRepo) {
		return u.phoneRepo
	}
	return u.cfg.Repo
}

func (u *updater) token() string {
	u.mu.Lock()
	t := u.phoneToken
	u.mu.Unlock()
	if t != "" {
		return t
	}
	if u.cfg.TokenFile != "" {
		if b, err := os.ReadFile(u.cfg.TokenFile); err == nil {
			return strings.TrimSpace(string(b))
		}
	}
	return ""
}

func (u *updater) Status() UpdateState {
	u.mu.Lock()
	defer u.mu.Unlock()
	s := u.state
	s.HasToken = u.phoneToken != "" || (u.cfg.TokenFile != "" && fileExists(u.cfg.TokenFile))
	// the phone link has its own lock, never taken with u.mu held the other way round
	s.CanRelay = u.canRelay()
	s.RolledBack = u.rolledBack()
	return s
}

func (u *updater) rolledBack() *RollBack {
	b, err := os.ReadFile(filepath.Join(u.appDir, "rolled-back.json"))
	if err != nil {
		return nil
	}
	var r RollBack
	if json.Unmarshal(b, &r) != nil || r.From == "" {
		return nil
	}
	return &r
}

// ClearRolledBack is the UI having told the user
func (u *updater) ClearRolledBack() {
	_ = os.Remove(filepath.Join(u.appDir, "rolled-back.json"))
}

// setState runs fn under u.mu: fn must not call anything that locks u.mu
func (u *updater) setState(fn func(*UpdateState)) {
	relay := u.canRelay()
	u.mu.Lock()
	fn(&u.state)
	s := u.state
	u.mu.Unlock()
	s.CanRelay = relay
	if u.emit != nil {
		u.emit(&ApiEvent{Type: ApiEventTypeUpdate, Data: s})
	}
}

// run checks now and then every updateCheckEvery
func (u *updater) run(ctx context.Context) {
	// give the network a moment after boot
	select {
	case <-ctx.Done():
		return
	case <-time.After(45 * time.Second):
	}
	nextCheck := time.Now()
	for {
		if !time.Now().Before(nextCheck) {
			u.Check(ctx)
			nextCheck = time.Now().Add(updateCheckEvery)
		}
		// a found update waits for a quiet moment, checked far more often than GitHub is
		u.maybeAutoInstall()
		select {
		case <-ctx.Done():
			return
		case <-time.After(updateAutoEvery):
		}
	}
}

// installs a found update on its own when the setting allows and the Car Thing
// is idle; once per release per run, and never one that already failed here
func (u *updater) maybeAutoInstall() {
	if u.autoOK == nil || u.busy() {
		return
	}
	u.mu.Lock()
	rel, available, tried := u.release, u.state.Available, u.autoTried
	u.mu.Unlock()
	if rel == nil || !available || rel.TagName == tried || !validTag(rel.TagName) {
		return
	}
	if fileExists(filepath.Join(u.appDir, rel.TagName, ".bad")) {
		return
	}
	if !u.autoOK() {
		return
	}
	u.mu.Lock()
	u.autoTried = rel.TagName
	u.mu.Unlock()
	u.log.Infof("update: installing %s automatically", rel.TagName)
	if err := u.Install(); err != nil {
		u.log.Infof("update: automatic install skipped: %v", err)
	}
}

func (u *updater) busy() bool {
	u.mu.Lock()
	defer u.mu.Unlock()
	switch u.state.Phase {
	case "checking", "downloading", "installing", "restarting":
		return true
	}
	return false
}

// Check asks GitHub for the latest release
func (u *updater) Check(ctx context.Context) {
	if u.busy() {
		return
	}
	repo := u.repo()
	if repo == "" {
		return
	}
	u.setState(func(s *UpdateState) { s.Phase, s.Error = "checking", "" })
	rel, err := u.latestRelease(ctx, repo)
	if err != nil {
		u.log.Infof("update: check failed: %v", err)
		u.setState(func(s *UpdateState) { s.Phase, s.Error = "error", updateErrText(err) })
		return
	}
	cur := u.version()
	available := versionLess(normalizeVersion(cur), normalizeVersion(rel.TagName)) && (coreAsset(rel) != nil || bundleAsset(rel) != nil)
	highlights := releaseHighlights(rel.Body)
	u.mu.Lock()
	u.release = rel
	u.mu.Unlock()
	u.setState(func(s *UpdateState) {
		s.Phase, s.Error, s.Percent = "idle", "", 0
		s.Current, s.Latest, s.Available, s.Highlights = cur, rel.TagName, available, highlights
		s.CheckedAt = time.Now().UnixMilli()
	})
	if u.publish != nil {
		if available {
			u.publish(rel.TagName, highlights)
		} else {
			u.publish("", nil)
		}
	}
	u.log.Infof("update: running %s, latest release %s (available=%v)", cur, rel.TagName, available)
}

func (u *updater) latestRelease(ctx context.Context, repo string) (*ghRelease, error) {
	req, err := http.NewRequestWithContext(ctx, "GET", fmt.Sprintf("%s/repos/%s/releases/latest", u.apiBase, repo), nil)
	if err != nil {
		return nil, err
	}
	u.authorize(req, "application/vnd.github+json")
	resp, err := u.client.Do(req)
	if err != nil {
		return nil, err
	}
	defer func() { _ = resp.Body.Close() }()
	switch resp.StatusCode {
	case http.StatusOK:
	case http.StatusNotFound:
		return nil, errors.New("no release found")
	case http.StatusUnauthorized:
		return nil, errors.New("the GitHub token was refused")
	default:
		return nil, fmt.Errorf("github: %s", resp.Status)
	}
	var rel ghRelease
	if err := json.NewDecoder(io.LimitReader(resp.Body, 4<<20)).Decode(&rel); err != nil {
		return nil, err
	}
	if rel.TagName == "" {
		return nil, errors.New("release has no tag")
	}
	return &rel, nil
}

func (u *updater) authorize(req *http.Request, accept string) {
	req.Header.Set("Accept", accept)
	req.Header.Set("X-GitHub-Api-Version", "2022-11-28")
	req.Header.Set("User-Agent", "wisp-updater")
	if t := u.token(); t != "" {
		req.Header.Set("Authorization", "Bearer "+t)
	}
}

func bundleAsset(rel *ghRelease) *ghAsset {
	want := "wisp-app-" + rel.TagName + bundleArch + ".tar.gz"
	for i := range rel.Assets {
		if rel.Assets[i].Name == want {
			return &rel.Assets[i]
		}
	}
	return nil
}

func checksumAsset(rel *ghRelease, bundle string) *ghAsset {
	for i := range rel.Assets {
		if rel.Assets[i].Name == bundle+".sha256" {
			return &rel.Assets[i]
		}
	}
	return nil
}

// "- line" / "* line" bullets of the release notes, for the update card
func releaseHighlights(body string) []string {
	var out []string
	for _, l := range strings.Split(body, "\n") {
		l = strings.TrimSpace(l)
		if strings.HasPrefix(l, "- ") || strings.HasPrefix(l, "* ") {
			out = append(out, clipRunes(strings.TrimSpace(l[2:]), 120))
			if len(out) == 5 {
				break
			}
		}
	}
	return out
}

var ErrNoUpdate = errors.New("no update to install")

// updateErrText: what an update failure says on screen. The log keeps the full error;
// the screen gets what it means and what to do.
func updateErrText(err error) string {
	var nerr net.Error
	msg := err.Error()
	switch {
	case errors.As(err, &nerr), errors.Is(err, context.DeadlineExceeded),
		strings.Contains(msg, "no such host"), strings.Contains(msg, "connection refused"),
		strings.Contains(msg, "connection reset"), strings.Contains(msg, "unexpected EOF"):
		return "Couldn't reach the internet. Check the phone's connection and try again"
	case strings.Contains(msg, "checksum"), strings.Contains(msg, "verification"):
		return "The download was damaged. Try again"
	case strings.HasPrefix(msg, "not enough space"):
		return "Not enough room on the Car Thing for the update"
	case strings.HasPrefix(msg, "github: 403"), strings.HasPrefix(msg, "github: 429"):
		return "GitHub is busy right now. Try again in a bit"
	case strings.HasPrefix(msg, "bundle"), strings.HasPrefix(msg, "release"), strings.HasPrefix(msg, "bad release"):
		return "This update is broken. Wait for the next one"
	}
	return msg
}

// Install downloads, verifies and unpacks the latest bundle, switches to it and
// restarts into it. It returns once the work is under way.
func (u *updater) Install() error {
	u.mu.Lock()
	rel := u.release
	available := u.state.Available
	u.mu.Unlock()
	if u.busy() {
		return errors.New("an update is already in progress")
	}
	if rel == nil || !available {
		return ErrNoUpdate
	}
	go func() {
		if err := u.install(context.Background(), rel); err != nil {
			u.log.Warnf("update: install of %s failed: %v", rel.TagName, err)
			u.setState(func(s *UpdateState) { s.Phase, s.Error, s.Percent = "error", updateErrText(err), 0 })
		}
	}()
	return nil
}

func (u *updater) install(ctx context.Context, rel *ghRelease) error {
	// the split release when there is one: the core, and fonts only if needed
	if core := coreAsset(rel); core != nil {
		if free := diskFreeMB(u.appDir); free > 0 && int64(free)<<20 < (core.Size+30<<20)*2 {
			return fmt.Errorf("not enough space (%d MB free)", free)
		}
		return u.installCore(ctx, rel, core, u.focusMode == nil || u.focusMode())
	}
	asset := bundleAsset(rel)
	if asset == nil {
		return errors.New("release has no app bundle")
	}
	if asset.Size > updateMaxBundle {
		return errors.New("bundle too large")
	}
	if free := diskFreeMB(u.appDir); free > 0 && int64(free)<<20 < asset.Size*4 {
		return fmt.Errorf("not enough space (%d MB free)", free)
	}
	want, err := u.expectedDigest(ctx, rel, asset)
	if err != nil {
		return err
	}
	if err := os.MkdirAll(u.appDir, 0o755); err != nil {
		return err
	}
	focus := u.focusMode == nil || u.focusMode()
	u.setState(func(s *UpdateState) {
		s.Phase, s.Error, s.Percent = "downloading", "", 0
		s.Step, s.Focus, s.Installing = "Downloading", focus, rel.TagName
		s.BytesDone, s.BytesTotal, s.SpeedBps = 0, asset.Size, 0
	})
	dl := filepath.Join(u.appDir, ".download")
	defer func() { _ = os.Remove(dl) }()
	got, err := u.download(ctx, asset, dl)
	if err != nil {
		return err
	}
	u.setState(func(s *UpdateState) {
		s.Phase, s.Percent, s.Step, s.SpeedBps = "installing", 100, "Checking the download", 0
	})
	if !strings.EqualFold(got, want) {
		return errors.New("download failed verification (checksum mismatch)")
	}

	u.setState(func(s *UpdateState) { s.Step = "Unpacking" })
	tag := rel.TagName
	if err := u.unpack(dl, tag); err != nil {
		return err
	}
	u.setState(func(s *UpdateState) { s.Step = "Switching to " + tag })
	if err := u.activate(tag); err != nil {
		return err
	}
	u.log.Infof("update: installed %s, restarting into it", tag)
	u.setState(func(s *UpdateState) { s.Phase, s.Step = "restarting", "Restarting" })
	u.restart()
	return nil
}

// the bundle's sha256: GitHub's own asset digest, else a <bundle>.sha256 asset
func (u *updater) expectedDigest(ctx context.Context, rel *ghRelease, asset *ghAsset) (string, error) {
	if d, ok := strings.CutPrefix(asset.Digest, "sha256:"); ok && len(d) == 64 {
		return d, nil
	}
	sum := checksumAsset(rel, asset.Name)
	if sum == nil {
		return "", errors.New("release has no checksum for the bundle")
	}
	req, err := http.NewRequestWithContext(ctx, "GET", sum.URL, nil)
	if err != nil {
		return "", err
	}
	u.authorize(req, "application/octet-stream")
	resp, err := u.client.Do(req)
	if err != nil {
		return "", err
	}
	defer func() { _ = resp.Body.Close() }()
	if resp.StatusCode != http.StatusOK {
		return "", fmt.Errorf("checksum download: %s", resp.Status)
	}
	b, _ := io.ReadAll(io.LimitReader(resp.Body, 1024))
	fields := strings.Fields(string(b))
	if len(fields) == 0 || len(fields[0]) != 64 {
		return "", errors.New("unreadable checksum file")
	}
	return fields[0], nil
}

// unpack extracts the bundle into <appDir>/<tag>, refusing anything that isn't
// a plain file or directory inside it, and checks it has what the services need
func (u *updater) unpack(bundle, tag string) error {
	if !validTag(tag) {
		return fmt.Errorf("bad release tag %q", tag)
	}
	final := filepath.Join(u.appDir, tag)
	tmp := final + ".new"
	_ = os.RemoveAll(tmp)
	if err := os.MkdirAll(tmp, 0o755); err != nil {
		return err
	}
	ok := false
	defer func() {
		if !ok {
			_ = os.RemoveAll(tmp)
		}
	}()

	f, err := os.Open(bundle)
	if err != nil {
		return err
	}
	defer func() { _ = f.Close() }()
	gz, err := gzip.NewReader(f)
	if err != nil {
		return err
	}
	tr := tar.NewReader(gz)
	var written int64
	for {
		hdr, err := tr.Next()
		if err == io.EOF {
			break
		}
		if err != nil {
			return err
		}
		name := path.Clean(strings.TrimPrefix(hdr.Name, "./"))
		if name == "." {
			continue
		}
		if path.IsAbs(name) || name == ".." || strings.HasPrefix(name, "../") {
			return fmt.Errorf("bundle entry outside the bundle: %q", hdr.Name)
		}
		dst := filepath.Join(tmp, filepath.FromSlash(name))
		switch hdr.Typeflag {
		case tar.TypeDir:
			if err := os.MkdirAll(dst, 0o755); err != nil {
				return err
			}
		case tar.TypeReg:
			if err := os.MkdirAll(filepath.Dir(dst), 0o755); err != nil {
				return err
			}
			mode := os.FileMode(0o644)
			if hdr.Mode&0o111 != 0 {
				mode = 0o755
			}
			out, err := os.OpenFile(dst, os.O_CREATE|os.O_WRONLY|os.O_TRUNC, mode)
			if err != nil {
				return err
			}
			n, err := io.Copy(out, io.LimitReader(tr, updateMaxBundle*3-written))
			_ = out.Close()
			if err != nil {
				return err
			}
			written += n
			if written >= updateMaxBundle*3 {
				return errors.New("bundle unpacks too large")
			}
		default:
			return fmt.Errorf("bundle entry of unsupported type: %q", hdr.Name)
		}
	}

	for _, need := range []string{"go-librespot", "ui/index.html", "version.txt"} {
		if !fileExists(filepath.Join(tmp, need)) {
			return fmt.Errorf("bundle is missing %s", need)
		}
	}
	v, _ := os.ReadFile(filepath.Join(tmp, "version.txt"))
	if strings.TrimSpace(string(v)) != tag {
		return fmt.Errorf("bundle says it is %q, release is %s", strings.TrimSpace(string(v)), tag)
	}
	if err := os.Chmod(filepath.Join(tmp, "go-librespot"), 0o755); err != nil {
		return err
	}
	_ = os.RemoveAll(final)
	if err := os.Rename(tmp, final); err != nil {
		return err
	}
	ok = true
	return nil
}

// activate points current at tag (atomically), marks it unconfirmed, and keeps
// only it and the version it replaces, noting that one as where to go back to
// if this one doesn't come up (only when it was confirmed and is sound)
func (u *updater) activate(tag string) error {
	cur := filepath.Join(u.appDir, "current")
	prev, _ := os.Readlink(cur)
	pending, _ := os.ReadFile(filepath.Join(u.appDir, "pending"))
	if prev != "" && prev != tag && strings.TrimSpace(string(pending)) != prev && u.sound(prev) {
		_ = os.WriteFile(filepath.Join(u.appDir, "previous"), []byte(prev+"\n"), 0o644)
	} else if prev != tag {
		_ = os.Remove(filepath.Join(u.appDir, "previous"))
	}
	link := cur + ".new"
	_ = os.Remove(link)
	if err := os.Symlink(tag, link); err != nil {
		return err
	}
	if err := os.Rename(link, cur); err != nil {
		return err
	}
	if err := os.WriteFile(filepath.Join(u.appDir, "pending"), []byte(tag+"\n"), 0o644); err != nil {
		return err
	}
	entries, _ := os.ReadDir(u.appDir)
	for _, e := range entries {
		n := e.Name()
		if !e.IsDir() || n == tag || n == prev {
			continue
		}
		_ = os.RemoveAll(filepath.Join(u.appDir, n))
	}
	syncFS()
	return nil
}

// sound is an unpacked update that's whole and not marked bad
func (u *updater) sound(tag string) bool {
	d := filepath.Join(u.appDir, tag)
	return validTag(tag) && fileExists(filepath.Join(d, "go-librespot")) &&
		fileExists(filepath.Join(d, "ui", "index.html")) && fileExists(filepath.Join(d, "version.txt")) &&
		!fileExists(filepath.Join(d, ".bad"))
}

// fallBack drops the active update: back to the update before it when that
// one is still sound and newer than the flash, else to the flashed copy. The
// UI hears of it once (rolled-back.json)
func (u *updater) fallBack(why string) {
	cur := filepath.Join(u.appDir, "current")
	from, err := os.Readlink(cur)
	if err == nil {
		_ = os.WriteFile(filepath.Join(u.appDir, from, ".bad"), []byte(why+"\n"), 0o644)
	}
	to := ""
	if b, err := os.ReadFile(filepath.Join(u.appDir, "previous")); err == nil {
		prev := strings.TrimSpace(string(b))
		builtin := builtinVersion()
		if prev != from && u.sound(prev) &&
			(builtin == "" || versionLess(normalizeVersion(builtin), normalizeVersion(prev))) {
			to = prev
		}
	}
	if to != "" {
		link := cur + ".new"
		_ = os.Remove(link)
		if os.Symlink(to, link) == nil && os.Rename(link, cur) == nil {
			u.log.Infof("update: going back to %s", to)
		} else {
			to = ""
		}
	}
	if to == "" {
		_ = os.Remove(cur)
	}
	_ = os.Remove(filepath.Join(u.appDir, "pending"))
	_ = os.Remove(filepath.Join(u.appDir, "previous"))
	// a newer flash winning isn't something that went wrong
	if from != "" && !strings.HasPrefix(why, "superseded") {
		note, _ := json.Marshal(RollBack{From: from, To: to, Why: why, At: time.Now().UnixMilli()})
		_ = os.WriteFile(filepath.Join(u.appDir, "rolled-back.json"), note, 0o644)
	}
	syncFS()
}

// Confirm is the UI saying it came up fine on this version
func (u *updater) Confirm() {
	u.confirmOne.Do(func() { close(u.confirmed) })
}

// Focused is true while an install has the Car Thing to itself; background
// work (the voice catalog sync) waits for it
func (u *updater) Focused() bool {
	u.mu.Lock()
	defer u.mu.Unlock()
	switch u.state.Phase {
	case "downloading", "installing", "restarting":
		return u.state.Focus
	}
	return false
}

// startupChecks runs once at boot: a flash at least as new as the update wins,
// and an unconfirmed update gets updateConfirmWindow to prove itself
func (u *updater) startupChecks(ctx context.Context) {
	cur := filepath.Join(u.appDir, "current")
	tag, err := os.Readlink(cur)
	if err != nil {
		return
	}
	if b := builtinVersion(); b != "" && !versionLess(normalizeVersion(b), normalizeVersion(tag)) {
		u.log.Infof("update: flashed %s is at least as new as update %s, using the flashed one", b, tag)
		u.fallBack("superseded by flash " + b)
		u.restart()
		return
	}
	pending, err := os.ReadFile(filepath.Join(u.appDir, "pending"))
	if err != nil || strings.TrimSpace(string(pending)) != tag || u.version() != tag {
		return
	}
	u.log.Infof("update: %s waiting for the UI to confirm it", tag)
	go func() {
		select {
		case <-ctx.Done():
		case <-u.confirmed:
			_ = os.Remove(filepath.Join(u.appDir, "pending"))
			syncFS()
			u.log.Infof("update: %s confirmed", tag)
		case <-time.After(updateConfirmWindow):
			u.log.Warnf("update: %s never confirmed by the UI, going back", tag)
			u.fallBack("not confirmed by the UI")
			u.restart()
		}
	}()
}

// restartServices brings the UI and this daemon back up on whatever current now is
func (u *updater) restartServices() {
	if !onDevice {
		u.log.Info("update: not on the device, skipping the service restart")
		return
	}
	_ = exec.Command("sv", "restart", "wisp-ui").Run()
	_ = exec.Command("sv", "restart", "chromium").Run()
	// runit starts the daemon again from the new current
	go func() {
		time.Sleep(time.Second)
		os.Exit(0)
	}()
}

func validTag(t string) bool {
	if t == "" || len(t) > 40 {
		return false
	}
	for _, r := range t {
		if !(r >= '0' && r <= '9' || r >= 'a' && r <= 'z' || r >= 'A' && r <= 'Z' || r == '.' || r == '-' || r == '_') {
			return false
		}
	}
	return !strings.HasPrefix(t, ".")
}

func fileExists(p string) bool {
	_, err := os.Stat(p)
	return err == nil
}

func syncFS() {
	if onDevice {
		_ = exec.Command("sync").Run()
	}
}

// UpdateHandler backs /update/*
type UpdateHandler interface {
	Status() UpdateState
	Check(ctx context.Context)
	Install() error
	Confirm()
	Direct()
	Relay()
	// the UI has told the user an update was undone
	ClearRolledBack()
}

func (s *ConcreteApiServer) registerUpdateRoutes(m *http.ServeMux) {
	handler := func() UpdateHandler {
		s.updateMu.RLock()
		defer s.updateMu.RUnlock()
		return s.updateFn
	}
	m.HandleFunc("GET /update/status", func(w http.ResponseWriter, r *http.Request) {
		h := handler()
		if h == nil {
			w.WriteHeader(http.StatusServiceUnavailable)
			return
		}
		w.Header().Set("Content-Type", "application/json")
		_ = json.NewEncoder(w).Encode(h.Status())
	})
	m.HandleFunc("POST /update/check", func(w http.ResponseWriter, r *http.Request) {
		h := handler()
		if h == nil {
			w.WriteHeader(http.StatusServiceUnavailable)
			return
		}
		ctx, cancel := context.WithTimeout(r.Context(), 30*time.Second)
		defer cancel()
		h.Check(ctx)
		w.Header().Set("Content-Type", "application/json")
		_ = json.NewEncoder(w).Encode(h.Status())
	})
	// 202 once under way; 409 with nothing to install or one already running
	m.HandleFunc("POST /update/install", func(w http.ResponseWriter, r *http.Request) {
		h := handler()
		if h == nil {
			w.WriteHeader(http.StatusServiceUnavailable)
			return
		}
		if err := h.Install(); err != nil {
			w.WriteHeader(http.StatusConflict)
			return
		}
		w.WriteHeader(http.StatusAccepted)
	})
	m.HandleFunc("POST /update/direct", func(w http.ResponseWriter, r *http.Request) {
		if h := handler(); h != nil {
			h.Direct()
		}
		w.WriteHeader(http.StatusNoContent)
	})
	m.HandleFunc("POST /update/relay", func(w http.ResponseWriter, r *http.Request) {
		if h := handler(); h != nil {
			h.Relay()
		}
		w.WriteHeader(http.StatusNoContent)
	})
	m.HandleFunc("POST /update/confirm", func(w http.ResponseWriter, r *http.Request) {
		if h := handler(); h != nil {
			h.Confirm()
		}
		w.WriteHeader(http.StatusNoContent)
	})
	m.HandleFunc("POST /update/rolled-back", func(w http.ResponseWriter, r *http.Request) {
		if h := handler(); h != nil {
			h.ClearRolledBack()
		}
		w.WriteHeader(http.StatusNoContent)
	})
}

func (s *ConcreteApiServer) SetUpdateHandler(h UpdateHandler) {
	s.updateMu.Lock()
	s.updateFn = h
	s.updateMu.Unlock()
}

func (s *StubApiServer) SetUpdateHandler(_ UpdateHandler) {}
