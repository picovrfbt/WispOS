package dev.carthingfw.nav

import android.content.Context
import android.util.Log
import com.google.mlkit.genai.common.DownloadStatus
import com.google.mlkit.genai.common.FeatureStatus
import com.google.mlkit.genai.prompt.Generation
import com.google.mlkit.genai.prompt.GenerativeModel
import com.google.mlkit.genai.prompt.TextPart
import com.google.mlkit.genai.prompt.generateContentRequest
import kotlinx.coroutines.runBlocking
import org.java_websocket.WebSocket
import org.json.JSONObject
import java.util.concurrent.Executors

/**
 * Wisp's thinking, on this phone: what the Car Thing's own rules don't
 * understand comes here with a little context ("now playing", the time), and a
 * language model on the phone turns it into one action from a fixed list plus
 * a short reply. The Car Thing checks the action and carries it out.
 *
 * The model is Gemini Nano through Android's AICore where the phone has it
 * (nothing to download, nothing sent online). Other phones can download an
 * open model (OpenModel, about 345 MB) from the app, after a size warning.
 * Phones with Nano can still choose the open model; Nano stays the default.
 * The Car Thing is told "think_status" so it only asks when there's a model.
 */
object WispThink {
    private const val TAG = "WispThink"

    private val worker = Executors.newSingleThreadExecutor()
    @Volatile private var nano: GenerativeModel? = null
    private lateinit var app: Context

    // ready | downloading | unavailable
    @Volatile var state = "unavailable"
        private set
    // nano | open | "" (none)
    @Volatile var model = ""
        private set
    // Gemini Nano isn't on this phone, so the open model is the way
    @Volatile var nanoMissing = false
        private set
    @Volatile private var nanoDownloading = false
    val nanoHere get() = nano != null || nanoDownloading

    @Volatile private var started = false

    /** finds this phone's model: Gemini Nano (downloaded by Android if offered), else the open one if downloaded */
    fun start(ctx: Context) {
        if (started) return
        started = true
        app = ctx.applicationContext
        worker.execute {
            try {
                val m = Generation.getClient()
                when (runBlocking { m.checkStatus() }) {
                    FeatureStatus.AVAILABLE -> nanoReady(m)
                    FeatureStatus.DOWNLOADING -> {
                        nanoDownloading = true
                        pick()
                    }
                    FeatureStatus.DOWNLOADABLE -> {
                        nanoDownloading = true
                        pick()
                        runBlocking {
                            m.download().collect { s ->
                                when (s) {
                                    is DownloadStatus.DownloadCompleted -> nanoReady(m)
                                    is DownloadStatus.DownloadFailed -> {
                                        Log.w(TAG, "Gemini Nano download failed", s.e)
                                        noNano()
                                    }
                                    else -> {}
                                }
                            }
                        }
                    }
                    else -> noNano()
                }
            } catch (e: Throwable) {
                // no AICore, an unlocked bootloader, or a phone without Gemini Nano
                Log.i(TAG, "Gemini Nano isn't available here: ${e.message}")
                noNano()
            }
        }
    }

    private fun nanoReady(m: GenerativeModel) {
        nano = m
        try {
            runBlocking { m.warmup() }
        } catch (e: Throwable) {
            Log.d(TAG, "warmup skipped: ${e.message}")
        }
        nanoDownloading = false
        pick()
    }

    private fun noNano() {
        nanoMissing = true
        nanoDownloading = false
        pick()
    }

    /** "think_download": Download pressed on the Car Thing's pop-up */
    fun downloadFromCar() {
        if (!::app.isInitialized || !nanoMissing || OpenModel.downloaded(app) || OpenModel.progress >= 0) return
        set("downloading", "open")
        Thread {
            val ok = OpenModel.download(app) {}
            Log.i(TAG, "model download from the Car Thing: ${if (ok) "done" else "failed"}")
            pick()
        }.start()
    }

    /** after the open model is downloaded or deleted in the app */
    fun openModelChanged() = pick()

    /** the open model over Gemini Nano, on a phone that has both */
    fun setPreferOpen(ctx: Context, on: Boolean) {
        Prefs.setThinkPreferOpen(ctx, on)
        if (!on) OpenModel.unload()
        pick()
    }

    // automatic: Gemini Nano where the phone has it, else the open model if downloaded,
    // unless you picked the open model (and it's there)
    @Synchronized private fun pick() {
        if (!::app.isInitialized) return
        val open = OpenModel.downloaded(app)
        when {
            open && Prefs.thinkPreferOpen(app) -> set("ready", "open")
            nano != null -> set("ready", "nano")
            nanoDownloading -> set("downloading", "nano")
            open -> set("ready", "open")
            else -> set("unavailable", "")
        }
    }

