package daemon

import (
	"context"
	"encoding/json"
	"fmt"
	"strings"
	"time"
)

// voice API

type ApiEventDataVoice struct {
	State string `json:"state"`
	Text  string `json:"text,omitempty"`
}

// ApiRequestDataSearch is the body of /player/search
type ApiRequestDataSearch struct {
	Query string `json:"query"`
	TopN  bool   `json:"top_n,omitempty"`
	// "artist", "album" or "playlist": search those instead of tracks
	Kind string `json:"kind,omitempty"`
}

// selects which Pathfinder catalog a CatalogPage request runs
type catalogKind string

const (
	catalogKindLiked          catalogKind = "liked"
	catalogKindLibraryList    catalogKind = "library_list"
	catalogKindPlaylistTracks catalogKind = "playlist_tracks"
	catalogKindTopArtists     catalogKind = "top_artists"
)

// catalog fetch
type ApiRequestDataCatalogPage struct {
	Kind   catalogKind
	Filter string
	// libraryV3 sort, e.g. "Recents"; empty keeps the server default
	Order  string
	Uri    string
	Offset int
	Limit  int
	Force  bool
}

type catalogPageResult struct {
	Items []catalogItem `json:"items"`
	Total int           `json:"total"`
}

type playerCatalogFetcher struct {
	submit func(ctx context.Context, t ApiRequestType, data any) (any, error)
}

func (f *playerCatalogFetcher) page(ctx context.Context, d ApiRequestDataCatalogPage) ([]catalogItem, int, error) {
	res, err := f.submit(ctx, ApiRequestTypeCatalogPage, d)
	if err != nil {
		return nil, 0, err
	}
	r, _ := res.(*catalogPageResult)
	if r == nil {
		return nil, 0, nil
	}
	return r.Items, r.Total, nil
}

func (f *playerCatalogFetcher) likedTracks(ctx context.Context, offset, limit int, force bool) ([]catalogItem, int, error) {
	return f.page(ctx, ApiRequestDataCatalogPage{Kind: catalogKindLiked, Offset: offset, Limit: limit, Force: force})
}
func (f *playerCatalogFetcher) libraryList(ctx context.Context, filter string, offset, limit int, force bool) ([]catalogItem, int, error) {
	return f.page(ctx, ApiRequestDataCatalogPage{Kind: catalogKindLibraryList, Filter: filter, Offset: offset, Limit: limit, Force: force})
}
func (f *playerCatalogFetcher) playlistTracks(ctx context.Context, uri string, offset, limit int, force bool) ([]catalogItem, int, error) {
	return f.page(ctx, ApiRequestDataCatalogPage{Kind: catalogKindPlaylistTracks, Uri: uri, Offset: offset, Limit: limit, Force: force})
}
func (f *playerCatalogFetcher) topArtists(ctx context.Context, offset, limit int, force bool) ([]catalogItem, int, error) {
	return f.page(ctx, ApiRequestDataCatalogPage{Kind: catalogKindTopArtists, Offset: offset, Limit: limit, Force: force})
}

// VoiceHandler runs the voice command flow (wake/clip/transcript -> search -> play).
type VoiceHandler interface {
	TriggerVoice(ctx context.Context, transcript, clipPath string) (string, error)
}

func (s *ConcreteApiServer) SetVoiceHandler(h VoiceHandler) {
	s.voiceMu.Lock()
	s.voiceFn = h
	s.voiceMu.Unlock()
}

func (s *ConcreteApiServer) Submit(ctx context.Context, t ApiRequestType, data any) (any, error) {
	if !s.playerReady.Load() {
		return nil, ErrNoSession
	}
	req, wait := NewApiRequest(t, data)
	select {
	case s.requests <- req:
	case <-ctx.Done():
		return nil, ctx.Err()
	}
	return wait(ctx)
}

func (s *StubApiServer) SetVoiceHandler(_ VoiceHandler) {}

func (s *StubApiServer) Submit(_ context.Context, _ ApiRequestType, _ any) (any, error) {
	return nil, ErrNoSession
}

// searchTrackResult is the top track for a search term
type searchTrackResult struct {
	Uri    string `json:"uri"`
	Name   string `json:"name"`
	Artist string `json:"artist"`
}

// query hashs, if they fail we rotate them
const pfSearchDesktopHash = "21b3fe49546912ba782db5c47e9ef5a7dbd20329520ba0c7d0fcfadee671d24e"
const pfFetchLibraryTracksHash = "087278b20b743578a6262c2b0b4bcd20d879c503cc359a2285baf083ef944240"

