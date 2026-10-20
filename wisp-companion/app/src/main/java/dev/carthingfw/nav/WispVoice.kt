package dev.carthingfw.nav

import android.content.Context
import android.media.AudioAttributes
import android.media.AudioFocusRequest
import android.media.AudioFormat
import android.media.AudioManager
import android.media.AudioTrack
import android.util.Log
import com.k2fsa.sherpa.onnx.OfflineTts
import com.k2fsa.sherpa.onnx.OfflineTtsConfig
import com.k2fsa.sherpa.onnx.OfflineTtsModelConfig
import com.k2fsa.sherpa.onnx.OfflineTtsVitsModelConfig
import org.json.JSONObject
import java.io.File
import java.util.concurrent.Executors
import java.util.concurrent.atomic.AtomicInteger
import java.util.zip.ZipInputStream

/**
 * Wisp's spoken voice: Piper's "Alan", raised a little in pitch, spoken through
 * the phone into the car while the music ducks. The Car Thing has no speaker,
 * so it sends the words and this does the rest.
 *
 * The voice (about 80 MB) comes once from the Wisp releases, as
 * wisp-voice-alan-vN.zip, and stays in the app's files. It's fetched and loaded
 * only while the Car Thing's Settings → Wisp's voice is on.
 */
object WispVoice {
    // Alan's pitch: spoken this much slower, then played this much faster, so
    // the timing comes back and the pitch rises about 2.4 semitones
    private const val PITCH = 1.15f
    private val PACK = Regex("""wisp-voice-alan-v(\d+)\.zip""")
    private const val TAG = "WispVoice"

    private val work = Executors.newSingleThreadExecutor()
    private val generation = AtomicInteger()

    @Volatile private var wanted = false
    @Volatile private var tts: OfflineTts? = null
    @Volatile private var downloading = false

    /** where the voice stands, as the Car Thing shows it in Settings */
    @Volatile
    var state = "absent"
        private set

    private fun dir(ctx: Context) = File(ctx.filesDir, "voice/alan")
    private fun installed(ctx: Context) = File(dir(ctx), ".complete").exists()

    /** the Car Thing's Wisp's voice setting: on keeps the voice ready, off lets the memory go */
    fun setWanted(ctx: Context, on: Boolean) {
        wanted = on
        val app = ctx.applicationContext
        if (on) {
            work.execute { prepare(app) }
        } else {
            work.execute {
                tts?.release()
                tts = null
            }
        }
        report(if (installed(app)) "ready" else "absent")
    }

    /**
     * speaks [text] at [speed] (0.5x to 2x) and [volume] (Wisp's own level, 0.1 to 1,
     * on top of the phone's media volume); a newer line cuts an older one off
     */
    fun say(ctx: Context, text: String, speed: Float, volume: Float = 1f) {
        val app = ctx.applicationContext
        val mine = generation.incrementAndGet()
        work.execute {
            if (mine != generation.get()) return@execute
            val engine = prepare(app) ?: return@execute
            val pace = speed.coerceIn(0.5f, 2f)
            val audio = try {
                engine.generate(text.take(300), 0, pace / PITCH)
            } catch (e: Exception) {
                Log.w(TAG, "could not speak", e)
                return@execute
            }
            if (mine != generation.get() || audio.samples.isEmpty()) return@execute
            play(app, audio.samples, (audio.sampleRate * PITCH).toInt(), volume.coerceIn(0.1f, 1f), mine)
        }
    }

    // the loaded voice, downloading it first if needed; null until it's ready
    private fun prepare(ctx: Context): OfflineTts? {
        tts?.let { return it }
        if (!installed(ctx)) {
            download(ctx)
            if (!installed(ctx)) return null
        }
        val d = dir(ctx)
        val model = d.listFiles()?.firstOrNull { it.name.endsWith(".onnx") } ?: return null.also {
            report("failed", error = "the voice files are incomplete")
        }
        return try {
            OfflineTts(
                null,
                OfflineTtsConfig(
                    model = OfflineTtsModelConfig(
                        vits = OfflineTtsVitsModelConfig(
                            model = model.path,
                            tokens = File(d, "tokens.txt").path,
                            dataDir = File(d, "espeak-ng-data").path,
                        ),
                        // phones have 6 to 8 cores: 4 says a line about twice as fast as 2
                        numThreads = 4,
                        provider = "cpu",
                    ),
                ),
            ).also {
                tts = it
                report("ready")
            }
        } catch (e: Throwable) {
            Log.w(TAG, "voice failed to load", e)
            report("failed", error = "the voice didn't load")
            null
        }
    }

