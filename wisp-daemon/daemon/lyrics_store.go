package daemon

import (
	"crypto/sha1"
	"encoding/hex"
	"encoding/json"
	"os"
	"path/filepath"
	"sync"
	"time"

	librespot "github.com/devgianlu/go-librespot"
)

// Lyrics found before, kept on the Car Thing: a song played again shows its
// lyrics at once, with or without a connection. One small JSON file per song,
// in the data partition; the store keeps under lyricsStoreMax, drops songs
// unplayed for lyricsUnusedFor, and the oldest go first when it's full.

const (
	lyricsStoreMax   = 30 << 20
	lyricsUnusedFor  = 90 * 24 * time.Hour
	lyricsSweepEvery = 50
)

type lyricsStore struct {
	dir string
	log librespot.Logger

	mu      sync.Mutex
	written int
}

func lyricsStoreDir() string {
	if onDevice {
		return "/var/cache/wisp/lyrics"
	}
	return filepath.Join(os.TempDir(), "wisp-lyrics")
}

func newLyricsStore(dir string, log librespot.Logger) *lyricsStore {
	s := &lyricsStore{dir: dir, log: log}
	go func() {
		time.Sleep(3 * time.Minute)
		s.sweep()
	}()
	return s
}

func (s *lyricsStore) pathFor(key string) string {
	sum := sha1.Sum([]byte(key))
	h := hex.EncodeToString(sum[:])
	return filepath.Join(s.dir, h[:2], h+".json")
}

func (s *lyricsStore) get(key string) *LyricsResult {
	p := s.pathFor(key)
	b, err := os.ReadFile(p)
	if err != nil {
		return nil
	}
	var r LyricsResult
	if json.Unmarshal(b, &r) != nil || len(r.Lines) == 0 {
		_ = os.Remove(p)
		return nil
	}
	// played again: kept longer
	now := time.Now()
	_ = os.Chtimes(p, now, now)
	return &r
}

func (s *lyricsStore) put(key string, r *LyricsResult) {
	b, err := json.Marshal(r)
	if err != nil || len(b) > 1<<20 {
		return
	}
	p := s.pathFor(key)
	if os.MkdirAll(filepath.Dir(p), 0o755) != nil {
		return
	}
	tmp := p + ".tmp"
	if os.WriteFile(tmp, b, 0o644) != nil || os.Rename(tmp, p) != nil {
		_ = os.Remove(tmp)
		return
	}
	s.mu.Lock()
	s.written++
	sweep := s.written%lyricsSweepEvery == 0
	s.mu.Unlock()
	if sweep {
		s.sweep()
	}
}

func (s *lyricsStore) sweep() {
	if total := sweepDir(s.dir, lyricsStoreMax, lyricsUnusedFor); total >= 0 {
		s.log.Infof("lyrics: store trimmed to %d MB", total>>20)
	}
}
