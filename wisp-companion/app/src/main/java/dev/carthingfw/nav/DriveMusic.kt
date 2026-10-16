package dev.carthingfw.nav

import android.content.Context
import android.util.Log
import java.io.File
import java.util.zip.ZipInputStream

/**
 * Drive Mode's music, downloaded the first time a sound is picked rather than
 * carried in the app: wisp-drive-<genre>-vN.zip from the Wisp releases (made
 * by drive-mode-prototype/make_drive_assets.py), one folder per song. About
 * 26 MB a sound, once; the Car Thing's warning says it uses data.
 */
object DriveMusic {
    private const val TAG = "WispDrive"

    private fun dir(ctx: Context, genre: String) = File(ctx.filesDir, "drive-music/$genre")

    /** the genre's songs, downloading them first if they aren't here yet */
    fun ensure(ctx: Context, genre: String, onPercent: (Int) -> Unit): List<File> {
        require(genre in DriveStems.GENRES) { "unknown genre $genre" }
        val d = dir(ctx, genre)
        if (!File(d, ".complete").exists()) download(ctx, genre, d, onPercent)
        return songs(d).ifEmpty { throw IllegalStateException("no songs in the $genre music") }
    }

    /** bytes the music takes: the downloads, plus the sound decoded ready to play */
    fun usage(ctx: Context): Long =
        listOf(File(ctx.filesDir, "drive-music"), DriveStems.cacheDir(ctx)).sumOf { size(it) }

    /**
     * Deletes the downloaded music and the decoded sound; each sound downloads
     * again the next time it's picked. Stops Drive Mode first if it's playing
     */
    fun deleteAll(ctx: Context) {
        val app = ctx.applicationContext
        DriveMode.stopNow(app)
        File(app.filesDir, "drive-music").deleteRecursively()
        DriveStems.cacheDir(app).deleteRecursively()
        Log.i(TAG, "Drive Mode music deleted")
    }

    private fun size(f: File): Long = if (f.isDirectory) f.listFiles()?.sumOf { size(it) } ?: 0 else f.length()

    private fun songs(d: File): List<File> =
        d.listFiles()?.filter { File(it, "meta.json").exists() }?.sortedBy { it.name }.orEmpty()

    private fun download(ctx: Context, genre: String, d: File, onPercent: (Int) -> Unit) {
        val offer = AppUpdater.newestAsset(ctx, Regex("""wisp-drive-$genre-v(\d+)\.zip"""))
            ?: throw IllegalStateException("The $genre music isn't in the Wisp releases")
        val zip = File(ctx.cacheDir, "wisp-drive-$genre.zip")
        onPercent(0)
        AppUpdater.download(ctx, offer, zip, onPercent)
        try {
            if (offer.sha256 != null && AppUpdater.sha256(zip) != offer.sha256) {
                throw IllegalStateException("The music download was damaged")
            }
            d.deleteRecursively()
            unzip(zip, d)
            File(d, ".complete").writeText(offer.version)
            Log.i(TAG, "$genre music v${offer.version} ready")
        } finally {
            zip.delete()
        }
    }

    private fun unzip(zip: File, into: File) {
        val root = into.canonicalFile
        ZipInputStream(zip.inputStream().buffered()).use { z ->
            while (true) {
                val e = z.nextEntry ?: break
                val out = File(root, e.name).canonicalFile
                // nothing may land outside the music folder
                if (!out.path.startsWith(root.path + File.separator)) throw IllegalStateException("bad music pack")
                if (e.isDirectory) out.mkdirs() else {
                    out.parentFile?.mkdirs()
                    out.outputStream().use { z.copyTo(it) }
                }
            }
        }
    }
}
