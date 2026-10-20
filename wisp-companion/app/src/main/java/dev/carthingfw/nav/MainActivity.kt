package dev.carthingfw.nav

import android.Manifest
import android.app.Activity
import android.app.Dialog
import android.content.ComponentName
import android.content.Intent
import android.content.pm.PackageManager
import android.content.res.ColorStateList
import android.graphics.Color
import android.graphics.Typeface
import android.graphics.drawable.ColorDrawable
import android.graphics.drawable.Drawable
import android.graphics.drawable.GradientDrawable
import android.os.BatteryManager
import android.os.Bundle
import android.os.Handler
import android.os.Looper
import android.provider.Settings
import android.text.InputType
import android.text.SpannableStringBuilder
import android.text.Spanned
import android.text.TextUtils
import android.text.style.ForegroundColorSpan
import android.view.Gravity
import android.view.View
import android.view.ViewGroup
import android.view.Window
import android.widget.EditText
import android.widget.FrameLayout
import android.widget.GridLayout
import android.widget.ImageView
import android.widget.LinearLayout
import android.widget.ScrollView
import android.widget.Switch
import android.widget.TextView
import android.widget.Toast

/**
 * Setup and status, in the Wisp design: blurred blobs behind everything, the
 * wisp of light from the phone to the Car Thing, compact grouped lists. The
 * update source, the app icon and the diagnostics open in sheets of their own.
 */
class MainActivity : WispActivity() {
    private lateinit var blobs: BlobBackground
    private lateinit var wisp: WispLink
    private lateinit var linkTitle: TextView
    private lateinit var linkBody: TextView
    private lateinit var liveBadge: View
    private lateinit var progressRow: View
    private lateinit var progressLabel: TextView
    private lateinit var progressFill: View
    private lateinit var statDirections: TextView
    private lateinit var statCalls: TextView
    private lateinit var statBattery: TextView
    private lateinit var setupHead: View
    private lateinit var setupGroup: LinearLayout
    private lateinit var doneLine: TextView
    private lateinit var navTile: Tile
    private lateinit var mediaTile: Tile
    private lateinit var locTile: Tile
    private lateinit var spotifyTile: Tile
    private lateinit var eq: EqBars
    private lateinit var servicesList: LinearLayout
    private lateinit var appUpdateTitle: TextView
    private lateinit var appUpdateSub: TextView
    private lateinit var appUpdateChip: TextView
    private lateinit var githubSub: TextView
    private lateinit var iconPreview: ImageView
    private var diagnostics: TextView? = null
    private val steps = mutableListOf<Step>()

    private class Step(val row: View, val label: String, val needed: () -> Boolean)
    private class Tile(val icon: ImageView?, val value: TextView)

    private val handler = Handler(Looper.getMainLooper())
    private val tick = object : Runnable {
        override fun run() {
            refresh()
            handler.postDelayed(this, 1000)
        }
    }


    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        Prefs.forgetGithubToken(this)
        val col = LinearLayout(this).apply {
            orientation = LinearLayout.VERTICAL
            setPadding(dp(16), dp(30), dp(16), dp(32))
        }

        col.addView(header())
        col.addView(hero(), spaced(14))
        buildSetup(col)

        col.addView(sectionHead("Right now"))
        col.addView(tiles())
        col.addView(quickActions(), spaced(8))

        col.addView(sectionHead("Music apps", "Refresh") { MusicServices.checkAll(this) { showServices() } })
        servicesList = group()
        col.addView(servicesList)

        col.addView(sectionHead("Car Thing"))
        col.addView(group().apply {
            addView(groupRow(null, "Find a place on the Car Thing", "Type an address here; pick it on the Car Thing", chevron()) {
                findPlaceDialog()
            })
            addView(groupRow(null, "Car Thing settings", "Brightness, night mode, lyrics, Wisp's voice and more", chevron()) {
                startActivity(Intent(this@MainActivity, CarSettingsActivity::class.java))
            })
        })

        col.addView(sectionHead("Options"))
        col.addView(options())

        col.addView(sectionHead("Updates and help"))
        col.addView(updatesAndHelp())

        col.addView(footer(), spaced(22))

