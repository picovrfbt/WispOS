package daemon

import (
	"context"
	"fmt"
	"regexp"
	"strconv"
	"strings"
	"time"
)

// More of what Wisp understands on its own, without the phone's model: shuffle
// and repeat, the volume to a number, skipping ahead or back by some seconds,
// opening a screen, and the driver's own library ("play my likes", "shuffle my
// liked songs", "play my Discover Weekly"). These rules go ahead of the others
// in understandRules, so "open the map" opens the map rather than asking for
// directions to a place called "the map".

const (
	doShuffleOn  = "shuffle_on"
	doShuffleOff = "shuffle_off"
	doRepeatOne  = "repeat_one"
	doRepeatAll  = "repeat_all"
	doRepeatOff  = "repeat_off"
	doVolumeTo   = "volume_to"
	doSeekAhead  = "seek_ahead"
	doSeekBack   = "seek_back"
	doOpen       = "open"
	doLiked      = "liked"
	doMadeForYou = "made_for_you"
)

// ApiEventTypeVoiceOpen asks the screen to open one of its pages
const ApiEventTypeVoiceOpen ApiEventType = "voice/open"

// a number as said or as written: "40", "forty", "twenty five", "a hundred"
const numberWords = `(\d{1,3}|(?:a |one )?hundred|(?:twenty|thirty|forty|fifty|sixty|seventy|eighty|ninety)(?:[ -](?:one|two|three|four|five|six|seven|eight|nine))?|zero|one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve|thirteen|fourteen|fifteen|sixteen|seventeen|eighteen|nineteen|a|an)`

var moreRules = []struct {
	re   *regexp.Regexp
	what string
	arg  int
}{
	// the library before shuffle, so "shuffle my liked songs" plays them shuffled
	{regexp.MustCompile(`^(?:(play|put on|start|play me|shuffle|play all of) )?(?:all )?my (?:liked songs|liked music|liked tracks|likes|liked|favou?rites|favou?rite songs|saved songs|library)(?: on shuffle| shuffled)?$`), doLiked, 1},
	// a verb or "my" first: "on repeat" alone is the repeat button
	{regexp.MustCompile(`^(?:(?:play|put on|start|shuffle) (?:my |the )?|my )(discover weekly|release radar|daylist|daily mix(?: \d)?|on repeat|repeat rewind|time capsule)$|^(?:(?:play|put on|start|shuffle) )?(?:my |the )?(discover weekly|release radar|daylist|daily mix(?: \d)?|time capsule)$`), doMadeForYou, -2},

	{regexp.MustCompile(`^(?:turn |switch )?shuffle on$|^(?:turn|switch) on (?:the )?shuffle$|^(?:shuffle(?: it| this| (?:the|this) (?:music|songs|playlist|album))?|mix it up|put (?:it|this) on shuffle|shuffle mode)$`), doShuffleOn, 0},
	{regexp.MustCompile(`^(?:turn |switch )?shuffle off$|^(?:turn|switch) off (?:the )?shuffle$|^(?:stop|no more|don'?t) shuffl(?:e|ing)(?: it)?$|^unshuffle$|^play (?:it |them )?in order$`), doShuffleOff, 0},

	{regexp.MustCompile(`^(?:turn |switch )?repeat off$|^(?:turn|switch) off (?:the )?repeat$|^(?:stop|no more|don'?t) (?:repeating|looping|repeat|loop)(?: (?:it|this|the song))?$|^(?:turn |switch )?loop off$`), doRepeatOff, 0},
	{regexp.MustCompile(`^(?:repeat|loop) (?:this|this song|this one|the song|it|this track)(?: on)?$|^put (?:this|it|this song) on repeat$|^(?:repeat one|repeat the song)$`), doRepeatOne, 0},
	{regexp.MustCompile(`^(?:repeat|loop) (?:the )?(?:playlist|album|all|everything|queue)$|^(?:turn |switch )?(?:repeat|loop) on$|^(?:turn|switch) on (?:the )?(?:repeat|loop)$|^(?:repeat|loop)$`), doRepeatAll, 0},

	{regexp.MustCompile(`^(?:set |turn |put |change )?(?:the )?volume (?:to |at |on )?` + numberWords + `(?: percent|%)?$|^(?:set|turn|put) (?:it|the music|the sound) (?:to |at )` + numberWords + `(?: percent|%)?$`), doVolumeTo, -2},
	{regexp.MustCompile(`^(?:full|max(?:imum)?) volume$|^volume (?:all the way up|max(?:imum)?|full)$|^turn it all the way up$`), doVolumeTo, 0},

	{regexp.MustCompile(`^(?:skip|jump|go|fast forward|move|scrub) (?:ahead|forward|on) (?:by )?` + numberWords + ` (seconds?|minutes?)$|^fast forward ` + numberWords + ` (seconds?|minutes?)$|^(?:fast forward|skip ahead a bit|jump ahead a bit|go forward a bit)$`), doSeekAhead, 0},
	{regexp.MustCompile(`^(?:go|jump|skip|rewind|move|scrub) back(?:wards)? (?:by )?` + numberWords + ` (seconds?|minutes?)$|^rewind ` + numberWords + ` (seconds?|minutes?)$|^(?:rewind|rewind (?:it|a bit|a little)|go back a bit|jump back a bit)$`), doSeekBack, 0},

	{regexp.MustCompile(`^(?:open|show(?: me)?|bring up|pull up|go to|take me to|switch to) (?:the |my )?(home screen|home page|homepage|settings|setting|menu|map|maps|navigation|queue|up next|visualizer|visualiser|now playing|player|library|music library)$|^(?:open|show(?: me)?|bring up|pull up) (?:the )?(home)$`), doOpen, -2},
}

