package daemon

import (
	"context"
	"encoding/base64"
	"errors"
	"strings"
	"testing"
)

func artURL(b []byte) *string {
	s := "data:image/jpeg;base64," + base64.StdEncoding.EncodeToString(b)
	return &s
}

func TestPhoneMediaTrackAndArt(t *testing.T) {
	ev := &navEvents{}
	n := newTestRelay(ev)
	n.applyMedia(phoneMediaMessage{Present: true, App: "com.google.android.youtube", AppName: "YouTube",
		Title: " Lofi beats ", Artist: "Chill Channel", Playing: true, PositionMs: 1000, DurationMs: 60000,
		Art: artURL([]byte{0xff, 0xd8, 1, 2, 3})})
	m := n.Media()
	if !m.Present || m.Title != "Lofi beats" || m.AppName != "YouTube" || !m.Playing || m.ArtId == "" {
		t.Fatalf("unexpected media %+v", m)
	}
	art, typ := n.MediaArt()
	if typ != "image/jpeg" || len(art) != 5 {
		t.Fatalf("art %q %d bytes", typ, len(art))
	}
	if ev.count(ApiEventTypePhoneMedia) != 1 {
		t.Fatalf("want one event, got %d", ev.count(ApiEventTypePhoneMedia))
	}

	// a play-state change without art keeps the cover
	n.applyMedia(phoneMediaMessage{Present: true, App: "com.google.android.youtube", AppName: "YouTube",
		Title: "Lofi beats", Artist: "Chill Channel", Playing: false, PositionMs: 1500, DurationMs: 60000})
	if got := n.Media(); got.Playing || got.ArtId != m.ArtId {
		t.Fatalf("pause lost the art or state: %+v", got)
	}
	if ev.count(ApiEventTypePhoneMedia) != 2 {
		t.Fatal("a pause must emit")
	}

	// "" clears the cover
	empty := ""
	n.applyMedia(phoneMediaMessage{Present: true, App: "x", Title: "Next", Playing: true, Art: &empty})
	if got := n.Media(); got.ArtId != "" {
		t.Fatalf("art should be cleared: %+v", got)
	}
	if a, _ := n.MediaArt(); a != nil {
		t.Fatal("art bytes should be cleared")
	}
}

func TestPhoneMediaPositionTickIsQuiet(t *testing.T) {
	ev := &navEvents{}
	n := newTestRelay(ev)
	base := phoneMediaMessage{Present: true, App: "a", Title: "t", Playing: false, PositionMs: 5000}
	n.applyMedia(base)
	again := base
	again.PositionMs = 5200
	n.applyMedia(again)
	if ev.count(ApiEventTypePhoneMedia) != 1 {
		t.Fatal("a small position report on a paused track must not emit")
	}
	seek := base
	seek.PositionMs = 40000
	n.applyMedia(seek)
	if ev.count(ApiEventTypePhoneMedia) != 2 {
		t.Fatal("a seek must emit")
	}
}

func TestPhoneMediaGoneAndBadArt(t *testing.T) {
	ev := &navEvents{}
	n := newTestRelay(ev)
	huge := strings.Repeat("A", phoneMediaMaxArtBytes*2)
	bad := "data:image/jpeg;base64," + huge
	n.applyMedia(phoneMediaMessage{Present: true, App: "a", Title: "t", Art: &bad})
	if n.Media().ArtId != "" {
		t.Fatal("oversized art must be dropped")
	}
	gif := "data:image/gif;base64,R0lG"
	n.applyMedia(phoneMediaMessage{Present: true, App: "a", Title: "t", Art: &gif})
	if n.Media().ArtId != "" {
		t.Fatal("only jpeg/png art is kept")
	}
	n.clearMedia()
	if n.Media().Present {
		t.Fatal("cleared media must not be present")
	}
}

func TestPhoneMediaControl(t *testing.T) {
	n := newTestRelay(&navEvents{})
	if err := n.MediaControl(context.Background(), "explode"); !errors.Is(err, ErrBadMediaAction) {
		t.Fatalf("want ErrBadMediaAction, got %v", err)
	}
	if err := n.MediaControl(context.Background(), "toggle"); !errors.Is(err, ErrNoNavPhone) {
		t.Fatalf("want ErrNoNavPhone with no phone, got %v", err)
	}
}

func TestPhoneNotificationsOnlyWhenWanted(t *testing.T) {
	ev := &navEvents{}
	n := newTestRelay(ev)
	n.applyNotification(phoneNotificationMessage{App: "Messages", Title: "Sam", Text: "on my way"})
	if ev.count(ApiEventTypePhoneNotification) != 0 {
		t.Fatal("with the setting off nothing may show")
	}
	n.SetNotificationsWanted(true)
	n.applyNotification(phoneNotificationMessage{App: "Messages", Title: "Sam", Text: "on my way"})
	n.applyNotification(phoneNotificationMessage{App: "Messages"})
	if ev.count(ApiEventTypePhoneNotification) != 1 {
		t.Fatalf("want one banner, got %d", ev.count(ApiEventTypePhoneNotification))
	}
	if !phoneNotificationsFromSettings([]byte(`{"phoneNotifications":true}`)) || phoneNotificationsFromSettings(nil) {
		t.Fatal("setting parse")
	}
}

func TestPhoneMediaSeekNeedsASeekableTrack(t *testing.T) {
	n := newTestRelay(&navEvents{})
	n.applyMedia(phoneMediaMessage{Present: true, Title: "Live", CanSeek: true})
	if n.Media().CanSeek {
		t.Fatal("a stream without a length can't be seeked")
	}
	n.applyMedia(phoneMediaMessage{Present: true, Title: "Video", CanSeek: true, DurationMs: 60_000})
	if !n.Media().CanSeek {
		t.Fatal("a track with a length that the app can seek should say so")
	}
	if err := n.MediaSeek(context.Background(), 1000); !errors.Is(err, ErrNoNavPhone) {
		t.Fatalf("want ErrNoNavPhone with no phone, got %v", err)
	}
}

func TestPhoneVolumeNeedsThePhoneAndASaneLevel(t *testing.T) {
	ev := &navEvents{}
	n := newTestRelay(ev)
	if n.SendPhoneVolumeSteps(1) {
		t.Fatal("no companion app connected: the step can't be sent")
	}
	n.applyPhoneVolume(PhoneVolume{Volume: 20, Max: 15})
	n.applyPhoneVolume(PhoneVolume{Volume: 7, Max: 15})
	if ev.count(ApiEventTypePhoneVolume) != 1 {
		t.Fatal("only a sane level reaches the UI")
	}
}