        blobs = BlobBackground(this)
        // Android 15 draws every app edge to edge: keep the content clear of the status
        // bar above and the navigation bar below, the blobs still running under both
        col.setOnApplyWindowInsetsListener { v, insets ->
            val (top, bottom) = barInsets(insets)
            v.setPadding(dp(16), dp(30) + top, dp(16), dp(32) + bottom)
            insets
        }
        // a dark fade under the status bar, so the list doesn't scroll messily under the clock
        val scrim = View(this).apply {
            background = android.graphics.drawable.GradientDrawable(
                android.graphics.drawable.GradientDrawable.Orientation.TOP_BOTTOM,
                intArrayOf(Color.argb(0xF2, 0x0B, 0x0B, 0x0C), Color.argb(0xB3, 0x0B, 0x0B, 0x0C), Color.argb(0, 0x0B, 0x0B, 0x0C)),
            )
        }
        scrim.setOnApplyWindowInsetsListener { v, insets ->
            v.layoutParams = v.layoutParams.apply { height = barInsets(insets).first + dp(18) }
            insets
        }
        setContentView(FrameLayout(this).apply {
            addView(blobs, FrameLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.MATCH_PARENT))
            addView(ScrollView(this@MainActivity).apply {
                isFillViewport = true
                isVerticalScrollBarEnabled = false
                addView(col)
            })
            addView(scrim, FrameLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, 0, Gravity.TOP))
        })

        LinkService.start(this)
        MusicServices.checkAll(this) { showServices() }
        // once per launch: a new app shows as a pop-up (or, from the notification, starts updating)
        updateFromNotice = intent?.getBooleanExtra(UpdateNotice.EXTRA_UPDATE, false) == true
        AppUpdater.check(this) {
            refresh()
            afterUpdateCheck()
        }
    }

    // opened from the "new app" notification: update without asking again
    private var updateFromNotice = false
    // the pop-up shows once per version per launch
    private var offeredVersion: String? = null

    override fun onNewIntent(intent: Intent) {
        super.onNewIntent(intent)
        if (intent.getBooleanExtra(UpdateNotice.EXTRA_UPDATE, false)) {
            updateFromNotice = true
            if (AppUpdater.state is AppUpdater.State.Available) afterUpdateCheck()
            else AppUpdater.check(this) {
                refresh()
                afterUpdateCheck()
            }
        }
    }

    private fun afterUpdateCheck() {
        val s = AppUpdater.state as? AppUpdater.State.Available ?: return
        if (isFinishing || isDestroyed) return
        if (updateFromNotice) {
            updateFromNotice = false
            startAppUpdate(s.offer)
            return
        }
        if (offeredVersion == s.offer.version) return
        offeredVersion = s.offer.version
        UpdateNotice.seen(this, s.offer.version)
        android.app.AlertDialog.Builder(this, android.R.style.Theme_DeviceDefault_Dialog_Alert)
            .setTitle("Update available")
            .setMessage("Wisp app ${s.offer.version} is out (you have ${AppUpdater.installedVersion(this)}). Update now? Android asks you to confirm the install.")
            .setPositiveButton("Update") { _, _ -> startAppUpdate(s.offer) }
            .setNegativeButton("Later", null)
            .show()
    }

    private fun startAppUpdate(offer: AppUpdater.Offer) {
        UpdateNotice.clear(this)
        AppUpdater.install(this, offer) { refresh() }
        refresh()
    }

    override fun onResume() {
        super.onResume()
        // back from signing in: show it
        if (::servicesList.isInitialized) showServices()
        if (driveMusicSub != null) refreshDriveMusic()
        handler.post(tick)
    }

    override fun onPause() {
        super.onPause()
        handler.removeCallbacks(tick)
    }

    // ---------------------------------------------------------------- the screen's parts

    private fun header(): View {
        val row = LinearLayout(this).apply {
            gravity = Gravity.CENTER_VERTICAL
            setPadding(dp(4), 0, dp(4), 0)
        }
        val mark = LinearLayout(this).apply {
            orientation = LinearLayout.VERTICAL
            gravity = Gravity.CENTER_HORIZONTAL
        }
        // its own width: a vertical row's default is the column's, which the underline sets
        mark.addView(text("wisp", 26f, medium, WHITE).apply {
            letterSpacing = -0.04f
            includeFontPadding = false
        }, LinearLayout.LayoutParams(ViewGroup.LayoutParams.WRAP_CONTENT, ViewGroup.LayoutParams.WRAP_CONTENT))
        mark.addView(WispUnderline(this, GREEN), LinearLayout.LayoutParams(dp(40), dp(9)).apply { topMargin = dp(4) })
        row.addView(mark)
        row.addView(text("Companion", 13f, semibold, TERTIARY).apply { setPadding(dp(10), 0, 0, dp(10)) },
            LinearLayout.LayoutParams(0, ViewGroup.LayoutParams.WRAP_CONTENT, 1f).apply { gravity = Gravity.BOTTOM })
        row.addView(chip("v${AppUpdater.installedVersion(this)}", SECONDARY, Color.argb(0x99, 0x18, 0x18, 0x1B)))
        return row
    }

    private fun hero(): View {
        val card = panel(22).apply {
            orientation = LinearLayout.VERTICAL
            setPadding(dp(14), dp(14), dp(14), dp(14))
        }
        wisp = WispLink(this)
        card.addView(wisp)

        val line = LinearLayout(this).apply { gravity = Gravity.CENTER_VERTICAL }
        val words = LinearLayout(this).apply { orientation = LinearLayout.VERTICAL }
        linkTitle = text("", 17f, semibold, WHITE)
        linkBody = text("", 13f, medium, SECONDARY).apply { setPadding(0, dp(2), 0, 0) }
        words.addView(linkTitle)
        words.addView(linkBody)
        line.addView(words, LinearLayout.LayoutParams(0, ViewGroup.LayoutParams.WRAP_CONTENT, 1f))
        liveBadge = LinearLayout(this).apply {
            gravity = Gravity.CENTER_VERTICAL
            background = round(Color.argb(0x1F, 0x1E, 0xD7, 0x60), dp(99))
            setPadding(dp(8), dp(5), dp(10), dp(5))
            addView(View(context).apply { background = round(GREEN, dp(4)) }, LinearLayout.LayoutParams(dp(7), dp(7)).apply { marginEnd = dp(6) })
            addView(text("Live", 12f, semibold, GREEN))
        }
        line.addView(liveBadge)
        card.addView(line, spaced(12))

        // setup progress, while there's anything left to do
        progressRow = LinearLayout(this).apply {
            orientation = LinearLayout.VERTICAL
            val labels = LinearLayout(context)
            labels.addView(text("Setup", 12f, semibold, SECONDARY), LinearLayout.LayoutParams(0, ViewGroup.LayoutParams.WRAP_CONTENT, 1f))
            progressLabel = text("", 12f, semibold, SECONDARY)
            labels.addView(progressLabel)
            addView(labels)
            val track = FrameLayout(context).apply { background = round(Color.rgb(0x26, 0x26, 0x2A), dp(3)) }
            progressFill = View(context).apply { background = round(GREEN, dp(3)) }
            track.addView(progressFill, FrameLayout.LayoutParams(0, ViewGroup.LayoutParams.MATCH_PARENT))
            addView(track, LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, dp(6)).apply { topMargin = dp(7) })
        }
        card.addView(progressRow, spaced(12))

        // three small facts
        val stats = LinearLayout(this)
        fun stat(label: String): TextView {
            val box = LinearLayout(this).apply {
                orientation = LinearLayout.VERTICAL
                background = round(Color.rgb(0x1C, 0x1C, 0x1F), dp(12))
                setPadding(dp(10), dp(9), dp(10), dp(9))
            }
            box.addView(text(label, 11f, semibold, TERTIARY))
            val v = text("", 13f, semibold, WHITE).apply { setPadding(0, dp(2), 0, 0) }
            box.addView(v)
            stats.addView(box, LinearLayout.LayoutParams(0, ViewGroup.LayoutParams.WRAP_CONTENT, 1f).apply {
                if (stats.childCount > 0) marginStart = dp(8)
            })
            return v
        }
        statDirections = stat("Directions")
        statCalls = stat("Calls")
        statBattery = stat("Phone")
        card.addView(stats, spaced(12))
        return card
    }

    private fun buildSetup(col: LinearLayout) {
        setupHead = sectionHead("Finish setting up")
        col.addView(setupHead)
        setupGroup = group()
        col.addView(setupGroup)
        doneLine = text("", 13f, medium, SECONDARY).apply {
            setPadding(dp(8), dp(8), dp(8), 0)
            compoundDrawablePadding = dp(8)
            setCompoundDrawablesRelativeWithIntrinsicBounds(tinted(R.drawable.ic_w_check, GREEN, 16), null, null, null)
        }
        col.addView(doneLine)

        fun step(icon: Int, label: String, title: String, sub: String, button: String, needed: () -> Boolean, action: () -> Unit) {
            val pill = text(button, 13f, bold, if (button == "Allow") Color.BLACK else WHITE).apply {
                background = round(if (button == "Allow") GREEN else Color.rgb(0x26, 0x26, 0x2A), dp(99))
                setPadding(dp(14), dp(7), dp(14), dp(7))
            }
            val row = groupRow(iconTile(icon, AMBER, Color.argb(0x1F, 0xF5, 0xA5, 0x24)), title, sub, pill) { action() }
            setupGroup.addView(row)
            steps.add(Step(row, label, needed))
        }
        step(R.drawable.ic_w_bell, "notification access", "Notification access", "Directions and media from this phone", "Allow",
            { !notificationAccess() }) { startActivity(Intent(Settings.ACTION_NOTIFICATION_LISTENER_SETTINGS)) }
        step(R.drawable.ic_w_pin, "location", "Location", "Your position on the Car Thing's map", "Allow",
            { !granted(Manifest.permission.ACCESS_FINE_LOCATION) }) {
            requestPermissions(arrayOf(Manifest.permission.ACCESS_FINE_LOCATION, Manifest.permission.ACCESS_COARSE_LOCATION), 1)
        }
        // Android only grants this from its settings page, after the foreground grant
        step(R.drawable.ic_w_pin, "location all the time", "Location all the time", "So the map follows with Maps on screen", "Allow",
            { granted(Manifest.permission.ACCESS_FINE_LOCATION) && !granted(Manifest.permission.ACCESS_BACKGROUND_LOCATION) }) {
            requestPermissions(arrayOf(Manifest.permission.ACCESS_BACKGROUND_LOCATION), 2)
        }
        step(R.drawable.ic_w_bell, "notifications", "Notifications", "Prompts from Wisp, like opening Spotify", "Allow",
            { !granted(Manifest.permission.POST_NOTIFICATIONS) }) {
            requestPermissions(arrayOf(Manifest.permission.POST_NOTIFICATIONS), 3)
        }
        // who's calling, with Answer and Decline, on the Car Thing
        step(R.drawable.ic_w_call, "calls", "Calls on the Car Thing", "Answer and decline from the dash", "Allow",
            { !PhoneCalls.allowed(this) }) {
            requestPermissions(arrayOf(Manifest.permission.READ_PHONE_STATE, Manifest.permission.ANSWER_PHONE_CALLS), 4)
        }
        // "call Mom" said to the Car Thing: the contact found here, the call placed here
        step(R.drawable.ic_w_call, "call by voice", "Call by voice", "Say \"call Mom\" to the Car Thing", "Allow",
            { !VoiceActions.allowed(this) }) {
            requestPermissions(arrayOf(Manifest.permission.READ_CONTACTS, Manifest.permission.CALL_PHONE), 9)
        }
        // phones without Gemini Nano: the open model, offered once with its size up front
        step(R.drawable.ic_w_pulse, "smarter voice", "Smarter voice", "Understands more of how you talk · ${OpenModel.sizeMb()}", "Get",
            { WispThink.nanoMissing && !OpenModel.downloaded(this) && OpenModel.progress < 0 && !Prefs.thinkOfferSkipped(this) }) {
            confirmModelDownload(null, fromSetup = true)
        }
        // the visualizer reads the phone's sound output; Android files that under the microphone
        step(R.drawable.ic_w_bars, "visualizer", "Visualizer", "Reads the phone's sound, not the mic", "Allow",
            { !PhoneViz.allowed(this) }) { requestPermissions(arrayOf(Manifest.permission.RECORD_AUDIO), 5) }
        // so phones that clear background apps leave Wisp alone
        step(R.drawable.ic_w_battery, "battery", "Run in the background", "So the link to Wisp stays up", "Allow",
            { !unrestricted() }) {
            startActivity(Intent(Settings.ACTION_REQUEST_IGNORE_BATTERY_OPTIMIZATIONS).setData(android.net.Uri.parse("package:$packageName")))
        }
        // with mobile data, a restricted app gets no internet in the background: no
        // library, no covers, no update downloads
        step(R.drawable.ic_w_data, "background data", "Background data", "Covers, libraries and updates on mobile data", "Open",
            { !backgroundDataOk() }) {
            startActivity(Intent(Settings.ACTION_IGNORE_BACKGROUND_DATA_RESTRICTIONS_SETTINGS).setData(android.net.Uri.parse("package:$packageName")))
        }
        // Samsung puts Optimized apps to sleep on its own. An Unrestricted one (the
        // step above) isn't, and Samsung leaves it out of that list, so only then
        step(R.drawable.ic_w_moon, "never sleeping", "Never sleeping apps", "Samsung: so Wisp isn't put to sleep", "Open",
            { isSamsung && !unrestricted() && !Prefs.samsungSleepDone(this) }) { openSamsungSleeping() }
        // Android only lets a background app open another one with this
        step(R.drawable.ic_w_open, "opening Spotify", "Opening Spotify for you", "When Wisp needs it playing", "Allow",
            { !Settings.canDrawOverlays(this) }) {
            startActivity(Intent(Settings.ACTION_MANAGE_OVERLAY_PERMISSION).setData(android.net.Uri.parse("package:$packageName")))
        }
    }

    private fun tiles(): View {
        val grid = GridLayout(this).apply { columnCount = 2 }
        fun tile(index: Int, icon: Int?, label: String, lead: View? = null): Tile {
            val box = panel(16).apply {
                orientation = LinearLayout.VERTICAL
                setPadding(dp(12), dp(12), dp(12), dp(12))
            }
            val top = LinearLayout(this).apply {
                gravity = Gravity.CENTER_VERTICAL
                minimumHeight = dp(18)
            }
            var iv: ImageView? = null
            if (lead != null) top.addView(lead) else if (icon != null) {
                iv = ImageView(this).apply { setImageDrawable(tinted(icon, GREEN, 16)) }
                // 16 dp like the bars: an ImageView otherwise takes the icon's own 24
                top.addView(iv, LinearLayout.LayoutParams(dp(16), dp(16)))
            }
            top.addView(text(label, 12f, semibold, SECONDARY).apply { setPadding(dp(7), 0, 0, 0) })
            box.addView(top)
            val value = text("", 14f, semibold, WHITE).apply {
                maxLines = 1
                ellipsize = TextUtils.TruncateAt.END
                setPadding(0, dp(6), 0, 0)
            }
            box.addView(value)
            grid.addView(box, GridLayout.LayoutParams(GridLayout.spec(index / 2), GridLayout.spec(index % 2, 1f)).apply {
                width = 0
                if (index % 2 == 1) marginStart = dp(8)
                if (index >= 2) topMargin = dp(8)
            })
            return Tile(iv, value)
        }
        navTile = tile(0, R.drawable.ic_w_nav, "Navigation")
        eq = EqBars(this, GREEN)
        mediaTile = tile(1, null, "Playing", eq)
        locTile = tile(2, R.drawable.ic_w_pin, "Location")
        spotifyTile = tile(3, R.drawable.ic_w_spotify, "Spotify")
        return grid
    }

    private fun quickActions(): View {
        val row = LinearLayout(this)
        fun action(icon: Int, label: String, onClick: () -> Unit): View = LinearLayout(this).apply {
            gravity = Gravity.CENTER
            background = round(Color.argb(0xD9, 0x1C, 0x1C, 0x1F), dp(14))
            addView(ImageView(context).apply { setImageDrawable(tinted(icon, WHITE, 16)) }, LinearLayout.LayoutParams(dp(16), dp(16)))
            addView(text(label, 14f, semibold, WHITE).apply { setPadding(dp(8), 0, 0, 0) })
            isClickable = true
            foreground = getDrawable(android.R.drawable.list_selector_background)
            setOnClickListener { onClick() }
        }
        row.addView(action(R.drawable.ic_w_play, "Wake Spotify") { SpotifyWaker.wake(this, prompt = false) },
            LinearLayout.LayoutParams(0, dp(48), 1f))
        // Drive Mode keeps a record of each drive, for tuning how it reacts
        row.addView(action(R.drawable.ic_w_share, "Share last drive") {
            if (!DriveRecorder.share(this)) Toast.makeText(this, "No Drive Mode drive yet", Toast.LENGTH_SHORT).show()
        }, LinearLayout.LayoutParams(0, dp(48), 1f).apply { marginStart = dp(8) })
        return row
    }

    private fun options(): View {
        val g = group()
        g.addView(switchRow("Keep running in the background", "Keeps the link to Wisp alive", Prefs.keepRunning(this)) { on ->
            Prefs.setKeepRunning(this, on)
            if (on) LinkService.start(this) else LinkService.stop(this)
        })
        g.addView(switchRow("Wake Spotify when Wisp connects", null, Prefs.wakeOnConnect(this)) { Prefs.setWakeOnConnect(this, it) })
        g.addView(switchRow("Update the app automatically", "New versions install by themselves", Prefs.autoUpdateApp(this)) { Prefs.setAutoUpdateApp(this, it) })
        g.addView(switchRow("Allow Wi-Fi connections", "For the PC simulator", Prefs.allowLan(this)) { Prefs.setAllowLan(this, it) })
        iconPreview = ImageView(this).apply { setImageResource(AppIcons.current(this@MainActivity).preview) }
        val trailing = LinearLayout(this).apply {
            gravity = Gravity.CENTER_VERTICAL
            addView(iconPreview, LinearLayout.LayoutParams(dp(30), dp(30)).apply { marginEnd = dp(6) })
            addView(ImageView(context).apply { setImageDrawable(tinted(R.drawable.ic_w_chevron, TERTIARY, 16)) })
        }
        g.addView(groupRow(null, "App icon", "How Wisp looks on your home screen", trailing) { iconSheet() })
        driveMusicSub = text("", 12f, medium, TERTIARY)
        g.addView(groupRowViews(null, text("Drive Mode music", 15f, semibold, WHITE), driveMusicSub, chevron()) { driveMusicSheet() })
        refreshDriveMusic()
        thinkSub = text("", 12f, medium, TERTIARY)
        g.addView(groupRowViews(null, text("Wisp's thinking", 15f, semibold, WHITE), thinkSub, chevron()) { thinkSheet() })
        refreshThink()
        for (i in 1 until g.childCount) divide(g.getChildAt(i), true)
        return g
    }

    private var driveMusicSub: TextView? = null

    // sizing walks the folders: off the main thread
    private fun refreshDriveMusic() {
        Thread {
            val bytes = DriveMusic.usage(this)
            runOnUiThread {
                driveMusicSub?.text = if (bytes < 1_000_000) "Nothing downloaded" else "${mb(bytes)} on this phone"
            }
        }.start()
    }

    private fun mb(bytes: Long) = "${(bytes + 500_000) / 1_000_000} MB"

    private fun updatesAndHelp(): View {
        val g = group()
        appUpdateTitle = text("", 15f, semibold, WHITE)
        appUpdateSub = text("", 12f, medium, TERTIARY)
        appUpdateChip = chip("", GREEN, Color.argb(0x1F, 0x1E, 0xD7, 0x60))
        g.addView(groupRowViews(iconTile(R.drawable.ic_w_update, Color.argb(0xC0, 0xFF, 0xFF, 0xFF), Color.rgb(0x1F, 0x1F, 0x22)),
            appUpdateTitle, appUpdateSub, appUpdateChip) {
            when (val s = AppUpdater.state) {
                is AppUpdater.State.Available -> AppUpdater.install(this, s.offer) { refresh() }
                is AppUpdater.State.Downloading, AppUpdater.State.Installing, AppUpdater.State.Checking -> {}
                else -> AppUpdater.check(this) { refresh() }
            }
        })
        githubSub = text("", 12f, medium, TERTIARY)
        g.addView(groupRowViews(iconTile(R.drawable.ic_w_key, Color.argb(0xC0, 0xFF, 0xFF, 0xFF), Color.rgb(0x1F, 0x1F, 0x22)),
            text("Updates", 15f, semibold, WHITE), githubSub, chevron()) { githubSheet() })
        g.addView(groupRow(iconTile(R.drawable.ic_w_pulse, Color.argb(0xC0, 0xFF, 0xFF, 0xFF), Color.rgb(0x1F, 0x1F, 0x22)),
            "Diagnostics", "Connection details, for troubleshooting", chevron()) { diagnosticsSheet() })
        for (i in 1 until g.childCount) divide(g.getChildAt(i), true)
        return g
    }

    private fun footer(): View = LinearLayout(this).apply {
        orientation = LinearLayout.VERTICAL
        gravity = Gravity.CENTER_HORIZONTAL
        addView(WispUnderline(context, Color.argb(0xB3, 0x1E, 0xD7, 0x60)), LinearLayout.LayoutParams(dp(60), dp(14)))
        addView(text("Directions, music and calls, carried to your Car Thing", 12f, medium, TERTIARY).apply {
            gravity = Gravity.CENTER
            setPadding(0, dp(6), 0, 0)
        })
    }

    // ---------------------------------------------------------------- the sheets


    // over-the-air updates come from Wisp's public GitHub repo; a fork can point at its own
    private fun githubSheet() = sheet("Updates", "Where Wisp gets its updates", R.drawable.ic_w_key) { body, d ->
        body.addView(text(
            "Wisp updates itself and this app from its public GitHub repo. Change this only to " +
                "follow your own fork.",
            14f, medium, SECONDARY,
        ).apply { setLineSpacing(0f, 1.3f) }, spaced(14))
        val repo = field("owner/repo", Prefs.githubRepo(this), secret = false)
        body.addView(text("Repository", 12f, semibold, SECONDARY), spaced(14))
        body.addView(repo)
        body.addView(text("Save", 16f, bold, Color.BLACK).apply {
            gravity = Gravity.CENTER
            background = round(GREEN, dp(16))
            setOnClickListener {
                Prefs.setGithubRepo(this@MainActivity, repo.text.toString().ifBlank { Prefs.DEFAULT_REPO })
                NavServer.pushUpdateAuth()
                Toast.makeText(this@MainActivity, "Saved. Wisp checks for updates now.", Toast.LENGTH_SHORT).show()
                d.dismiss()
                refresh()
            }
        }, LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, dp(52)).apply { topMargin = dp(18) })
        body.addView(text("Cancel", 14f, semibold, SECONDARY).apply {
            gravity = Gravity.CENTER
            setPadding(0, dp(14), 0, 0)
            setOnClickListener { d.dismiss() }
        })
    }

    private fun iconSheet() = sheet("App icon", "Pick how Wisp looks on your home screen", R.drawable.ic_w_grid) { body, d ->
        val row = LinearLayout(this).apply { setPadding(0, dp(18), 0, dp(6)) }
        val current = AppIcons.current(this)
        AppIcons.ALL.forEach { icon ->
            val chosen = icon == current
            val cell = LinearLayout(this).apply {
                orientation = LinearLayout.VERTICAL
                gravity = Gravity.CENTER_HORIZONTAL
                setPadding(dp(4), dp(10), dp(4), dp(10))
                background = if (chosen) GradientDrawable().apply {
                    setColor(Color.argb(0x14, 0x1E, 0xD7, 0x60))
                    setStroke(dp(2), GREEN)
                    cornerRadius = dp(18).toFloat()
                } else null
                setOnClickListener {
                    AppIcons.set(this@MainActivity, icon)
                    iconPreview.setImageResource(icon.preview)
                    Toast.makeText(this@MainActivity, "Icon changed. Your home screen updates in a moment.", Toast.LENGTH_SHORT).show()
                    d.dismiss()
                }
            }
            cell.addView(ImageView(this).apply { setImageResource(icon.preview) }, LinearLayout.LayoutParams(dp(58), dp(58)))
            cell.addView(text(icon.label, 13f, semibold, if (chosen) GREEN else SECONDARY).apply {
                gravity = Gravity.CENTER
                setPadding(0, dp(6), 0, 0)
            }, LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.WRAP_CONTENT))
            row.addView(cell, LinearLayout.LayoutParams(0, ViewGroup.LayoutParams.WRAP_CONTENT, 1f).apply {
                if (row.childCount > 0) marginStart = dp(6)
            })
        }
        body.addView(row)
    }

    // Drive Mode's songs and their decoded sound: deleted here, downloaded again when next picked
    private fun driveMusicSheet() = sheet("Drive Mode music", "Songs for Drive Mode's sounds", R.drawable.ic_w_data) { body, d ->
        val note = text("Working it out…", 14f, medium, SECONDARY).apply { setLineSpacing(0f, 1.3f) }
        body.addView(note, spaced(14))
        val delete = text("Delete music", 16f, bold, Color.WHITE).apply {
            gravity = Gravity.CENTER
            background = round(Color.rgb(0xD9, 0x3B, 0x3B), dp(16))
            isEnabled = false
            alpha = 0.4f
        }
        body.addView(delete, LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, dp(52)).apply { topMargin = dp(18) })
        body.addView(text("Cancel", 14f, semibold, SECONDARY).apply {
            gravity = Gravity.CENTER
            setPadding(0, dp(14), 0, 0)
            setOnClickListener { d.dismiss() }
        })
        Thread {
            val bytes = DriveMusic.usage(this)
            runOnUiThread {
                if (bytes < 1_000_000) {
                    note.text = "Nothing's downloaded. Each sound downloads (about 22 MB) the first time you pick it in Drive Mode."
                    return@runOnUiThread
                }
                note.text = "Drive Mode's songs take ${mb(bytes)}: the downloads, plus the sound unpacked so " +
                    "the phone can mix it as you drive. Deleting stops Drive Mode if it's playing; each sound " +
                    "downloads again (about 22 MB) the next time you pick it."
                delete.isEnabled = true
                delete.alpha = 1f
                delete.setOnClickListener {
                    delete.isEnabled = false
                    Thread {
                        DriveMusic.deleteAll(this)
                        runOnUiThread {
                            Toast.makeText(this, "Deleted ${mb(bytes)}", Toast.LENGTH_SHORT).show()
                            d.dismiss()
                            refreshDriveMusic()
                        }
                    }.start()
                }
            }
        }.start()
    }

    private var thinkSub: TextView? = null

    private fun refreshThink() {
        thinkSub?.text = when {
            OpenModel.progress >= 0 -> "Downloading ${OpenModel.NAME}… ${OpenModel.progress}%"
            WispThink.model == "nano" && WispThink.state == "ready" -> "Gemini Nano, on this phone"
            WispThink.model == "nano" -> "Getting Gemini Nano ready…"
            WispThink.model == "open" -> "${OpenModel.NAME}, on this phone"
            WispThink.nanoMissing -> "Off: no model on this phone yet"
            else -> "Looking for this phone's model…"
        }
    }

    // the language model behind Wisp's voice on this phone; the open one only after a size warning
    private fun thinkSheet() = sheet("Wisp's thinking", "Understanding what you say to the Car Thing", R.drawable.ic_w_pulse) { body, d ->
        val note = text("", 14f, medium, SECONDARY).apply { setLineSpacing(0f, 1.3f) }
        body.addView(note, spaced(14))
        val button = text("", 16f, bold, Color.BLACK).apply {
            gravity = Gravity.CENTER
            background = round(GREEN, dp(16))
        }
        val buttonParams = LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, dp(52)).apply { topMargin = dp(18) }
        val open = OpenModel.downloaded(this)
        // a quieter second choice: switching models, on a phone with Gemini Nano
        fun outline(label: String, onTap: () -> Unit) = text(label, 15f, semibold, WHITE).apply {
            gravity = Gravity.CENTER
            background = GradientDrawable().apply {
                cornerRadius = dp(16).toFloat()
                setStroke(dp(1), SECONDARY)
            }
            setOnClickListener { onTap() }
        }
        when {
            WispThink.model == "nano" -> {
                note.text = "Wisp understands looser requests and answers questions with Gemini Nano, " +
                    "Google's model built into this phone. It runs on the phone; nothing you say is sent online.\n\n" +
                    "You can use ${OpenModel.NAME}, an open model, instead" +
                    (if (open) "; it's already downloaded." else " (a ${OpenModel.sizeMb()} download).")
                body.addView(outline("Use ${OpenModel.NAME} instead") {
                    if (open) {
                        WispThink.setPreferOpen(this, true)
                        d.dismiss()
                        refreshThink()
                    } else {
                        confirmModelDownload(d, preferOpen = true)
                    }
                }, buttonParams)
            }
            open -> {
                note.text = "Wisp uses ${OpenModel.NAME}, an open model downloaded to this phone (${OpenModel.sizeMb()}). " +
                    "It runs on the phone; nothing you say is sent online. It only takes up memory while you're talking to Wisp." +
                    if (WispThink.nanoHere) "\n\nThis phone also has Gemini Nano, which is usually quicker." else ""
                if (WispThink.nanoHere) {
                    body.addView(outline("Switch to Gemini Nano") {
                        WispThink.setPreferOpen(this, false)
                        d.dismiss()
                        refreshThink()
                    }, buttonParams)
                }
                button.text = "Delete the model"
                button.setTextColor(Color.WHITE)
                button.background = round(Color.rgb(0xD9, 0x3B, 0x3B), dp(16))
                button.setOnClickListener {
                    OpenModel.delete(this)
                    WispThink.setPreferOpen(this, false)
                    Toast.makeText(this, "Deleted ${OpenModel.sizeMb()}", Toast.LENGTH_SHORT).show()
                    d.dismiss()
                    refreshThink()
                }
                body.addView(button, LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, dp(52)).apply { topMargin = dp(10) })
            }
            else -> {
                note.text = "This phone doesn't have Gemini Nano. Without a model, the Car Thing still understands " +
                    "everyday commands on its own; a model adds questions in your own words and looser requests.\n\n" +
                    "${OpenModel.NAME} is an open model (Apache-2.0) that runs on this phone. Nothing you say is sent online."
                button.text = "Download (${OpenModel.sizeMb()})"
                button.setOnClickListener { confirmModelDownload(d) }
                body.addView(button, buttonParams)
            }
        }
        body.addView(text("Close", 14f, semibold, SECONDARY).apply {
            gravity = Gravity.CENTER
            setPadding(0, dp(14), 0, 0)
            setOnClickListener { d.dismiss() }
        })
    }

    // an address typed on the phone, looked up on the Car Thing (its Where to?)
    private fun findPlaceDialog() {
        val input = field("An address or a place", "", secret = false).apply {
            imeOptions = android.view.inputmethod.EditorInfo.IME_ACTION_SEARCH
        }
        val box = LinearLayout(this).apply {
            setPadding(dp(20), dp(8), dp(20), 0)
            addView(input)
        }
        val send = {
            val q = input.text.toString().trim()
            if (q.isNotEmpty()) {
                val msg = if (NavServer.sendFind(q)) "On your Car Thing: pick it there" else "Connect your Car Thing first"
                Toast.makeText(this, msg, Toast.LENGTH_SHORT).show()
            }
        }
        val dialog = android.app.AlertDialog.Builder(this, android.R.style.Theme_DeviceDefault_Dialog_Alert)
            .setTitle("Find a place on the Car Thing")
            .setView(box)
            .setPositiveButton("Send") { _, _ -> send() }
            .setNegativeButton("Cancel", null)
            .create()
        input.setOnEditorActionListener { _, _, _ ->
            send()
            dialog.dismiss()
            true
        }
        dialog.window?.setSoftInputMode(android.view.WindowManager.LayoutParams.SOFT_INPUT_STATE_VISIBLE)
        dialog.show()
        input.requestFocus()
    }

    // a large download: said plainly before it starts
    private fun confirmModelDownload(sheet: android.app.Dialog?, preferOpen: Boolean = false, fromSetup: Boolean = false) {
        android.app.AlertDialog.Builder(this, android.R.style.Theme_DeviceDefault_Dialog_Alert)
            .setTitle("Large download: ${OpenModel.sizeMb()}")
            .setMessage(
                "This downloads ${OpenModel.NAME} (${OpenModel.sizeMb()}) to this phone. On mobile data it will use " +
                    "${OpenModel.sizeMb()} of your plan, so Wi-Fi is best. It needs that much free space too. " +
                    "You can delete it here at any time.",
            )
            .setPositiveButton("Download") { _, _ ->
                sheet?.dismiss()
                refresh()
                Thread {
                    var first = true
                    val ok = OpenModel.download(this) {
                        runOnUiThread {
                            // the first percent takes the setup step off the list
                            if (first) refresh() else refreshThink()
                            first = false
                        }
                    }
                    runOnUiThread {
                        if (ok && preferOpen) WispThink.setPreferOpen(this, true) else WispThink.openModelChanged()
                        refresh()
                        Toast.makeText(
                            this,
                            if (ok) "${OpenModel.NAME} is ready" else "The download didn't finish; try again on Wi-Fi",
                            Toast.LENGTH_LONG,
                        ).show()
                    }
                }.start()
            }
            .setNegativeButton(if (fromSetup) "Skip" else "Not now") { _, _ ->
                // skipped in setup: off the list, still in Options → Wisp's thinking
                if (fromSetup) {
                    Prefs.setThinkOfferSkipped(this)
                    refresh()
                }
            }
            .show()
    }

    // the raw readout, for when something needs a closer look
    private fun diagnosticsSheet() = sheet("Diagnostics", "Send this screen when something's wrong", R.drawable.ic_w_pulse) { body, d ->
        val t = text("", 12f, null, SECONDARY).apply {
            typeface = Typeface.MONOSPACE
            setTextIsSelectable(true)
        }
        diagnostics = t
        t.text = detailText(notificationAccess(), granted(Manifest.permission.ACCESS_FINE_LOCATION), granted(Manifest.permission.ACCESS_BACKGROUND_LOCATION))
        body.addView(ScrollView(this).apply { addView(t) }, LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, dp(380)).apply { topMargin = dp(14) })
        d.setOnDismissListener { diagnostics = null }
    }

    // ---------------------------------------------------------------- keeping it current

    private fun granted(p: String) = checkSelfPermission(p) == PackageManager.PERMISSION_GRANTED

    // battery set to Unrestricted: Android's "always run in the background"
    private fun unrestricted() =
        getSystemService(android.os.PowerManager::class.java)?.isIgnoringBatteryOptimizations(packageName) == true

    private fun notificationAccess(): Boolean {
        val me = ComponentName(this, NavListenerService::class.java).flattenToString()
        return Settings.Secure.getString(contentResolver, "enabled_notification_listeners")
            ?.split(':')?.contains(me) == true
    }

    // asking can be refused on some phones: then assume it's fine rather than fail
    private fun backgroundDataOk() = try {
        getSystemService(android.net.ConnectivityManager::class.java)?.restrictBackgroundStatus !=
            android.net.ConnectivityManager.RESTRICT_BACKGROUND_STATUS_ENABLED
    } catch (e: Exception) {
        true
    }

    private fun refresh() {
        refreshThink()
        refreshAppUpdate()
        val notif = notificationAccess()
        val loc = granted(Manifest.permission.ACCESS_FINE_LOCATION)
        val bg = granted(Manifest.permission.ACCESS_BACKGROUND_LOCATION)

        // the setup checklist: only what's left
        var left = 0
        val done = mutableListOf<String>()
        steps.forEach { s ->
            val need = s.needed()
            s.row.visibility = if (need) View.VISIBLE else View.GONE
            if (need) left++ else done.add(s.label)
        }
        // a divider above every visible row but the first
        var first = true
        for (i in 0 until setupGroup.childCount) {
            val r = setupGroup.getChildAt(i)
            if (r.visibility != View.VISIBLE) continue
            divide(r, !first)
            first = false
        }
        setupHead.visibility = if (left > 0) View.VISIBLE else View.GONE
        setupGroup.visibility = if (left > 0) View.VISIBLE else View.GONE
        doneLine.visibility = if (left > 0 && done.isNotEmpty()) View.VISIBLE else View.GONE
        doneLine.text = when {
            done.size <= 3 -> done.joinToString(", ").replaceFirstChar { it.uppercase() } + " done"
            else -> done.take(3).joinToString(", ").replaceFirstChar { it.uppercase() } + " and ${done.size - 3} more done"
        }
        progressRow.visibility = if (left > 0) View.VISIBLE else View.GONE
        progressLabel.text = "${steps.size - left} of ${steps.size} done"
        (progressRow as? LinearLayout)?.getChildAt(1)?.let { track ->
            track.post {
                val w = (track.width * (steps.size - left) / steps.size.coerceAtLeast(1))
                progressFill.layoutParams = progressFill.layoutParams.apply { width = w }
                progressFill.requestLayout()
            }
        }

        // the link
        val cars = NavServer.connectedCars
        val connected = cars > 0
        wisp.connected = connected
        blobs.topColor = if (connected) GREEN else AMBER
        liveBadge.visibility = if (connected) View.VISIBLE else View.GONE
        when {
            !notif -> link("Needs setup", "Allow notification access below and Wisp starts")
            connected -> link("Connected to Wisp", "Car Thing on the Bluetooth tether")
            NavServer.lastRefused != null -> link(
                "Wisp was turned away",
                "A connection came from ${NavServer.lastRefused}, not the tether. Open Diagnostics and send it over.",
            )
            NavServer.running -> link("Waiting for Wisp", "Turn on Bluetooth tethering; it connects on its own")
            else -> link("Starting…", "")
        }

        val turn = NavStore.turn
        statDirections.text = if (turn.active) "Guiding" else "Ready"
        statCalls.text = if (PhoneCalls.allowed(this)) "On" else "Off"
        statBattery.text = getSystemService(BatteryManager::class.java)
            ?.getIntProperty(BatteryManager.BATTERY_PROPERTY_CAPACITY)?.takeIf { it in 0..100 }?.let { "$it%" } ?: "–"

        setTile(navTile, turn.active, if (turn.active) listOf(turn.title, turn.text).filter { it.isNotBlank() }.joinToString(" · ") else "Not navigating")
        val media = MediaWatcher.summary
        setTile(mediaTile, media != null, media ?: "Nothing playing")
        eq.playing = media != null
        setTile(locTile, LocationFeed.running, when {
            LocationFeed.running -> "Sharing"
            bg -> "Ready"
            loc -> "While the app is open"
            else -> "Off"
        })
        setTile(spotifyTile, false, if (SpotifyWaker.installed(this)) "Ready" else "Not installed")

        val repo = Prefs.githubRepo(this)
        githubSub.text = repo

        diagnostics?.text = detailText(notif, loc, bg)
    }

    private fun setTile(t: Tile, active: Boolean, value: String) {
        if (t.value.text != value) t.value.text = value
        t.value.setTextColor(if (active) WHITE else Color.argb(0xC0, 0xFF, 0xFF, 0xFF))
        t.icon?.imageTintList = ColorStateList.valueOf(if (active) GREEN else Color.argb(0x66, 0xFF, 0xFF, 0xFF))
    }

    private fun link(title: String, body: String) {
        linkTitle.text = title
        linkBody.text = body
        linkBody.visibility = if (body.isEmpty()) View.GONE else View.VISIBLE
    }

    private fun showServices() {
        servicesList.removeAllViews()
        val found = MusicServices.services
        if (found.isEmpty()) {
            servicesList.addView(text("No other music apps found on this phone", 14f, medium, SECONDARY).apply {
                setPadding(dp(14), dp(14), dp(14), dp(14))
            })
            return
        }
        found.forEachIndexed { i, s ->
            // the services Wisp reads a library from with a sign-in here
            val lib = MusicLibrary.forApp(s.pkg)
            val signedIn = lib?.signedIn(this) == true
            val sub: CharSequence = when {
                signedIn -> "Library · signed in"
                lib != null -> SpannableStringBuilder("Not signed in · ").apply {
                    val start = length
                    append("Sign in")
                    setSpan(ForegroundColorSpan(GREEN), start, length, Spanned.SPAN_EXCLUSIVE_EXCLUSIVE)
                }
                else -> when (s.access) {
                    MusicServices.Access.CHECKING -> "Checking…"
                    MusicServices.Access.LIBRARY -> "Library and playback"
                    MusicServices.Access.PLAYBACK_ONLY, MusicServices.Access.REFUSED -> "Playback only"
                }
            }
            val icon = appIcon(s.pkg)?.let { d ->
                ImageView(this).apply { setImageDrawable(d) }
            }
            val sw = switch(MusicServices.enabled(this, s.pkg)) { on ->
                MusicServices.setEnabled(this, s.pkg, on)
                YtMusicLink.signedInChanged(this)
            }
            val row = groupRowViews(icon, text(s.label, 15f, semibold, WHITE), text(sub, 12f, medium, TERTIARY), sw,
                onClick = if (lib == null) null else ({
                    // YouTube Music and SoundCloud keep their libraries from other apps; signing in here reads them
                    if (lib.signedIn(this)) {
                        lib.signOut(this)
                        YtMusicLink.signedInChanged(this)
                        showServices()
                    } else {
                        val page = if (lib === SoundCloud) SoundCloudSignInActivity::class.java else YtMusicSignInActivity::class.java
                        startActivity(Intent(this, page))
                    }
                }),
            )
            divide(row, i > 0)
            servicesList.addView(row)
        }
    }

    /** an installed app's launcher icon, or none if Android won't say */
    private fun appIcon(pkg: String): Drawable? = try {
        packageManager.getApplicationIcon(pkg)
    } catch (e: Exception) {
        null
    }

    private val isSamsung get() = android.os.Build.MANUFACTURER.equals("samsung", ignoreCase = true)

    // Samsung's battery page (Device care → Battery → Background usage limits), else this app's battery page
    private fun openSamsungSleeping() {
        Prefs.setSamsungSleepDone(this, true)
        Toast.makeText(
            this,
            // Samsung leaves apps already set to Unrestricted out of that list
            "Background usage limits → Never sleeping apps → add Wisp (and YouTube Music). " +
                "Not in the list? Its battery is already Unrestricted, which does the same.",
            Toast.LENGTH_LONG,
        ).show()
        val tries = listOf(
            Intent().setClassName("com.samsung.android.lool", "com.samsung.android.sm.battery.ui.BatteryActivity"),
            Intent().setClassName("com.samsung.android.lool", "com.samsung.android.sm.ui.battery.BatteryActivity"),
            Intent(Settings.ACTION_APPLICATION_DETAILS_SETTINGS).setData(android.net.Uri.parse("package:$packageName")),
        )
        for (i in tries) {
            try {
                startActivity(i.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK))
                return
            } catch (e: Exception) {
                // the next one
            }
        }
    }

    private fun refreshAppUpdate() {
        val mine = AppUpdater.installedVersion(this)
        val (sub, chipText) = when (val s = AppUpdater.state) {
            AppUpdater.State.Idle -> "Tap to check for an update" to "Check"
            AppUpdater.State.Checking -> "Checking…" to "…"
            AppUpdater.State.UpToDate -> "Checked just now" to "Up to date"
            is AppUpdater.State.Available -> "v${s.offer.version} is out" to "Install"
            is AppUpdater.State.Downloading -> "Downloading the update…" to "${s.percent}%"
            AppUpdater.State.Installing -> "Confirm on the next screen" to "Installing"
            is AppUpdater.State.Failed -> s.why to "Retry"
        }
        val title = "Wisp Companion $mine"
        if (appUpdateTitle.text != title) appUpdateTitle.text = title
        if (appUpdateSub.text != sub) appUpdateSub.text = sub
        if (appUpdateChip.text != chipText) appUpdateChip.text = chipText
        val good = AppUpdater.state == AppUpdater.State.UpToDate
        appUpdateChip.setTextColor(if (good) GREEN else WHITE)
        appUpdateChip.background = round(if (good) Color.argb(0x1F, 0x1E, 0xD7, 0x60) else Color.rgb(0x26, 0x26, 0x2A), dp(99))
    }

    private fun detailText(notif: Boolean, loc: Boolean, bg: Boolean): String = buildString {
        val fix = NavStore.fix
        val lan = if (Prefs.allowLan(this@MainActivity)) ClientFilter.lanAddress() else null
        appendLine("notification access  ${if (notif) "yes" else "NO"}")
        appendLine("location             ${if (bg) "all the time" else if (loc) "while in use only" else "NO"}")
        appendLine("server               ${if (NavServer.running) "listening on :${NavServer.PORT}" else "starts with notification access"}")
        if (lan != null) appendLine("simulator address    ws://$lan:${NavServer.PORT}/nav")
        appendLine("car things connected ${NavServer.connectedCars}")
        appendLine("last connected from  ${NavServer.lastConnected ?: "never"}")
        appendLine("last turned away     ${NavServer.lastRefused ?: "never"}")
        val backupAt = Prefs.settingsBackupAt(this@MainActivity)
        appendLine(
            "settings backup      " + if (backupAt == 0L) "none yet" else
                java.text.DateFormat.getDateTimeInstance().format(java.util.Date(backupAt)),
        )
        appendLine("phone networks:")
        ClientFilter.phoneNets().forEach { n ->
            val addr = n.address.joinToString(".") { (it.toInt() and 0xff).toString() }
            appendLine("  ${n.iface.padEnd(14)} $addr/${n.prefix}${if (ClientFilter.isTether(n.iface)) "  tether" else ""}")
        }
        appendLine("phone media          ${MediaWatcher.summary ?: "none"}")
        appendLine("last spotify wake    ${SpotifyWaker.lastWake}")
        fix?.let { appendLine("fix ${"%.5f".format(it.lat)}, ${"%.5f".format(it.lng)}  ${"%.0f".format(it.bearing)}°") }
        if (NavStore.lastMapsNotification.isNotEmpty()) {
            appendLine()
            appendLine("last Google Maps notification:")
            append(NavStore.lastMapsNotification)
        }
    }

}
