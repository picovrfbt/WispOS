package dev.carthingfw.driverecorder

import android.app.Notification
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.app.Service
import android.content.Context
import android.content.Intent
import android.content.pm.ServiceInfo
import android.os.IBinder
import android.os.PowerManager
import android.os.SystemClock
import android.util.Log
import dev.carthingfw.nav.DriveControls
import dev.carthingfw.nav.DriveRecorder
import dev.carthingfw.nav.DriveSensors

/**
 * Records a drive in the background: the same sensors, rules and file as
 * Drive Mode in the Wisp Companion (drive-core), minus the music. Runs as a
 * location service so it keeps going with the screen off and the phone in a
 * pocket, and holds the processor awake so the motion sensors keep reading.
 */
class RecordService : Service() {
    override fun onBind(intent: Intent?): IBinder? = null

    private var thread: Thread? = null
    @Volatile private var running = false
    private var wake: PowerManager.WakeLock? = null

    override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
        if (intent?.action == ACTION_STOP) {
            stopSelf()
            return START_NOT_STICKY
        }
        try {
            startForeground(ID, notification(this), ServiceInfo.FOREGROUND_SERVICE_TYPE_LOCATION)
        } catch (e: Exception) {
            Log.w(TAG, "could not record in the background", e)
            stopSelf()
            return START_NOT_STICKY
        }
        if (thread == null) begin()
        return START_NOT_STICKY
    }

    private fun begin() {
        wake = getSystemService(PowerManager::class.java)
            ?.newWakeLock(PowerManager.PARTIAL_WAKE_LOCK, "WispRecorder:drive")
            ?.apply { acquire(MAX_MS) }
        running = true
        Live.recording = true
        Live.startedAt = SystemClock.elapsedRealtime()
        thread = Thread({ record() }, "drive-recorder").apply { start() }
    }

    private fun record() {
        val sensors = DriveSensors(applicationContext).apply { start() }
        val controls = DriveControls()
        val rec = DriveRecorder(applicationContext, "recorder", keep = KEEP)
        var last = SystemClock.elapsedRealtimeNanos()
        try {
            while (running) {
                Thread.sleep(STEP_MS)
                val now = SystemClock.elapsedRealtimeNanos()
                val dt = (now - last) / 1e9
                last = now
                val (speed, accel, steer) = sensors.read(dt)
                controls.step(dt, speed, accel, steer)
                rec.step(dt, sensors, speed, accel, steer, controls, paused = false)
                Live.update(speed, accel, steer, sensors.hasGps, controls)
            }
        } catch (e: InterruptedException) {
            // stopping
        } finally {
            rec.close()
            sensors.stop()
        }
    }

    override fun onDestroy() {
        running = false
        thread?.interrupt()
        thread?.join(1_000)
        thread = null
        wake?.let { if (it.isHeld) it.release() }
        Live.recording = false
        super.onDestroy()
    }

    /** what the screen shows while recording */
    object Live {
        @Volatile var recording = false
        @Volatile var startedAt = 0L
        @Volatile var speed = 0.0
        @Volatile var accel = 0.0
        @Volatile var steer = 0.0
        @Volatile var gps = false
        @Volatile var hardBrakes = 0
        @Volatile var clarity = 0.0

        fun update(s: Double, a: Double, st: Double, g: Boolean, c: DriveControls) {
            speed = s; accel = a; steer = c.steer; gps = g; clarity = c.clarity
            if (c.hardBrake) hardBrakes++
        }
    }

    companion object {
        private const val TAG = "WispRecorder"
        private const val CHANNEL = "recording"
        private const val ID = 7
        private const val STEP_MS = 20L
        private const val KEEP = 20
        /** a recording stops holding the phone awake after this, however long the drive */
        private const val MAX_MS = 4 * 60 * 60 * 1000L
        const val ACTION_STOP = "dev.carthingfw.driverecorder.STOP"

        fun start(ctx: Context) {
            Live.hardBrakes = 0
            ctx.startForegroundService(Intent(ctx, RecordService::class.java))
        }

        fun stop(ctx: Context) {
            ctx.stopService(Intent(ctx, RecordService::class.java))
        }

        private fun notification(ctx: Context): Notification {
            ctx.getSystemService(NotificationManager::class.java)?.createNotificationChannel(
                NotificationChannel(CHANNEL, "Recording", NotificationManager.IMPORTANCE_LOW).apply {
                    description = "Shows while a drive is being recorded"
                    setShowBadge(false)
                },
            )
            val open = PendingIntent.getActivity(
                ctx, 0, Intent(ctx, RecorderActivity::class.java),
                PendingIntent.FLAG_IMMUTABLE or PendingIntent.FLAG_UPDATE_CURRENT,
            )
            val stop = PendingIntent.getService(
                ctx, 1, Intent(ctx, RecordService::class.java).setAction(ACTION_STOP),
                PendingIntent.FLAG_IMMUTABLE or PendingIntent.FLAG_UPDATE_CURRENT,
            )
            return Notification.Builder(ctx, CHANNEL)
                .setSmallIcon(android.R.drawable.presence_video_online)
                .setContentTitle("Recording your drive")
                .setContentText("Speed, braking and turns, for tuning Wisp's Drive Mode")
                .setContentIntent(open)
                .addAction(Notification.Action.Builder(null, "Stop", stop).build())
                .setOngoing(true)
                .build()
        }
    }
}