func init() {
	// ahead of the rest: see the top of this file
	understandRules = append(append(understandRules[:0:0], moreRules...), understandRules...)
}

var units = map[string]int{
	"zero": 0, "one": 1, "two": 2, "three": 3, "four": 4, "five": 5, "six": 6, "seven": 7,
	"eight": 8, "nine": 9, "ten": 10, "eleven": 11, "twelve": 12, "thirteen": 13,
	"fourteen": 14, "fifteen": 15, "sixteen": 16, "seventeen": 17, "eighteen": 18, "nineteen": 19,
	"a": 1, "an": 1,
}
var tens = map[string]int{
	"twenty": 20, "thirty": 30, "forty": 40, "fifty": 50, "sixty": 60, "seventy": 70,
	"eighty": 80, "ninety": 90,
}

// spokenNumber reads 0..100 as digits or words; false for anything else
func spokenNumber(s string) (int, bool) {
	s = strings.TrimSpace(s)
	if n, err := strconv.Atoi(s); err == nil {
		return n, n >= 0 && n <= 100
	}
	if strings.HasSuffix(s, "hundred") {
		return 100, true
	}
	parts := strings.FieldsFunc(s, func(r rune) bool { return r == ' ' || r == '-' })
	switch len(parts) {
	case 1:
		if n, ok := units[parts[0]]; ok {
			return n, true
		}
		n, ok := tens[parts[0]]
		return n, ok
	case 2:
		t, ok1 := tens[parts[0]]
		u, ok2 := units[parts[1]]
		return t + u, ok1 && ok2 && u > 0 && u < 10
	}
	return 0, false
}

// seekSeconds is how far a skip asks for: "30 seconds", "a minute", or a
// default for "rewind" and "fast forward" alone
func seekSeconds(t string, def int) int {
	m := regexp.MustCompile(numberWords + ` (seconds?|minutes?)$`).FindStringSubmatch(t)
	if m == nil {
		return def
	}
	n, ok := spokenNumber(m[1])
	if !ok || n == 0 {
		return def
	}
	if strings.HasPrefix(m[2], "minute") {
		n *= 60
	}
	return n
}

// the pages "open ..." can name, as the screen calls them
var openPages = map[string]string{
	"home": "home", "home screen": "home", "home page": "home", "homepage": "home",
	"library": "home", "music library": "home",
	"settings": "settings", "setting": "settings", "menu": "menu",
	"map": "map", "maps": "map", "navigation": "map",
	"queue": "queue", "up next": "queue",
	"visualizer": "viz", "visualiser": "viz",
	"now playing": "player", "player": "player",
}

