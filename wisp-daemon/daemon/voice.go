package daemon

import (
	"bufio"
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"math"
	"os"
	"os/exec"
	"path/filepath"
	"regexp"
	"strconv"
	"strings"
	"sync"
	"sync/atomic"
	"time"
)

// controls the whole on device voice flow. from the wake word ("okay wisp") -> ASR -> search -> play
type voiceService struct {
	app *App
	cfg VoiceConfig

	ctx    context.Context
	cancel context.CancelFunc

	mu   sync.Mutex
	gen  uint64
	busy bool
	// when the command being handled started (you'd stopped talking), for the timings in the log
	flowStart time.Time
	// stops the command being handled, for a tap off Wisp (Cancel)
	flowCancel context.CancelFunc
	// the command being handled, and one the driver tapped away: what it would
	// still say is dropped (emit)
	activeGen atomic.Uint64
	mutedGen  atomic.Uint64

	// the music lowered or paused on the phone while Wisp listens (hush)
	hushed atomic.Bool
	hushCh chan string

	bannerSeq atomic.Uint64

	// cascade resolver + g2p
	g2p      *g2p
	resolver *cascadeResolver

	// the last command, for follow-ups, and the weather for "what's the weather"
	memory  voiceMemory
	weather *weatherCache
	// what a request means, when the rules miss and no phone model is there (voice_meaning.go)
	meaning *meaningMatcher

	// persistent gigaspeech-Zipformer ASR
	sherpa *sherpaSidecar

	// set while the FIRST catalog sync runs
	firstSyncInProgress atomic.Bool
	syncProgressMu      sync.Mutex
	syncProgress        *catalogProgress

	// wake/mic on-off
	wakeEnabled atomic.Bool
	wakeSignal  chan struct{}
	wakeCancel  atomic.Pointer[context.CancelFunc]
	// the running wake listener, for ListenNow's signal
	wakeProc atomic.Pointer[os.Process]

	// playback-aware wake threshold
	playbackActive atomic.Bool
	thrGen         atomic.Uint64
	runningThr     atomic.Uint64
	thrRestart     atomic.Bool
	capturing      atomic.Bool

	// pathfinder hash rotation
	hashRotateGate atomic.Bool
	lastRotate     atomic.Int64
	hashMu         sync.Mutex
	hashBundle     string
	hashFetchedAt  int64
}

// about 10% up or down
const voiceVolumeStep int32 = MaxStateVolume / 10

func newVoiceService(app *App) *voiceService {
	ctx, cancel := context.WithCancel(context.Background())
	cfg, fixed := healVoicePaths(app.cfg.Voice, voiceShipped.lib, voiceShipped.share)
	for _, f := range fixed {
		app.log.Infof("voice: config from an older Wisp, using what this system ships: %s", f)
	}
	v := &voiceService{app: app, cfg: cfg, ctx: ctx, cancel: cancel, wakeSignal: make(chan struct{}, 1), weather: newWeatherCache(), hushCh: make(chan string, 8)}
	v.wakeEnabled.Store(true)
	return v
}

func (v *voiceService) Start() {
	v.app.log.Infof("voice: service enabled (wake=%v cascade=%v catalog=%v hash_rotate=%v sherpa=%v bin=%s models=%s)",
		v.cfg.Wake, v.cfg.Cascade, v.cfg.CatalogSync, v.cfg.HashRotate, v.cfg.SherpaEnabled, v.cfg.BinDir, v.cfg.ModelDir)
	if v.cfg.Cascade {
		v.startCascade()
	}
	if v.cfg.MeaningDir != "" {
		v.meaning = newMeaningMatcher(v.cfg.MeaningDir, filepath.Join(v.cfg.BinDir, "wisp_meaning_server"), v.loader(), v.cfg.LibDir)
	}
	if v.cfg.SherpaEnabled {
		v.sherpa = newSherpaSidecar(v)
		v.sherpa.start() // loads the model in the background
	}
	if v.cfg.HashRotate {
		v.loadHashCache()
		go v.runHashRotate()
	}
	if v.cfg.Wake {
		v.wakeEnabled.Store(voiceMicFromSettings(v.app.GetSettings()))
		go v.runHush()
		go v.runWakeLoop()
	}
}

func (v *voiceService) cacheDir() string {
	if v.cfg.CacheDir != "" {
		return v.cfg.CacheDir
	}
	return filepath.Join(filepath.Dir(strings.TrimRight(v.cfg.ModelDir, "/")), "cache")
}

func (v *voiceService) espeakDataParent() string {
	if v.cfg.EspeakDataDir != "" {
		return v.cfg.EspeakDataDir
	}
	return defaultEspeakDataParent(v.cfg.BinDir)
}

