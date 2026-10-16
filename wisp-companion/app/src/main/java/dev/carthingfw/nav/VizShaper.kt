package dev.carthingfw.nav

import kotlin.math.max
import kotlin.math.pow

/**
 * Turns the phone's measured bands into bar heights with range. Each band is
 * measured against its own loudest over the last half minute or so (music has
 * far more bass than treble, so one shared reference starves the treble), and
 * a floor and a curve spread them out: a quiet verse sits low, a chorus
 * reaches the top, silence falls to nothing.
 *
 * It used to measure each band against its own last few seconds, which kept
 * every bar near full. Tuned on the Drive Mode songs: about 10% of bars above
 * 80% and a third under 20%, where it was 20-40% and 3-16%.
 */
class VizShaper(private val bands: Int) {
    /** each band's loudest lately, in the bands' log units; falls slowly */
    private val peak = DoubleArray(bands) { MIN_PEAK }

    /** [mags] are the bands' log magnitudes (ln(1 + mean |fft|)); returns heights 0..1 */
    fun shape(mags: DoubleArray): DoubleArray = DoubleArray(bands) { b ->
        peak[b] = max(mags[b], max(MIN_PEAK, peak[b] * DECAY))
        val rel = (mags[b] / peak[b]).coerceIn(0.0, 1.0)
        // below the floor is the noise of a quiet stretch or a fade: nothing
        ((rel - FLOOR) / (1 - FLOOR)).coerceIn(0.0, 1.0).pow(CURVE)
    }

    companion object {
        /** per frame at about 20 a second: a band's peak halves over about 35 seconds */
        const val DECAY = 0.999

        /** a peak never below this (log units), so near-silence isn't blown up */
        const val MIN_PEAK = 0.3

        /** the share of a band's peak that reads as nothing */
        const val FLOOR = 0.3

        /** above 1 spreads the tops apart: only the loudest moments reach full */
        const val CURVE = 1.3
    }
}