// persistant query hashes
const (
	pfLibraryV3Hash      = "9f4da031f81274d572cfedaf6fc57a737c84b43d572952200b2c36aaa8fec1c6"
	pfFetchPlaylistHash  = "bb67e0af06e8d6f52b531f97468ee4acd44cd0f82b988e15c2ea47b1148efc77"
	pfUserTopContentHash = "49ee15704de4a7fdeac65a02db20604aa11e46f02e809c55d9a89f6db9754356"
)

// json decoding is case-insensitive, so checkpoints written before the tags still load
type catalogItem struct {
	Name   string `json:"name"`
	Artist string `json:"artist"`
	Uri    string `json:"uri"`
	Image  string `json:"image,omitempty"`
}

// pfImage is the Pathfinder image shape shared by cover art, playlist images and avatars
type pfImage struct {
	Sources []struct {
		Url   string `json:"url"`
		Width int    `json:"width"`
	} `json:"sources"`
}

// the library browser draws art at ~100px: the smallest source at least 160 wide,
// else the largest one there is
func (im pfImage) url() string {
	var big, small string
	bigW, smallW := 0, -1
	for _, src := range im.Sources {
		switch {
		case src.Url == "":
		case src.Width >= 160 && (big == "" || src.Width < bigW):
			big, bigW = src.Url, src.Width
		case src.Width < 160 && src.Width > smallW:
			small, smallW = src.Url, src.Width
		}
	}
	if big != "" {
		return big
	}
	return small
}

func (p *AppPlayer) pfBody(op string, vars map[string]any) []byte {
	b, _ := json.Marshal(map[string]any{
		"operationName": op,
		"variables":     vars,
		"extensions": map[string]any{
			"persistedQuery": map[string]any{"version": 1, "sha256Hash": p.hashOf(op)},
		},
	})
	return b
}

func (p *AppPlayer) libraryTracksPage(ctx context.Context, offset, limit int, force bool) (items []catalogItem, total int, err error) {
	body := p.pfBody("fetchLibraryTracks", map[string]any{"offset": offset, "limit": limit})
	data, err := p.pathfinderQueryEx(ctx, body, force)
	if err != nil {
		return nil, 0, err
	}
	var r struct {
		Data struct {
			Me struct {
				Library struct {
					Tracks struct {
						TotalCount int `json:"totalCount"`
						Items      []struct {
							Track struct {
								Uri  string `json:"_uri"`
								Data struct {
									Name    string `json:"name"`
									Uri     string `json:"uri"`
									Artists struct {
										Items []struct {
											Profile struct {
												Name string `json:"name"`
											} `json:"profile"`
										} `json:"items"`
									} `json:"artists"`
									AlbumOfTrack struct {
										CoverArt pfImage `json:"coverArt"`
									} `json:"albumOfTrack"`
								} `json:"data"`
							} `json:"track"`
						} `json:"items"`
					} `json:"tracks"`
				} `json:"library"`
			} `json:"me"`
		} `json:"data"`
	}
	if err := json.Unmarshal(data, &r); err != nil {
		return nil, 0, err
	}
	tr := r.Data.Me.Library.Tracks
	for _, it := range tr.Items {
		d := it.Track.Data
		if d.Name == "" {
			continue
		}
		uri := d.Uri
		if uri == "" {
			uri = it.Track.Uri
		}
		var artist string
		if len(d.Artists.Items) > 0 {
			artist = d.Artists.Items[0].Profile.Name
		}
		items = append(items, catalogItem{Name: d.Name, Artist: artist, Uri: uri, Image: d.AlbumOfTrack.CoverArt.url()})
	}
	return items, tr.TotalCount, nil
}

