package daemon

import (
	"context"
	"encoding/json"
	"strings"
	"sync"
	"time"
)

// The passengers' line: their picks, from any service, in the order they were
// added. Spotify takes a queue, so a Spotify pick goes into Spotify's own
// queue once the song before it is playing there, and changes over as
// smoothly as any queued song. YouTube Music and SoundCloud don't: a pick from
// them waits here, and when the song before it is about to end, Spotify (or
// the other app) is paused and the pick starts in its own app on the phone.
// After a detour like that, when the line is empty again, Spotify carries on
// where it was.
//
// Steering: when Spotify runs out and starts its own autoplay picks, it plays
// the radio of the last passenger song that played on Spotify instead, so
// what follows sounds like what they chose (switch: JamState.Steer).

const (
	jamSpotify    = "spotify"
	jamYtMusic    = "ytmusic"
	jamSoundCloud = "soundcloud"

	jamArmAt    = 6 * time.Second         // this near the end, the next song gets ready
	jamSwitchAt = 1500 * time.Millisecond // and this near, it starts
	jamSettle   = 6 * time.Second         // after a change over, the time the apps take to show it
	jamFound    = 400                     // search results kept for picking
)

// jamItem is one song a passenger can pick, or picked
type jamItem struct {
	Svc    string
	ID     string // spotify:track:… or the service's own id for the song
	Title  string
	Artist string
	Image  string
	By     string
}

// jamLine is the line and what the change overs need to know
type jamLine struct {
	line    []jamItem
	lineSeq int
	// line[0] is in Spotify's own queue already
	handed bool
	// the line took the music away from Spotify, to a song in another app
	detour bool
	// the song playing, and the one that came near its end
	lastKey, armed string
	settle         time.Time
	// passenger songs that played on Spotify, newest last, and whether this autoplay run was steered
	onSpotify []string
	steered   bool
}

func jamServiceName(svc string) string {
	switch svc {
	case jamYtMusic:
		return "YouTube Music"
	case jamSoundCloud:
		return "SoundCloud"
	}
	return "Spotify"
}

// services the passengers can search: Spotify, and the phone's others that are on and signed in
func (j *jamService) services() []string {
	out := []string{jamSpotify}
	if n := j.phone(); n != nil {
		st := n.Status()
		if st.Connected {
			for _, s := range st.Services {
				if (s.Id == jamYtMusic || s.Id == jamSoundCloud) && s.Enabled && s.SignedIn {
					out = append(out, s.Id)
				}
			}
		}
	}
	return out
}

// search looks in one service, or all of them at once; with all, the results take turns
func (j *jamService) search(ctx context.Context, q, svc string) []jamItem {
	svcs := j.services()
	if svc != "" && svc != "all" {
		ok := false
		for _, s := range svcs {
			ok = ok || s == svc
		}
		if !ok {
			return nil
		}
		svcs = []string{svc}
	}
	per := jamMaxResults
	if len(svcs) > 1 {
		per = 4
	}
	ctx, cancel := context.WithTimeout(ctx, 10*time.Second)
	defer cancel()
	found := make([][]jamItem, len(svcs))
	var wg sync.WaitGroup
	for i, s := range svcs {
		wg.Add(1)
		go func() {
			defer wg.Done()
			found[i] = j.searchOne(ctx, s, q, per)
		}()
	}
	wg.Wait()
	var out []jamItem
	for k := 0; k < per; k++ {
		for _, f := range found {
			if k < len(f) {
				out = append(out, f[k])
			}
		}
	}
	j.mu.Lock()
	if j.found != nil {
		if len(j.found) > jamFound {
			j.found = map[string]jamItem{}
		}
		for _, it := range out {
			j.found[it.Svc+" "+it.ID] = it
		}
	}
	j.mu.Unlock()
	return out
}

func (j *jamService) searchOne(ctx context.Context, svc, q string, limit int) []jamItem {
	var out []jamItem
	if svc == jamSpotify {
		res, err := j.app.server.Submit(ctx, ApiRequestTypeSearch, ApiRequestDataSearch{Query: q, TopN: true})
		tracks, _ := res.([]searchTrackResult)
		if err != nil {
			return nil
		}
		for _, t := range tracks {
			if len(out) == limit {
				break
			}
			out = append(out, jamItem{Svc: svc, ID: t.Uri, Title: clipRunes(t.Name, 80), Artist: clipRunes(t.Artist, 60), Image: jamImage(t.Image)})
		}
		return out
	}
	n := j.phone()
	if n == nil {
		return nil
	}
	raw, err := n.ServiceBrowse(ctx, svc, "search:song:"+q)
	if err != nil {
		j.app.log.Debugf("jam: %s search: %v", svc, err)
		return nil
	}
	var items []struct {
		Name  string `json:"name"`
		Sub   string `json:"sub"`
		Image string `json:"image"`
		Video string `json:"video"`
	}
	if json.Unmarshal(raw, &items) != nil {
		return nil
	}
	for _, it := range items {
		if len(out) == limit {
			break
		}
		if it.Video == "" || len(it.Video) > 100 || it.Name == "" {
			continue
		}
		out = append(out, jamItem{Svc: svc, ID: it.Video, Title: clipRunes(it.Name, 80), Artist: clipRunes(it.Sub, 60), Image: jamImage(it.Image)})
	}
	return out
}