// g2p + resolver
func (v *voiceService) startCascade() {
	espeakBin := v.cfg.EspeakBin
	if espeakBin == "" {
		espeakBin = "espeak-ng"
	}
	v.g2p = newG2P(v.loader(), v.cfg.LibDir, filepath.Join(v.cfg.BinDir, espeakBin), v.espeakDataParent())
	v.resolver = newCascadeResolver(v.g2p, v.cfg.AcceptThreshold)

	syncer := newCatalogSyncer(
		&playerCatalogFetcher{submit: v.app.server.Submit},
		v.g2p, v.cacheDir(), v.app.log,
		func(idx *routedIndex) {
			v.resolver.setIndex(idx)
			v.app.log.Infof("voice: index published (tracks=%d artists=%d playlists=%d albums=%d)",
				len(idx.Tracks), len(idx.Artists), len(idx.Playlists), len(idx.Albums))
		},
	)
	// an update with the Car Thing to itself gets all the bandwidth
	syncer.hold = func() bool { return v.app.updates != nil && v.app.updates.Focused() }

	syncer.onPersistedDrift = v.triggerHashRotate

	// use any cached index so voice works without a new sync if needed
	hadIndex := false
	if idx, ok := syncer.loadCachedIndex(); ok {
		hadIndex = true
		v.resolver.setIndex(idx)
		v.app.log.Infof("voice: loaded cached phonetic index (tracks=%d artists=%d playlists=%d albums=%d)",
			len(idx.Tracks), len(idx.Artists), len(idx.Playlists), len(idx.Albums))
	}

	if !hadIndex {
		syncer.onProgress = v.setSyncProgress
	}

	if v.cfg.CatalogSync {
		go v.runCatalogSync(syncer, hadIndex)
	}
}

func (v *voiceService) runCatalogSync(syncer *catalogSyncer, hadIndex bool) {
	if !v.g2p.available(v.ctx) {
		v.app.log.Warn("voice: espeak-ng g2p unavailable, phonetic re-rank disabled, commands fall through to searchDesktop")
		return
	}
	if !hadIndex {
		v.firstSyncInProgress.Store(true)
		defer v.firstSyncInProgress.Store(false)
	}

	ready := make(chan struct{})
	var once sync.Once
	v.app.server.OnPlayerReady(func() { once.Do(func() { close(ready) }) })
	select {
	case <-ready:
	case <-v.ctx.Done():
		return
	}

	if hadIndex {
		// voice already works on the cached index, so we run sync in the background now
		if _, _, err := syncer.Refresh(v.ctx); err != nil && v.ctx.Err() == nil {
			v.app.log.Warnf("voice: catalog refresh ended with error: %v", err)
		}
		return
	}
	// first ever sync
	if _, err := syncer.Run(v.ctx); err != nil && v.ctx.Err() == nil {
		v.app.log.Warnf("voice: catalog sync ended with error: %v", err)
	}
}

func (v *voiceService) Stop() {
	if v.cancel != nil {
		v.cancel()
	}
}

func (v *voiceService) setSyncProgress(p catalogProgress) {
	v.syncProgressMu.Lock()
	v.syncProgress = &p
	v.syncProgressMu.Unlock()
	v.app.server.Emit(&ApiEvent{Type: ApiEventTypeSetupProgress, Data: p})
}

func (v *voiceService) syncProgressSnapshot() *catalogProgress {
	v.syncProgressMu.Lock()
	defer v.syncProgressMu.Unlock()
	if v.syncProgress == nil {
		return nil
	}
	p := *v.syncProgress
	return &p
}

// ApiEventTypeVoiceLevel carries the speech level (0-1) while a command is recorded
const ApiEventTypeVoiceLevel ApiEventType = "voice/level"

func (v *voiceService) emit(state, text string) {
	// the driver tapped this command away: it says nothing more
	if state != "idle" && state != "listening" {
		if g := v.mutedGen.Load(); g != 0 && g == v.activeGen.Load() {
			return
		}
	}
	v.bannerSeq.Add(1)
	v.app.server.Emit(&ApiEvent{Type: ApiEventTypeVoice, Data: ApiEventDataVoice{State: state, Text: text}})
}

// used to run the voice binaries
func (v *voiceService) loader() string {
	return filepath.Join(v.cfg.LibDir, "ld-linux-aarch64.so.1")
}

