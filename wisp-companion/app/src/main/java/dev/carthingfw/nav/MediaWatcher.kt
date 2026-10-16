package dev.carthingfw.nav

import android.content.ComponentName
import android.content.Context
import android.graphics.Bitmap
import android.media.AudioManager
import android.media.MediaMetadata
import android.media.session.MediaController
import android.media.session.MediaSessionManager
import android.media.session.PlaybackState
import android.os.Handler
import android.os.Looper
import android.os.SystemClock
import android.util.Base64
import android.util.Log
import org.json.JSONObject
import java.io.ByteArrayOutputStream
import java.security.MessageDigest

/**
 * What this phone is playing outside Spotify (YouTube, a podcast app, anything
 * with a media session), sent to the Car Thing as "media" messages so it can
 * show it, and controlled from there. Spotify is left out: the Car Thing
 * already follows Spotify through Connect.
 *
 * Reading other apps' sessions takes notification access, which the app
 * already has for Google Maps; NavListenerService starts this once it's bound.
 * The wire format matches phoneMediaMessage in wisp-daemon/daemon/phone_media.go.
 */
object MediaWatcher {
    private const val TAG = "CarThingNav"
    private const val ART_PX = 300
    private const val ART_QUALITY = 82
    // between videos, during an ad, or paused a while, an app can drop its
    // session or its title for a moment; the Car Thing keeps the last one up
    // (paused) this long rather than flicking away
    private const val LINGER_MS = 3 * 60_000L

    private val main = Handler(Looper.getMainLooper())
    private var app: Context? = null
    private var manager: MediaSessionManager? = null
    private val callbacks = HashMap<MediaController, MediaController.Callback>()
    private var current: MediaController? = null

    // the cover last sent, so a play/pause doesn't resend it
    private var sentArtHash: String? = null
    private var artJson: String = ""

    // the last thing sent as present, for the linger
    private var lastShown: JSONObject? = null
    private val clearLinger = Runnable {
        lastShown = null
        publish()
    }

    // apps that keep the cover out of their session (YouTube) still put it in
    // their media notification; NavListenerService hands it over
    private val notificationArt = HashMap<String, Bitmap>()

    // encoding is the slow part; a play/pause keeps the same bitmap
    private var encodedFrom: Bitmap? = null
    private var encoded: String? = null

    /** the large icon of an app's media notification, its cover when the session has none */
    fun setNotificationArt(pkg: String, art: Bitmap?) {
        main.post {
            if (art == null) notificationArt.remove(pkg) else notificationArt[pkg] = art
            if (current?.packageName == pkg) publish()
        }
    }

    /** "Title · App" of what's being sent, for the status screen; null when nothing */
    @Volatile
    var summary: String? = null
        private set

    /** the full last message, art included, for a Car Thing that just connected */
    @Volatile
    var snapshot: String? = null
        private set

    private val sessionsChanged = MediaSessionManager.OnActiveSessionsChangedListener { list ->
        main.post { track(list.orEmpty()) }
    }

    fun start(ctx: Context, listener: ComponentName) {
        main.post {
            if (manager != null) return@post
            val m = ctx.getSystemService(MediaSessionManager::class.java) ?: return@post
            app = ctx.applicationContext
            try {
                m.addOnActiveSessionsChangedListener(sessionsChanged, listener, main)
                manager = m
                track(m.getActiveSessions(listener))
            } catch (e: SecurityException) {
                // notification access not granted (yet); the listener rebinds when it is
                Log.w(TAG, "media sessions unavailable", e)
            }
        }
    }

    fun stop() {
        main.post {
            manager?.removeOnActiveSessionsChangedListener(sessionsChanged)
            manager = null
            callbacks.forEach { (c, cb) -> c.unregisterCallback(cb) }
            callbacks.clear()
            current = null
        }
    }

