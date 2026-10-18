package dev.carthingfw.nav

import android.app.PendingIntent
import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import android.content.pm.PackageInstaller
import android.os.Handler
import android.os.Looper
import android.util.Log
import org.json.JSONObject
import java.io.File
import java.net.HttpURLConnection
import java.net.URL
import java.security.MessageDigest

/**
 * The companion app updating itself from the same GitHub releases Wisp uses:
 * a release carries wisp-companion-vX.Y.Z.apk next to the Car Thing's files.
 * The download goes through the token saved for Wisp updates, and Android asks
 * before it installs anything.
 */
object AppUpdater {
    data class Offer(val version: String, val assetUrl: String, val size: Long, val sha256: String?)

    sealed class State {
        object Idle : State()
        object Checking : State()
        object UpToDate : State()
        data class Available(val offer: Offer) : State()
        data class Downloading(val percent: Int) : State()
        object Installing : State()
        data class Failed(val why: String) : State()
    }

    @Volatile
    var state: State = State.Idle
        private set

    private val main by lazy { Handler(Looper.getMainLooper()) }
    private val ASSET = Regex("""wisp-companion-v?(\d+(?:\.\d+)*)\.apk""")

    fun installedVersion(ctx: Context): String =
        ctx.packageManager.getPackageInfo(ctx.packageName, 0).versionName ?: "0"

    // what a failure says in the app: what it means, not the exception
    private fun failText(e: Exception): String = when {
        e is java.io.IOException && e !is java.io.FileNotFoundException ->
            "Couldn't reach the internet. Try again"
        e.message?.contains("verification") == true -> "The download was damaged. Try again"
        else -> e.message ?: "Something went wrong. Try again"
    }

    /** looks for a newer companion in the latest release; [done] runs on the main thread */
    fun check(ctx: Context, done: () -> Unit = {}) {
        if (state is State.Checking || state is State.Downloading || state is State.Installing) return
        state = State.Checking
        val app = ctx.applicationContext
        Thread {
            state = try {
                val offer = latestOffer(app)
                if (offer != null && newer(offer.version, installedVersion(app))) State.Available(offer) else State.UpToDate
            } catch (e: Exception) {
                Log.w(TAG, "update check failed", e)
                State.Failed(failText(e))
            }
            main.post(done)
        }.start()
    }

    /** downloads the offered APK, checks it, and hands it to Android's installer */
    fun install(ctx: Context, offer: Offer, progress: () -> Unit) {
        if (state is State.Downloading || state is State.Installing) return
        val app = ctx.applicationContext
        state = State.Downloading(0)
        Thread {
            try {
                val apk = File(app.cacheDir, "wisp-companion-update.apk")
                download(app, offer, apk) { pct ->
                    state = State.Downloading(pct)
                    main.post(progress)
                }
                if (offer.sha256 != null && sha256(apk) != offer.sha256) {
                    apk.delete()
                    throw IllegalStateException("download failed verification")
                }
                state = State.Installing
                main.post(progress)
                startInstall(app, apk)
            } catch (e: Exception) {
                Log.w(TAG, "update install failed", e)
                state = State.Failed(failText(e))
                main.post(progress)
            }
        }.start()
    }

    // the newest companion in the recent releases: not every release carries one,
    // so the latest release alone can miss it
    private fun latestOffer(ctx: Context): Offer? = newestOffer(releases(ctx))

    /** the newest asset whose name matches [pattern] (first group: its version) in the recent releases */
    internal fun newestAsset(ctx: Context, pattern: Regex): Offer? = newestOffer(releases(ctx), pattern)

    private fun releases(ctx: Context): org.json.JSONArray {
        val conn = open(
            ctx,
            "https://api.github.com/repos/${Prefs.githubRepo(ctx)}/releases?per_page=$RELEASES_LOOKED_AT",
            "application/vnd.github+json",
        )
        try {
            when (conn.responseCode) {
                200 -> {}
                404 -> throw IllegalStateException("no releases found")
                403, 429 -> throw IllegalStateException("GitHub is busy; try again in a while")
                else -> throw IllegalStateException("GitHub answered ${conn.responseCode}")
            }
            return org.json.JSONArray(conn.inputStream.bufferedReader().readText())
        } finally {
            conn.disconnect()
        }
    }

    /** the highest-versioned companion APK across a releases listing, drafts and pre-releases aside */
    fun newestOffer(releases: org.json.JSONArray, pattern: Regex = ASSET): Offer? {
        var best: Offer? = null
        for (r in 0 until releases.length()) {
            val rel = releases.getJSONObject(r)
            if (rel.optBoolean("draft") || rel.optBoolean("prerelease")) continue
            val assets = rel.optJSONArray("assets") ?: continue
            for (i in 0 until assets.length()) {
                val a = assets.getJSONObject(i)
                val m = pattern.matchEntire(a.optString("name")) ?: continue
                val version = m.groupValues[1]
                if (best != null && !newer(version, best.version)) continue
                val digest = a.optString("digest").takeIf { it.startsWith("sha256:") }?.removePrefix("sha256:")
                best = Offer(version, a.getString("url"), a.optLong("size"), digest)
            }
        }
        return best
    }

