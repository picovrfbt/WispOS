package daemon

import "testing"

func TestParseAddToPlaylist(t *testing.T) {
	for in, want := range map[string]string{
		"Add this to my road trip playlist.": "road trip",
		"put this song in chill vibes":       "chill vibes",
		"add it to the gym playlist please":  "gym",
		"save this to my Sunday Morning":     "sunday morning",
		"add this to my liked songs":         "",
		"add this to liked songs":            "",
		"play midnight city":                 "",
		"add some m83 to the queue":          "",
	} {
		got, ok := parseAddToPlaylist(in)
		if got != want || ok != (want != "") {
			t.Errorf("%q: got %q %v, want %q", in, got, ok, want)
		}
	}
}