// runs the full voice flow
func (v *voiceService) TriggerVoice(ctx context.Context, transcript, clipPath string) (string, error) {
	v.mu.Lock()
	if v.busy {
		v.mu.Unlock()
		return "", fmt.Errorf("voice: busy with another command")
	}
	v.busy = true
	v.gen++
	gen := v.gen
	start := time.Now()
	v.flowStart = start
	ctx, cancel := context.WithCancel(ctx)
	v.flowCancel = cancel
	v.activeGen.Store(gen)
	v.mu.Unlock()
	defer func() {
		cancel()
		v.mu.Lock()
		v.busy = false
		v.flowCancel = nil
		v.mu.Unlock()
		// Wisp has the request: the music comes back
		v.hush(false)
	}()

	// "listening" is emitted by the wake loop the instant the wake word wakes
	v.emit("thinking", "")

	// 1. ASR
	if transcript == "" && clipPath != "" {
		if v.sherpa == nil {
			v.flash(gen, "error", "Sorry, I didn't catch that")
			return "", fmt.Errorf("voice: no ASR available (sherpa disabled)")
		}
		t, err := v.sherpa.transcribe(ctx, clipPath)
		if err != nil {
			v.app.log.WithError(err).Warn("voice: ASR failed")
			v.flash(gen, "error", "Sorry, I didn't catch that")
			return "", err
		}
		transcript = t
		v.app.log.Infof("voice: heard %q in %s", transcript, time.Since(start).Round(time.Millisecond))
	}
	if strings.TrimSpace(transcript) == "" {
		v.flash(gen, "error", "Sorry, I didn't catch that")
		return "", fmt.Errorf("voice: empty transcript")
	}

	// everyday phrasing as the commands below know them, then what Wisp answers
	// or does itself: questions, follow-ups, Drive Mode, settings, directions, calls
	heard := transcript
	transcript = normalizeLoose(transcript)
	if transcript != strings.ToLower(strings.TrimSpace(heard)) {
		v.app.log.Infof("voice: %q reads as %q", heard, transcript)
	}
	if u, ok := understand(transcript); ok {
		return v.handleUnderstood(ctx, gen, u)
	}
	// not a command Wisp's own rules know the shape of: the phone's model if it's
	// there, else the meaning-matcher on the Car Thing
	if !looksLikeCommand(transcript) {
		if v.phoneCanThink() {
			if out, err, ok := v.thinkOnPhone(ctx, gen, transcript); ok {
				return out, err
			}
		}
		if cmd := v.meaningOf(ctx, transcript); cmd != "" {
			if u, ok := understand(normalizeLoose(cmd)); ok {
				return v.handleUnderstood(ctx, gen, u)
			}
			transcript = normalizeLoose(cmd)
		}
	}

	// "add this to my road trip playlist"
	if name, ok := parseAddToPlaylist(transcript); ok {
		v.app.log.Infof("voice: transcript=%q -> add to playlist %q", transcript, name)
		return v.addToPlaylist(ctx, gen, name)
	}

	// naming another music service sends it there instead of Spotify
	if req, ok := parseServiceVoice(transcript); ok {
		v.app.log.Infof("voice: transcript=%q -> %s %s %q", transcript, req.Service, req.Kind, req.Query)
		return v.playOnService(ctx, gen, req)
	}

	// 2. resolve
	hyps := []string{transcript}

	var query string
	if v.resolver != nil {
		dec := v.resolver.resolve(ctx, hyps)
		switch dec.Tier {
		case "control":
			return v.handleControl(ctx, gen, dec.Action)
		case "queue":
			// resolved in library queue match
			v.app.log.Infof("voice: transcript=%q -> queue %s (%s, score=%.3f)", transcript, voiceLabel(dec), dec.Uri, dec.Score)
			return v.handleQueue(ctx, gen, dec.Uri, voiceLabel(dec))
		case "abstain":
			// the library matcher gave up: the phone's model, or the meaning-matcher,
			// may still make sense of it
			if v.phoneCanThink() {
				if out, err, ok := v.thinkOnPhone(ctx, gen, transcript); ok {
					return out, err
				}
			} else if cmd := v.meaningOf(ctx, transcript); cmd != "" {
				if u, ok := understand(normalizeLoose(cmd)); ok {
					return v.handleUnderstood(ctx, gen, u)
				}
				if action, ok := v.resolver.matchControl(ctx, strings.Fields(normalizeLoose(cmd))); ok {
					return v.handleControl(ctx, gen, action)
				}
			}
			// do nothing on purpose
			msg := "Sorry, I didn’t catch that"
			if dec.Kind == kindQueue {
				msg = "Couldn’t find that to queue"
			} else if dec.Kind == kindRandom {
				msg = "No liked songs yet"
			}
			v.app.log.Infof("voice: transcript=%q -> abstain (%s, best=%q score=%.3f)", transcript, dec.Kind, dec.Name, dec.Score)
			v.flash(gen, "error", msg)
			if dec.Kind != kindQueue && dec.Kind != kindRandom {
				v.offerModelLater()
			}
			return "", fmt.Errorf("voice: abstained on %q", transcript)
		case "local":
			// in library phonetic match
			if dec.Uri == "" {
				query = searchQueryFromResult(dec)
				v.app.log.Warnf("voice: transcript=%q -> local match %q had no URI, falling back to search", transcript, dec.Name)
			} else {
				label := voiceLabel(dec)
				v.app.log.Infof("voice: transcript=%q -> [%s] %s (%s, score=%.3f)", transcript, dec.Kind, label, dec.Uri, dec.Score)
				v.memory.remember(voiceTurn{uri: dec.Uri, label: label})
				return v.playUri(ctx, gen, dec.Uri, label)
			}
		default: // "search"
			v.app.log.Infof("voice: transcript=%q -> searchDesktop re-rank query=%q (best local: %q kind=%s score=%.3f, indexSize=%d)",
				transcript, dec.Query, dec.Name, dec.Kind, dec.Score, dec.IndexSize)
			return v.searchRerankPlay(ctx, gen, transcript, dec)
		}
	} else {
		query = parseVoiceQuery(transcript)
		v.app.log.Infof("voice: transcript=%q -> query=%q", transcript, query)
	}

	if strings.TrimSpace(query) == "" {
		v.flash(gen, "error", "Sorry, I didn't catch that")
		return "", fmt.Errorf("voice: empty query from %q", transcript)
	}
	v.emit("thinking", "") // UI picks a creative word

	// 3. search
	res, err := v.app.server.Submit(ctx, ApiRequestTypeSearch, ApiRequestDataSearch{Query: query})
	if err != nil {
		v.app.log.WithError(err).Warn("voice: search failed")
		v.flash(gen, "error", "Couldn't search right now")
		return "", err
	}
	track, _ := res.(*searchTrackResult)
	if track == nil || track.Uri == "" {
		v.flash(gen, "error", fmt.Sprintf("Couldn't find “%s”", query))
		return "", fmt.Errorf("voice: no track for %q", query)
	}

	label := track.Name
	if track.Artist != "" {
		label = track.Name + " - " + track.Artist
	}

	// 4. play + noti
	return v.playUri(ctx, gen, track.Uri, label)
}

