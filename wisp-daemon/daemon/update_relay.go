package daemon

import (
	"context"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"hash"
	"io"
	"net"
	"net/http"
	"net/url"
	"os"
	"strings"
	"time"

	"github.com/coder/websocket"
)

// Getting an update onto the Car Thing.
//
// The Car Thing's own internet is the phone's tether, and on mobile data
// carriers often slow tethered traffic, route it apart, or drop it when the
// phone changes cell: a long download from GitHub then times out. So when the
// companion app can, it downloads the file as the phone's own traffic and
// serves it over the tether, which no carrier touches; the Car Thing still
// checks the checksum itself. Without the app (or if it fails) the Car Thing
// downloads from GitHub as before. Either way a broken download picks up where
// it stopped instead of starting over.

// phoneRelay is the companion app's side (navRelay)
type phoneRelay interface {
	RelayAvailable() bool
	// has the phone download an asset; the answer is where to fetch it on the tether
	RelayFetch(ctx context.Context, name, assetURL string, size int64, sha string,
		progress func(done, total, speed int64)) (string, error)
}

const (
	// a phone that says nothing for this long (no progress) has given up
	relayQuietLimit = 60 * time.Second
	// a download stops resuming after this many tries that got nowhere
	downloadAttempts = 6
)

// download gets an asset to dst and returns its sha256: through the phone when
// it can, else from GitHub
func (u *updater) download(ctx context.Context, asset *ghAsset, dst string) (string, error) {
	// "Downloading" or "Downloading fonts": the part after it names what's downloading
	what := strings.TrimPrefix(u.Status().Step, "Downloading")
	want, hasSum := strings.CutPrefix(asset.Digest, "sha256:")
	hasSum = hasSum && len(want) == 64
	// the phone gets one go per file; after a failure (not a switch) the Car Thing carries on
	phoneFailed := false
	for {
		viaPhone := hasSum && !phoneFailed && !u.direct.Load() && u.relay != nil && u.relay.RelayAvailable()
		// either route can be switched to the other from the update screen: this leg's
		// context is what the switch cancels
		lctx, cancel := context.WithCancel(ctx)
		u.mu.Lock()
		u.legCancel = cancel
		u.mu.Unlock()
		var got string
		var err error
		if viaPhone {
			got, err = u.downloadViaPhone(lctx, asset, want, dst, what)
		} else {
			u.setState(func(s *UpdateState) {
				s.Step, s.Via = "Downloading"+what, "direct"
				s.Percent, s.BytesDone, s.BytesTotal, s.SpeedBps = 0, 0, asset.Size, 0
			})
			got, err = u.downloadFrom(lctx, asset.URL, true, asset.Size, dst)
		}
		switched := lctx.Err() != nil && ctx.Err() == nil
		u.mu.Lock()
		u.legCancel = nil
		u.mu.Unlock()
		cancel()
		switch {
		case err == nil:
			return got, nil
		case ctx.Err() != nil:
			return "", err
		case switched:
			// the other route was asked for: round again, which picks it
			u.log.Infof("update: switching %s to %s", asset.Name, map[bool]string{true: "the Car Thing", false: "the phone"}[u.direct.Load()])
		case viaPhone:
			u.log.Infof("update: the phone couldn't fetch %s (%v), downloading it here", asset.Name, err)
			phoneFailed = true
		default:
			return "", err
		}
	}
}

func (u *updater) downloadViaPhone(ctx context.Context, asset *ghAsset, want, dst, what string) (string, error) {
	u.setState(func(s *UpdateState) {
		s.Step, s.Via = "Your phone is downloading"+what, "phone"
		s.Percent, s.BytesDone, s.BytesTotal, s.SpeedBps = 0, 0, asset.Size, 0
	})
	src, err := u.relay.RelayFetch(ctx, asset.Name, asset.URL, asset.Size, want, func(done, total, speed int64) {
		pct := 0
		if total > 0 {
			pct = int(done * 100 / total)
		}
		u.setState(func(s *UpdateState) { s.Percent, s.BytesDone, s.SpeedBps = pct, done, speed })
	})
	if err != nil {
		return "", err
	}
	u.setState(func(s *UpdateState) {
		s.Step = "Copying" + what + " from your phone"
		s.Percent, s.BytesDone, s.SpeedBps = 0, 0, 0
	})
	return u.downloadFrom(ctx, src, false, asset.Size, dst)
}

// Direct is the update screen's "download on the Car Thing instead": the rest of
// this install comes from GitHub, not through the phone
func (u *updater) Direct() { u.switchTo(true) }

