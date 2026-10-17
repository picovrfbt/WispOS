package dev.carthingfw.nav

import android.Manifest
import android.content.Context
import android.content.Intent
import android.content.pm.PackageManager
import android.net.Uri
import android.provider.ContactsContract
import android.util.Log
import org.java_websocket.WebSocket
import org.json.JSONObject

/**
 * What the Car Thing's voice asks the phone to do that only a phone can:
 * start directions ("take me home") and call someone ("call Mom"). Each one
 * answers the Car Thing with what happened, which it shows and says.
 */
object VoiceActions {
    private const val TAG = "WispVoiceActions"

    /** "navigate": directions in Google Maps (or whichever maps app answers) */
    fun navigate(ctx: Context, conn: WebSocket, to: String) {
        val where = to.trim()
        if (where.isEmpty()) return reply(conn, false, "Where to?")
        val intent = Intent(Intent.ACTION_VIEW, Uri.parse("google.navigation:q=" + Uri.encode(where)))
        val maps = "com.google.android.apps.maps"
        if (installed(ctx, maps)) intent.setPackage(maps)
        val opened = AppOpener.open(ctx, intent, "Maps")
        reply(conn, opened, if (opened) "Directions to ${where}" else "Tap the notification on your phone to start directions")
    }

    /** "place_call": the best-matching contact, called */
    fun call(ctx: Context, conn: WebSocket, who: String) {
        if (!allowed(ctx)) {
            return reply(conn, false, "Allow \"Call by voice\" in the Wisp app first")
        }
        val match = findContact(ctx, who)
            ?: return reply(conn, false, "I couldn't find $who in your contacts")
        val intent = Intent(Intent.ACTION_CALL, Uri.fromParts("tel", match.second, null))
        val placed = AppOpener.open(ctx, intent, "Phone")
        reply(conn, placed, if (placed) "Calling ${match.first}" else "Tap the notification on your phone to call ${match.first}")
    }

    fun allowed(ctx: Context) = listOf(Manifest.permission.READ_CONTACTS, Manifest.permission.CALL_PHONE)
        .all { ctx.checkSelfPermission(it) == PackageManager.PERMISSION_GRANTED }

    /** the contact whose name best matches what was said: exact, then whole words, then a start */
    private fun findContact(ctx: Context, said: String): Pair<String, String>? {
        val want = words(said)
        if (want.isEmpty()) return null
        var best: Pair<String, String>? = null
        var bestScore = 0
        val cols = arrayOf(
            ContactsContract.CommonDataKinds.Phone.DISPLAY_NAME,
            ContactsContract.CommonDataKinds.Phone.NUMBER,
            ContactsContract.CommonDataKinds.Phone.IS_PRIMARY,
        )
        try {
            ctx.contentResolver.query(ContactsContract.CommonDataKinds.Phone.CONTENT_URI, cols, null, null, null)?.use { c ->
                while (c.moveToNext()) {
                    val name = c.getString(0) ?: continue
                    val number = c.getString(1) ?: continue
                    val score = nameScore(want, words(name)) + if (c.getInt(2) == 1) 1 else 0
                    if (score > bestScore) {
                        bestScore = score
                        best = name to number
                    }
                }
            }
        } catch (e: SecurityException) {
            Log.w(TAG, "contacts not readable", e)
            return null
        }
        return best.takeIf { bestScore >= 10 }
    }

    /** how well a contact's name matches what was said (0 = not at all) */
    fun nameScore(want: List<String>, have: List<String>): Int = when {
        have.isEmpty() -> 0
        have == want -> 40
        have.containsAll(want) -> 30
        want.all { w -> have.any { it.startsWith(w) } } -> 20
        want.size == 1 && have.first().startsWith(want.first()) -> 10
        else -> 0
    }

    fun words(s: String) = s.lowercase().split(Regex("""[^\p{L}\p{N}]+""")).filter { it.isNotEmpty() }

    private fun installed(ctx: Context, pkg: String) = try {
        ctx.packageManager.getPackageInfo(pkg, 0)
        true
    } catch (e: PackageManager.NameNotFoundException) {
        false
    }

    private fun reply(conn: WebSocket, ok: Boolean, text: String) {
        try {
            conn.send(JSONObject().put("type", "voice_reply").put("ok", ok).put("text", text).toString())
        } catch (e: Exception) {
            Log.w(TAG, "reply not sent", e)
        }
    }
}
