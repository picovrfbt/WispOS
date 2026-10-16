package dev.carthingfw.nav

import android.Manifest
import android.annotation.SuppressLint
import android.content.Context
import android.content.pm.PackageManager
import android.hardware.Sensor
import android.hardware.SensorEvent
import android.hardware.SensorEventListener
import android.hardware.SensorManager
import android.location.Location
import android.location.LocationListener
import android.location.LocationManager
import android.os.Handler
import android.os.HandlerThread
import android.os.SystemClock
import kotlin.math.abs
import kotlin.math.sign
import kotlin.math.sqrt

/**
 * The drive, read from the phone however it sits in the car: speed from GPS,
 * and acceleration and steering from the motion sensors, measured against
 * gravity so the phone's angle doesn't matter.
 *
 *  speed     GPS, about once a second, carried forward between fixes by the
 *            acceleration (GPS speed is itself about a second late)
 *  accel     the accelerometer along the car's forward direction, which is
 *            learned from pulls and stops GPS agrees on and kept while the
 *            phone sits the same way in its mount (between drives too); until
 *            it's learned, GPS's change in speed for the direction and the
 *            accelerometer for how hard, less the sideways pull of a turn
 *  steering  the gyroscope's turn about the vertical: + right, - left
 */
class DriveSensors(private val ctx: Context) : SensorEventListener, LocationListener {
    private val sm = ctx.getSystemService(SensorManager::class.java)
    private val lm = ctx.getSystemService(LocationManager::class.java)
    private var thread: HandlerThread? = null

    // the latest readings (written on the sensor thread, read by the audio thread)
    @Volatile private var gpsMph = 0.0
    @Volatile private var gpsAccel = 0.0
    @Volatile private var lastFixAt = 0L
    @Volatile private var yawRate = 0.0
    @Volatile private var flatAccel = 0.0

    /** the level part of the acceleration as a vector in the phone's frame, m/s² */
    private val level = FloatArray(3)
    /** the car's forward direction in the phone's frame, learned; length near 1 once settled */
    private val forward = FloatArray(3)
    /** strong pulls or stops seen along [forward] since the phone last moved */
    private var forwardSamples = 0
    /** the acceleration along [forward], mph/s (+ speeding up); valid once [forwardKnown] */
    @Volatile private var aheadAccel = 0.0
    @Volatile private var forwardKnown = false

    /** the phone was being moved (picked up, put down): turns aren't believed till then */
    private var handledUntil = 0L

    /**
     * the turn rate smoothed over half a second: a phone buzzing in its mount
     * swings the raw reading back and forth (two drives, 2026-10-14, read
     * +0.5 then -0.3 rad/s within 0.2 s at 60 mph), which took the phone for
     * moved 120 times in half an hour and kept forgetting forward
     */
    private var yawSmooth = 0.0

    /** which way is down in the phone's frame when [forward] was learned; a tilt from it means the phone moved */
    private val downAtLearn = FloatArray(3)
    private var downKnown = false

    /** the sideways pull through two smoothing stages: a weave of the car stays, a phone buzzing in its mount doesn't */
    private var side1 = 0.0
    private var side2 = 0.0

    private val gravity = FloatArray(3)
    private var haveGravity = false

    /** smoothed speed, for the audio thread's own pace */
    private var speedNow = 0.0
    private var accelNow = 0.0

    val hasGps: Boolean get() = SystemClock.elapsedRealtime() - lastFixAt < 5_000

    // the readings as they came, for the drive recording (DriveRecorder)
    val rawGpsMph: Double get() = gpsMph
    val rawGpsAccel: Double get() = gpsAccel
    val rawYawRate: Double get() = yawRate
    val rawFlatAccel: Double get() = flatAccel
    val rawForwardKnown: Boolean get() = forwardKnown
    val rawAheadAccel: Double get() = aheadAccel
    /** how far the phone has tilted from where forward was learned (0 when it isn't) */
    val rawTiltDeg: Double get() = if (downKnown) tiltDegrees(gravity, downAtLearn) else 0.0

