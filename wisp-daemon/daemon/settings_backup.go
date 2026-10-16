package daemon

import (
	"bytes"
	"context"
	"encoding/json"
	"time"

	"github.com/coder/websocket"
)

// The UI's settings, kept on the phone too, so a reflash or a factory reset
// gets them back. Every change goes to the companion app; when a phone
// connects to a Car Thing that only has the UI's first-boot defaults, the
// copy on the phone comes back.

const ApiEventTypeSettingsRestored ApiEventType = "settings/restored"

// settingsMaxBytes matches the cap on PUT /settings
const settingsMaxBytes = 64 * 1024

// userSettings is true for settings someone chose, false for none at all or
// the defaults the UI writes on a first boot (marked "seeded_defaults")
func userSettings(blob []byte) bool {
	if len(bytes.TrimSpace(blob)) == 0 {
		return false
	}
	var s struct {
		V      *int `json:"v"`
		Seeded bool `json:"seeded_defaults"`
	}
	return json.Unmarshal(blob, &s) == nil && s.V != nil && !s.Seeded
}

// SendSettingsBackup hands the settings to a connected phone to keep
func (n *navRelay) SendSettingsBackup(blob []byte) {
	n.mu.Lock()
	c := n.conn
	n.mu.Unlock()
	if c != nil {
		go n.sendSettingsBackup(c, blob)
	}
}

func (n *navRelay) sendSettingsBackup(c *websocket.Conn, blob []byte) {
	if !userSettings(blob) {
		return
	}
	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()
	msg, _ := json.Marshal(map[string]any{"type": "settings_backup", "settings": json.RawMessage(blob)})
	if err := c.Write(ctx, websocket.MessageText, msg); err != nil {
		n.log.Debugf("nav: settings backup not sent: %v", err)
	}
}

// restoreSettings takes the phone's copy if this Car Thing has nothing of its
// own yet; true when it did
func (app *App) restoreSettings(blob []byte) bool {
	if len(blob) == 0 || len(blob) > settingsMaxBytes || !userSettings(blob) {
		return false
	}
	if userSettings(app.GetSettings()) {
		// this Car Thing's own choices win; the phone gets those instead
		return false
	}
	if err := app.PutSettings(blob); err != nil {
		app.log.WithError(err).Warn("settings: restoring the phone's copy failed")
		return false
	}
	app.log.Info("settings: restored from the phone's backup")
	app.server.Emit(&ApiEvent{Type: ApiEventTypeSettingsRestored})
	return true
}
