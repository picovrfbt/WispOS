package dev.carthingfw.nav

import android.Manifest
import android.content.Context
import android.content.pm.PackageManager
import android.media.audiofx.Visualizer
import android.os.Handler
import android.os.Looper
import android.util.Log
import org.json.JSONArray
import org.json.JSONObject
import kotlin.math.hypot
import kotlin.math.ln
import kotlin.math.max
import kotlin.math.min
import kotlin.math.pow

/**
 * The music's shape for the Car Thing's visualizer: whatever the phone is
 * playing (Spotify, YouTube Music, anything), measured from the phone's sound
 * output and sent as 24 bands, bass to treble, about 20 times a second, only
 * while the Car Thing is showing a visualizer.
 *
 * Android's Visualizer reads the phone's own output, never the microphone,
 * but still needs the Microphone permission (asked in the app's setup steps).
 */
object PhoneViz {
    private const val TAG = "WispViz"
    const val BANDS = 24

    private val main = Handler(Looper.getMainLooper())
    private var viz: Visualizer? = null
    private var wanted = false

    // the bands' heights, with range: quiet parts low, loud ones high
    private val shaper = VizShaper(BANDS)
    private var bassAvg = 0f
    private var lastStatus: Pair<Boolean, String>? = null

    fun allowed(ctx: Context) =
        ctx.checkSelfPermission(Manifest.permission.RECORD_AUDIO) == PackageManager.PERMISSION_GRANTED

    /** "viz_wanted" from the Car Thing: it's showing a visualizer, or stopped */
    fun setWanted(ctx: Context, on: Boolean) {
        main.post {
            wanted = on
            if (on) start(ctx.applicationContext) else stop()
        }
    }

    private fun start(ctx: Context) {
        if (viz != null) return status(true, "")
        if (!allowed(ctx)) return status(false, "Allow the visualizer in the Wisp app")
        try {
            val v = Visualizer(0)
            v.enabled = false
            v.captureSize = Visualizer.getCaptureSizeRange()[1].coerceAtMost(1024)
            v.scalingMode = Visualizer.SCALING_MODE_NORMALIZED
            val rate = min(Visualizer.getMaxCaptureRate(), 20_000)
            v.setDataCaptureListener(
                object : Visualizer.OnDataCaptureListener {
                    override fun onWaveFormDataCapture(v: Visualizer, w: ByteArray, rate: Int) {}
                    override fun onFftDataCapture(v: Visualizer, fft: ByteArray, rate: Int) = frame(fft, rate)
                },
                rate, false, true,
            )
            v.enabled = true
            viz = v
            status(true, "")
            Log.i(TAG, "on (${v.captureSize} points, ${rate / 1000}/s)")
        } catch (e: Exception) {
            // some phones don't let an app hear the sound output at all
            Log.w(TAG, "no visualizer on this phone", e)
            status(false, "This phone doesn't allow the visualizer")
        }
    }

    fun stop() {
        main.post {
            viz?.let {
                runCatching { it.enabled = false }
                it.release()
            }
            viz = null
        }
    }

    /** the Car Thing went away: stop measuring */
    fun disconnected() {
        wanted = false
        stop()
    }

    private fun frame(fft: ByteArray, samplingRateMilliHz: Int) {
        val n = fft.size / 2
        if (n < 8) return
        val nyquist = samplingRateMilliHz / 2000f
        val mags = DoubleArray(BANDS)
        // log-spaced bands from 40 Hz to 16 kHz, so the bass gets as much room as the treble
        for (b in 0 until BANDS) {
            val lo = 40f * (16000f / 40f).pow(b.toFloat() / BANDS)
            val hi = 40f * (16000f / 40f).pow((b + 1f) / BANDS)
            val i0 = max(1, (lo / nyquist * n).toInt())
            val i1 = max(i0 + 1, min(n - 1, (hi / nyquist * n).toInt()))
            var sum = 0f
            for (i in i0 until i1) {
                val re = fft[2 * i].toFloat()
                val im = fft[2 * i + 1].toFloat()
                sum += hypot(re, im)
            }
            mags[b] = ln(1.0 + sum / (i1 - i0))
        }
        val heights = shaper.shape(mags)
        val out = IntArray(BANDS) { (heights[it] * 255).toInt() }
        val total = heights.sum()
        // a beat: the bass well above its recent average
        val bass = (out[0] + out[1] + out[2]) / 765f
        val beat = bass > bassAvg * 1.35f && bass > 0.45f
        bassAvg = bassAvg * 0.9f + bass * 0.1f
        NavStore.publish(
            JSONObject().put("type", "viz")
                .put("b", JSONArray(out.toList()))
                .put("l", ((total / BANDS) * 255).toInt())
                .put("beat", beat)
                .toString(),
        )
    }

    private fun status(ok: Boolean, why: String) {
        val now = ok to why
        if (now == lastStatus) return
        lastStatus = now
        NavStore.publish(JSONObject().put("type", "viz_status").put("available", ok).put("why", why).toString())
    }
}
