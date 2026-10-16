package dev.carthingfw.nav

import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test
import kotlin.random.Random

class VizShaperTest {
    private val n = 24

    // music-like frames: strong bass falling off to the treble, each band moving
    // from frame to frame, at [loud] (log units)
    private fun song(loud: Double, frames: Int, seed: Int = 1): List<DoubleArray> {
        val r = Random(seed)
        return List(frames) { DoubleArray(n) { b -> loud * (1.0 - 0.7 * b / (n - 1)) * (0.25 + 0.75 * Math.pow(r.nextDouble(), 1.5)) } }
    }

    private fun VizShaper.feed(frames: List<DoubleArray>): List<DoubleArray> = frames.map { shape(it) }

    @Test
    fun aSongHasRangeNotFullBars() {
        val out = VizShaper(n).feed(song(4.5, 600)).drop(100).flatMap { it.toList() }
        val high = out.count { it > 0.8 }.toDouble() / out.size
        val low = out.count { it < 0.2 }.toDouble() / out.size
        assertTrue("over 80%: $high", high < 0.2)
        assertTrue("under 20%: $low", low > 0.15)
        assertTrue("it still reaches the top: ${out.max()}", out.max() > 0.9)
    }

    @Test
    fun aQuietVerseAfterAChorusSitsLow() {
        val s = VizShaper(n)
        val chorus = s.feed(song(4.8, 200)).takeLast(100).map { it.average() }.average()
        val verse = s.feed(song(3.4, 100, seed = 2)).map { it.average() }.average()
        assertTrue("verse $verse should be well under chorus $chorus", verse < chorus * 0.6)
    }

    @Test
    fun silenceIsNothing() {
        val out = VizShaper(n).feed(List(20) { DoubleArray(n) })
        assertTrue("silence ${out.maxOf { it.max() }}", out.maxOf { it.max() } < 0.05)
        // and a song's quiet tail after it played is near nothing too
        val s = VizShaper(n)
        s.feed(song(4.5, 200))
        val tail = s.feed(List(100) { DoubleArray(n) { 0.3 } })
        assertTrue("tail ${tail.last().max()}", tail.last().max() < 0.05)
    }

    @Test
    fun theRangeDoesntDependOnThePhonesScale() {
        // a phone that measures everything a third as large looks the same
        val big = VizShaper(n).feed(song(4.5, 200)).last()
        val small = VizShaper(n).feed(song(1.5, 200)).last()
        for (b in 0 until n) assertEquals(big[b], small[b], 0.02)
    }
}