    internal fun download(ctx: Context, offer: Offer, to: File, onPercent: (Int) -> Unit) {
        // GitHub answers with a redirect to signed storage, which must not get the token
        var conn = open(ctx, offer.assetUrl, "application/octet-stream", followRedirects = false)
        if (conn.responseCode in 300..399) {
            val next = conn.getHeaderField("Location") ?: throw IllegalStateException("bad redirect")
            conn.disconnect()
            conn = (URL(next).openConnection() as HttpURLConnection).apply {
                connectTimeout = 15_000
                readTimeout = 30_000
            }
        }
        try {
            if (conn.responseCode != 200) throw IllegalStateException("download answered ${conn.responseCode}")
            val total = conn.contentLengthLong.takeIf { it > 0 } ?: offer.size
            var got = 0L
            var last = -1
            conn.inputStream.use { input ->
                to.outputStream().use { out ->
                    val buf = ByteArray(64 * 1024)
                    while (true) {
                        val n = input.read(buf)
                        if (n < 0) break
                        out.write(buf, 0, n)
                        got += n
                        val pct = if (total > 0) (got * 100 / total).toInt() else 0
                        if (pct != last) {
                            last = pct
                            onPercent(pct)
                        }
                    }
                }
            }
        } finally {
            conn.disconnect()
        }
    }

    private fun startInstall(ctx: Context, apk: File) {
        val installer = ctx.packageManager.packageInstaller
        val params = PackageInstaller.SessionParams(PackageInstaller.SessionParams.MODE_FULL_INSTALL).apply {
            setAppPackageName(ctx.packageName)
        }
        val id = installer.createSession(params)
        installer.openSession(id).use { session ->
            session.openWrite("base.apk", 0, apk.length()).use { out ->
                apk.inputStream().use { it.copyTo(out) }
                session.fsync(out)
            }
            val intent = Intent(ctx, InstallResultReceiver::class.java)
            val pending = PendingIntent.getBroadcast(
                ctx, id, intent, PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_MUTABLE,
            )
            session.commit(pending.intentSender)
        }
        apk.delete()
    }

    internal fun finished(ok: Boolean, why: String?) {
        state = if (ok) State.UpToDate else State.Failed(why ?: "install was cancelled")
    }

    private fun open(ctx: Context, url: String, accept: String, followRedirects: Boolean = true): HttpURLConnection =
        (URL(url).openConnection() as HttpURLConnection).apply {
            connectTimeout = 15_000
            readTimeout = 30_000
            instanceFollowRedirects = followRedirects
            setRequestProperty("Accept", accept)
            setRequestProperty("X-GitHub-Api-Version", "2022-11-28")
        }

    internal fun sha256(f: File): String {
        val md = MessageDigest.getInstance("SHA-256")
        f.inputStream().use { input ->
            val buf = ByteArray(64 * 1024)
            while (true) {
                val n = input.read(buf)
                if (n < 0) break
                md.update(buf, 0, n)
            }
        }
        return md.digest().joinToString("") { "%02x".format(it) }
    }

    /** "0.4.0" > "0.3.10"? compared number by number */
    fun newer(candidate: String, current: String): Boolean {
        val a = candidate.removePrefix("v").split('.').map { it.toIntOrNull() ?: 0 }
        val b = current.removePrefix("v").split('.').map { it.toIntOrNull() ?: 0 }
        for (i in 0 until maxOf(a.size, b.size)) {
            val x = a.getOrElse(i) { 0 }
            val y = b.getOrElse(i) { 0 }
            if (x != y) return x > y
        }
        return false
    }

    private const val TAG = "WispUpdate"
    private const val RELEASES_LOOKED_AT = 15
}

/** Android's answer to an install: ask the user, or report how it went */
class InstallResultReceiver : BroadcastReceiver() {
    override fun onReceive(ctx: Context, intent: Intent) {
        when (val status = intent.getIntExtra(PackageInstaller.EXTRA_STATUS, PackageInstaller.STATUS_FAILURE)) {
            PackageInstaller.STATUS_PENDING_USER_ACTION -> {
                @Suppress("DEPRECATION")
                val confirm = intent.getParcelableExtra<Intent>(Intent.EXTRA_INTENT) ?: return
                ctx.startActivity(confirm.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK))
            }
            PackageInstaller.STATUS_SUCCESS -> AppUpdater.finished(true, null)
            else -> AppUpdater.finished(
                false,
                intent.getStringExtra(PackageInstaller.EXTRA_STATUS_MESSAGE) ?: "status $status",
            )
        }
    }
}
