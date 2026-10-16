package dev.carthingfw.nav

import android.animation.ValueAnimator
import android.content.Context
import android.graphics.Canvas
import android.graphics.Color
import android.graphics.DashPathEffect
import android.graphics.Paint
import android.graphics.Path
import android.graphics.RadialGradient
import android.graphics.RectF
import android.graphics.Shader
import android.view.View
import android.view.animation.LinearInterpolator
import kotlin.math.sin

// The companion app's own drawings, from the Wisp design: the blurred blobs
// behind everything, the wisp of light from the phone to the Car Thing, the
// small wisp under the wordmark, and the Playing tile's bouncing bars.

private fun View.dp(v: Float) = v * resources.displayMetrics.density

/** soft coloured glows behind the whole screen (radial gradients fading out, which read as blur) */
class BlobBackground(ctx: Context) : View(ctx) {
    /** the top glow: green when connected, amber while setting up */
    var topColor: Int = Color.rgb(0x1E, 0xD7, 0x60)
        set(v) {
            if (field != v) {
                field = v
                shaders = null
                invalidate()
            }
        }

    private val paint = Paint(Paint.ANTI_ALIAS_FLAG)
    private var shaders: List<Pair<Shader, RectF>>? = null

    private fun blob(cx: Float, cy: Float, r: Float, color: Int, alpha: Float): Pair<Shader, RectF> {
        val c = Color.argb((alpha * 255).toInt(), Color.red(color), Color.green(color), Color.blue(color))
        return RadialGradient(cx, cy, r, intArrayOf(c, Color.argb(0, Color.red(color), Color.green(color), Color.blue(color))), null, Shader.TileMode.CLAMP) to
            RectF(cx - r, cy - r, cx + r, cy + r)
    }

    override fun onSizeChanged(w: Int, h: Int, ow: Int, oh: Int) {
        shaders = null
    }

    override fun onDraw(c: Canvas) {
        c.drawColor(Color.rgb(0x0B, 0x0B, 0x0C))
        val w = width.toFloat()
        val h = height.toFloat()
        val s = shaders ?: listOf(
            blob(w * 0.05f, dp(40f), dp(260f), topColor, 0.30f),
            blob(w * 1.02f, dp(460f), dp(250f), Color.rgb(0x2B, 0x6C, 0xFF), 0.20f),
            blob(w * 0.45f, h + dp(20f), dp(240f), Color.rgb(0x14, 0xB8, 0xA6), 0.16f),
        ).also { shaders = it }
        for ((shader, box) in s) {
            paint.shader = shader
            c.drawOval(box, paint)
        }
    }
}

/**
 * The phone and the Car Thing, joined by a wisp of light while they're linked
 * (the line flows toward the Car Thing), or a faint
 * dotted line with an amber spark waiting at the phone while they aren't.
 */
class WispLink(ctx: Context) : View(ctx) {
    var connected = false
        set(v) {
            if (field != v) {
                field = v
                invalidate()
            }
        }

    private val green = Color.rgb(0x1E, 0xD7, 0x60)
    private val amber = Color.rgb(0xF5, 0xA5, 0x24)
    private val stroke = Paint(Paint.ANTI_ALIAS_FLAG).apply {
        style = Paint.Style.STROKE
        strokeCap = Paint.Cap.ROUND
    }
    private val fill = Paint(Paint.ANTI_ALIAS_FLAG)
    private val path = Path()
    private var t = 0f
    private val anim = ValueAnimator.ofFloat(0f, 1f).apply {
        duration = 2600
        repeatCount = ValueAnimator.INFINITE
        interpolator = LinearInterpolator()
        addUpdateListener {
            t = it.animatedValue as Float
            invalidate()
        }
    }

    override fun onAttachedToWindow() {
        super.onAttachedToWindow()
        anim.start()
    }

    override fun onDetachedFromWindow() {
        anim.cancel()
        super.onDetachedFromWindow()
    }

