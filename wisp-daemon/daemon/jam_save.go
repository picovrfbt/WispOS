package daemon

import (
	"context"
	"errors"
	"sort"
	"strings"
	"time"
	"unicode"
)

// Jam favorites: every song the passengers add is remembered, in order, and
// when the session ends the Car Thing offers to keep them as a private
// Spotify playlist ("Car jam · Oct 17"). YouTube Music and SoundCloud picks
// are looked up on Spotify; one without a close match is left out and counted.

const jamMaxPicks = 100

var ErrJamNothingToSave = errors.New("no passenger songs to save")

// JamSaved is POST /jam/save's answer
type JamSaved struct {
	Name  string `json:"name"`
	Uri   string `json:"uri"`
	Songs int    `json:"songs"`
	// picks from other services with no match on Spotify
	Missing int `json:"missing"`
}

// pick remembers a passenger's song for the playlist (once each)
func (j *jamService) pickLocked(it jamItem) {
	for _, p := range j.picks {
		if p.Svc == it.Svc && p.ID == it.ID {
			return
		}
	}
	if len(j.picks) < jamMaxPicks {
		j.picks = append(j.picks, it)
	}
}

// Forget drops the passengers' songs without saving them
func (j *jamService) Forget() {
	j.mu.Lock()
	j.picks = nil
	j.mu.Unlock()
	j.emitState()
}

// Save makes the playlist from the passengers' songs, then forgets them
func (j *jamService) Save(ctx context.Context) (JamSaved, error) {
	j.mu.Lock()
	picks := append([]jamItem(nil), j.picks...)
	j.mu.Unlock()
	if len(picks) == 0 {
		return JamSaved{}, ErrJamNothingToSave
	}
	var uris []string
	seen := map[string]bool{}
	by := map[string]bool{}
	missing := 0
	for _, it := range picks {
		uri := it.ID
		if it.Svc != jamSpotify {
			uri = j.findOnSpotify(ctx, it)
		}
		if uri == "" {
			missing++
			continue
		}
		if !seen[uri] {
			seen[uri] = true
			uris = append(uris, uri)
		}
		if it.By != "" && it.By != "A passenger" {
			by[it.By] = true
		}
	}
	if len(uris) == 0 {
		return JamSaved{Missing: missing}, ErrJamNothingToSave
	}
	name := "Car jam · " + j.today().Format("Jan 2")
	desc := "Songs the passengers picked in the car, with Wisp."
	if len(by) > 0 {
		names := make([]string, 0, len(by))
		for n := range by {
			names = append(names, n)
		}
		sort.Strings(names)
		desc = "Songs " + joinNames(names) + " picked in the car, with Wisp."
	}
	// Spotify's busy answers are retried underneath; past this the Car Thing says it couldn't
	cctx, cancel := context.WithTimeout(ctx, 45*time.Second)
	defer cancel()
	res, err := j.app.server.Submit(cctx, ApiRequestTypeCreatePlaylist, ApiRequestDataCreatePlaylist{Name: name, Description: desc, Uris: uris})
	if err != nil {
		return JamSaved{}, err
	}
	uri, _ := res.(string)
	j.Forget()
	j.app.log.Infof("jam: saved %d songs as %q", len(uris), name)
	return JamSaved{Name: name, Uri: uri, Songs: len(uris), Missing: missing}, nil
}

// today in the phone's time zone, where it's known
func (j *jamService) today() time.Time {
	now := time.Now()
	if j.app.state != nil {
		if off := j.app.utcOffsetMin(); off != nil {
			return now.UTC().Add(time.Duration(*off) * time.Minute)
		}
	}
	return now
}

func joinNames(n []string) string {
	switch len(n) {
	case 1:
		return n[0]
	case 2:
		return n[0] + " and " + n[1]
	}
	return strings.Join(n[:len(n)-1], ", ") + " and " + n[len(n)-1]
}

// findOnSpotify finds a YouTube Music or SoundCloud song on Spotify, or ""
func (j *jamService) findOnSpotify(ctx context.Context, it jamItem) string {
	q := strings.TrimSpace(songWords(it.Title) + " " + strings.TrimSuffix(it.Artist, " - Topic"))
	if q == "" {
		return ""
	}
	res, err := j.app.server.Submit(ctx, ApiRequestTypeSearch, ApiRequestDataSearch{Query: q, TopN: true})
	tracks, _ := res.([]searchTrackResult)
	if err != nil {
		return ""
	}
	want := songWords(it.Title)
	for _, t := range tracks[:min(len(tracks), 3)] {
		got := songWords(t.Name)
		if got != "" && want != "" && (strings.Contains(got, want) || strings.Contains(want, got)) {
			return t.Uri
		}
	}
	return ""
}

// songWords: a title for comparing, without "(Official Video)", "[Lyrics]",
// "feat." parts and punctuation
func songWords(title string) string {
	var b strings.Builder
	depth := 0
	for _, r := range strings.ToLower(title) {
		switch {
		case r == '(' || r == '[':
			depth++
		case r == ')' || r == ']':
			depth = max(0, depth-1)
		case depth > 0:
		case unicode.IsLetter(r) || unicode.IsDigit(r):
			b.WriteRune(r)
		case unicode.IsSpace(r):
			b.WriteRune(' ')
		}
	}
	s := strings.Join(strings.Fields(b.String()), " ")
	for _, cut := range []string{" feat ", " ft ", " official video", " official audio", " lyrics", " lyric video"} {
		if i := strings.Index(" "+s+" ", cut); i >= 0 {
			s = strings.TrimSpace(s[:max(0, i-1)])
		}
	}
	return s
}
