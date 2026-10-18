package daemon

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"math"
	"regexp"
	"strings"
	"sync"
	"time"

	"github.com/coder/websocket"
)

// The smarter half of the voice flow, before the library matcher
// (voice_resolver.go) sees anything: everyday phrasings rewritten to the
// commands it knows ("I wanna hear Daft Punk" -> "play daft punk"), questions
// answered ("who sings this?", "when do I get there?"), follow-ups on the last
// command ("play the album", "no, the other one") and things beyond music
// (Drive Mode, night mode, brightness, directions, calls).
//
// All of it is plain rules and a little memory, so it costs the Car Thing
// next to nothing and works without the phone, apart from what only the phone
// can do (directions, calls, the weather's location, speaking).

// how long a command stays "the last thing" for a follow-up
const voiceFollowUpWindow = 3 * time.Minute

// voiceTurn is what the last command did, for follow-ups
type voiceTurn struct {
	at    time.Time
	uri   string
	label string
	// other matches for "no, the other one", best first
	others []voiceAlt
}

type voiceAlt struct{ uri, label string }

type voiceMemory struct {
	mu   sync.Mutex
	last voiceTurn
}

func (m *voiceMemory) remember(t voiceTurn) {
	t.at = time.Now()
	m.mu.Lock()
	m.last = t
	m.mu.Unlock()
}

// recent is the last turn if it's still fresh
func (m *voiceMemory) recent() (voiceTurn, bool) {
	m.mu.Lock()
	defer m.mu.Unlock()
	if m.last.at.IsZero() || time.Since(m.last.at) > voiceFollowUpWindow {
		return voiceTurn{}, false
	}
	return m.last, true
}

// nextOther takes the next alternative off the last turn
func (m *voiceMemory) nextOther() (voiceAlt, bool) {
	m.mu.Lock()
	defer m.mu.Unlock()
	if m.last.at.IsZero() || time.Since(m.last.at) > voiceFollowUpWindow || len(m.last.others) == 0 {
		return voiceAlt{}, false
	}
	alt := m.last.others[0]
	m.last.others = m.last.others[1:]
	m.last.at = time.Now()
	return alt, true
}

// ---------------------------------------------------------------- phrasing

// the polite and wake-word bits around a command
var looseLead = regexp.MustCompile(`^(?:(?:hey|okay|ok) wisp |wisp )?(?:(?:can|could|would|will) you (?:please )?|please |hey |okay |ok |um |uh |so |just )*`)
var looseTail = regexp.MustCompile(`(?: (?:please|for me|thanks|thank you|now|right now))+$`)

// rewrites, tried in order; $1 is what's left of the name
var looseRewrites = []struct {
	re  *regexp.Regexp
	out string
}{
	// playing something
	{regexp.MustCompile(`^(?:i(?: want to| wanna| would like to|'?d like to| really want to) (?:hear|listen to)|let'?s (?:hear|listen to)|put on|throw on|play me|start playing|blast|i need) (.+)$`), "play $1"},
	{regexp.MustCompile(`^(?:play|put on) (?:some(?:thing)? (?:by|from) )(.+)$`), "play $1"},
	// queueing
	{regexp.MustCompile(`^(?:queue up|add) (.+?) (?:to (?:the|my) queue|next)$`), "queue $1"},
	{regexp.MustCompile(`^play (.+?) (?:next|after this(?: one| song)?)$`), "queue $1"},
	{regexp.MustCompile(`^queue up (.+)$`), "queue $1"},
	// volume
	{regexp.MustCompile(`^(?:(?:a )?(?:little |bit |lot )?louder|make it louder|crank it(?: up)?|turn (?:the (?:volume|music) )?up(?: a (?:bit|little))?|turn up the (?:volume|music)|pump it up|more volume|i can'?t hear (?:it|this|the music))$`), "turn it up"},
	{regexp.MustCompile(`^(?:(?:a )?(?:little |bit )?(?:quieter|softer)|make it quieter|too loud|it'?s too loud|turn (?:the (?:volume|music) )?down(?: a (?:bit|little))?|turn down the (?:volume|music)|lower the (?:volume|music)|less volume)$`), "turn it down"},
	// skipping and stopping
	{regexp.MustCompile(`^(?:skip (?:this|it|this one|this song)|next (?:song|track|one)|play the next (?:song|one|track)|i don'?t like (?:this|it|this song)|not this (?:song|one))$`), "next"},
	{regexp.MustCompile(`^(?:previous (?:song|track|one)|play the (?:last|previous) (?:song|one|track)|go back (?:a song|one))$`), "previous"},
	{regexp.MustCompile(`^(?:pause (?:it|the music|this|the song)|hold on|stop the music|stop playing|be quiet|quiet|shush|silence|mute)$`), "pause"},
	{regexp.MustCompile(`^(?:keep (?:playing|going)|continue|unpause|play (?:the )?music|carry on|resume (?:the )?music|start (?:the )?music again)$`), "resume"},
	// liking
	{regexp.MustCompile(`^(?:i (?:love|like|really like) (?:this|this song|it)|this (?:song )?is (?:great|good|amazing)|save (?:it|this song)|like (?:it|this song)|add (?:it|this) to my likes)$`), "like this"},
}

