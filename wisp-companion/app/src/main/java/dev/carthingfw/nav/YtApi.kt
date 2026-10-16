package dev.carthingfw.nav

import android.content.Context
import org.json.JSONObject
import java.net.HttpURLConnection
import java.net.URL
import java.net.URLEncoder

/**
 * Your YouTube Music library through YouTube's official API (YouTube Data API
 * v3), with the sign-in from google.com/device (YtSignIn): your playlists,
 * private ones too, the music you've liked, liking a song and adding it to a
 * playlist. Songs liked in YouTube Music are liked videos on YouTube, so
 * "Liked music" is your liked videos in YouTube's Music category.
 */
object YtApi {
    private const val API = "https://www.googleapis.com/youtube/v3"
    // a page is 50 at most; the Car Thing shows up to 200
    private const val PAGES = 4

    /** your playlists, newest first as YouTube lists them */
    fun myPlaylists(ctx: Context): List<YtMusic.Item> =
        pages(ctx, "playlists", mapOf("part" to "snippet,contentDetails", "mine" to "true")).map { p ->
            val id = p.getString("id")
            val count = p.optJSONObject("contentDetails")?.optInt("itemCount", -1) ?: -1
            YtMusic.Item(
                p.getJSONObject("snippet").optString("title"),
                if (count >= 0) "Playlist · $count ${if (count == 1) "song" else "songs"}" else "Playlist",
                thumb(p.optJSONObject("snippet")), "VL$id", id, null,
            )
        }

    /** a playlist's songs, in its order */
    fun playlistSongs(ctx: Context, playlistId: String): List<YtMusic.Item> =
        pages(ctx, "playlistItems", mapOf("part" to "snippet", "playlistId" to playlistId)).mapNotNull { it ->
            val s = it.getJSONObject("snippet")
            val video = s.optJSONObject("resourceId")?.optString("videoId")?.ifEmpty { null } ?: return@mapNotNull null
            val title = s.optString("title")
            // songs taken down or made private stay in the list with no owner
            if (!s.has("videoOwnerChannelTitle") && (title == "Deleted video" || title == "Private video")) return@mapNotNull null
            YtMusic.Item(title, artist(s.optString("videoOwnerChannelTitle")), thumb(s), null, playlistId, video)
        }

    /** what you've liked in YouTube's Music category */
    fun likedMusic(ctx: Context): List<YtMusic.Item> =
        pages(ctx, "videos", mapOf("part" to "snippet", "myRating" to "like"))
            .filter { it.optJSONObject("snippet")?.optString("categoryId") == MUSIC }
            .map { v ->
                val s = v.getJSONObject("snippet")
                YtMusic.Item(s.optString("title"), artist(s.optString("channelTitle")), thumb(s), null, null, v.getString("id"))
            }

    /** whether you like [videoId]: true, false (not liked) or null if YouTube won't say */
    fun liked(ctx: Context, videoId: String): Boolean? = runCatching {
        val items = get(ctx, "videos/getRating", mapOf("id" to videoId)).optJSONArray("items")
        items?.optJSONObject(0)?.optString("rating")?.let { it == "like" }
    }.getOrNull()

    fun rate(ctx: Context, videoId: String, like: Boolean) {
        send(ctx, "videos/rate", mapOf("id" to videoId, "rating" to if (like) "like" else "none"), null)
    }

    fun addToPlaylist(ctx: Context, playlistId: String, videoId: String) {
        val body = JSONObject().put("snippet", JSONObject()
            .put("playlistId", playlistId)
            .put("resourceId", JSONObject().put("kind", "youtube#video").put("videoId", videoId)))
        send(ctx, "playlistItems", mapOf("part" to "snippet"), body)
    }

    private const val MUSIC = "10"

    // "Artist - Topic" is how YouTube names an artist's own music channel
    fun artist(channel: String): String = channel.removeSuffix(" - Topic")

    private fun thumb(snippet: JSONObject?): String? {
        val t = snippet?.optJSONObject("thumbnails") ?: return null
        for (size in listOf("high", "medium", "standard", "default")) {
            t.optJSONObject(size)?.optString("url")?.ifEmpty { null }?.let { return it }
        }
        return null
    }

    private fun pages(ctx: Context, path: String, query: Map<String, String>): List<JSONObject> {
        val out = mutableListOf<JSONObject>()
        var token: String? = null
        repeat(PAGES) {
            val q = query + ("maxResults" to "50") + (token?.let { mapOf("pageToken" to it) } ?: emptyMap())
            val page = get(ctx, path, q)
            page.optJSONArray("items")?.let { a -> for (i in 0 until a.length()) out += a.getJSONObject(i) }
            token = page.optString("nextPageToken").ifEmpty { null } ?: return out
        }
        return out
    }

    private fun get(ctx: Context, path: String, query: Map<String, String>) = call(ctx, "GET", path, query, null)

    private fun send(ctx: Context, path: String, query: Map<String, String>, body: JSONObject?) =
        call(ctx, "POST", path, query, body)

    private fun call(ctx: Context, method: String, path: String, query: Map<String, String>, body: JSONObject?): JSONObject {
        val token = YtSignIn.accessToken(ctx)
            ?: throw IllegalStateException("Sign in to YouTube Music in the Wisp app on your phone")
        val qs = query.entries.joinToString("&") { (k, v) -> "$k=" + URLEncoder.encode(v, "UTF-8") }
        val conn = (URL("$API/$path?$qs").openConnection() as HttpURLConnection).apply {
            connectTimeout = 15_000
            readTimeout = 20_000
            requestMethod = method
            setRequestProperty("Authorization", "Bearer $token")
            if (method == "POST") {
                doOutput = true
                setRequestProperty("Content-Type", "application/json")
            }
        }
        try {
            if (method == "POST") conn.outputStream.use { it.write((body?.toString() ?: "").toByteArray()) }
            val code = conn.responseCode
            val text = (if (code < 400) conn.inputStream else conn.errorStream)?.bufferedReader()?.readText().orEmpty()
            if (code == 401) throw IllegalStateException("YouTube Music signed you out; sign in again")
            if (code >= 400) {
                val why = runCatching { JSONObject(text).getJSONObject("error").optString("message") }.getOrNull()
                throw IllegalStateException("YouTube answered $code" + (why?.let { ": $it" } ?: ""))
            }
            return if (text.isBlank()) JSONObject() else JSONObject(text)
        } finally {
            conn.disconnect()
        }
    }
}