// Relay is its way back: "download through your phone instead"
func (u *updater) Relay() { u.switchTo(false) }

func (u *updater) switchTo(direct bool) {
	if u.direct.Swap(direct) == direct {
		return
	}
	u.mu.Lock()
	cancel := u.legCancel
	u.mu.Unlock()
	if cancel != nil {
		cancel()
	}
}

// canRelay: the phone is there to download through, for the update screen's button
func (u *updater) canRelay() bool {
	return u.relay != nil && u.relay.RelayAvailable()
}

// downloadFrom fetches src into dst, resuming with a Range request after a
// dropped connection, and returns the whole file's sha256. auth sends the
// GitHub token (an asset URL); the phone's own server needs none
func (u *updater) downloadFrom(ctx context.Context, src string, auth bool, total int64, dst string) (string, error) {
	f, err := os.Create(dst)
	if err != nil {
		return "", err
	}
	defer func() { _ = f.Close() }()
	h := sha256.New()
	var done int64
	p := &dlProgress{u: u, total: total, lastAt: time.Now()}

	fails := 0
	for {
		got, err := u.downloadOnce(ctx, src, auth, f, h, done, p)
		if err == nil {
			done = got
			break
		}
		if ctx.Err() != nil || errors.Is(err, errDownloadFatal) {
			return "", err
		}
		// a try that moved forward starts the count again
		if got > done {
			fails = 0
		} else {
			fails++
		}
		done = got
		if fails >= downloadAttempts {
			return "", err
		}
		u.log.Infof("update: download broke at %d of %d bytes (%v), resuming", done, total, err)
		select {
		case <-ctx.Done():
			return "", ctx.Err()
		case <-time.After(u.resumeWait * time.Duration(1<<min(fails, 4))):
		}
	}
	if total > 0 && done != total {
		return "", fmt.Errorf("download incomplete (%d of %d bytes)", done, total)
	}
	if err := f.Sync(); err != nil {
		return "", err
	}
	return hex.EncodeToString(h.Sum(nil)), nil
}

var errDownloadFatal = errors.New("download refused")

// one connection's worth, carrying on from [from] bytes; returns how far it got
func (u *updater) downloadOnce(ctx context.Context, src string, auth bool, f *os.File, h hash.Hash, from int64, p *dlProgress) (int64, error) {
	req, err := http.NewRequestWithContext(ctx, "GET", src, nil)
	if err != nil {
		return from, fmt.Errorf("%w: %v", errDownloadFatal, err)
	}
	if auth {
		// the asset API URL redirects to storage; Go drops the token on that hop
		u.authorize(req, "application/octet-stream")
	}
	if from > 0 {
		req.Header.Set("Range", fmt.Sprintf("bytes=%d-", from))
	}
	resp, err := u.client.Do(req)
	if err != nil {
		return from, err
	}
	defer func() { _ = resp.Body.Close() }()
	switch {
	case resp.StatusCode == http.StatusPartialContent && from > 0:
	case resp.StatusCode == http.StatusOK:
		// the whole file again: start over
		if from > 0 {
			if err := restartHash(f, h); err != nil {
				return from, fmt.Errorf("%w: %v", errDownloadFatal, err)
			}
			from = 0
		}
	case resp.StatusCode >= 500 || resp.StatusCode == http.StatusTooManyRequests:
		return from, fmt.Errorf("download: %s", resp.Status)
	default:
		return from, fmt.Errorf("%w: %s", errDownloadFatal, resp.Status)
	}

	done := from
	buf := make([]byte, 64<<10)
	for {
		n, rerr := resp.Body.Read(buf)
		if n > 0 {
			if done+int64(n) > updateMaxBundle {
				return done, fmt.Errorf("%w: bundle too large", errDownloadFatal)
			}
			if _, err := f.Write(buf[:n]); err != nil {
				return done, fmt.Errorf("%w: %v", errDownloadFatal, err)
			}
			h.Write(buf[:n])
			done += int64(n)
			p.report(done)
		}
		if rerr == io.EOF {
			return done, nil
		}
		if rerr != nil {
			return done, rerr
		}
	}
}

// back to an empty file and a fresh hash
func restartHash(f *os.File, h hash.Hash) error {
	if err := f.Truncate(0); err != nil {
		return err
	}
	if _, err := f.Seek(0, io.SeekStart); err != nil {
		return err
	}
	h.Reset()
	return nil
}

// dlProgress sends progress at most every half second, with a smoothed speed
type dlProgress struct {
	u        *updater
	total    int64
	lastAt   time.Time
	lastDone int64
	speed    float64
}

