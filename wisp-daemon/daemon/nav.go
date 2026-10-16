package daemon

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"math"
	"reflect"
	"strings"
	"sync"
	"time"

	"github.com/coder/websocket"
	librespot "github.com/devgianlu/go-librespot"
)

// Turn-by-turn from the phone. The Wisp app reads Google Maps'
// navigation notification and the phone's location, and serves both as JSON
// over a WebSocket. On the tether the phone is our default gateway, so the
// relay dials it there unless NavConfig.PhoneURL points somewhere else (the
// desktop simulator does).

const (
	navPhonePort = 3679
	navPhonePath = "/nav"
	navRetryMin  = 2 * time.Second
	// the phone is one hop away on the tether: trying again often costs nothing,
	// and a long wait after it wakes is what makes the link feel broken
	navRetryMax = 5 * time.Second
	// a phone that goes to sleep can drop the link without a word; asking it
	// for a pong now and then finds that out in seconds instead of never
	navPingEvery   = 10 * time.Second
	navPingTimeout = 8 * time.Second
	// room for a media message's cover art
	navMaxMessageBytes = 512 << 10
	navMaxIconBytes    = 96 << 10
	navMaxTextRunes    = 200
	// a brief tether drop shouldn't blank the turn card mid-drive
	navDropGrace = 10 * time.Second
)

const (
	// the whole NavState, on any change but a new fix
	ApiEventTypeNav ApiEventType = "nav"
	// just the NavLocation, about once a second while driving
	ApiEventTypeNavLocation ApiEventType = "nav/location"
)

type NavConfig struct {
	Enabled bool
	// ws://host:port/nav of the companion app; empty dials the tether gateway
	PhoneURL string
}

// NavLocation is the phone's last fix
type NavLocation struct {
	Lat      float64 `json:"lat"`
	Lng      float64 `json:"lng"`
	Bearing  float64 `json:"bearing"`
	Speed    float64 `json:"speed"`
	Accuracy float64 `json:"accuracy"`
}

// NavState is what /nav/status and the nav event carry to the UI
type NavState struct {
	// the companion app is reachable
	Connected bool `json:"connected"`
	// Google Maps is navigating
	Active bool `json:"active"`
	// the notification's lines, e.g. "500 ft", "Turn right onto Main St", "12 min · 5.1 mi · 3:45 PM"
	Title   string `json:"title,omitempty"`
	Text    string `json:"text,omitempty"`
	SubText string `json:"sub_text,omitempty"`
	// the maneuver arrow, a data:image/png;base64 URL
	Icon     string       `json:"icon,omitempty"`
	Location *NavLocation `json:"location,omitempty"`
	// the phone's offset from UTC in minutes, from its hello; the Car Thing
	// itself runs on UTC. kept after the phone goes, the last one known
	TzOffsetMin *int `json:"tz_offset_min,omitempty"`
	// Wisp's spoken voice on the phone (phone_voice.go): absent | downloading |
	// ready | failed, with the download's progress and any failure
	VoiceState   string `json:"voice_state,omitempty"`
	VoicePercent int    `json:"voice_percent,omitempty"`
	VoiceError   string `json:"voice_error,omitempty"`
	// music services beside Spotify on the phone (phone_services.go)
	Services []MusicService `json:"services,omitempty"`
	// the route line on the map (nav_route.go): fetch /nav/route when the
	// revision changes; the kind says which ("full", "next" or none)
	RouteRev  int    `json:"route_rev,omitempty"`
	RouteKind string `json:"route_kind,omitempty"`
	// epoch ms of the last change
	UpdatedAt int64 `json:"updated_at"`
}

// navMessage is one message from the companion app
type navMessage struct {
	Type string `json:"type"`

	// type "hello"
	TzOffsetMin *int `json:"tz_offset_min"`

	// type "nav"
	Active  bool   `json:"active"`
	Title   string `json:"title"`
	Text    string `json:"text"`
	SubText string `json:"sub_text"`
	Icon    string `json:"icon"`

	// type "location"
	Lat      float64 `json:"lat"`
	Lng      float64 `json:"lng"`
	Bearing  float64 `json:"bearing"`
	Speed    float64 `json:"speed"`
	Accuracy float64 `json:"accuracy"`
}

