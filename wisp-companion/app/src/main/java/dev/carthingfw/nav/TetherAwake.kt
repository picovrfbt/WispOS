package dev.carthingfw.nav

import android.content.Context
import android.os.Handler
import android.os.Looper
import android.os.PowerManager
import android.util.Log

/**
 * Keeps the phone's processor awake while a Car Thing is linked. With the
 * screen off and the phone in a pocket, many phones (Samsung's most) let it
 * sleep, and the Bluetooth tether then stops passing traffic: the Car Thing
 * says it's connected with no internet, and the link to this app drops.
 *
 * Held from the moment a Car Thing connects until [GRACE_MS] after the last
 * one leaves, so a dropped link can come back without the phone dozing off
 * in between. The screen stays off; this costs about what music playback does.
 */
object TetherAwake {
    private const val TAG = "WispAwake"

    /** a link that dropped has this long to come back before the phone may sleep */
    private const val GRACE_MS = 10 * 60 * 1000L

    /** never held longer than a long drive without a fresh connection renewing it */
    private const val MAX_HOLD_MS = 6 * 60 * 60 * 1000L

    private val main = Handler(Looper.getMainLooper())
    private var lock: PowerManager.WakeLock? = null
    private val releaseLater = Runnable { release() }

    /** a Car Thing connected */
    @Synchronized
    fun hold(ctx: Context) {
        main.removeCallbacks(releaseLater)
        val l = lock ?: ctx.getSystemService(PowerManager::class.java)
            ?.newWakeLock(PowerManager.PARTIAL_WAKE_LOCK, "Wisp:tether")
            ?.apply { setReferenceCounted(false) }
            ?: return
        lock = l
        // renewed with each connection, so a day in the car never runs out
        l.acquire(MAX_HOLD_MS)
        Log.i(TAG, "keeping the phone awake for the Car Thing")
    }

    /** the last Car Thing left: let the phone sleep if it doesn't come back soon */
    @Synchronized
    fun letGoSoon() {
        main.removeCallbacks(releaseLater)
        main.postDelayed(releaseLater, GRACE_MS)
    }

    @Synchronized
    private fun release() {
        lock?.let { if (it.isHeld) it.release() }
        Log.i(TAG, "the Car Thing is gone; the phone may sleep")
    }
}
