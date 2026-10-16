package dev.carthingfw.nav

import android.app.Activity
import android.content.Intent
import android.os.Bundle
import android.widget.Toast

/**
 * "Share → Wisp" from Google Maps (or anything that shares a place): the
 * whole route there is drawn on the Car Thing's map, while Maps gives the
 * turns. No screen of its own; it says how it went and closes.
 */
class ShareToWispActivity : Activity() {
    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        val text = when (intent?.action) {
            Intent.ACTION_SEND -> intent.getStringExtra(Intent.EXTRA_TEXT)
            Intent.ACTION_VIEW -> intent.dataString
            else -> null
        }
        if (text.isNullOrBlank()) {
            finish()
            return
        }
        val app = applicationContext
        Thread {
            val place = try {
                RouteFinder.resolveShared(text)
            } catch (e: Exception) {
                null
            }
            runOnUiThread {
                if (place == null) {
                    Toast.makeText(app, "Couldn't find that place", Toast.LENGTH_SHORT).show()
                } else {
                    RouteFinder.setDestination(place)
                    val msg = if (NavServer.connectedCars > 0) "Route on your Car Thing" else "Route will show when your Car Thing connects"
                    Toast.makeText(app, msg, Toast.LENGTH_SHORT).show()
                }
            }
        }.start()
        finish()
    }
}
