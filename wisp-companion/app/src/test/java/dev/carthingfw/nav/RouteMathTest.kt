package dev.carthingfw.nav

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNotNull
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

class RouteMathTest {
    @Test
    fun readsMapsDistances() {
        assertEquals(152.4, RouteMath.distanceMeters("500 ft")!!, 0.1)
        assertEquals(482.8, RouteMath.distanceMeters("0.3 mi")!!, 0.1)
        assertEquals(1200.0, RouteMath.distanceMeters("1,2 km")!!, 0.1)
        assertEquals(200.0, RouteMath.distanceMeters("200 m")!!, 0.1)
        assertNull(RouteMath.distanceMeters("Now"))
    }

    @Test
    fun findsTheStreetATurnGoesOnto() {
        assertEquals("Harbor Blvd", RouteMath.streetOf("Turn right onto Harbor Blvd"))
        assertEquals("Main St", RouteMath.streetOf("Head north on Main St"))
        assertEquals("I-405 N", RouteMath.streetOf("Continue onto I-405 N"))
        assertEquals("Elm St", RouteMath.streetOf("Turn left onto Elm St toward Downtown"))
        assertEquals("Harbor Blvd", RouteMath.streetOf("Slight right onto Harbor Blvd/CA-1"))
        assertNull(RouteMath.streetOf("Keep left at the fork"))
    }

    @Test
    fun knowsWhichWayATurnGoes() {
        assertEquals(1, RouteMath.sideOf("Turn right onto Harbor Blvd"))
        assertEquals(-1, RouteMath.sideOf("Slight left onto Elm St"))
        assertEquals(0, RouteMath.sideOf("Continue onto Main St"))
        assertEquals(0, RouteMath.sideOf("Make a U-turn"))
    }

    @Test
    fun matchesStreetsHoweverTheyreSpelled() {
        assertTrue(RouteMath.sameStreet("Harbor Blvd", "Harbor Boulevard"))
        assertTrue(RouteMath.sameStreet("N Main St", "Main Street"))
        assertTrue(RouteMath.sameStreet("W 4th St", "West 4th Street"))
        assertFalse(RouteMath.sameStreet("Main St", "Main Avenue"))
        assertEquals("harbor", RouteMath.streetKey("N Harbor Blvd"))
    }

    @Test
    fun findsThePlaceInAMapsLink() {
        val pin = RouteMath.coordsInMapsUrl(
            "https://www.google.com/maps/place/Pier/@33.77,-118.19,17z/data=!3m1!4b1!4m6!3m5!1s0x0:0x1!8m2!3d33.7701!4d-118.1937",
        )!!
        // the pin, not the map's middle
        assertEquals(33.7701, pin[0], 1e-6)
        assertEquals(-118.1937, pin[1], 1e-6)
        assertEquals(37.42, RouteMath.coordsInMapsUrl("https://maps.google.com/?q=37.42,-122.08")!![0], 1e-6)
        assertEquals(51.5, RouteMath.coordsInMapsUrl("https://www.google.com/maps/@51.5,-0.12,15z")!![0], 1e-6)
        assertNull(RouteMath.coordsInMapsUrl("https://maps.app.goo.gl/AbCdEf"))
    }

    @Test
    fun splitsWhatMapsShares() {
        val (link, words) = RouteMath.splitShared("Long Beach Pier\n100 Pine Ave, Long Beach, CA\nhttps://maps.app.goo.gl/AbCdEf")
        assertEquals("https://maps.app.goo.gl/AbCdEf", link)
        assertEquals("Long Beach Pier, 100 Pine Ave, Long Beach, CA", words)
    }

    @Test
    fun simplifyKeepsTheShape() {
        // a straight road with points every few metres, then a corner
        val road = (0..100).map { pt(33.77, -118.2 + it * 0.0001) } + (1..50).map { pt(33.77 + it * 0.0001, -118.19) }
        val out = RouteMath.simplify(road, 3.0)
        assertTrue("kept ${out.size}", out.size <= 4)
        assertEquals(road.first()[1], out.first()[1], 1e-9)
        assertEquals(road.last()[0], out.last()[0], 1e-9)
        // the corner stays
        assertNotNull(out.firstOrNull { kotlin.math.abs(it[1] + 118.19) < 1e-9 && kotlin.math.abs(it[0] - 33.77) < 1e-9 })
    }

    @Test
    fun theStubGoesTheWayTheTurnDoes() {
        // driving north, the street crosses east to west
        val street = (0..20).map { pt(33.78, -118.20 + it * 0.0005) }
        val at = 10
        val right = RouteMath.stub(street, at, approach = 0.0, side = 1)
        val left = RouteMath.stub(street, at, approach = 0.0, side = -1)
        assertTrue("a right turn heads east", right.last()[1] > street[at][1])
        assertTrue("a left turn heads west", left.last()[1] < street[at][1])
        assertEquals(120.0, RouteMath.distanceM(right.first(), right.last()), 5.0)
    }

    @Test
    fun distanceToTheLine() {
        val line = listOf(pt(33.77, -118.2), pt(33.77, -118.19))
        assertEquals(0.0, RouteMath.distanceToLineM(pt(33.77, -118.195), line), 0.5)
        assertEquals(111.0, RouteMath.distanceToLineM(pt(33.771, -118.195), line), 2.0)
    }
}
