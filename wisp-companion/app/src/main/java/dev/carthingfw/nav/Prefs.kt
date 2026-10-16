package dev.carthingfw.nav

import android.content.Context

object Prefs {
    private const val FILE = "car_thing_nav"
    private const val ALLOW_LAN = "allow_lan"
    private const val WAKE_ON_CONNECT = "wake_spotify_on_connect"
    private const val GITHUB_REPO = "github_repo"
    private const val GITHUB_TOKEN = "github_token"
    const val DEFAULT_REPO = "picovrfbt/WispOS"
    // the private repo Wisp lived in before it went public
    private const val OLD_REPO = "picovrfbt/Wisp"

    /** start Spotify in the background whenever a Car Thing connects */
    fun wakeOnConnect(ctx: Context): Boolean =
        ctx.getSharedPreferences(FILE, Context.MODE_PRIVATE).getBoolean(WAKE_ON_CONNECT, true)

    fun setWakeOnConnect(ctx: Context, on: Boolean) {
        ctx.getSharedPreferences(FILE, Context.MODE_PRIVATE).edit().putBoolean(WAKE_ON_CONNECT, on).apply()
    }

    /** owner/name of the public GitHub repo Wisp updates from (a fork's, if you set one) */
    fun githubRepo(ctx: Context): String =
        ctx.getSharedPreferences(FILE, Context.MODE_PRIVATE).getString(GITHUB_REPO, null)
            ?.takeIf { it.isNotBlank() && !it.equals(OLD_REPO, ignoreCase = true) } ?: DEFAULT_REPO

    fun setGithubRepo(ctx: Context, repo: String) {
        ctx.getSharedPreferences(FILE, Context.MODE_PRIVATE).edit().putString(GITHUB_REPO, repo.trim()).apply()
    }

    /** Wisp is public now: forgets the token older versions kept for the private repo */
    fun forgetGithubToken(ctx: Context) {
        val prefs = ctx.getSharedPreferences(FILE, Context.MODE_PRIVATE)
        if (prefs.contains(GITHUB_TOKEN)) prefs.edit().remove(GITHUB_TOKEN).apply()
    }

    private const val SETTINGS_BACKUP = "car_thing_settings"
    private const val SETTINGS_BACKUP_AT = "car_thing_settings_at"

    /** the Car Thing's own settings, kept here so a reflash gets them back */
    fun settingsBackup(ctx: Context): String =
        ctx.getSharedPreferences(FILE, Context.MODE_PRIVATE).getString(SETTINGS_BACKUP, "") ?: ""

    fun settingsBackupAt(ctx: Context): Long =
        ctx.getSharedPreferences(FILE, Context.MODE_PRIVATE).getLong(SETTINGS_BACKUP_AT, 0L)

    fun setSettingsBackup(ctx: Context, json: String) {
        ctx.getSharedPreferences(FILE, Context.MODE_PRIVATE).edit()
            .putString(SETTINGS_BACKUP, json)
            .putLong(SETTINGS_BACKUP_AT, System.currentTimeMillis())
            .apply()
    }

    /** the music.youtube.com sign-in (its cookies), kept only in this app's private storage */
    fun ytCookies(ctx: Context): String =
        ctx.getSharedPreferences(FILE, Context.MODE_PRIVATE).getString("yt_cookies", "") ?: ""

    fun setYtCookies(ctx: Context, cookies: String) {
        ctx.getSharedPreferences(FILE, Context.MODE_PRIVATE).edit().putString("yt_cookies", cookies).apply()
    }

    /** the YouTube Music sign-in from google.com/device (YtSignIn), kept only in this app's private storage */
    fun ytRefresh(ctx: Context): String = str(ctx, "yt_refresh")
    fun ytAccess(ctx: Context): String = str(ctx, "yt_access")
    fun ytAccessUntil(ctx: Context): Long =
        ctx.getSharedPreferences(FILE, Context.MODE_PRIVATE).getLong("yt_access_until", 0L)

    fun setYtTokens(ctx: Context, refresh: String, access: String, until: Long) {
        ctx.getSharedPreferences(FILE, Context.MODE_PRIVATE).edit()
            .putString("yt_refresh", refresh).putString("yt_access", access).putLong("yt_access_until", until)
            .apply()
    }

    /** the soundcloud.com sign-in (its token), kept only in this app's private storage */
    fun scToken(ctx: Context): String = str(ctx, "sc_token")
    fun setScToken(ctx: Context, v: String) = putStr(ctx, "sc_token", v)

    /** your SoundCloud user id, once known */
    fun scUser(ctx: Context): String = str(ctx, "sc_user")
    fun setScUser(ctx: Context, v: String) = putStr(ctx, "sc_user", v)

    /** the id soundcloud.com's pages use with its API (public, read from its scripts) */
    fun scClientId(ctx: Context): String = str(ctx, "sc_client_id")
    fun setScClientId(ctx: Context, v: String) = putStr(ctx, "sc_client_id", v)

    private fun str(ctx: Context, key: String): String =
        ctx.getSharedPreferences(FILE, Context.MODE_PRIVATE).getString(key, "") ?: ""

    private fun putStr(ctx: Context, key: String, v: String) {
        ctx.getSharedPreferences(FILE, Context.MODE_PRIVATE).edit().putString(key, v).apply()
    }

    /** the Samsung "never sleeping apps" step was opened (Android can't check it) */
    fun samsungSleepDone(ctx: Context): Boolean =
        ctx.getSharedPreferences(FILE, Context.MODE_PRIVATE).getBoolean("samsung_sleep_done", false)

    fun setSamsungSleepDone(ctx: Context, done: Boolean) {
        ctx.getSharedPreferences(FILE, Context.MODE_PRIVATE).edit().putBoolean("samsung_sleep_done", done).apply()
    }

    /** stay running in the background (an ongoing notification), on unless turned off */
    fun keepRunning(ctx: Context): Boolean =
        ctx.getSharedPreferences(FILE, Context.MODE_PRIVATE).getBoolean("keep_running", true)

    fun setKeepRunning(ctx: Context, on: Boolean) {
        ctx.getSharedPreferences(FILE, Context.MODE_PRIVATE).edit().putBoolean("keep_running", on).apply()
    }

    /** a music service (by package) offered to the Car Thing beside Spotify */
    fun musicServiceEnabled(ctx: Context, pkg: String, default: Boolean): Boolean =
        ctx.getSharedPreferences(FILE, Context.MODE_PRIVATE).getBoolean("music_service_$pkg", default)

    fun setMusicServiceEnabled(ctx: Context, pkg: String, on: Boolean) {
        ctx.getSharedPreferences(FILE, Context.MODE_PRIVATE).edit().putBoolean("music_service_$pkg", on).apply()
    }

    /** let the PC simulator connect over Wi-Fi as well as the Bluetooth tether */
    fun allowLan(ctx: Context): Boolean =
        ctx.getSharedPreferences(FILE, Context.MODE_PRIVATE).getBoolean(ALLOW_LAN, false)

    fun setAllowLan(ctx: Context, on: Boolean) {
        ctx.getSharedPreferences(FILE, Context.MODE_PRIVATE).edit().putBoolean(ALLOW_LAN, on).apply()
    }
}
