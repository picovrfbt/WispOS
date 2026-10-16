package dev.carthingfw.nav

import android.content.Context
import android.util.Log
import org.java_websocket.WebSocket
import org.json.JSONObject
import java.io.File
import java.io.IOException
import java.io.RandomAccessFile
import java.net.HttpURLConnection
import java.net.ServerSocket
import java.net.Socket
import java.net.URL
import java.security.SecureRandom
import java.util.concurrent.ConcurrentHashMap
import java.util.concurrent.Executors

/**
 * Wisp updates through the phone. Fetched by the Car Thing itself, an update
 * is tethered traffic, which carriers often slow down, route apart or cut when
 * the phone changes cell; on mobile data that shows as the download timing
 * out. So the Car Thing asks this app instead: the phone downloads the file
 * as its own traffic (resuming where it stopped if the connection drops),
 * checks it against the release's checksum, and hands it over the tether from
 * a small file server only the Car Thing can reach. The Car Thing checks the
 * checksum again before it installs anything.
 */
object UpdateRelay {
    const val PORT = 3680
    private const val TAG = "WispUpdateRelay"
    private const val MAX_BYTES = 200L shl 20
    private const val ATTEMPTS = 8

    private val work = Executors.newSingleThreadExecutor()
    // the path secret: a Car Thing gets it with each ready file
    private val key: String = ByteArray(16).also { SecureRandom().nextBytes(it) }
        .joinToString("") { "%02x".format(it) }
    // files on offer by name, once checked
    private val ready = ConcurrentHashMap<String, File>()

    @Volatile
    private var server: Thread? = null

    private fun dir(ctx: Context) = File(ctx.cacheDir, "wisp-update").apply { mkdirs() }

    /** a fetch request from the Car Thing: download it here, then say where to get it */
    fun handle(ctx: Context, conn: WebSocket, msg: JSONObject) {
        val app = ctx.applicationContext
        val req = msg.optInt("req")
        val name = msg.optString("name")
        val url = msg.optString("url")
        val size = msg.optLong("size")
        val sha = msg.optString("sha256").lowercase()
        fun reply(o: JSONObject) {
            if (conn.isOpen) conn.send(o.put("req", req).toString())
        }
        if (!validName(name) || sha.length != 64 || size !in 1..MAX_BYTES || !allowedUrl(app, url)) {
            reply(JSONObject().put("type", "update_fetch_error").put("error", "bad request"))
            return
        }
        work.execute {
            try {
                ensureServer(app)
                val file = fetch(app, name, url, size, sha) { done, total, speed ->
                    reply(
                        JSONObject().put("type", "update_fetch_progress")
                            .put("done", done).put("total", total).put("speed", speed),
                    )
                }
                ready[name] = file
                reply(
                    JSONObject().put("type", "update_fetch_ready")
                        .put("port", PORT).put("path", "/update/$key/$name"),
                )
            } catch (e: Exception) {
                Log.w(TAG, "fetch of $name failed", e)
                reply(JSONObject().put("type", "update_fetch_error").put("error", e.message ?: "download failed"))
            }
        }
    }

    fun validName(n: String) = n.length in 1..80 && n.all { it.isLetterOrDigit() || it in "._-" } && !n.startsWith(".")

    // only assets of the repo this app holds the token for: the token never goes anywhere else
    internal fun allowedUrl(ctx: Context, url: String): Boolean =
        allowedUrl(Prefs.githubRepo(ctx), url)

    fun allowedUrl(repo: String, url: String): Boolean =
        Regex("""https://api\.github\.com/repos/${Regex.escape(repo)}/releases/assets/\d+""").matches(url)

    private fun fetch(
        ctx: Context, name: String, url: String, size: Long, sha: String,
        progress: (Long, Long, Long) -> Unit,
    ): File {
        val d = dir(ctx)
        val done = File(d, name)
        if (done.length() == size && AppUpdater.sha256(done) == sha) {
            progress(size, size, 0)
            return done
        }
        // anything else in here is an older update's
        d.listFiles()?.forEach { if (it.name != "$name.part") it.delete() }
        val part = File(d, "$name.part")
        if (part.length() > size) part.delete()
        var lastErr: Exception? = null
        var attempt = 0
        while (attempt < ATTEMPTS) {
            val before = part.length()
            try {
                downloadInto(ctx, url, part, size, progress)
                break
            } catch (e: IOException) {
                lastErr = e
                // a dropped connection that got somewhere doesn't count against it
                if (part.length() <= before) attempt++
                Log.i(TAG, "download of $name broke at ${part.length()} of $size, resuming", e)
                Thread.sleep(minOf(2_000L shl minOf(attempt, 4), 30_000L))
            }
        }
        if (part.length() != size) throw lastErr ?: IllegalStateException("download incomplete")
        if (AppUpdater.sha256(part) != sha) {
            part.delete()
            throw IllegalStateException("download failed verification")
        }
        if (!part.renameTo(done)) throw IllegalStateException("couldn't keep the download")
        return done
    }