type navRelay struct {
	cfg     NavConfig
	log     librespot.Logger
	emit    func(*ApiEvent)
	gateway func() string

	mu        sync.Mutex
	state     NavState
	dropTimer *time.Timer
	// the live companion app connection, for messages to the phone
	conn *websocket.Conn

	// the route line the phone worked out (nav_route.go)
	route NavRoute

	// the companion app's GitHub repo/token for updates (updater.go)
	onUpdateAuth func(repo, token string)

	// what the phone is playing outside Spotify (phone_media.go)
	media        PhoneMedia
	mediaArt     []byte
	mediaArtType string

	// the phone's notifications are wanted as banners (phone_notify.go)
	notifyWanted bool
	// Wisp's voice is on, so the phone keeps it ready (phone_voice.go)
	voiceWanted bool

	// the companion app downloads updates for the Car Thing (update_relay.go):
	// whether this one can, its address, and the downloads waiting on it
	canRelay     bool
	connHost     string
	relaySeq     int
	relayWaiting map[int]chan relayReply

	// browse requests waiting on the phone's answer (phone_services.go)
	svcSeq     int
	svcWaiting map[int]chan serviceReply

	// Drive Mode's last state from the phone (phone_drive.go)
	driveState json.RawMessage
	// a call on the phone (phone_call.go)
	call PhoneCall
	// the phone's battery (phone_battery.go)
	battery PhoneBattery
	// a visualizer is on screen, and whether the phone can measure (phone_viz.go)
	vizWanted bool
	vizStatus VizStatus

	// the settings backup on the phone (settings_backup.go): what to send it,
	// and what to do with the copy it sends back
	settingsForBackup func() []byte
	onSettingsRestore func(blob []byte)
	// a change from the companion app's Car Thing settings page (settings_remote.go)
	onSettingsSet func(patch []byte)

	// the phone's time zone, which becomes the Car Thing's (app.setPhoneUtcOffset)
	onTimeZone func(offsetMin int)
}

// NavHandler backs /nav/*
type NavHandler interface {
	Status() NavState
	// asks the phone to start Spotify so it rejoins Connect; ErrNoNavPhone without one
	WakeSpotify(ctx context.Context) error

	// the phone's own media session (phone_media.go)
	Media() PhoneMedia
	MediaArt() ([]byte, string)
	MediaControl(ctx context.Context, action string) error
	MediaSeek(ctx context.Context, positionMs int64) error
	// speaks through the phone (phone_voice.go)
	Say(ctx context.Context, text string, speed, volume float64) error
	// the other music services' libraries (phone_services.go)
	ServiceBrowse(ctx context.Context, service, id string) (json.RawMessage, error)
	ServicePlay(ctx context.Context, service, playlist, video, title string) error
	ServiceNow(ctx context.Context) (ServiceNow, error)
	ServiceLike(ctx context.Context, service, current string, like bool) error
	// Drive Mode, played by the phone (phone_drive.go)
	DriveCommand(ctx context.Context, action, genre string) error
	DriveState() json.RawMessage
	// calls, answered and ended from the Car Thing (phone_call.go)
	Call() PhoneCall
	CallControl(ctx context.Context, action string) error
	// the phone's battery (phone_battery.go)
	Battery() PhoneBattery
	// the visualizer (phone_viz.go)
	SetVizWanted(on bool) error
	VizStatus() VizStatus
	// the route line on the map (nav_route.go)
	Route() NavRoute
}

var ErrNoNavPhone = errors.New("companion app not connected")

func (n *navRelay) WakeSpotify(ctx context.Context) error {
	n.mu.Lock()
	c := n.conn
	n.mu.Unlock()
	if c == nil {
		return ErrNoNavPhone
	}
	n.log.Info("nav: asking the phone to wake Spotify")
	return c.Write(ctx, websocket.MessageText, []byte(`{"type":"wake_spotify"}`))
}