    /** a command from the Car Thing */
    fun control(action: String, positionMs: Long = 0L) {
        main.post {
            val c = current ?: return@post
            val t = c.transportControls
            when (action) {
                "play" -> t.play()
                "pause" -> t.pause()
                "toggle" -> if (isPlaying(c)) t.pause() else t.play()
                "next" -> t.skipToNext()
                "prev" -> t.skipToPrevious()
                "volume_up" -> c.adjustVolume(AudioManager.ADJUST_RAISE, 0)
                "volume_down" -> c.adjustVolume(AudioManager.ADJUST_LOWER, 0)
                "seek" -> if (canSeek(c.playbackState)) t.seekTo(positionMs.coerceAtLeast(0L))
            }
        }
    }

    /** the media id the app gives what it's playing (YouTube Music's is the video id), if [pkg] is on now */
    fun currentMediaId(pkg: String): String? {
        val c = current?.takeIf { it.packageName == pkg } ?: return null
        return c.metadata?.getString(MediaMetadata.METADATA_KEY_MEDIA_ID)?.takeIf { it.isNotBlank() }
    }

    /** after [delayMs], tells [check] the title [pkg] is playing (null if it isn't on) */
    fun checkSoon(pkg: String, delayMs: Long, check: (String?) -> Unit) {
        main.postDelayed({
            val c = callbacks.keys.firstOrNull { it.packageName == pkg && isPlaying(it) }
            check(c?.let { title(it.metadata) })
        }, delayMs)
    }

    /** after [delayMs], presses play in [pkg]'s session if it isn't playing: for apps that open on a song without starting it */
    fun playSoon(pkg: String, delayMs: Long) {
        main.postDelayed({
            val c = callbacks.keys.firstOrNull { it.packageName == pkg } ?: return@postDelayed
            if (!isPlaying(c)) c.transportControls.play()
        }, delayMs)
    }

    // follow every session, so whichever one starts playing takes over
    private fun track(sessions: List<MediaController>) {
        // Spotify reaches the Car Thing its own way, and Drive Mode is this app's own
        // session (the Car Thing shows it on its Drive Mode screen)
        val wanted = sessions.filter { it.packageName != SpotifyWaker.SPOTIFY && it.packageName != DriveMedia.OWN_PACKAGE }
        val gone = callbacks.keys.filter { k -> wanted.none { it.sessionToken == k.sessionToken } }
        gone.forEach { c -> callbacks.remove(c)?.let(c::unregisterCallback) }
        for (c in wanted) {
            if (callbacks.keys.any { it.sessionToken == c.sessionToken }) continue
            val cb = object : MediaController.Callback() {
                override fun onPlaybackStateChanged(state: PlaybackState?) = publish()
                override fun onMetadataChanged(metadata: MediaMetadata?) = publish()
                override fun onSessionDestroyed() {
                    main.post { track(callbacks.keys.filter { it !== c }) }
                }
            }
            c.registerCallback(cb, main)
            callbacks[c] = cb
        }
        publish()
    }

    private fun canSeek(state: PlaybackState?) =
        state != null && state.actions and PlaybackState.ACTION_SEEK_TO != 0L

    private fun isPlaying(c: MediaController) = c.playbackState?.state == PlaybackState.STATE_PLAYING

    private fun hasTitle(c: MediaController) = !title(c.metadata).isNullOrBlank()

    // a playing session wins; otherwise stay on the one we had, then the system's top pick
    private fun pick(): MediaController? {
        val all = callbacks.keys.filter(::hasTitle)
        return all.firstOrNull(::isPlaying)
            ?: all.firstOrNull { it.sessionToken == current?.sessionToken }
            ?: all.firstOrNull()
    }