// normalizeLoose turns everyday phrasing into the commands the matcher knows;
// anything it doesn't recognise comes back lowercased and tidied
func normalizeLoose(transcript string) string {
	t := strings.ToLower(strings.TrimSpace(transcript))
	t = strings.NewReplacer("’", "'", ",", "", ".", "", "?", "", "!", "").Replace(t)
	t = strings.Join(strings.Fields(t), " ")
	t = strings.TrimSpace(looseLead.ReplaceAllString(t, ""))
	t = strings.TrimSpace(looseTail.ReplaceAllString(t, ""))
	for _, r := range looseRewrites {
		if r.re.MatchString(t) {
			return strings.TrimSpace(r.re.ReplaceAllString(t, r.out))
		}
	}
	return t
}

// ---------------------------------------------------------------- what it is

// the things understand() handles itself
const (
	askNowPlaying = "now_playing"
	askArtist     = "artist"
	askAlbum      = "album"
	askTime       = "time"
	askWeather    = "weather"
	askArrival    = "arrival"
	askNextTurn   = "next_turn"
	askBattery    = "battery"

	doAlbum      = "play_album"
	doArtist     = "play_artist"
	doOtherOne   = "other_one"
	doRestart    = "restart"
	doDriveStart = "drive_start"
	doDriveStop  = "drive_stop"
	doNight      = "night_mode"
	doBrighter   = "brighter"
	doDimmer     = "dimmer"
	doAutoBright = "auto_brightness"
	doLyrics     = "lyrics"
	doNavigate   = "navigate"
	doNavStop    = "nav_stop"
	doJamStart   = "jam_start"
	doJamStop    = "jam_stop"
	doCall       = "call"
	doMood       = "mood"
)

type understood struct {
	what string
	// navigate: where; call: who; night_mode/lyrics/auto_brightness: on|off|auto
	arg string
}

