package daemon

import (
	"encoding/json"
	"testing"
)

func TestSeekCommandSpeaksCurrentSpotify(t *testing.T) {
	for _, pos := range []int64{0, 93_500} {
		b, _ := json.Marshal(seekCommand(pos))
		var got struct {
			Endpoint string `json:"endpoint"`
			Position *int64 `json:"position"`
			Relative string `json:"relative"`
		}
		if err := json.Unmarshal(b, &got); err != nil {
			t.Fatal(err)
		}
		if got.Endpoint != "seek_to" || got.Position == nil || *got.Position != pos || got.Relative != "beginning" {
			t.Fatalf("seek to %d sent %s", pos, b)
		}
	}
}
