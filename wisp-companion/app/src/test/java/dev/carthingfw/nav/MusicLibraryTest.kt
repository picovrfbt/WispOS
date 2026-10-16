package dev.carthingfw.nav

import org.json.JSONObject
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Test

class YtMusicNowTest {
    // a "next" answer: the queue panel with the playing song selected, and its like button
    private val next = JSONObject(
        """
        {"contents":{"singleColumnMusicWatchNextResultsRenderer":{"tabbedRenderer":{"watchNextTabbedResultsRenderer":{"tabs":[{"tabRenderer":{"content":{"musicQueueRenderer":{"content":{"playlistPanelRenderer":{"contents":[
          {"playlistPanelVideoRenderer":{"title":{"runs":[{"text":"Before"}]},"videoId":"aaaaaaaaaaa","selected":false}},
          {"playlistPanelVideoRenderer":{"title":{"runs":[{"text":"Now"}]},"videoId":"bbbbbbbbbbb","selected":true}},
          {"playlistPanelVideoRenderer":{"title":{"runs":[{"text":"Next One"}]},"shortBylineText":{"runs":[{"text":"M83"}]},"videoId":"ccccccccccc",
             "navigationEndpoint":{"watchEndpoint":{"videoId":"ccccccccccc","playlistId":"RDAMVM1"}},
             "thumbnail":{"thumbnails":[{"url":"https://x/c.jpg"}]}}}
        ]}}}}}}]}}}},
         "playerOverlays":{"playerOverlayRenderer":{"actions":[{"likeButtonRenderer":{"likeStatus":"LIKE"}}]}}}
        """.trimIndent(),
    )

    @Test
    fun upNextIsWhatComesAfterTheSongPlaying() {
        val up = YtMusic.upNext(next)
        assertEquals(listOf("Next One"), up.map { it.name })
        assertEquals("M83", up[0].sub)
        assertEquals("ccccccccccc", up[0].videoId)
        assertEquals("RDAMVM1", up[0].playlistId)
        assertEquals("https://x/c.jpg", up[0].image)
    }

    @Test
    fun readsTheLikeButton() {
        assertEquals("LIKE", YtMusic.likeStatus(next))
        assertNull(YtMusic.likeStatus(JSONObject("{}")))
    }
}

class YtMusicPlayTest {
    @Test
    fun aSongFromARadioOpensOnItsOwn() {
        // the radio is named for the song it started from; opening another song "in" it went back to that one
        assertEquals("https://music.youtube.com/watch?v=new", YtMusic.watchUrl("RDAMVMold", "new"))
        assertEquals("https://music.youtube.com/watch?v=new&list=PL1", YtMusic.watchUrl("PL1", "new"))
        assertEquals("https://music.youtube.com/watch?list=RDAMVMold", YtMusic.watchUrl("RDAMVMold", null))
        assertNull(YtMusic.watchUrl(null, null))
    }
}

class PlaylistMatchTest {
    @Test
    fun findsThePlaylistByName() {
        val names = listOf("Road Trip 2024", "Chill Vibes", "Gym")
        assertEquals(1, YtMusic.bestNameMatch(names, "chill vibes"))
        assertEquals(0, YtMusic.bestNameMatch(names, "road trip"))
        assertEquals(2, YtMusic.bestNameMatch(names, "gym"))
        assertNull(YtMusic.bestNameMatch(names, "sleep"))
    }
}

class ServiceLinkTest {
    @Test
    fun searchesTravelAsBrowseIds() {
        assertEquals("song" to "midnight city", YtMusicLink.parseSearch("search:song:midnight city"))
        assertEquals("artist" to "m83: live", YtMusicLink.parseSearch("search:artist:m83: live"))
        assertNull(YtMusicLink.parseSearch("search:podcast:x"))
        assertNull(YtMusicLink.parseSearch("search:song:  "))
        assertNull(YtMusicLink.parseSearch("VLPL123"))
    }
}

class SoundCloudParseTest {
    @Test
    fun findsTheClientIdInItsScripts() {
        assertEquals(
            "abcdefghijklmnopqrstuvwxyz012345",
            SoundCloud.findClientId("""x={client_id:"abcdefghijklmnopqrstuvwxyz012345",env:"production"}"""),
        )
        assertNull(SoundCloud.findClientId("nothing here"))
    }

    @Test
    fun tracksPlaylistsAndArtists() {
        val t = SoundCloud.track(JSONObject(
            """{"id":42,"title":"Glow","permalink_url":"https://soundcloud.com/a/glow",
               "artwork_url":"https://i1.sndcdn.com/artworks-x-large.jpg","user":{"username":"Ana"}}""",
        ))
        assertEquals("Glow", t.name)
        assertEquals("Ana", t.sub)
        assertEquals("track:42", t.videoId)
        assertEquals("https://i1.sndcdn.com/artworks-x-t300x300.jpg", t.image)

        val p = SoundCloud.playlist(JSONObject("""{"id":7,"title":"Drive","is_album":true,"user":{"username":"Ana"}}"""))
        assertEquals("Album · Ana", p.sub)
        assertEquals("playlist:7", p.browseId)
        assertEquals("playlist:7", p.playlistId)

        val station = SoundCloud.playlist(JSONObject("""{"urn":"soundcloud:system-playlists:artist-stations:9","title":"Station"}"""))
        assertEquals("system:soundcloud:system-playlists:artist-stations:9", station.browseId)

        val u = SoundCloud.user(JSONObject("""{"id":9,"username":"Ana","avatar_url":"https://i1.sndcdn.com/avatars-large.jpg"}"""))
        assertEquals("user:9", u.browseId)
        assertEquals("Artist", u.sub)
    }

    @Test
    fun waveformsBecomeBarHeights() {
        val w = SoundCloud.waveform("{\"height\":100,\"samples\":[0,10,50,100,20,20,5,0]}", bars = 4)
        assertEquals(listOf(10, 100, 20, 5), w)
        assertNull(SoundCloud.waveform("{\"samples\":[]}"))
    }

    @Test
    fun theSignInIsTheOauthCookie() {
        assertEquals("2-123-abcdef", SoundCloudSignInActivity.tokenIn("sc_anonymous_id=1; oauth_token=2-123-abcdef; x=y"))
        assertNull(SoundCloudSignInActivity.tokenIn("sc_anonymous_id=1"))
    }
}