// WakeSpotifyQuiet starts Spotify in the background without opening it or
// prompting, for a play that may not need more (an older phone app treats it
// as a full wake)
func (n *navRelay) WakeSpotifyQuiet(ctx context.Context) error {
	n.mu.Lock()
	c := n.conn
	n.mu.Unlock()
	if c == nil {
		return ErrNoNavPhone
	}
	n.log.Info("nav: asking the phone to wake Spotify quietly")
	return c.Write(ctx, websocket.MessageText, []byte(`{"type":"wake_spotify","quiet":true}`))
}

func newNavRelay(cfg NavConfig, log librespot.Logger, emit func(*ApiEvent), gateway func() string) *navRelay {
	return &navRelay{cfg: cfg, log: log, emit: emit, gateway: gateway}
}

func (n *navRelay) Status() NavState {
	n.mu.Lock()
	defer n.mu.Unlock()
	return n.state
}

func (n *navRelay) phoneURL() string {
	if n.cfg.PhoneURL != "" {
		return n.cfg.PhoneURL
	}
	gw := n.gateway()
	if gw == "" {
		return ""
	}
	return fmt.Sprintf("ws://%s:%d%s", gw, navPhonePort, navPhonePath)
}

// run keeps a connection to the companion app until ctx ends
func (n *navRelay) run(ctx context.Context) {
	retry := navRetryMin
	lastURL := ""
	for ctx.Err() == nil {
		url := n.phoneURL()
		if url != "" {
			if url != lastURL {
				n.log.Infof("nav: connecting to companion app at %s", url)
				lastURL = url
			}
			if err := n.session(ctx, url); err != nil && ctx.Err() == nil {
				n.log.Debugf("nav: companion app unavailable: %v", err)
			} else {
				retry = navRetryMin
			}
		}
		select {
		case <-ctx.Done():
			return
		case <-time.After(retry):
		}
		retry = min(retry*2, navRetryMax)
	}
}

// keepAlive closes the connection once the phone stops answering pings, so
// run() dials again instead of waiting on a link that's already gone
func (n *navRelay) keepAlive(ctx context.Context, conn *websocket.Conn) {
	t := time.NewTicker(navPingEvery)
	defer t.Stop()
	for {
		select {
		case <-ctx.Done():
			return
		case <-t.C:
		}
		pingCtx, cancel := context.WithTimeout(ctx, navPingTimeout)
		err := conn.Ping(pingCtx)
		cancel()
		if err != nil && ctx.Err() == nil {
			n.log.Infof("nav: companion app stopped answering (%v); reconnecting", err)
			_ = conn.CloseNow()
			return
		}
	}
}

