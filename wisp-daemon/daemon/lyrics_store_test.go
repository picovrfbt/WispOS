package daemon

import (
	"testing"

	librespot "github.com/devgianlu/go-librespot"
)

func TestLyricsStoreKeepsFoundLyrics(t *testing.T) {
	s := newLyricsStore(t.TempDir(), &librespot.NullLogger{})
	key := lyricsCacheKey("phoneabc", "Midnight City", "M83")
	if s.get(key) != nil {
		t.Fatal("nothing kept yet")
	}
	s.put(key, &LyricsResult{SyncType: "LINE_SYNCED", Lines: []LyricsLine{{StartTimeMs: "1000", Words: "Waiting in a car"}}})
	got := s.get(key)
	if got == nil || len(got.Lines) != 1 || got.Lines[0].Words != "Waiting in a car" {
		t.Fatalf("kept lyrics should come back, got %+v", got)
	}
}
