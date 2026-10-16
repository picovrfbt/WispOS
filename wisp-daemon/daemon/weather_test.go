package daemon

import (
	"context"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
)

func TestWeatherRoundsLocationAndCaches(t *testing.T) {
	var asked []string
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		asked = append(asked, r.URL.RawQuery)
		_, _ = w.Write([]byte(`{"current":{"temperature_2m":71.6,"weather_code":2,"is_day":1}}`))
	}))
	defer srv.Close()
	c := newWeatherCache()
	c.api = srv.URL
	wx, err := c.get(context.Background(), 40.712776, -74.005974, "F")
	if err != nil || wx.Temp != 72 || wx.Summary != "Partly cloudy" || !wx.IsDay {
		t.Fatalf("got %+v %v", wx, err)
	}
	if !strings.Contains(asked[0], "latitude=40.71&longitude=-74.01") {
		t.Fatalf("only a rounded location goes out: %s", asked[0])
	}
	_, _ = c.get(context.Background(), 40.713, -74.006, "F")
	if len(asked) != 1 {
		t.Fatal("the same place within 15 minutes is answered from the cache")
	}
}