    @SuppressLint("MissingPermission") // checked just below
    fun start() {
        restoreForward()
        val t = HandlerThread("drive-sensors").apply { start() }
        thread = t
        val h = Handler(t.looper)
        sm?.getDefaultSensor(Sensor.TYPE_GRAVITY)?.let { sm.registerListener(this, it, SensorManager.SENSOR_DELAY_GAME, h) }
        sm?.getDefaultSensor(Sensor.TYPE_GYROSCOPE)?.let { sm.registerListener(this, it, SensorManager.SENSOR_DELAY_GAME, h) }
        sm?.getDefaultSensor(Sensor.TYPE_LINEAR_ACCELERATION)?.let {
            sm.registerListener(this, it, SensorManager.SENSOR_DELAY_GAME, h)
        }
        if (ctx.checkSelfPermission(Manifest.permission.ACCESS_FINE_LOCATION) == PackageManager.PERMISSION_GRANTED) {
            // as often as the phone's GPS gives it
            lm?.requestLocationUpdates(LocationManager.GPS_PROVIDER, 0L, 0f, this, t.looper)
        }
    }

    fun stop() {
        saveForward()
        sm?.unregisterListener(this)
        lm?.removeUpdates(this)
        thread?.quitSafely()
        thread = null
    }

    /**
     * The drive now, stepped by the audio thread every [dt] seconds:
     * speed (mph), acceleration (mph/s) and steering (-1..1)
     */
    fun read(dt: Double): Triple<Double, Double, Double> {
        val trend = if (hasGps) gpsAccel else 0.0
        var accel = trend
        if (forwardKnown) {
            // the push along the car, as it happens: shake in the mount averages out
            // along one direction, where its size alone (below) never does
            accel = aheadAccel
        } else if (abs(trend) > 0.4) {
            // the accelerometer's push, without the turn's sideways pull (v × turn rate)
            val turnPull = speedNow * MPH_TO_MS * abs(yawRate) * MS2_TO_MPH_S
            val ahead = sqrt((flatAccel * flatAccel - turnPull * turnPull).coerceAtLeast(0.0))
            // never far past what GPS says: a phone shaking in its mount read half a g
            // at a gentle pull (a second drive, 2026-10-13)
            accel = sign(trend) * minOf(maxOf(abs(trend), ahead), abs(trend) * 1.6 + 1.0)
        }
        accelNow = DriveControls.follow(accelNow, accel, 0.05, 0.15, dt)

        if (hasGps && forwardKnown) {
            // carried forward by the push between fixes, and pulled back to GPS. GPS
            // speed is about a second old when it comes, so it's aimed where GPS will
            // be by then rather than dragging the car's speed back a second
            speedNow = (speedNow + accelNow * dt).coerceAtLeast(0.0)
            val ahead = (gpsMph + accelNow * GPS_LAG_S).coerceAtLeast(0.0)
            speedNow = DriveControls.follow(speedNow, ahead, 0.8, 0.8, dt)
        } else if (hasGps) {
            // no push to carry it yet: straight after GPS, as quick as it was before
            speedNow = DriveControls.follow(speedNow, gpsMph, 0.6, 0.6, dt)
        } else {
            // a lost GPS fix eases the music down rather than leaving it at speed
            speedNow = DriveControls.follow(speedNow, 0.0, 0.6, 0.6, dt)
        }

        // a turn by how hard it pulls sideways (speed × turn rate), so a highway curve
        // and a city corner both swing the music as much as they're felt
        val yaw = yawRate
        val sideways = speedNow * MPH_TO_MS * yaw
        val now = SystemClock.elapsedRealtime()
        yawSmooth = DriveControls.follow(yawSmooth, yaw, YAW_SMOOTH_S, YAW_SMOOTH_S, dt)
        // turning faster than any car does, for half a second: the phone itself is
        // being moved, and turns aren't believed for a moment. Forward is only
        // forgotten when the phone tilts in its mount (onSensorChanged), which a
        // car's turn never makes it do
        val moved = abs(yawSmooth) > MAX_CAR_YAW_RAD_S || abs(speedNow * MPH_TO_MS * yawSmooth) > MAX_SIDEWAYS_MS2
        if (moved) handledUntil = now + 1_000
        // two gentle smoothing stages pass a car's weave (under about 1.5 a second)
        // and drop the faster buzz of a phone in its mount
        side1 = DriveControls.follow(side1, if (moved) 0.0 else sideways, SIDE_TAU_S, SIDE_TAU_S, dt)
        side2 = DriveControls.follow(side2, side1, SIDE_TAU_S, SIDE_TAU_S, dt)
        // turning left is a positive turn about "up"; the music wants + for right
        // small corrections and road shake on the highway sit inside the dead zone
        val pull = ((abs(side2) - DEAD_ZONE_MS2) / (FULL_SWING_MS2 - DEAD_ZONE_MS2)).coerceIn(0.0, 1.0)
        val steer = if (speedNow < 4 || now < handledUntil) 0.0 else -sign(side2) * pull
        return Triple(speedNow, accelNow, steer)
    }