    private fun publish() {
        val c = pick()
        current = c
        if (c == null) {
            // keep the last one up, paused, for a while before letting it go
            val last = lastShown
            if (last != null) {
                if (last.optBoolean("playing")) {
                    last.put("playing", false)
                    NavStore.publish(last.toString())
                    snapshot = JSONObject(last.toString()).put("art", artJson).toString()
                }
                main.removeCallbacks(clearLinger)
                main.postDelayed(clearLinger, LINGER_MS)
                return
            }
        } else {
            main.removeCallbacks(clearLinger)
        }
        val msg = JSONObject().put("type", "media")
        if (c == null) {
            msg.put("present", false)
            sentArtHash = null
            artJson = ""
        } else {
            val md = c.metadata
            val state = c.playbackState
            // an untagged file: its name, read as "Artist - Title"
            val named = SongName.of(title(md).orEmpty(), artist(md).orEmpty())
            msg.put("present", true)
                .put("app", c.packageName)
                .put("app_name", appName(c.packageName))
                .put("title", named.title)
                .put("artist", named.artist)
                .put("album", md?.getString(MediaMetadata.METADATA_KEY_ALBUM).orEmpty())
                .put("playing", isPlaying(c))
                .put("position_ms", position(state))
                .put("duration_ms", md?.getLong(MediaMetadata.METADATA_KEY_DURATION) ?: 0L)
                .put("can_seek", canSeek(state))
            val art = encodeArt(md, c.packageName) ?: foundCover(named)
            val hash = art?.let(::sha1) ?: ""
            if (hash != sentArtHash) {
                sentArtHash = hash
                artJson = art ?: ""
                msg.put("art", artJson)
            }
        }
        summary = c?.let { "${title(it.metadata).orEmpty()} · ${appName(it.packageName)}" }
        lastShown = if (c == null) null else JSONObject(msg.toString()).apply { remove("art") }
        val out = msg.toString()
        // a late joiner needs the cover even if this message didn't carry it
        snapshot = if (c == null) out else JSONObject(out).put("art", artJson).toString()
        NavStore.publish(out)
    }

    private fun title(md: MediaMetadata?): String? =
        md?.getString(MediaMetadata.METADATA_KEY_TITLE)
            ?: md?.getString(MediaMetadata.METADATA_KEY_DISPLAY_TITLE)

    private fun artist(md: MediaMetadata?): String? =
        listOf(
            MediaMetadata.METADATA_KEY_ARTIST,
            MediaMetadata.METADATA_KEY_ALBUM_ARTIST,
            MediaMetadata.METADATA_KEY_DISPLAY_SUBTITLE,
            MediaMetadata.METADATA_KEY_AUTHOR,
        ).firstNotNullOfOrNull { k -> md?.getString(k)?.takeIf { it.isNotBlank() } }

    private fun position(state: PlaybackState?): Long {
        if (state == null || state.position < 0) return 0
        if (state.state != PlaybackState.STATE_PLAYING) return state.position
        val since = SystemClock.elapsedRealtime() - state.lastPositionUpdateTime
        return state.position + (since * state.playbackSpeed).toLong()
    }

    private fun appName(pkg: String): String {
        val ctx = app ?: return pkg
        return try {
            val pm = ctx.packageManager
            pm.getApplicationLabel(pm.getApplicationInfo(pkg, 0)).toString()
        } catch (e: Exception) {
            KNOWN_APPS[pkg] ?: pkg.substringAfterLast('.').replaceFirstChar { it.uppercase() }
        }
    }

    // covers some apps (SoundCloud) give only as a link: fetched once each, off the main thread
    private val linkedArt = HashMap<String, Bitmap>()
    private val fetchingArt = HashSet<String>()
    private val artFetcher = java.util.concurrent.Executors.newSingleThreadExecutor()

    private fun artUri(md: MediaMetadata?): String? = listOf(
        MediaMetadata.METADATA_KEY_ART_URI,
        MediaMetadata.METADATA_KEY_ALBUM_ART_URI,
        MediaMetadata.METADATA_KEY_DISPLAY_ICON_URI,
    ).firstNotNullOfOrNull { k -> md?.getString(k)?.takeIf { it.isNotBlank() } }

    private fun linkedCover(md: MediaMetadata?): Bitmap? {
        val uri = artUri(md) ?: return null
        linkedArt[uri]?.let { return it }
        if (fetchingArt.add(uri)) {
            val ctx = app
            artFetcher.execute {
                val bmp = try {
                    loadArt(ctx, uri)
                } catch (e: Exception) {
                    Log.w(TAG, "cover at $uri unreadable", e)
                    null
                }
                main.post {
                    fetchingArt.remove(uri)
                    if (bmp != null) {
                        if (linkedArt.size > 8) linkedArt.clear()
                        linkedArt[uri] = bmp
                        publish()
                    }
                }
            }
        }
        return null
    }

