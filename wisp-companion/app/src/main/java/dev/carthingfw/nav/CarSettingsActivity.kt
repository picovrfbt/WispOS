package dev.carthingfw.nav

import android.content.res.ColorStateList
import android.graphics.Color
import android.os.Bundle
import android.os.Handler
import android.os.Looper
import android.view.Gravity
import android.view.View
import android.view.ViewGroup
import android.widget.HorizontalScrollView
import android.widget.ImageView
import android.widget.LinearLayout
import android.widget.SeekBar
import android.widget.Switch
import android.widget.TextView
import org.json.JSONObject

/**
 * The Car Thing's settings from the phone: brightness, night mode, lyrics,
 * Wisp's voice and the rest of what its own Settings has, apart from the top
 * buttons. A change goes over at once; the page follows the Car Thing's
 * settings as they come back, and waits while no Car Thing is connected.
 */
class CarSettingsActivity : WispActivity() {
    // each control shows a value from the Car Thing's settings; refreshed when they come back
    private val binds = mutableListOf<(JSONObject) -> Unit>()
    private val controls = mutableListOf<View>()
    private lateinit var status: TextView
    private var binding = false
    private var wasReachable: Boolean? = null

    private val handler = Handler(Looper.getMainLooper())
    private val onChanged: () -> Unit = { bind() }
    private val tick = object : Runnable {
        override fun run() {
            if (CarSettings.reachable != wasReachable) bind()
            handler.postDelayed(this, 1000)
        }
    }

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        val col = LinearLayout(this).apply { orientation = LinearLayout.VERTICAL }
        col.addView(header())

        col.addView(sectionHead("Display"))
        col.addView(group().apply {
            addRow(switchSetting("Auto brightness", "Follows the light around the Car Thing", "autoBrightness"))
            addRow(sliderSetting("Brightness", "brightness", 1.0, 10.0, 1.0, { "${it.toInt()}" }, live = true) { !it.optBoolean("autoBrightness", true) })
            addRow(choiceSetting("Night mode", "A dimmer, warmer screen", "nightMode", listOf("off" to "Off", "on" to "On", "auto" to "At night")))
            addRow(sliderSetting("Display size", "uiScalePct", 85.0, 115.0, 5.0, { "${it.toInt()}%" }))
            addRow(accentSetting())
            addRow(switchSetting("Performance mode", "Smoother, runs warmer · eases off when hot · screen restarts", "performanceMode"))
            addRow(choiceSetting("Temperature", null, "tempUnit", listOf("F" to "°F", "C" to "°C")))
        })

        col.addView(sectionHead("Playback"))
        col.addView(group().apply {
            addRow(switchSetting("Lyrics", "Beside the cover while a song plays", "showLyrics"))
            addRow(switchSetting("Lyrics for other players", "Songs from VLC or the phone's music app", "phoneLyrics"))
            addRow(sliderSetting("Lyric sync", "lyricOffsetMs", -500.0, 500.0, 50.0, { v -> if (v == 0.0) "0 ms" else "${if (v > 0) "+" else ""}${v.toInt()} ms" }))
            addRow(sliderSetting("Volume per turn", "volumeStepPct", 1.0, 10.0, 1.0, { "${it.toInt()}%" }))
            addRow(choiceSetting("Visualizer", "Behind the cover", "visualizer", listOf("off" to "Off", "glow" to "Glow", "bars" to "Bars", "wave" to "Wave", "particles" to "Particles")))
        })

        col.addView(sectionHead("Phone and voice"))
        col.addView(group().apply {
            addRow(switchSetting("Notifications", "Your phone's notifications as banners", "phoneNotifications"))
            addRow(switchSetting("Phone battery", "On the players while it isn't charging", "phoneBattery"))
            addRow(switchSetting("Mic", "Listens for \"Okay Wisp\"", "voiceMic"))
            addRow(choiceSetting("Wisp's voice", "Speaks through your phone into the car", "wispVoice", listOf("off" to "Off", "confirmations" to "Confirmations", "everything" to "Everything")))
            addRow(sliderSetting("Voice speed", "voiceSpeed", 0.5, 2.0, 0.1, { String.format("%.1f×", it) }) { it.optString("wispVoice", "off") != "off" })
            addRow(sliderSetting("Voice volume", "voiceVolumePct", 10.0, 100.0, 10.0, { "${it.toInt()}%" }) { it.optString("wispVoice", "off") != "off" })
        })

        col.addView(sectionHead("Directions"))
        col.addView(group().apply {
            addRow(choiceSetting("When you arrive", null, "arrivalAction", listOf("none" to "Just show it", "pause" to "Pause music")))
        })

        col.addView(sectionHead("Software update"))
        col.addView(group().apply {
            addRow(switchSetting("Install updates automatically", "While nothing is playing", "autoInstallUpdates"))
            addRow(switchSetting("Update in the background", "Behind whatever is on screen", "updateInBackground"))
        })

