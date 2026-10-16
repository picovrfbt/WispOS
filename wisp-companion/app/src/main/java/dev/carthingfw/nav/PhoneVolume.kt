package dev.carthingfw.nav

import android.content.Context
import android.media.AudioManager
import org.json.JSONObject

/** the phone's music volume, turned from the Car Thing's knob */
object PhoneVolume {
    /** steps the music stream and returns the new level as a phone_volume_state message */
    fun step(ctx: Context, steps: Int): String {
        val am = ctx.getSystemService(Context.AUDIO_SERVICE) as AudioManager
        val dir = if (steps > 0) AudioManager.ADJUST_RAISE else AudioManager.ADJUST_LOWER
        repeat(kotlin.math.abs(steps)) {
            am.adjustStreamVolume(AudioManager.STREAM_MUSIC, dir, 0)
        }
        return state(ctx)
    }

    /** the music volume as it is now, so the Car Thing's bar starts at the right level */
    fun state(ctx: Context): String {
        val am = ctx.getSystemService(Context.AUDIO_SERVICE) as AudioManager
        return JSONObject().put("type", "phone_volume_state")
            .put("volume", am.getStreamVolume(AudioManager.STREAM_MUSIC))
            .put("max", am.getStreamMaxVolume(AudioManager.STREAM_MUSIC))
            .toString()
    }
}
