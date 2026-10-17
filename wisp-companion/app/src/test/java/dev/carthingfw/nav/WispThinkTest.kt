package dev.carthingfw.nav

import org.json.JSONObject
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

class WispThinkTest {
    @Test
    fun readsTheJsonWhateverItsWrappedIn() {
        val a = WispThink.parse("```json\n{\"action\":\"play\",\"query\":\"chill\",\"kind\":\"mood\",\"say\":\"Here you go\"}\n```")!!
        assertEquals("play", a.getString("action"))
        assertEquals("mood", a.getString("kind"))
        assertEquals("Here you go", a.getString("say"))
        // only the four fields go back to the Car Thing
        val b = WispThink.parse("""Sure! {"action":"next","extra":"ignored"}""")!!
        assertEquals("next", b.getString("action"))
        assertTrue(!b.has("extra"))
    }

    @Test
    fun nothingUsableIsNull() {
        assertNull(WispThink.parse("I'm not sure what you mean"))
        assertNull(WispThink.parse("{broken"))
    }

    @Test
    fun theContextIsInThePrompt() {
        val p = WispThink.prompt(
            "who sings this",
            JSONObject().put("now_playing", "Midnight City by M83").put("local_time", "Fri 3:15 PM"),
        )
        assertTrue(p.contains("Now playing: Midnight City by M83"))
        assertTrue(p.contains("Time: Fri 3:15 PM"))
        assertTrue(p.trimEnd().endsWith("Request: who sings this"))
    }
}