var understandRules = []struct {
	re   *regexp.Regexp
	what string
	// which capture group (if any) is the argument
	arg int
}{
	// questions
	{regexp.MustCompile(`^(?:what(?:'?s| is) (?:this|playing|this song|the song|that song|this track|on|this one)|what song is (?:this|playing|that)|what am i listening to|what are we listening to|name (?:of )?this song|what'?s the name of this song)$`), askNowPlaying, 0},
	{regexp.MustCompile(`^(?:who(?:'?s| is)? (?:singing|sings|sang|this|singing this|the artist|playing)|who (?:sings|sang|made|wrote|is) (?:this|it|this song|that)|what artist is this|who'?s this by|who is this by)$`), askArtist, 0},
	{regexp.MustCompile(`^(?:what|which) album (?:is (?:this|it|that)(?: from| on)?|is this song (?:from|on)|are we (?:on|in))$`), askAlbum, 0},
	{regexp.MustCompile(`^(?:what(?:'?s| is) the time|what time is it|the time|time|what'?s the time now)$`), askTime, 0},
	{regexp.MustCompile(`(?:weather|is it (?:going to|gonna) (?:rain|snow)|will it (?:rain|snow)|how (?:hot|cold|warm) is it|what'?s the temperature|temperature outside)`), askWeather, 0},
	{regexp.MustCompile(`^(?:(?:when|what time) (?:will|do|am|are|'?ll) (?:i|we) (?:get there|arrive|be there|get in|reach)|how (?:long|much longer)(?: (?:until|till|til|to|before) (?:i|we) (?:get there|arrive|are there))?|what'?s (?:my|the|our) eta|eta|are we there yet|how far(?: (?:is it|away|to go))?|how much (?:further|farther))$`), askArrival, 0},
	{regexp.MustCompile(`^(?:what'?s (?:my|the) next (?:turn|direction)|where do i (?:turn|go next)|next turn|what'?s next on the route)$`), askNextTurn, 0},
	{regexp.MustCompile(`^(?:(?:how'?s|what'?s|how is|what is) (?:my |the )?(?:phone'?s? )?battery|(?:my |phone )?battery(?: level)?|is my phone (?:charging|dying))$`), askBattery, 0},
	// a mood, not a name: Spotify's best playlist for it
	{regexp.MustCompile(`^play (?:something|some music|some songs|anything|music)(?: that'?s| to| for| i can| we can)? ?(chill|relaxing|relaxed|calm|mellow|upbeat|happy|sad|energetic|hype|fun|romantic|focus|study|sleepy|dance|party|workout|driving|road trip|feel good|feel-good|summer|rainy day|night drive|late night|throwback|old school|90s|80s|2000s|70s|60s)(?: music| songs| vibes)?$|^(?:put on|play) (?:some )?(chill|relaxing|calm|mellow|upbeat|happy|sad|energetic|hype|romantic|focus|study|dance|party|workout|driving|road trip|feel good|summer|throwback|90s|80s|2000s|70s|60s) (?:music|songs|vibes|tunes)$|^i'?m in the mood for (?:something )?(\w+(?: \w+)?)$`), doMood, -2},
	// follow-ups on what's playing
	{regexp.MustCompile(`^(?:play )?(?:the|this|that) (?:whole |full |entire )?album(?: this is from| it'?s from| this song is from)?$|^play the album$`), doAlbum, 0},
	{regexp.MustCompile(`^(?:play )?more (?:by|from) (?:them|him|her|this artist|this band|this singer|that artist)$|^play (?:this|that|the) (?:artist|band|singer)$|^more (?:like this|of this)$|^play more like this$`), doArtist, 0},
	{regexp.MustCompile(`^(?:no )?(?:the other one|not that one|wrong (?:one|song)|not this one|other one|the other song|that'?s not it|that'?s the wrong (?:one|song)|no not that)$`), doOtherOne, 0},
	{regexp.MustCompile(`^(?:play (?:it|that|this|this song) again|start (?:it |this |the song )?over|from the (?:top|beginning|start)|restart(?: (?:it|the song|this song))?|replay(?: it| this)?|again)$`), doRestart, 0},
	// beyond music
	{regexp.MustCompile(`^(?:start|begin|turn on|open|launch|go to|enter) drive mode$|^drive mode(?: on)?$`), doDriveStart, 0},
	{regexp.MustCompile(`^(?:stop|end|turn off|close|exit|quit|leave) drive mode$|^drive mode off$`), doDriveStop, 0},
	{regexp.MustCompile(`^(?:turn |switch )?night mode (on|off)$|^(?:turn|switch) (on|off) night mode$|^(enable|disable) night mode$|^(auto(?:matic)?) night mode$|^night mode (auto(?:matic)?)$`), doNight, -1},
	{regexp.MustCompile(`^(?:(?:make (?:it|the screen) )?brighter|brighten(?: the screen| it| up)?|turn (?:up )?the brightness(?: up)?|more brightness|the screen is too dark|too dark|increase (?:the )?brightness)$`), doBrighter, 0},
	{regexp.MustCompile(`^(?:(?:make (?:it|the screen) )?(?:dimmer|darker)|dim(?: the screen| it)?|turn (?:down )?the brightness(?: down)?|less brightness|the screen is too bright|too bright|lower (?:the )?brightness|decrease (?:the )?brightness)$`), doDimmer, 0},
	{regexp.MustCompile(`^(?:turn |switch )?auto(?:matic)? brightness (on|off)$|^(?:turn|switch) (on|off) auto(?:matic)? brightness$`), doAutoBright, -1},
	{regexp.MustCompile(`^(?:(show|turn on) (?:the )?lyrics|(hide|turn off) (?:the )?lyrics|lyrics (on|off))$`), doLyrics, -1},
	{regexp.MustCompile(`^(?:let|have) (?:the )?(?:passengers|everyone|my friends|the kids) (?:pick|choose|add|queue)(?: (?:the )?(?:music|songs))?$|^(?:start|open) (?:a |the )?(?:jam|passenger mode|passengers? (?:picks?|mode))$|^passenger mode(?: on)?$`), doJamStart, 0},
	{regexp.MustCompile(`^(?:stop|end|close) (?:the )?(?:jam|passenger mode|passengers? (?:picks?|picking|mode))$|^passenger mode off$`), doJamStop, 0},
	{regexp.MustCompile(`^(?:stop|end|cancel|quit|exit) (?:the )?(?:navigation|navigating|directions|route|trip)$|^(?:stop|cancel) navigat(?:ion|ing)$`), doNavStop, 0},
	{regexp.MustCompile(`^(?:take me|navigate|drive me|get me|give me directions|directions|show me the way|how do i get|route me) (?:to |back to )?(.+)$|^go (?:to |back to )(.+)$|^(?:go|head|let'?s go) (home)$`), doNavigate, -2},
	{regexp.MustCompile(`^(?:call|phone|dial|ring) (.+?)(?: up| on (?:the )?phone)?$|^give (.+?) a (?:call|ring)$`), doCall, -2},
}

