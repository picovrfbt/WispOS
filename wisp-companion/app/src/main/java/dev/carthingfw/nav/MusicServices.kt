package dev.carthingfw.nav

import android.content.ComponentName
import android.content.Context
import android.content.Intent
import android.media.browse.MediaBrowser
import android.os.Handler
import android.os.Looper
import android.service.media.MediaBrowserService
import org.json.JSONArray
import org.json.JSONObject

/**
 * The music apps on this phone that Wisp could show beside Spotify (YouTube
 * Music, SoundCloud, ...). Each one that offers its library to other apps
 * (MediaBrowserService, the way Android Auto browses) is asked for it here.
 * Some share it, some only allow playback control, some refuse outright;
 * this finds out which, without changing anything in those apps.
 */
object MusicServices {
    enum class Access { CHECKING, LIBRARY, PLAYBACK_ONLY, REFUSED }

    data class Service(
        val pkg: String,
        val label: String,
        val component: ComponentName,
        var access: Access = Access.CHECKING,
        var sections: Int = 0,
    )

    // the ones Wisp knows by name; any other music app found is listed too
    private val KNOWN = mapOf(
        "com.google.android.apps.youtube.music" to "YouTube Music",
        "com.soundcloud.android" to "SoundCloud",
        "deezer.android.app" to "Deezer",
        "com.amazon.mp3" to "Amazon Music",
        "com.pandora.android" to "Pandora",
        "com.aspiro.tidal" to "TIDAL",
        "com.apple.android.music" to "Apple Music",
    )
    private const val TIMEOUT_MS = 8000L

    // music apps by name, including rebuilt ones like Morphe's or ReVanced's YouTube
    // Music, which keep the official package name's ending
    private val MUSIC_NAMES = listOf(
        "youtube.music", "android.youtube", "soundcloud", "deezer", "tidal", "pandora",
        "amazon.mp3", "apple.android.music", "bandcamp", "audiomack", "qobuz", "napster",
        "anghami", "jiosaavn", "gaana", "boomplay", "iheartradio", "tunein", "plexamp",
        "poweramp", "musicolet", "retro", "vanced",
    )

    // things that offer "media" but aren't music apps: assistants, Bluetooth, the system
    private val NOT_MUSIC = listOf(
        "bluetooth", "bixby", "googlequicksearchbox", "assistant", "android.systemui",
        "android.car", "telecom", "dialer", "voicesearch", "gearoplugin", "wearable",
    )

    private fun isKnown(pkg: String) = pkg in KNOWN || "youtube.music" in pkg

    /** a music app, by its name or by Android's audio category, and not a system piece */
    fun isMusicApp(pkg: String, info: android.content.pm.ApplicationInfo?): Boolean {
        val p = pkg.lowercase()
        if (NOT_MUSIC.any { it in p }) return false
        if (isKnown(pkg) || MUSIC_NAMES.any { it in p }) return true
        return info?.category == android.content.pm.ApplicationInfo.CATEGORY_AUDIO
    }

    /** YouTube Music under any shell still reads as YouTube Music */
    fun labelFor(pkg: String, appLabel: String): String = when {
        pkg == "com.google.android.apps.youtube.music" -> "YouTube Music"
        "youtube.music" in pkg -> if (appLabel.contains("music", ignoreCase = true) && appLabel != "YouTube Music") {
            "YouTube Music ($appLabel)"
        } else "YouTube Music"
        pkg == "com.google.android.youtube" -> "YouTube"
        else -> KNOWN[pkg] ?: appLabel
    }

    @Volatile
    var services: List<Service> = emptyList()
        private set

    private val main by lazy { Handler(Looper.getMainLooper()) }