func (n *navRelay) session(ctx context.Context, url string) error {
	dialCtx, cancel := context.WithTimeout(ctx, 5*time.Second)
	conn, _, err := websocket.Dial(dialCtx, url, nil)
	cancel()
	if err != nil {
		return err
	}
	defer func() { _ = conn.CloseNow() }()
	conn.SetReadLimit(navMaxMessageBytes)

	n.log.Info("nav: companion app connected")
	n.mu.Lock()
	n.conn = conn
	n.connHost = hostOf(url)
	n.canRelay = false
	wanted := n.notifyWanted
	voice := n.voiceWanted
	viz := n.vizWanted
	n.mu.Unlock()
	n.update(func(s *NavState) { s.Connected = true })
	pingCtx, stopPing := context.WithCancel(ctx)
	defer stopPing()
	go n.keepAlive(pingCtx, conn)
	// the phone starts with notifications off; only an "on" needs saying
	if wanted {
		go n.sendNotificationsWanted(conn, true)
	}
	if voice {
		go n.sendVoiceWanted(conn, true)
	}
	// a visualizer was on screen when the phone dropped: it measures again
	if viz {
		go n.sendVizWanted(conn, true)
	}
	// the phone's copy of the settings, brought up to date
	if n.settingsForBackup != nil {
		go n.sendSettingsBackup(conn, n.settingsForBackup())
	}
	defer func() {
		n.mu.Lock()
		n.conn = nil
		n.canRelay = false
		n.mu.Unlock()
		n.disconnected()
	}()

	for {
		_, data, err := conn.Read(ctx)
		if err != nil {
			return err
		}
		var msg navMessage
		if err := json.Unmarshal(data, &msg); err != nil {
			n.log.Debugf("nav: bad message: %v", err)
			continue
		}
		if msg.Type == "update_auth" {
			var auth struct {
				Repo  string `json:"repo"`
				Token string `json:"token"`
			}
			if err := json.Unmarshal(data, &auth); err == nil && n.onUpdateAuth != nil {
				// off the reader: nothing the updater does may stall nav and media
				go n.onUpdateAuth(auth.Repo, auth.Token)
			}
			continue
		}
		if msg.Type == "caps" {
			var caps struct {
				UpdateRelay bool `json:"update_relay"`
			}
			if err := json.Unmarshal(data, &caps); err == nil {
				n.mu.Lock()
				n.canRelay = caps.UpdateRelay
				n.mu.Unlock()
			}
			continue
		}
		if strings.HasPrefix(msg.Type, "update_fetch_") {
			n.deliverRelayReply(data)
			continue
		}
		if msg.Type == "svc_status" {
			var st struct {
				Services []MusicService `json:"services"`
			}
			if err := json.Unmarshal(data, &st); err == nil {
				n.applyServices(st.Services)
			}
			continue
		}
		if msg.Type == "svc_items" {
			var r struct {
				Req int `json:"req"`
				serviceReply
			}
			if err := json.Unmarshal(data, &r); err == nil {
				n.deliverServiceReply(r.Req, r.serviceReply)
			}
			continue
		}
		if msg.Type == "voice_status" {
			var v phoneVoiceStatusMessage
			if err := json.Unmarshal(data, &v); err == nil {
				n.applyVoiceStatus(v)
			}
			continue
		}
		if msg.Type == "settings_set" {
			var r struct {
				Settings json.RawMessage `json:"settings"`
			}
			if err := json.Unmarshal(data, &r); err == nil && len(r.Settings) > 0 && n.onSettingsSet != nil {
				go n.onSettingsSet(r.Settings)
			}
			continue
		}
		if msg.Type == "settings_restore" {
			var r struct {
				Settings json.RawMessage `json:"settings"`
			}
			if err := json.Unmarshal(data, &r); err == nil && n.onSettingsRestore != nil {
				go n.onSettingsRestore(r.Settings)
			}
			continue
		}
		if msg.Type == "phone_volume_state" {
			var v PhoneVolume
			if err := json.Unmarshal(data, &v); err == nil {
				n.applyPhoneVolume(v)
			}
			continue
		}
		if msg.Type == "notification" {
			var note phoneNotificationMessage
			if err := json.Unmarshal(data, &note); err == nil {
				n.applyNotification(note)
			}
			continue
		}
		if msg.Type == "viz" {
			n.applyViz(data)
			continue
		}
		if msg.Type == "viz_status" {
			var v VizStatus
			if err := json.Unmarshal(data, &v); err == nil {
				n.applyVizStatus(v)
			}
			continue
		}
		if msg.Type == "phone_battery" {
			var b PhoneBattery
			if err := json.Unmarshal(data, &b); err == nil {
				n.applyBattery(b)
			}
			continue
		}
		if msg.Type == "call" {
			var c PhoneCall
			if err := json.Unmarshal(data, &c); err == nil {
				n.applyCall(c)
			}
			continue
		}
		if msg.Type == "route" {
			n.applyRoute(data)
			continue
		}
		if msg.Type == "drive_state" {
			n.applyDriveState(data)
			continue
		}
		if msg.Type == "media" {
			var media phoneMediaMessage
			if err := json.Unmarshal(data, &media); err == nil {
				n.applyMedia(media)
			}
			continue
		}
		n.apply(msg)
	}
}

