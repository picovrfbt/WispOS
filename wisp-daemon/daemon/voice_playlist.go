package daemon

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"regexp"
	"strings"
	"time"
)

// "Add this to my road trip playlist": the song playing, into one of your
// playlists by name. Spotify's when Spotify is playing (matched against the
// playlists the voice catalog knows, by sound); YouTube Music's when that's
// playing on the phone (the companion app finds the playlist and adds it).

const ApiRequestTypeAddToPlaylist ApiRequestType = "add_to_playlist"

type ApiRequestDataAddToPlaylist struct {
	PlaylistUri string
}

var addToPlaylistRe = regexp.MustCompile(
	`^(?:hey wisp |wisp )?(?:please )?(?:add|put|save|stick)\s+(?:this|this song|this track|the song|that|it|this one)\s+(?:to|in|into|on|onto)\s+(?:my\s+|the\s+)?(.+?)(?:\s+playlist)?(?: please)?$`)

// Liked Songs is "like this", a control of its own; the queue is queueing
var likedNames = map[string]bool{
	"liked songs": true, "liked": true, "likes": true, "favorites": true, "favourites": true,
	"liked music": true, "library": true,
	// and the queue is the queue
	"queue": true, "up next": true, "next": true,
}

// parseAddToPlaylist reads the playlist's name out of "add this to my X playlist"
func parseAddToPlaylist(transcript string) (string, bool) {
	t := strings.Join(strings.Fields(voiceNonWord.ReplaceAllString(strings.ToLower(transcript), " ")), " ")
	m := addToPlaylistRe.FindStringSubmatch(t)
	if m == nil {
		return "", false
	}
	name := strings.TrimSpace(m[1])
	if name == "" || likedNames[name] {
		return "", false
	}
	return name, true
}

// addToPlaylist adds the playing song to the playlist named, on the service playing it
func (v *voiceService) addToPlaylist(ctx context.Context, gen uint64, name string) (string, error) {
	v.emit("thinking", "")
	// YouTube Music playing on the phone (and Spotify not): its playlist
	if nav := v.app.nav; nav != nil && !v.app.playing.Load() {
		m := nav.Media()
		if svc := serviceOfApp(m.App); m.Present && m.Playing && svc != "" {
			actx, cancel := context.WithTimeout(ctx, 20*time.Second)
			defer cancel()
			r, err := nav.askPhone(actx, map[string]any{
				"type": "svc_add", "service": svc, "title": m.Title, "artist": m.Artist,
				"app": m.App, "playlist": name,
			})
			if err != nil {
				v.flash(gen, "error", clipRunes(err.Error(), 60))
				return "", err
			}
			added := r.Current
			if added == "" {
				added = name
			}
			v.flash(gen, "done", "Added to "+added)
			return added, nil
		}
	}

	if v.resolver == nil || v.resolver.index() == nil {
		v.flash(gen, "error", "Still learning your playlists")
		return "", errors.New("voice: no catalog yet")
	}
	pick := v.resolver.matchSimple(ctx, v.resolver.index().Playlists, name, "playlist")
	if pick == nil || pick.score > v.resolver.floorFor(pick) {
		v.flash(gen, "error", fmt.Sprintf("Couldn't find a playlist called “%s”", name))
		return "", fmt.Errorf("voice: no playlist like %q", name)
	}
	if _, err := v.app.server.Submit(ctx, ApiRequestTypeAddToPlaylist, ApiRequestDataAddToPlaylist{PlaylistUri: pick.uri}); err != nil {
		msg := "Couldn't add to " + pick.name
		switch {
		case errors.Is(err, ErrNotFound):
			msg = "Nothing to add right now"
		case errors.Is(err, ErrForbidden):
			msg = "You can't add to " + pick.name
		}
		v.flash(gen, "error", msg)
		return "", err
	}
	v.app.log.Infof("voice: added the playing song to %s (%s)", pick.name, pick.uri)
	v.flash(gen, "done", "Added to "+pick.name)
	return pick.name, nil
}

// addCurrentToPlaylist puts the song playing on Spotify at the end of a playlist
func (p *AppPlayer) addCurrentToPlaylist(ctx context.Context, playlistUri string) (any, error) {
	rs := p.state.remoteState
	if rs == nil || !strings.HasPrefix(rs.TrackUri, "spotify:track:") {
		return nil, ErrNotFound
	}
	id, ok := strings.CutPrefix(playlistUri, "spotify:playlist:")
	if !ok || id == "" {
		return nil, ErrBadRequest
	}
	resp, err := p.sess.WebApi(ctx, "POST", "v1/playlists/"+url.PathEscape(id)+"/tracks",
		url.Values{"uris": {rs.TrackUri}}, nil, nil)
	if err != nil {
		return nil, err
	}
	defer func() { _ = resp.Body.Close() }()
	switch resp.StatusCode {
	case 200, 201:
	case 403:
		// someone else's playlist, not shared for editing
		return nil, ErrForbidden
	case 404:
		return nil, ErrNotFound
	default:
		return nil, fmt.Errorf("add to playlist: %s", resp.Status)
	}
	var out struct {
		SnapshotId string `json:"snapshot_id"`
	}
	_ = json.NewDecoder(resp.Body).Decode(&out)
	return map[string]any{"uri": rs.TrackUri, "name": rs.TrackName}, nil
}

// ApiRequestTypeCreatePlaylist makes a private playlist in your Spotify library
// with these songs (data ApiRequestDataCreatePlaylist), answering its uri
const ApiRequestTypeCreatePlaylist ApiRequestType = "create_playlist"

type ApiRequestDataCreatePlaylist struct {
	Name        string
	Description string
	Uris        []string
}

func (p *AppPlayer) createPlaylist(ctx context.Context, d ApiRequestDataCreatePlaylist) (string, error) {
	user := p.sess.Username()
	if user == "" || d.Name == "" || len(d.Uris) == 0 {
		return "", ErrBadRequest
	}
	body, _ := json.Marshal(map[string]any{"name": d.Name, "description": d.Description, "public": false})
	hdr := http.Header{"Content-Type": {"application/json"}}
	resp, err := p.sess.WebApi(ctx, "POST", "v1/users/"+url.PathEscape(user)+"/playlists", nil, hdr, body)
	if err != nil {
		return "", err
	}
	var made struct {
		Id  string `json:"id"`
		Uri string `json:"uri"`
	}
	err = json.NewDecoder(io.LimitReader(resp.Body, 1<<20)).Decode(&made)
	_ = resp.Body.Close()
	if resp.StatusCode != 200 && resp.StatusCode != 201 {
		return "", fmt.Errorf("create playlist: %s", resp.Status)
	}
	if err != nil || made.Id == "" {
		return "", errors.New("create playlist: no playlist in the answer")
	}
	// a hundred songs a request
	for i := 0; i < len(d.Uris); i += 100 {
		part := d.Uris[i:min(i+100, len(d.Uris))]
		b, _ := json.Marshal(map[string]any{"uris": part})
		resp, err := p.sess.WebApi(ctx, "POST", "v1/playlists/"+url.PathEscape(made.Id)+"/tracks", nil, hdr, b)
		if err != nil {
			return "", err
		}
		_ = resp.Body.Close()
		if resp.StatusCode != 200 && resp.StatusCode != 201 {
			return "", fmt.Errorf("add to the new playlist: %s", resp.Status)
		}
	}
	if made.Uri == "" {
		made.Uri = "spotify:playlist:" + made.Id
	}
	return made.Uri, nil
}
