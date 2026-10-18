package dev.carthingfw.nav

import android.app.Notification
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.content.Context
import android.content.Intent
import android.os.Handler
import android.os.Looper

/**
 * New Wisp apps: while the app runs in the background (the Wisp link), it
 * looks for one every few hours. With "Update the app automatically" on (the
 * default) it installs it by itself, where Android lets an app update itself
 * without asking; otherwise, or when Android wants a yes, a notification says
 * so, once per version, and tapping it starts the update. Opening the app with
 * one waiting shows a pop-up too (MainActivity).
 */
object UpdateNotice {
    private const val CHANNEL = "wisp_update"
    private const val ID = 3690
    private const val FILE = "wisp_update_notice"
    private const val EVERY_MS = 6 * 60 * 60 * 1000L
    // the first look, after the app's own start-up work
    private const val FIRST_MS = 2 * 60 * 1000L

    /** in the intent a tap on the notification opens: start the update */
    const val EXTRA_UPDATE = "dev.carthingfw.nav.UPDATE"

    private val main by lazy { Handler(Looper.getMainLooper()) }
    @Volatile private var watching = false

    /** starts the regular look for a new app (once; from the Wisp link service) */
    fun watch(ctx: Context) {
        if (watching) return
        watching = true
        val app = ctx.applicationContext
        val look = object : Runnable {
            override fun run() {
                AppUpdater.check(app) {
                    val s = AppUpdater.state
                    if (s is AppUpdater.State.Available && Prefs.autoUpdateApp(app)) {
                        AppUpdater.install(app, s.offer, background = true) {}
                    } else {
                        offerIfNew(app)
                    }
                }
                main.postDelayed(this, EVERY_MS)
            }
        }
        main.postDelayed(look, FIRST_MS)
    }

    /** after any check: a notification for a version not told about yet */
    fun offerIfNew(ctx: Context) {
        val s = AppUpdater.state as? AppUpdater.State.Available ?: return
        val prefs = ctx.getSharedPreferences(FILE, Context.MODE_PRIVATE)
        if (prefs.getString("told", "") == s.offer.version) return
        prefs.edit().putString("told", s.offer.version).apply()
        post(ctx, s.offer.version)
    }

    /** seen in the app's pop-up already: no notification for it later */
    fun seen(ctx: Context, version: String) {
        ctx.getSharedPreferences(FILE, Context.MODE_PRIVATE).edit().putString("told", version).apply()
    }

    private fun post(ctx: Context, version: String) {
        val nm = ctx.getSystemService(NotificationManager::class.java) ?: return
        nm.createNotificationChannel(
            NotificationChannel(CHANNEL, "App updates", NotificationManager.IMPORTANCE_DEFAULT).apply {
                description = "When a new Wisp app is out"
            },
        )
        val tap = PendingIntent.getActivity(
            ctx, ID,
            Intent(ctx, MainActivity::class.java)
                .putExtra(EXTRA_UPDATE, true)
                .addFlags(Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_ACTIVITY_SINGLE_TOP),
            PendingIntent.FLAG_IMMUTABLE or PendingIntent.FLAG_UPDATE_CURRENT,
        )
        val n = Notification.Builder(ctx, CHANNEL)
            .setSmallIcon(R.drawable.ic_w_update)
            .setContentTitle("Wisp app $version is out")
            .setContentText("Tap to update")
            .setContentIntent(tap)
            .setAutoCancel(true)
            .build()
        try {
            nm.notify(ID, n)
        } catch (e: SecurityException) {
            // notifications not allowed: the pop-up in the app still tells
        }
    }

    /** the notification goes once the update's under way */
    fun clear(ctx: Context) {
        ctx.getSystemService(NotificationManager::class.java)?.cancel(ID)
    }
}
