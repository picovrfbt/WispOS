package dev.carthingfw.driverecorder

import android.Manifest
import android.app.Activity
import android.content.pm.PackageManager
import android.graphics.Color
import android.graphics.Typeface
import android.graphics.drawable.GradientDrawable
import android.os.Bundle
import android.os.Handler
import android.os.Looper
import android.os.SystemClock
import android.view.Gravity
import android.view.View
import android.widget.LinearLayout
import android.widget.ScrollView
import android.widget.TextView
import android.widget.Toast
import dev.carthingfw.nav.DriveRecorder
import java.io.File
import kotlin.math.abs
import kotlin.math.roundToInt

/**
 * One button to record a drive, what it's reading while it does, and the
 * drives so far, each with a button to send it (email, Drive, a chat).
 */
class RecorderActivity : Activity() {
    private val main = Handler(Looper.getMainLooper())
    private lateinit var button: TextView
    private lateinit var status: TextView
    private lateinit var stats: TextView
    private lateinit var list: LinearLayout

    private val tick = object : Runnable {
        override fun run() {
            refresh()
            main.postDelayed(this, 250)
        }
    }

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        val col = LinearLayout(this).apply {
            orientation = LinearLayout.VERTICAL
            setPadding(dp(20), dp(28), dp(20), dp(28))
        }
        col.addView(text("Wisp Drive Recorder", 26f, bold = true, color = Color.WHITE))
        col.addView(
            text(
                "Records how you drive (speed, braking, acceleration and turns) to help tune " +
                    "Wisp's Drive Mode. No location or route is kept. Put the phone somewhere it " +
                    "won't move around, press Start, drive, then press Stop and share the drive.",
                15f, color = SECONDARY,
            ).apply { setPadding(0, dp(8), 0, dp(20)) },
        )

        button = text("", 20f, bold = true, color = Color.WHITE).apply {
            gravity = Gravity.CENTER
            setPadding(0, dp(18), 0, dp(18))
            setOnClickListener { toggle() }
        }
        col.addView(button)
        status = text("", 15f, color = SECONDARY).apply { setPadding(0, dp(12), 0, 0) }
        col.addView(status)
        stats = text("", 17f, color = Color.WHITE).apply {
            typeface = Typeface.MONOSPACE
            setPadding(0, dp(8), 0, dp(20))
        }
        col.addView(stats)

        col.addView(text("YOUR DRIVES", 12f, bold = true, color = TERTIARY).apply { setPadding(0, dp(8), 0, dp(8)) })
        list = LinearLayout(this).apply { orientation = LinearLayout.VERTICAL }
        col.addView(list)

