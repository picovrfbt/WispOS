package dev.carthingfw.nav

import android.content.Context
import android.content.Intent
import android.net.Uri
import android.util.Log
import org.json.JSONArray
import org.json.JSONObject
import java.net.HttpURLConnection
import java.net.URL
import java.net.URLEncoder
import java.util.concurrent.ConcurrentHashMap

/**
 * Your SoundCloud library, read the way soundcloud.com reads it.
 *
 * You sign in to soundcloud.com once inside this app (SoundCloudSignInActivity);
 * the sign-in it leaves (a token) stays in this app's private storage on this
 * phone and is only ever sent to SoundCloud. With it, this reads your likes,
 * playlists, history and who you follow, and the Car Thing gets names and
 * covers. Playing one opens it in the SoundCloud app.
 *
 * Like YtMusic, this is the website's own API rather than an official one, so a
 * change at SoundCloud can stop it working until Wisp is updated.
 */
object SoundCloud : MusicLibrary {
    override val id = "soundcloud"
    override val name = "SoundCloud"
    const val PKG = "com.soundcloud.android"
    private const val TAG = "WispSoundCloud"
    private const val API = "https://api-v2.soundcloud.com"
    private const val SITE = "https://soundcloud.com"
    private const val UA =
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36"

    override val sections = listOf(
        YtMusic.Section("likes", "Liked tracks", "likes"),
        YtMusic.Section("playlists", "Playlists", "playlists"),
        YtMusic.Section("history", "Recently played", "history"),
        YtMusic.Section("following", "Following", "following"),
    )

    override fun owns(pkg: String) = "soundcloud" in pkg

    override fun signedIn(ctx: Context) = Prefs.scToken(ctx).isNotEmpty()

    override fun signOut(ctx: Context) {
        Prefs.setScToken(ctx, "")
        Prefs.setScUser(ctx, "")
        likedIds = null
        android.webkit.CookieManager.getInstance().apply {
            setCookie(SITE, "oauth_token=; Max-Age=0")
            flush()
        }
    }

    // where each track or playlist lives on soundcloud.com, from the listings that named it
    private val permalinks = ConcurrentHashMap<String, String>()

    // each track's waveform, as SoundCloud draws it under the player
    private val waveforms = ConcurrentHashMap<String, String>()

    override fun browse(ctx: Context, id: String): List<YtMusic.Item> {
        if (!signedIn(ctx)) throw IllegalStateException("Sign in to SoundCloud in the Wisp app on your phone")
        val me = { userId(ctx) }
        return when {
            id == "likes" -> collection(get(ctx, "/users/${me()}/track_likes", "limit" to "100"))
                .mapNotNull { it.optJSONObject("track")?.let(::track) }
            id == "playlists" -> collection(get(ctx, "/me/library/all", "limit" to "50"))
                .mapNotNull { (it.optJSONObject("playlist") ?: it.optJSONObject("system_playlist"))?.let(::playlist) }
            id == "history" -> collection(get(ctx, "/me/play-history/tracks", "limit" to "50"))
                .mapNotNull { it.optJSONObject("track")?.let(::track) }
                .distinctBy { it.videoId }
            id == "following" -> collection(get(ctx, "/users/${me()}/followings", "limit" to "100")).map(::user)
            id.startsWith("playlist:") -> tracksOf(ctx, get(ctx, "/playlists/${id.removePrefix("playlist:")}"))
            id.startsWith("system:") -> tracksOf(ctx, get(ctx, "/system-playlists/${id.removePrefix("system:")}"))
            id.startsWith("user:") ->
                collection(get(ctx, "/users/${id.removePrefix("user:")}/tracks", "limit" to "50")).map(::track)
            else -> throw IllegalStateException("nothing to open")
        }
    }

    override fun search(ctx: Context, query: String, kind: String): List<YtMusic.Item> {
        val (path, map) = when (kind) {
            "album" -> "/search/albums" to ::playlist
            "playlist" -> "/search/playlists" to ::playlist
            "artist" -> "/search/users" to ::user
            else -> "/search/tracks" to ::track
        }
        return collection(get(ctx, path, "q" to query, "limit" to "20")).map(map)
    }

    override fun play(ctx: Context, playlist: String?, video: String?, title: String?): Boolean {
        val app = ctx.applicationContext
        // a song picked in a list plays that song; a playlist or an artist starts at its first
        val trackId = video?.removePrefix("track:")
            ?: playlist?.let { p -> browse(app, p).firstNotNullOfOrNull { it.videoId?.removePrefix("track:") } }
            ?: return false
        val url = permalinks[trackId] ?: get(app, "/tracks/$trackId").optString("permalink_url").ifEmpty { null }
            ?: return false
        val intent = Intent(Intent.ACTION_VIEW, Uri.parse(url)).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
        if (installed(app)) intent.setPackage(PKG)
        if (!AppOpener.open(app, intent, "SoundCloud")) return false
        // the app opens on the track; if it doesn't start it, press play for it
        MediaWatcher.playSoon(PKG, 3500)
        return true
    }