    override fun onSensorChanged(e: SensorEvent) {
        when (e.sensor.type) {
            Sensor.TYPE_GRAVITY -> {
                e.values.copyInto(gravity, endIndex = 3)
                haveGravity = true
                // the phone tilted in the car (picked up, re-seated): what was forward isn't
                if (downKnown && tiltDegrees(gravity, downAtLearn) > MAX_TILT_DEG) forgetForward()
            }
            Sensor.TYPE_GYROSCOPE -> if (haveGravity) {
                // the turn about the vertical, whichever way the phone faces
                val g = norm(gravity)
                yawRate = (e.values[0] * gravity[0] + e.values[1] * gravity[1] + e.values[2] * gravity[2]) / g
            }
            Sensor.TYPE_LINEAR_ACCELERATION -> if (haveGravity) {
                // the push along the road: the part of the acceleration that's level
                val g = norm(gravity)
                val up = (e.values[0] * gravity[0] + e.values[1] * gravity[1] + e.values[2] * gravity[2]) / g
                val total = e.values[0] * e.values[0] + e.values[1] * e.values[1] + e.values[2] * e.values[2]
                val size = sqrt((total - up * up).coerceAtLeast(0.0)) * MS2_TO_MPH_S
                flatAccel += SENSOR_SMOOTH * (size - flatAccel)
                // the same level push as a direction, for learning which way is forward
                for (i in 0..2) {
                    val flat = e.values[i] - up * gravity[i] / g
                    level[i] += SENSOR_SMOOTH.toFloat() * (flat.toFloat() - level[i])
                }
                learnForward()
            }
        }
    }

    /**
     * While GPS says the car is clearly speeding up or slowing and it isn't
     * turning, the level push points forward (or back): averaged, that's the
     * car's forward in the phone's frame
     */
    private fun learnForward() {
        val fresh = SystemClock.elapsedRealtime() - lastFixAt < 2_000
        val n = sqrt(level[0] * level[0] + level[1] * level[1] + level[2] * level[2].toDouble())
        if (fresh && abs(gpsAccel) > LEARN_ACCEL_MPH_S && abs(yawRate) < LEARN_MAX_YAW && n > LEARN_MIN_MS2) {
            if (!downKnown) {
                gravity.copyInto(downAtLearn)
                downKnown = true
            }
            val s = (sign(gpsAccel) / n).toFloat()
            for (i in 0..2) forward[i] += LEARN_RATE * (level[i] * s - forward[i])
            forwardSamples++
        }
        val f = sqrt(forward[0] * forward[0] + forward[1] * forward[1] + forward[2] * forward[2].toDouble())
        // settled: enough of it, and pointing one way (not averaging out to nothing)
        forwardKnown = forwardSamples >= LEARN_SAMPLES && f > 0.6
        if (f > 0.1) {
            aheadAccel = (level[0] * forward[0] + level[1] * forward[1] + level[2] * forward[2]) / f * MS2_TO_MPH_S
        }
    }

    private fun forgetForward() {
        forward.fill(0f)
        forwardSamples = 0
        forwardKnown = false
        downKnown = false
    }

    // the mount doesn't move between drives: forward is kept with the tilt it was learned at
    private fun saveForward() {
        if (!forwardKnown || !downKnown) return
        val prefs = ctx.getSharedPreferences(PREFS, Context.MODE_PRIVATE).edit()
        for (i in 0..2) {
            prefs.putFloat("f$i", forward[i])
            prefs.putFloat("d$i", downAtLearn[i])
        }
        prefs.apply()
    }

