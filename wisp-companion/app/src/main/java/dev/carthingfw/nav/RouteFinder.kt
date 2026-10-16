package dev.carthingfw.nav

import android.util.Log
import org.json.JSONArray
import org.json.JSONObject
import java.net.HttpURLConnection
import java.net.URL
import java.net.URLEncoder
import java.util.concurrent.Executors
import kotlin.math.abs

/**
 * The route line for the Car Thing's map. Google Maps keeps its route to
 * itself, so this works one out from OpenStreetMap:
 *
 * - With a destination shared to Wisp (ShareToWispActivity): the whole trip,
 *   from OSRM's router, worked out again if the car leaves it.
 * - Otherwise, while Maps navigates: the road to the next turn. The street in
 *   the instruction ("Turn right onto Harbor Blvd") is found near the car on
 *   OpenStreetMap, the corner is the point on it whose driving distance
 *   matches Maps' ("500 ft"), and a little of that street shows the turn.
 *
 * Each line goes to the Car Thing as a "route" message (nav_route.go).
 */
object RouteFinder {
    private const val TAG = "WispRoute"
    private const val UA = "WispCompanion/1 (Car Thing navigation; github.com/picovrfbt/WispOS)"
    private const val OSRM = "https://router.project-osrm.org"
    private const val OVERPASS = "https://overpass-api.de/api/interpreter"
    private const val NOMINATIM = "https://nominatim.openstreetmap.org/search"

    /** off the trip's line by more than this, a few fixes running, it's worked out again */
    private const val OFF_ROUTE_M = 70.0
    private const val OFF_FIXES = 3
    private const val REROUTE_GAP_MS = 20_000L
    /** no road-to-the-turn past this: a highway's "12 mi" is no corner to look for */
    private const val NEXT_MAX_M = 15_000.0

    private val work = Executors.newSingleThreadExecutor()

    // state, read and written on [work]
    private var dest: Pt? = null
    private var active = false
    private var turnKey = ""
    private var turn: NavStore.Turn? = null
    @Volatile
    private var fix: NavStore.Fix? = null
    private var line: List<Pt> = emptyList()
    private var lineKind = ""
    private var offCount = 0
    private var lastRouteAt = 0L

    @Volatile
    private var lastJson: String = noneJson()

    /** the line as it stands, for a Car Thing that just connected */
    fun snapshot(): String = lastJson

    /** a place shared to Wisp: the trip there, from wherever the car is */
    fun setDestination(p: Pt) = work.execute {
        dest = p
        offCount = 0
        val f = fix
        if (f != null) full(pt(f.lat, f.lng), p)
        // else the first fix works it out
    }

    fun onTurn(t: NavStore.Turn) = work.execute {
        val was = active
        active = t.active
        turn = t
        if (!t.active) {
            // Maps finished or was stopped: the shared trip is over too
            if (was) dest = null
            turnKey = ""
            if (dest == null) send("", emptyList())
            return@execute
        }
        if (dest != null) return@execute
        val key = t.text
        if (key != turnKey) {
            turnKey = key
            // the last turn's line is the wrong one now
            if (lineKind == "next") send("", emptyList())
            val f = fix ?: return@execute
            next(t, f)
        }
    }

    fun onFix(f: NavStore.Fix) = work.execute {
        val first = fix == null
        fix = f
        val here = pt(f.lat, f.lng)
        val d = dest
        if (d != null) {
            if (line.isEmpty() || lineKind != "full") {
                if (first || System.currentTimeMillis() - lastRouteAt > REROUTE_GAP_MS) full(here, d)
                return@execute
            }
            offCount = if (RouteMath.distanceToLineM(here, line) > OFF_ROUTE_M) offCount + 1 else 0
            if (offCount >= OFF_FIXES && System.currentTimeMillis() - lastRouteAt > REROUTE_GAP_MS) full(here, d)
            return@execute
        }
        val t = turn ?: return@execute
        if (!t.active) return@execute
        // the corner was guessed wrong, or the car took another way: look again
        val off = line.isNotEmpty() && RouteMath.distanceToLineM(here, line) > OFF_ROUTE_M
        offCount = if (off) offCount + 1 else 0
        val missing = line.isEmpty() && turnKey.isNotEmpty() && System.currentTimeMillis() - lastRouteAt > REROUTE_GAP_MS
        if ((offCount >= OFF_FIXES || missing || first) && System.currentTimeMillis() - lastRouteAt > REROUTE_GAP_MS / 2) {
            offCount = 0
            next(t, f)
        }
    }

    // ---------------------------------------------------------------- the trip

    private fun full(from: Pt, to: Pt) {
        lastRouteAt = System.currentTimeMillis()
        val pts = try {
            osrmRoute(from, to)
        } catch (e: Exception) {
            Log.w(TAG, "trip route failed", e)
            return
        }
        offCount = 0
        send("full", fit(pts, 4.0))
    }

    // ---------------------------------------------------------------- the road to the next turn

