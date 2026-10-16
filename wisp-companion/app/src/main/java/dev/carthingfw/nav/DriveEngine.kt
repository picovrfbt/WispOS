package dev.carthingfw.nav

import android.content.Context
import android.media.AudioAttributes
import android.media.AudioFocusRequest
import android.media.AudioFormat
import android.media.AudioManager
import android.media.AudioTrack
import android.os.Process
import android.util.Log
import org.json.JSONObject
import java.io.File
import java.nio.ShortBuffer
import kotlin.math.PI
import kotlin.math.abs
import kotlin.math.cos
import kotlin.math.pow
import kotlin.math.sin
import kotlin.math.sqrt
import kotlin.math.tanh

/**
 * Drive Mode's player: one genre's songs mixed live from the drive, out of
 * the phone like any music (so over Bluetooth to the car), with the levels
 * sent to the Car Thing about 12 times a second for its screen.
 *
 * The music downloads the first time a sound is picked (DriveMusic). A drive
 * starts on one of the genre's songs and fades into the next as each ends;
 * the next is decoded in the background while the current one plays.
 *
 * The mix, per stem_drive.py:
 *   stopped       the haze: the track far off, dark, mostly hall
 *   moving        clears with speed; the bass, then the drums come in
 *   accelerating  everything, and the melody through a wah on the pedal
 *   braking       the drums pull back
 *   turning       the music swings to the outside of the turn
 */
class DriveEngine(private val ctx: Context, val genre: String) {
    @Volatile private var running = false
    @Volatile var paused = false
        private set
    @Volatile private var focusPaused = false
    private var thread: Thread? = null

    private val am = ctx.getSystemService(AudioManager::class.java)
    private var focus: AudioFocusRequest? = null

    /** called when it ends by itself (another app took the audio) */
    var onEnded: (() -> Unit)? = null

    fun start() {
        if (running) return
        running = true
        thread = Thread({ run() }, "drive-engine").apply { start() }
    }

    fun stop() {
        running = false
        thread?.join(2_000)
        thread = null
    }

    fun setPaused(p: Boolean) {
        paused = p
    }

    /** one song as the mix plays it: its parts, and where its loop runs in frames */
    private class Song(val stems: DriveStems) {
        val m = stems.meta
        val loopStart = (m.loopStart * m.sampleRate).toInt()
        val loopEnd = minOf((m.loopEnd * m.sampleRate).toInt(), stems.frames - 1)
        val xf = (m.crossfade * m.sampleRate).toInt().coerceAtMost((loopEnd - loopStart) / 4)
        val hazeStep = m.hazeRate.toDouble() / m.sampleRate

        /** each song brought to the same loudness before they meet in the mix */
        val gain = m.master / 32768.0
    }

    // the genre's songs (folders of the downloaded music), which is playing, and the
    // next one, decoded in the background while this one plays
    private var songs: List<File> = emptyList()
    private var songIndex = 0
    @Volatile private var nextSong: Song? = null

    private fun run() {
        Process.setThreadPriority(Process.THREAD_PRIORITY_AUDIO)
        val first = try {
            report(preparing = true)
            songs = DriveMusic.ensure(ctx, genre) { pct -> report(preparing = true, download = pct) }
            report(preparing = true)
            // a different song to start each drive
            songIndex = songs.indices.random()
            Song(DriveStems.load(ctx, genre, songs[songIndex], keepFor(songIndex)))
        } catch (e: Exception) {
            Log.w(TAG, "couldn't get the music ready", e)
            report(error = e.message?.takeIf { it.startsWith("The ") } ?: "The music couldn't be loaded")
            running = false
            return
        }
        if (!running) return
        if (!takeFocus()) {
            report(error = "Another app is holding the audio")
            running = false
            return
        }
        loadNext()
        val sensors = DriveSensors(ctx).apply { start() }
        val track = newTrack(first.m.sampleRate)
        val rec = DriveRecorder(ctx, genre)
        try {
            track.play()
            mix(first, sensors, track, rec)
        } catch (e: Exception) {
            Log.w(TAG, "drive stopped", e)
        } finally {
            rec.close()
            sensors.stop()
            track.stop()
            track.release()
            focus?.let { am?.abandonAudioFocusRequest(it) }
            report(stopped = true)
        }
    }

    /** the decoded song playing now, by its cache name; null before one has loaded */
    val playingKey: String?
        get() = songs.getOrNull(songIndex)?.let { DriveStems.key(genre, it) }

