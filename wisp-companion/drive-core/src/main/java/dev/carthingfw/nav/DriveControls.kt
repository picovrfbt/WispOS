package dev.carthingfw.nav

import kotlin.math.exp
import kotlin.math.min
import kotlin.math.pow

/**
 * Drive Mode's rules: how the drive turns into the mix. A port of the
 * prototype (drive-mode-prototype/stem_drive.py and drive_music.controls),
 * stepped as the audio plays rather than over a whole recording.
 *
 * In: speed (mph), acceleration (mph per second, + speeding up), steering
 * (-1 hard left .. +1 hard right). Out: the parts' levels and the effects,
 * each following the car within a fraction of a second, eased rather than
 * snapping (drives found the first and second timings lagged behind the car).
 */
class DriveControls {
    // the drive, smoothed
    var energy = 0.0; private set
    var brake = 0.0; private set
    var steer = 0.0; private set
    var pedal = 0.0; private set

    // the parts
    var bass = 0.06; private set
    var drums = 0.0; private set
    var vocals = 0.4; private set
    var surge = 0.0; private set

    /** how clear the sound is: 0 the haze when stopped .. 1 everything, at speed */
    var clarity = 0.03; private set

    /** a hard brake just started (the Drive Recorder counts them; no sound) */
    var hardBrake = false; private set

    private var wasHardBrake = false
    /** seconds since the last hard brake was counted: one per stop, however it's braked */
    private var sinceHard = HARD_GAP_S

    /** the crossfade weight between the haze and the clear mix */
    val openness: Double get() = clarity.pow(1.3)

    fun step(dt: Double, speedMph: Double, accelMphS: Double, steering: Double) {
        val capped = min(speedMph.coerceAtLeast(0.0), 65.0)
        val pull = (accelMphS / 5.0).coerceIn(0.0, 1.0)

        energy = follow(energy, pull * (0.55 + 0.45 * smoothstep(capped, 0.0, 30.0)), 0.07, 0.7, dt)
        brake = follow(brake, (-accelMphS / 6.0).coerceIn(0.0, 1.0), 0.05, 0.5, dt)
        // quick enough to follow a deliberate weave of the car
        steer = follow(steer, steering.coerceIn(-1.0, 1.0), 0.12, 0.3, dt)
        pedal = follow(pedal, pull * 0.85 + (capped / 65.0).coerceIn(0.0, 1.0) * 0.15, 0.04, 0.2, dt)

        bass = follow(bass, (0.06 + 0.94 * smoothstep(capped, 3.0, 30.0) + 0.3 * energy).coerceIn(0.0, 1.2), 0.2, 1.0, dt)
        drums = follow(
            drums,
            (0.8 * smoothstep(capped, 10.0, 45.0) + 0.6 * energy - 0.7 * brake).coerceIn(0.0, 1.15),
            0.15, 0.9, dt,
        )
        vocals = follow(vocals, 0.4 + 0.6 * smoothstep(capped, 5.0, 40.0), 0.3, 1.2, dt)
        surge = follow(surge, (energy * 1.4).coerceIn(0.0, 1.0), 0.06, 0.5, dt)

        // everything by highway speed (about 55 mph), not only when pushing
        val clear = (0.03 + 0.92 * smoothstep(capped, 0.0, 55.0) + 0.35 * energy - 0.25 * brake).coerceIn(0.0, 1.0)
        clarity = follow(clarity, clear, 0.3, 1.0, dt)

        val hard = accelMphS < HARD_BRAKE_MPH_S
        sinceHard += dt
        hardBrake = hard && !wasHardBrake && sinceHard >= HARD_GAP_S
        if (hardBrake) sinceHard = 0.0
        wasHardBrake = hard
    }

    companion object {
        /**
         * a stop this sudden counts as a hard brake. A first drive (2026-10-13)
         * braked at 3.5..5 mph/s for ordinary stops; past 5 is a properly hard one
         */
        const val HARD_BRAKE_MPH_S = -5.0

        /** the least time between two hard brakes counted */
        const val HARD_GAP_S = 8.0

        fun smoothstep(x: Double, lo: Double, hi: Double): Double {
            val u = ((x - lo) / (hi - lo)).coerceIn(0.0, 1.0)
            return u * u * (3 - 2 * u)
        }

        /** moves toward [target] with one time constant going up and another coming down */
        fun follow(value: Double, target: Double, attack: Double, release: Double, dt: Double): Double {
            val tau = if (target > value) attack else release
            return value + (1 - exp(-dt / tau)) * (target - value)
        }
    }
}
