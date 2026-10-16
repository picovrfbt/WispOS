package daemon

import (
	"context"
	"encoding/json"
	"time"

	"github.com/coder/websocket"
)

// The phone's media volume, turned by the companion app. Spotify refuses
// remote volume for some phones playing to the car (volume_disabled), and not
// every phone takes the Bluetooth volume keys; the companion app is connected
// whenever the phone is, and can always turn its own volume.

const ApiEventTypePhoneVolume ApiEventType = "phone/volume"

// PhoneVolume is the phone's media volume after a change, for the overlay
type PhoneVolume struct {
	Volume int `json:"volume"`
	Max    int `json:"max"`
}

// SendPhoneVolumeSteps asks the companion app to step the phone's media volume;
// false without one connected. It doesn't wait for the phone
func (n *navRelay) SendPhoneVolumeSteps(steps int) bool {
	if steps == 0 {
		return false
	}
	n.mu.Lock()
	c := n.conn
	n.mu.Unlock()
	if c == nil {
		return false
	}
	go func() {
		ctx, cancel := context.WithTimeout(context.Background(), 3*time.Second)
		defer cancel()
		msg, _ := json.Marshal(map[string]any{"type": "phone_volume", "steps": steps})
		if err := c.Write(ctx, websocket.MessageText, msg); err != nil {
			n.log.Debugf("nav: phone volume not sent: %v", err)
		}
	}()
	return true
}

// applyPhoneVolume passes the phone's new level on to the UI
func (n *navRelay) applyPhoneVolume(v PhoneVolume) {
	if v.Max <= 0 || v.Volume < 0 || v.Volume > v.Max || n.emit == nil {
		return
	}
	n.emit(&ApiEvent{Type: ApiEventTypePhoneVolume, Data: v})
}
