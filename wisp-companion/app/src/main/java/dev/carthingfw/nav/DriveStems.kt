package dev.carthingfw.nav

import android.content.Context
import android.media.MediaCodec
import android.media.MediaExtractor
import android.media.MediaFormat
import android.util.Log
import org.json.JSONObject
import java.io.File
import java.io.RandomAccessFile
import java.nio.ByteOrder
import java.nio.ShortBuffer
import java.nio.channels.FileChannel

/**
 * One song, ready to mix: its parts (the .ogg files in a song folder of the
 * downloaded music, DriveMusic) decoded once into the cache as raw 16-bit
 * stereo and read from there through memory maps, so three minutes of five
 * parts never sit in the app's memory. Only the songs about to play stay
 * decoded: the one playing and the one after it.
 */
class DriveStems private constructor(
    val meta: Meta,
    /** drums, bass, other, vocals at [Meta.sampleRate]; the haze at [Meta.hazeRate] */
    val drums: ShortBuffer,
    val bass: ShortBuffer,
    val other: ShortBuffer,
    val vocals: ShortBuffer,
    val haze: ShortBuffer,
) {
    data class Meta(
        val genre: String,
        val sampleRate: Int,
        val hazeRate: Int,
        val loopStart: Double,
        val loopEnd: Double,
        val crossfade: Double,
        val master: Double,
        /** one unit of the prototype's mix in these files' level */
        val scale: Double,
        /** each part's usual loudness, for the Car Thing's meters */
        val rms: Map<String, Double>,
    )

    /** frames in the shortest part: where the music runs out */
    val frames: Int = minOf(drums.limit(), bass.limit(), other.limit(), vocals.limit()) / 2
    val hazeFrames: Int = haze.limit() / 2

    companion object {
        private const val TAG = "WispDrive"
        val PARTS = listOf("drums", "bass", "other", "vocals", "haze")
        val GENRES = setOf("ethereal", "cinematic", "lofi")

        /** where songs are kept decoded, ready to play */
        fun cacheDir(ctx: Context) = File(ctx.cacheDir, "drive")

        /**
         * Drops the decoded songs but [keep]: once Drive Mode stops, only the one
         * it was playing stays, so it starts quickly next time
         */
        fun trim(ctx: Context, keep: String?) {
            cacheDir(ctx).listFiles()?.filter { f -> keep == null || !f.name.startsWith("$keep-") }?.forEach { it.delete() }
        }

        /** the cache name for a song: its genre and folder ("cinematic-2") */
        fun key(genre: String, song: File) = "$genre-${song.name}"

        /**
         * Decodes what isn't decoded yet (slow the first time: tens of seconds).
         * Decoded songs not named in [keep] are cleared: they're a lot of storage
         */
        fun load(ctx: Context, genre: String, song: File, keep: Set<String>): DriveStems {
            require(genre in GENRES) { "unknown genre $genre" }
            val dir = cacheDir(ctx).apply { mkdirs() }
            val mine = key(genre, song)
            dir.listFiles()?.filter { f -> (keep + mine).none { f.name.startsWith("$it-") } }?.forEach { it.delete() }

            val metaJson = JSONObject(File(song, "meta.json").readText())
            val rmsJson = metaJson.getJSONObject("rms")
            val meta = Meta(
                genre = genre,
                sampleRate = metaJson.getInt("sample_rate"),
                hazeRate = metaJson.getInt("haze_rate"),
                loopStart = metaJson.getDouble("loop_start"),
                loopEnd = metaJson.getDouble("loop_end"),
                crossfade = metaJson.getDouble("crossfade"),
                master = metaJson.getDouble("master"),
                scale = metaJson.getDouble("scale"),
                rms = rmsJson.keys().asSequence().associateWith { rmsJson.getDouble(it) },
            )
            val maps = PARTS.associateWith { part ->
                val ogg = File(song, "$part.ogg")
                // the file's size in the name: newer music is decoded afresh
                val pcm = File(dir, "$mine-$part-${ogg.length()}.pcm")
                if (!pcm.exists()) decode(ogg, pcm)
                map(pcm)
            }
            return DriveStems(meta, maps.getValue("drums"), maps.getValue("bass"), maps.getValue("other"),
                maps.getValue("vocals"), maps.getValue("haze"))
        }

        private fun map(f: File): ShortBuffer = RandomAccessFile(f, "r").use { raf ->
            raf.channel.map(FileChannel.MapMode.READ_ONLY, 0, raf.length())
                .order(ByteOrder.LITTLE_ENDIAN).asShortBuffer()
        }

        /** Vorbis to raw 16-bit stereo, written beside and renamed when whole */
        private fun decode(ogg: File, out: File) {
            val part = File(out.path + ".part")
            val ex = MediaExtractor()
            ex.setDataSource(ogg.path)
            ex.selectTrack(0)
            val format = ex.getTrackFormat(0)
            val codec = MediaCodec.createDecoderByType(format.getString(MediaFormat.KEY_MIME)!!)
            codec.configure(format, null, null, 0)
            codec.start()
            val info = MediaCodec.BufferInfo()
            var channels = format.getInteger(MediaFormat.KEY_CHANNEL_COUNT)
            try {
                part.outputStream().buffered(1 shl 16).use { os ->
                    var inputDone = false
                    var outputDone = false
                    val scratch = ByteArray(1 shl 16)
                    while (!outputDone) {
                        if (!inputDone) {
                            val i = codec.dequeueInputBuffer(10_000)
                            if (i >= 0) {
                                val buf = codec.getInputBuffer(i)!!
                                val n = ex.readSampleData(buf, 0)
                                if (n < 0) {
                                    codec.queueInputBuffer(i, 0, 0, 0, MediaCodec.BUFFER_FLAG_END_OF_STREAM)
                                    inputDone = true
                                } else {
                                    codec.queueInputBuffer(i, 0, n, ex.sampleTime, 0)
                                    ex.advance()
                                }
                            }
                        }
                        val o = codec.dequeueOutputBuffer(info, 10_000)
                        if (o == MediaCodec.INFO_OUTPUT_FORMAT_CHANGED) {
                            channels = codec.outputFormat.getInteger(MediaFormat.KEY_CHANNEL_COUNT)
                        } else if (o >= 0) {
                            val buf = codec.getOutputBuffer(o)!!
                            buf.position(info.offset)
                            var left = info.size
                            while (left > 0) {
                                val n = minOf(left, scratch.size)
                                buf.get(scratch, 0, n)
                                if (channels == 1) {
                                    // mono to stereo: each 16-bit sample twice
                                    for (k in 0 until n step 2) {
                                        os.write(scratch, k, 2)
                                        os.write(scratch, k, 2)
                                    }
                                } else {
                                    os.write(scratch, 0, n)
                                }
                                left -= n
                            }
                            codec.releaseOutputBuffer(o, false)
                            if (info.flags and MediaCodec.BUFFER_FLAG_END_OF_STREAM != 0) outputDone = true
                        }
                    }
                }
                if (!part.renameTo(out)) throw IllegalStateException("couldn't keep $out")
                Log.i(TAG, "decoded $ogg (${out.length() / 1024} KB)")
            } finally {
                codec.stop()
                codec.release()
                ex.release()
                part.delete()
            }
        }
    }
}
