package daemon

import (
	"strconv"
	"strings"
)

// the update notice's state, the phone's time zone, and version comparison

func normalizeVersion(v string) string {
	return strings.TrimPrefix(strings.TrimSpace(v), "v")
}

func versionLess(a, b string) bool {
	pa, prea, oka := parseVersionParts(a)
	pb, preb, okb := parseVersionParts(b)
	if !oka || !okb {
		return false
	}
	for i := range pa {
		if pa[i] != pb[i] {
			return pa[i] < pb[i]
		}
	}
	// a beta ranks below its own release so it still gets offered
	return prea && !preb
}

// numeric parts, whether a prerelease suffix was present, and whether it parsed at all
func parseVersionParts(v string) ([3]int, bool, bool) {
	var out [3]int
	if v == "" {
		return out, false, false
	}
	pre := false
	parts := strings.SplitN(v, ".", 3)
	for i, p := range parts {
		var found bool
		p, _, found = strings.Cut(p, "-")
		if found {
			pre = true
		}
		n, err := strconv.Atoi(p)
		if err != nil || n < 0 {
			return out, false, false
		}
		out[i] = n
	}
	return out, pre, true
}

func (app *App) utcOffsetMin() *int {
	app.state.Lock()
	defer app.state.Unlock()
	if app.state.UtcOffsetMin == nil {
		return nil
	}
	v := *app.state.UtcOffsetMin
	return &v
}

// setPhoneUtcOffset makes the phone's time zone the Car Thing's: the clock,
// night mode and arrival times all read utc_offset_min. The phone sends it each
// time it connects, so daylight saving follows. Kept across boots
func (app *App) setPhoneUtcOffset(off int) {
	app.state.Lock()
	changed := app.state.UtcOffsetMin == nil || *app.state.UtcOffsetMin != off || !app.state.UtcOffsetFromPhone
	if changed {
		app.state.UtcOffsetMin = &off
		app.state.UtcOffsetFromPhone = true
	}
	app.state.Unlock()
	if !changed {
		return
	}
	app.log.Infof("time: using the phone's time zone, UTC%+d:%02d", off/60, abs(off%60))
	if err := app.persistState(); err != nil {
		app.log.WithError(err).Warn("time: phone time zone not saved")
	}
}

func abs(n int) int {
	if n < 0 {
		return -n
	}
	return n
}

func (app *App) latestVersion() string {
	app.state.Lock()
	defer app.state.Unlock()
	return app.state.LatestVersion
}

func (app *App) updateMandatory() bool {
	app.state.Lock()
	defer app.state.Unlock()
	return app.state.UpdateMandatory
}

func (app *App) latestHighlights() []string {
	app.state.Lock()
	defer app.state.Unlock()
	out := make([]string, len(app.state.LatestHighlights))
	copy(out, app.state.LatestHighlights)
	return out
}

func (app *App) updateAvailable() bool {
	latest := app.latestVersion()
	if latest == "" {
		return false
	}
	return versionLess(normalizeVersion(appVersion()), normalizeVersion(latest))
}

// publishLatest feeds the updater's findings into the status fields the UI's
// update card reads ("" clears them)
func (app *App) publishLatest(latest string, highlights []string) {
	app.state.Lock()
	changed := app.state.LatestVersion != latest
	app.state.LatestVersion = latest
	app.state.LatestHighlights = highlights
	app.state.UpdateMandatory = false
	app.state.Unlock()
	if changed {
		if err := app.persistState(); err != nil {
			app.log.WithError(err).Warn("update: failed to persist latest version")
		}
	}
}
