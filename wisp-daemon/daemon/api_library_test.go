package daemon

import (
	"encoding/json"
	"net/http/httptest"
	"testing"
)

func TestLibraryPaging(t *testing.T) {
	cases := []struct {
		query      string
		off, limit int
	}{
		{"", 0, libraryPageDefault},
		{"?offset=20&limit=10", 20, 10},
		{"?offset=-5&limit=0", 0, libraryPageDefault},
		{"?limit=5000", 0, libraryPageMax},
		{"?offset=abc", 0, libraryPageDefault},
	}
	for _, c := range cases {
		off, limit := libraryPaging(httptest.NewRequest("GET", "/library/list"+c.query, nil))
		if off != c.off || limit != c.limit {
			t.Errorf("%q: got (%d,%d), want (%d,%d)", c.query, off, limit, c.off, c.limit)
		}
	}
}

func TestPfImageURL(t *testing.T) {
	var im pfImage
	_ = json.Unmarshal([]byte(`{"sources":[
		{"url":"a640","width":640},{"url":"a64","width":64},{"url":"a300","width":300}]}`), &im)
	if got := im.url(); got != "a300" {
		t.Errorf("got %q, want the smallest source >= 160", got)
	}
	_ = json.Unmarshal([]byte(`{"sources":[{"url":"s60","width":60},{"url":"s120","width":120}]}`), &im)
	if got := im.url(); got != "s120" {
		t.Errorf("got %q, want the largest small source", got)
	}
	if got := (pfImage{}).url(); got != "" {
		t.Errorf("got %q for no sources", got)
	}
}

// checkpoints written before catalogItem had json tags must still load
func TestCatalogItemLegacyJSON(t *testing.T) {
	var it catalogItem
	if err := json.Unmarshal([]byte(`{"Name":"n","Artist":"a","Uri":"u"}`), &it); err != nil {
		t.Fatal(err)
	}
	if it.Name != "n" || it.Artist != "a" || it.Uri != "u" {
		t.Errorf("legacy decode: %+v", it)
	}
}