// understand says what a (normalised) command is, if it's one of its own
func understand(t string) (understood, bool) {
	for _, r := range understandRules {
		m := r.re.FindStringSubmatch(t)
		if m == nil {
			continue
		}
		u := understood{what: r.what}
		switch {
		case r.arg > 0 && r.arg < len(m):
			u.arg = strings.TrimSpace(m[r.arg])
		case r.arg < 0:
			// the first group that matched: an on/off word (-1) or a name (-2)
			for _, g := range m[1:] {
				if g != "" {
					u.arg = strings.TrimSpace(g)
					if r.arg == -1 {
						u.arg = onOff(g)
					}
					break
				}
			}
		}
		if u.what == doCall && !plausibleName(u.arg) {
			continue
		}
		return u, true
	}
	return understood{}, false
}

func onOff(w string) string {
	switch w {
	case "on", "enable", "show", "turn on":
		return "on"
	case "off", "disable", "hide", "turn off":
		return "off"
	case "auto", "automatic":
		return "auto"
	}
	return w
}

// "call it a day" isn't a phone call
func plausibleName(s string) bool {
	switch s {
	case "", "it", "it a day", "this", "that", "me", "the shots":
		return false
	}
	return len(s) <= 40
}

// ---------------------------------------------------------------- doing it

