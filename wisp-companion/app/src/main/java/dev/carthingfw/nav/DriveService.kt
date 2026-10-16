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
import org.json.JSONObject
import java.util.concurrent.Executors

/**
 * Drive Mode on the phone: the Car Thing says start (with a genre), pause,
 * resume or stop; this runs the engine and keeps the app playing in the
 * background with a notification that can also stop it.
 */
object DriveMode {
    private const val TAG = "WispDrive"

    // starting and stopping wait on the engine's thread, so never on the socket's
    private val worker = Executors.newSingleThreadExecutor()

    @Volatile
    private var engine: DriveEngine? = null

    /** the car's screen and steering-wheel buttons (DriveMedia) */
    @Volatile
    var media: DriveMedia? = null
        private set

    val genre: String? get() = engine?.genre

    /** a "drive" message from the Car Thing */
    fun handle(ctx: Context, msg: JSONObject) {
        val app = ctx.applicationContext
        when (msg.optString("action")) {
            "start" -> {
                val genre = msg.optString("genre")
                if (genre in DriveStems.GENRES) worker.execute { start(app, genre) }
            }
            "stop" -> worker.execute { stop(app) }
            "pause" -> setPaused(true)
            "resume" -> setPaused(false)
        }
    }

    /** from the Car Thing, the car's buttons or the notification */
    fun setPaused(paused: Boolean) {
        engine?.setPaused(paused)
        media?.setPlaying(!paused)
    }

    private fun start(app: Context, genre: String) {
        engine?.stop()
        val e = DriveEngine(app, genre)
        e.onEnded = { worker.execute { if (engine === e) stop(app) } }
        engine = e
        media?.release()
        media = DriveMedia(
            app, genre,
            onPlay = { setPaused(false) },
            onPause = { setPaused(true) },
            onStop = { worker.execute { stop(app) } },
        )
        try {
            app.startForegroundService(Intent(app, DriveService::class.java))
        } catch (ex: Exception) {
            // not allowed from the background on this phone: it still plays while
            // the app is alive (the link service keeps it so)
            Log.w(TAG, "no foreground service for Drive Mode", ex)
        }
        e.start()
        Log.i(TAG, "started $genre")
    }

    fun stop(app: Context) {
        val e = engine
        e?.stop()
        engine = null
        // the pre-decoded next song is ~150 MB of cache: keep just the one that played
        if (e != null) DriveStems.trim(app, e.playingKey)
        media?.release()
        media = null
        app.stopService(Intent(app, DriveService::class.java))
        Log.i(TAG, "stopped")
    }

    /** stops and waits, for deleting the music from under it */
    fun stopNow(app: Context) {
        worker.submit { stop(app) }.get()
    }

    /** from the notification's Stop */
    fun stopFromPhone(app: Context) = worker.execute { stop(app) }
}

class DriveService : Service() {
    override fun onBind(intent: Intent?): IBinder? = null

    override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
        if (intent?.action == ACTION_STOP) {
            DriveMode.stopFromPhone(applicationContext)
            return START_NOT_STICKY
        }
        try {
            startForeground(ID, notification(this), ServiceInfo.FOREGROUND_SERVICE_TYPE_MEDIA_PLAYBACK)
        } catch (e: Exception) {
            Log.w("WispDrive", "could not stay in the foreground", e)
            stopSelf()
        }
        // never brought back by itself: Drive Mode starts from the Car Thing
        return START_NOT_STICKY
    }

    companion object {
        private const val CHANNEL = "wisp_drive"
        private const val ID = 3681
        private const val ACTION_STOP = "dev.carthingfw.nav.DRIVE_STOP"

        private fun notification(ctx: Context): Notification {
            ctx.getSystemService(NotificationManager::class.java)?.createNotificationChannel(
                NotificationChannel(CHANNEL, "Drive Mode", NotificationManager.IMPORTANCE_LOW).apply {
                    description = "Shows while Drive Mode is playing"
                    setShowBadge(false)
                },
            )
            val stop = PendingIntent.getService(
                ctx, 1, Intent(ctx, DriveService::class.java).setAction(ACTION_STOP),
                PendingIntent.FLAG_IMMUTABLE or PendingIntent.FLAG_UPDATE_CURRENT,
            )
            val open = PendingIntent.getActivity(
                ctx, 0, Intent(ctx, MainActivity::class.java),
                PendingIntent.FLAG_IMMUTABLE or PendingIntent.FLAG_UPDATE_CURRENT,
            )
            val genre = DriveMode.genre?.replaceFirstChar { it.uppercase() } ?: "Drive Mode"
            val b = Notification.Builder(ctx, CHANNEL)
                .setSmallIcon(android.R.drawable.ic_media_play)
                .setContentTitle("Drive Mode · $genre")
                .setContentText("Music that follows your driving (beta)")
                .setContentIntent(open)
                .addAction(Notification.Action.Builder(null, "Stop", stop).build())
                .setOngoing(true)
            DriveMode.genre?.let { b.setLargeIcon(DriveMedia.cover(it, 256)) }
            // a media notification: the lock screen shows the cover and controls
            DriveMode.media?.let { b.setStyle(Notification.MediaStyle().setMediaSession(it.token).setShowActionsInCompactView(0)) }
            return b.build()
        }
    }
}
