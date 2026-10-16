package daemon

import "testing"

func TestParseServiceVoice(t *testing.T) {
	cases := []struct {
		in   string
		want serviceVoiceRequest
		ok   bool
	}{
		{"Play Midnight City on YouTube Music.", serviceVoiceRequest{"ytmusic", "song", "midnight city"}, true},
		{"play midnight city by m83 on you tube music", serviceVoiceRequest{"ytmusic", "song", "midnight city m83"}, true},
		{"play the album hurry up we're dreaming on YT Music", serviceVoiceRequest{"ytmusic", "album", "hurry up we re dreaming"}, true},
		{"play my playlist late night drive from youtube music", serviceVoiceRequest{"ytmusic", "playlist", "late night drive"}, true},
		{"play some m83 on soundcloud", serviceVoiceRequest{"soundcloud", "artist", "m83"}, true},
		{"put on songs by fred again on sound cloud", serviceVoiceRequest{"soundcloud", "artist", "fred again"}, true},
		{"play the song youtube on youtube music", serviceVoiceRequest{"ytmusic", "song", "youtube"}, true},
		// Spotify's, as before
		{"play midnight city", serviceVoiceRequest{}, false},
		{"play music on my phone", serviceVoiceRequest{}, false},
		{"play on youtube music", serviceVoiceRequest{}, false},
		{"skip this song", serviceVoiceRequest{}, false},
	}
	for _, c := range cases {
		got, ok := parseServiceVoice(c.in)
		if ok != c.ok || got != c.want {
			t.Errorf("%q: got %+v %v, want %+v %v", c.in, got, ok, c.want, c.ok)
		}
	}
}

func TestFirstPlayable(t *testing.T) {
	it, ok := firstPlayable([]byte(`[{"name":"M83","id":"UC1"},{"name":"Midnight City","sub":"M83","video":"v1"}]`))
	if !ok || it.Video != "v1" {
		t.Fatalf("an artist card with no play button is skipped for the first song, got %+v %v", it, ok)
	}
	if _, ok := firstPlayable([]byte(`[{"name":"M83","id":"UC1"}]`)); ok {
		t.Fatal("nothing to play")
	}
}