// fetches one page of the libraryV3 list filtered to a single entity type
// an empty filter returns every entity type; an empty order keeps the server default
func (p *AppPlayer) libraryV3Page(ctx context.Context, filter, order string, offset, limit int, force bool) (items []catalogItem, total int, err error) {
	filters := []string{}
	if filter != "" {
		filters = []string{filter}
	}
	var orderVar any
	if order != "" {
		orderVar = order
	}
	body := p.pfBody("libraryV3", map[string]any{
		"filters":                      filters,
		"order":                        orderVar,
		"textFilter":                   "",
		"features":                     []string{"LIKED_SONGS", "YOUR_EPISODES_V2", "PRERELEASES", "EVENTS"},
		"limit":                        limit,
		"offset":                       offset,
		"flatten":                      true,
		"expandedFolders":              []string{},
		"folderUri":                    nil,
		"includeFoldersWhenFlattening": false,
	})
	data, err := p.pathfinderQueryEx(ctx, body, force)
	if err != nil {
		return nil, 0, err
	}
	var r struct {
		Data struct {
			Me struct {
				LibraryV3 struct {
					TotalCount int `json:"totalCount"`
					Items      []struct {
						Item struct {
							Data struct {
								Typename string `json:"__typename"`
								Uri      string `json:"uri"`
								Name     string `json:"name"`
								Artists  struct {
									Items []struct {
										Profile struct {
											Name string `json:"name"`
										} `json:"profile"`
									} `json:"items"`
								} `json:"artists"`
								// playlists carry images, albums coverArt, artists an avatar
								Images struct {
									Items []pfImage `json:"items"`
								} `json:"images"`
								CoverArt pfImage `json:"coverArt"`
								Visuals  struct {
									AvatarImage pfImage `json:"avatarImage"`
								} `json:"visuals"`
								Profile struct {
									Name string `json:"name"`
								} `json:"profile"`
								// playlists name their owner here rather than under artists
								OwnerV2 struct {
									Data struct {
										Name string `json:"name"`
									} `json:"data"`
								} `json:"ownerV2"`
							} `json:"data"`
							URI string `json:"_uri"`
						} `json:"item"`
					} `json:"items"`
				} `json:"libraryV3"`
			} `json:"me"`
		} `json:"data"`
	}
	if err := json.Unmarshal(data, &r); err != nil {
		return nil, 0, err
	}
	lib := r.Data.Me.LibraryV3
	for _, it := range lib.Items {
		d := it.Item.Data
		uri := d.Uri
		if uri == "" {
			uri = it.Item.URI
		}
		name := d.Name
		if name == "" {
			// artists keep their name under profile
			name = d.Profile.Name
		}
		if name == "" || uri == "" {
			continue
		}
		var artist string
		if len(d.Artists.Items) > 0 {
			artist = d.Artists.Items[0].Profile.Name
		} else {
			artist = d.OwnerV2.Data.Name
		}
		image := d.CoverArt.url()
		if image == "" && len(d.Images.Items) > 0 {
			image = d.Images.Items[0].url()
		}
		if image == "" {
			image = d.Visuals.AvatarImage.url()
		}
		items = append(items, catalogItem{Name: name, Artist: artist, Uri: uri, Image: image})
	}
	return items, lib.TotalCount, nil
}

// fetches one page of a playlists tracks
func (p *AppPlayer) playlistTracksPage(ctx context.Context, uri string, offset, limit int, force bool) (items []catalogItem, total int, err error) {
	body := p.pfBody("fetchPlaylist", map[string]any{
		"uri": uri, "offset": offset, "limit": limit,
		"enableWatchFeedEntrypoint": false,
	})
	data, err := p.pathfinderQueryEx(ctx, body, force)
	if err != nil {
		return nil, 0, err
	}
	var r struct {
		Data struct {
			PlaylistV2 struct {
				Content struct {
					TotalCount int `json:"totalCount"`
					Items      []struct {
						ItemV2 struct {
							Uri  string `json:"_uri"`
							Data struct {
								Name    string `json:"name"`
								Uri     string `json:"uri"`
								Artists struct {
									Items []struct {
										Profile struct {
											Name string `json:"name"`
										} `json:"profile"`
									} `json:"items"`
								} `json:"artists"`
								AlbumOfTrack struct {
									CoverArt pfImage `json:"coverArt"`
								} `json:"albumOfTrack"`
							} `json:"data"`
						} `json:"itemV2"`
					} `json:"items"`
				} `json:"content"`
			} `json:"playlistV2"`
		} `json:"data"`
	}
	if err := json.Unmarshal(data, &r); err != nil {
		return nil, 0, err
	}
	c := r.Data.PlaylistV2.Content
	for _, it := range c.Items {
		d := it.ItemV2.Data
		if d.Name == "" {
			continue
		}
		uri := d.Uri
		if uri == "" {
			uri = it.ItemV2.Uri
		}
		var artist string
		if len(d.Artists.Items) > 0 {
			artist = d.Artists.Items[0].Profile.Name
		}
		items = append(items, catalogItem{Name: d.Name, Artist: artist, Uri: uri, Image: d.AlbumOfTrack.CoverArt.url()})
	}
	return items, c.TotalCount, nil
}

