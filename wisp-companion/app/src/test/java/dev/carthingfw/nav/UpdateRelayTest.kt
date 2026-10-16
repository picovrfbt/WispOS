package dev.carthingfw.nav

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

class UpdateRelayTest {
    @Test
    fun tokenOnlyGoesToTheReposOwnAssets() {
        assertTrue(UpdateRelay.allowedUrl("picovrfbt/Wisp", "https://api.github.com/repos/picovrfbt/Wisp/releases/assets/123"))
        assertFalse(UpdateRelay.allowedUrl("picovrfbt/Wisp", "https://api.github.com/repos/someone/else/releases/assets/123"))
        assertFalse(UpdateRelay.allowedUrl("picovrfbt/Wisp", "https://evil.example/repos/picovrfbt/Wisp/releases/assets/1"))
        assertFalse(UpdateRelay.allowedUrl("picovrfbt/Wisp", "http://api.github.com/repos/picovrfbt/Wisp/releases/assets/1"))
        assertFalse(UpdateRelay.allowedUrl("picovrfbt/Wisp", "https://api.github.com/repos/picovrfbt/Wisp/releases/assets/1?x=@evil"))
    }

    @Test
    fun namesStayInTheFolder() {
        assertTrue(UpdateRelay.validName("wisp-core-v0.2.16.tar.gz"))
        assertFalse(UpdateRelay.validName("../etc/passwd"))
        assertFalse(UpdateRelay.validName(".hidden"))
        assertFalse(UpdateRelay.validName(""))
    }

    @Test
    fun rangesResumeOrRefuse() {
        assertEquals(0L, UpdateRelay.parseRange(null, 100))
        assertEquals(40L, UpdateRelay.parseRange("bytes=40-", 100))
        assertNull(UpdateRelay.parseRange("bytes=100-", 100))
        assertNull(UpdateRelay.parseRange("bytes=0-10", 100))
    }
}
