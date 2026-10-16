package dev.carthingfw.nav

import android.Manifest
import android.app.ActivityManager
import android.app.Notification
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.content.Context
import android.content.Intent
import android.content.pm.PackageManager
import android.provider.Settings
import android.util.Log

/**
 * Opens a music app for a play the Car Thing asked for. Android only lets an
 * app open another from the background with Display over other apps (a setup
 * step); without it the open is dropped without a word, so a tap-to-play
 * notification goes up instead, as Spotify's wake does.
 */
object AppOpener {
    private const val TAG = "CarThingNav"
    private const val CHANNEL = "spotify_wake"
    private const val NOTIFICATION_ID = 3680
    private const val PROMPT_TIMEOUT_MS = 120_000L

    /** false if it couldn't be opened, or only the notification went up */
    fun open(ctx: Context, intent: Intent, appName: String): Boolean {
        val app = ctx.applicationContext
        if (!Settings.canDrawOverlays(app) && !inFront()) {
            Log.i(TAG, "can't open $appName from the background; asking with a notification")
            prompt(app, intent, appName)
            return false
        }
        return try {
            app.startActivity(intent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK))
            true
        } catch (e: Exception) {
            Log.w(TAG, "could not open $appName", e)
            false
        }
    }

    // Wisp's own screen is up: Android lets it open other apps
    private fun inFront(): Boolean {
        val info = ActivityManager.RunningAppProcessInfo()
        ActivityManager.getMyMemoryState(info)
        return info.importance <= ActivityManager.RunningAppProcessInfo.IMPORTANCE_FOREGROUND
    }

    private fun prompt(ctx: Context, intent: Intent, appName: String) {
        if (ctx.checkSelfPermission(Manifest.permission.POST_NOTIFICATIONS) != PackageManager.PERMISSION_GRANTED) return
        val nm = ctx.getSystemService(NotificationManager::class.java) ?: return
        nm.createNotificationChannel(
            NotificationChannel(CHANNEL, "Wake Spotify", NotificationManager.IMPORTANCE_HIGH).apply {
                description = "Asks you to open Spotify when the Car Thing can't reach it"
            },
        )
        val tap = PendingIntent.getActivity(
            ctx, 1, intent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK),
            PendingIntent.FLAG_IMMUTABLE or PendingIntent.FLAG_UPDATE_CURRENT,
        )
        nm.notify(
            NOTIFICATION_ID,
            Notification.Builder(ctx, CHANNEL)
                .setSmallIcon(android.R.drawable.ic_media_play)
                .setContentTitle("Play on $appName")
                .setContentText("Tap so Wisp can start it")
                .setContentIntent(tap)
                .setAutoCancel(true)
                .setTimeoutAfter(PROMPT_TIMEOUT_MS)
                .build(),
        )
    }
}