    private fun next(t: NavStore.Turn, f: NavStore.Fix) {
        lastRouteAt = System.currentTimeMillis()
        val pts = try {
            toTurn(t, f)
        } catch (e: Exception) {
            Log.w(TAG, "next-turn route failed", e)
            null
        }
        if (pts == null) {
            if (lineKind == "next") send("", emptyList())
            return
        }
        send("next", fit(pts, 3.0))
    }

    private fun toTurn(t: NavStore.Turn, f: NavStore.Fix): List<Pt>? {
        val distance = RouteMath.distanceMeters(t.title) ?: return null
        if (distance > NEXT_MAX_M) return null
        val street = RouteMath.streetOf(t.text) ?: return null
        val key = RouteMath.streetKey(street) ?: return null
        val car = pt(f.lat, f.lng)
        val radius = (distance * 1.3 + 150).toInt()

        // the street's stretches near the car
        val shapes = streetShapes(street, key, car, radius)
        if (shapes.isEmpty()) return null

        // the corner: a point on that street about as far as Maps says, ahead of the car
        data class Cand(val way: Int, val idx: Int, val straight: Double)
        val moving = f.speed > 2
        val cands = shapes.flatMapIndexed { wi, s ->
            s.mapIndexedNotNull { pi, p ->
                val d = RouteMath.distanceM(car, p)
                val ahead = !moving || abs(RouteMath.turnAngle(f.bearing.toDouble(), RouteMath.bearing(car, p))) < 110
                if (ahead && d <= distance * 1.2 + 60 && d >= distance * 0.4 - 60) Cand(wi, pi, d) else null
            }
        }.sortedBy { abs(it.straight - distance) }.take(20)
        if (cands.isEmpty()) return null

        val coords = (listOf(car) + cands.map { shapes[it.way][it.idx] }).joinToString(";") { "${it[1]},${it[0]}" }
        val table = getJson("$OSRM/table/v1/driving/$coords?sources=0&annotations=distance")
        val row = table.optJSONArray("distances")?.optJSONArray(0) ?: return null
        var best = -1
        var bestErr = Double.MAX_VALUE
        for (i in cands.indices) {
            val d = row.optDouble(i + 1, Double.NaN)
            if (d.isNaN()) continue
            val err = abs(d - distance)
            if (err < bestErr) {
                bestErr = err
                best = i
            }
        }
        if (best < 0 || bestErr > maxOf(80.0, distance * 0.4)) return null
        val corner = cands[best]
        val road = osrmRoute(car, shapes[corner.way][corner.idx])
        if (road.size < 2) return null
        val approach = RouteMath.bearing(road[road.size - 2], road.last())
        val stub = RouteMath.stub(shapes[corner.way], corner.idx, approach, RouteMath.sideOf(t.text))
        return road + stub.drop(1)
    }

    /**
     * The street's shape near [car], as lines of points: from Nominatim's
     * search (it reads "Blvd" as "Boulevard" itself), or Overpass when that
     * finds nothing. Overpass's public servers are often at capacity.
     */
    private fun streetShapes(street: String, key: String, car: Pt, radius: Int): List<List<Pt>> {
        val dLat = radius / 110_540.0
        val dLng = radius / (111_320.0 * kotlin.math.cos(Math.toRadians(car[0])))
        val box = "${car[1] - dLng},${car[0] + dLat},${car[1] + dLng},${car[0] - dLat}"
        val shapes = mutableListOf<List<Pt>>()
        try {
            val hits = getJsonArray(
                "$NOMINATIM?format=jsonv2&limit=20&layer=address&polygon_geojson=1&bounded=1" +
                    "&viewbox=$box&q=${enc(street)}",
            )
            for (i in 0 until hits.length()) {
                val h = hits.getJSONObject(i)
                if (h.optString("category") != "highway") continue
                val g = h.optJSONObject("geojson") ?: continue
                val c = g.optJSONArray("coordinates") ?: continue
                when (g.optString("type")) {
                    "LineString" -> shapes += lineOf(c)
                    "MultiLineString" -> for (j in 0 until c.length()) shapes += lineOf(c.getJSONArray(j))
                }
            }
        } catch (e: Exception) {
            Log.w(TAG, "street search failed", e)
        }
        if (shapes.isNotEmpty()) return shapes
        val q = "[out:json][timeout:15];(" +
            "way(around:$radius,${car[0]},${car[1]})[\"highway\"][\"name\"~\"${regex(key)}\",i];" +
            "way(around:$radius,${car[0]},${car[1]})[\"highway\"][\"ref\"~\"${regex(key)}\",i];" +
            ");out tags geom;"
        val ways = getJson("$OVERPASS?data=${enc(q)}").optJSONArray("elements") ?: return shapes
        for (i in 0 until ways.length()) {
            val w = ways.getJSONObject(i)
            val tags = w.optJSONObject("tags") ?: continue
            if (!RouteMath.sameStreet(tags.optString("name"), street) && !refMatches(tags.optString("ref"), street)) continue
            val g = w.optJSONArray("geometry") ?: continue
            shapes += (0 until g.length()).map { g.getJSONObject(it).let { p -> pt(p.getDouble("lat"), p.getDouble("lon")) } }
        }
        return shapes
    }