// handleMore runs the commands in this file; false when it's not one of them
func (v *voiceService) handleMore(ctx context.Context, gen uint64, u understood, said string) (string, error, bool) {
	switch u.what {
	case doShuffleOn, doShuffleOff:
		on := u.what == doShuffleOn
		if _, err := v.app.server.Submit(ctx, ApiRequestTypeSetShufflingContext, on); err != nil {
			out, err := v.fail(gen, "Couldn't change shuffle")
			return out, err, true
		}
		msg := "Shuffle on"
		if !on {
			msg = "Shuffle off"
		}
		v.flash(gen, "done", msg)
		return u.what, nil, true

	case doRepeatOne, doRepeatAll, doRepeatOff:
		track, all := u.what == doRepeatOne, u.what == doRepeatAll
		_, err1 := v.app.server.Submit(ctx, ApiRequestTypeSetRepeatingTrack, track)
		_, err2 := v.app.server.Submit(ctx, ApiRequestTypeSetRepeatingContext, all || track)
		if err1 != nil || err2 != nil {
			out, err := v.fail(gen, "Couldn't change repeat")
			return out, err, true
		}
		msg := map[string]string{doRepeatOne: "Repeating this song", doRepeatAll: "Repeat on", doRepeatOff: "Repeat off"}[u.what]
		v.flash(gen, "done", msg)
		return u.what, nil, true

	case doVolumeTo:
		pct := 100
		if u.arg != "" {
			n, ok := spokenNumber(u.arg)
			if !ok {
				out, err := v.fail(gen, "Say a volume from 0 to 100")
				return out, err, true
			}
			pct = n
		}
		target := int32(pct * MaxStateVolume / 100)
		if _, err := v.app.server.Submit(ctx, ApiRequestTypeSetVolume, ApiRequestDataVolume{Volume: target}); err != nil {
			out, err := v.fail(gen, "Couldn't set the volume")
			return out, err, true
		}
		v.flash(gen, "done", fmt.Sprintf("Volume %d%%", pct))
		return u.what, nil, true

	case doSeekAhead, doSeekBack:
		m, ok := v.nowPlaying(ctx)
		if !ok {
			out, err := v.answer(gen, "Nothing's playing right now")
			return out, err, true
		}
		def := 30
		if u.what == doSeekBack {
			def = 15
		}
		secs := seekSeconds(said, def)
		pos, dur := anyInt(m["position"]), anyInt(m["duration"])
		delta := int64(secs) * 1000
		if u.what == doSeekBack {
			delta = -delta
		}
		to := max(pos+delta, 0)
		if dur > 0 {
			to = min(to, dur-1000)
		}
		if _, err := v.app.server.Submit(ctx, ApiRequestTypeSeek, ApiRequestDataSeek{Position: to}); err != nil {
			out, err := v.fail(gen, "Couldn't skip within the song")
			return out, err, true
		}
		word := "ahead"
		if u.what == doSeekBack {
			word = "back"
		}
		v.flash(gen, "done", fmt.Sprintf("%s %s", spokenDuration(secs), word))
		return u.what, nil, true

	case doOpen:
		page := openPages[u.arg]
		if page == "" {
			return "", nil, false
		}
		v.app.server.Emit(&ApiEvent{Type: ApiEventTypeVoiceOpen, Data: map[string]string{"page": page}})
		v.flash(gen, "done", "Opening "+map[string]string{
			"home": "Home", "settings": "Settings", "menu": "the menu", "map": "the map",
			"queue": "Up next", "viz": "the visualizer", "player": "Now Playing",
		}[page])
		return page, nil, true

	case doLiked:
		shuffle := u.arg == "shuffle" || strings.Contains(said, "shuffle")
		data := ApiRequestDataPlay{Uri: likedCollectionUri, Shuffle: &shuffle}
		if _, err := v.app.server.Submit(ctx, ApiRequestTypePlay, data); err != nil {
			out, err := v.fail(gen, "Couldn't play your Liked Songs")
			return out, err, true
		}
		v.memory.remember(voiceTurn{uri: likedCollectionUri, label: "Liked Songs"})
		msg := "Liked Songs"
		if shuffle {
			msg = "Shuffling your Liked Songs"
		}
		v.emit("playing", msg)
		v.scheduleIdle(gen, 5*time.Second)
		return msg, nil, true

	case doMadeForYou:
		name := u.arg
		v.emit("thinking", "")
		res, err := v.app.server.Submit(ctx, ApiRequestTypeSearch, ApiRequestDataSearch{Query: name, TopN: true, Kind: "playlist"})
		lists, _ := res.([]searchTrackResult)
		if err != nil || len(lists) == 0 || lists[0].Uri == "" {
			out, err := v.fail(gen, "Couldn't find your "+titleWords(name))
			return out, err, true
		}
		v.memory.remember(voiceTurn{uri: lists[0].Uri, label: lists[0].Name})
		out, err := v.playUri(ctx, gen, lists[0].Uri, lists[0].Name)
		return out, err, true
	}
	return "", nil, false
}

// anyInt reads a number from the status map, however it was stored
func anyInt(v any) int64 {
	switch n := v.(type) {
	case int64:
		return n
	case int:
		return int64(n)
	case int32:
		return int64(n)
	case uint32:
		return int64(n)
	case float64:
		return int64(n)
	}
	return 0
}

func spokenDuration(secs int) string {
	if secs%60 == 0 {
		if secs == 60 {
			return "A minute"
		}
		return fmt.Sprintf("%d minutes", secs/60)
	}
	return fmt.Sprintf("%d seconds", secs)
}

func titleWords(s string) string {
	w := strings.Fields(s)
	for i, x := range w {
		w[i] = strings.ToUpper(x[:1]) + x[1:]
	}
	return strings.Join(w, " ")
}
