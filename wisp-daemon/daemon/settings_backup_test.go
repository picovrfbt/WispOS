package daemon

import "testing"

func TestUserSettingsSkipsFirstBootDefaults(t *testing.T) {
	cases := map[string]bool{
		``:                                false,
		`{}`:                              false,
		`{"v":1,"seeded_defaults":true}`:  false,
		`{"v":1,"nightMode":"on"}`:        true,
		`{"nightMode":"on"}`:              false, // no schema version: not the UI's
		`not json`:                        false,
		`{"v":1,"seeded_defaults":false}`: true,
	}
	for blob, want := range cases {
		if got := userSettings([]byte(blob)); got != want {
			t.Errorf("userSettings(%s) = %v, want %v", blob, got, want)
		}
	}
}