    override fun onMeasure(wSpec: Int, hSpec: Int) {
        setMeasuredDimension(MeasureSpec.getSize(wSpec), dp(112f).toInt())
    }

    override fun onDraw(c: Canvas) {
        val w = width.toFloat()
        val h = height.toFloat()
        val d = { v: Float -> dp(v) }
        // the panel the scene sits in
        fill.color = Color.rgb(0x0F, 0x0F, 0x11)
        c.drawRoundRect(0f, 0f, w, h, d(16f), d(16f), fill)

        val phone = RectF(d(18f), h / 2 - d(27f), d(62f), h / 2 + d(27f))
        val car = RectF(w - d(80f), h / 2 - d(23f), w - d(16f), h / 2 + d(23f))

        // the wisp: from the phone's edge to the Car Thing's, rising and falling
        val x0 = phone.right
        val x1 = car.left - d(2f)
        val y = h / 2
        val span = x1 - x0
        fun x(u: Float) = x0 + span * u
        path.reset()
        path.moveTo(x0, y)
        path.cubicTo(x(0.196f), y - d(39f), x(0.359f), y + d(41f), x(0.522f), y)
        path.cubicTo(x(0.685f), y - d(41f), x(0.826f), y - d(37f), x1, y)

        if (connected) {
            stroke.pathEffect = null
            stroke.color = withAlpha(green, 0.08f)
            stroke.strokeWidth = d(9f)
            c.drawPath(path, stroke)
            stroke.color = withAlpha(green, 0.32f)
            stroke.strokeWidth = d(2f)
            c.drawPath(path, stroke)
            // the flow: dashes moving toward the Car Thing
            stroke.color = withAlpha(Color.WHITE, 0.38f)
            stroke.strokeWidth = d(1.5f)
            stroke.pathEffect = DashPathEffect(floatArrayOf(d(6f), d(9f)), -t * d(15f) * 4)
            c.drawPath(path, stroke)
            stroke.pathEffect = null
        } else {
            stroke.color = withAlpha(Color.WHITE, 0.14f)
            stroke.strokeWidth = d(1.6f)
            stroke.pathEffect = DashPathEffect(floatArrayOf(d(2f), d(10f)), 0f)
            c.drawPath(path, stroke)
            stroke.pathEffect = null
            // the spark, waiting at the phone
            val pulse = 0.5f + 0.5f * sin(t * Math.PI.toFloat() * 4)
            fill.color = withAlpha(amber, 0.25f + 0.25f * pulse)
            c.drawCircle(x0 + d(3f), y, d(5f + 3f * pulse), fill)
            fill.color = amber
            c.drawCircle(x0 + d(3f), y, d(3.5f), fill)
        }

        // the phone
        fill.color = Color.rgb(0x1F, 0x1F, 0x22)
        c.drawRoundRect(phone, d(14f), d(14f), fill)
        stroke.color = withAlpha(Color.WHITE, 0.85f)
        stroke.strokeWidth = d(2f)
        val pw = d(15f)
        val ph = d(25f)
        val pr = RectF(phone.centerX() - pw / 2, phone.centerY() - ph / 2, phone.centerX() + pw / 2, phone.centerY() + ph / 2)
        c.drawRoundRect(pr, d(3.5f), d(3.5f), stroke)

        // the Car Thing: lit when linked, a dashed outline while waiting
        fill.color = if (connected) Color.rgb(0x1F, 0x1F, 0x22) else Color.rgb(0x1A, 0x1A, 0x1D)
        c.drawRoundRect(car, d(14f), d(14f), fill)
        if (!connected) {
            stroke.color = withAlpha(Color.WHITE, 0.18f)
            stroke.strokeWidth = d(1f)
            stroke.pathEffect = DashPathEffect(floatArrayOf(d(4f), d(3f)), 0f)
            c.drawRoundRect(car, d(14f), d(14f), stroke)
            stroke.pathEffect = null
        }
        val glyph = if (connected) green else withAlpha(Color.WHITE, 0.35f)
        stroke.color = glyph
        stroke.strokeWidth = d(2f)
        val cw = d(34f)
        val ch = d(20f)
        val cr = RectF(car.centerX() - cw / 2, car.centerY() - ch / 2, car.centerX() + cw / 2, car.centerY() + ch / 2)
        c.drawRoundRect(cr, d(4f), d(4f), stroke)
        c.drawCircle(cr.right - d(9f), cr.centerY(), d(4.5f), stroke)
        if (connected) {
            fill.color = glyph
            c.drawRoundRect(cr.left + d(5f), cr.centerY() - d(4.5f), cr.left + d(15f), cr.centerY() - d(2.5f), d(1f), d(1f), fill)
        }
    }

