package dev.carthingfw.nav

import android.app.Activity
import android.app.Dialog
import android.content.res.ColorStateList
import android.graphics.Color
import android.graphics.Typeface
import android.graphics.drawable.ColorDrawable
import android.graphics.drawable.Drawable
import android.graphics.drawable.GradientDrawable
import android.text.InputType
import android.text.TextUtils
import android.view.Gravity
import android.view.View
import android.view.ViewGroup
import android.widget.EditText
import android.widget.FrameLayout
import android.widget.ImageView
import android.widget.LinearLayout
import android.widget.ScrollView
import android.widget.Switch
import android.widget.TextView

/**
 * The Wisp look, shared by the app's screens: the palette and fonts, the
 * blurred blobs behind a scrolling column, grouped lists, switches and the
 * sheets that slide up from the bottom.
 */
abstract class WispActivity : Activity() {
    protected val medium by lazy { resources.getFont(R.font.inter_medium) }
    protected val semibold by lazy { resources.getFont(R.font.inter_semibold) }
    protected val bold by lazy { resources.getFont(R.font.inter_bold) }

    protected fun dp(v: Number) = (v.toFloat() * resources.displayMetrics.density).toInt()

    /** the screen: blobs behind [col] scrolling, kept clear of the status and navigation bars */
    protected fun page(col: LinearLayout) {
        val blobs = BlobBackground(this)
        col.setOnApplyWindowInsetsListener { v, insets ->
            val (top, bottom) = barInsets(insets)
            v.setPadding(dp(16), dp(30) + top, dp(16), dp(32) + bottom)
            insets
        }
        // a dark fade under the status bar, so the list doesn't scroll messily under the clock
        val scrim = View(this).apply {
            background = GradientDrawable(
                GradientDrawable.Orientation.TOP_BOTTOM,
                intArrayOf(Color.argb(0xF2, 0x0B, 0x0B, 0x0C), Color.argb(0xB3, 0x0B, 0x0B, 0x0C), Color.argb(0, 0x0B, 0x0B, 0x0C)),
            )
        }
        scrim.setOnApplyWindowInsetsListener { v, insets ->
            v.layoutParams = v.layoutParams.apply { height = barInsets(insets).first + dp(18) }
            insets
        }
        setContentView(FrameLayout(this).apply {
            addView(blobs, FrameLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.MATCH_PARENT))
            addView(ScrollView(this@WispActivity).apply {
                isFillViewport = true
                isVerticalScrollBarEnabled = false
                addView(col)
            })
            addView(scrim, FrameLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, 0, Gravity.TOP))
        })
    }

    /** a panel that slides up from the bottom */
    protected fun sheet(title: String, sub: String, icon: Int, build: (LinearLayout, Dialog) -> Unit) {
        // a full-screen window, not a floating one: Android keeps floating dialogs off the
        // navigation bar, which left a black strip under the sheet
        val d = Dialog(this, android.R.style.Theme_Translucent_NoTitleBar)
        val body = LinearLayout(this).apply {
            orientation = LinearLayout.VERTICAL
            background = GradientDrawable().apply {
                setColor(Color.rgb(0x16, 0x16, 0x18))
                cornerRadii = floatArrayOf(dp(26).toFloat(), dp(26).toFloat(), dp(26).toFloat(), dp(26).toFloat(), 0f, 0f, 0f, 0f)
            }
            setPadding(dp(20), dp(10), dp(20), dp(28))
        }
        body.addView(View(this).apply { background = round(Color.argb(0x2E, 0xFF, 0xFF, 0xFF), dp(3)) },
            LinearLayout.LayoutParams(dp(40), dp(5)).apply { gravity = Gravity.CENTER_HORIZONTAL; bottomMargin = dp(14) })
        val head = LinearLayout(this).apply { gravity = Gravity.CENTER_VERTICAL }
        head.addView(iconTile(icon, GREEN, Color.rgb(0x22, 0x22, 0x25), 40))
        val words = LinearLayout(this).apply {
            orientation = LinearLayout.VERTICAL
            setPadding(dp(12), 0, 0, 0)
        }
        words.addView(text(title, 19f, bold, WHITE))
        words.addView(text(sub, 13f, medium, SECONDARY))
        head.addView(words)
        body.addView(head)
        build(body, d)
        body.setOnApplyWindowInsetsListener { v, insets ->
            v.setPadding(dp(20), dp(10), dp(20), dp(28) + barInsets(insets).second)
            insets
        }
        // the dialog covers the whole screen, sheet at the bottom, so the sheet runs down
        // behind the navigation bar (its padding keeps the buttons clear of it); a dialog
        // sized to its content is placed above the bar, leaving a black strip
        val screen = FrameLayout(this).apply {
            // the dimmed page behind; a tap there closes the sheet
            setBackgroundColor(Color.argb(0x99, 0, 0, 0))
            setOnClickListener { d.dismiss() }
            addView(body.apply { isClickable = true },
                FrameLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.WRAP_CONTENT, Gravity.BOTTOM))
        }
        d.setContentView(screen)
        d.window?.apply {
            setBackgroundDrawable(ColorDrawable(Color.TRANSPARENT))
            setLayout(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.MATCH_PARENT)
            if (android.os.Build.VERSION.SDK_INT >= 30) setDecorFitsSystemWindows(false)
            isNavigationBarContrastEnforced = false
            // see-through bars, the dimmed page and the sheet running under both
            clearFlags(
                android.view.WindowManager.LayoutParams.FLAG_TRANSLUCENT_STATUS or
                    android.view.WindowManager.LayoutParams.FLAG_TRANSLUCENT_NAVIGATION,
            )
            addFlags(android.view.WindowManager.LayoutParams.FLAG_DRAWS_SYSTEM_BAR_BACKGROUNDS)
            @Suppress("DEPRECATION")
            statusBarColor = Color.TRANSPARENT
            @Suppress("DEPRECATION")
            navigationBarColor = Color.TRANSPARENT
        }
        d.show()
    }


    protected fun text(s: CharSequence, size: Float, face: Typeface?, color: Int) = TextView(this).apply {
        text = s
        textSize = size
        if (face != null) typeface = face
        setTextColor(color)
    }

    protected fun round(color: Int, radius: Int) = GradientDrawable().apply {
        setColor(color)
        cornerRadius = radius.toFloat()
    }

    protected fun spaced(top: Int) = LinearLayout.LayoutParams(
        ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.WRAP_CONTENT,
    ).apply { topMargin = dp(top) }

    /** a see-through panel, letting the blobs glow through a little */
    protected fun panel(radius: Int) = LinearLayout(this).apply {
        background = GradientDrawable().apply {
            setColor(PANEL)
            cornerRadius = dp(radius).toFloat()
            setStroke(dp(1), Color.argb(0x0F, 0xFF, 0xFF, 0xFF))
        }
    }

    /** a grouped list: rows in one rounded panel, divided by hairlines */
    protected fun group() = panel(18).apply {
        orientation = LinearLayout.VERTICAL
        clipToOutline = true
    }

    /** a hairline across the top of a row (or none), keeping the row's own padding */
    protected fun divide(row: View, on: Boolean) {
        val l = row.paddingLeft
        val t = row.paddingTop
        val r = row.paddingRight
        val b = row.paddingBottom
        // a stroke pushed off the other three sides; a background's insets would
        // otherwise replace the row's padding
        row.background = if (on) android.graphics.drawable.InsetDrawable(
            GradientDrawable().apply { setStroke(dp(1), Color.argb(0x12, 0xFF, 0xFF, 0xFF)) },
            -dp(2), 0, -dp(2), -dp(2),
        ) else null
        row.setPadding(l, t, r, b)
    }

    protected fun barInsets(insets: android.view.WindowInsets): Pair<Int, Int> =
        if (android.os.Build.VERSION.SDK_INT >= 30) {
            val bars = insets.getInsets(android.view.WindowInsets.Type.systemBars())
            bars.top to bars.bottom
        } else {
            @Suppress("DEPRECATION")
            insets.systemWindowInsetTop to insets.systemWindowInsetBottom
        }

    /** the small caps above a group, with an optional action on the right */
    protected fun sectionHead(label: String, action: String? = null, onAction: (() -> Unit)? = null): View {
        val row = LinearLayout(this).apply {
            gravity = Gravity.CENTER_VERTICAL
            setPadding(dp(4), dp(22), dp(4), dp(8))
        }
        row.addView(text(label.uppercase(), 12f, semibold, TERTIARY).apply { letterSpacing = 0.08f },
            LinearLayout.LayoutParams(0, ViewGroup.LayoutParams.WRAP_CONTENT, 1f))
        if (action != null && onAction != null) {
            row.addView(text(action, 12f, semibold, GREEN).apply { setOnClickListener { onAction() } })
        }
        return row
    }

    protected fun chip(label: String, color: Int, bg: Int) = text(label, 12f, semibold, color).apply {
        background = round(bg, dp(99))
        setPadding(dp(10), dp(5), dp(10), dp(5))
    }

    protected fun chevron() = ImageView(this).apply { setImageDrawable(tinted(R.drawable.ic_w_chevron, TERTIARY, 16)) }

    protected fun tinted(res: Int, color: Int, sizeDp: Int): Drawable = getDrawable(res)!!.mutate().apply {
        setTint(color)
        setBounds(0, 0, dp(sizeDp), dp(sizeDp))
    }

    protected fun iconTile(res: Int, color: Int, bg: Int, size: Int = 34): View = FrameLayout(this).apply {
        background = round(bg, dp(size * 0.3f))
        addView(ImageView(context).apply { setImageDrawable(tinted(res, color, 18)) },
            FrameLayout.LayoutParams(dp(18), dp(18), Gravity.CENTER))
        layoutParams = LinearLayout.LayoutParams(dp(size), dp(size))
    }

    protected fun groupRow(lead: View?, title: String, sub: String?, trailing: View?, onClick: (() -> Unit)?): View =
        groupRowViews(lead, text(title, 15f, semibold, WHITE), sub?.let { text(it, 12f, medium, TERTIARY) }, trailing, onClick)

    protected fun groupRowViews(lead: View?, title: TextView, sub: TextView?, trailing: View?, onClick: (() -> Unit)?): View {
        val row = LinearLayout(this).apply {
            gravity = Gravity.CENTER_VERTICAL
            minimumHeight = dp(56)
            setPadding(dp(14), dp(11), dp(14), dp(11))
        }
        if (lead != null) {
            row.addView(lead, (lead.layoutParams as? LinearLayout.LayoutParams ?: LinearLayout.LayoutParams(dp(34), dp(34))).apply { marginEnd = dp(12) })
        }
        val words = LinearLayout(this).apply { orientation = LinearLayout.VERTICAL }
        title.maxLines = 1
        title.ellipsize = TextUtils.TruncateAt.END
        words.addView(title)
        if (sub != null) {
            sub.maxLines = 2
            sub.setPadding(0, dp(1), 0, 0)
            words.addView(sub)
        }
        row.addView(words, LinearLayout.LayoutParams(0, ViewGroup.LayoutParams.WRAP_CONTENT, 1f))
        if (trailing != null) {
            (trailing.parent as? ViewGroup)?.removeView(trailing)
            row.addView(trailing, LinearLayout.LayoutParams(ViewGroup.LayoutParams.WRAP_CONTENT, ViewGroup.LayoutParams.WRAP_CONTENT).apply { marginStart = dp(10) })
        }
        if (onClick != null) {
            row.isClickable = true
            row.foreground = getDrawable(android.R.drawable.list_selector_background)
            row.setOnClickListener { onClick() }
        }
        return row
    }

    protected fun switch(on: Boolean, onChange: (Boolean) -> Unit) = Switch(this).apply {
        isChecked = on
        thumbTintList = ColorStateList(
            arrayOf(intArrayOf(android.R.attr.state_checked), intArrayOf()),
            intArrayOf(Color.WHITE, Color.rgb(0xB8, 0xB8, 0xBE)),
        )
        trackTintList = ColorStateList(
            arrayOf(intArrayOf(android.R.attr.state_checked), intArrayOf()),
            intArrayOf(GREEN, Color.rgb(0x5A, 0x5A, 0x60)),
        )
        setOnCheckedChangeListener { _, v -> onChange(v) }
    }

    protected fun switchRow(title: String, sub: String?, on: Boolean, onChange: (Boolean) -> Unit): View {
        val sw = switch(on, onChange)
        val g = groupRow(null, title, sub, sw) { sw.toggle() }
        return g
    }

    protected fun field(hint: String, value: String, secret: Boolean) = EditText(this).apply {
        this.hint = hint
        setText(value)
        textSize = 15f
        typeface = medium
        setTextColor(WHITE)
        setHintTextColor(TERTIARY)
        isSingleLine = true
        inputType = if (secret) {
            InputType.TYPE_CLASS_TEXT or InputType.TYPE_TEXT_VARIATION_PASSWORD
        } else {
            InputType.TYPE_CLASS_TEXT or InputType.TYPE_TEXT_FLAG_NO_SUGGESTIONS
        }
        // after inputType: a password type swaps the font for monospace
        typeface = medium
        background = GradientDrawable().apply {
            setColor(Color.rgb(0x0F, 0x0F, 0x11))
            cornerRadius = dp(14).toFloat()
            setStroke(dp(1), Color.argb(0x14, 0xFF, 0xFF, 0xFF))
        }
        setPadding(dp(14), dp(13), dp(14), dp(13))
        layoutParams = LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.WRAP_CONTENT)
            .apply { topMargin = dp(6) }
    }

    companion object {
        // the Wisp palette (wisp-ui/src/styles/_variables.scss, and the redesign)
        @JvmStatic protected val GREEN = Color.rgb(0x1E, 0xD7, 0x60)
        @JvmStatic protected val AMBER = Color.rgb(0xF5, 0xA5, 0x24)
        @JvmStatic protected val WHITE = Color.WHITE
        @JvmStatic protected val SECONDARY = Color.argb(0x9E, 0xFF, 0xFF, 0xFF)
        @JvmStatic protected val TERTIARY = Color.argb(0x73, 0xFF, 0xFF, 0xFF)
        @JvmStatic protected val PANEL = Color.argb(0xBD, 0x18, 0x18, 0x1B)
    }
}
