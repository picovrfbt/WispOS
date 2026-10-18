package dev.carthingfw.phone

import android.app.Notification
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.app.Service
import android.content.Context
import android.content.Intent
import android.content.pm.ServiceInfo
import android.net.ConnectivityManager
import android.os.IBinder
import android.util.Log
import java.io.File

/**
 * Wisp's background program, wisp-daemon: the same one the Car Thing runs,
 * built for Android and shipped in the app as libwispd.so. It talks to Spotify
 * and serves the screens on 127.0.0.1:3678. Kept running as a foreground
 * service, and started again if it stops.
 */
class WispService : Service() {

    @Volatile private var running = false
    private var process: Process? = null
    private var thread: Thread? = null

    override fun onBind(intent: Intent?): IBinder? = null

    override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
        startForeground(NOTIFICATION_ID, notification(), ServiceInfo.FOREGROUND_SERVICE_TYPE_SPECIAL_USE)
        if (!running) {
            running = true
            thread = Thread(::runDaemon, "wisp-daemon").apply { start() }
        }
        return START_STICKY
    }

    override fun onDestroy() {
        running = false
        process?.destroy()
        thread?.interrupt()
        super.onDestroy()
    }

    // runs the daemon, and again after a pause whenever it exits
    private fun runDaemon() {
        val dir = File(filesDir, "wisp").apply { mkdirs() }
        var backoff = 1000L
        while (running) {
            // the settings that come with this version of the app, every start;
            // the Spotify login and Wisp's own settings live beside it, untouched
            assets.open("config.yml").use { input ->
                File(dir, "config.yml").outputStream().use { input.copyTo(it) }
            }
            val bin = File(applicationInfo.nativeLibraryDir, "libwispd.so")
            val log = File(dir, "daemon.log")
            // one run's worth is plenty to look at after a problem
            if (log.length() > MAX_LOG_BYTES) log.delete()
            val started = System.currentTimeMillis()
            try {
                val pb = ProcessBuilder(bin.path, "--config_dir", dir.path)
                    .directory(dir)
                    .redirectErrorStream(true)
                    .redirectOutput(ProcessBuilder.Redirect.appendTo(log))
                // Android has no resolv.conf for the daemon to find its DNS in
                pb.environment()["WISP_DNS"] = dnsServers()
                val p = pb.start()
                process = p
                val code = p.waitFor()
                Log.w(TAG, "wisp-daemon exited with $code")
            } catch (e: InterruptedException) {
                break
            } catch (e: Exception) {
                Log.e(TAG, "wisp-daemon didn't start", e)
            }
            process = null
            // a run that lasted a while was fine: start again quickly
            backoff = if (System.currentTimeMillis() - started > 60_000) 1000L else minOf(backoff * 2, 30_000L)
            try {
                Thread.sleep(backoff)
            } catch (e: InterruptedException) {
                break
            }
        }
    }

    // the phone's DNS servers right now, "ip,ip" (empty: the daemon uses public ones)
    private fun dnsServers(): String = try {
        val cm = getSystemService(ConnectivityManager::class.java)
        cm.getLinkProperties(cm.activeNetwork)?.dnsServers.orEmpty()
            .mapNotNull { it.hostAddress?.substringBefore('%') }
            .joinToString(",")
    } catch (e: Exception) {
        ""
    }

    private fun notification(): Notification {
        val nm = getSystemService(NotificationManager::class.java)
        nm.createNotificationChannel(
            NotificationChannel(CHANNEL, getString(R.string.running_channel), NotificationManager.IMPORTANCE_MIN),
        )
        val open = PendingIntent.getActivity(
            this, 0, Intent(this, MainActivity::class.java), PendingIntent.FLAG_IMMUTABLE,
        )
        return Notification.Builder(this, CHANNEL)
            .setSmallIcon(R.drawable.ic_icon_mono)
            .setContentTitle(getString(R.string.running_title))
            .setContentText(getString(R.string.running_text))
            .setContentIntent(open)
            .setOngoing(true)
            .build()
    }

    companion object {
        private const val TAG = "WispService"
        private const val CHANNEL = "wisp_running"
        private const val NOTIFICATION_ID = 1
        private const val MAX_LOG_BYTES = 2L * 1024 * 1024

        fun start(ctx: Context) {
            ctx.startForegroundService(Intent(ctx, WispService::class.java))
        }

        /** the end of the daemon's log, for the screens to show when it won't start */
        fun logTail(ctx: Context, lines: Int = 30): String = try {
            File(File(ctx.filesDir, "wisp"), "daemon.log").readLines().takeLast(lines).joinToString("\n")
        } catch (e: Exception) {
            "(no log yet)"
        }
    }
}
