package dev.carthingfw.nav

import org.json.JSONObject
import java.util.concurrent.CopyOnWriteArrayList

/**
 * The current turn and position, and the JSON the Car Thing reads. The wire
 * format matches navMessage in wisp-daemon/daemon/nav.go.
 */
object NavStore {
    data class Turn(
        val active: Boolean,
        val title: String = "",
        val text: String = "",
        val subText: String = "",
        /** data:image/png;base64 maneuver arrow, or "" */
        val icon: String = "",
    )

    data class Fix(
        val lat: Double,
        val lng: Double,
        val bearing: Float,
        val speed: Float,
        val accuracy: Float,
    )

    @Volatile
    var turn = Turn(active = false)
        private set

    @Volatile
    var fix: Fix? = null
        private set

    /** what Maps last posted, for the status screen when parsing needs a look */
    @Volatile
    var lastMapsNotification: String = ""

    private val listeners = CopyOnWriteArrayList<(String) -> Unit>()

    fun addListener(l: (String) -> Unit) = listeners.add(l)
    fun removeListener(l: (String) -> Unit) = listeners.remove(l)

    fun setTurn(t: Turn) {
        if (t == turn) return
        turn = t
        broadcast(turnJson(t))
        // the line on the map follows the turn (RouteFinder)
        RouteFinder.onTurn(t)
    }

    fun setFix(f: Fix) {
        fix = f
        broadcast(fixJson(f))
        RouteFinder.onFix(f)
    }

    /** sent to a Car Thing as it connects */
    fun snapshot(): List<String> = buildList {
        add(
            JSONObject().put("type", "hello").put("app", "car-thing-nav").put("version", 1)
                // the Car Thing runs on UTC; this is how it knows when it's evening here
                .put("tz_offset_min", java.util.TimeZone.getDefault().getOffset(System.currentTimeMillis()) / 60_000)
                .toString(),
        )
        add(turnJson(turn))
        fix?.let { add(fixJson(it)) }
        MediaWatcher.snapshot?.let(::add)
        add(RouteFinder.snapshot())
    }

    private fun broadcast(msg: String) = listeners.forEach { it(msg) }

    /** a message from elsewhere in the app (MediaWatcher) to every Car Thing */
    fun publish(msg: String) = broadcast(msg)

    fun turnJson(t: Turn): String = JSONObject()
        .put("type", "nav")
        .put("active", t.active)
        .put("title", t.title)
        .put("text", t.text)
        .put("sub_text", t.subText)
        .put("icon", t.icon)
        .toString()

    fun fixJson(f: Fix): String = JSONObject()
        .put("type", "location")
        .put("lat", f.lat)
        .put("lng", f.lng)
        .put("bearing", f.bearing.toDouble())
        .put("speed", f.speed.toDouble())
        .put("accuracy", f.accuracy.toDouble())
        .toString()
}