    // taken back as it was; the first gravity reading forgets it if the phone sits another way now
    private fun restoreForward() {
        val p = ctx.getSharedPreferences(PREFS, Context.MODE_PRIVATE)
        if (!p.contains("f0")) return
        for (i in 0..2) {
            forward[i] = p.getFloat("f$i", 0f)
            downAtLearn[i] = p.getFloat("d$i", 0f)
        }
        forwardSamples = LEARN_SAMPLES
        downKnown = true
        forwardKnown = true
    }

    override fun onLocationChanged(l: Location) {
        if (!l.hasSpeed()) return
        val now = SystemClock.elapsedRealtime()
        val mph = l.speed * MS_TO_MPH
        val dt = (now - lastFixAt) / 1000.0
        if (lastFixAt != 0L && dt in 0.2..3.0) {
            gpsAccel += 0.6 * ((mph - gpsMph) / dt - gpsAccel)
        } else {
            gpsAccel = 0.0
        }
        gpsMph = mph
        lastFixAt = now
    }

    override fun onAccuracyChanged(sensor: Sensor?, accuracy: Int) {}

    @Deprecated("Deprecated in Java")
    override fun onStatusChanged(provider: String?, status: Int, extras: android.os.Bundle?) {}
    override fun onProviderEnabled(provider: String) {}
    override fun onProviderDisabled(provider: String) {}

    private fun norm(v: FloatArray) = sqrt((v[0] * v[0] + v[1] * v[1] + v[2] * v[2]).toDouble()).coerceAtLeast(0.1)

    companion object {
        private const val PREFS = "drive_sensors"

        /** the angle between two directions (gravity in the phone's frame), in degrees */
        fun tiltDegrees(a: FloatArray, b: FloatArray): Double {
            val na = sqrt((a[0] * a[0] + a[1] * a[1] + a[2] * a[2]).toDouble())
            val nb = sqrt((b[0] * b[0] + b[1] * b[1] + b[2] * b[2]).toDouble())
            if (na < 1e-3 || nb < 1e-3) return 0.0
            val c = ((a[0] * b[0] + a[1] * b[1] + a[2] * b[2]) / (na * nb)).coerceIn(-1.0, 1.0)
            return Math.toDegrees(kotlin.math.acos(c))
        }

        /** how old GPS speed is when it arrives (the phone smooths it over about a second) */
        const val GPS_LAG_S = 0.9

        /** each motion reading's share of the smoothed push (about 0.06 s at 50 a second) */
        const val SENSOR_SMOOTH = 0.3

        /** the phone tilted this far from how it sat when forward was learned: it's been moved */
        const val MAX_TILT_DEG = 15.0

        /** the turn rate's smoothing, for telling a turn from the phone being handled */
        const val YAW_SMOOTH_S = 0.5

        const val MS_TO_MPH = 2.23694
        const val MPH_TO_MS = 1 / MS_TO_MPH
        const val MS2_TO_MPH_S = 2.23694

        /** a turn pulling this hard sideways (about 0.3 g) swings the music all the way */
        const val FULL_SWING_MS2 = 2.5

        /** less sideways pull than this isn't a turn (a first drive's highway shake reached it) */
        const val DEAD_ZONE_MS2 = 1.0

        /** each smoothing stage on the sideways pull (two of them, 0.1 s each) */
        const val SIDE_TAU_S = 0.1

        /** beyond these, smoothed, it's the phone moving, not the car (a first drive saw 2 rad/s at 57 mph) */
        const val MAX_CAR_YAW_RAD_S = 1.0
        const val MAX_SIDEWAYS_MS2 = 7.0

        /** learning forward: only from a clear pull or stop (GPS), going straight, felt by the phone */
        // 2.0 gave under 20 s to learn from in half an hour on two drives (2026-10-14)
        const val LEARN_ACCEL_MPH_S = 1.5
        const val LEARN_MAX_YAW = 0.1
        const val LEARN_MIN_MS2 = 0.6
        const val LEARN_RATE = 0.02f
        /** about 2 seconds of clear pulls or stops (the sensor runs at about 50 a second) */
        const val LEARN_SAMPLES = 100
    }
}