    /** the decoded songs to keep while song [i] plays: it and the one after */
    private fun keepFor(i: Int): Set<String> =
        setOf(DriveStems.key(genre, songs[i]), DriveStems.key(genre, songs[(i + 1) % songs.size]))

    /** decodes the song after the one playing, off the audio thread */
    private fun loadNext() {
        nextSong = null
        if (songs.size < 2) return
        val playing = songIndex
        val i = (playing + 1) % songs.size
        Thread({
            try {
                nextSong = Song(DriveStems.load(ctx, genre, songs[i], keepFor(playing)))
            } catch (e: Exception) {
                Log.w(TAG, "the next song couldn't be loaded; this one plays again", e)
            }
        }, "drive-next-song").apply {
            priority = Thread.MIN_PRIORITY
            isDaemon = true
            start()
        }
    }

    // ------------------------------------------------------------------ the mix

    private fun mix(first: Song, sensors: DriveSensors, track: AudioTrack, rec: DriveRecorder) {
        var cur = first
        val sr = cur.m.sampleRate
        val dt = BLOCK.toDouble() / sr
        val c = DriveControls()
        val out = FloatArray(BLOCK * 2)
        // the wah: a band-pass, one per side
        val wahL = Biquad()
        val wahR = Biquad()

        var pos = cur.loopStart
        // the song a fade is going into, fixed when the fade starts
        var fadeTo: Song? = null
        // the gains as they were at the end of the last block, to glide from
        var gB = c.bass; var gD = c.drums; var gV = c.vocals; var gS = c.surge
        var w = c.openness; var stL = 0.0; var stR = 0.0
        val env = DoubleArray(4) // drums, bass, other, vocals: this block's loudness
        var sinceReport = 0.0
        var outEnergy: Double

        while (running) {
            if (paused || focusPaused) {
                if (track.playState == AudioTrack.PLAYSTATE_PLAYING) track.pause()
                sinceReport += 0.05
                if (sinceReport >= REPORT_EVERY) {
                    sinceReport = 0.0
                    report(paused = true, c = c, speed = 0.0, gps = sensors.hasGps)
                }
                Thread.sleep(50)
                continue
            }
            if (track.playState != AudioTrack.PLAYSTATE_PLAYING) track.play()

            val (speed, accel, steer) = sensors.read(dt)
            c.step(dt, speed, accel, steer)
            rec.step(dt, sensors, speed, accel, steer, c, paused = false)
            val wahFc = 450.0 * (2600.0 / 450.0).pow(c.pedal)
            wahL.bandPass(wahFc, 5.0, sr)
            wahR.copyFrom(wahL)

            // where the block's gains end up; each glides there sample by sample
            val nB = c.bass; val nD = c.drums; val nV = c.vocals; val nS = c.surge * 0.35
            val nW = c.openness
            val nL = 1 - 0.75 * (-c.steer).coerceIn(0.0, 1.0)
            val nR = 1 - 0.75 * c.steer.coerceIn(0.0, 1.0)
            if (stL == 0.0) { stL = nL; stR = nR }
            env.fill(0.0)
            outEnergy = 0.0

            for (i in 0 until BLOCK) {
                val k = (i + 1).toDouble() / BLOCK
                val b = gB + (nB - gB) * k
                val d = gD + (nD - gD) * k
                val v = gV + (nV - gV) * k
                val s = gS + (nS - gS) * k
                val ww = w + (nW - w) * k
                val tl = stL + (nL - stL) * k
                val tr = stR + (nR - stR) * k

                // a song's end fades into the next song's start (or its own, with one song)
                var a = 1.0
                var to: Song? = null
                var p2 = -1
                if (pos >= cur.loopEnd - cur.xf) {
                    val t = (pos - (cur.loopEnd - cur.xf)).toDouble() / cur.xf
                    a = cos(t * PI / 2)
                    val n = fadeTo ?: (nextSong ?: cur).also { fadeTo = it }
                    to = n
                    p2 = n.loopStart + (pos - (cur.loopEnd - cur.xf))
                }
                val dL = read(cur, to, Part.DRUMS, pos, p2, a, 0)
                val dR = read(cur, to, Part.DRUMS, pos, p2, a, 1)
                val bL = read(cur, to, Part.BASS, pos, p2, a, 0)
                val bR = read(cur, to, Part.BASS, pos, p2, a, 1)
                val oL = read(cur, to, Part.OTHER, pos, p2, a, 0)
                val oR = read(cur, to, Part.OTHER, pos, p2, a, 1)
                val vL = read(cur, to, Part.VOCALS, pos, p2, a, 0)
                val vR = read(cur, to, Part.VOCALS, pos, p2, a, 1)
                val hL = readHaze(cur, to, pos, p2, a, 0)
                val hR = readHaze(cur, to, pos, p2, a, 1)

                env[0] += dL * dL; env[1] += bL * bL; env[2] += oL * oL; env[3] += vL * vL

                val melL = oL + vL * v
                val melR = oR + vR * v
                var l = melL + bL * b + dL * d + wahL.run(melL) * 3.2 * s
                var r = melR + bR * b + dR * d + wahR.run(melR) * 3.2 * s
                // the haze when stopped, the clear mix as it opens up
                l = ww * l + (1 - ww) * hL
                r = ww * r + (1 - ww) * hR

                // to the outside of the turn
                l *= tl; r *= tr

                val oLv = (tanh(l * 0.9) / TANH_14 * 0.89).toFloat()
                val oRv = (tanh(r * 0.9) / TANH_14 * 0.89).toFloat()
                out[2 * i] = oLv
                out[2 * i + 1] = oRv
                outEnergy += (oLv * oLv + oRv * oRv) / 2.0

                pos++
                if (pos >= cur.loopEnd) {
                    // on into the song it faded into, carrying on from the fade
                    val n = to
                    fadeTo = null
                    if (n != null && n !== cur) {
                        pos = n.loopStart + cur.xf
                        cur = n
                        songIndex = (songIndex + 1) % songs.size
                        loadNext()
                    } else {
                        pos = cur.loopStart + cur.xf
                    }
                }
            }
            gB = nB; gD = nD; gV = nV; gS = nS; w = nW; stL = nL; stR = nR

            track.write(out, 0, out.size, AudioTrack.WRITE_BLOCKING)

            sinceReport += dt
            if (sinceReport >= REPORT_EVERY) {
                sinceReport = 0.0
                val m = cur.m
                val lvl = { j: Int, part: String ->
                    val rms = sqrt(env[j] / BLOCK) / m.master
                    (rms / ((m.rms[part] ?: 0.1) * 1.4)).coerceIn(0.0, 1.0)
                }
                val open = 0.4 + 0.6 * c.openness
                report(
                    c = c,
                    speed = speed,
                    gps = sensors.hasGps,
                    level = (sqrt(outEnergy / BLOCK) / 0.3).coerceIn(0.0, 1.0),
                    parts = doubleArrayOf(
                        (lvl(0, "drums") * c.drums * c.openness).coerceIn(0.0, 1.0),
                        (lvl(1, "bass") * c.bass * c.openness).coerceIn(0.0, 1.0),
                        (lvl(2, "other") * open).coerceIn(0.0, 1.0),
                        (lvl(3, "vocals") * c.vocals * open).coerceIn(0.0, 1.0),
                    ),
                )
            }
        }
    }