// routes a CatalogPage request to the right entity fetcher
// one library page; past this the UI shows Retry rather than Loading
const catalogPageTimeout = 25 * time.Second

func (p *AppPlayer) catalogPage(ctx context.Context, d ApiRequestDataCatalogPage) (*catalogPageResult, error) {
	limit := d.Limit
	if limit <= 0 {
		limit = 50
	}
	var (
		items []catalogItem
		total int
		err   error
	)
	switch d.Kind {
	case catalogKindLiked:
		items, total, err = p.libraryTracksPage(ctx, d.Offset, limit, d.Force)
	case catalogKindLibraryList:
		items, total, err = p.libraryV3Page(ctx, d.Filter, d.Order, d.Offset, limit, d.Force)
	case catalogKindPlaylistTracks:
		items, total, err = p.playlistTracksPage(ctx, d.Uri, d.Offset, limit, d.Force)
	case catalogKindTopArtists:
		items, total, err = p.topArtistsPage(ctx, d.Offset, limit, d.Force)
	default:
		return nil, fmt.Errorf("unknown catalog kind: %s", d.Kind)
	}
	if err != nil {
		return nil, err
	}
	return &catalogPageResult{Items: items, Total: total}, nil
}

// topArtistsPage fetches one page of the users top artists
func (p *AppPlayer) topArtistsPage(ctx context.Context, offset, limit int, force bool) (items []catalogItem, total int, err error) {
	body := p.pfBody("userTopContent", map[string]any{
		"includeTopArtists": true,
		"includeTopTracks":  false,
		"topArtistsInput":   map[string]any{"offset": offset, "limit": limit, "sortBy": "AFFINITY"},
		"topTracksInput":    map[string]any{"offset": 0, "limit": 1, "sortBy": "AFFINITY"},
	})
	data, err := p.pathfinderQueryEx(ctx, body, force)
	if err != nil {
		return nil, 0, err
	}
	var r struct {
		Data struct {
			Me struct {
				Profile struct {
					TopArtists struct {
						TotalCount int `json:"totalCount"`
						Items      []struct {
							Data struct {
								Uri     string `json:"uri"`
								Profile struct {
									Name string `json:"name"`
								} `json:"profile"`
								Name string `json:"name"`
							} `json:"data"`
						} `json:"items"`
					} `json:"topArtists"`
				} `json:"profile"`
			} `json:"me"`
		} `json:"data"`
	}
	if err := json.Unmarshal(data, &r); err != nil {
		return nil, 0, err
	}
	ta := r.Data.Me.Profile.TopArtists
	for _, it := range ta.Items {
		name := it.Data.Profile.Name
		if name == "" {
			name = it.Data.Name
		}
		if name == "" || it.Data.Uri == "" {
			continue
		}
		items = append(items, catalogItem{Name: name, Uri: it.Data.Uri})
	}
	return items, ta.TotalCount, nil
}

// searchEntities runs the same searchDesktop query for artists, albums or
// playlists, for "play the album X" when X isn't in the library. Artist holds
// the album's artist or the playlist's owner
func (p *AppPlayer) searchEntities(ctx context.Context, query, kind string) ([]searchTrackResult, error) {
	if strings.TrimSpace(query) == "" {
		return nil, ErrBadRequest
	}
	body := p.pfBody("searchDesktop", map[string]any{
		"searchTerm":                     query,
		"offset":                         0,
		"limit":                          10,
		"numberOfTopResults":             10,
		"includeAudiobooks":              false,
		"includeArtistHasConcertsField":  false,
		"includePreReleases":             false,
		"includeAuthors":                 false,
		"includeEpisodeContentRatingsV2": false,
	})
	data, err := p.pathfinderQuery(ctx, body)
	if err != nil {
		return nil, err
	}
	out, err := parseSearchEntities(data, kind)
	if err != nil {
		return nil, err
	}
	if len(out) == 0 {
		return nil, ErrNotFound
	}
	return out, nil
}

// searchEntity is one artist, album or playlist in a searchDesktop answer;
// items come as {data: ...} or, in some schema versions, {item: {data: ...}}
type searchEntity struct {
	Uri     string `json:"uri"`
	Name    string `json:"name"`
	Profile struct {
		Name string `json:"name"`
	} `json:"profile"`
	Artists struct {
		Items []struct {
			Profile struct {
				Name string `json:"name"`
			} `json:"profile"`
		} `json:"items"`
	} `json:"artists"`
	OwnerV2 struct {
		Data struct {
			Name string `json:"name"`
		} `json:"data"`
	} `json:"ownerV2"`
}