    private fun loadArt(ctx: Context?, uri: String): Bitmap? {
        val opts = android.graphics.BitmapFactory.Options().apply { inSampleSize = 1 }
        return when {
            uri.startsWith("https://") || uri.startsWith("http://") -> {
                val conn = (java.net.URL(uri).openConnection() as java.net.HttpURLConnection).apply {
                    connectTimeout = 10_000
                    readTimeout = 15_000
                }
                try {
                    if (conn.responseCode != 200) null
                    else conn.inputStream.use { android.graphics.BitmapFactory.decodeStream(it, null, opts) }
                } finally {
                    conn.disconnect()
                }
            }
            (uri.startsWith("content://") || uri.startsWith("android.resource://")) && ctx != null ->
                ctx.contentResolver.openInputStream(android.net.Uri.parse(uri))?.use {
                    android.graphics.BitmapFactory.decodeStream(it, null, opts)
                }
            else -> null
        }
    }

    // a cover looked up by artist and title, for a file that carries none
    private val foundArt = HashMap<String, Bitmap>()
    private val missingArt = HashSet<String>()

    private fun foundCover(named: SongName.Named): String? {
        if (named.artist.isBlank() || named.title.isBlank()) return null
        val key = "${named.artist}|${named.title}".lowercase()
        foundArt[key]?.let { return encodeBitmap(it) }
        if (key in missingArt || !fetchingArt.add(key)) return null
        artFetcher.execute {
            val url = try {
                CoverSearch.find(named.artist, named.title)
            } catch (e: Exception) {
                null
            }
            val bmp = url?.let {
                try {
                    loadArt(app, it)
                } catch (e: Exception) {
                    null
                }
            }
            main.post {
                fetchingArt.remove(key)
                if (bmp == null) {
                    missingArt += key
                } else {
                    if (foundArt.size > 16) foundArt.clear()
                    foundArt[key] = bmp
                    publish()
                }
            }
        }
        return null
    }

    private fun encodeArt(md: MediaMetadata?, pkg: String): String? {
        val bmp = md?.getBitmap(MediaMetadata.METADATA_KEY_ART)
            ?: md?.getBitmap(MediaMetadata.METADATA_KEY_ALBUM_ART)
            ?: md?.getBitmap(MediaMetadata.METADATA_KEY_DISPLAY_ICON)
            ?: notificationArt[pkg]
            ?: linkedCover(md)
            ?: return null
        return encodeBitmap(bmp)
    }

    private fun encodeBitmap(bmp: Bitmap): String? {
        if (bmp === encodedFrom) return encoded
        encodedFrom = bmp
        encoded = try {
            // a centered square, like a cover; video thumbnails are 16:9
            val side = minOf(bmp.width, bmp.height)
            val square = Bitmap.createBitmap(bmp, (bmp.width - side) / 2, (bmp.height - side) / 2, side, side)
            val scaled = if (side > ART_PX) Bitmap.createScaledBitmap(square, ART_PX, ART_PX, true) else square
            val out = ByteArrayOutputStream()
            scaled.compress(Bitmap.CompressFormat.JPEG, ART_QUALITY, out)
            "data:image/jpeg;base64," + Base64.encodeToString(out.toByteArray(), Base64.NO_WRAP)
        } catch (e: Exception) {
            null
        }
        return encoded
    }

    private fun sha1(s: String): String =
        MessageDigest.getInstance("SHA-1").digest(s.toByteArray()).joinToString("") { "%02x".format(it) }

    // labels for apps Android 11+ package visibility may hide from us
    private val KNOWN_APPS = mapOf(
        "com.google.android.youtube" to "YouTube",
        "com.google.android.apps.youtube.music" to "YouTube Music",
        "app.revanced.android.youtube" to "YouTube",
        "com.google.android.apps.podcasts" to "Google Podcasts",
        "au.com.shiftyjelly.pocketcasts" to "Pocket Casts",
        "com.amazon.mp3" to "Amazon Music",
        "com.apple.android.music" to "Apple Music",
        "deezer.android.app" to "Deezer",
        "com.soundcloud.android" to "SoundCloud",
        "com.audible.application" to "Audible",
        "com.pandora.android" to "Pandora",
        "com.google.android.apps.youtube.kids" to "YouTube Kids",
    )
}
