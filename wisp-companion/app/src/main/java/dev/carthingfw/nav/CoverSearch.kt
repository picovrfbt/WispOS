package dev.carthingfw.nav

import org.json.JSONObject
import java.net.HttpURLConnection
import java.net.URL
import java.net.URLEncoder

/**
 * A cover for a song that brought none (a local file played in VLC or the
 * phone's music app), looked up by artist and title in the iTunes catalogue,
 * which answers without an account or key. Only the artist and title are sent.
 */
object CoverSearch {
    /** the cover's address, about 600 px square, or null when nothing matches */
    fun find(artist: String, title: String): String? {
        val term = URLEncoder.encode("$artist $title", "UTF-8")
        val conn = (URL("https://itunes.apple.com/search?term=$term&media=music&entity=song&limit=10")
            .openConnection() as HttpURLConnection).apply {
            connectTimeout = 10_000
            readTimeout = 15_000
        }
        try {
            if (conn.responseCode != 200) return null
            return pick(JSONObject(conn.inputStream.bufferedReader().readText()), artist)
        } finally {
            conn.disconnect()
        }
    }

    /** the first result by that artist, its artwork made bigger */
    fun pick(answer: JSONObject, artist: String): String? {
        val results = answer.optJSONArray("results") ?: return null
        val want = simple(artist)
        for (i in 0 until results.length()) {
            val r = results.optJSONObject(i) ?: continue
            val by = simple(r.optString("artistName"))
            if (want.isNotEmpty() && !(by.contains(want) || want.contains(by))) continue
            val art = r.optString("artworkUrl100")
            if (art.isEmpty()) continue
            return art.replace("100x100bb", "600x600bb")
        }
        return null
    }

    private fun simple(s: String) = s.lowercase().filter { it.isLetterOrDigit() }
}
