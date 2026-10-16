package daemon

import (
	"context"
	"encoding/json"
	"time"

	"github.com/coder/websocket"
)

// the phone's notifications, shown as banners when the "Notifications"
// setting is on. The phone only sends them after the Car Thing asks, so
// nothing leaves it while the setting is off.

const ApiEventTypePhoneNotification ApiEventType = "phone/notification"

const notifyMaxRunes = 160

// PhoneNotification is one notification, as the UI shows it
type PhoneNotification struct {
	App   string `json:"app"`
	Title string `json:"title"`
	Text  string `json:"text,omitempty"`
}

type phoneNotificationMessage struct {
	App   string `json:"app"`
	Title string `json:"title"`
	Text  string `json:"text"`
}

// SetNotificationsWanted records the setting and tells a connected phone
func (n *navRelay) SetNotificationsWanted(on bool) {
	n.mu.Lock()
	changed := n.notifyWanted != on
	n.notifyWanted = on
	c := n.conn
	n.mu.Unlock()
	if changed && c != nil {
		go n.sendNotificationsWanted(c, on)
	}
}

func (n *navRelay) sendNotificationsWanted(c *websocket.Conn, on bool) {
	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()
	msg, _ := json.Marshal(map[string]any{"type": "notifications", "enabled": on})
	if err := c.Write(ctx, websocket.MessageText, msg); err != nil {
		n.log.Debugf("nav: notifications setting not sent: %v", err)
	}
}

// applyNotification passes one on to the UI, if it's still wanted
func (n *navRelay) applyNotification(m phoneNotificationMessage) {
	n.mu.Lock()
	wanted := n.notifyWanted
	n.mu.Unlock()
	if !wanted || n.emit == nil {
		return
	}
	p := PhoneNotification{
		App:   clipRunes(m.App, 40),
		Title: clipRunes(m.Title, notifyMaxRunes),
		Text:  clipRunes(m.Text, notifyMaxRunes),
	}
	if p.Title == "" && p.Text == "" {
		return
	}
	n.emit(&ApiEvent{Type: ApiEventTypePhoneNotification, Data: p})
}

// phoneNotificationsFromSettings reads the "Notifications" setting; off unless set
func phoneNotificationsFromSettings(body []byte) bool {
	var s struct {
		On *bool `json:"phoneNotifications"`
	}
	return json.Unmarshal(body, &s) == nil && s.On != nil && *s.On
}