// handleUnderstood runs a command understand() recognised
func (v *voiceService) handleUnderstood(ctx context.Context, gen uint64, u understood) (string, error) {
	v.app.log.Infof("voice: understood %s %q", u.what, u.arg)
	switch u.what {
	case askNowPlaying, askArtist, askAlbum:
		return v.answerNowPlaying(ctx, gen, u.what)
	case askTime:
		return v.answer(gen, "It's "+v.clockNow().Format("3:04 PM"))
	case askWeather:
		return v.answerWeather(ctx, gen)
	case askArrival, askNextTurn:
		return v.answerRoute(gen, u.what)
	case askBattery:
		return v.answerBattery(gen)
	case doAlbum, doArtist:
		return v.playFromCurrent(ctx, gen, u.what)
	case doOtherOne:
		alt, ok := v.memory.nextOther()
		if !ok {
			return v.fail(gen, "I don't have another match for that")
		}
		return v.playUri(ctx, gen, alt.uri, alt.label)
	case doRestart:
		if _, err := v.app.server.Submit(ctx, ApiRequestTypeSeek, ApiRequestDataSeek{Position: 0}); err != nil {
			return v.fail(gen, "Couldn't start it over")
		}
		v.flash(gen, "done", "From the top")
		return "restart", nil
	case doDriveStart, doDriveStop:
		return v.driveMode(ctx, gen, u.what == doDriveStart)
	case doNight:
		mode := u.arg
		if mode != "on" && mode != "off" && mode != "auto" {
			mode = "on"
		}
		return v.setSettings(gen, map[string]any{"nightMode": mode}, map[string]string{
			"on": "Night mode on", "off": "Night mode off", "auto": "Night mode at sunset",
		}[mode])
	case doBrighter, doDimmer:
		return v.stepBrightness(gen, u.what == doBrighter)
	case doAutoBright:
		on := u.arg != "off"
		msg := "Auto brightness on"
		if !on {
			msg = "Auto brightness off"
		}
		return v.setSettings(gen, map[string]any{"autoBrightness": on}, msg)
	case doLyrics:
		on := u.arg != "off"
		msg := "Showing lyrics"
		if !on {
			msg = "Lyrics hidden"
		}
		return v.setSettings(gen, map[string]any{"showLyrics": on}, msg)
	case doNavigate:
		return v.navigateTo(ctx, gen, u.arg)
	case doJamStart:
		if v.app.jam == nil {
			return v.fail(gen, "That isn't available here")
		}
		v.app.jam.Start()
		return v.answer(gen, "Passengers can scan the code on the screen")
	case doJamStop:
		if v.app.jam == nil || !v.app.jam.State().Active {
			return v.answer(gen, "Passengers aren't picking right now")
		}
		v.app.jam.Stop()
		return v.answer(gen, "The music's back with you")
	case doNavStop:
		if v.app.nav != nil && v.app.nav.own.Active() {
			v.app.nav.own.Stop()
			return v.answer(gen, "Directions stopped")
		}
		return v.answer(gen, "Wisp isn't giving directions right now")
	case doCall:
		return v.callContact(ctx, gen, u.arg)
	case doMood:
		return v.playMood(ctx, gen, u.arg)
	}
	return v.fail(gen, "Sorry, I didn't catch that")
}

// answer shows a reply and has it spoken
func (v *voiceService) answer(gen uint64, text string) (string, error) {
	v.emit("answer", text)
	v.scheduleIdle(gen, 6*time.Second)
	return text, nil
}

func (v *voiceService) fail(gen uint64, text string) (string, error) {
	v.flash(gen, "error", text)
	return "", errors.New("voice: " + text)
}

// nowPlaying reads the observer's status: what's on, by whom, from which album
func (v *voiceService) nowPlaying(ctx context.Context) (map[string]any, bool) {
	res, err := v.app.server.Submit(ctx, ApiRequestTypeObserverStatus, nil)
	if err != nil {
		return nil, false
	}
	m, ok := res.(map[string]any)
	if !ok || m["active"] != true {
		return nil, false
	}
	return m, true
}

func statusStr(m map[string]any, k string) string {
	s, _ := m[k].(string)
	return strings.TrimSpace(s)
}

func (v *voiceService) answerNowPlaying(ctx context.Context, gen uint64, what string) (string, error) {
	m, ok := v.nowPlaying(ctx)
	name := statusStr(m, "track_name")
	if !ok || name == "" {
		return v.answer(gen, "Nothing's playing right now")
	}
	artist, album := statusStr(m, "track_artist"), statusStr(m, "track_album")
	switch what {
	case askArtist:
		if artist == "" {
			return v.answer(gen, "I'm not sure who this is")
		}
		return v.answer(gen, "This is "+artist)
	case askAlbum:
		if album == "" {
			return v.answer(gen, "I'm not sure which album this is")
		}
		return v.answer(gen, "It's from "+album)
	}
	if artist != "" {
		return v.answer(gen, fmt.Sprintf("This is %s, by %s", name, artist))
	}
	return v.answer(gen, "This is "+name)
}

