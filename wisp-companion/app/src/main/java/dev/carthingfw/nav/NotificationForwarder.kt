package dev.carthingfw.nav

import android.app.Notification
import android.content.Context
import android.service.notification.StatusBarNotification
import org.json.JSONObject

/**
 * The phone's notifications as Car Thing banners. Off until a Car Thing asks
 * for them (its "Notifications" setting), and off again when it goes, so
 * nothing is sent while the setting is off.
 */
object NotificationForwarder {
    @Volatile
    var wanted = false
        private set

    // the same notification is re-posted on every update; only new text is news
    private val lastSent = object : LinkedHashMap<String, String>(32, 0.75f, true) {
        override fun removeEldestEntry(eldest: MutableMap.MutableEntry<String, String>?) = size > 64
    }

    /** [send] false only notes it as seen: what was already there when the listener (re)connects isn't news */
    fun posted(ctx: Context, sbn: StatusBarNotification, send: Boolean = true) {
        if (!wanted) return
        val n = sbn.notification
        if (sbn.packageName == ctx.packageName || sbn.isOngoing) return
        if (n.flags and Notification.FLAG_GROUP_SUMMARY != 0) return
        // the same rule as the lock screen: secret ones never leave the phone
        if (n.visibility == Notification.VISIBILITY_SECRET) return
        val e = (if (n.visibility == Notification.VISIBILITY_PRIVATE) n.publicVersion else n)?.extras
        val title = e?.getCharSequence(Notification.EXTRA_TITLE)?.toString()?.trim().orEmpty()
        val text = (e?.getCharSequence(Notification.EXTRA_BIG_TEXT) ?: e?.getCharSequence(Notification.EXTRA_TEXT))
            ?.toString()?.trim().orEmpty()
        val app = appLabel(ctx, sbn.packageName)
        val shownTitle = title.ifEmpty { if (text.isEmpty()) "New notification" else app }
        val digest = "$shownTitle\u0000$text"
        synchronized(lastSent) {
            if (lastSent[sbn.key] == digest) return
            lastSent[sbn.key] = digest
        }
        if (!send) return
        NavStore.publish(
            JSONObject().put("type", "notification")
                .put("app", app)
                .put("title", shownTitle.take(200))
                .put("text", text.take(200))
                .toString(),
        )
    }

    fun setEnabled(on: Boolean) {
        wanted = on
        if (!on) synchronized(lastSent) { lastSent.clear() }
    }

    private fun appLabel(ctx: Context, pkg: String): String = try {
        val pm = ctx.packageManager
        pm.getApplicationLabel(pm.getApplicationInfo(pkg, 0)).toString()
    } catch (e: Exception) {
        pkg.substringAfterLast('.')
    }
}