    private fun set(s: String, m: String) {
        if (state == s && model == m) return
        state = s
        model = m
        NavStore.publish(statusJson())
    }

    fun statusJson(): String = JSONObject().put("type", "think_status").put("state", state).put("model", model)
        // no Gemini Nano and nothing downloaded: the Car Thing may offer the download, once
        .put("offer_mb", if (nanoMissing && state == "unavailable") (OpenModel.SIZE_BYTES + 500_000) / 1_000_000 else 0).toString()

    /** "think": one request from the Car Thing, answered with "think_reply" */
    fun handle(conn: WebSocket, msg: JSONObject) {
        val id = msg.optInt("id")
        val text = msg.optString("text").trim().take(300)
        val context = msg.optJSONObject("context") ?: JSONObject()
        worker.execute {
            val reply = try {
                val raw = when (model) {
                    "nano" -> {
                        val m = nano ?: throw IllegalStateException("not ready")
                        val out = runBlocking {
                            m.generateContent(
                                generateContentRequest(TextPart(prompt(text, context))) {
                                    temperature = 0.1f
                                    topK = 1
                                    maxOutputTokens = 120
                                },
                            )
                        }
                        out.candidates.firstOrNull()?.text.orEmpty()
                    }
                    // Qwen3 thinks out loud unless told not to
                    "open" -> OpenModel.generate(app, prompt(text, context) + "\n/no_think")
                    else -> throw IllegalStateException("no model on this phone")
                }
                parse(raw) ?: JSONObject().put("action", "none").put("say", "Sorry, I didn't catch that")
            } catch (e: Throwable) {
                Log.w(TAG, "thinking failed", e)
                JSONObject().put("error", e.message ?: "failed")
            }
            try {
                conn.send(reply.put("type", "think_reply").put("id", id).toString())
            } catch (e: Exception) {
                Log.w(TAG, "reply not sent", e)
            }
        }
    }

    /** the model's JSON, from whatever it wrapped it in */
    fun parse(raw: String): JSONObject? {
        val a = raw.indexOf('{')
        val b = raw.lastIndexOf('}')
        if (a < 0 || b <= a) return null
        return try {
            val j = JSONObject(raw.substring(a, b + 1))
            JSONObject()
                .put("action", j.optString("action"))
                .put("query", j.optString("query"))
                .put("kind", j.optString("kind"))
                .put("say", j.optString("say"))
        } catch (e: Exception) {
            null
        }
    }

    fun prompt(text: String, ctx: JSONObject): String = buildString {
        appendLine("You are Wisp, the voice assistant on a car dashboard music player. Turn the driver's request into ONE action as JSON. Answer with the JSON only.")
        appendLine()
        appendLine("Actions:")
        appendLine("- play: query = what to play; kind = track, artist, album, playlist or mood")
        appendLine("- queue: query = a song to play next")
        appendLine("- pause, resume, next, previous, restart, like, volume_up, volume_down")
        appendLine("- navigate: query = the destination")
        appendLine("- call: query = the contact's name")
        appendLine("- drive_start, drive_stop (Drive Mode music), night_on, night_off, brighter, dimmer (the screen)")
        appendLine("- answer: say = a short spoken answer to a question")
        appendLine("- none: say = a short reason, when it's none of these or you're unsure")
        appendLine()
        appendLine("Rules: \"say\" is at most 15 words, friendly and plain. Use the context below for questions about what's playing, the time or the trip; never make those up. Prefer play with kind mood for a feeling or activity (\"something to wake me up\" -> mood \"energetic\").")
        appendLine()
        appendLine("Examples:")
        appendLine("Request: I'm getting sleepy, wake me up")
        appendLine("""{"action":"play","query":"energetic","kind":"mood","say":"Here's something to wake you up"}""")
        appendLine("Request: who's the drummer in this band")
        appendLine("""{"action":"none","say":"I can't look that up yet"}""")
        appendLine("Request: let's hear that new Taylor Swift album")
        appendLine("""{"action":"play","query":"Taylor Swift","kind":"album","say":"Playing Taylor Swift's latest"}""")
        appendLine()
        appendLine("Context:")
        ctx.optString("now_playing").takeIf { it.isNotEmpty() }?.let {
            appendLine("- Now playing: $it" + if (ctx.optBoolean("paused")) " (paused)" else "")
        } ?: appendLine("- Nothing is playing")
        ctx.optString("local_time").takeIf { it.isNotEmpty() }?.let { appendLine("- Time: $it") }
        ctx.optString("navigating").takeIf { it.isNotEmpty() }?.let { appendLine("- Navigating, arrival: $it") }
        ctx.optString("last_action").takeIf { it.isNotEmpty() }?.let { appendLine("- Just before: $it") }
        appendLine()
        appendLine("Request: $text")
    }
}
