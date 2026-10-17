package daemon

import (
	"context"
	"encoding/json"
	"errors"
	"strings"
	"time"

	"github.com/coder/websocket"
)

// Thinking on the phone: what the Car Thing's own rules don't understand goes
// to a language model on the phone (Gemini Nano through Android's AICore, or a
// downloaded open model), with a little context. It answers with one action
// from a fixed list and a short reply; the Car Thing checks the action and
// carries it out itself, so the model can't do anything a voice command
// couldn't. Nothing runs on the Car Thing for this but the message.

// how long a thought may take before Wisp gives up on it
const thinkTimeout = 8 * time.Second

// ThinkStatus is how ready the phone's model is
type ThinkStatus struct {
	// ready | downloading | unavailable | off
	State string `json:"state"`
	// which model: "nano", "open"
	Model string `json:"model,omitempty"`
}

// thinkContext is what the model is told about the moment
type thinkContext struct {
	NowPlaying string `json:"now_playing,omitempty"`
	Paused     bool   `json:"paused,omitempty"`
	LastAction string `json:"last_action,omitempty"`
	Navigating string `json:"navigating,omitempty"`
	LocalTime  string `json:"local_time,omitempty"`
}

// thinkAction is the model's answer, checked before anything happens
type thinkAction struct {
	Action string `json:"action"`
	Query  string `json:"query"`
	Kind   string `json:"kind"`
	Say    string `json:"say"`
	Error  string `json:"error"`
}

// what the model may ask for
var thinkActions = map[string]bool{
	"play": true, "queue": true, "pause": true, "resume": true, "next": true, "previous": true,
	"volume_up": true, "volume_down": true, "like": true, "answer": true, "navigate": true,
	"call": true, "drive_start": true, "drive_stop": true, "night_on": true, "night_off": true,
	"brighter": true, "dimmer": true, "restart": true, "none": true,
}

var thinkKinds = map[string]bool{"": true, "track": true, "artist": true, "album": true, "playlist": true, "mood": true}

func (a thinkAction) valid() bool {
	if !thinkActions[a.Action] || !thinkKinds[a.Kind] {
		return false
	}
	switch a.Action {
	case "play", "queue", "navigate", "call":
		return strings.TrimSpace(a.Query) != "" && len(a.Query) <= 200
	case "answer":
		return strings.TrimSpace(a.Say) != ""
	}
	return true
}

func (n *navRelay) ThinkStatus() ThinkStatus {
	n.mu.Lock()
	defer n.mu.Unlock()
	if n.conn == nil || n.think.State == "" {
		return ThinkStatus{State: "off"}
	}
	return n.think
}

func (n *navRelay) applyThinkStatus(s ThinkStatus) {
	switch s.State {
	case "ready", "downloading", "unavailable":
	default:
		s.State = "unavailable"
	}
	n.mu.Lock()
	n.think = s
	n.mu.Unlock()
}

// Think asks the phone's model what was meant
func (n *navRelay) Think(ctx context.Context, text string, tc thinkContext) (thinkAction, error) {
	n.mu.Lock()
	c := n.conn
	if c == nil || n.think.State != "ready" {
		n.mu.Unlock()
		return thinkAction{}, ErrNoNavPhone
	}
	n.thinkSeq++
	id := n.thinkSeq
	ch := make(chan thinkAction, 1)
	if n.thinkWaiting == nil {
		n.thinkWaiting = map[int]chan thinkAction{}
	}
	n.thinkWaiting[id] = ch
	n.mu.Unlock()
	defer func() {
		n.mu.Lock()
		delete(n.thinkWaiting, id)
		n.mu.Unlock()
	}()

	msg, _ := json.Marshal(map[string]any{"type": "think", "id": id, "text": clipRunes(text, 300), "context": tc})
	if err := c.Write(ctx, websocket.MessageText, msg); err != nil {
		return thinkAction{}, err
	}
	select {
	case a := <-ch:
		if a.Error != "" {
			return thinkAction{}, errors.New(a.Error)
		}
		if !a.valid() {
			return thinkAction{}, errors.New("the phone's answer wasn't something Wisp can do")
		}
		a.Say = clipRunes(strings.TrimSpace(a.Say), 200)
		return a, nil
	case <-ctx.Done():
		return thinkAction{}, ctx.Err()
	case <-time.After(thinkTimeout):
		return thinkAction{}, errors.New("the phone took too long")
	}
}

func (n *navRelay) deliverThink(id int, a thinkAction) {
	n.mu.Lock()
	ch := n.thinkWaiting[id]
	n.mu.Unlock()
	if ch != nil {
		select {
		case ch <- a:
		default:
		}
	}
}

// ---------------------------------------------------------------- the voice side

