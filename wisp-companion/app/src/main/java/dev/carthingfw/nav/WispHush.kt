package dev.carthingfw.nav

import android.content.Context
import android.media.AudioAttributes
import android.media.AudioFocusRequest
import android.media.AudioManager
import android.os.Handler
import android.os.Looper

/**
 * The music while Wisp listens: after "Okay Wisp" the Car Thing asks for it
 * lower (or paused) so its mics hear the driver over the car's speakers, and
 * back to normal once Wisp has the request. Pausing is Android's: Wisp holds
 * the audio focus, as it does while it talks. Lowering is Wisp's own: asked to
 * duck, Spotify hardly gets quieter, so the music volume itself goes down to
 * [LOWER_TO] of where it was, and back after.
 *
 * If the Car Thing never says "back to normal" (it lost the tether, say), the
 * music comes back on its own after [MAX_MS].
 */
object WispHush {
    private const val MAX_MS = 30_000L

    /** the music's share of its volume while Wisp listens */
    private const val LOWER_TO = 0.3

    // the volume to bring back, and the one Wisp set (if the driver turned it
    // since, theirs stands)
    private var restoreTo = -1
    private var loweredTo = -1

    private val main = Handler(Looper.getMainLooper())
    private var audio: AudioManager? = null
    private var held: AudioFocusRequest? = null
    private val release = Runnable { set(null, "off") }

    /** "lower", "pause", or "off" for back to normal */
    fun set(ctx: Context?, mode: String) {
        main.post {
            if (ctx != null) audio = ctx.getSystemService(Context.AUDIO_SERVICE) as AudioManager
            val am = audio ?: return@post
            main.removeCallbacks(release)
            held?.let { am.abandonAudioFocusRequest(it) }
            held = null
            if (mode != "lower") restore(am)
            if (mode == "lower") {
                lower(am)
                main.postDelayed(release, MAX_MS)
                return@post
            }
            if (mode != "pause") return@post
            val attrs = AudioAttributes.Builder()
                .setUsage(AudioAttributes.USAGE_ASSISTANT)
                .setContentType(AudioAttributes.CONTENT_TYPE_SPEECH)
                .build()
            val req = AudioFocusRequest.Builder(AudioManager.AUDIOFOCUS_GAIN_TRANSIENT).setAudioAttributes(attrs).build()
            if (am.requestAudioFocus(req) == AudioManager.AUDIOFOCUS_REQUEST_GRANTED) {
                held = req
                main.postDelayed(release, MAX_MS)
            }
        }
    }

    /** Wisp is about to talk: its voice plays at the music's volume on most phones */
    fun beforeSpeaking() {
        audio?.let(::restore)
    }

    @Synchronized
    private fun lower(am: AudioManager) {
        if (restoreTo >= 0) return // already down
        val now = try {
            am.getStreamVolume(AudioManager.STREAM_MUSIC)
        } catch (e: Exception) {
            return
        }
        if (now <= 1) return
        val to = (now * LOWER_TO).toInt().coerceAtLeast(1)
        try {
            am.setStreamVolume(AudioManager.STREAM_MUSIC, to, 0)
        } catch (e: Exception) {
            return // Do Not Disturb and the like
        }
        restoreTo = now
        loweredTo = to
    }

    @Synchronized
    private fun restore(am: AudioManager) {
        if (restoreTo < 0) return
        try {
            if (am.getStreamVolume(AudioManager.STREAM_MUSIC) == loweredTo) {
                am.setStreamVolume(AudioManager.STREAM_MUSIC, restoreTo, 0)
            }
        } catch (e: Exception) {
            // leave it where it is
        }
        restoreTo = -1
        loweredTo = -1
    }
}
