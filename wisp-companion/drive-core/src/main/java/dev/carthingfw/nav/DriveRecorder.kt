package dev.carthingfw.nav

import android.app.Activity
import android.content.ContentValues
import android.content.Context
import android.content.Intent
import android.os.Environment
import android.provider.MediaStore
import android.util.Log
import java.io.BufferedWriter
import java.io.File
import java.text.SimpleDateFormat
import java.util.Date
import java.util.Locale

/**
 * A record of each Drive Mode drive, ten lines a second: what the sensors
 * read and what the music did with it. Shared from the app's main screen,
 * it lets the drive be replayed on a computer with the same music
 * (drive-mode-prototype/replay_drive.py) to tune how Drive Mode reacts.
 * Only numbers: no position is kept.
 */
class DriveRecorder(ctx: Context, genre: String, keep: Int = KEEP) {
    private val out: BufferedWriter?
    private var t = 0.0
    private var since = 0.0

    init {
        val dir = dir(ctx)
        // the last few drives are plenty
        dir.listFiles()?.sortedByDescending { it.name }?.drop(keep - 1)?.forEach { it.delete() }
        val stamp = SimpleDateFormat("yyyyMMdd-HHmm", Locale.US).format(Date())
        out = try {
            File(dir, "drive-$stamp-$genre.csv").bufferedWriter().apply {
                write("t,gps_mph,gps_accel,has_gps,yaw_rate,flat_accel,speed,accel,steer,")
                write("energy,brake,pedal,clarity,bass,drums,vocals,surge,paused,")
                // whether the car's forward is known, the push along it, how far the phone has tilted since
                write("forward_known,ahead_accel,tilt_deg\n")
            }
        } catch (e: Exception) {
            Log.w("WispDrive", "no drive recording", e)
            null
        }
    }

    /** called each audio block; writes a line every tenth of a second */
    fun step(dt: Double, s: DriveSensors, speed: Double, accel: Double, steer: Double, c: DriveControls, paused: Boolean) {
        t += dt
        since += dt
        if (since < 0.1 || out == null) return
        since = 0.0
        try {
            out.write(
                String.format(
                    Locale.US,
                    "%.2f,%.2f,%.3f,%d,%.4f,%.3f,%.2f,%.3f,%.3f,%.3f,%.3f,%.3f,%.3f,%.3f,%.3f,%.3f,%.3f,%d,%d,%.3f,%.1f\n",
                    t, s.rawGpsMph, s.rawGpsAccel, if (s.hasGps) 1 else 0, s.rawYawRate, s.rawFlatAccel,
                    speed, accel, steer,
                    c.energy, c.brake, c.pedal, c.clarity, c.bass, c.drums, c.vocals, c.surge,
                    if (paused) 1 else 0,
                    if (s.rawForwardKnown) 1 else 0, s.rawAheadAccel, s.rawTiltDeg,
                ),
            )
        } catch (e: Exception) {
            // a full disk only loses the recording
        }
    }

    fun close() {
        try {
            out?.close()
        } catch (e: Exception) {
            // nothing to keep
        }
    }

    companion object {
        private const val KEEP = 5

        private fun dir(ctx: Context) = File(ctx.filesDir, "drive-logs").apply { mkdirs() }

        /** every recording kept, newest first */
        fun all(ctx: Context): List<File> = dir(ctx).listFiles()?.filter { it.length() > 200 }?.sortedByDescending { it.name }.orEmpty()

        fun latest(ctx: Context): File? = dir(ctx).listFiles()?.filter { it.length() > 200 }?.maxByOrNull { it.name }

        /**
         * Copies the latest drive into Downloads/Wisp and opens the share sheet
         * (Drive, email, a chat); false when there's no drive yet
         */
        fun share(a: Activity, file: File? = null): Boolean {
            val f = file ?: latest(a) ?: return false
            val values = ContentValues().apply {
                put(MediaStore.Downloads.DISPLAY_NAME, f.name)
                put(MediaStore.Downloads.MIME_TYPE, "text/csv")
                put(MediaStore.Downloads.RELATIVE_PATH, Environment.DIRECTORY_DOWNLOADS + "/Wisp")
            }
            val uri = a.contentResolver.insert(MediaStore.Downloads.EXTERNAL_CONTENT_URI, values) ?: return false
            a.contentResolver.openOutputStream(uri)?.use { os -> f.inputStream().use { it.copyTo(os) } }
            val send = Intent(Intent.ACTION_SEND)
                .setType("text/csv")
                .putExtra(Intent.EXTRA_STREAM, uri)
                .putExtra(Intent.EXTRA_SUBJECT, "Wisp drive: ${f.name}")
                .addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION)
            a.startActivity(Intent.createChooser(send, "Share the drive"))
            return true
        }
    }
}
