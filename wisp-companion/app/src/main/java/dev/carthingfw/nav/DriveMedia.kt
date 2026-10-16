package dev.carthingfw.nav

import android.content.Context
import android.graphics.Bitmap
import android.graphics.Canvas
import android.graphics.LinearGradient
import android.graphics.Paint
import android.graphics.RadialGradient
import android.graphics.Shader
import android.media.MediaMetadata
import android.media.session.MediaSession
import android.media.session.PlaybackState
import android.os.Handler
import android.os.Looper

/**
 * Drive Mode as the phone's music: a media session, so the car's own screen,
 * the lock screen and the notification say "Drive Mode · Ethereal" with its
 * cover, and the steering wheel's play/pause and stop reach it.
 */
class DriveMedia(
    ctx: Context,
    private val genre: String,
    onPlay: () -> Unit,
    onPause: () -> Unit,
    onStop: () -> Unit,
) {
    private val session = MediaSession(ctx, "WispDrive")

    val token: MediaSession.Token get() = session.sessionToken

    init {
        session.setCallback(
            object : MediaSession.Callback() {
                override fun onPlay() = onPlay()
                override fun onPause() = onPause()
                override fun onStop() = onStop()
            },
            Handler(Looper.getMainLooper()),
        )
        val name = if (genre == "lofi") "Lo-fi" else genre.replaceFirstChar { it.uppercase() }
        val art = cover(genre)
        session.setMetadata(
            MediaMetadata.Builder()
                .putString(MediaMetadata.METADATA_KEY_TITLE, "Drive Mode · $name")
                .putString(MediaMetadata.METADATA_KEY_ARTIST, "Wisp")
                .putString(MediaMetadata.METADATA_KEY_ALBUM, "Music that follows your driving")
                .putString(MediaMetadata.METADATA_KEY_DISPLAY_TITLE, "Drive Mode · $name")
                .putString(MediaMetadata.METADATA_KEY_DISPLAY_SUBTITLE, "Wisp")
                .putBitmap(MediaMetadata.METADATA_KEY_ALBUM_ART, art)
                .putBitmap(MediaMetadata.METADATA_KEY_DISPLAY_ICON, art)
                // no end: it plays as long as the drive does
                .putLong(MediaMetadata.METADATA_KEY_DURATION, -1L)
                .build(),
        )
        setPlaying(true)
        session.isActive = true
    }

    fun setPlaying(playing: Boolean) {
        session.setPlaybackState(
            PlaybackState.Builder()
                .setActions(
                    PlaybackState.ACTION_PLAY or PlaybackState.ACTION_PAUSE or
                        PlaybackState.ACTION_PLAY_PAUSE or PlaybackState.ACTION_STOP,
                )
                .setState(
                    if (playing) PlaybackState.STATE_PLAYING else PlaybackState.STATE_PAUSED,
                    PlaybackState.PLAYBACK_POSITION_UNKNOWN, if (playing) 1f else 0f,
                )
                .build(),
        )
    }

    fun release() {
        session.isActive = false
        session.release()
    }

    companion object {
        /** this app's package: its own session isn't "something else playing on the phone" */
        const val OWN_PACKAGE = "dev.carthingfw.nav"

        /** the genre's cover, the same gradients as on the Car Thing (components/DriveMode/genres.ts) */
        fun cover(genre: String, size: Int = 512): Bitmap {
            val bmp = Bitmap.createBitmap(size, size, Bitmap.Config.ARGB_8888)
            val c = Canvas(bmp)
            val s = size.toFloat()
            val p = Paint(Paint.ANTI_ALIAS_FLAG)
            fun radial(cx: Float, cy: Float, r: Float, rgb: Int, alpha: Int) {
                p.shader = RadialGradient(
                    cx * s, cy * s, r * s,
                    intArrayOf((alpha shl 24) or rgb, rgb and 0xFFFFFF),
                    null, Shader.TileMode.CLAMP,
                )
                c.drawRect(0f, 0f, s, s, p)
            }
            if (genre == "cinematic") {
                p.shader = LinearGradient(
                    0.15f * s, 0f, 0.85f * s, s,
                    intArrayOf(0xFFE0642A.toInt(), 0xFF8C1F3A.toInt(), 0xFF141A3A.toInt()),
                    floatArrayOf(0f, 0.5f, 1f), Shader.TileMode.CLAMP,
                )
                c.drawRect(0f, 0f, s, s, p)
                radial(0.70f, 0.22f, 0.55f, 0xFFC45C, 230)
                radial(0.25f, 0.85f, 0.70f, 0xC81E3C, 180)
            } else if (genre == "lofi") {
                p.shader = LinearGradient(
                    0.12f * s, 0f, 0.88f * s, s,
                    intArrayOf(0xFF3F7F7A.toInt(), 0xFF2A4D5E.toInt(), 0xFF1A1F33.toInt()),
                    floatArrayOf(0f, 0.5f, 1f), Shader.TileMode.CLAMP,
                )
                c.drawRect(0f, 0f, s, s, p)
                radial(0.28f, 0.24f, 0.55f, 0xFFDEAA, 215)
                radial(0.78f, 0.78f, 0.65f, 0xE88FA0, 180)
            } else {
                p.shader = LinearGradient(
                    0.1f * s, 0f, 0.9f * s, s,
                    intArrayOf(0xFF6D4BD8.toInt(), 0xFF3B2A8F.toInt(), 0xFF12204F.toInt()),
                    floatArrayOf(0f, 0.45f, 1f), Shader.TileMode.CLAMP,
                )
                c.drawRect(0f, 0f, s, s, p)
                radial(0.30f, 0.25f, 0.55f, 0xFFD6F0, 215)
                radial(0.75f, 0.80f, 0.65f, 0x50E6DC, 190)
            }
            return bmp
        }
    }
}
