package dev.carthingfw.nav

import android.content.Context
import android.content.Intent
import android.net.Uri
import android.util.Log
import org.json.JSONArray
import org.json.JSONObject
import java.net.HttpURLConnection
import java.net.URL

/**
 * YouTube Music for the Car Thing.
 *
 * Your library (playlists, liked music, liking, adding to a playlist) comes
 * through YouTube's official API (YtApi), signed in once with a code at
 * google.com/device (YtSignIn, YtMusicSignInActivity). The sign-in stays on this
 * phone, in this app's private storage, and is never sent to the Car Thing or
 * anywhere else; Sign out revokes it. The Car Thing gets only names and covers.
 *
 * Search, albums, artists and what's up next are read signed out, the way
 * music.youtube.com shows them to anyone: that part is not an official API,
 * and can stop working if YouTube changes its website until Wisp is updated.
 * Playing anything opens it in the YT Music app.
 */
object YtMusic {
    const val ID = "ytmusic"
    private const val TAG = "WispYtMusic"
    private const val ORIGIN = "https://music.youtube.com"
    private const val API = "$ORIGIN/youtubei/v1"
    // the web client music.youtube.com itself identifies as
    private const val CLIENT_NAME = "WEB_REMIX"
    private const val CLIENT_VERSION = "1.20250101.01.00"
    private const val UA =
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36"

    /** the library's sections, as the Car Thing's rail shows them */
    val SECTIONS = listOf(
        Section("liked", "Liked music", "liked"),
        Section("playlists", "Playlists", "playlists"),
    )

    data class Section(val id: String, val name: String, val browseId: String)

    /** one card or row: what it's called, a line under it, a cover, and how to open or play it */
    data class Item(
        val name: String,
        val sub: String,
        val image: String?,
        /** a browse id to open it (a playlist, album or artist page), if it has one */
        val browseId: String?,
        /** what to play: a playlist id, or a video id for a single song */
        val playlistId: String?,
        val videoId: String?,
    ) {
        fun json(): JSONObject = JSONObject().put("name", name).put("sub", sub)
            .apply {
                if (image != null) put("image", image)
                if (browseId != null) put("id", browseId)
                if (playlistId != null) put("playlist", playlistId)
                if (videoId != null) put("video", videoId)
            }
    }

    fun signedIn(ctx: Context): Boolean = YtSignIn.signedIn(ctx)

    fun signOut(ctx: Context) {
        YtSignIn.signOut(ctx)
        // the in-app sign-in page older versions used kept cookies
        Prefs.setYtCookies(ctx, "")
        android.webkit.CookieManager.getInstance().removeAllCookies(null)
    }

    /**
     * A library section ("liked", "playlists"), or a page by its browse id:
     * playlists through the API (yours may be private), albums and artists as
     * music.youtube.com shows them signed out
     */
    fun browse(ctx: Context, browseId: String): List<Item> = when {
        browseId == "liked" -> YtApi.likedMusic(ctx)
        browseId == "playlists" -> YtApi.myPlaylists(ctx)
        browseId.startsWith("VL") && signedIn(ctx) -> YtApi.playlistSongs(ctx, browseId.removePrefix("VL"))
        else -> items(post("browse", JSONObject().put("browseId", browseId)))
    }

    // search filters, as music.youtube.com sends them
    private val SEARCH_PARAMS = mapOf(
        "song" to "EgWKAQIIAWoMEA4QChADEAQQCRAF",
        "album" to "EgWKAQIYAWoMEA4QChADEAQQCRAF",
        "artist" to "EgWKAQIgAWoMEA4QChADEAQQCRAF",
        "playlist" to "EgeKAQQoAEABagwQDhAKEAMQBBAJEAU=",
    )

    /** the top results for a search, of one kind (song, album, artist, playlist) */
    fun search(ctx: Context, query: String, kind: String): List<Item> {
        val body = JSONObject().put("query", query)
        SEARCH_PARAMS[kind]?.let { body.put("params", it) }
        // works signed out too; signed in, results lean on your taste
        return items(post("search", body))
            .filter { it.playlistId != null || it.videoId != null || it.browseId != null }
    }

