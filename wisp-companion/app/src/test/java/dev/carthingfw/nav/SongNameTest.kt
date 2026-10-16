package dev.carthingfw.nav

import org.json.JSONObject
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Test

class SongNameTest {
    @Test
    fun tagsWinWhenThereAreAny() {
        assertEquals(SongName.Named("M83", "Midnight City"), SongName.of("Midnight City", "M83"))
    }

    @Test
    fun anUntaggedFileIsReadFromItsName() {
        assertEquals(SongName.Named("M83", "Midnight City"), SongName.of("01 - M83 - Midnight City.mp3", ""))
        assertEquals(SongName.Named("M83", "Midnight City"), SongName.of("M83_-_Midnight_City.flac", "<unknown>"))
        assertEquals(SongName.Named("M83", "Midnight City"), SongName.of("M83 - 03. Midnight City.m4a", ""))
        assertEquals(SongName.Named("", "voice memo"), SongName.of("voice memo.m4a", ""))
        // a tagged song keeps its title as it is, extension aside
        assertEquals(SongName.Named("M83", "Wait"), SongName.of("Wait.mp3", "M83"))
        // a title with no file shape is left alone
        assertEquals(SongName.Named("", "How engines work"), SongName.of("How engines work", ""))
    }
}

class CoverSearchTest {
    @Test
    fun picksTheArtistsCoverAndMakesItBig() {
        val answer = JSONObject(
            "{\"results\":[{\"artistName\":\"Someone Else\",\"artworkUrl100\":\"https://x/a/100x100bb.jpg\"}," +
                "{\"artistName\":\"M83\",\"artworkUrl100\":\"https://x/b/100x100bb.jpg\"}]}",
        )
        assertEquals("https://x/b/600x600bb.jpg", CoverSearch.pick(answer, "M83"))
        assertNull(CoverSearch.pick(JSONObject("{\"results\":[]}"), "M83"))
    }
}