        col.addView(text("Top buttons and Home's library are set on the Car Thing.", 12f, medium, TERTIARY).apply {
            setPadding(dp(8), dp(14), dp(8), 0)
        })
        page(col)
        bind()
    }

    override fun onResume() {
        super.onResume()
        CarSettings.listen(onChanged)
        handler.post(tick)
        bind()
    }

    override fun onPause() {
        super.onPause()
        CarSettings.unlisten(onChanged)
        handler.removeCallbacks(tick)
    }

    /** every control to the Car Thing's settings, without sending anything back */
    private fun bind() {
        val s = CarSettings.current(this)
        val reachable = CarSettings.reachable
        wasReachable = reachable
        binding = true
        binds.forEach { it(s) }
        binding = false
        status.text = if (reachable) "Connected · changes show on the Car Thing right away"
        else "Connect the Car Thing to change these"
        status.setTextColor(if (reachable) GREEN else SECONDARY)
        controls.forEach {
            @Suppress("UNCHECKED_CAST")
            val usable = reachable && (it.getTag(R.id.enabledWhen) as? (JSONObject) -> Boolean)?.invoke(s) != false
            it.isEnabled = usable
            // the pills and colour dots have no look of their own for it
            if (it !is SeekBar && it !is Switch) it.alpha = if (usable) 1f else 0.45f
        }
    }

    private fun send(key: String, value: Any) {
        if (binding) return
        if (!CarSettings.set(this, key, value)) bind()
        // dependent rows (Brightness under Auto, the voice under Wisp's voice) follow at once
        else handler.post { bind() }
    }

    // ---------------------------------------------------------------- the rows

    private fun header(): View {
        val box = LinearLayout(this).apply { orientation = LinearLayout.VERTICAL }
        val row = LinearLayout(this).apply { gravity = Gravity.CENTER_VERTICAL }
        row.addView(ImageView(this).apply {
            setImageDrawable(tinted(R.drawable.ic_w_chevron, WHITE, 22))
            rotation = 180f
            setPadding(dp(6), dp(6), dp(6), dp(6))
            contentDescription = "Back"
            setOnClickListener { finish() }
        }, LinearLayout.LayoutParams(dp(36), dp(36)))
        row.addView(text("Car Thing settings", 22f, bold, WHITE).apply { setPadding(dp(6), 0, 0, 0) })
        box.addView(row)
        status = text("", 13f, medium, SECONDARY).apply { setPadding(dp(4), dp(8), dp(4), 0) }
        box.addView(status)
        return box
    }

    private fun LinearLayout.addRow(v: View) {
        if (childCount > 0) divide(v, true)
        addView(v)
    }

    private fun control(v: View, enabledWhen: ((JSONObject) -> Boolean)? = null): View {
        if (enabledWhen != null) v.setTag(R.id.enabledWhen, enabledWhen)
        controls.add(v)
        return v
    }

    private fun switchSetting(title: String, sub: String?, key: String): View {
        val sw = switch(false) { send(key, it) }
        control(sw)
        binds.add { sw.isChecked = it.optBoolean(key) }
        return groupRow(null, title, sub, sw) { if (sw.isEnabled) sw.toggle() }
    }

    /** a slider on [step]s from [lo] to [hi]; [live] sends while it moves, otherwise on letting go */
    private fun sliderSetting(
        title: String, key: String, lo: Double, hi: Double, step: Double, label: (Double) -> String,
        live: Boolean = false, enabledWhen: ((JSONObject) -> Boolean)? = null,
    ): View {
        val box = LinearLayout(this).apply {
            orientation = LinearLayout.VERTICAL
            setPadding(dp(14), dp(11), dp(14), dp(8))
        }
        val top = LinearLayout(this)
        top.addView(text(title, 15f, semibold, WHITE), LinearLayout.LayoutParams(0, ViewGroup.LayoutParams.WRAP_CONTENT, 1f))
        val value = text("", 14f, semibold, SECONDARY)
        top.addView(value)
        box.addView(top)
        val steps = Math.round((hi - lo) / step).toInt()
        fun at(p: Int) = Math.round((lo + p * step) * 100) / 100.0
        fun out(v: Double): Any = if (step >= 1 && lo % 1 == 0.0) v.toInt() else v
        val bar = SeekBar(this).apply {
            max = steps
            progressTintList = ColorStateList.valueOf(GREEN)
            thumbTintList = ColorStateList.valueOf(Color.WHITE)
            progressBackgroundTintList = ColorStateList.valueOf(Color.rgb(0x5A, 0x5A, 0x60))
            setPadding(dp(4), dp(10), dp(4), dp(6))
            var lastSent = 0L
            setOnSeekBarChangeListener(object : SeekBar.OnSeekBarChangeListener {
                override fun onProgressChanged(sb: SeekBar, p: Int, fromUser: Boolean) {
                    value.text = label(at(p))
                    // brightness follows the finger, a few times a second
                    if (fromUser && live && System.currentTimeMillis() - lastSent > 150) {
                        lastSent = System.currentTimeMillis()
                        send(key, out(at(p)))
                    }
                }
                override fun onStartTrackingTouch(sb: SeekBar) {}
                override fun onStopTrackingTouch(sb: SeekBar) = send(key, out(at(sb.progress)))
            })
        }
        control(bar, enabledWhen)
        box.addView(bar, LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.WRAP_CONTENT).apply { topMargin = dp(4) })
        binds.add { s ->
            val v = s.optDouble(key, lo).coerceIn(lo, hi)
            bar.progress = Math.round((v - lo) / step).toInt()
            value.text = label(at(bar.progress))
            box.alpha = if (enabledWhen?.invoke(s) == false) 0.45f else 1f
        }
        return box
    }

    /** one of a few, as pills */
    private fun choiceSetting(title: String, sub: String?, key: String, options: List<Pair<String, String>>): View {
        val box = LinearLayout(this).apply {
            orientation = LinearLayout.VERTICAL
            setPadding(dp(14), dp(11), dp(14), dp(12))
        }
        box.addView(text(title, 15f, semibold, WHITE))
        if (sub != null) box.addView(text(sub, 12f, medium, TERTIARY).apply { setPadding(0, dp(1), 0, 0) })
        val pills = LinearLayout(this)
        val views = options.map { (v, label) ->
            text(label, 13f, semibold, WHITE).apply {
                setPadding(dp(14), dp(8), dp(14), dp(8))
                setOnClickListener { send(key, v) }
                control(this)
                pills.addView(this, LinearLayout.LayoutParams(ViewGroup.LayoutParams.WRAP_CONTENT, ViewGroup.LayoutParams.WRAP_CONTENT).apply {
                    if (pills.childCount > 0) marginStart = dp(8)
                })
            }
        }
        box.addView(HorizontalScrollView(this).apply {
            isHorizontalScrollBarEnabled = false
            addView(pills)
        }, LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.WRAP_CONTENT).apply { topMargin = dp(10) })
        binds.add { s ->
            val cur = s.optString(key)
            options.forEachIndexed { i, (v, _) ->
                val on = v == cur
                views[i].background = round(if (on) GREEN else Color.rgb(0x26, 0x26, 0x2A), dp(99))
                views[i].setTextColor(if (on) Color.BLACK else WHITE)
            }
        }
        return box
    }

    // the accent colours, as on the Car Thing (wisp-ui/src/theme.ts)
    private val accents = listOf(
        "green" to Color.rgb(30, 215, 96), "blue" to Color.rgb(64, 156, 255),
        "purple" to Color.rgb(168, 112, 255), "orange" to Color.rgb(255, 146, 48),
        "pink" to Color.rgb(255, 92, 170), "red" to Color.rgb(255, 82, 82),
    )

    private fun accentSetting(): View {
        val box = LinearLayout(this).apply {
            orientation = LinearLayout.VERTICAL
            setPadding(dp(14), dp(11), dp(14), dp(12))
        }
        val top = LinearLayout(this)
        top.addView(text("Accent colour", 15f, semibold, WHITE), LinearLayout.LayoutParams(0, ViewGroup.LayoutParams.WRAP_CONTENT, 1f))
        val name = text("", 14f, semibold, SECONDARY)
        top.addView(name)
        box.addView(top)
        val dots = LinearLayout(this).apply { gravity = Gravity.CENTER_VERTICAL }
        val all = accents + ("album" to Color.TRANSPARENT)
        val views = all.map { (v, c) ->
            View(this).apply {
                contentDescription = v
                setOnClickListener { send("accentTheme", v) }
                control(this)
                dots.addView(this, LinearLayout.LayoutParams(dp(30), dp(30)).apply { if (dots.childCount > 0) marginStart = dp(10) })
            }
        }
        box.addView(dots, spaced(10))
        binds.add { s ->
            val cur = s.optString("accentTheme", "green")
            name.text = if (cur == "album") "Album colours" else cur.replaceFirstChar { it.uppercase() }
            all.forEachIndexed { i, (v, c) ->
                views[i].background = android.graphics.drawable.GradientDrawable().apply {
                    shape = android.graphics.drawable.GradientDrawable.OVAL
                    if (v == "album") {
                        // the cover's colours: a little rainbow
                        colors = intArrayOf(Color.rgb(0xF5, 0x8A, 0x24), Color.rgb(0xF0, 0x6B, 0xB4), Color.rgb(0x3D, 0x91, 0xF4), Color.rgb(0x1E, 0xD7, 0x60))
                        gradientType = android.graphics.drawable.GradientDrawable.SWEEP_GRADIENT
                    } else setColor(c)
                    if (v == cur) setStroke(dp(3), Color.WHITE)
                }
            }
        }
        return box
    }
}