    /** what's playing now on YT Music: its video id, whether you like it, what's up next, its cover */
    data class Now(val videoId: String?, val liked: Boolean?, val upNext: List<Item>, val image: String? = null)

    fun now(ctx: Context, title: String, artist: String, mediaId: String?): Now {
        val video = currentVideo(ctx, title, artist, mediaId) ?: return Now(null, null, emptyList())
        val body = JSONObject().put("videoId", video).put("isAudioOnly", true)
        lastPlaylist?.let { body.put("playlistId", it) }
        val page = post("next", body)
        // signed out, the page can't say whether you like it; the API can
        val liked = if (signedIn(ctx)) YtApi.liked(ctx, video) else null
        return Now(video, liked, upNext(page), coverOf(video))
    }

    /** likes (or un-likes) a song in your YouTube Music library */
    fun like(ctx: Context, videoId: String, like: Boolean) = YtApi.rate(ctx, videoId, like)

    /** adds the song playing to your playlist best matching [wanted]; returns that playlist's name */
    fun addToPlaylist(ctx: Context, title: String, artist: String, mediaId: String?, wanted: String): String {
        val video = currentVideo(ctx, title, artist, mediaId) ?: throw IllegalStateException("Couldn't tell which song is on")
        val mine = YtApi.myPlaylists(ctx)
        val pick = bestNameMatch(mine.map { it.name }, wanted)?.let { i -> mine[i] }
            ?: throw IllegalStateException("Couldn't find a playlist called \"$wanted\"")
        YtApi.addToPlaylist(ctx, pick.playlistId!!, video)
        return pick.name
    }

    /** the index of the name closest to [wanted]: the same words first, then sharing most of them */
    fun bestNameMatch(names: List<String>, wanted: String): Int? {
        fun words(s: String) = s.lowercase().split(Regex("""[^\p{L}\p{N}]+""")).filter { it.isNotEmpty() }
        val want = words(wanted)
        if (want.isEmpty()) return null
        var best: Int? = null
        var bestScore = 0.0
        names.forEachIndexed { i, n ->
            val have = words(n)
            val score = when {
                have == want -> 2.0
                else -> {
                    val shared = want.count { it in have }
                    if (shared == 0) 0.0 else shared.toDouble() / maxOf(want.size, have.size)
                }
            }
            if (score > bestScore) {
                bestScore = score
                best = i
            }
        }
        return best.takeIf { bestScore >= 0.5 }
    }

    private val VIDEO_ID = Regex("[A-Za-z0-9_-]{11}")

    /** a song's cover from YouTube: its square-ish thumbnail, at a size the Car Thing uses */
    fun coverOf(videoId: String): String = "https://i.ytimg.com/vi/$videoId/hqdefault.jpg"

    // the song on now: from the app's own media id when it gives one, the song
    // Wisp last started if the title matches, else the top search match
    private fun currentVideo(ctx: Context, title: String, artist: String, mediaId: String?): String? {
        mediaId?.takeIf { VIDEO_ID.matches(it) }?.let { return it }
        mediaId?.let { id -> Regex("""[?&]v=([A-Za-z0-9_-]{11})""").find(id)?.groupValues?.get(1) }?.let { return it }
        if (title.isBlank()) return null
        lastPlayed?.let { (t, v) -> if (t.equals(title, ignoreCase = true)) return v }
        val hits = search(ctx, "$title $artist".trim(), "song")
        val pick = hits.firstOrNull { it.videoId != null && it.name.equals(title, ignoreCase = true) }
            ?: hits.firstOrNull { it.videoId != null }
        return pick?.videoId?.also { lastPlayed = title to it }
    }

    @Volatile
    private var lastPlaylist: String? = null

    @Volatile
    private var lastPlayed: Pair<String, String>? = null