    private fun withAlpha(c: Int, a: Float) = Color.argb((a * 255).toInt(), Color.red(c), Color.green(c), Color.blue(c))
}

/** the small wisp under the wordmark, ending in its spark */
class WispUnderline(ctx: Context, tint: Int) : View(ctx) {
    // named tint, not color: inside Paint().apply a "color" would be the paint's own
    private val stroke = Paint(Paint.ANTI_ALIAS_FLAG).apply {
        style = Paint.Style.STROKE
        strokeCap = Paint.Cap.ROUND
        color = tint
    }
    private val dot = Paint(Paint.ANTI_ALIAS_FLAG).apply { color = tint }
    private val path = Path()

    override fun onMeasure(wSpec: Int, hSpec: Int) {
        setMeasuredDimension(dp(40f).toInt(), dp(9f).toInt())
    }

    override fun onDraw(c: Canvas) {
        val w = width.toFloat()
        val h = height.toFloat()
        // the logo's underline (150 x 22 units), scaled to fit
        val sx = w / 150f
        val sy = h / 22f
        path.reset()
        path.moveTo(3 * sx, 15 * sy)
        path.cubicTo(30 * sx, 3 * sy, 52 * sx, 21 * sy, 76 * sx, 11 * sy)
        path.cubicTo(100 * sx, 1 * sy, 122 * sx, 2 * sy, 140 * sx, 7 * sy)
        stroke.strokeWidth = dp(2.2f)
        c.drawPath(path, stroke)
        c.drawCircle(143 * sx, 7 * sy, dp(2.4f), dot)
    }
}

/** three little bars that bounce while something's playing */
class EqBars(ctx: Context, private val color: Int) : View(ctx) {
    var playing = false
        set(v) {
            if (field != v) {
                field = v
                if (v && isAttachedToWindow) anim.start() else anim.cancel()
                invalidate()
            }
        }

    private val paint = Paint(Paint.ANTI_ALIAS_FLAG)
    private var t = 0f
    private val anim = ValueAnimator.ofFloat(0f, 1f).apply {
        duration = 900
        repeatCount = ValueAnimator.INFINITE
        interpolator = LinearInterpolator()
        addUpdateListener {
            t = it.animatedValue as Float
            invalidate()
        }
    }

    override fun onAttachedToWindow() {
        super.onAttachedToWindow()
        if (playing) anim.start()
    }

    override fun onDetachedFromWindow() {
        anim.cancel()
        super.onDetachedFromWindow()
    }

    override fun onMeasure(wSpec: Int, hSpec: Int) {
        setMeasuredDimension(dp(16f).toInt(), dp(14f).toInt())
    }

    override fun onDraw(c: Canvas) {
        paint.color = if (playing) color else Color.argb(0x66, 0xFF, 0xFF, 0xFF)
        val bw = dp(3f)
        val gap = dp(2.5f)
        val h = height.toFloat()
        for (i in 0 until 3) {
            val phase = (t + i / 3f) % 1f
            val k = if (playing) 0.35f + 0.65f * (0.5f - 0.5f * kotlin.math.cos(phase * 2 * Math.PI.toFloat())) else 0.35f + 0.15f * i
            val bh = h * k
            val x = i * (bw + gap)
            c.drawRoundRect(x, h - bh, x + bw, h, dp(1.5f), dp(1.5f), paint)
        }
    }
}