// emits the playing banner
func (v *voiceService) playUri(ctx context.Context, gen uint64, uri, label string) (string, error) {
	return v.playUriShuffled(ctx, gen, uri, label, false)
}

// playUriShuffled is playUri with shuffle on or off ("shuffle my liked songs")
func (v *voiceService) playUriShuffled(ctx context.Context, gen uint64, uri, label string, shuffle bool) (string, error) {
	data := ApiRequestDataPlay{Uri: uri, Shuffle: &shuffle}
	_, err := v.app.server.Submit(ctx, ApiRequestTypePlay, data)
	if errors.Is(err, ErrNotFound) {
		// no Spotify to play on: the phone's has likely fallen asleep
		err = v.wakeAndPlay(ctx, data, label)
	}
	if err != nil {
		v.app.log.WithError(err).Warn("voice: play failed")
		if errors.Is(err, ErrNotFound) {
			v.flash(gen, "error", "Open Spotify on your phone")
		} else {
			v.flash(gen, "error", "Couldn't start playback")
		}
		return label, err
	}
	v.emit("playing", label)
	v.mu.Lock()
	took := time.Since(v.flowStart).Round(time.Millisecond)
	v.mu.Unlock()
	v.app.log.Infof("voice: playing %s (%s), %s after the command ended", label, uri, took)
	v.scheduleIdle(gen, 5*time.Second)
	return label, nil
}

// how long a voice play waits for the phone's Spotify to wake: quietly first,
// then by opening it
const (
	voiceWakeQuiet = 4 * time.Second
	voiceWakeTotal = 15 * time.Second
)

// wakeAndPlay wakes Spotify on the phone and plays once it's back in Connect.
// A quiet wake starts it in the background; if it hasn't shown up after a few
// seconds, Spotify is opened (or prompted for) as the Car Thing's own wake does
func (v *voiceService) wakeAndPlay(ctx context.Context, data ApiRequestDataPlay, label string) error {
	nav := v.app.nav
	if nav == nil || nav.WakeSpotifyQuiet(ctx) != nil {
		return ErrNotFound
	}
	v.app.log.Infof("voice: no Spotify device for %s, waking the phone's", label)
	v.emit("thinking", "Waking Spotify…")
	start := time.Now()
	loud := false
	tick := time.NewTicker(time.Second)
	defer tick.Stop()
	for {
		select {
		case <-ctx.Done():
			return ctx.Err()
		case <-tick.C:
		}
		_, err := v.app.server.Submit(ctx, ApiRequestTypePlay, data)
		if err == nil {
			v.app.log.Infof("voice: Spotify woke after %s", time.Since(start).Round(100*time.Millisecond))
			return nil
		}
		if !errors.Is(err, ErrNotFound) {
			return err
		}
		if !loud && time.Since(start) >= voiceWakeQuiet {
			loud = true
			_ = nav.WakeSpotify(ctx)
		}
		if time.Since(start) >= voiceWakeTotal {
			return ErrNotFound
		}
	}
}