type searchEntityItems struct {
	Items []struct {
		Data searchEntity `json:"data"`
		Item struct {
			Data searchEntity `json:"data"`
		} `json:"item"`
	} `json:"items"`
}

func parseSearchEntities(data []byte, kind string) ([]searchTrackResult, error) {
	var r struct {
		Data struct {
			SearchV2 struct {
				Artists   searchEntityItems `json:"artists"`
				AlbumsV2  searchEntityItems `json:"albumsV2"`
				Playlists searchEntityItems `json:"playlists"`
			} `json:"searchV2"`
		} `json:"data"`
	}
	if err := json.Unmarshal(data, &r); err != nil {
		return nil, err
	}
	var items searchEntityItems
	prefix := ""
	switch kind {
	case kindArtist:
		items, prefix = r.Data.SearchV2.Artists, "spotify:artist:"
	case kindAlbum:
		items, prefix = r.Data.SearchV2.AlbumsV2, "spotify:album:"
	case kindPlaylist:
		items, prefix = r.Data.SearchV2.Playlists, "spotify:playlist:"
	default:
		return nil, ErrBadRequest
	}
	var out []searchTrackResult
	for _, it := range items.Items {
		e := it.Data
		if e.Uri == "" {
			e = it.Item.Data
		}
		// other kinds share these lists in some answers (e.g. a podcast); skip them
		if !strings.HasPrefix(e.Uri, prefix) {
			continue
		}
		name := e.Name
		if name == "" {
			name = e.Profile.Name
		}
		by := e.OwnerV2.Data.Name
		if len(e.Artists.Items) > 0 {
			by = e.Artists.Items[0].Profile.Name
		}
		if name != "" {
			out = append(out, searchTrackResult{Uri: e.Uri, Name: name, Artist: by})
		}
	}
	return out, nil
}

func (p *AppPlayer) searchTrack(ctx context.Context, query string) (*searchTrackResult, error) {
	tracks, err := p.searchTracks(ctx, query)
	if err != nil {
		return nil, err
	}
	return &tracks[0], nil
}

// searchTracks runs searchDesktop and returns up to 10 tracks from spotify
// we then rerank them to try and get a proper match rather than the spotify suggested popular rankings
func (p *AppPlayer) searchTracks(ctx context.Context, query string) ([]searchTrackResult, error) {
	if strings.TrimSpace(query) == "" {
		return nil, ErrBadRequest
	}

	body := p.pfBody("searchDesktop", map[string]any{
		"searchTerm":                     query,
		"offset":                         0,
		"limit":                          10,
		"numberOfTopResults":             10,
		"includeAudiobooks":              false,
		"includeArtistHasConcertsField":  false,
		"includePreReleases":             false,
		"includeAuthors":                 false,
		"includeEpisodeContentRatingsV2": false,
	})

	data, err := p.pathfinderQuery(ctx, body)
	if err != nil {
		return nil, err
	}

	var r struct {
		Data struct {
			SearchV2 struct {
				TracksV2 struct {
					Items []struct {
						Item struct {
							Data struct {
								Name    string `json:"name"`
								Uri     string `json:"uri"`
								Artists struct {
									Items []struct {
										Profile struct {
											Name string `json:"name"`
										} `json:"profile"`
									} `json:"items"`
								} `json:"artists"`
							} `json:"data"`
						} `json:"item"`
					} `json:"items"`
				} `json:"tracksV2"`
			} `json:"searchV2"`
		} `json:"data"`
	}
	if err := json.Unmarshal(data, &r); err != nil {
		return nil, err
	}

	var out []searchTrackResult
	for _, it := range r.Data.SearchV2.TracksV2.Items {
		d := it.Item.Data
		if d.Uri == "" {
			continue
		}
		var arts []string
		for _, a := range d.Artists.Items {
			if a.Profile.Name != "" {
				arts = append(arts, a.Profile.Name)
			}
		}
		out = append(out, searchTrackResult{Uri: d.Uri, Name: d.Name, Artist: strings.Join(arts, ", ")})
	}
	if len(out) == 0 {
		return nil, ErrNotFound
	}
	return out, nil
}