// clockNow is the time where the phone is (the Car Thing itself runs on UTC)
func (v *voiceService) clockNow() time.Time {
	now := time.Now().UTC()
	if off := v.app.utcOffsetMin(); off != nil {
		return now.In(time.FixedZone("phone", *off*60))
	}
	return now
}

func (v *voiceService) answerWeather(ctx context.Context, gen uint64) (string, error) {
	if v.app.nav == nil {
		return v.answer(gen, "I need the Wisp app on your phone for the weather")
	}
	loc := v.app.nav.Status().Location
	if loc == nil {
		return v.answer(gen, "I need your phone's location for the weather")
	}
	unit := "F"
	var s struct {
		TempUnit string `json:"tempUnit"`
	}
	if json.Unmarshal(v.app.GetSettings(), &s) == nil && s.TempUnit == "C" {
		unit = "C"
	}
	wx, err := v.weather.get(ctx, loc.Lat, loc.Lng, unit)
	if err != nil || wx == nil {
		return v.answer(gen, "I couldn't get the weather right now")
	}
	return v.answer(gen, fmt.Sprintf("It's %d degrees and %s", int(math.Round(wx.Temp)), strings.ToLower(wx.Summary)))
}

// the arrival line Google Maps shows, e.g. "12 min · 5.1 mi · 3:45 PM"
var etaParts = regexp.MustCompile(`\s*[·•]\s*`)
var clockTime = regexp.MustCompile(`^\d{1,2}:\d{2}$`)

func (v *voiceService) answerRoute(gen uint64, what string) (string, error) {
	if v.app.nav == nil {
		return v.answer(gen, "I need the Wisp app on your phone for directions")
	}
	st := v.app.nav.Status()
	if !st.Active {
		return v.answer(gen, "You're not navigating right now")
	}
	if what == askNextTurn {
		turn := strings.TrimSpace(st.Text)
		if turn == "" {
			return v.answer(gen, "I don't have the next turn yet")
		}
		if d := strings.TrimSpace(st.Title); d != "" {
			return v.answer(gen, fmt.Sprintf("In %s, %s", d, lowerFirst(turn)))
		}
		return v.answer(gen, turn)
	}
	return v.answer(gen, arrivalSentence(st.SubText))
}

// arrivalSentence: "12 min · 5.1 mi · 3:45 PM" -> "12 minutes to go, 5.1 miles. You'll get there at 3:45 PM"
func arrivalSentence(sub string) string {
	parts := etaParts.Split(strings.TrimSpace(sub), -1)
	var left, dist, at string
	for _, p := range parts {
		p = strings.TrimSpace(p)
		switch {
		case p == "":
		case strings.Contains(p, "AM") || strings.Contains(p, "PM") || clockTime.MatchString(p):
			at = p
		case strings.HasSuffix(p, " mi") || strings.HasSuffix(p, " km") || strings.HasSuffix(p, " ft") || strings.HasSuffix(p, " m"):
			dist = p
		case strings.Contains(p, "min") || strings.Contains(p, "hr") || strings.Contains(p, "h "):
			left = p
		}
	}
	if left == "" && at == "" {
		return "I don't have an arrival time yet"
	}
	r := strings.NewReplacer(" min", " minutes", " hr", " hours", " mi", " miles", " km", " kilometers")
	var b strings.Builder
	if left != "" {
		b.WriteString(singular(r.Replace(left)) + " to go")
		if dist != "" {
			b.WriteString(", " + singular(r.Replace(dist)))
		}
	}
	if at != "" {
		if b.Len() > 0 {
			b.WriteString(". ")
		}
		b.WriteString("You'll get there at " + at)
	}
	return b.String()
}