// handles the cascade "search" tier
func (v *voiceService) searchRerankPlay(ctx context.Context, gen uint64, transcript string, dec resolveResult) (string, error) {
	query := strings.TrimSpace(dec.Query)
	if query == "" {
		v.flash(gen, "error", "Sorry, I didn't catch that")
		return "", fmt.Errorf("voice: empty search query from %q", transcript)
	}
	v.emit("thinking", "")

	res, err := v.app.server.Submit(ctx, ApiRequestTypeSearch, ApiRequestDataSearch{Query: query, TopN: true, Kind: dec.QueryKind})
	if err != nil && dec.QueryKind != "" {
		// nothing of that kind by that name: the words may still be a song
		v.app.log.Infof("voice: no %s for %q, trying tracks", dec.QueryKind, query)
		dec.QueryKind = ""
		res, err = v.app.server.Submit(ctx, ApiRequestTypeSearch, ApiRequestDataSearch{Query: query, TopN: true})
	}
	if err != nil {
		v.app.log.WithError(err).Warn("voice: search failed")
		v.flash(gen, "error", "Couldn't search right now")
		return "", err
	}
	tracks, _ := res.([]searchTrackResult)
	if len(tracks) == 0 {
		v.flash(gen, "error", fmt.Sprintf("Couldn't find “%s”", query))
		return "", fmt.Errorf("voice: no results for %q", query)
	}

	// rank against what was said
	qTrack := dec.QueryTrack
	if qTrack == "" {
		qTrack = query
	}
	pick, score, ok := v.resolver.rerankSearch(ctx, qTrack, dec.QueryArtist, tracks)
	if !ok && dec.QueryArtist != "" {
		// "X by Y" where the speech mangled the title but the artist came through:
		// Spotify's own best match by that artist beats giving up
		if p, s, found := v.resolver.artistAnchored(ctx, dec.QueryArtist, tracks); found {
			v.app.log.Infof("voice: search re-rank fell back on the artist (%q score=%.3f)", p.Artist, s)
			pick, score, ok = p, s, true
		}
	}
	if !ok {
		v.app.log.Infof("voice: search re-rank ABSTAIN query=%q (closest %q, %q score=%.3f > %.2f, of %d)",
			query, pick.Name, pick.Artist, score, searchRerankFloor, len(tracks))
		v.flash(gen, "error", fmt.Sprintf("Couldn't find “%s”", query))
		return "", fmt.Errorf("voice: search re-rank abstained on %q", transcript)
	}

	label := pick.Name
	if pick.Artist != "" {
		label = pick.Name + " - " + pick.Artist
	}
	v.app.log.Infof("voice: search re-rank -> %s (%s, score=%.3f, of %d results)", label, pick.Uri, score, len(tracks))
	// the runners-up, for "no, the other one"
	var others []voiceAlt
	for _, t := range tracks {
		if t.Uri == "" || t.Uri == pick.Uri || len(others) == 3 {
			continue
		}
		l := t.Name
		if t.Artist != "" {
			l = t.Name + " - " + t.Artist
		}
		others = append(others, voiceAlt{uri: t.Uri, label: l})
	}
	v.memory.remember(voiceTurn{uri: pick.Uri, label: label, others: others})
	return v.playUri(ctx, gen, pick.Uri, label)
}

// builds the "Song - Artist" banner label
func voiceLabel(d resolveResult) string {
	if d.Artist != "" {
		return d.Name + " - " + d.Artist
	}
	return d.Name
}

// dispatches a recognized control verb
func (v *voiceService) handleControl(ctx context.Context, gen uint64, action string) (string, error) {
	switch action {
	case "resume":
		return v.handleResume(ctx, gen)
	case "volup", "voldown":
		return v.handleVolume(ctx, gen, action)
	case "like":
		return v.handleLike(ctx, gen)
	}

	var t ApiRequestType
	var banner string
	switch action {
	case "pause":
		t, banner = ApiRequestTypePause, "Paused"
	case "next":
		t, banner = ApiRequestTypeNext, "Skipping"
	case "prev":
		t, banner = ApiRequestTypePrev, "Previous"
	default:
		v.flash(gen, "error", "Sorry, I didn't catch that")
		return "", fmt.Errorf("voice: unknown control action %q", action)
	}
	v.app.log.Infof("voice: control -> %s", action)
	if _, err := v.app.server.Submit(ctx, t, nil); err != nil {
		v.app.log.WithError(err).Warn("voice: control failed")
		v.flash(gen, "error", "Couldn't do that")
		return "", err
	}
	v.flash(gen, "done", banner)
	return action, nil
}

