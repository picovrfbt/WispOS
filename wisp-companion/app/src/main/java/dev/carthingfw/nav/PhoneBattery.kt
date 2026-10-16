package dev.carthingfw.nav

import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import android.content.IntentFilter
import android.os.BatteryManager
import android.os.Handler
import android.os.Looper
import org.json.JSONObject

/**
 * The phone's battery for the Car Thing: its level and whether it's charging,
 * sent as they change while a Car Thing is connected. The Car Thing shows a
 * small battery when the phone isn't charging and warns when it runs low.
 * Needs no permission.
 */
object PhoneBattery {
    private val main = Handler(Looper.getMainLooper())
    private var app: Context? = null
    private var receiver: BroadcastReceiver? = null
    private var last: Pair<Int, Boolean>? = null

    fun start(ctx: Context) {
        main.post {
            if (receiver != null) return@post
            val c = ctx.applicationContext
            app = c
            val r = object : BroadcastReceiver() {
                override fun onReceive(c: Context, i: Intent) = changed(i)
            }
            receiver = r
            // the battery's state is a sticky broadcast: this hands back the current one too
            c.registerReceiver(r, IntentFilter(Intent.ACTION_BATTERY_CHANGED))?.let(::changed)
        }
    }

    fun stop() {
        main.post {
            receiver?.let { r -> app?.let { runCatching { it.unregisterReceiver(r) } } }
            receiver = null
            last = null
        }
    }

    private fun changed(i: Intent) {
        val level = i.getIntExtra(BatteryManager.EXTRA_LEVEL, -1)
        val scale = i.getIntExtra(BatteryManager.EXTRA_SCALE, 100)
        if (level < 0 || scale <= 0) return
        val pct = level * 100 / scale
        val status = i.getIntExtra(BatteryManager.EXTRA_STATUS, -1)
        val charging = status == BatteryManager.BATTERY_STATUS_CHARGING || status == BatteryManager.BATTERY_STATUS_FULL
        val now = pct to charging
        if (now == last) return
        last = now
        NavStore.publish(json(pct, charging))
    }

    /** for a Car Thing that just connected */
    fun snapshot(): String? = last?.let { (pct, charging) -> json(pct, charging) }

    private fun json(pct: Int, charging: Boolean) = JSONObject()
        .put("type", "phone_battery")
        .put("level", pct)
        .put("charging", charging)
        .toString()
}