// singular fixes "1 hours" (but not "11 hours")
func singular(s string) string {
	words := strings.Fields(s)
	for i := 0; i+1 < len(words); i++ {
		if words[i] == "1" {
			words[i+1] = strings.TrimSuffix(words[i+1], "s")
		}
	}
	return strings.Join(words, " ")
}

func lowerFirst(s string) string {
	if s == "" {
		return s
	}
	return strings.ToLower(s[:1]) + s[1:]
}

func (v *voiceService) answerBattery(gen uint64) (string, error) {
	if v.app.nav == nil {
		return v.answer(gen, "Your phone isn't connected")
	}
	b := v.app.nav.Battery()
	if !b.Known {
		return v.answer(gen, "Your phone isn't connected")
	}
	if b.Charging {
		return v.answer(gen, fmt.Sprintf("Your phone is at %d percent and charging", b.Level))
	}
	return v.answer(gen, fmt.Sprintf("Your phone is at %d percent", b.Level))
}

// playFromCurrent plays the album or the artist of what's on
func (v *voiceService) playFromCurrent(ctx context.Context, gen uint64, what string) (string, error) {
	m, ok := v.nowPlaying(ctx)
	if !ok || statusStr(m, "track_name") == "" {
		return v.fail(gen, "Nothing's playing to go from")
	}
	meta, _ := m["raw_metadata"].(map[string]string)
	artist, album := statusStr(m, "track_artist"), statusStr(m, "track_album")
	uri, label, kind := "", "", ""
	if what == doAlbum {
		uri, label, kind = meta["album_uri"], album, "album"
	} else {
		uri, label, kind = meta["artist_uri"], artist, "artist"
	}
	if uri == "" {
		// not in what Spotify sent: find it by name
		q := label
		if what == doAlbum && artist != "" {
			q = album + " " + artist
		}
		if strings.TrimSpace(q) == "" {
			return v.fail(gen, "I couldn't tell which "+kind+" this is")
		}
		res, err := v.app.server.Submit(ctx, ApiRequestTypeSearch, ApiRequestDataSearch{Query: q, TopN: true, Kind: kind})
		tracks, _ := res.([]searchTrackResult)
		if err != nil || len(tracks) == 0 || tracks[0].Uri == "" {
			return v.fail(gen, "Couldn't find the "+kind)
		}
		uri = tracks[0].Uri
	}
	return v.playUri(ctx, gen, uri, label)
}

// playMood plays Spotify's top playlist for a mood ("chill" -> "chill mix")
func (v *voiceService) playMood(ctx context.Context, gen uint64, mood string) (string, error) {
	v.emit("thinking", "")
	res, err := v.app.server.Submit(ctx, ApiRequestTypeSearch, ApiRequestDataSearch{Query: mood + " mix", TopN: true, Kind: "playlist"})
	lists, _ := res.([]searchTrackResult)
	if err != nil || len(lists) == 0 || lists[0].Uri == "" {
		return v.fail(gen, "Couldn't find something "+mood)
	}
	v.memory.remember(voiceTurn{uri: lists[0].Uri, label: lists[0].Name})
	return v.playUri(ctx, gen, lists[0].Uri, lists[0].Name)
}

func (v *voiceService) driveMode(ctx context.Context, gen uint64, start bool) (string, error) {
	if v.app.nav == nil {
		return v.fail(gen, "Drive Mode needs the Wisp app on your phone")
	}
	action, genre, msg := "stop", "", "Drive Mode off"
	if start {
		action, genre, msg = "start", v.lastDriveGenre(), "Starting Drive Mode"
	}
	if err := v.app.nav.DriveCommand(ctx, action, genre); err != nil {
		if errors.Is(err, ErrNoNavPhone) {
			return v.fail(gen, "Drive Mode needs the Wisp app on your phone")
		}
		return v.fail(gen, "Couldn't change Drive Mode")
	}
	v.flash(gen, "done", msg)
	return action, nil
}

