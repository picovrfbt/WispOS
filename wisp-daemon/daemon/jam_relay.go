package daemon

import (
	"context"
	"encoding/json"
	"io"
	"net/http"
	"strings"
	"time"
)

// Which relay passengers' messages go through. Wisp's own (relay/ in the repo,
// on Cloudflare's free tier) when it's up, else ntfy.sh, whose free tier
// allows 250 messages a day from each address. The list comes from Wisp's
// website (docs/relay.json), so the relay can move without an update; it's
// checked in the background, so starting a session never waits on it, and a
// session keeps the relay it started on.

const (
	jamRelayList  = "https://picovrfbt.github.io/WispOS/relay.json"
	jamRelayEvery = 30 * time.Minute
)

// watchRelays keeps j.chosen on the first relay that answers, until ctx ends
func (j *jamService) watchRelays(ctx context.Context) {
	select {
	case <-ctx.Done():
		return
	case <-time.After(20 * time.Second): // after start-up's own network work
	}
	for {
		j.pickRelay(ctx, jamRelayList)
		select {
		case <-ctx.Done():
			return
		case <-time.After(jamRelayEvery):
		}
	}
}

func (j *jamService) pickRelay(ctx context.Context, list string) {
	pick := ""
	for _, r := range append(j.relayList(ctx, list), jamDefaultServer) {
		if j.relayHealthy(ctx, r) {
			pick = r
			break
		}
	}
	j.rmu.Lock()
	changed := pick != j.chosen
	j.chosen = pick
	j.rmu.Unlock()
	if changed && pick != "" {
		j.app.log.Infof("jam: passengers' messages go through %s", pick)
	}
}

// relayList: the relays the website names, https only
func (j *jamService) relayList(ctx context.Context, list string) []string {
	ctx, cancel := context.WithTimeout(ctx, 10*time.Second)
	defer cancel()
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, list, nil)
	if err != nil {
		return nil
	}
	resp, err := j.client.Do(req)
	if err != nil {
		return nil
	}
	defer func() { _ = resp.Body.Close() }()
	var body struct {
		Relays []string `json:"relays"`
	}
	if resp.StatusCode != http.StatusOK || json.NewDecoder(io.LimitReader(resp.Body, 16<<10)).Decode(&body) != nil {
		return nil
	}
	var out []string
	for _, r := range body.Relays {
		r = strings.TrimRight(strings.TrimSpace(r), "/")
		// a relay is a site's root: the passengers' link carries only its host
		if host, ok := strings.CutPrefix(r, "https://"); ok && len(r) < 200 && host != "" && !strings.ContainsAny(host, " /?#@") {
			out = append(out, r)
		}
	}
	return out
}

func (j *jamService) relayHealthy(ctx context.Context, base string) bool {
	ctx, cancel := context.WithTimeout(ctx, 5*time.Second)
	defer cancel()
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, base+"/v1/health", nil)
	if err != nil {
		return false
	}
	req.Header.Set("User-Agent", ownNavUA)
	resp, err := j.client.Do(req)
	if err != nil {
		return false
	}
	_ = resp.Body.Close()
	return resp.StatusCode == http.StatusOK
}
