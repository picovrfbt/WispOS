package dev.carthingfw.nav

import android.app.Notification
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.app.Service
import android.content.Context
import android.content.Intent
import android.content.pm.ServiceInfo
import android.os.IBinder
import android.util.Log

/**
 * Keeps Wisp Companion alive in the background. Phones that clear background
 * apps (Samsung's especially) would otherwise stop the link to the Car Thing,
 * and with it navigation, phone media and waking Spotify. A quiet ongoing
 * notification is how Android lets an app stay; it says whether the Car Thing
 * is connected.
 */
class LinkService : Service() {
    override fun onBind(intent: Intent?): IBinder? = null

    override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
        NavServer.ensureStarted(applicationContext)
        // Wisp's thinking on this phone, for the Car Thing's voice
        WispThink.start(applicationContext)
        try {
            startForeground(ID, notification(this), ServiceInfo.FOREGROUND_SERVICE_TYPE_CONNECTED_DEVICE)
        } catch (e: Exception) {
            // not allowed to start in the foreground from here: the system will
            // start it again next time the app is opened
            Log.w(TAG, "could not stay in the foreground", e)
            stopSelf()
        }
        return START_STICKY
    }

    companion object {
        private const val TAG = "WispLink"
        private const val CHANNEL = "wisp_link"
        private const val ID = 3680

        /** starts it if "Keep running in the background" is on */
        fun start(ctx: Context) {
            if (!Prefs.keepRunning(ctx)) return
            try {
                ctx.startForegroundService(Intent(ctx, LinkService::class.java))
            } catch (e: Exception) {
                Log.w(TAG, "could not start", e)
            }
        }

        fun stop(ctx: Context) {
            ctx.stopService(Intent(ctx, LinkService::class.java))
        }

        /** refreshes the notification's line, connected or waiting */
        fun update(ctx: Context) {
            if (!Prefs.keepRunning(ctx)) return
            val nm = ctx.getSystemService(NotificationManager::class.java) ?: return
            try {
                nm.notify(ID, notification(ctx))
            } catch (e: SecurityException) {
                // notifications not allowed; the service still runs
            }
        }

        private fun notification(ctx: Context): Notification {
            val nm = ctx.getSystemService(NotificationManager::class.java)
            nm?.createNotificationChannel(
                NotificationChannel(CHANNEL, "Wisp link", NotificationManager.IMPORTANCE_MIN).apply {
                    description = "Keeps Wisp Companion running so your Car Thing stays connected"
                    setShowBadge(false)
                },
            )
            val open = PendingIntent.getActivity(
                ctx, 0, Intent(ctx, MainActivity::class.java),
                PendingIntent.FLAG_IMMUTABLE or PendingIntent.FLAG_UPDATE_CURRENT,
            )
            val connected = NavServer.connectedCars > 0
            return Notification.Builder(ctx, CHANNEL)
                .setSmallIcon(android.R.drawable.stat_sys_data_bluetooth)
                .setContentTitle(if (connected) "Connected to Wisp" else "Wisp Companion is ready")
                .setContentText(if (connected) "Your Car Thing is linked" else "Waiting for your Car Thing")
                .setContentIntent(open)
                .setOngoing(true)
                .build()
        }
    }
}