// saves the playing track to Liked Songs
func (v *voiceService) handleLike(ctx context.Context, gen uint64) (string, error) {
	v.app.log.Info("voice: control -> like")
	res, err := v.app.server.Submit(ctx, ApiRequestTypeLikeCurrent, nil)
	if errors.Is(err, ErrNotFound) {
		v.flash(gen, "error", "Nothing to like right now")
		return "", err
	}
	if err != nil {
		v.app.log.WithError(err).Warn("voice: like failed")
		v.flash(gen, "error", "Couldn't add to Liked Songs")
		return "", err
	}
	banner := "Added to Liked Songs"
	if m, ok := res.(map[string]any); ok {
		if name, _ := m["name"].(string); name != "" {
			banner = "Liked " + name
		}
	}
	v.flash(gen, "done", banner)
	return "like", nil
}

// resumes the active device
func (v *voiceService) handleResume(ctx context.Context, gen uint64) (string, error) {
	v.app.log.Info("voice: control -> resume")
	if _, err := v.app.server.Submit(ctx, ApiRequestTypeResume, nil); err == nil {
		v.flash(gen, "done", "Resumed")
		return "resume", nil
	} else {
		v.app.log.WithError(err).Debug("voice: resume failed; trying resume_last (idle fallback)")
	}
	if _, err := v.app.server.Submit(ctx, ApiRequestTypeResumeLast, nil); err != nil {
		v.app.log.WithError(err).Warn("voice: resume_last failed")
		v.flash(gen, "error", "Nothing to resume")
		return "", err
	}
	v.flash(gen, "done", "Resumed")
	return "resume", nil
}

// handles volume controls
func (v *voiceService) handleVolume(ctx context.Context, gen uint64, action string) (string, error) {
	step := voiceVolumeStep
	banner := "Volume up"
	if action == "voldown" {
		step = -step
		banner = "Volume down"
	}
	v.app.log.Infof("voice: control -> %s (step=%d)", action, step)
	if _, err := v.app.server.Submit(ctx, ApiRequestTypeSetVolume, ApiRequestDataVolume{Volume: step, Relative: true}); err != nil {
		v.app.log.WithError(err).Warn("voice: volume failed")
		v.flash(gen, "error", "Couldn't change volume")
		return "", err
	}
	v.flash(gen, "done", banner)
	return action, nil
}

// adds a resolved in library track to the active devices queue
func (v *voiceService) handleQueue(ctx context.Context, gen uint64, uri, label string) (string, error) {
	v.emit("thinking", "")
	if _, err := v.app.server.Submit(ctx, ApiRequestTypeAddToQueue, uri); err != nil {
		v.app.log.WithError(err).Warn("voice: add_to_queue failed")
		v.flash(gen, "error", "Couldn't queue that")
		return "", err
	}
	v.app.log.Infof("voice: queued %s (%s)", label, uri)
	v.flash(gen, "done", "Queued "+label)
	return label, nil
}

func (v *voiceService) flash(gen uint64, state, text string) {
	v.emit(state, text)
	v.scheduleIdle(gen, 3500*time.Millisecond)
}

func (v *voiceService) scheduleIdle(gen uint64, d time.Duration) {
	seq := v.bannerSeq.Load()
	time.AfterFunc(d, func() {
		if v.bannerSeq.Load() != seq {
			return
		}
		v.mu.Lock()
		cur := v.gen
		v.mu.Unlock()
		if cur == gen {
			v.emit("idle", "")
		}
	})
}

// flips the banner to idle
func (v *voiceService) scheduleClear(d time.Duration) {
	seq := v.bannerSeq.Load()
	time.AfterFunc(d, func() {
		if v.bannerSeq.Load() == seq {
			v.emit("idle", "")
		}
	})
}

// runs the always-on wake-word listener
func (v *voiceService) setWakeEnabled(on bool) {
	if v.wakeEnabled.Swap(on) == on {
		return // no change
	}
	if on {
		v.app.log.Info("voice: mic enabled")
		select {
		case v.wakeSignal <- struct{}{}:
		default:
		}
	} else {
		v.app.log.Info("voice: mic disabled")
		if c := v.wakeCancel.Load(); c != nil {
			(*c)() // kill the running oww_wake
		}
	}
}

const wakeThresholdDebounce = 10 * time.Second

// how long a pause ends a command: the wake listener's own default is 0.8 s,
// which left Wisp waiting most of a second after every command. 0.6 s still
// lets "play Midnight City … by M83" pause between the song and the artist
const voiceHangSecs = 0.6

// the wake threshold for the current playback state
func (v *voiceService) wakeThreshold() float64 {
	if v.playbackActive.Load() && v.cfg.WakeThresholdPlaying > 0 {
		return v.cfg.WakeThresholdPlaying
	}
	return v.cfg.WakeThreshold
}

func (v *voiceService) notifyPlayback(playing bool) {
	if !v.cfg.Wake {
		return // no listener to retune
	}
	if v.playbackActive.Swap(playing) == playing {
		return // no change
	}
	gen := v.thrGen.Add(1)
	time.AfterFunc(wakeThresholdDebounce, func() { v.applyWakeThreshold(gen) })
}