    // GeoJSON's [lng, lat] pairs
    private fun lineOf(c: JSONArray): List<Pt> = (0 until c.length()).map { c.getJSONArray(it).let { p -> pt(p.getDouble(1), p.getDouble(0)) } }

    // "I-405", "CA 1", "US-101": a road's number, as OpenStreetMap's ref has it
    private fun refMatches(ref: String, street: String): Boolean {
        if (ref.isEmpty()) return false
        fun norm(s: String) = s.uppercase().replace(Regex("""[\s-]"""), "")
        val want = norm(street.split(' ').firstOrNull { it.any(Char::isDigit) } ?: return false)
        return ref.split(';').any { norm(it) == want }
    }

    // ---------------------------------------------------------------- shared places

    /** the place in what Google Maps (or anything) shared; null if none could be found */
    fun resolveShared(text: String): Pt? {
        val (link, words) = RouteMath.splitShared(text)
        if (link != null) {
            RouteMath.coordsInMapsUrl(link)?.let { return it }
            followForCoords(link)?.let { return it }
        }
        if (words.isBlank()) return null
        val near = fix?.let { "&viewbox=${it.lng - 0.6},${it.lat + 0.6},${it.lng + 0.6},${it.lat - 0.6}" } ?: ""
        val hits = getJsonArray("$NOMINATIM?format=jsonv2&limit=1&q=${enc(words)}$near")
        if (hits.length() == 0) return null
        val h = hits.getJSONObject(0)
        return pt(h.getString("lat").toDouble(), h.getString("lon").toDouble())
    }

    // maps.app.goo.gl links redirect to a google.com/maps URL with the place in it
    private fun followForCoords(start: String): Pt? {
        var url = start
        repeat(6) {
            val c = URL(url).openConnection() as HttpURLConnection
            c.instanceFollowRedirects = false
            c.connectTimeout = 8000
            c.readTimeout = 8000
            c.setRequestProperty("User-Agent", UA)
            val loc = try {
                c.responseCode
                c.getHeaderField("Location")
            } finally {
                c.disconnect()
            }
            if (loc.isNullOrEmpty()) return null
            val next = URL(URL(url), loc).toString()
            RouteMath.coordsInMapsUrl(next)?.let { return it }
            // a consent page carries the real address along
            Regex("""[?&]continue=([^&]+)""").find(next)?.let { m ->
                val inner = java.net.URLDecoder.decode(m.groupValues[1], "UTF-8")
                RouteMath.coordsInMapsUrl(inner)?.let { return it }
            }
            url = next
        }
        return null
    }

    // ---------------------------------------------------------------- the wire

    private fun send(kind: String, pts: List<Pt>) {
        line = pts
        lineKind = kind
        val json = if (kind.isEmpty() || pts.size < 2) noneJson() else JSONObject()
            .put("type", "route").put("kind", kind)
            .put("points", JSONArray().apply {
                pts.forEach { put(JSONArray().put(round5(it[0])).put(round5(it[1]))) }
            })
            .toString()
        if (json == lastJson) return
        lastJson = json
        NavStore.publish(json)
    }

    private fun noneJson() = JSONObject().put("type", "route").put("kind", "none").toString()

    private fun round5(v: Double) = Math.round(v * 100_000) / 100_000.0

    // simplified until it's a size the Car Thing draws without effort
    private fun fit(pts: List<Pt>, tolM: Double): List<Pt> {
        var tol = tolM
        var out = RouteMath.simplify(pts, tol)
        while (out.size > 2500) {
            tol *= 2
            out = RouteMath.simplify(pts, tol)
        }
        return out
    }

    private fun osrmRoute(from: Pt, to: Pt): List<Pt> {
        val r = getJson("$OSRM/route/v1/driving/${from[1]},${from[0]};${to[1]},${to[0]}?overview=full&geometries=geojson")
        val coords = r.optJSONArray("routes")?.optJSONObject(0)?.optJSONObject("geometry")?.optJSONArray("coordinates")
            ?: throw IllegalStateException("no route: ${r.optString("code")}")
        return (0 until coords.length()).map { coords.getJSONArray(it).let { c -> pt(c.getDouble(1), c.getDouble(0)) } }
    }

    private fun regex(word: String) = word.replace(Regex("""[^\p{L}\p{N}]"""), ".")

    private fun enc(s: String) = URLEncoder.encode(s, "UTF-8")

    private fun get(url: String): String {
        val c = URL(url).openConnection() as HttpURLConnection
        c.connectTimeout = 10_000
        c.readTimeout = 15_000
        c.setRequestProperty("User-Agent", UA)
        try {
            if (c.responseCode !in 200..299) throw IllegalStateException("HTTP ${c.responseCode} from ${URL(url).host}")
            return c.inputStream.bufferedReader().readText()
        } finally {
            c.disconnect()
        }
    }

    private fun getJson(url: String) = JSONObject(get(url))
    private fun getJsonArray(url: String) = JSONArray(get(url))
}