    override fun now(ctx: Context, title: String, artist: String, mediaId: String?): MusicLibrary.Now {
        if (title.isBlank()) return MusicLibrary.Now(null, null, emptyList())
        val hits = search(ctx, "$title $artist".trim(), "song")
        val pick = hits.firstOrNull { it.name.equals(title, ignoreCase = true) } ?: hits.firstOrNull()
        val id = pick?.videoId?.removePrefix("track:") ?: return MusicLibrary.Now(null, null, emptyList())
        // SoundCloud carries on with related tracks once a song ends
        val related = try {
            collection(get(ctx, "/tracks/$id/related", "limit" to "30")).map(::track)
        } catch (e: Exception) {
            emptyList()
        }
        // a sign-in that's lapsed mustn't cost the waveform and up next too
        val liked = try {
            if (signedIn(ctx)) liked(ctx).contains(id) else null
        } catch (e: Exception) {
            Log.w(TAG, "couldn't tell if it's liked", e)
            null
        }
        // the waveform's numbers sit beside its picture: <id>_m.json for <id>_m.png
        val wave = try {
            waveforms[id]?.let { url ->
                waveform(fetchText(if (url.endsWith(".png")) url.removeSuffix(".png") + ".json" else url))
            }
        } catch (e: Exception) {
            null
        }
        return MusicLibrary.Now("track:$id", liked, related, wave, pick.image)
    }

    override fun like(ctx: Context, current: String, like: Boolean) {
        val id = current.removePrefix("track:")
        if (id.isEmpty() || !id.all(Char::isDigit)) throw IllegalStateException("not a SoundCloud track")
        request(ctx, if (like) "PUT" else "DELETE", "/users/${userId(ctx)}/track_likes/$id")
        likedIds = liked(ctx).let { if (like) it + id else it - id }
    }

    @Volatile
    private var likedIds: Set<String>? = null

    @Volatile
    private var likedAt = 0L

    // the ids of your liked tracks, read again every few minutes
    private fun liked(ctx: Context): Set<String> {
        val cached = likedIds
        if (cached != null && System.currentTimeMillis() - likedAt < 5 * 60_000) return cached
        val ids = collection(get(ctx, "/users/${userId(ctx)}/track_likes", "limit" to "200"))
            .mapNotNull { it.optJSONObject("track")?.optLong("id")?.takeIf { n -> n > 0 }?.toString() }
            .toSet()
        likedIds = ids
        likedAt = System.currentTimeMillis()
        return ids
    }

    fun installed(ctx: Context) = try {
        ctx.packageManager.getPackageInfo(PKG, 0)
        true
    } catch (e: Exception) {
        false
    }

    // --- shapes ---

    private fun art(url: String?): String? =
        url?.takeIf { it.isNotEmpty() && it != "null" }?.replace("-large.", "-t300x300.")

    fun track(t: JSONObject): YtMusic.Item {
        val id = t.optLong("id").toString()
        t.optString("permalink_url").takeIf { it.startsWith("https://") }?.let { permalinks[id] = it }
        t.optString("waveform_url").takeIf { it.startsWith("https://") }?.let { waveforms[id] = it }
        val user = t.optJSONObject("user")
        return YtMusic.Item(
            t.optString("title"), user?.optString("username").orEmpty(),
            art(t.optString("artwork_url")) ?: art(user?.optString("avatar_url")),
            null, null, "track:$id",
        )
    }

    fun playlist(p: JSONObject): YtMusic.Item {
        // a system playlist (a station, a mix) goes by its urn
        val urn = p.optString("urn")
        val key = if (urn.contains("system-playlist")) "system:$urn" else "playlist:${p.optLong("id")}"
        val owner = p.optJSONObject("user")?.optString("username").orEmpty()
        val kind = if (p.optBoolean("is_album")) "Album" else "Playlist"
        val firstArt = p.optJSONArray("tracks")?.optJSONObject(0)?.optString("artwork_url")
        return YtMusic.Item(
            p.optString("title"), listOf(kind, owner).filter { it.isNotEmpty() }.joinToString(" · "),
            art(p.optString("artwork_url")) ?: art(p.optString("calculated_artwork_url")) ?: art(firstArt),
            key, key, null,
        )
    }

    fun user(u: JSONObject): YtMusic.Item {
        val key = "user:${u.optLong("id")}"
        return YtMusic.Item(u.optString("username"), "Artist", art(u.optString("avatar_url")), key, key, null)
    }

    fun collection(page: JSONObject): List<JSONObject> {
        val arr = page.optJSONArray("collection") ?: return emptyList()
        return (0 until arr.length()).mapNotNull { arr.optJSONObject(it) }
    }

    // a playlist's tracks; past the first few SoundCloud sends only their ids, so fill those in
    private fun tracksOf(ctx: Context, playlist: JSONObject): List<YtMusic.Item> {
        val arr = playlist.optJSONArray("tracks") ?: return emptyList()
        val all = (0 until arr.length()).mapNotNull { arr.optJSONObject(it) }.take(200)
        val bare = all.filter { !it.has("title") }.map { it.optLong("id") }.filter { it > 0 }
        val filled = HashMap<Long, JSONObject>()
        bare.chunked(50).forEach { ids ->
            val got = getArray(ctx, "/tracks", "ids" to ids.joinToString(","))
            for (i in 0 until got.length()) got.optJSONObject(i)?.let { filled[it.optLong("id")] = it }
        }
        return all.mapNotNull { t -> if (t.has("title")) t else filled[t.optLong("id")] }.map(::track)
    }

