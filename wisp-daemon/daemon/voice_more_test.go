package daemon

import "testing"

func TestUnderstandMore(t *testing.T) {
	cases := []struct {
		said, what, arg string
	}{
		{"shuffle", doShuffleOn, ""},
		{"turn shuffle on", doShuffleOn, ""},
		{"shuffle off", doShuffleOff, ""},
		{"stop shuffling", doShuffleOff, ""},
		{"play it in order", doShuffleOff, ""},
		{"repeat this song", doRepeatOne, ""},
		{"put it on repeat", doRepeatOne, ""},
		{"repeat the playlist", doRepeatAll, ""},
		{"turn repeat off", doRepeatOff, ""},
		{"stop repeating", doRepeatOff, ""},
		{"volume 40", doVolumeTo, "40"},
		{"set the volume to forty", doVolumeTo, "forty"},
		{"turn it to twenty five percent", doVolumeTo, "twenty five"},
		{"max volume", doVolumeTo, ""},
		{"skip ahead 30 seconds", doSeekAhead, ""},
		{"fast forward a minute", doSeekAhead, ""},
		{"rewind", doSeekBack, ""},
		{"go back ten seconds", doSeekBack, ""},
		{"open settings", doOpen, "settings"},
		{"show me the map", doOpen, "map"},
		{"go to the home screen", doOpen, "home screen"},
		{"open home", doOpen, "home"},
		{"pull up the queue", doOpen, "queue"},
	}
	for _, c := range cases {
		u, ok := understand(c.said)
		if !ok || u.what != c.what || u.arg != c.arg {
			t.Errorf("%q: got %+v (%v), want %s %q", c.said, u, ok, c.what, c.arg)
		}
	}
}

func TestUnderstandMoreLeavesTheRest(t *testing.T) {
	// still what they meant before
	if u, ok := understand("go home"); !ok || u.what != doNavigate {
		t.Errorf("go home: %+v", u)
	}
	if u, ok := understand("take me to the beach"); !ok || u.what != doNavigate {
		t.Errorf("take me to the beach: %+v", u)
	}
	// a volume that isn't a number is left to the rest
	if u, ok := understand("volume banana"); ok && u.what == doVolumeTo {
		t.Error("volume banana understood")
	}
	for _, s := range []string{"skip", "next song", "play some jazz"} {
		if u, ok := understand(s); ok && (u.what == doSeekAhead || u.what == doLibrary || u.what == doOpen) {
			t.Errorf("%q taken as %s", s, u.what)
		}
	}
}

func TestSpokenNumbers(t *testing.T) {
	for s, want := range map[string]int{"40": 40, "forty": 40, "twenty five": 25, "twenty-five": 25, "a hundred": 100, "zero": 0, "nine": 9} {
		if n, ok := spokenNumber(s); !ok || n != want {
			t.Errorf("%q = %d %v", s, n, ok)
		}
	}
	for _, s := range []string{"101", "banana", "twenty ten"} {
		if _, ok := spokenNumber(s); ok {
			t.Errorf("%q read as a number", s)
		}
	}
	if n := seekSeconds("skip ahead 45 seconds", 30); n != 45 {
		t.Errorf("45 seconds = %d", n)
	}
	if n := seekSeconds("fast forward a minute", 30); n != 60 {
		t.Errorf("a minute = %d", n)
	}
	if n := seekSeconds("rewind", 15); n != 15 {
		t.Errorf("rewind = %d", n)
	}
}