    /** the queue in a "next" answer: the songs after the one playing */
    fun upNext(page: JSONObject): List<Item> {
        val all = mutableListOf<Pair<Item, Boolean>>()
        walk(page) { key, obj ->
            if (key == "playlistPanelVideoRenderer") {
                val name = runs(obj.optJSONObject("title")).ifEmpty { return@walk }
                val sub = runs(obj.optJSONObject("shortBylineText")).ifEmpty { runs(obj.optJSONObject("longBylineText")) }
                val video = obj.optString("videoId").ifEmpty { null }
                val playlist = obj.optJSONObject("navigationEndpoint")?.optJSONObject("watchEndpoint")
                    ?.optString("playlistId")?.ifEmpty { null }
                all += Item(name, sub, thumb(obj), null, playlist, video) to obj.optBoolean("selected")
            }
        }
        val at = all.indexOfFirst { it.second }
        return all.drop(if (at >= 0) at + 1 else 0).map { it.first }.distinctBy { it.videoId }.take(50)
    }

    /** LIKE, DISLIKE or INDIFFERENT for the song a "next" answer is about */
    fun likeStatus(page: JSONObject): String? {
        var status: String? = null
        walk(page) { key, obj ->
            if (key == "likeButtonRenderer" && status == null) status = obj.optString("likeStatus").ifEmpty { null }
        }
        return status
    }

    // one call to music.youtube.com's own API, signed out
    private fun post(endpoint: String, body: JSONObject): JSONObject {
        body.put("context", JSONObject().put("client", JSONObject()
            .put("clientName", CLIENT_NAME).put("clientVersion", CLIENT_VERSION).put("hl", "en")))
        val conn = (URL("$API/$endpoint?prettyPrint=false").openConnection() as HttpURLConnection).apply {
            connectTimeout = 15_000
            readTimeout = 20_000
            requestMethod = "POST"
            doOutput = true
            setRequestProperty("Content-Type", "application/json")
            setRequestProperty("Origin", ORIGIN)
            setRequestProperty("X-Origin", ORIGIN)
            setRequestProperty("User-Agent", UA)
        }
        try {
            conn.outputStream.use { it.write(body.toString().toByteArray()) }
            when (conn.responseCode) {
                200 -> {}
                else -> throw IllegalStateException("YouTube Music answered ${conn.responseCode}")
            }
            return JSONObject(conn.inputStream.bufferedReader().readText())
        } finally {
            conn.disconnect()
        }
    }

    /**
     * Every card and row on a page, wherever the page's layout puts them: the
     * website wraps them in shelves and grids that change shape now and then,
     * so this walks the whole answer for the two kinds of item it draws
     */
    fun items(page: JSONObject): List<Item> {
        val out = mutableListOf<Item>()
        walk(page) { key, obj ->
            when (key) {
                "musicTwoRowItemRenderer" -> twoRow(obj)?.let(out::add)
                "musicResponsiveListItemRenderer" -> listItem(obj)?.let(out::add)
            }
        }
        // cards that do nothing here, like "New playlist", are left out
        return out.filter { it.browseId != null || it.playlistId != null || it.videoId != null }
    }

    private fun walk(node: Any?, visit: (String, JSONObject) -> Unit) {
        when (node) {
            is JSONObject -> node.keys().forEach { k ->
                val v = node.opt(k)
                if (v is JSONObject) visit(k, v)
                walk(v, visit)
            }
            is JSONArray -> for (i in 0 until node.length()) walk(node.opt(i), visit)
        }
    }

    private fun runs(obj: JSONObject?): String =
        obj?.optJSONArray("runs")?.let { r -> (0 until r.length()).joinToString("") { r.getJSONObject(it).optString("text") } }
            ?: ""

    private fun thumb(node: JSONObject?): String? {
        var best: String? = null
        walk(node) { key, obj ->
            if (key == "thumbnail" && best == null) {
                val list = obj.optJSONArray("thumbnails") ?: return@walk
                if (list.length() > 0) best = list.getJSONObject(list.length() - 1).optString("url").takeIf { it.isNotEmpty() }
            }
        }
        return best
    }

    // the first play button's playlist (or song) in an item
    private fun playOf(node: JSONObject): Pair<String?, String?> {
        var playlist: String? = null
        var video: String? = null
        walk(node) { key, obj ->
            if (key == "watchPlaylistEndpoint" && playlist == null) playlist = obj.optString("playlistId").takeIf { it.isNotEmpty() }
            if (key == "watchEndpoint") {
                if (video == null) video = obj.optString("videoId").takeIf { it.isNotEmpty() }
                if (playlist == null) playlist = obj.optString("playlistId").takeIf { it.isNotEmpty() }
            }
        }
        return playlist to video
    }