func jamImage(u string) string {
	if !strings.HasPrefix(u, "https://") || len(u) > 500 || strings.ContainsAny(u, "\"'() \n") {
		return ""
	}
	return u
}

// add puts a pick at the back of the line; its place in it, from 1
func (j *jamService) add(it jamItem) int {
	j.mu.Lock()
	defer j.mu.Unlock()
	j.line = append(j.line, it)
	j.lineSeq++
	j.pickLocked(it)
	return len(j.line)
}

// jamNow is what's playing, wherever it is
type jamNow struct {
	// spotify, ytmusic or soundcloud; "" when it's neither
	where   string
	playing bool
	// the song, to tell when it changes; also what a skip vote names
	key                  string
	uri                  string // Spotify's
	title, artist, image string
	// till the song ends; -1 when the app doesn't say
	left time.Duration
	// Spotify chose it, after the music ran out
	autoplay bool
}

func jamInt(v any) int64 {
	switch n := v.(type) {
	case int64:
		return n
	case int:
		return int64(n)
	case uint32:
		return int64(n)
	case float64:
		return int64(n)
	}
	return 0
}

func (j *jamService) observe(ctx context.Context) jamNow {
	var sp jamNow
	if res, err := j.app.server.Submit(ctx, ApiRequestTypeObserverStatus, nil); err == nil {
		if m, _ := res.(map[string]any); m != nil && m["active"] == true {
			sp = jamNow{where: jamSpotify, left: -1}
			sp.uri = statusStr(m, "track_uri")
			sp.key = sp.uri
			sp.title, sp.artist, sp.image = statusStr(m, "track_name"), statusStr(m, "track_artist"), statusStr(m, "track_image")
			sp.playing = m["is_paused"] != true && m["is_playing"] != false
			if d := jamInt(m["duration"]); d > 0 {
				sp.left = time.Duration(d-jamInt(m["position"])) * time.Millisecond
			}
			sp.autoplay = m["track_autoplay"] == true
		}
	}
	var ph jamNow
	if n := j.phone(); n != nil {
		if md := n.Media(); md.Present && md.Title != "" {
			if svc := serviceOfApp(md.App); svc != "" {
				ph = jamNow{where: svc, playing: md.Playing, title: md.Title, artist: md.Artist, left: -1}
				ph.key = svc + ":" + md.Title + "|" + md.Artist
				if md.DurationMs > 0 {
					pos := md.PositionMs
					if md.Playing && md.PositionAt > 0 {
						pos += time.Now().UnixMilli() - md.PositionAt
					}
					ph.left = time.Duration(md.DurationMs-pos) * time.Millisecond
				}
			}
		}
	}
	j.mu.Lock()
	detour := j.detour
	j.mu.Unlock()
	switch {
	case ph.playing:
		ph.image = j.imageFor(ph)
		return ph
	case sp.playing:
		return sp
	case detour && ph.where != "":
		ph.image = j.imageFor(ph)
		return ph
	case sp.where != "":
		return sp
	}
	return jamNow{left: -1}
}

// the cover of a passenger's song playing in another app, from their search
func (j *jamService) imageFor(n jamNow) string {
	j.mu.Lock()
	defer j.mu.Unlock()
	for _, it := range j.found {
		if it.Svc == n.where && it.Title == n.title {
			return it.Image
		}
	}
	return ""
}

// feed watches the music and makes the change overs
func (j *jamService) feed(ctx context.Context, topic string) {
	t := time.NewTicker(time.Second)
	defer t.Stop()
	for {
		select {
		case <-ctx.Done():
			return
		case <-t.C:
			if !j.current(topic) {
				return
			}
			j.step(ctx, false)
		}
	}
}

type jamAct int

const (
	jamNone      jamAct = iota
	jamHand             // line[0] into Spotify's queue
	jamToSpotify        // from another app to line[0] on Spotify
	jamToApp            // to line[0] in its app
	jamBack             // the line's done: back to Spotify where it was
	jamSteer            // Spotify's autoplay started: the radio of the passengers' last Spotify song
	jamSkip             // nothing waiting: the service's own next song
)

// decide: what to do now, from what's playing; ended means the song is at its
// end (or moved on by itself just after), skip that the passengers voted it off
func (l *jamLine) decide(n jamNow, ended, skip, steer bool) jamAct {
	ended = (ended || skip) && n.where != ""
	if len(l.line) > 0 {
		head := l.line[0]
		switch {
		case head.Svc == jamSpotify && n.where == jamSpotify:
			if !l.handed {
				return jamHand
			}
			if skip {
				return jamSkip
			}
		case head.Svc == jamSpotify && ended:
			return jamToSpotify
		case head.Svc != jamSpotify && ended:
			return jamToApp
		}
		return jamNone
	}
	if l.detour && n.where != jamSpotify && ended {
		return jamBack
	}
	if steer && n.where == jamSpotify && n.playing && n.autoplay && !l.steered && len(l.onSpotify) > 0 {
		return jamSteer
	}
	if skip && n.where != "" {
		return jamSkip
	}
	return jamNone
}

