package dev.carthingfw.nav

import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test

class VoiceActionsTest {
    private fun score(said: String, name: String) =
        VoiceActions.nameScore(VoiceActions.words(said), VoiceActions.words(name))

    @Test
    fun exactBeatsPartial() {
        assertTrue(score("mom", "Mom") > score("mom", "Mom Work"))
        assertTrue(score("john smith", "John Smith") > score("john smith", "John Smith Jr."))
    }

    @Test
    fun firstNameAndStartsCount() {
        assertTrue(score("john", "John Smith") >= 10)
        assertTrue(score("alex", "Alexandra Lee") >= 10)
    }

    @Test
    fun strangersDont() {
        assertEquals(0, score("mom", "Tom Jones"))
        assertEquals(0, score("pizza place", "Dad"))
    }
}
