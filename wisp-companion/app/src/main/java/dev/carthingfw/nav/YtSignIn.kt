package dev.carthingfw.nav

import android.content.Context
import org.json.JSONObject
import java.net.HttpURLConnection
import java.net.URL
import java.net.URLEncoder

/**
 * Signs in to YouTube Music the way a TV does: Google gives a short code, you
 * enter it at google.com/device in your own browser and allow Wisp, and Google
 * hands this app a sign-in of its own. Google turns away its sign-in page
 * inside apps, so this never shows it here.
 *
 * Needs a Google OAuth client of the "TVs and Limited Input devices" kind,
 * built in from wisp.googleClientId / wisp.googleClientSecret (Gradle
 * properties) or WISP_GOOGLE_CLIENT_ID / WISP_GOOGLE_CLIENT_SECRET. The tokens
 * stay in this app's private storage; Sign out revokes them.
 */
object YtSignIn {
    private const val CODE_URL = "https://oauth2.googleapis.com/device/code"
    private const val TOKEN_URL = "https://oauth2.googleapis.com/token"
    private const val REVOKE_URL = "https://oauth2.googleapis.com/revoke"
    private const val SCOPE = "https://www.googleapis.com/auth/youtube"

    val configured: Boolean get() = BuildConfig.GOOGLE_CLIENT_ID.isNotEmpty()

    /** what to show while waiting: the code, where to enter it, and how often to check */
    data class Code(val userCode: String, val url: String, val deviceCode: String, val intervalSec: Int, val expiresAt: Long)

    sealed class Poll {
        object Waiting : Poll()
        object SlowDown : Poll()
        object Done : Poll()
        data class Failed(val why: String) : Poll()
    }

    fun signedIn(ctx: Context): Boolean = Prefs.ytRefresh(ctx).isNotEmpty()

    /** asks Google for a code to enter at google.com/device */
    fun start(): Code {
        val j = form(CODE_URL, mapOf("client_id" to BuildConfig.GOOGLE_CLIENT_ID, "scope" to SCOPE))
        if (j.has("error")) throw IllegalStateException(describe(j))
        return Code(
            j.getString("user_code"),
            j.optString("verification_url", "https://www.google.com/device"),
            j.getString("device_code"),
            j.optInt("interval", 5).coerceAtLeast(1),
            System.currentTimeMillis() + j.optLong("expires_in", 1800) * 1000,
        )
    }

    /** one check whether the code has been allowed; keeps the sign-in once it has */
    fun poll(ctx: Context, code: Code): Poll {
        if (System.currentTimeMillis() > code.expiresAt) return Poll.Failed("The code ran out; start again")
        val j = form(TOKEN_URL, client() + mapOf(
            "device_code" to code.deviceCode,
            "grant_type" to "urn:ietf:params:oauth:grant-type:device_code",
        ))
        return when (j.optString("error")) {
            "" -> {
                keep(ctx, j)
                Poll.Done
            }
            "authorization_pending" -> Poll.Waiting
            "slow_down" -> Poll.SlowDown
            "access_denied" -> Poll.Failed("Access wasn't allowed")
            "expired_token" -> Poll.Failed("The code ran out; start again")
            else -> Poll.Failed(describe(j))
        }
    }

    /** a current access token, refreshed when it's about to run out; null when not signed in */
    @Synchronized
    fun accessToken(ctx: Context): String? {
        val refresh = Prefs.ytRefresh(ctx).ifEmpty { return null }
        if (System.currentTimeMillis() < Prefs.ytAccessUntil(ctx) - 60_000) {
            Prefs.ytAccess(ctx).takeIf { it.isNotEmpty() }?.let { return it }
        }
        val j = form(TOKEN_URL, client() + mapOf("refresh_token" to refresh, "grant_type" to "refresh_token"))
        if (j.optString("error") == "invalid_grant") {
            // revoked or expired at Google's end: signed out
            Prefs.setYtTokens(ctx, "", "", 0)
            throw IllegalStateException("YouTube Music signed you out; sign in again")
        }
        if (j.has("error")) throw IllegalStateException(describe(j))
        keep(ctx, j)
        return Prefs.ytAccess(ctx)
    }

    /** forgets the sign-in here and asks Google to revoke it */
    fun signOut(ctx: Context) {
        val token = Prefs.ytRefresh(ctx)
        Prefs.setYtTokens(ctx, "", "", 0)
        if (token.isNotEmpty()) Thread { runCatching { form(REVOKE_URL, mapOf("token" to token)) } }.start()
    }

    private fun keep(ctx: Context, j: JSONObject) {
        val refresh = j.optString("refresh_token").ifEmpty { Prefs.ytRefresh(ctx) }
        val until = System.currentTimeMillis() + j.optLong("expires_in", 3600) * 1000
        Prefs.setYtTokens(ctx, refresh, j.getString("access_token"), until)
    }

    private fun client() = mapOf(
        "client_id" to BuildConfig.GOOGLE_CLIENT_ID,
        "client_secret" to BuildConfig.GOOGLE_CLIENT_SECRET,
    )

    private fun describe(j: JSONObject): String =
        "Google said: " + j.optString("error_description").ifEmpty { j.optString("error", "an unknown error") }

    // a form POST; Google answers errors as JSON with a 4xx, so those are read too
    private fun form(url: String, fields: Map<String, String>): JSONObject {
        val body = fields.entries.joinToString("&") { (k, v) -> "$k=" + URLEncoder.encode(v, "UTF-8") }
        val conn = (URL(url).openConnection() as HttpURLConnection).apply {
            connectTimeout = 15_000
            readTimeout = 20_000
            requestMethod = "POST"
            doOutput = true
            setRequestProperty("Content-Type", "application/x-www-form-urlencoded")
        }
        try {
            conn.outputStream.use { it.write(body.toByteArray()) }
            val stream = if (conn.responseCode < 400) conn.inputStream else conn.errorStream
            val text = stream?.bufferedReader()?.readText().orEmpty()
            return if (text.isBlank()) JSONObject() else JSONObject(text)
        } finally {
            conn.disconnect()
        }
    }
}
