package dev.carthingfw.nav

import android.Manifest
import android.annotation.SuppressLint
import android.content.Context
import android.content.pm.PackageManager
import android.os.Build
import android.os.Handler
import android.os.Looper
import android.telecom.TelecomManager
import android.telephony.PhoneStateListener
import android.telephony.TelephonyCallback
import android.telephony.TelephonyManager
import android.util.Log
import org.json.JSONObject

/**
 * Calls on the Car Thing, kept small (the car's own hands-free does the
 * talking): who's calling with Answer and Decline, then a timer and Hang up.
 *
 * The state comes from the phone's call state; the name from the dialer's call
 * notification (NavListenerService), which carries the contact's name the way
 * the phone shows it. Answering and ending go through Android's TelecomManager.
 * Both need the "Phone" permission, asked for in the app's setup steps.
 */
object PhoneCalls {
    private const val TAG = "WispCalls"

    private val main = Handler(Looper.getMainLooper())
    private var app: Context? = null
    private var callback: Any? = null

    private var state = "idle"
    private var name = ""
    private var since = 0L

    fun allowed(ctx: Context): Boolean =
        ctx.checkSelfPermission(Manifest.permission.READ_PHONE_STATE) == PackageManager.PERMISSION_GRANTED &&
            ctx.checkSelfPermission(Manifest.permission.ANSWER_PHONE_CALLS) == PackageManager.PERMISSION_GRANTED

    /** listens while a Car Thing is connected */
    @SuppressLint("MissingPermission") // allowed() checks it
    fun start(ctx: Context) {
        main.post {
            if (callback != null || !allowed(ctx)) return@post
            val c = ctx.applicationContext
            app = c
            val tm = c.getSystemService(TelephonyManager::class.java) ?: return@post
            try {
                if (Build.VERSION.SDK_INT >= 31) {
                    val cb = object : TelephonyCallback(), TelephonyCallback.CallStateListener {
                        override fun onCallStateChanged(s: Int) = changed(s)
                    }
                    tm.registerTelephonyCallback(c.mainExecutor, cb)
                    callback = cb
                } else {
                    @Suppress("DEPRECATION")
                    val l = object : PhoneStateListener() {
                        @Deprecated("Deprecated in Java")
                        override fun onCallStateChanged(s: Int, number: String?) = changed(s)
                    }
                    @Suppress("DEPRECATION")
                    tm.listen(l, PhoneStateListener.LISTEN_CALL_STATE)
                    callback = l
                }
            } catch (e: SecurityException) {
                Log.w(TAG, "no call state", e)
            }
        }
    }

    fun stop() {
        main.post {
            val c = app ?: return@post
            val tm = c.getSystemService(TelephonyManager::class.java)
            when (val cb = callback) {
                is TelephonyCallback -> if (Build.VERSION.SDK_INT >= 31) tm?.unregisterTelephonyCallback(cb)
                is PhoneStateListener -> @Suppress("DEPRECATION") tm?.listen(cb, PhoneStateListener.LISTEN_NONE)
            }
            callback = null
        }
    }

    private fun changed(s: Int) {
        val next = when (s) {
            TelephonyManager.CALL_STATE_RINGING -> "ringing"
            TelephonyManager.CALL_STATE_OFFHOOK -> "active"
            else -> "idle"
        }
        if (next == state) return
        // the timer runs from when it was picked up (or dialled out)
        if (next == "active") since = System.currentTimeMillis()
        if (next == "idle") name = ""
        state = next
        publish()
    }

    /** the dialer's call notification: the caller as the phone names them */
    fun callerFromNotification(title: String) {
        main.post {
            val t = title.trim()
            if (t.isEmpty() || t == name) return@post
            name = t
            if (state != "idle") publish()
        }
    }

    /** "call_control" from the Car Thing: answer, decline or hang up */
    @SuppressLint("MissingPermission") // allowed() checks it
    fun control(ctx: Context, action: String) {
        if (!allowed(ctx)) return
        val tcm = ctx.getSystemService(TelecomManager::class.java) ?: return
        try {
            when (action) {
                "answer" -> if (state == "ringing") tcm.acceptRingingCall()
                "decline", "hangup" -> @Suppress("DEPRECATION") tcm.endCall()
            }
        } catch (e: Exception) {
            Log.w(TAG, "couldn't $action", e)
        }
    }

    /** what a Car Thing that just connected should know (mid-call) */
    fun snapshot(): String? = if (state == "idle") null else json()

    private fun publish() = NavStore.publish(json())

    private fun json(): String = JSONObject()
        .put("type", "call")
        .put("state", state)
        .put("name", name)
        .put("since", if (state == "active") since else 0L)
        .toString()
}
