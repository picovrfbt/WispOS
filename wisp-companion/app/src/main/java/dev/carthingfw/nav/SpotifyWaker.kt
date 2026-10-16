package dev.carthingfw.nav

import android.Manifest
import android.app.Notification
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.content.ComponentName
import android.content.Context
import android.content.Intent
import android.content.pm.PackageManager
import android.media.browse.MediaBrowser
import android.os.Handler
import android.os.Looper
import android.util.Log

/**
 * Gets Spotify back into Spotify Connect's device list so the Car Thing can
 * play on this phone. Android drops a backgrounded Spotify from Connect, and
 * the Car Thing can only control devices Connect lists.
 *
 * Tier 1 binds Spotify's media browser service (as Android Auto and watches
 * do), which starts Spotify in the background without playing anything.
 * Tier 2, only when someone is actively trying to play from the Car Thing,
 * posts a tap-to-open notification in case tier 1 isn't enough on this phone.
 */
object SpotifyWaker {
    const val SPOTIFY = "com.spotify.music"
    private const val TAG = "CarThingNav"
    private const val CHANNEL = "spotify_wake"
    private const val NOTIFICATION_ID = 3679
    private const val HOLD_MS = 20_000L
    private const val PROMPT_TIMEOUT_MS = 120_000L

    private val main = Handler(Looper.getMainLooper())
    private var browser: MediaBrowser? = null

    @Volatile
    var lastWake: String = "never"
        private set

    fun installed(ctx: Context): Boolean = try {
        ctx.packageManager.getPackageInfo(SPOTIFY, 0)
        true
    } catch (e: PackageManager.NameNotFoundException) {
        false
    }

    /** [prompt] adds the tap-to-open notification; set when a play is waiting on it */
    fun wake(ctx: Context, prompt: Boolean) {
        val app = ctx.applicationContext
        main.post {
            if (!installed(app)) {
                lastWake = "Spotify isn't installed"
                return@post
            }
            bindQuietly(app)
            if (prompt) {
                // a play is waiting on it: open Spotify itself if Android lets us
                // (Display over other apps), else start it with a media key,
                // which works from the background, and offer the notification too
                if (!openSpotify(app)) {
                    pressPlay(app)
                    postPrompt(app)
                }
            }
        }
    }

    /** brings Spotify to the front; Android allows it from the background only with overlay access */
    private fun openSpotify(ctx: Context): Boolean {
        if (!android.provider.Settings.canDrawOverlays(ctx)) return false
        val launch = ctx.packageManager.getLaunchIntentForPackage(SPOTIFY) ?: return false
        return try {
            ctx.startActivity(launch.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK))
            lastWake = "opened Spotify"
            true
        } catch (e: Exception) {
            Log.w(TAG, "could not open Spotify", e)
            false
        }
    }

    // a play key sent straight to Spotify starts it without opening it
    private fun pressPlay(ctx: Context) {
        for (action in listOf(android.view.KeyEvent.ACTION_DOWN, android.view.KeyEvent.ACTION_UP)) {
            ctx.sendBroadcast(
                Intent(Intent.ACTION_MEDIA_BUTTON).setPackage(SPOTIFY).putExtra(
                    Intent.EXTRA_KEY_EVENT,
                    android.view.KeyEvent(action, android.view.KeyEvent.KEYCODE_MEDIA_PLAY),
                ),
            )
        }
        lastWake = "started Spotify with a play key"
    }

    private fun bindQuietly(ctx: Context) {
        if (browser != null) return // already holding it
        val service = ctx.packageManager
            .queryIntentServices(Intent("android.media.browse.MediaBrowserService").setPackage(SPOTIFY), 0)
            .firstOrNull()?.serviceInfo
        if (service == null) {
            lastWake = "Spotify has no media service to wake"
            return
        }
        val b = MediaBrowser(
            ctx,
            ComponentName(service.packageName, service.name),
            object : MediaBrowser.ConnectionCallback() {
                override fun onConnected() {
                    lastWake = "woke Spotify (media service connected)"
                }

                // Spotify may turn away callers it doesn't know; binding has
                // still started it, which is the point
                override fun onConnectionFailed() {
                    lastWake = "started Spotify (it declined the media connection)"
                }
            },
            null,
        )
        browser = b
        try {
            b.connect()
        } catch (e: Exception) {
            Log.w(TAG, "spotify wake failed", e)
            lastWake = "couldn't reach Spotify: ${e.message}"
        }
        // give Spotify time to register with Connect, then let go
        main.postDelayed({
            browser?.let { if (it.isConnected) it.disconnect() }
            browser = null
        }, HOLD_MS)
    }

    private fun postPrompt(ctx: Context) {
        if (ctx.checkSelfPermission(Manifest.permission.POST_NOTIFICATIONS) != PackageManager.PERMISSION_GRANTED) {
            return
        }
        val launch = ctx.packageManager.getLaunchIntentForPackage(SPOTIFY) ?: return
        val nm = ctx.getSystemService(NotificationManager::class.java) ?: return
        nm.createNotificationChannel(
            NotificationChannel(CHANNEL, "Wake Spotify", NotificationManager.IMPORTANCE_HIGH).apply {
                description = "Asks you to open Spotify when the Car Thing can't reach it"
            },
        )
        val tap = PendingIntent.getActivity(
            ctx, 0, launch, PendingIntent.FLAG_IMMUTABLE or PendingIntent.FLAG_UPDATE_CURRENT,
        )
        nm.notify(
            NOTIFICATION_ID,
            Notification.Builder(ctx, CHANNEL)
                .setSmallIcon(android.R.drawable.ic_media_play)
                .setContentTitle("Open Spotify for Wisp")
                .setContentText("Tap so Wisp can play on this phone")
                .setContentIntent(tap)
                .setAutoCancel(true)
                .setTimeoutAfter(PROMPT_TIMEOUT_MS)
                .build(),
        )
    }
}
