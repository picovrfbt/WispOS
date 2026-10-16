package daemon

import (
	"net/http"
	"strconv"
	"strings"
)

// library browsing for the UI, served from the same Pathfinder fetchers the voice catalog uses

const (
	libraryPageDefault = 50
	libraryPageMax     = 100
)

// the libraryV3 filters the browser exposes
var libraryFilters = map[string]string{
	"playlists": "Playlists",
	"albums":    "Albums",
	"artists":   "Artists",
}

// reads offset/limit, clamping limit so one request can't stall the player loop
func libraryPaging(r *http.Request) (offset, limit int) {
	q := r.URL.Query()
	offset, _ = strconv.Atoi(q.Get("offset"))
	if offset < 0 {
		offset = 0
	}
	limit, _ = strconv.Atoi(q.Get("limit"))
	if limit <= 0 {
		limit = libraryPageDefault
	} else if limit > libraryPageMax {
		limit = libraryPageMax
	}
	return offset, limit
}

func (s *ConcreteApiServer) registerLibraryRoutes(m *http.ServeMux) {
	// GET /library/list?filter=playlists|albums|artists&offset=&limit=
	m.HandleFunc("/library/list", func(w http.ResponseWriter, r *http.Request) {
		if r.Method != "GET" {
			w.WriteHeader(http.StatusMethodNotAllowed)
			return
		}
		filter, ok := libraryFilters[strings.ToLower(r.URL.Query().Get("filter"))]
		if !ok {
			w.WriteHeader(http.StatusBadRequest)
			return
		}
		offset, limit := libraryPaging(r)
		s.handleRequest(ApiRequest{Type: ApiRequestTypeCatalogPage, Data: ApiRequestDataCatalogPage{
			Kind: catalogKindLibraryList, Filter: filter, Offset: offset, Limit: limit,
		}}, w)
	})

	// GET /library/recents?offset=&limit= : every library entity, most recently played first
	m.HandleFunc("/library/recents", func(w http.ResponseWriter, r *http.Request) {
		if r.Method != "GET" {
			w.WriteHeader(http.StatusMethodNotAllowed)
			return
		}
		offset, limit := libraryPaging(r)
		s.handleRequest(ApiRequest{Type: ApiRequestTypeCatalogPage, Data: ApiRequestDataCatalogPage{
			Kind: catalogKindLibraryList, Order: "Recents", Offset: offset, Limit: limit,
		}}, w)
	})

	// GET /library/playlist?uri=spotify:playlist:...&offset=&limit=
	m.HandleFunc("/library/playlist", func(w http.ResponseWriter, r *http.Request) {
		if r.Method != "GET" {
			w.WriteHeader(http.StatusMethodNotAllowed)
			return
		}
		uri := r.URL.Query().Get("uri")
		if !strings.HasPrefix(uri, "spotify:playlist:") {
			w.WriteHeader(http.StatusBadRequest)
			return
		}
		offset, limit := libraryPaging(r)
		s.handleRequest(ApiRequest{Type: ApiRequestTypeCatalogPage, Data: ApiRequestDataCatalogPage{
			Kind: catalogKindPlaylistTracks, Uri: uri, Offset: offset, Limit: limit,
		}}, w)
	})

	// GET /library/liked?offset=&limit=
	m.HandleFunc("/library/liked", func(w http.ResponseWriter, r *http.Request) {
		if r.Method != "GET" {
			w.WriteHeader(http.StatusMethodNotAllowed)
			return
		}
		offset, limit := libraryPaging(r)
		s.handleRequest(ApiRequest{Type: ApiRequestTypeCatalogPage, Data: ApiRequestDataCatalogPage{
			Kind: catalogKindLiked, Offset: offset, Limit: limit,
		}}, w)
	})
}
