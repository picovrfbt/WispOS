package dev.carthingfw.nav

import android.content.Context
import android.os.Handler
import android.os.Looper
import org.json.JSONObject

/**
 * The Car Thing's own settings, as the phone knows them: the copy it sends on
 * every change (the settings backup), over the Car Thing's defaults. A change
 * made here goes to the Car Thing ("settings_set"), which checks it, applies
 * it as if changed on its own screen and sends its settings back.
 */
object CarSettings {
    // the Car Thing's defaults (wisp-ui/src/settings.ts), for what it hasn't saved yet
    private val DEFAULTS = JSONObject()
        .put("autoBrightness", true)
        .put("brightness", 5)
        .put("nightMode", "off")
        .put("uiScalePct", 100)
        .put("accentTheme", "green")
        .put("performanceMode", true)
        .put("tempUnit", "F")
        .put("showLyrics", true)
        .put("lyricOffsetMs", 0)
        .put("volumeStepPct", 2)
        .put("visualizer", "off")
        .put("phoneLyrics", false)
        .put("phoneNotifications", false)
        .put("phoneBattery", true)
        .put("voiceMic", true)
        .put("wispVoice", "off")
        .put("voiceSpeed", 1.0)
        .put("voiceVolumePct", 80)
        .put("arrivalAction", "none")
        .put("autoInstallUpdates", false)
        .put("updateInBackground", false)

    private val main = Handler(Looper.getMainLooper())
    private val listeners = mutableSetOf<() -> Unit>()

    /** the Car Thing's settings: its last backup over the defaults */
    fun current(ctx: Context): JSONObject {
        val out = JSONObject(DEFAULTS.toString())
        val saved = Prefs.settingsBackup(ctx)
        if (saved.isNotEmpty()) {
            try {
                val s = JSONObject(saved)
                s.keys().forEach { out.put(it, s.get(it)) }
            } catch (_: org.json.JSONException) {
                // an unreadable backup: the defaults
            }
        }
        return out
    }

    /** a Car Thing is connected and can take a change */
    val reachable: Boolean get() = NavServer.connectedCars > 0

    /**
     * Sends one change to the Car Thing; false when none is connected. The
     * phone's copy takes it at once, so the page doesn't jump back while the
     * Car Thing's own copy is on its way.
     */
    fun set(ctx: Context, key: String, value: Any): Boolean {
        if (!NavServer.sendSettings(JSONObject().put(key, value))) return false
        val saved = Prefs.settingsBackup(ctx)
        if (saved.isNotEmpty()) {
            try {
                Prefs.setSettingsBackup(ctx, JSONObject(saved).put(key, value).toString())
            } catch (_: org.json.JSONException) {
                // the Car Thing's copy will replace it
            }
        }
        return true
    }

    /** the Car Thing sent its settings: an open page shows them */
    fun changed() = main.post { listeners.toList().forEach { it() } }

    fun listen(l: () -> Unit) = main.post { listeners.add(l) }

    fun unlisten(l: () -> Unit) = main.post { listeners.remove(l) }
}
