package dev.carthingfw.nav

import kotlin.math.abs
import kotlin.math.atan2
import kotlin.math.cos
import kotlin.math.pow
import kotlin.math.sin
import kotlin.math.sqrt

/** a point as [lat, lng] */
typealias Pt = DoubleArray

fun pt(lat: Double, lng: Double): Pt = doubleArrayOf(lat, lng)

/**
 * The route line's arithmetic and the reading of Google Maps' words, with no
 * Android in it (RouteFinder does the fetching): distances and street names
 * from the turn notification, coordinates from a shared Maps link, and the
 * geometry to trim, simplify and turn a corner.
 */
object RouteMath {
    private const val EARTH_M = 6_371_000.0

    fun distanceM(a: Pt, b: Pt): Double {
        val la1 = Math.toRadians(a[0])
        val la2 = Math.toRadians(b[0])
        val dLa = la2 - la1
        val dLo = Math.toRadians(b[1] - a[1])
        val h = sin(dLa / 2).pow(2) + cos(la1) * cos(la2) * sin(dLo / 2).pow(2)
        return 2 * EARTH_M * Math.asin(sqrt(h.coerceIn(0.0, 1.0)))
    }

    /** compass bearing from [a] to [b], 0 to 360 */
    fun bearing(a: Pt, b: Pt): Double {
        val la1 = Math.toRadians(a[0])
        val la2 = Math.toRadians(b[0])
        val dLo = Math.toRadians(b[1] - a[1])
        val y = sin(dLo) * cos(la2)
        val x = cos(la1) * sin(la2) - sin(la1) * cos(la2) * cos(dLo)
        return (Math.toDegrees(atan2(y, x)) + 360) % 360
    }

    /** [to] relative to [from], -180 to 180: positive is to the right */
    fun turnAngle(from: Double, to: Double): Double {
        var d = (to - from) % 360
        if (d > 180) d -= 360
        if (d < -180) d += 360
        return d
    }

    // metres east/north of [o]: near enough flat over a few kilometres
    private fun local(p: Pt, o: Pt): DoubleArray {
        val k = cos(Math.toRadians(o[0]))
        return doubleArrayOf((p[1] - o[1]) * 111_320.0 * k, (p[0] - o[0]) * 110_540.0)
    }

    /** how far [p] is from the line through [pts], in metres */
    fun distanceToLineM(p: Pt, pts: List<Pt>): Double {
        if (pts.isEmpty()) return Double.MAX_VALUE
        if (pts.size == 1) return distanceM(p, pts[0])
        var best = Double.MAX_VALUE
        for (i in 0 until pts.size - 1) {
            val a = local(pts[i], p)
            val b = local(pts[i + 1], p)
            val dx = b[0] - a[0]
            val dy = b[1] - a[1]
            val len2 = dx * dx + dy * dy
            val t = if (len2 == 0.0) 0.0 else (-(a[0] * dx + a[1] * dy) / len2).coerceIn(0.0, 1.0)
            val x = a[0] + t * dx
            val y = a[1] + t * dy
            best = minOf(best, sqrt(x * x + y * y))
        }
        return best
    }

    /** Douglas-Peucker: drops points that stray less than [tolM] from the line */
    fun simplify(pts: List<Pt>, tolM: Double): List<Pt> {
        if (pts.size < 3) return pts
        val keep = BooleanArray(pts.size)
        keep[0] = true
        keep[pts.size - 1] = true
        val stack = ArrayDeque<IntArray>()
        stack.addLast(intArrayOf(0, pts.size - 1))
        while (stack.isNotEmpty()) {
            val (s, e) = stack.removeLast().let { it[0] to it[1] }
            var far = -1
            var farD = tolM
            for (i in s + 1 until e) {
                val d = distanceToLineM(pts[i], listOf(pts[s], pts[e]))
                if (d > farD) {
                    farD = d
                    far = i
                }
            }
            if (far >= 0) {
                keep[far] = true
                stack.addLast(intArrayOf(s, far))
                stack.addLast(intArrayOf(far, e))
            }
        }
        return pts.filterIndexed { i, _ -> keep[i] }
    }

    // ---------------------------------------------------------------- Google Maps' words

    /** "500 ft", "0.3 mi", "1.2 km", "200 m" in metres; null for anything else */
    fun distanceMeters(s: String): Double? {
        val m = Regex("""(\d+(?:[.,]\d+)?)\s*(ft|mi|km|m)\b""", RegexOption.IGNORE_CASE).find(s) ?: return null
        val v = m.groupValues[1].replace(',', '.').toDoubleOrNull() ?: return null
        return when (m.groupValues[2].lowercase()) {
            "ft" -> v * 0.3048
            "mi" -> v * 1609.344
            "km" -> v * 1000
            else -> v
        }
    }

    /** the street a turn goes onto: "Turn right onto Harbor Blvd" is "Harbor Blvd" */
    fun streetOf(instruction: String): String? {
        val m = Regex("""\b(?:onto|on|to stay on)\s+(.+)$""", RegexOption.IGNORE_CASE).find(instruction.trim())
            ?: return null
        // "Harbor Blvd/CA-1" and "Main St (signs for Downtown)": the first name
        // and "Elm St toward Downtown": the street, not where it heads
        val name = m.groupValues[1].split('/', '(').first()
            .split(Regex("""\s+toward\s+""", RegexOption.IGNORE_CASE)).first().trim().trimEnd('.', ',')
        return name.takeIf { it.length >= 2 }
    }

