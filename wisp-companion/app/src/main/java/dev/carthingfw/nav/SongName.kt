package dev.carthingfw.nav

/**
 * A song's artist and title, from its tags when it has them, else from its
 * file name. Players such as VLC send an untagged file's name as the title
 * ("01 - M83 - Midnight City.mp3") and no artist; read that the way people name
 * files, "Artist - Title", after dropping the extension and any track number.
 */
object SongName {
    data class Named(val artist: String, val title: String)

    private val EXTENSION = Regex(
        """\.(mp3|flac|m4a|aac|ogg|oga|opus|wav|wma|alac|ape|aiff?|mka|mp4|m4v|webm|mkv|avi|mov)$""",
        RegexOption.IGNORE_CASE,
    )
    private val TRACK_NUMBER = Regex("""^\(?\d{1,3}\)?\s*[-.)_]?\s+""")

    // what players put in for "no artist"
    private val NO_ARTIST = setOf("", "<unknown>", "unknown", "unknown artist")

    fun of(title: String, artist: String): Named {
        val hasArtist = artist.trim().lowercase() !in NO_ARTIST
        val bare = title.trim().replace(EXTENSION, "")
        if (hasArtist) return Named(artist.trim(), bare)
        if (bare == title.trim() && !bare.contains(" - ")) return Named("", bare)
        val name = bare.replace('_', ' ').replace(TRACK_NUMBER, "").trim()
        val cut = name.indexOf(" - ")
        if (cut <= 0) return Named("", name)
        val left = name.substring(0, cut).trim()
        val right = name.substring(cut + 3).replace(TRACK_NUMBER, "").trim()
        return if (left.isEmpty() || right.isEmpty()) Named("", name) else Named(left, right)
    }
}