    private fun twoRow(r: JSONObject): Item? {
        val name = runs(r.optJSONObject("title")).ifEmpty { return null }
        val browse = r.optJSONObject("navigationEndpoint")?.optJSONObject("browseEndpoint")?.optString("browseId")
        val (playlist, video) = playOf(r)
        return Item(name, runs(r.optJSONObject("subtitle")), thumb(r.optJSONObject("thumbnailRenderer")), browse?.ifEmpty { null }, playlist, video)
    }

    private fun listItem(r: JSONObject): Item? {
        val cols = r.optJSONArray("flexColumns") ?: return null
        fun col(i: Int) = cols.optJSONObject(i)?.optJSONObject("musicResponsiveListItemFlexColumnRenderer")?.optJSONObject("text")
        val name = runs(col(0)).ifEmpty { return null }
        val sub = (1 until cols.length()).map { runs(col(it)) }.filter { it.isNotBlank() }.joinToString(" · ")
        val browse = r.optJSONObject("navigationEndpoint")?.optJSONObject("browseEndpoint")?.optString("browseId")
        val video = r.optJSONObject("playlistItemData")?.optString("videoId")?.ifEmpty { null }
        val (playlist, playVideo) = playOf(r)
        return Item(name, sub, thumb(r.optJSONObject("thumbnail")), browse?.ifEmpty { null }, playlist, video ?: playVideo)
    }

    /** which YT Music app plays it: the one switched on in Music services (Morphe counts) */
    private fun appPackage(ctx: Context): String? = MusicServices.services
        .filter { "youtube.music" in it.pkg && MusicServices.enabled(ctx, it.pkg) }
        .map { it.pkg }
        .firstOrNull()
        ?: "com.google.android.apps.youtube.music".takeIf {
            try {
                ctx.packageManager.getPackageInfo(it, 0); true
            } catch (e: Exception) {
                false
            }
        }

    /** a radio or mix: YouTube builds it around one song, and its id names that song */
    fun isRadio(playlistId: String) = playlistId.startsWith("RD")

    /**
     * The link that plays it. A song picked from a radio is opened on its own:
     * opened "in" the radio, YT Music rebuilds the radio from the song it was
     * made for and goes back to that one. On its own it starts a fresh radio
     * from the picked song, which is what was wanted
     */
    fun watchUrl(playlistId: String?, videoId: String?): String? {
        val list = playlistId?.takeUnless { videoId != null && isRadio(it) }
        val q = buildList {
            if (videoId != null) add("v=$videoId")
            if (list != null) add("list=$list")
        }
        return if (q.isEmpty()) null else "$ORIGIN/watch?${q.joinToString("&")}"
    }

    /** plays a playlist (and, given one, starts at a song) in the phone's YT Music app */
    fun play(ctx: Context, playlistId: String?, videoId: String?, title: String? = null): Boolean {
        val url = watchUrl(playlistId, videoId) ?: return false
        lastPlaylist = playlistId?.takeUnless { videoId != null && isRadio(it) }
        lastPlayed = null
        if (!open(ctx, url)) return false
        // if the app carried on with something else, ask once more for the song on its own
        val pkg = appPackage(ctx)
        if (videoId != null && title != null && pkg != null) {
            MediaWatcher.checkSoon(pkg, 5000) { playing ->
                if (playing != null && !playing.equals(title, ignoreCase = true)) {
                    Log.i(TAG, "YT Music played \"$playing\", not \"$title\"; opening the song on its own")
                    lastPlaylist = null
                    open(ctx, "$ORIGIN/watch?v=$videoId")
                }
            }
        }
        return true
    }

    private fun open(ctx: Context, url: String): Boolean {
        val intent = Intent(Intent.ACTION_VIEW, Uri.parse(url)).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
        appPackage(ctx)?.let(intent::setPackage)
        return AppOpener.open(ctx, intent, "YouTube Music")
    }
}