    /** +1 for a turn right, -1 left, 0 straight on or anything else */
    fun sideOf(instruction: String): Int {
        val t = instruction.lowercase()
        if ("u-turn" in t) return 0
        return when {
            Regex("""\bright\b""").containsMatchIn(t) -> 1
            Regex("""\bleft\b""").containsMatchIn(t) -> -1
            else -> 0
        }
    }

    private val ABBREVIATIONS = mapOf(
        "st" to "street", "ave" to "avenue", "av" to "avenue", "blvd" to "boulevard", "rd" to "road",
        "dr" to "drive", "ln" to "lane", "hwy" to "highway", "pkwy" to "parkway", "ct" to "court",
        "pl" to "place", "sq" to "square", "ter" to "terrace", "cir" to "circle", "expy" to "expressway",
        "fwy" to "freeway", "trl" to "trail", "cres" to "crescent", "mt" to "mount", "ft" to "fort",
        "n" to "north", "s" to "south", "e" to "east", "w" to "west",
        "ne" to "northeast", "nw" to "northwest", "se" to "southeast", "sw" to "southwest",
    )
    private val DIRECTIONS = setOf("north", "south", "east", "west", "northeast", "northwest", "southeast", "southwest")
    private val KINDS = setOf(
        "street", "avenue", "boulevard", "road", "drive", "lane", "highway", "parkway", "court", "place",
        "square", "terrace", "circle", "expressway", "freeway", "trail", "crescent", "way",
    )

    /** a street name's words, abbreviations spelled out: "N Harbor Blvd" is [north, harbor, boulevard] */
    fun streetWords(name: String): List<String> =
        name.lowercase().replace(Regex("""[^\p{L}\p{N}\s-]"""), " ").split(Regex("""\s+"""))
            .filter { it.isNotEmpty() }.map { ABBREVIATIONS[it] ?: it }

    /** the same street, whatever the spelling: the directions may be left off either */
    fun sameStreet(a: String, b: String): Boolean {
        val x = streetWords(a).filter { it !in DIRECTIONS }
        val y = streetWords(b).filter { it !in DIRECTIONS }
        return x.isNotEmpty() && x == y
    }

    /** the word to look the street up by: its longest that isn't a direction or a kind of road */
    fun streetKey(name: String): String? =
        streetWords(name).filter { it !in DIRECTIONS && it !in KINDS }.maxByOrNull { it.length }

    // ---------------------------------------------------------------- shared places

    /**
     * The place in a Google Maps link: its pin (!3d…!4d…), the map's middle
     * (@lat,lng) or a q=/ll=/daddr= of coordinates; null when it only names it
     */
    fun coordsInMapsUrl(url: String): Pt? {
        val u = java.net.URLDecoder.decode(url, "UTF-8")
        Regex("""!3d(-?\d+\.\d+)!4d(-?\d+\.\d+)""").find(u)?.let { return valid(it) }
        Regex("""[?&](?:q|ll|daddr|destination|query)=(-?\d+\.\d+),\s*(-?\d+\.\d+)""").find(u)?.let { return valid(it) }
        Regex("""@(-?\d+\.\d+),(-?\d+\.\d+)""").find(u)?.let { return valid(it) }
        Regex("""^geo:(-?\d+\.\d+),(-?\d+\.\d+)""").find(u)?.let { return valid(it) }
        return null
    }

    private fun valid(m: MatchResult): Pt? {
        val lat = m.groupValues[1].toDoubleOrNull() ?: return null
        val lng = m.groupValues[2].toDoubleOrNull() ?: return null
        if (lat !in -90.0..90.0 || lng !in -180.0..180.0 || (lat == 0.0 && lng == 0.0)) return null
        return pt(lat, lng)
    }

    /** what Google Maps shares: a name, an address, a link. The link, and the words before it */
    fun splitShared(text: String): Pair<String?, String> {
        val link = Regex("""(https?://\S+|geo:\S+)""").find(text)?.value
        val words = text.replace(link ?: "\u0000", "").lines().map { it.trim() }.filter { it.isNotEmpty() }
            .joinToString(", ")
        return link to words
    }

    // ---------------------------------------------------------------- the corner

    /**
     * A little of the street turned onto: from [at] (index into the street's
     * [way]) a [lengthM] along it, in the direction that matches a turn to
     * [side] from the [approach] bearing
     */
    fun stub(way: List<Pt>, at: Int, approach: Double, side: Int, lengthM: Double = 120.0): List<Pt> {
        fun walk(step: Int): List<Pt> {
            val out = mutableListOf(way[at])
            var i = at
            var left = lengthM
            while (left > 0 && i + step in way.indices) {
                val d = distanceM(way[i], way[i + step])
                if (d >= left) {
                    val f = left / d
                    out.add(pt(way[i][0] + f * (way[i + step][0] - way[i][0]), way[i][1] + f * (way[i + step][1] - way[i][1])))
                    break
                }
                out.add(way[i + step])
                left -= d
                i += step
            }
            return out
        }
        val options = listOf(walk(1), walk(-1)).filter { it.size > 1 }
        if (options.isEmpty()) return emptyList()
        val want = side * 90.0
        return options.minBy { abs(turnAngle(approach, bearing(it[0], it[1])) - want) }
    }
}
