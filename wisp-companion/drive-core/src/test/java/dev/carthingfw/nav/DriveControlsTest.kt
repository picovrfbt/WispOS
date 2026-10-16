package dev.carthingfw.nav

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

class DriveControlsTest {
    private val dt = 512.0 / 44100

    private fun DriveControls.run(seconds: Double, speed: Double, accel: Double = 0.0, steer: Double = 0.0): Int {
        var hits = 0
        repeat((seconds / dt).toInt()) {
            step(dt, speed, accel, steer)
            if (hardBrake) hits++
        }
        return hits
    }

    @Test
    fun stoppedIsAHaze() {
        val c = DriveControls()
        c.run(10.0, speed = 0.0)
        assertTrue("clarity ${c.clarity}", c.clarity < 0.06)
        assertTrue("drums ${c.drums}", c.drums < 0.01)
        assertTrue("bass ${c.bass}", c.bass < 0.1)
    }

    @Test
    fun cruisingClearsAndBringsInTheParts() {
        val c = DriveControls()
        c.run(15.0, speed = 50.0)
        assertTrue("clarity ${c.clarity}", c.clarity > 0.7)
        assertTrue("drums ${c.drums}", c.drums > 0.65)
        assertTrue("bass ${c.bass}", c.bass > 0.95)
        assertEquals(0.0, c.surge, 0.01)
    }

    @Test
    fun pushingOpensEverythingAndTheWah() {
        val c = DriveControls()
        c.run(10.0, speed = 40.0)
        val before = c.clarity
        c.run(2.0, speed = 45.0, accel = 5.0)
        assertTrue(c.clarity > before)
        assertTrue("surge ${c.surge}", c.surge > 0.5)
        assertTrue("pedal ${c.pedal}", c.pedal > 0.8)
    }

    @Test
    fun aHardBrakeHitsOnce() {
        val c = DriveControls()
        c.run(5.0, speed = 50.0)
        assertEquals(1, c.run(1.0, speed = 40.0, accel = -6.0))
        assertTrue("drums pull back ${c.drums}", c.drums < 0.5)
        // gentle braking never hits
        assertEquals(0, c.run(2.0, speed = 30.0, accel = -2.0))
        assertFalse(c.hardBrake)
    }

    @Test
    fun anOrdinaryStopHasNoHitAndAHardOneHitsOnlyOnce() {
        val c = DriveControls()
        c.run(5.0, speed = 50.0)
        // a normal stop off the highway: 4 mph/s
        assertEquals(0, c.run(3.0, speed = 30.0, accel = -4.0))
        c.run(10.0, speed = 50.0)
        // a hard stop that eases and bites again within a few seconds: one hit
        var hits = c.run(0.6, speed = 40.0, accel = -6.0)
        hits += c.run(0.6, speed = 30.0, accel = -2.0)
        hits += c.run(0.6, speed = 20.0, accel = -6.0)
        assertEquals(1, hits)
    }

    @Test
    fun aPushIsHeardWithinHalfASecond() {
        val c = DriveControls()
        c.run(10.0, speed = 40.0)
        c.run(0.5, speed = 42.0, accel = 5.0)
        assertTrue("surge ${c.surge}", c.surge > 0.6)
        assertTrue("pedal ${c.pedal}", c.pedal > 0.8)
        // and easing off lets go within a second or two
        c.run(1.5, speed = 45.0)
        assertTrue("surge after ${c.surge}", c.surge < 0.4)
    }

    @Test
    fun highwaySpeedIsEverything() {
        val c = DriveControls()
        c.run(20.0, speed = 60.0)
        assertTrue("clarity ${c.clarity}", c.clarity > 0.9)
    }

    @Test
    fun theTurnFollowsTheWheel() {
        val c = DriveControls()
        c.run(2.0, speed = 25.0, steer = 1.0)
        assertTrue(c.steer > 0.9)
        c.run(2.0, speed = 25.0, steer = -1.0)
        assertTrue(c.steer < -0.9)
    }
}
