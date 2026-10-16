package dev.carthingfw.nav

import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

class AppUpdaterTest {
    @Test
    fun comparesVersionsNumberByNumber() {
        assertTrue(AppUpdater.newer("0.4.0", "0.3.0"))
        assertTrue(AppUpdater.newer("v0.3.10", "0.3.9"))
        assertTrue(AppUpdater.newer("1.0", "0.9.9"))
        assertFalse(AppUpdater.newer("0.3.0", "0.3.0"))
        assertFalse(AppUpdater.newer("0.3", "0.3.0"))
        assertFalse(AppUpdater.newer("0.2.9", "0.3.0"))
    }
}

class AppUpdaterReleasesTest {
    private fun release(tag: String, vararg assets: String, draft: Boolean = false) = org.json.JSONObject()
        .put("tag_name", tag)
        .put("draft", draft)
        .put("assets", org.json.JSONArray().apply {
            assets.forEach { put(org.json.JSONObject().put("name", it).put("url", "https://x/$it").put("size", 1)) }
        })

    @Test
    fun findsTheNewestCompanionEvenWhenTheLatestReleaseHasNone() {
        val releases = org.json.JSONArray()
            .put(release("v0.2.9", "wisp-app-v0.2.9.tar.gz"))
            .put(release("v0.2.8", "wisp-app-v0.2.8.tar.gz", "wisp-companion-v0.5.0.apk"))
            .put(release("v0.2.7", "wisp-companion-v0.4.0.apk"))
            .put(release("v0.3.0-draft", "wisp-companion-v9.9.9.apk", draft = true))
        val offer = AppUpdater.newestOffer(releases)
        org.junit.Assert.assertEquals("0.5.0", offer?.version)
        org.junit.Assert.assertNull(AppUpdater.newestOffer(org.json.JSONArray().put(release("v1", "other.zip"))))
    }
}

class MusicServicesTest {
    @Test
    fun keepsMusicAppsAndDropsSystemPieces() {
        assertTrue(MusicServices.isMusicApp("com.google.android.apps.youtube.music", null))
        assertTrue(MusicServices.isMusicApp("app.morphe.android.apps.youtube.music", null))
        assertTrue(MusicServices.isMusicApp("app.revanced.android.apps.youtube.music", null))
        assertTrue(MusicServices.isMusicApp("com.soundcloud.android", null))
        assertFalse(MusicServices.isMusicApp("com.android.bluetooth", null))
        assertFalse(MusicServices.isMusicApp("com.samsung.android.bixby.agent", null))
        assertFalse(MusicServices.isMusicApp("com.google.android.googlequicksearchbox", null))
    }

    @Test
    fun youtubeMusicReadsAsYoutubeMusicUnderAnyShell() {
        org.junit.Assert.assertEquals("YouTube Music", MusicServices.labelFor("com.google.android.apps.youtube.music", "YouTube Music"))
        org.junit.Assert.assertEquals("YouTube Music", MusicServices.labelFor("app.morphe.android.apps.youtube.music", "YouTube Music"))
        org.junit.Assert.assertEquals("YouTube Music (YT Music Morphe)", MusicServices.labelFor("app.morphe.android.apps.youtube.music", "YT Music Morphe"))
    }
}

class YtMusicParseTest {
    // the shape of a music.youtube.com library page: a grid of two-row cards
    // (playlists, albums) and a shelf of list rows (songs), nested a few deep
    private val page = org.json.JSONObject(
        """
        {"contents":{"singleColumnBrowseResultsRenderer":{"tabs":[{"tabRenderer":{"content":{"sectionListRenderer":{"contents":[
          {"gridRenderer":{"items":[
            {"musicTwoRowItemRenderer":{
              "title":{"runs":[{"text":"Late Night Drive"}]},
              "subtitle":{"runs":[{"text":"Playlist"},{"text":" • "},{"text":"64 songs"}]},
              "thumbnailRenderer":{"musicThumbnailRenderer":{"thumbnail":{"thumbnails":[{"url":"https://x/s.jpg"},{"url":"https://x/l.jpg"}]}}},
              "navigationEndpoint":{"browseEndpoint":{"browseId":"VLPL123"}},
              "thumbnailOverlay":{"musicItemThumbnailOverlayRenderer":{"content":{"musicPlayButtonRenderer":{"playNavigationEndpoint":{"watchPlaylistEndpoint":{"playlistId":"PL123"}}}}}}
            }}
          ]}},
          {"musicShelfRenderer":{"contents":[
            {"musicResponsiveListItemRenderer":{
              "flexColumns":[
                {"musicResponsiveListItemFlexColumnRenderer":{"text":{"runs":[{"text":"Midnight City"}]}}},
                {"musicResponsiveListItemFlexColumnRenderer":{"text":{"runs":[{"text":"M83"}]}}}
              ],
              "playlistItemData":{"videoId":"vid42"},
              "thumbnail":{"musicThumbnailRenderer":{"thumbnail":{"thumbnails":[{"url":"https://x/song.jpg"}]}}}
            }}
          ]}}
        ]}}}}]}}}
        """.trimIndent(),
    )

    @Test
    fun findsCardsAndRowsWhereverTheyAre() {
        val items = YtMusic.items(page)
        org.junit.Assert.assertEquals(2, items.size)
        val pl = items[0]
        org.junit.Assert.assertEquals("Late Night Drive", pl.name)
        org.junit.Assert.assertEquals("Playlist • 64 songs", pl.sub)
        org.junit.Assert.assertEquals("https://x/l.jpg", pl.image)
        org.junit.Assert.assertEquals("VLPL123", pl.browseId)
        org.junit.Assert.assertEquals("PL123", pl.playlistId)
        val song = items[1]
        org.junit.Assert.assertEquals("Midnight City", song.name)
        org.junit.Assert.assertEquals("M83", song.sub)
        org.junit.Assert.assertEquals("vid42", song.videoId)
    }
}
