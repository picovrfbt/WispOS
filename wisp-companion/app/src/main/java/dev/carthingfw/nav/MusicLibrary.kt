package dev.carthingfw.nav

import android.content.Context

/**
 * A music service whose library the Car Thing can show beside Spotify
 * (YtMusic, SoundCloud). Each reads it with a sign-in kept on this phone; the
 * Car Thing only ever gets names, covers and ids. Items and sections are the
 * same shape for every service.
 */
interface MusicLibrary {
    val id: String
    val name: String
    val sections: List<YtMusic.Section>

    /** the app that plays it is this one (any build of it) */
    fun owns(pkg: String): Boolean
    fun signedIn(ctx: Context): Boolean
    fun signOut(ctx: Context)

    /** a section by its id, or any item's page by its browse id */
    fun browse(ctx: Context, id: String): List<YtMusic.Item>

    /** the top results for a search, of one kind: song, album, artist or playlist */
    fun search(ctx: Context, query: String, kind: String): List<YtMusic.Item>

    /** plays in the service's own app on this phone; [title] is the song's, to check it took */
    fun play(ctx: Context, playlist: String?, video: String?, title: String? = null): Boolean

    /** the song playing now in its app: its id, whether you like it, and what's up next */
    fun now(ctx: Context, title: String, artist: String, mediaId: String?): Now

    fun like(ctx: Context, current: String, like: Boolean)

    /** adds the song playing to your playlist called [playlist]; returns the playlist's real name */
    fun addToPlaylist(ctx: Context, title: String, artist: String, mediaId: String?, playlist: String): String =
        throw IllegalStateException("Adding to $name playlists isn't supported yet")

    /** [waveform]: the song's shape as 0-100 heights, where the service has one (SoundCloud) */
    /** [image]: the song's cover, for an app that doesn't hand its own over */
    data class Now(
        val current: String?,
        val liked: Boolean?,
        val upNext: List<YtMusic.Item>,
        val waveform: List<Int>? = null,
        val image: String? = null,
    )

    companion object {
        val ALL: List<MusicLibrary> get() = listOf(YtMusicLibrary, SoundCloud)

        fun byId(id: String): MusicLibrary? = ALL.firstOrNull { it.id == id }

        fun forApp(pkg: String?): MusicLibrary? = pkg?.let { p -> ALL.firstOrNull { it.owns(p) } }
    }
}

/** YtMusic as a MusicLibrary */
object YtMusicLibrary : MusicLibrary {
    override val id = YtMusic.ID
    override val name = "YouTube Music"
    override val sections get() = YtMusic.SECTIONS
    override fun owns(pkg: String) = "youtube.music" in pkg
    override fun signedIn(ctx: Context) = YtMusic.signedIn(ctx)
    override fun signOut(ctx: Context) = YtMusic.signOut(ctx)
    override fun browse(ctx: Context, id: String): List<YtMusic.Item> {
        // a section by name, or any page by its browse id
        val browseId = YtMusic.SECTIONS.firstOrNull { it.id == id }?.browseId ?: id
        if (browseId.isBlank()) throw IllegalStateException("nothing to open")
        return YtMusic.browse(ctx, browseId)
    }
    override fun search(ctx: Context, query: String, kind: String) = YtMusic.search(ctx, query, kind)
    override fun play(ctx: Context, playlist: String?, video: String?, title: String?) =
        YtMusic.play(ctx, playlist, video, title)
    override fun now(ctx: Context, title: String, artist: String, mediaId: String?): MusicLibrary.Now {
        val n = YtMusic.now(ctx, title, artist, mediaId)
        return MusicLibrary.Now(n.videoId, n.liked, n.upNext, image = n.image)
    }
    override fun like(ctx: Context, current: String, like: Boolean) = YtMusic.like(ctx, current, like)
    override fun addToPlaylist(ctx: Context, title: String, artist: String, mediaId: String?, playlist: String) =
        YtMusic.addToPlaylist(ctx, title, artist, mediaId, playlist)
}
