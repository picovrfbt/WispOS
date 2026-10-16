package daemon

import (
	"context"
	"encoding/json"
	"fmt"
	"regexp"
	"strings"
	"time"
)

// "Play X on YouTube Music" / "on SoundCloud": the other music services by
// voice. Spotify stays the default; naming a service sends the search to the
// phone (phone_services.go), which plays the best match in that app.

// serviceVoiceRequest is what was asked of a music service by voice
type serviceVoiceRequest struct {
	Service string
	// song | album | artist | playlist
	Kind  string
	Query string
}

var (
	// the play verbs, the words, and the service, which must close the sentence
	serviceVoiceRe = regexp.MustCompile(
		`^(?:hey wisp |wisp )?(?:please )?(?:play|put on|listen to|start|shuffle)\s+(.+?)\s+(?:on|from|in|using|with|off)\s+(youtube music|you tube music|yt music|y t music|youtube|you tube|soundcloud|sound cloud)(?: please)?$`)
	serviceVoiceNames = map[string]string{
		"youtube music": "ytmusic", "you tube music": "ytmusic", "yt music": "ytmusic", "y t music": "ytmusic",
		"youtube": "ytmusic", "you tube": "ytmusic",
		"soundcloud": "soundcloud", "sound cloud": "soundcloud",
	}
	serviceVoiceLabel = map[string]string{"ytmusic": "YouTube Music", "soundcloud": "SoundCloud"}
)

func parseServiceVoice(transcript string) (serviceVoiceRequest, bool) {
	t := strings.Join(strings.Fields(voiceNonWord.ReplaceAllString(strings.ToLower(transcript), " ")), " ")
	m := serviceVoiceRe.FindStringSubmatch(t)
	if m == nil {
		return serviceVoiceRequest{}, false
	}
	words := strings.Fields(m[1])
	kind := "song"
	// "the album X", "my playlist X", "the artist X", "songs by X", "some X"
loop:
	for len(words) > 0 {
		w := words[0]
		switch {
		case w == "the" || w == "a" || w == "my":
		case w == "some":
			kind = "artist"
		case w == "album" || w == "record":
			kind = "album"
		case w == "playlist":
			kind = "playlist"
		case w == "artist" || w == "band":
			kind = "artist"
		case w == "song" || w == "track":
			kind = "song"
		case (w == "songs" || w == "music" || w == "tracks") && len(words) > 1 && words[1] == "by":
			kind = "artist"
			words = words[1:]
		default:
			break loop
		}
		words = words[1:]
	}
	// "X by Y" searches better as "X Y"
	q := strings.TrimSpace(strings.ReplaceAll(" "+strings.Join(words, " ")+" ", " by ", " "))
	if q == "" {
		return serviceVoiceRequest{}, false
	}
	return serviceVoiceRequest{Service: serviceVoiceNames[m[2]], Kind: kind, Query: q}, true
}

// playOnService searches the service on the phone and plays the best match there
func (v *voiceService) playOnService(ctx context.Context, gen uint64, req serviceVoiceRequest) (string, error) {
	name := serviceVoiceLabel[req.Service]
	nav := v.app.nav
	if nav == nil || !nav.Status().Connected {
		v.flash(gen, "error", "Your phone isn't connected")
		return "", ErrNoNavPhone
	}
	known := false
	for _, s := range nav.Status().Services {
		if s.Id == req.Service && s.Enabled {
			known = true
		}
	}
	if !known {
		v.flash(gen, "error", fmt.Sprintf("%s isn't set up on your phone", name))
		return "", fmt.Errorf("voice: %s not on the phone", req.Service)
	}
	v.emit("thinking", "")
	sctx, cancel := context.WithTimeout(ctx, 20*time.Second)
	defer cancel()
	raw, err := nav.ServiceBrowse(sctx, req.Service, "search:"+req.Kind+":"+req.Query)
	if err != nil {
		v.app.log.WithError(err).Warnf("voice: %s search failed", req.Service)
		v.flash(gen, "error", fmt.Sprintf("Couldn't search %s", name))
		return "", err
	}
	pick, ok := firstPlayable(raw)
	if !ok && req.Kind == "artist" {
		// an artist with no play button of its own: their page's first song
		var items []serviceVoiceItem
		_ = json.Unmarshal(raw, &items)
		if len(items) > 0 && items[0].Id != "" {
			if page, err := nav.ServiceBrowse(sctx, req.Service, items[0].Id); err == nil {
				pick, ok = firstPlayable(page)
				pick.Name = items[0].Name
			}
		}
	}
	if !ok {
		v.flash(gen, "error", fmt.Sprintf("Couldn't find “%s” on %s", req.Query, name))
		return "", fmt.Errorf("voice: nothing playable for %q on %s", req.Query, req.Service)
	}
	label := pick.Name
	if sub := strings.TrimSpace(strings.Split(pick.Sub, " · ")[0]); sub != "" && req.Kind == "song" {
		label = pick.Name + " - " + sub
	}
	if err := nav.ServicePlay(ctx, req.Service, pick.Playlist, pick.Video, pick.Name); err != nil {
		v.flash(gen, "error", "Couldn't start playback")
		return label, err
	}
	v.app.log.Infof("voice: playing %s on %s", label, name)
	v.emit("playing", label)
	v.scheduleIdle(gen, 5*time.Second)
	return label, nil
}

type serviceVoiceItem struct {
	Name     string `json:"name"`
	Sub      string `json:"sub"`
	Id       string `json:"id"`
	Playlist string `json:"playlist"`
	Video    string `json:"video"`
}

func firstPlayable(raw json.RawMessage) (serviceVoiceItem, bool) {
	var items []serviceVoiceItem
	if json.Unmarshal(raw, &items) != nil {
		return serviceVoiceItem{}, false
	}
	for _, it := range items {
		if it.Playlist != "" || it.Video != "" {
			return it, true
		}
	}
	return serviceVoiceItem{}, false
}
