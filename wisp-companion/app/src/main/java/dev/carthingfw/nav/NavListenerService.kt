package dev.carthingfw.nav

import android.app.Notification
import android.content.ComponentName
import android.graphics.Bitmap
import android.graphics.Canvas
import android.graphics.drawable.Icon
import android.service.notification.NotificationListenerService
import android.service.notification.StatusBarNotification
import android.util.Base64
import java.io.ByteArrayOutputStream

/**
 * Turns Google Maps' ongoing navigation notification into NavStore turns.
 * Maps puts the distance, the instruction and the ETA line in the standard
 * title/text/sub-text extras and the maneuver arrow in the large icon.
 */
class NavListenerService : NotificationListenerService() {

    // replaying what's already in the shade on connect
    private var replaying = false

    override fun onListenerConnected() {
        NavServer.ensureStarted(applicationContext)
        LinkService.start(applicationContext)
        replaying = true
        try {
            activeNotifications?.forEach(::onNotificationPosted)
        } finally {
            replaying = false
        }
        // the same access lets us read other apps' media sessions
        MediaWatcher.start(applicationContext, ComponentName(this, NavListenerService::class.java))
    }

    override fun onListenerDisconnected() {
        MediaWatcher.stop()
    }

    override fun onNotificationPosted(sbn: StatusBarNotification) {
        if (isMedia(sbn.notification)) {
            // YouTube and others keep the cover out of their media session but
            // show it here, as the notification's large icon
            if (sbn.packageName != SpotifyWaker.SPOTIFY) {
                MediaWatcher.setNotificationArt(sbn.packageName, largeIconBitmap(sbn.notification))
            }
            return
        }
        // the dialer's call notification names who's calling (PhoneCalls)
        if (sbn.notification.category == Notification.CATEGORY_CALL) {
            sbn.notification.extras.getCharSequence(Notification.EXTRA_TITLE)?.let {
                PhoneCalls.callerFromNotification(it.toString())
            }
            return
        }
        if (sbn.packageName != MAPS_PACKAGE) {
            NotificationForwarder.posted(this, sbn, send = !replaying)
            return
        }
        val n = sbn.notification
        val e = n.extras
        val title = e.getCharSequence(Notification.EXTRA_TITLE)?.toString().orEmpty()
        val text = e.getCharSequence(Notification.EXTRA_TEXT)?.toString().orEmpty()
        val sub = e.getCharSequence(Notification.EXTRA_SUB_TEXT)?.toString().orEmpty()
        NavStore.lastMapsNotification =
            "category=${n.category} channel=${n.channelId} ongoing=${isOngoing(n)}\n" +
            "title=$title\ntext=$text\nsub=$sub"
        if (!isNavigation(n)) return
        NavStore.setTurn(
            NavStore.Turn(active = true, title = title, text = text, subText = sub, icon = maneuverPng(n)),
        )
    }

    override fun onNotificationRemoved(sbn: StatusBarNotification) {
        if (sbn.packageName == MAPS_PACKAGE && isNavigation(sbn.notification)) {
            NavStore.setTurn(NavStore.Turn(active = false))
        }
    }

    private fun isMedia(n: Notification) = n.extras.containsKey(Notification.EXTRA_MEDIA_SESSION)

    private fun largeIconBitmap(n: Notification): Bitmap? {
        val icon = n.getLargeIcon() ?: return null
        return try {
            val d = icon.loadDrawable(this) ?: return null
            val w = d.intrinsicWidth.takeIf { it > 0 } ?: ART_PX
            val h = d.intrinsicHeight.takeIf { it > 0 } ?: ART_PX
            val scale = minOf(1f, ART_PX.toFloat() * 2 / maxOf(w, h))
            val bmp = Bitmap.createBitmap((w * scale).toInt().coerceAtLeast(1), (h * scale).toInt().coerceAtLeast(1), Bitmap.Config.ARGB_8888)
            d.setBounds(0, 0, bmp.width, bmp.height)
            d.draw(Canvas(bmp))
            bmp
        } catch (e: Exception) {
            null
        }
    }

    private fun isOngoing(n: Notification) = n.flags and Notification.FLAG_ONGOING_EVENT != 0

    // the turn-by-turn notification is the ongoing one in the navigation category;
    // older Maps builds leave the category unset but use a navigation channel
    private fun isNavigation(n: Notification): Boolean =
        isOngoing(n) && (n.category == "navigation" || n.channelId?.contains("navigation", ignoreCase = true) == true)

    private fun maneuverPng(n: Notification): String {
        val icon: Icon = n.getLargeIcon() ?: n.smallIcon ?: return ""
        return try {
            val d = icon.loadDrawable(this) ?: return ""
            val bmp = Bitmap.createBitmap(ICON_PX, ICON_PX, Bitmap.Config.ARGB_8888)
            d.setBounds(0, 0, ICON_PX, ICON_PX)
            d.draw(Canvas(bmp))
            val out = ByteArrayOutputStream()
            bmp.compress(Bitmap.CompressFormat.PNG, 100, out)
            "data:image/png;base64," + Base64.encodeToString(out.toByteArray(), Base64.NO_WRAP)
        } catch (e: Exception) {
            ""
        }
    }

    companion object {
        const val MAPS_PACKAGE = "com.google.android.apps.maps"
        private const val ICON_PX = 128
        private const val ART_PX = 300
    }
}
