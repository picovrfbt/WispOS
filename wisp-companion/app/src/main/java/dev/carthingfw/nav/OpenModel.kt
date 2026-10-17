package dev.carthingfw.nav

import android.content.Context
import android.util.Log
import com.google.ai.edge.litertlm.Backend
import com.google.ai.edge.litertlm.ConversationConfig
import com.google.ai.edge.litertlm.Engine
import com.google.ai.edge.litertlm.EngineConfig
import com.google.ai.edge.litertlm.SamplerConfig
import java.io.File
import java.net.HttpURLConnection
import java.net.URL
import java.security.MessageDigest

/**
 * The language model Wisp downloads for phones without Gemini Nano: Qwen3 0.6B
 * (Apache-2.0, from the LiteRT community on Hugging Face), run with Google's
 * LiteRT-LM. About 345 MB, so it's only ever downloaded when you say so in the
 * app, after a warning about the size. It loads when the Car Thing first asks
 * something and lets go of the phone's memory after a few quiet minutes.
 */
object OpenModel {
    private const val TAG = "WispOpenModel"
    const val NAME = "Qwen3 0.6B"
    const val SIZE_BYTES = 344_671_744L
    private const val SHA256 = "03e7da1eb1108b50dffaa9bb52cc7bcbad2eb0c66ca990267f480c1e545d2856"
    private const val URL_ = "https://huggingface.co/litert-community/Qwen3-0.6B/resolve/main/Qwen3-0.6B_dynamic_wi4b32_afp32.litertlm"
    // let go of the model when the Car Thing hasn't asked for this long
    private const val IDLE_MS = 5 * 60_000L

    private fun file(ctx: Context) = File(ctx.filesDir, "think/qwen3-0.6b.litertlm")

    fun downloaded(ctx: Context) = file(ctx).let { it.exists() && it.length() == SIZE_BYTES }

    fun sizeMb() = "${(SIZE_BYTES + 500_000) / 1_000_000} MB"

    @Volatile var progress = -1
        private set

    /** downloads and checks the model; false if it failed (and nothing's kept) */
    fun download(ctx: Context, onPercent: (Int) -> Unit): Boolean {
        val dest = file(ctx)
        dest.parentFile?.mkdirs()
        val part = File(dest.path + ".part")
        try {
            var conn = URL(URL_).openConnection() as HttpURLConnection
            conn.connectTimeout = 15_000
            conn.readTimeout = 30_000
            if (conn.responseCode != 200) throw IllegalStateException("the download answered ${conn.responseCode}")
            val digest = MessageDigest.getInstance("SHA-256")
            var got = 0L
            var last = -1
            conn.inputStream.use { input ->
                part.outputStream().use { out ->
                    val buf = ByteArray(256 * 1024)
                    while (true) {
                        val n = input.read(buf)
                        if (n < 0) break
                        out.write(buf, 0, n)
                        digest.update(buf, 0, n)
                        got += n
                        val pct = (got * 100 / SIZE_BYTES).toInt().coerceIn(0, 100)
                        if (pct != last) {
                            last = pct
                            progress = pct
                            onPercent(pct)
                        }
                    }
                }
            }
            conn.disconnect()
            val sum = digest.digest().joinToString("") { "%02x".format(it) }
            if (got != SIZE_BYTES || sum != SHA256) throw IllegalStateException("the download didn't check out")
            if (!part.renameTo(dest)) throw IllegalStateException("couldn't keep the download")
            return true
        } catch (e: Exception) {
            Log.w(TAG, "model download failed", e)
            part.delete()
            return false
        } finally {
            progress = -1
        }
    }

    fun delete(ctx: Context) {
        unload()
        file(ctx).delete()
    }

    private var engine: Engine? = null
    private var lastUse = 0L
    private val lock = Any()

    /** one answer to [prompt]; loads the model first if it isn't loaded */
    fun generate(ctx: Context, prompt: String): String = synchronized(lock) {
        val e = engine ?: load(ctx).also { engine = it }
        lastUse = System.currentTimeMillis()
        scheduleUnload()
        val config = ConversationConfig(samplerConfig = SamplerConfig(topK = 1, topP = 1.0, temperature = 0.1))
        e.createConversation(config).use { c -> c.sendMessage(prompt).toString() }
    }

    private fun load(ctx: Context): Engine {
        val path = file(ctx).path
        // the GPU where the phone allows it, else the CPU
        for (backend in listOf<Backend>(Backend.GPU(), Backend.CPU())) {
            try {
                val e = Engine(EngineConfig(modelPath = path, backend = backend, cacheDir = ctx.cacheDir.path))
                e.initialize()
                Log.i(TAG, "loaded $NAME on ${backend.javaClass.simpleName}")
                return e
            } catch (t: Throwable) {
                Log.w(TAG, "couldn't load $NAME on ${backend.javaClass.simpleName}", t)
            }
        }
        throw IllegalStateException("couldn't load $NAME")
    }

    private val unloader = android.os.Handler(android.os.Looper.getMainLooper())
    private val unloadIfIdle = Runnable {
        if (System.currentTimeMillis() - lastUse >= IDLE_MS) unload() else scheduleUnload()
    }

    private fun scheduleUnload() {
        unloader.removeCallbacks(unloadIfIdle)
        unloader.postDelayed(unloadIfIdle, IDLE_MS)
    }

    fun unload() = synchronized(lock) {
        engine?.let {
            try {
                it.close()
            } catch (_: Throwable) {
            }
            Log.i(TAG, "let go of $NAME")
        }
        engine = null
    }
}
