package dev.carthingfw.nav

import android.content.ComponentName
import android.content.Context
import android.content.Intent
import android.content.ServiceConnection
import android.media.session.MediaController
import android.media.session.PlaybackState
import android.os.Handler
import android.os.IBinder
import android.os.Looper
import android.os.SystemClock
import android.util.Log

/**
 * Keeps Spotify going while it plays for the Car Thing. With Google Maps in
 * front, Android (Samsung's most) can close a backgrounded Spotify for memory,
 * and the Car Thing drops to "Pick up where you left off" mid-song.
 *
 * While a Car Thing is linked and Spotify has played, this app stays bound to
 * Spotify's media service: an app that a running one depends on counts as in
 * use, so Android leaves it be. If Spotify is closed anyway while it was
 * playing, the binding starts it again and a play key carries on where it was.
 */
object SpotifyKeeper {
    private const val TAG = "WispSpotify"

    /** playing this recently when it went counts as closed mid-song, not stopped */
    private const val PLAYING_WITHIN_MS = 15_000L

    /** at most this many restarts in [RESTART_WINDOW_MS], so a Spotify that keeps failing is let be */
    private const val MAX_RESTARTS = 3
    private const val RESTART_WINDOW_MS = 10 * 60_000L

    /** Spotify needs a moment after starting before a play key lands */
    private const val PLAY_AFTER_MS = 2_500L

    private val main = Handler(Looper.getMainLooper())
    private var app: Context? = null
    private var linked = false
    private var bound = false
    private var lastPlayingAt = 0L
    private var resumeOnReturn = false
    private val restarts = ArrayDeque<Long>()

    private var controller: MediaController? = null
    private val callback = object : MediaController.Callback() {
        override fun onPlaybackStateChanged(state: PlaybackState?) = noteState(state)
    }

    private val connection = object : ServiceConnection {
        override fun onServiceConnected(name: ComponentName?, service: IBinder?) {
            if (!resumeOnReturn) return
            resumeOnReturn = false
            val ctx = app ?: return
            Log.i(TAG, "Spotify is back: carrying on where it was")
            main.postDelayed({ SpotifyWaker.pressPlay(ctx) }, PLAY_AFTER_MS)
        }

        // Spotify's process went: Android starts it again for this binding
        override fun onServiceDisconnected(name: ComponentName?) {
            val playing = SystemClock.elapsedRealtime() - lastPlayingAt < PLAYING_WITHIN_MS
            if (linked && playing && allowRestart()) {
                Log.w(TAG, "Spotify was closed mid-song")
                resumeOnReturn = true
            }
        }
    }

    /** a Car Thing connected */
    fun carLinked(ctx: Context) {
        main.post {
            app = ctx.applicationContext
            linked = true
            if (SystemClock.elapsedRealtime() - lastPlayingAt < PLAYING_WITHIN_MS) bind()
        }
    }

    /** the last Car Thing left */
    fun carGone() {
        main.post {
            linked = false
            resumeOnReturn = false
            unbind()
        }
    }

    /** Spotify's media session as MediaWatcher sees it now (null: it has none) */
    fun spotifySession(c: MediaController?) {
        main.post {
            if (c?.sessionToken == controller?.sessionToken) return@post
            controller?.unregisterCallback(callback)
            controller = c
            c?.registerCallback(callback, main)
            noteState(c?.playbackState)
        }
    }

    private fun noteState(state: PlaybackState?) {
        if (state?.state == PlaybackState.STATE_PLAYING || state?.state == PlaybackState.STATE_BUFFERING) {
            lastPlayingAt = SystemClock.elapsedRealtime()
            // Spotify plays for the Car Thing: hold on to it from now
            if (linked) bind()
        } else if (state != null) {
            // paused or stopped on purpose: nothing to carry on
            lastPlayingAt = 0L
        }
    }

    private fun bind() {
        val ctx = app ?: return
        if (bound) return
        val service = ctx.packageManager
            .queryIntentServices(Intent("android.media.browse.MediaBrowserService").setPackage(SpotifyWaker.SPOTIFY), 0)
            .firstOrNull()?.serviceInfo ?: return
        bound = try {
            ctx.bindService(
                Intent("android.media.browse.MediaBrowserService").setClassName(service.packageName, service.name),
                connection,
                Context.BIND_AUTO_CREATE or Context.BIND_IMPORTANT,
            )
        } catch (e: Exception) {
            Log.w(TAG, "couldn't hold on to Spotify", e)
            false
        }
        if (bound) Log.i(TAG, "holding on to Spotify while the Car Thing plays it")
    }

    private fun unbind() {
        if (!bound) return
        bound = false
        try {
            app?.unbindService(connection)
        } catch (e: Exception) {
            // already gone
        }
    }

    private fun allowRestart(): Boolean {
        val now = SystemClock.elapsedRealtime()
        while (restarts.isNotEmpty() && now - restarts.first() > RESTART_WINDOW_MS) restarts.removeFirst()
        if (restarts.size >= MAX_RESTARTS) return false
        restarts.addLast(now)
        return true
    }
}