    // one connection's worth, carrying on from what's already in [part]
    private fun downloadInto(ctx: Context, assetUrl: String, part: File, size: Long, progress: (Long, Long, Long) -> Unit) {
        val from = part.length()
        if (from >= size) return
        // GitHub redirects to signed storage, which must not get the token
        var conn = (URL(assetUrl).openConnection() as HttpURLConnection).apply {
            connectTimeout = 15_000
            readTimeout = 30_000
            instanceFollowRedirects = false
            setRequestProperty("Accept", "application/octet-stream")
            setRequestProperty("X-GitHub-Api-Version", "2022-11-28")
        }
        if (conn.responseCode in 300..399) {
            val next = conn.getHeaderField("Location") ?: throw IOException("bad redirect")
            conn.disconnect()
            conn = (URL(next).openConnection() as HttpURLConnection).apply {
                connectTimeout = 15_000
                readTimeout = 30_000
                if (from > 0) setRequestProperty("Range", "bytes=$from-")
            }
        }
        try {
            val code = conn.responseCode
            val resumed = code == 206
            if (code != 200 && !resumed) {
                if (code == 401 || code == 403 || code == 404) throw IllegalStateException("GitHub answered $code")
                throw IOException("download answered $code")
            }
            RandomAccessFile(part, "rw").use { out ->
                var got = if (resumed) from else 0L
                out.setLength(got)
                out.seek(got)
                val buf = ByteArray(64 * 1024)
                var lastAt = System.nanoTime()
                var lastGot = got
                var speed = 0.0
                conn.inputStream.use { input ->
                    while (true) {
                        val n = input.read(buf)
                        if (n < 0) break
                        out.write(buf, 0, n)
                        got += n
                        if (got > size) throw IllegalStateException("download larger than expected")
                        val now = System.nanoTime()
                        if (now - lastAt >= 500_000_000L) {
                            val inst = (got - lastGot) * 1e9 / (now - lastAt)
                            speed = if (speed == 0.0) inst else speed * 0.7 + inst * 0.3
                            lastAt = now
                            lastGot = got
                            progress(got, size, speed.toLong())
                        }
                    }
                }
                if (got < size) throw IOException("connection ended early")
                progress(got, size, speed.toLong())
            }
        } finally {
            conn.disconnect()
        }
    }

    // the file server: GET /update/<key>/<name>, with Range, to the tether only
    @Synchronized
    private fun ensureServer(ctx: Context) {
        if (server?.isAlive == true) return
        val socket = ServerSocket(PORT).apply { reuseAddress = true }
        server = Thread({
            while (true) {
                val client = try {
                    socket.accept()
                } catch (e: IOException) {
                    break
                }
                Thread({ serve(ctx, client) }, "wisp-update-serve").apply { isDaemon = true }.start()
            }
        }, "wisp-update-relay").apply {
            isDaemon = true
            start()
        }
        Log.i(TAG, "serving updates on :$PORT")
    }

    private fun serve(ctx: Context, s: Socket) {
        s.use { sock ->
            sock.soTimeout = 30_000
            val remote = sock.inetAddress
            val input = sock.getInputStream().bufferedReader(Charsets.ISO_8859_1)
            val out = sock.getOutputStream()
            fun status(code: Int, text: String) {
                out.write("HTTP/1.1 $code $text\r\nContent-Length: 0\r\nConnection: close\r\n\r\n".toByteArray())
            }
            val line = input.readLine() ?: return
            val headers = mutableMapOf<String, String>()
            while (true) {
                val h = input.readLine() ?: break
                if (h.isEmpty()) break
                val i = h.indexOf(':')
                if (i > 0) headers[h.substring(0, i).trim().lowercase()] = h.substring(i + 1).trim()
            }
            if (!ClientFilter.allowed(remote, Prefs.allowLan(ctx))) return status(403, "Forbidden")
            val parts = line.split(' ')
            if (parts.size < 2 || parts[0] != "GET") return status(405, "Method Not Allowed")
            val path = parts[1].split('/')
            // "", "update", key, name
            if (path.size != 4 || path[1] != "update" || path[2] != key) return status(404, "Not Found")
            val file = ready[path[3]]?.takeIf { it.isFile } ?: return status(404, "Not Found")
            val len = file.length()
            val from = parseRange(headers["range"], len)
            if (from == null) {
                out.write("HTTP/1.1 416 Range Not Satisfiable\r\nContent-Range: bytes */$len\r\nContent-Length: 0\r\nConnection: close\r\n\r\n".toByteArray())
                return
            }
            val head = if (headers.containsKey("range")) {
                "HTTP/1.1 206 Partial Content\r\nContent-Range: bytes $from-${len - 1}/$len\r\n"
            } else {
                "HTTP/1.1 200 OK\r\n"
            }
            out.write("${head}Content-Type: application/octet-stream\r\nContent-Length: ${len - from}\r\nConnection: close\r\n\r\n".toByteArray())
            RandomAccessFile(file, "r").use { f ->
                f.seek(from)
                val buf = ByteArray(64 * 1024)
                while (true) {
                    val n = f.read(buf)
                    if (n < 0) break
                    out.write(buf, 0, n)
                }
            }
            out.flush()
        }
    }

    /** "bytes=N-" to N, no header to 0, anything else (or past the end) null */
    fun parseRange(h: String?, len: Long): Long? {
        if (h == null) return 0
        val m = Regex("""bytes=(\d+)-""").matchEntire(h.trim()) ?: return null
        val from = m.groupValues[1].toLongOrNull() ?: return null
        return from.takeIf { it < len }
    }
}