        setContentView(ScrollView(this).apply { addView(col) })
    }

    override fun onResume() {
        super.onResume()
        showDrives()
        main.post(tick)
    }

    override fun onPause() {
        main.removeCallbacks(tick)
        super.onPause()
    }

    private fun toggle() {
        if (RecordService.Live.recording) {
            RecordService.stop(this)
            // the file closes as the service ends
            main.postDelayed({ showDrives() }, 1_200)
            Toast.makeText(this, "Saved. Share it below.", Toast.LENGTH_SHORT).show()
            return
        }
        val wanted = buildList {
            if (checkSelfPermission(Manifest.permission.ACCESS_FINE_LOCATION) != PackageManager.PERMISSION_GRANTED) {
                add(Manifest.permission.ACCESS_FINE_LOCATION)
            }
            if (android.os.Build.VERSION.SDK_INT >= 33 &&
                checkSelfPermission(Manifest.permission.POST_NOTIFICATIONS) != PackageManager.PERMISSION_GRANTED
            ) {
                add(Manifest.permission.POST_NOTIFICATIONS)
            }
        }
        if (Manifest.permission.ACCESS_FINE_LOCATION in wanted) {
            requestPermissions(wanted.toTypedArray(), 1)
            return
        }
        if (wanted.isNotEmpty()) requestPermissions(wanted.toTypedArray(), 2)
        RecordService.start(this)
    }

    override fun onRequestPermissionsResult(requestCode: Int, permissions: Array<out String>, grantResults: IntArray) {
        super.onRequestPermissionsResult(requestCode, permissions, grantResults)
        if (requestCode != 1) return
        if (checkSelfPermission(Manifest.permission.ACCESS_FINE_LOCATION) == PackageManager.PERMISSION_GRANTED) {
            RecordService.start(this)
        } else {
            Toast.makeText(this, "Speed comes from GPS: allow location to record", Toast.LENGTH_LONG).show()
        }
    }

    private fun refresh() {
        val live = RecordService.Live
        val on = live.recording
        button.text = if (on) "Stop recording" else "Start recording"
        button.background = GradientDrawable().apply {
            cornerRadius = dp(32).toFloat()
            setColor(if (on) 0xFF2A2A2E.toInt() else ACCENT)
        }
        if (!on) {
            status.text = "Not recording"
            stats.text = ""
            return
        }
        val secs = (SystemClock.elapsedRealtime() - live.startedAt) / 1000
        status.text = "Recording · %d:%02d%s".format(secs / 60, secs % 60, if (live.gps) "" else " · waiting for GPS")
        val turn = when {
            live.steer > 0.3 -> "right"
            live.steer < -0.3 -> "left"
            else -> "straight"
        }
        stats.text = buildString {
            append("speed     %3d mph\n".format(live.speed.roundToInt()))
            append("accel   %+5.1f mph/s\n".format(live.accel))
            append("turn      %s %s\n".format(turn, if (abs(live.steer) > 0.05) "%.0f%%".format(abs(live.steer) * 100) else ""))
            append("hard brakes  %d\n".format(live.hardBrakes))
            append("music open   %d%%".format((live.clarity * 100).roundToInt()))
        }
    }

    private fun showDrives() {
        list.removeAllViews()
        val drives = DriveRecorder.all(this)
        if (drives.isEmpty()) {
            list.addView(text("No drives yet", 15f, color = TERTIARY))
            return
        }
        for (f in drives) list.addView(driveRow(f))
    }

    private fun driveRow(f: File): View {
        val row = LinearLayout(this).apply {
            orientation = LinearLayout.HORIZONTAL
            gravity = Gravity.CENTER_VERTICAL
            setPadding(dp(16), dp(12), dp(12), dp(12))
            background = GradientDrawable().apply {
                cornerRadius = dp(14).toFloat()
                setColor(0xFF1F1F22.toInt())
            }
            layoutParams = LinearLayout.LayoutParams(
                LinearLayout.LayoutParams.MATCH_PARENT, LinearLayout.LayoutParams.WRAP_CONTENT,
            ).apply { bottomMargin = dp(8) }
        }
        // drive-20261013-1028-recorder.csv: the date and time it started
        val m = Regex("""drive-(\d{4})(\d{2})(\d{2})-(\d{2})(\d{2})""").find(f.name)
        val name = m?.destructured?.let { (y, mo, d, h, mi) -> "$y-$mo-$d  $h:$mi" } ?: f.name
        // ten lines a second
        val minutes = (f.length() / 95.0 / 10 / 60)
        row.addView(
            text("$name\n%.0f min · %d KB".format(minutes.coerceAtLeast(1.0), f.length() / 1024), 15f, color = Color.WHITE)
                .apply { layoutParams = LinearLayout.LayoutParams(0, LinearLayout.LayoutParams.WRAP_CONTENT, 1f) },
        )
        row.addView(
            text("Share", 15f, bold = true, color = Color.BLACK).apply {
                setPadding(dp(18), dp(10), dp(18), dp(10))
                background = GradientDrawable().apply {
                    cornerRadius = dp(20).toFloat()
                    setColor(ACCENT)
                }
                setOnClickListener {
                    if (!DriveRecorder.share(this@RecorderActivity, f)) {
                        Toast.makeText(this@RecorderActivity, "Couldn't share it", Toast.LENGTH_SHORT).show()
                    }
                }
            },
        )
        return row
    }

    private fun text(s: String, size: Float, bold: Boolean = false, color: Int) = TextView(this).apply {
        text = s
        textSize = size
        setTextColor(color)
        if (bold) typeface = Typeface.DEFAULT_BOLD
        setLineSpacing(0f, 1.15f)
    }

    private fun dp(v: Int) = (v * resources.displayMetrics.density).roundToInt()

    companion object {
        private const val ACCENT = 0xFFE0642A.toInt()
        private const val SECONDARY = 0x9EFFFFFF.toInt()
        private const val TERTIARY = 0x6BFFFFFF
    }
}