// restarts the wake listener
func (v *voiceService) applyWakeThreshold(gen uint64) {
	if v.thrGen.Load() != gen {
		return // a newer flip superseded this one
	}
	if v.ctx.Err() != nil || !v.wakeEnabled.Load() {
		return
	}
	want := v.wakeThreshold()
	if math.Float64frombits(v.runningThr.Load()) == want {
		return
	}
	// a command is mid flight
	v.mu.Lock()
	busy := v.busy
	v.mu.Unlock()
	if busy || v.capturing.Load() {
		time.AfterFunc(2*time.Second, func() { v.applyWakeThreshold(gen) })
		return
	}
	v.app.log.Infof("voice: wake threshold -> %.2f (playing=%v)", want, v.playbackActive.Load())
	v.thrRestart.Store(true)
	if c := v.wakeCancel.Load(); c != nil {
		(*c)()
	}
}

var (
	// there's no wake listener: voice or the wake word is off in the config
	ErrVoiceUnavailable = errors.New("voice: no wake listener")
	// the user turned the mic off
	ErrVoiceMicOff = errors.New("voice: mic is off")
)

// ListenNow starts capturing a command as if the wake word had been heard (a
// button). The listener prints its usual WAKE line, so the "listening" glow,
// capture and transcription all run exactly as for "Okay Wisp".
func (v *voiceService) ListenNow() error {
	if !v.cfg.Wake {
		return ErrVoiceUnavailable
	}
	if !v.wakeEnabled.Load() {
		return ErrVoiceMicOff
	}
	p := v.wakeProc.Load()
	if p == nil {
		return ErrVoiceUnavailable
	}
	v.app.log.Info("voice: listening on request")
	return signalListen(p)
}

// Cancel is a tap off Wisp on the screen: it stops listening (the words so far
// are thrown away) and drops the command it was working on, and the music
// comes back
func (v *voiceService) Cancel() {
	v.mu.Lock()
	if v.busy {
		v.mutedGen.Store(v.gen)
		if v.flowCancel != nil {
			v.flowCancel()
		}
	}
	v.mu.Unlock()
	if v.capturing.Swap(false) {
		v.app.log.Info("voice: listening cancelled")
		// the listener starts again straight away, without the clip
		v.thrRestart.Store(true)
		if c := v.wakeCancel.Load(); c != nil {
			(*c)()
		}
	}
	v.hush(false)
	v.emit("idle", "")
}

// listenMusicFromSettings: Settings → Music while Wisp listens, "lower"
// unless set to "pause" or "off"
func listenMusicFromSettings(body []byte) string {
	var s struct {
		Mode string `json:"listenMusic"`
	}
	if json.Unmarshal(body, &s) == nil && (s.Mode == "pause" || s.Mode == "off") {
		return s.Mode
	}
	return "lower"
}

// hush asks the phone to lower or pause the music while Wisp listens, so the
// mics hear the driver, and to bring it back after
func (v *voiceService) hush(on bool) {
	mode := "off"
	if on {
		mode = listenMusicFromSettings(v.app.GetSettings())
		if mode == "off" {
			return
		}
		v.hushed.Store(true)
	} else if !v.hushed.Swap(false) {
		return // nothing to bring back
	}
	select {
	case v.hushCh <- mode:
	default:
	}
}

// unhushIfIdle brings the music back when listening ended without a command
func (v *voiceService) unhushIfIdle() {
	v.mu.Lock()
	busy := v.busy
	v.mu.Unlock()
	if !busy && !v.capturing.Load() {
		v.hush(false)
	}
}

// runHush sends the hushes to the phone in order, off the wake listener's path
func (v *voiceService) runHush() {
	for {
		select {
		case <-v.ctx.Done():
			return
		case mode := <-v.hushCh:
			if v.app.nav == nil {
				continue
			}
			if err := v.app.nav.Hush(v.ctx, mode); err != nil {
				v.app.log.Debugf("voice: music %q not sent to the phone: %v", mode, err)
			}
		}
	}
}

// the shipped wake words, in the order one stands in for a missing one:
// "Okay Wisp", then Mira's "Hey Mira", which the original firmware still carries
var fallbackWakeModels = []string{"okay_wisp.tflite", "hey_mira.tflite"}

// wakeModelPath resolves voice.wake_model against ModelDir, falling back to a
// shipped wake word if the configured file isn't there, so a typo can't deafen the device
func (v *voiceService) wakeModelPath() string {
	resolve := func(name string) string {
		if filepath.IsAbs(name) {
			return name
		}
		return filepath.Join(v.cfg.ModelDir, name)
	}
	if v.cfg.WakeModel != "" {
		path := resolve(v.cfg.WakeModel)
		if _, err := os.Stat(path); err == nil {
			return path
		}
		v.app.log.Warnf("voice: wake model %s missing, falling back to a shipped one", path)
	}
	for _, name := range fallbackWakeModels {
		if _, err := os.Stat(resolve(name)); err == nil {
			return resolve(name)
		}
	}
	return resolve(fallbackWakeModels[0])
}