// apply folds one validated message into the state
func (n *navRelay) apply(msg navMessage) {
	switch msg.Type {
	case "hello":
		// real offsets run from UTC-12 to UTC+14
		if off := msg.TzOffsetMin; off != nil && *off >= -12*60 && *off <= 14*60 {
			v := *off
			n.update(func(s *NavState) {
				if s.TzOffsetMin == nil || *s.TzOffsetMin != v {
					s.TzOffsetMin = &v
				}
			})
			if n.onTimeZone != nil {
				n.onTimeZone(v)
			}
		}
	case "nav":
		if !msg.Active {
			n.update(func(s *NavState) {
				s.Active, s.Title, s.Text, s.SubText, s.Icon = false, "", "", "", ""
			})
			return
		}
		icon := msg.Icon
		if !strings.HasPrefix(icon, "data:image/png;base64,") || len(icon) > navMaxIconBytes {
			icon = ""
		}
		n.update(func(s *NavState) {
			s.Active = true
			s.Title = clipRunes(msg.Title, navMaxTextRunes)
			s.Text = clipRunes(msg.Text, navMaxTextRunes)
			s.SubText = clipRunes(msg.SubText, navMaxTextRunes)
			s.Icon = icon
		})
	case "location":
		if !validFix(msg.Lat, msg.Lng) {
			return
		}
		loc := &NavLocation{
			Lat:      msg.Lat,
			Lng:      msg.Lng,
			Bearing:  finiteOr(msg.Bearing, 0),
			Speed:    math.Max(0, finiteOr(msg.Speed, 0)),
			Accuracy: math.Max(0, finiteOr(msg.Accuracy, 0)),
		}
		n.mu.Lock()
		n.state.Location = loc
		n.mu.Unlock()
		if n.emit != nil {
			n.emit(&ApiEvent{Type: ApiEventTypeNavLocation, Data: loc})
		}
	}
}

// keeps the last turn on screen through a short drop, then clears it
func (n *navRelay) disconnected() {
	n.log.Info("nav: companion app disconnected")
	n.update(func(s *NavState) { s.Connected = false })
	n.clearDriveState()
	// the phone's gone: so is the call card (the car's hands-free still has the call)
	n.applyCall(PhoneCall{State: "idle"})
	n.clearBattery()
	n.mu.Lock()
	n.vizStatus = VizStatus{}
	n.mu.Unlock()
	n.mu.Lock()
	defer n.mu.Unlock()
	if n.dropTimer != nil {
		n.dropTimer.Stop()
	}
	n.dropTimer = time.AfterFunc(navDropGrace, func() {
		stillGone := false
		n.update(func(s *NavState) {
			if !s.Connected {
				*s = NavState{TzOffsetMin: s.TzOffsetMin}
				// the route goes with the turn; update holds n.mu
				n.route = NavRoute{Rev: n.route.Rev}
				stillGone = true
			}
		})
		if stillGone {
			n.clearMedia()
		}
	})
}

func (n *navRelay) update(fn func(*NavState)) {
	n.mu.Lock()
	before := n.state
	fn(&n.state)
	// deep: the state holds lists (the phone's music services)
	changed := !reflect.DeepEqual(n.state, before)
	if changed {
		n.state.UpdatedAt = time.Now().UnixMilli()
	}
	snapshot := n.state
	n.mu.Unlock()
	if changed && n.emit != nil {
		n.emit(&ApiEvent{Type: ApiEventTypeNav, Data: snapshot})
	}
}

func validFix(lat, lng float64) bool {
	return !math.IsNaN(lat) && !math.IsNaN(lng) && lat >= -90 && lat <= 90 && lng >= -180 && lng <= 180 &&
		!(lat == 0 && lng == 0)
}

func finiteOr(v, def float64) float64 {
	if math.IsNaN(v) || math.IsInf(v, 0) {
		return def
	}
	return v
}

func clipRunes(s string, max int) string {
	r := []rune(strings.TrimSpace(s))
	if len(r) > max {
		return string(r[:max])
	}
	return string(r)
}

func (s *ConcreteApiServer) SetNavHandler(h NavHandler) {
	s.navMu.Lock()
	s.navFn = h
	s.navMu.Unlock()
}

func (s *StubApiServer) SetNavHandler(_ NavHandler) {}