    // --- the API ---

    private fun userId(ctx: Context): String {
        Prefs.scUser(ctx).takeIf { it.isNotEmpty() }?.let { return it }
        val id = get(ctx, "/me").optLong("id").takeIf { it > 0 }?.toString()
            ?: throw IllegalStateException("SoundCloud signed you out; sign in again")
        Prefs.setScUser(ctx, id)
        return id
    }

    private fun get(ctx: Context, path: String, vararg params: Pair<String, String>): JSONObject =
        JSONObject(request(ctx, "GET", path, *params))

    private fun getArray(ctx: Context, path: String, vararg params: Pair<String, String>): JSONArray =
        JSONArray(request(ctx, "GET", path, *params))

    private fun request(ctx: Context, method: String, path: String, vararg params: Pair<String, String>): String {
        var refreshed = false
        // a lapsed sign-in is refused even for public things (search, related,
        // waveforms): those are tried once more without it
        var anonymous = false
        while (true) {
            val clientId = clientId(ctx, refresh = refreshed)
            val q = (params.toList() + ("client_id" to clientId) + ("app_locale" to "en"))
                .joinToString("&") { (k, v) -> "$k=${URLEncoder.encode(v, "UTF-8")}" }
            val conn = (URL("$API$path?$q").openConnection() as HttpURLConnection).apply {
                connectTimeout = 15_000
                readTimeout = 20_000
                requestMethod = method
                setRequestProperty("Accept", "application/json")
                setRequestProperty("Origin", SITE)
                setRequestProperty("User-Agent", UA)
                if (!anonymous) Prefs.scToken(ctx).takeIf { it.isNotEmpty() }?.let { setRequestProperty("Authorization", "OAuth $it") }
                if (method == "PUT") {
                    doOutput = true
                    setFixedLengthStreamingMode(0)
                }
            }
            try {
                if (method == "PUT") conn.outputStream.close()
                when (val code = conn.responseCode) {
                    in 200..299 -> return conn.inputStream.bufferedReader().readText()
                    // a stale client id looks the same as a lapsed sign-in: try a fresh id first
                    401, 403 -> {
                        if (!refreshed) {
                            refreshed = true
                            continue
                        }
                        if (!anonymous && method == "GET" && Prefs.scToken(ctx).isNotEmpty()) {
                            Log.w(TAG, "SoundCloud refused the sign-in for $path; trying without it")
                            anonymous = true
                            continue
                        }
                        throw IllegalStateException("SoundCloud signed you out; sign in again")
                    }
                    404 -> throw IllegalStateException("SoundCloud couldn't find that")
                    else -> throw IllegalStateException("SoundCloud answered $code")
                }
            } finally {
                conn.disconnect()
            }
        }
    }

    // the id soundcloud.com's own pages call the API with, read from its scripts
    @Synchronized
    private fun clientId(ctx: Context, refresh: Boolean): String {
        if (!refresh) Prefs.scClientId(ctx).takeIf { it.isNotEmpty() }?.let { return it }
        val home = fetchText(SITE)
        val scripts = Regex("""<script[^>]+src="(https://a-v2\.sndcdn\.com/assets/[^"]+\.js)"""")
            .findAll(home).map { it.groupValues[1] }.toList()
        for (src in scripts.asReversed()) {
            val id = findClientId(fetchText(src))
            if (id != null) {
                Prefs.setScClientId(ctx, id)
                return id
            }
        }
        throw IllegalStateException("couldn't reach SoundCloud")
    }

    /** SoundCloud's waveform JSON ({height, samples}) as [bars] heights from 0 to 100 */
    fun waveform(json: String, bars: Int = 120): List<Int>? {
        val o = JSONObject(json)
        val samples = o.optJSONArray("samples") ?: return null
        val n = samples.length()
        if (n == 0) return null
        val height = o.optInt("height", 140).coerceAtLeast(1)
        return (0 until bars).map { b ->
            val from = b * n / bars
            val to = maxOf(from + 1, (b + 1) * n / bars)
            var peak = 0
            for (i in from until minOf(to, n)) peak = maxOf(peak, samples.optInt(i))
            (peak * 100 / height).coerceIn(0, 100)
        }
    }

    fun findClientId(js: String): String? =
        Regex("""client_id\s*[:=]\s*"([A-Za-z0-9]{32})"""").find(js)?.groupValues?.get(1)

    private fun fetchText(url: String): String {
        val conn = (URL(url).openConnection() as HttpURLConnection).apply {
            connectTimeout = 15_000
            readTimeout = 20_000
            setRequestProperty("User-Agent", UA)
        }
        try {
            if (conn.responseCode != 200) throw IllegalStateException("SoundCloud answered ${conn.responseCode}")
            return conn.inputStream.bufferedReader().readText()
        } finally {
            conn.disconnect()
        }
    }
}