// step looks at what's playing and does what the line needs; skip moves on
// now. It says whether the music moved on.
func (j *jamService) step(ctx context.Context, skip bool) bool {
	n := j.observe(ctx)
	j.mu.Lock()
	if j.topic == "" {
		j.mu.Unlock()
		return false
	}
	// a Spotify pick from the line started: it's on now
	if len(j.line) > 0 && j.handed && n.where == jamSpotify && n.uri == j.line[0].ID {
		j.onSpotify = append(j.onSpotify, j.line[0].ID)
		if len(j.onSpotify) > 20 {
			j.onSpotify = j.onSpotify[1:]
		}
		j.line, j.handed = j.line[1:], false
		j.lineSeq++
	}
	if n.where == jamSpotify && !n.autoplay {
		j.steered = false
	}
	ended := false
	if time.Now().After(j.settle) && n.playing {
		// it moved on by itself right after coming near its end
		if n.key != j.lastKey && j.armed != "" && j.armed == j.lastKey {
			ended = true
		}
		if n.left >= 0 && n.left <= jamSwitchAt {
			ended = true
		}
	}
	if n.left >= 0 && n.left <= jamArmAt {
		j.armed = n.key
	} else if n.key != j.armed {
		j.armed = ""
	}
	j.lastKey = n.key
	act := j.decide(n, ended, skip, j.steer)
	var head jamItem
	if len(j.line) > 0 {
		head = j.line[0]
	}
	var seed string
	switch act {
	case jamNone:
		j.mu.Unlock()
		return false
	case jamHand:
		j.handed = true
	case jamToSpotify:
		j.handed, j.detour = true, false
	case jamToApp:
		if n.where == jamSpotify {
			j.detour = true
		}
		j.line = j.line[1:]
		j.lineSeq++
	case jamBack:
		j.detour = false
	case jamSteer:
		j.steered = true
		seed = j.onSpotify[len(j.onSpotify)-1]
	}
	if act != jamHand {
		j.settle = time.Now().Add(jamSettle)
		j.armed, j.lastKey = "", ""
	}
	j.mu.Unlock()

	srv := j.app.server
	ph := j.phone()
	pausePhone := func() {
		if ph != nil {
			_ = ph.MediaControl(ctx, "pause")
		}
	}
	switch act {
	case jamHand:
		if _, err := srv.Submit(ctx, ApiRequestTypeAddToQueue, head.ID); err != nil {
			j.app.log.Debugf("jam: queue %s: %v", head.ID, err)
			j.mu.Lock()
			j.handed = false
			j.mu.Unlock()
		}
		return false
	case jamToSpotify:
		pausePhone()
		if n.where == jamSpotify || j.spotifyActive(ctx) {
			_, _ = srv.Submit(ctx, ApiRequestTypeAddToQueue, head.ID)
			_, _ = srv.Submit(ctx, ApiRequestTypeNext, nil)
			_, _ = srv.Submit(ctx, ApiRequestTypeResume, nil)
		} else {
			_, _ = srv.Submit(ctx, ApiRequestTypePlay, ApiRequestDataPlay{Uri: head.ID})
		}
	case jamToApp:
		if n.where == jamSpotify {
			_, _ = srv.Submit(ctx, ApiRequestTypePause, nil)
		} else if n.where != head.Svc {
			pausePhone()
		}
		if ph == nil {
			return false
		}
		if err := ph.ServicePlay(ctx, head.Svc, "", head.ID, head.Title); err != nil {
			j.app.log.Infof("jam: couldn't start %s on %s: %v", head.Title, head.Svc, err)
			return false
		}
	case jamBack:
		pausePhone()
		_, _ = srv.Submit(ctx, ApiRequestTypeResume, nil)
	case jamSteer:
		pl, err := srv.Submit(ctx, ApiRequestTypeTrackRadio, seed)
		uri, _ := pl.(string)
		if err != nil || uri == "" {
			j.app.log.Infof("jam: no song radio for %s: %v", seed, err)
			return false
		}
		if _, err := srv.Submit(ctx, ApiRequestTypePlay, ApiRequestDataPlay{Uri: uri}); err != nil {
			return false
		}
		j.activity("Playing more like the passengers' picks")
	case jamSkip:
		if n.where == jamSpotify {
			_, err := srv.Submit(ctx, ApiRequestTypeNext, nil)
			return err == nil
		}
		if ph == nil {
			return false
		}
		return ph.MediaControl(ctx, "next") == nil
	}
	j.emitState()
	return true
}

func (j *jamService) spotifyActive(ctx context.Context) bool {
	res, err := j.app.server.Submit(ctx, ApiRequestTypeObserverStatus, nil)
	m, _ := res.(map[string]any)
	return err == nil && m != nil && m["active"] == true
}