    /** every installed music app that offers a media library, Spotify (built in) aside */
    fun discover(ctx: Context): List<Service> {
        val pm = ctx.packageManager
        val found = pm.queryIntentServices(Intent(MediaBrowserService.SERVICE_INTERFACE), 0)
            .mapNotNull { it.serviceInfo }
            .filter { it.packageName != SpotifyWaker.SPOTIFY && it.packageName != ctx.packageName }
            .filter { isMusicApp(it.packageName, it.applicationInfo) }
            .distinctBy { it.packageName }
            .map {
                Service(
                    pkg = it.packageName,
                    label = labelFor(it.packageName, pm.getApplicationLabel(it.applicationInfo).toString()),
                    component = ComponentName(it.packageName, it.name),
                )
            }
            .sortedWith(compareBy({ !isKnown(it.pkg) }, { it.label }))
        services = found
        return found
    }

    /** asks each service for its library, then calls [changed] on the main thread as answers come */
    fun checkAll(ctx: Context, changed: () -> Unit) {
        val app = ctx.applicationContext
        appCtx = app
        main.post {
            discover(app).forEach { svc -> probe(app, svc) { changed(); publish() } }
            changed()
        }
    }

    // connect, look at the top of its library, and let go
    private fun probe(ctx: Context, svc: Service, done: () -> Unit) {
        var browser: MediaBrowser? = null
        var finished = false
        fun finish(access: Access, sections: Int = 0) {
            if (finished) return
            finished = true
            svc.access = access
            svc.sections = sections
            try {
                browser?.disconnect()
            } catch (e: Exception) {
                // already gone
            }
            done()
        }
        browser = MediaBrowser(ctx, svc.component, object : MediaBrowser.ConnectionCallback() {
            override fun onConnected() {
                val b = browser ?: return finish(Access.PLAYBACK_ONLY)
                val root = b.root
                b.subscribe(root, object : MediaBrowser.SubscriptionCallback() {
                    override fun onChildrenLoaded(parentId: String, children: MutableList<MediaBrowser.MediaItem>) {
                        finish(if (children.isEmpty()) Access.PLAYBACK_ONLY else Access.LIBRARY, children.size)
                    }

                    override fun onError(parentId: String) = finish(Access.PLAYBACK_ONLY)
                })
            }

            override fun onConnectionFailed() = finish(Access.REFUSED)
            override fun onConnectionSuspended() = finish(Access.REFUSED)
        }, null)
        try {
            browser.connect()
        } catch (e: Exception) {
            finish(Access.REFUSED)
        }
        main.postDelayed({ finish(Access.PLAYBACK_ONLY) }, TIMEOUT_MS)
    }

    /** which of them Wisp should offer (Settings in this app); YouTube Music and SoundCloud start on */
    fun enabled(ctx: Context, pkg: String): Boolean = Prefs.musicServiceEnabled(ctx, pkg, defaultOn(pkg))

    fun setEnabled(ctx: Context, pkg: String, on: Boolean) {
        Prefs.setMusicServiceEnabled(ctx, pkg, on)
        publish(ctx)
    }

    private val DEFAULT_ON = setOf("com.google.android.apps.youtube.music", "com.soundcloud.android")

    /** YouTube Music (any build) and SoundCloud start switched on */
    private fun defaultOn(pkg: String) = pkg in DEFAULT_ON || "youtube.music" in pkg

    @Volatile
    private var appCtx: Context? = null

    private fun publish(ctx: Context? = appCtx) {
        val c = ctx ?: return
        appCtx = c.applicationContext
        NavStore.publish(json(c))
    }

    /** sent to a Car Thing: what's on this phone, what's switched on, and what each one shares */
    fun json(ctx: Context): String {
        appCtx = ctx.applicationContext
        val arr = JSONArray()
        services.forEach { s ->
            arr.put(
                JSONObject().put("id", s.pkg).put("name", s.label)
                    .put("enabled", enabled(ctx, s.pkg))
                    .put("access", s.access.name.lowercase()),
            )
        }
        return JSONObject().put("type", "music_services").put("services", arr).toString()
    }
}
