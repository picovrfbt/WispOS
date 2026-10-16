package dev.carthingfw.nav

import android.content.Context
import android.util.Log
import org.java_websocket.WebSocket
import org.json.JSONArray
import org.json.JSONObject
import java.util.concurrent.Executors

/**
 * The Car Thing's view of the other music services (YouTube Music,
 * SoundCloud): whether each is switched on and signed in, a page of its
 * library or a search when asked, playing something from it, and the song on
 * now (up next, liked). Only names, covers and ids cross; the sign-ins stay here.
 */
object YtMusicLink {
    private const val TAG = "WispServices"
    private val work = Executors.newFixedThreadPool(2)

    /** what the Car Thing's Home can offer beside Spotify */
    fun statusJson(ctx: Context): String {
        val services = JSONArray()
        MusicLibrary.ALL.forEach { lib ->
            val app = MusicServices.services.firstOrNull { lib.owns(it.pkg) }
            val installed = app != null || (lib === SoundCloud && SoundCloud.installed(ctx))
            if (!installed && !lib.signedIn(ctx)) return@forEach
            services.put(
                JSONObject().put("id", lib.id).put("name", lib.name)
                    .put("enabled", app == null || MusicServices.enabled(ctx, app.pkg))
                    .put("signed_in", lib.signedIn(ctx))
                    .put("sections", JSONArray().apply {
                        lib.sections.forEach { put(JSONObject().put("id", it.id).put("name", it.name)) }
                    }),
            )
        }
        return JSONObject().put("type", "svc_status").put("services", services).toString()
    }

    fun signedInChanged(ctx: Context) = NavStore.publish(statusJson(ctx))

    /** "search:<kind>:<words>" as a browse id: a search rather than a page */
    fun parseSearch(id: String): Pair<String, String>? {
        if (!id.startsWith("search:")) return null
        val rest = id.removePrefix("search:")
        val kind = rest.substringBefore(':', "")
        val query = rest.substringAfter(':', "").trim()
        if (kind !in setOf("song", "album", "artist", "playlist") || query.isEmpty()) return null
        return kind to query
    }

    /** one request from the Car Thing; answers go back on the same connection */
    fun handle(ctx: Context, conn: WebSocket, msg: JSONObject) {
        val app = ctx.applicationContext
        val type = msg.optString("type")
        val lib = MusicLibrary.byId(msg.optString("service"))
        val req = msg.optInt("req")
        fun answer(fill: (JSONObject) -> Unit) {
            val reply = JSONObject().put("type", "svc_items").put("req", req)
            try {
                if (lib == null) throw IllegalStateException("unknown service")
                fill(reply)
            } catch (e: Exception) {
                Log.w(TAG, "$type for ${msg.optString("service")} failed", e)
                reply.put("error", e.message ?: "couldn't do that")
            }
            if (conn.isOpen) conn.send(reply.toString())
        }
        fun items(list: List<YtMusic.Item>) = JSONArray().apply { list.take(200).forEach { put(it.json()) } }
        when (type) {
            "svc_browse" -> work.execute {
                answer { reply ->
                    val id = msg.optString("id")
                    val search = parseSearch(id)
                    reply.put("items", items(if (search != null) lib!!.search(app, search.second, search.first) else lib!!.browse(app, id)))
                }
            }
            "svc_play" -> work.execute {
                try {
                    lib?.play(
                        app,
                        msg.optString("playlist").ifEmpty { null },
                        msg.optString("video").ifEmpty { null },
                        msg.optString("title").ifEmpty { null },
                    )
                } catch (e: Exception) {
                    Log.w(TAG, "play failed", e)
                }
            }
            // the song on now in the service's app: up next, and whether it's liked
            "svc_now" -> work.execute {
                answer { reply ->
                    val pkg = msg.optString("app")
                    val now = lib!!.now(
                        app, msg.optString("title"), msg.optString("artist"),
                        pkg.takeIf { it.isNotEmpty() }?.let(MediaWatcher::currentMediaId),
                    )
                    reply.put("items", items(now.upNext))
                    now.current?.let { reply.put("current", it) }
                    now.liked?.let { reply.put("liked", it) }
                    now.waveform?.let { w -> reply.put("waveform", JSONArray().apply { w.forEach { put(it) } }) }
                    now.image?.let { reply.put("image", it) }
                }
            }
            // "add this to my road trip playlist" by voice on the Car Thing
            "svc_add" -> work.execute {
                answer { reply ->
                    val pkg = msg.optString("app")
                    val added = lib!!.addToPlaylist(
                        app, msg.optString("title"), msg.optString("artist"),
                        pkg.takeIf { it.isNotEmpty() }?.let(MediaWatcher::currentMediaId),
                        msg.optString("playlist"),
                    )
                    reply.put("items", JSONArray()).put("current", added)
                }
            }
            "svc_like" -> work.execute {
                answer { reply ->
                    val like = msg.optBoolean("like", true)
                    lib!!.like(app, msg.optString("current"), like)
                    reply.put("items", JSONArray()).put("liked", like)
                }
            }
        }
    }
}