// the verbs Wisp's own rules and library matcher handle well; a request that
// starts with one of these goes there first, anything else to the phone
var commandLeads = map[string]bool{
	"play": true, "queue": true, "pause": true, "resume": true, "next": true, "skip": true,
	"previous": true, "back": true, "like": true, "turn": true, "volume": true, "stop": true,
	"add": true, "save": true, "love": true, "go": true,
}

func looksLikeCommand(t string) bool {
	f := strings.Fields(t)
	return len(f) > 0 && commandLeads[f[0]]
}

// phoneCanThink: the phone's model is there to ask
func (v *voiceService) phoneCanThink() bool {
	return v.app.nav != nil && v.app.nav.ThinkStatus().State == "ready"
}

// thinkContextNow gathers the moment for the model
func (v *voiceService) thinkContextNow(ctx context.Context) thinkContext {
	tc := thinkContext{LocalTime: v.clockNow().Format("Mon 3:04 PM")}
	if m, ok := v.nowPlaying(ctx); ok {
		if name := statusStr(m, "track_name"); name != "" {
			tc.NowPlaying = name
			if a := statusStr(m, "track_artist"); a != "" {
				tc.NowPlaying += " by " + a
			}
			tc.Paused = m["is_paused"] == true
		}
	}
	if t, ok := v.memory.recent(); ok {
		tc.LastAction = "played " + t.label
	}
	if st := v.app.nav.Status(); st.Active {
		tc.Navigating = strings.TrimSpace(st.SubText)
	}
	return tc
}

// thinkOnPhone asks the phone and carries out what comes back; false when the
// phone couldn't help, so the caller goes on as before
func (v *voiceService) thinkOnPhone(ctx context.Context, gen uint64, transcript string) (string, error, bool) {
	start := time.Now()
	a, err := v.app.nav.Think(ctx, transcript, v.thinkContextNow(ctx))
	if err != nil {
		v.app.log.Infof("voice: the phone couldn't help with %q: %v", transcript, err)
		return "", nil, false
	}
	v.app.log.Infof("voice: the phone took %q as %s %s %q in %s", transcript, a.Action, a.Kind, a.Query, time.Since(start).Round(time.Millisecond))
	out, err := v.doThought(ctx, gen, a)
	return out, err, true
}

func (v *voiceService) doThought(ctx context.Context, gen uint64, a thinkAction) (string, error) {
	switch a.Action {
	case "answer":
		return v.answer(gen, a.Say)
	case "none":
		if a.Say != "" {
			return v.fail(gen, a.Say)
		}
		return v.fail(gen, "Sorry, I didn't catch that")
	case "play", "queue":
		return v.playThought(ctx, gen, a)
	case "pause", "resume", "next", "like":
		return v.handleControl(ctx, gen, a.Action)
	case "previous":
		return v.handleControl(ctx, gen, "prev")
	case "volume_up":
		return v.handleControl(ctx, gen, "volup")
	case "volume_down":
		return v.handleControl(ctx, gen, "voldown")
	case "restart":
		return v.handleUnderstood(ctx, gen, understood{what: doRestart})
	case "navigate":
		return v.navigateTo(ctx, gen, a.Query)
	case "call":
		return v.callContact(ctx, gen, a.Query)
	case "drive_start", "drive_stop":
		return v.driveMode(ctx, gen, a.Action == "drive_start")
	case "night_on", "night_off":
		return v.handleUnderstood(ctx, gen, understood{what: doNight, arg: strings.TrimPrefix(a.Action, "night_")})
	case "brighter":
		return v.stepBrightness(gen, true)
	case "dimmer":
		return v.stepBrightness(gen, false)
	}
	return v.fail(gen, "Sorry, I didn't catch that")
}

// playThought finds what the model named on Spotify and plays (or queues) it
func (v *voiceService) playThought(ctx context.Context, gen uint64, a thinkAction) (string, error) {
	if a.Kind == "mood" {
		return v.playMood(ctx, gen, a.Query)
	}
	v.emit("thinking", "")
	kind := a.Kind
	if kind == "track" || a.Action == "queue" {
		kind = ""
	}
	res, err := v.app.server.Submit(ctx, ApiRequestTypeSearch, ApiRequestDataSearch{Query: a.Query, TopN: true, Kind: kind})
	items, _ := res.([]searchTrackResult)
	if err != nil || len(items) == 0 || items[0].Uri == "" {
		return v.fail(gen, "Couldn't find “"+a.Query+"”")
	}
	pick := items[0]
	label := pick.Name
	if pick.Artist != "" {
		label = pick.Name + " - " + pick.Artist
	}
	if a.Action == "queue" {
		return v.handleQueue(ctx, gen, pick.Uri, label)
	}
	var others []voiceAlt
	for _, t := range items[1:] {
		if t.Uri != "" && len(others) < 3 {
			others = append(others, voiceAlt{uri: t.Uri, label: t.Name})
		}
	}
	v.memory.remember(voiceTurn{uri: pick.Uri, label: label, others: others})
	return v.playUri(ctx, gen, pick.Uri, label)
}