    private enum class Part { DRUMS, BASS, OTHER, VOCALS }

    private fun Song.buf(p: Part): ShortBuffer = when (p) {
        Part.DRUMS -> stems.drums
        Part.BASS -> stems.bass
        Part.OTHER -> stems.other
        Part.VOCALS -> stems.vocals
    }

    /** one side of a part at [pos], crossfaded with [to] at [p2] while a song ends */
    private fun read(cur: Song, to: Song?, p: Part, pos: Int, p2: Int, a: Double, ch: Int): Double {
        val x = cur.buf(p).get(2 * pos + ch) * cur.gain
        if (to == null) return x
        val y = to.buf(p).get(2 * p2 + ch) * to.gain
        return x * a + y * sqrt((1 - a * a).coerceAtLeast(0.0))
    }

    /** the haze runs at a quarter of the rate: read between its samples */
    private fun readHaze(cur: Song, to: Song?, pos: Int, p2: Int, a: Double, ch: Int): Double {
        fun at(s: Song, p: Int): Double {
            val f = p * s.hazeStep
            val i = f.toInt().coerceAtMost(s.stems.hazeFrames - 2)
            val t = f - i
            return (s.stems.haze.get(2 * i + ch) * (1 - t) + s.stems.haze.get(2 * (i + 1) + ch) * t) * s.gain
        }
        val x = at(cur, pos)
        if (to == null) return x
        return x * a + at(to, p2) * sqrt((1 - a * a).coerceAtLeast(0.0))
    }

    // ------------------------------------------------------------------ the phone's audio

