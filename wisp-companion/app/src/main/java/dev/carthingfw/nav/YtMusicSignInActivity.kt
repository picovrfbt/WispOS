package dev.carthingfw.nav

import android.content.ClipData
import android.content.ClipboardManager
import android.content.Intent
import android.net.Uri
import android.os.Bundle
import android.os.Handler
import android.os.Looper
import android.view.Gravity
import android.view.View
import android.widget.ImageView
import android.widget.LinearLayout
import android.widget.TextView
import android.widget.Toast

/**
 * Signs in to YouTube Music with a code: you enter it at google.com/device in
 * your own browser and allow Wisp (YtSignIn). Google refuses its sign-in page
 * inside apps ("this browser or app may not be secure"), so this never shows it.
 */
class YtMusicSignInActivity : WispActivity() {
    private val handler = Handler(Looper.getMainLooper())
    private lateinit var codeView: TextView
    private lateinit var status: TextView
    private lateinit var actions: LinearLayout
    private var code: YtSignIn.Code? = null
    @Volatile private var stopped = false

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        val col = LinearLayout(this).apply { orientation = LinearLayout.VERTICAL }
        col.addView(header())
        col.addView(text(
            "Google doesn't allow signing in inside apps, so you'll allow Wisp from your browser instead.",
            15f, medium, SECONDARY,
        ).apply { setPadding(dp(4), dp(14), dp(4), dp(20)) })

        val card = panel(18).apply {
            orientation = LinearLayout.VERTICAL
            gravity = Gravity.CENTER_HORIZONTAL
            setPadding(dp(20), dp(22), dp(20), dp(22))
        }
        card.addView(text("Your code", 13f, semibold, TERTIARY))
        codeView = text("…", 34f, bold, WHITE).apply {
            letterSpacing = 0.12f
            setPadding(0, dp(6), 0, dp(4))
            setTextIsSelectable(true)
        }
        card.addView(codeView)
        status = text("Getting a code from Google…", 13f, medium, SECONDARY).apply {
            gravity = Gravity.CENTER
            setPadding(0, dp(6), 0, 0)
        }
        card.addView(status)
        col.addView(card)

        actions = group().apply { visibility = View.GONE }
        actions.addView(groupRow(
            iconTile(R.drawable.ic_w_open, WHITE, android.graphics.Color.rgb(0xE5, 0x2D, 0x27)), "Open google.com/device",
            "Copies the code, then enter it there and allow Wisp", chevron(),
        ) { openDevicePage() })
        val copy = groupRow(null, "Copy the code", "To enter it on another phone or a computer", null) { copyCode() }
        divide(copy, true)
        actions.addView(copy)
        col.addView(actions, spaced(16))

        col.addView(text(
            "Your sign-in stays in this app on this phone. Sign out in the app removes it, and you can also remove Wisp at myaccount.google.com/permissions.",
            12f, medium, TERTIARY,
        ).apply { setPadding(dp(4), dp(18), dp(4), 0) })
        page(col)

        if (!YtSignIn.configured) {
            codeView.text = "—"
            status.text = "This copy of Wisp has no Google sign-in set up. See the Wisp Companion README."
            return
        }
        begin()
    }

    override fun onDestroy() {
        stopped = true
        handler.removeCallbacksAndMessages(null)
        super.onDestroy()
    }

    private fun header(): View {
        val row = LinearLayout(this).apply { gravity = Gravity.CENTER_VERTICAL }
        row.addView(ImageView(this).apply {
            setImageDrawable(tinted(R.drawable.ic_w_chevron, WHITE, 22))
            rotation = 180f
            setPadding(dp(6), dp(6), dp(6), dp(6))
            contentDescription = "Back"
            setOnClickListener { finish() }
        }, LinearLayout.LayoutParams(dp(36), dp(36)))
        row.addView(text("Sign in to YouTube Music", 22f, bold, WHITE).apply { setPadding(dp(6), 0, 0, 0) })
        return row
    }

    // gets a code, then checks every few seconds until it's allowed, refused or runs out
    private fun begin() {
        Thread {
            val c = try {
                YtSignIn.start()
            } catch (e: Exception) {
                handler.post { status.text = e.message ?: "Couldn't reach Google" }
                return@Thread
            }
            code = c
            handler.post {
                codeView.text = c.userCode
                status.text = "Waiting for you to allow Wisp…"
                actions.visibility = View.VISIBLE
            }
            var wait = c.intervalSec * 1000L
            while (!stopped) {
                Thread.sleep(wait)
                if (stopped) return@Thread
                when (val r = runCatching { YtSignIn.poll(this, c) }.getOrElse { YtSignIn.Poll.Waiting }) {
                    YtSignIn.Poll.Waiting -> {}
                    YtSignIn.Poll.SlowDown -> wait += 5000
                    YtSignIn.Poll.Done -> {
                        handler.post {
                            Toast.makeText(this, "Signed in to YouTube Music", Toast.LENGTH_SHORT).show()
                            YtMusicLink.signedInChanged(applicationContext)
                            finish()
                        }
                        return@Thread
                    }
                    is YtSignIn.Poll.Failed -> {
                        handler.post {
                            status.text = r.why
                            actions.visibility = View.GONE
                        }
                        return@Thread
                    }
                }
            }
        }.start()
    }

    private fun copyCode() {
        val c = code ?: return
        getSystemService(ClipboardManager::class.java)
            .setPrimaryClip(ClipData.newPlainText("YouTube Music code", c.userCode))
        Toast.makeText(this, "Code copied", Toast.LENGTH_SHORT).show()
    }

    private fun openDevicePage() {
        val c = code ?: return
        copyCode()
        runCatching { startActivity(Intent(Intent.ACTION_VIEW, Uri.parse(c.url))) }
            .onFailure { Toast.makeText(this, "Open ${c.url} in your browser", Toast.LENGTH_LONG).show() }
    }
}
