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
 * back to normal once Wisp has the request. Android does the lowering or
 * pausing itself: Wisp only holds the audio focus, as it does while it talks.
 *
 * If the Car Thing never says "back to normal" (it lost the tether, say), the
 * music comes back on its own after [MAX_MS].
 */
object WispHush {
    private const val MAX_MS = 30_000L

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
            if (mode != "lower" && mode != "pause") return@post
            val attrs = AudioAttributes.Builder()
                .setUsage(AudioAttributes.USAGE_ASSISTANT)
                .setContentType(AudioAttributes.CONTENT_TYPE_SPEECH)
                .build()
            val gain = if (mode == "pause") {
                AudioManager.AUDIOFOCUS_GAIN_TRANSIENT
            } else {
                AudioManager.AUDIOFOCUS_GAIN_TRANSIENT_MAY_DUCK
            }
            val req = AudioFocusRequest.Builder(gain).setAudioAttributes(attrs).build()
            if (am.requestAudioFocus(req) == AudioManager.AUDIOFOCUS_REQUEST_GRANTED) {
                held = req
                main.postDelayed(release, MAX_MS)
            }
        }
    }
}
