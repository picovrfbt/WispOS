package daemon

import "testing"

func TestNormalizeLoose(t *testing.T) {
	cases := map[string]string{
		"I wanna hear Daft Punk":                "play daft punk",
		"Can you please put on Midnight City?":  "play midnight city",
		"hey wisp, I'd like to listen to Drake": "play drake",
		"play something by Fred again":          "play fred again",
		"queue up Blinding Lights":              "queue blinding lights",
		"add Levitating to the queue":           "queue levitating",
		"play Starboy next":                     "queue starboy",
		"a little louder please":                "turn it up",
		"it's too loud":                         "turn it down",
		"skip this song":                        "next",
		"I don't like this":                     "next",
		"hold on":                               "pause",
		"keep playing":                          "resume",
		"I love this song":                      "like this",
		// already a command: left alone
		"play Midnight City by M83": "play midnight city by m83",
		"next":                      "next",
	}
	for in, want := range cases {
		if got := normalizeLoose(in); got != want {
			t.Errorf("normalizeLoose(%q) = %q, want %q", in, got, want)
		}
	}
}

func TestUnderstand(t *testing.T) {
	cases := []struct {
		in, what, arg string
	}{
		{"what's playing", askNowPlaying, ""},
		{"what song is this", askNowPlaying, ""},
		{"who sings this", askArtist, ""},
		{"who's this by", askArtist, ""},
		{"what album is this from", askAlbum, ""},
		{"what time is it", askTime, ""},
		{"what's the weather like", askWeather, ""},
		{"is it going to rain", askWeather, ""},
		{"when will we get there", askArrival, ""},
		{"how much longer", askArrival, ""},
		{"are we there yet", askArrival, ""},
		{"what's my next turn", askNextTurn, ""},
		{"how's my battery", askBattery, ""},
		{"play the album", doAlbum, ""},
		{"play the whole album", doAlbum, ""},
		{"more by them", doArtist, ""},
		{"play more like this", doArtist, ""},
		{"no the other one", doOtherOne, ""},
		{"wrong song", doOtherOne, ""},
		{"start it over", doRestart, ""},
		{"play it again", doRestart, ""},
		{"start drive mode", doDriveStart, ""},
		{"turn off drive mode", doDriveStop, ""},
		{"turn on night mode", doNight, "on"},
		{"night mode off", doNight, "off"},
		{"make it brighter", doBrighter, ""},
		{"dim the screen", doDimmer, ""},
		{"auto brightness on", doAutoBright, "on"},
		{"hide the lyrics", doLyrics, "off"},
		{"take me home", doNavigate, "home"},
		{"navigate to the nearest gas station", doNavigate, "the nearest gas station"},
		{"go home", doNavigate, "home"},
		{"call mom", doCall, "mom"},
		{"play something chill", doMood, "chill"},
		{"put on some upbeat music", doMood, "upbeat"},
		{"I wanna hear something relaxing", doMood, "relaxing"},
		{"play some 90s music", doMood, "90s"},
		{"give john a call", doCall, "john"},
	}
	for _, c := range cases {
		u, ok := understand(normalizeLoose(c.in))
		if !ok || u.what != c.what || u.arg != c.arg {
			t.Errorf("understand(%q) = %+v %v, want %s %q", c.in, u, ok, c.what, c.arg)
		}
	}
	// these belong to the library matcher, not here
	for _, in := range []string{"go back", "play midnight city", "pause", "next", "call it a day", "play the weeknd", "queue drake", "back"} {
		if u, ok := understand(normalizeLoose(in)); ok {
			t.Errorf("understand(%q) took it as %+v", in, u)
		}
	}
}

func TestArrivalSentence(t *testing.T) {
	cases := map[string]string{
		"12 min · 5.1 mi · 3:45 PM":    "12 minutes to go, 5.1 miles. You'll get there at 3:45 PM",
		"1 hr 5 min · 70 mi · 6:10 PM": "1 hour 5 minutes to go, 70 miles. You'll get there at 6:10 PM",
		"":                             "I don't have an arrival time yet",
	}
	for in, want := range cases {
		if got := arrivalSentence(in); got != want {
			t.Errorf("arrivalSentence(%q) = %q, want %q", in, got, want)
		}
	}
}

func TestUnderstandLibrary(t *testing.T) {
	for in, want := range map[string]string{
		"Play my liked songs":                    "liked",
		"play my likes":                          "liked",
		"shuffle my liked songs":                 "shuffle liked",
		"play my liked songs on shuffle":         "shuffle liked",
		"put on my favorites":                    "liked",
		"can you play my library":                "liked",
		"my liked songs":                         "liked",
		"play my Discover Weekly":                "discover weekly",
		"play discover weekly":                   "discover weekly",
		"shuffle my release radar":               "shuffle release radar",
		"play daily mix two":                     "daily mix 2",
		"play my daily mix 3":                    "daily mix 3",
		"play my on repeat playlist":             "on repeat",
		"I want to listen to my discover weekly": "discover weekly",
	} {
		u, ok := understand(normalizeLoose(in))
		if !ok || u.what != doLibrary || u.arg != want {
			t.Errorf("%q: got %v %q (%v), want library %q", in, u.what, u.arg, ok, want)
		}
	}
	// not library requests
	for _, in := range []string{"add it to my likes", "play liked by bring me the horizon", "library", "play midnight city"} {
		if u, ok := understand(normalizeLoose(in)); ok && u.what == doLibrary {
			t.Errorf("%q read as a library request (%q)", in, u.arg)
		}
	}
}
