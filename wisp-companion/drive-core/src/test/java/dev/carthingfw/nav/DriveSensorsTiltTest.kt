package dev.carthingfw.nav

import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test

class DriveSensorsTiltTest {
    @Test
    fun sameWayDownIsNoTilt() {
        val down = floatArrayOf(0f, 6.9f, 6.9f)
        assertEquals(0.0, DriveSensors.tiltDegrees(down, floatArrayOf(0f, 0.69f, 0.69f)), 0.01)
    }

    @Test
    fun aCarTurningLeavesTheTiltAlone() {
        // a phone in a mount, as the car turns: gravity in the phone's frame barely moves
        val learned = floatArrayOf(0.4f, 6.8f, 6.9f)
        val inTheTurn = floatArrayOf(0.9f, 6.7f, 6.9f)
        assertTrue(DriveSensors.tiltDegrees(inTheTurn, learned) < DriveSensors.MAX_TILT_DEG)
    }

    @Test
    fun aPhoneLaidFlatHasMoved() {
        val upright = floatArrayOf(0f, 9.8f, 0f)
        val flat = floatArrayOf(0f, 0f, 9.8f)
        assertEquals(90.0, DriveSensors.tiltDegrees(flat, upright), 0.01)
        assertTrue(DriveSensors.tiltDegrees(flat, upright) > DriveSensors.MAX_TILT_DEG)
    }
}