    private fun newTrack(rate: Int): AudioTrack {
        val min = AudioTrack.getMinBufferSize(rate, AudioFormat.CHANNEL_OUT_STEREO, AudioFormat.ENCODING_PCM_FLOAT)
        return AudioTrack.Builder()
            .setAudioAttributes(ATTRS)
            .setAudioFormat(
                AudioFormat.Builder()
                    .setSampleRate(rate)
                    .setChannelMask(AudioFormat.CHANNEL_OUT_STEREO)
                    .setEncoding(AudioFormat.ENCODING_PCM_FLOAT)
                    .build(),
            )
            .setBufferSizeInBytes(maxOf(min, BLOCK * 2 * 4 * 4))
            .setTransferMode(AudioTrack.MODE_STREAM)
            .build()
    }

    /** Spotify (or whatever's playing) pauses for Drive Mode; a navigation prompt only ducks it */
    private fun takeFocus(): Boolean {
        val req = AudioFocusRequest.Builder(AudioManager.AUDIOFOCUS_GAIN)
            .setAudioAttributes(ATTRS)
            .setWillPauseWhenDucked(false)
            .setOnAudioFocusChangeListener { change ->
                when (change) {
                    // something else is playing music now: Drive Mode ends
                    AudioManager.AUDIOFOCUS_LOSS -> {
                        running = false
                        onEnded?.invoke()
                    }
                    AudioManager.AUDIOFOCUS_LOSS_TRANSIENT -> focusPaused = true
                    AudioManager.AUDIOFOCUS_GAIN -> focusPaused = false
                }
            }
            .build()
        focus = req
        return am?.requestAudioFocus(req) == AudioManager.AUDIOFOCUS_REQUEST_GRANTED
    }

    // ------------------------------------------------------------------ to the Car Thing

    private fun report(
        c: DriveControls? = null,
        speed: Double = 0.0,
        gps: Boolean = false,
        level: Double = 0.0,
        parts: DoubleArray? = null,
        preparing: Boolean = false,
        download: Int? = null,
        paused: Boolean = false,
        stopped: Boolean = false,
        error: String? = null,
    ) {
        val p = parts ?: DoubleArray(4)
        val msg = JSONObject()
            .put("type", "drive_state")
            .put("genre", genre)
            .put("playing", !stopped && !preparing && error == null)
            .put("paused", paused)
            .put("preparing", preparing)
            .put("level", round3(level))
            .put("clarity", round3(c?.clarity ?: 0.0))
            .put(
                "parts",
                JSONObject().put("drums", round3(p[0])).put("bass", round3(p[1]))
                    .put("melody", round3(p[2])).put("choir", round3(p[3])),
            )
            .put("gps", gps)
        if (gps) msg.put("speed_mph", Math.round(speed))
        if (error != null) msg.put("error", error)
        // the music downloading, the first time this sound is picked
        if (download != null) msg.put("download", download)
        NavStore.publish(msg.toString())
    }

    private fun round3(x: Double) = Math.round(x * 1000) / 1000.0

    /** a second-order band-pass (constant peak), for the wah */
    private class Biquad {
        var b0 = 0.0; var b2 = 0.0; var a1 = 0.0; var a2 = 0.0
        private var x1 = 0.0; private var x2 = 0.0; private var y1 = 0.0; private var y2 = 0.0

        fun bandPass(fc: Double, q: Double, sr: Int) {
            val w0 = 2 * PI * fc / sr
            val alpha = sin(w0) / (2 * q)
            val a0 = 1 + alpha
            b0 = alpha / a0; b2 = -alpha / a0
            a1 = -2 * cos(w0) / a0; a2 = (1 - alpha) / a0
        }

        fun copyFrom(o: Biquad) {
            b0 = o.b0; b2 = o.b2; a1 = o.a1; a2 = o.a2
        }

        fun run(x: Double): Double {
            val y = b0 * x + b2 * x2 - a1 * y1 - a2 * y2
            x2 = x1; x1 = x
            y2 = y1; y1 = if (abs(y) < 1e-20) 0.0 else y
            return y
        }
    }

    companion object {
        private const val TAG = "WispDrive"
        private const val BLOCK = 512
        private const val REPORT_EVERY = 0.08
        private val TANH_14 = tanh(1.4)
        private val ATTRS: AudioAttributes = AudioAttributes.Builder()
            .setUsage(AudioAttributes.USAGE_MEDIA)
            .setContentType(AudioAttributes.CONTENT_TYPE_MUSIC)
            .build()
    }
}
