package daemon

import (
	"encoding/json"
	"errors"
	"math"
)

// Settings changed from the companion app's Car Thing settings page. The phone
// sends only what changed ("settings_set"); each is checked against what the
// Car Thing's own Settings allows, merged into the stored settings and applied
// as if it were changed on the Car Thing, then the UI is told to take them.

const ApiEventTypeSettingsChanged ApiEventType = "settings/changed"

// remoteSetting checks one value from the phone; ok false refuses it
type remoteSetting func(raw json.RawMessage) (any, bool)

func remoteBool(raw json.RawMessage) (any, bool) {
	var b bool
	if json.Unmarshal(raw, &b) != nil {
		return nil, false
	}
	return b, true
}

// remoteNumber takes a number in [lo, hi] on a step from lo
func remoteNumber(lo, hi, step float64) remoteSetting {
	return func(raw json.RawMessage) (any, bool) {
		var f float64
		if json.Unmarshal(raw, &f) != nil || math.IsNaN(f) || math.IsInf(f, 0) || f < lo || f > hi {
			return nil, false
		}
		n := (f - lo) / step
		if math.Abs(n-math.Round(n)) > 1e-6 {
			return nil, false
		}
		v := lo + math.Round(n)*step
		// whole numbers stay whole in the stored JSON (5, not 5.0)
		if step >= 1 && math.Mod(lo, 1) == 0 {
			return int(math.Round(v)), true
		}
		return math.Round(v*1000) / 1000, true
	}
}

func remoteOneOf(choices ...string) remoteSetting {
	return func(raw json.RawMessage) (any, bool) {
		var s string
		if json.Unmarshal(raw, &s) != nil {
			return nil, false
		}
		for _, c := range choices {
			if s == c {
				return s, true
			}
		}
		return nil, false
	}
}

// remoteSettings: what the phone may set, with the same ranges as the Car
// Thing's own Settings (wisp-ui/src/settings.ts). The top buttons, Home's
// library and the check-in consent stay with the Car Thing.
var remoteSettings = map[string]remoteSetting{
	// display
	"autoBrightness":  remoteBool,
	"brightness":      remoteNumber(1, 10, 1),
	"nightMode":       remoteOneOf("off", "on", "auto"),
	"uiScalePct":      remoteNumber(85, 115, 5),
	"accentTheme":     remoteOneOf("green", "blue", "purple", "orange", "pink", "red", "album"),
	"performanceMode": remoteBool,
	"tempUnit":        remoteOneOf("F", "C"),
	// playback
	"showLyrics":    remoteBool,
	"lyricOffsetMs": remoteNumber(-500, 500, 50),
	"volumeStepPct": remoteNumber(1, 10, 1),
	"visualizer":    remoteOneOf("off", "glow", "bars", "wave", "particles"),
	"phoneLyrics":   remoteBool,
	// the phone and Wisp's voice
	"phoneNotifications": remoteBool,
	"phoneBattery":       remoteBool,
	"voiceMic":           remoteBool,
	"wispVoice":          remoteOneOf("off", "confirmations", "everything"),
	"voiceSpeed":         remoteNumber(0.5, 2, 0.1),
	"voiceVolumePct":     remoteNumber(10, 100, 10),
	// directions and updates
	"listenMusic":        remoteOneOf("lower", "pause", "off"),
	"arrivalAction":      remoteOneOf("none", "pause"),
	"autoInstallUpdates": remoteBool,
	"updateInBackground": remoteBool,
}

var errNoSettingsYet = errors.New("the Car Thing has no settings yet")

// mergeRemoteSettings applies [patch] to the stored [current] blob; refused
// keys are left out and named in the second result
func mergeRemoteSettings(current, patch []byte) ([]byte, []string, error) {
	if len(current) == 0 {
		return nil, nil, errNoSettingsYet
	}
	var all map[string]json.RawMessage
	if err := json.Unmarshal(current, &all); err != nil {
		return nil, nil, err
	}
	var changes map[string]json.RawMessage
	if err := json.Unmarshal(patch, &changes); err != nil {
		return nil, nil, err
	}
	var refused []string
	applied := 0
	for k, raw := range changes {
		check, known := remoteSettings[k]
		if !known {
			refused = append(refused, k)
			continue
		}
		v, ok := check(raw)
		if !ok {
			refused = append(refused, k)
			continue
		}
		b, _ := json.Marshal(v)
		all[k] = b
		applied++
	}
	if applied == 0 {
		return nil, refused, nil
	}
	// a choice now, not the first boot's defaults
	delete(all, "seeded_defaults")
	out, err := json.Marshal(all)
	return out, refused, err
}

// applyRemoteSettings takes a change from the phone's settings page
func (app *App) applyRemoteSettings(patch []byte) {
	if len(patch) > settingsMaxBytes {
		return
	}
	merged, refused, err := mergeRemoteSettings(app.GetSettings(), patch)
	if len(refused) > 0 {
		app.log.Warnf("settings from the phone: refused %v", refused)
	}
	if err != nil {
		app.log.WithError(err).Warn("settings from the phone not applied")
		return
	}
	if merged == nil {
		return
	}
	// as if changed on the Car Thing: brightness, mic, performance, the phone's copy
	if err := app.PutSettings(merged); err != nil {
		app.log.WithError(err).Warn("settings from the phone not saved")
		return
	}
	app.server.Emit(&ApiEvent{Type: ApiEventTypeSettingsChanged})
}