    // fetches and unpacks the voice pack from the Wisp releases
    private fun download(ctx: Context) {
        if (downloading) return
        downloading = true
        try {
            val offer = AppUpdater.newestAsset(ctx, PACK)
                ?: return report("failed", error = "no voice in the Wisp releases")
            val zip = File(ctx.cacheDir, "wisp-voice.zip")
            report("downloading", 0)
            AppUpdater.download(ctx, offer, zip) { pct -> report("downloading", pct) }
            if (offer.sha256 != null && AppUpdater.sha256(zip) != offer.sha256) {
                zip.delete()
                return report("failed", error = "the voice download was damaged")
            }
            val d = dir(ctx)
            d.deleteRecursively()
            unzip(zip, d)
            zip.delete()
            File(d, ".complete").writeText(offer.version)
            report("ready")
        } catch (e: Exception) {
            Log.w(TAG, "voice download failed", e)
            report("failed", error = e.message ?: "download failed")
        } finally {
            downloading = false
        }
    }

    private fun unzip(zip: File, into: File) {
        val root = into.canonicalFile
        ZipInputStream(zip.inputStream().buffered()).use { z ->
            while (true) {
                val e = z.nextEntry ?: break
                val out = File(root, e.name).canonicalFile
                // nothing may land outside the voice folder
                if (!out.path.startsWith(root.path + File.separator)) throw IllegalStateException("bad voice pack")
                if (e.isDirectory) out.mkdirs() else {
                    out.parentFile?.mkdirs()
                    out.outputStream().use { z.copyTo(it) }
                }
            }
        }
    }

    // plays through the car, asking the music to duck while it talks
    private fun play(ctx: Context, samples: FloatArray, rate: Int, volume: Float, mine: Int) {
        val am = ctx.getSystemService(Context.AUDIO_SERVICE) as AudioManager
        val attrs = AudioAttributes.Builder()
            .setUsage(AudioAttributes.USAGE_ASSISTANCE_NAVIGATION_GUIDANCE)
            .setContentType(AudioAttributes.CONTENT_TYPE_SPEECH)
            .build()
        val focus = AudioFocusRequest.Builder(AudioManager.AUDIOFOCUS_GAIN_TRANSIENT_MAY_DUCK)
            .setAudioAttributes(attrs)
            .build()
        am.requestAudioFocus(focus)
        // music lowered while Wisp listened comes back first, or Wisp would be quiet too
        WispHush.beforeSpeaking()
        val track = AudioTrack.Builder()
            .setAudioAttributes(attrs)
            .setAudioFormat(
                AudioFormat.Builder()
                    .setEncoding(AudioFormat.ENCODING_PCM_FLOAT)
                    .setSampleRate(rate)
                    .setChannelMask(AudioFormat.CHANNEL_OUT_MONO)
                    .build(),
            )
            .setTransferMode(AudioTrack.MODE_STATIC)
            .setBufferSizeInBytes(samples.size * 4)
            .build()
        try {
            track.write(samples, 0, samples.size, AudioTrack.WRITE_BLOCKING)
            track.setVolume(volume)
            track.play()
            // until it ends, or a newer line arrives
            val endAt = System.currentTimeMillis() + samples.size * 1000L / rate + 150
            while (System.currentTimeMillis() < endAt && mine == generation.get()) Thread.sleep(50)
        } finally {
            track.stop()
            track.release()
            am.abandonAudioFocusRequest(focus)
        }
    }

    private fun report(state: String, percent: Int = 0, error: String? = null) {
        this.state = state
        NavStore.publish(
            JSONObject().put("type", "voice_status")
                .put("state", state)
                .put("percent", percent)
                .apply { if (error != null) put("error", error) }
                .toString(),
        )
    }

    /** sent to a Car Thing as it connects, so its Settings know where the voice is */
    fun statusJson(ctx: Context): String = JSONObject().put("type", "voice_status")
        .put("state", if (state == "absent" && installed(ctx)) "ready" else state)
        .put("percent", 0)
        .toString()
}