func (p *dlProgress) report(done int64) {
	now := time.Now()
	if now.Sub(p.lastAt) < 500*time.Millisecond {
		return
	}
	inst := float64(done-p.lastDone) / now.Sub(p.lastAt).Seconds()
	if inst < 0 {
		inst = 0
	}
	if p.speed == 0 {
		p.speed = inst
	} else {
		p.speed = p.speed*0.7 + inst*0.3
	}
	p.lastAt, p.lastDone = now, done
	pct := 0
	if p.total > 0 {
		pct = int(done * 100 / p.total)
	}
	d, sp := done, int64(p.speed)
	p.u.setState(func(s *UpdateState) { s.Percent, s.BytesDone, s.SpeedBps = pct, d, sp })
}

// --- the phone's side, over the companion link ---

// relayReply is one of the phone's answers to an update_fetch
type relayReply struct {
	Type  string `json:"type"`
	Req   int    `json:"req"`
	Done  int64  `json:"done"`
	Total int64  `json:"total"`
	Speed int64  `json:"speed"`
	Port  int    `json:"port"`
	Path  string `json:"path"`
	Error string `json:"error"`
}

// RelayAvailable: a companion app that can download updates is connected
func (n *navRelay) RelayAvailable() bool {
	n.mu.Lock()
	defer n.mu.Unlock()
	return n.conn != nil && n.canRelay
}

func (n *navRelay) RelayFetch(ctx context.Context, name, assetURL string, size int64, sha string,
	progress func(done, total, speed int64)) (string, error) {
	n.mu.Lock()
	c, host := n.conn, n.connHost
	if c == nil || !n.canRelay {
		n.mu.Unlock()
		return "", ErrNoNavPhone
	}
	n.relaySeq++
	req := n.relaySeq
	ch := make(chan relayReply, 16)
	if n.relayWaiting == nil {
		n.relayWaiting = map[int]chan relayReply{}
	}
	n.relayWaiting[req] = ch
	n.mu.Unlock()
	defer func() {
		n.mu.Lock()
		delete(n.relayWaiting, req)
		n.mu.Unlock()
	}()

	msg, _ := json.Marshal(map[string]any{
		"type": "update_fetch", "req": req, "name": name, "url": assetURL, "size": size, "sha256": sha,
	})
	wctx, cancel := context.WithTimeout(ctx, 5*time.Second)
	err := c.Write(wctx, websocket.MessageText, msg)
	cancel()
	if err != nil {
		return "", err
	}
	quiet := time.NewTimer(relayQuietLimit)
	defer quiet.Stop()
	for {
		select {
		case <-ctx.Done():
			return "", ctx.Err()
		case <-quiet.C:
			return "", errors.New("the phone stopped answering")
		case r := <-ch:
			quiet.Reset(relayQuietLimit)
			switch r.Type {
			case "update_fetch_progress":
				if progress != nil {
					progress(r.Done, r.Total, r.Speed)
				}
			case "update_fetch_error":
				if r.Error == "" {
					r.Error = "download failed"
				}
				return "", errors.New(clipRunes(r.Error, 120))
			case "update_fetch_ready":
				return relayURL(host, r.Port, r.Path)
			}
		}
	}
}

// where the phone serves the file: its tether address, never anywhere else
func relayURL(host string, port int, p string) (string, error) {
	if host == "" || port <= 0 || port > 65535 || !strings.HasPrefix(p, "/update/") || strings.Contains(p, "..") {
		return "", errors.New("the phone gave a bad address")
	}
	u := url.URL{Scheme: "http", Host: net.JoinHostPort(host, fmt.Sprint(port)), Path: p}
	return u.String(), nil
}

func (n *navRelay) deliverRelayReply(data []byte) {
	var r relayReply
	if json.Unmarshal(data, &r) != nil {
		return
	}
	n.mu.Lock()
	ch := n.relayWaiting[r.Req]
	n.mu.Unlock()
	if ch == nil {
		return
	}
	select {
	case ch <- r:
	default:
		// progress can be dropped; the last word can't, and there's always room
		// for it once the reader catches up
		if r.Type != "update_fetch_progress" {
			go func() {
				select {
				case ch <- r:
				case <-time.After(5 * time.Second):
				}
			}()
		}
	}
}

// the host part of the companion app's URL, for the relay's file server
func hostOf(wsURL string) string {
	u, err := url.Parse(wsURL)
	if err != nil {
		return ""
	}
	return u.Hostname()
}
