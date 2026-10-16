package daemon

import (
	"encoding/json"
	"io/fs"
	"net/http"
	"os"
	"path/filepath"
)

// Settings → Storage: how much the Car Thing keeps for speed (covers, lyrics),
// and clearing it. Nothing in it is needed: it all comes back as it's used.

type savedData struct {
	CoversBytes int64 `json:"covers_bytes"`
	LyricsBytes int64 `json:"lyrics_bytes"`
}

func dirBytes(dir string) int64 {
	var total int64
	_ = filepath.WalkDir(dir, func(_ string, d fs.DirEntry, err error) error {
		if err == nil && !d.IsDir() {
			if info, err := d.Info(); err == nil {
				total += info.Size()
			}
		}
		return nil
	})
	return total
}

func clearDir(dir string) {
	entries, _ := os.ReadDir(dir)
	for _, e := range entries {
		_ = os.RemoveAll(filepath.Join(dir, e.Name()))
	}
}

func (s *ConcreteApiServer) registerSavedDataRoutes(m *http.ServeMux) {
	m.HandleFunc("GET /system/saved-data", func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		_ = json.NewEncoder(w).Encode(savedData{
			CoversBytes: dirBytes(coverCacheDir()),
			LyricsBytes: dirBytes(lyricsStoreDir()),
		})
	})
	m.HandleFunc("POST /system/saved-data/clear", func(w http.ResponseWriter, r *http.Request) {
		clearDir(coverCacheDir())
		clearDir(lyricsStoreDir())
		if lp := activeLyrics.Load(); lp != nil {
			lp.ClearCache()
		}
		s.log.Info("storage: saved covers and lyrics cleared")
		w.WriteHeader(http.StatusNoContent)
	})
}