func (v *voiceService) runWakeLoop() {
	mel := filepath.Join(v.cfg.ModelDir, "melspectrogram.tflite")
	emb := filepath.Join(v.cfg.ModelDir, "embedding_model.tflite")
	wake := v.wakeModelPath()
	v.app.log.Infof("voice: wake model %s", wake)

	for v.ctx.Err() == nil {
		// mic disabled
		if !v.wakeEnabled.Load() {
			select {
			case <-v.wakeSignal:
			case <-v.ctx.Done():
				return
			}
			continue
		}

		thr := v.wakeThreshold()
		v.runningThr.Store(math.Float64bits(thr))

		runCtx, cancel := context.WithCancel(v.ctx)
		v.wakeCancel.Store(&cancel)
		cmd := exec.CommandContext(runCtx, v.loader(), "--library-path", v.cfg.LibDir,
			filepath.Join(v.cfg.BinDir, "oww_wake"), mel, emb, wake,
			"--mic", v.cfg.MicDevice, "--threshold", fmt.Sprintf("%.2f", thr),
			"--hang-secs", fmt.Sprintf("%.2f", voiceHangSecs))

		cmd.SysProcAttr = dieWithDaemon()
		stdout, err := cmd.StdoutPipe()
		if err != nil {
			v.app.log.WithError(err).Error("voice: wake stdout pipe")
			cancel()
			v.wakeCancel.Store(nil)
			time.Sleep(time.Second)
			continue
		}
		if stderr, err := cmd.StderrPipe(); err == nil {
			go drainLog(v, stderr)
		}
		if err := cmd.Start(); err != nil {
			v.app.log.WithError(err).Error("voice: wake listener start failed")
			cancel()
			v.wakeCancel.Store(nil)
			time.Sleep(2 * time.Second)
			continue
		}
		v.wakeProc.Store(cmd.Process)
		v.app.log.Info("voice: wake listener started")
		sc := bufio.NewScanner(stdout)
		for sc.Scan() {
			line := strings.TrimSpace(sc.Text())
			// how loud the speech is while it records, every 80 ms: the voice bar
			// on screen moves with it. Too frequent to log
			if lv, ok := strings.CutPrefix(line, "LEVEL "); ok {
				if f, err := strconv.ParseFloat(strings.TrimSpace(lv), 64); err == nil && f >= 0 && f <= 1 {
					v.app.server.Emit(&ApiEvent{Type: ApiEventTypeVoiceLevel, Data: map[string]float64{"level": f}})
				}
				continue
			}
			// wake fires the instant the wake word is detected
			if strings.HasPrefix(line, "WAKE") {
				v.app.log.Info("voice: wake word detected")
				v.capturing.Store(true)
				v.emit("listening", "")
				v.hush(true)
				// if no CLIP ever follows (silence timeout, capture death)
				// nothing else would dismiss the banner, or bring the music back
				v.scheduleClear(15 * time.Second)
				time.AfterFunc(15*time.Second, v.unhushIfIdle)
				continue
			}
			if clip, ok := strings.CutPrefix(line, "CLIP "); ok {
				v.capturing.Store(false)
				clip = strings.TrimSpace(clip)
				go func() {
					if _, err := v.TriggerVoice(v.ctx, "", clip); err != nil {
						v.app.log.WithError(err).Debug("voice: wake-triggered flow failed")
					}
				}()
			}
		}
		v.capturing.Store(false)
		v.wakeProc.Store(nil)
		v.unhushIfIdle()
		_ = cmd.Wait()
		cancel()
		v.wakeCancel.Store(nil)
		if v.ctx.Err() != nil {
			return
		}
		if !v.wakeEnabled.Load() {
			v.app.log.Info("voice: wake listener stopped (mic off)")
			continue
		}
		if v.thrRestart.Swap(false) {
			continue
		}
		v.app.log.Warn("voice: wake listener exited; restarting in 1s")
		time.Sleep(time.Second)
	}
}

var voiceNonWord = regexp.MustCompile(`[^a-z0-9 ]+`)

func parseVoiceQuery(t string) string {
	words := strings.Fields(voiceNonWord.ReplaceAllString(strings.ToLower(t), " "))
	for i, w := range words {
		if w == "play" {
			words = words[i+1:]
			for j, w2 := range words {
				if w2 == "play" {
					words = words[:j]
					break
				}
			}
			break
		}
	}
	for len(words) > 0 && (words[0] == "the" || words[0] == "some" || words[0] == "a") {
		words = words[1:]
	}
	return strings.Join(words, " ")
}

// trims an ASR transcript
func cleanTranscript(s string) string {
	return strings.TrimSpace(strings.ReplaceAll(strings.TrimSpace(s), "\n", " "))
}