// the sound Drive Mode last played, else Ethereal
func (v *voiceService) lastDriveGenre() string {
	var st struct {
		Genre string `json:"genre"`
	}
	if raw := v.app.nav.DriveState(); len(raw) > 0 && json.Unmarshal(raw, &st) == nil && driveGenres[st.Genre] {
		return st.Genre
	}
	return "ethereal"
}

// setSettings changes the Car Thing's own settings as Settings would
func (v *voiceService) setSettings(gen uint64, patch map[string]any, done string) (string, error) {
	b, _ := json.Marshal(patch)
	merged, _, err := mergeRemoteSettings(v.app.GetSettings(), b)
	if err != nil || merged == nil {
		return v.fail(gen, "Couldn't change that")
	}
	if err := v.app.PutSettings(merged); err != nil {
		return v.fail(gen, "Couldn't change that")
	}
	v.app.server.Emit(&ApiEvent{Type: ApiEventTypeSettingsChanged})
	v.flash(gen, "done", done)
	return done, nil
}

func (v *voiceService) stepBrightness(gen uint64, up bool) (string, error) {
	var s struct {
		Brightness *float64 `json:"brightness"`
	}
	_ = json.Unmarshal(v.app.GetSettings(), &s)
	cur := 6.0
	if s.Brightness != nil {
		cur = *s.Brightness
	}
	next, msg := cur+2, "Brighter"
	if !up {
		next, msg = cur-2, "Dimmer"
	}
	next = math.Max(1, math.Min(10, next))
	return v.setSettings(gen, map[string]any{"autoBrightness": false, "brightness": next}, msg)
}

func (v *voiceService) navigateTo(ctx context.Context, gen uint64, where string) (string, error) {
	if v.app.nav == nil {
		return v.fail(gen, "Directions need the Wisp app on your phone")
	}
	// Wisp's own directions when Settings says so; "home" is only the phone's to know
	if ownNavFromSettings(v.app.GetSettings()) && !strings.EqualFold(strings.TrimSpace(where), "home") {
		v.emit("thinking", "")
		name, err := v.app.nav.own.Start(ctx, where)
		switch {
		case err == nil:
			return v.answer(gen, "Directions to "+name)
		case errors.Is(err, ErrOwnNavNotFound):
			return v.fail(gen, "I couldn't find "+where)
		}
		v.app.log.Warnf("voice: Wisp's directions failed, asking the phone: %v", err)
	}
	if err := v.app.nav.Navigate(ctx, where); err != nil {
		return v.fail(gen, "Directions need the Wisp app on your phone")
	}
	// the phone answers with how it went ("Directions to home")
	v.emit("thinking", "")
	v.scheduleIdle(gen, 8*time.Second)
	return where, nil
}

func (v *voiceService) callContact(ctx context.Context, gen uint64, who string) (string, error) {
	if v.app.nav == nil {
		return v.fail(gen, "Calls need the Wisp app on your phone")
	}
	if err := v.app.nav.PlaceCall(ctx, who); err != nil {
		return v.fail(gen, "Calls need the Wisp app on your phone")
	}
	// the phone answers with who it's calling, or that it couldn't
	v.emit("thinking", "")
	v.scheduleIdle(gen, 8*time.Second)
	return who, nil
}

// ---------------------------------------------------------------- the phone's part

// Navigate asks the phone to start directions in its maps app
func (n *navRelay) Navigate(ctx context.Context, to string) error {
	return n.sendSimple(ctx, map[string]string{"type": "navigate", "to": clipRunes(to, 120)})
}

// PlaceCall asks the phone to call one of its contacts, by name
func (n *navRelay) PlaceCall(ctx context.Context, who string) error {
	return n.sendSimple(ctx, map[string]string{"type": "place_call", "who": clipRunes(who, 60)})
}

func (n *navRelay) sendSimple(ctx context.Context, m map[string]string) error {
	n.mu.Lock()
	c := n.conn
	n.mu.Unlock()
	if c == nil {
		return ErrNoNavPhone
	}
	b, _ := json.Marshal(m)
	return c.Write(ctx, websocket.MessageText, b)
}
