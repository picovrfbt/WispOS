package dev.carthingfw.nav

import android.content.Context
import android.util.Log
import org.java_websocket.WebSocket
import org.java_websocket.handshake.ClientHandshake
import org.java_websocket.server.WebSocketServer
import java.net.InetSocketAddress
import java.util.concurrent.atomic.AtomicInteger

/**
 * ws://<phone>:3679/nav. The Car Thing dials its tether gateway, which is this
 * phone, and gets the current state followed by every change.
 */
class NavServer private constructor(private val app: Context) :
    WebSocketServer(InetSocketAddress(PORT)) {

    private val clients = AtomicInteger(0)
    private val forward: (String) -> Unit = { msg -> broadcast(msg) }

    override fun onStart() {
        connectionLostTimeout = 30
        NavStore.addListener(forward)
        Log.i(TAG, "listening on :$PORT")
    }

    override fun onOpen(conn: WebSocket, handshake: ClientHandshake) {
        val remote = conn.remoteSocketAddress?.address
        val path = handshake.resourceDescriptor.substringBefore('?')
        if (path != "/nav" || remote == null || !ClientFilter.allowed(remote, Prefs.allowLan(app))) {
            Log.w(TAG, "refused $remote$path")
            lastRefused = "$remote${path} (${remote?.let(ClientFilter::ifaceFor) ?: "unknown network"})"
            conn.close(1008, "not on the Car Thing tether")
            return
        }
        Log.i(TAG, "Car Thing connected from $remote")
        // with the screen off the phone would sleep, and the tether with it
        TetherAwake.hold(app)
        // and Spotify with it, while it plays for the Car Thing
        SpotifyKeeper.carLinked(app)
        LinkService.update(app)
        lastConnected = "$remote (${ClientFilter.ifaceFor(remote) ?: "?"})"
        NavStore.snapshot().forEach(conn::send)
        sendUpdateAuth(conn)
        // the phone's volume level, for when the knob has to turn it (Spotify refusing remote volume)
        conn.send(PhoneVolume.state(app))
        // what this app can do for the Car Thing beyond the basics
        conn.send(
            org.json.JSONObject().put("type", "caps")
                .put("update_relay", true)
                .toString(),
        )
        // what music apps are on this phone, for the Car Thing's Home
        if (MusicServices.services.isNotEmpty()) conn.send(MusicServices.json(app))
        conn.send(YtMusicLink.statusJson(app))
        // whether this phone's language model is there for Wisp's voice
        conn.send(WispThink.statusJson())
        // a reflashed Car Thing takes these back; one with its own keeps them
        Prefs.settingsBackup(app).takeIf { it.isNotEmpty() }?.let { saved ->
            try {
                conn.send(
                    org.json.JSONObject().put("type", "settings_restore")
                        .put("settings", org.json.JSONObject(saved)).toString(),
                )
            } catch (e: org.json.JSONException) {
                Log.w(TAG, "settings backup unreadable", e)
            }
        }
        // a call already under way when the Car Thing connects, and the battery
        PhoneCalls.snapshot()?.let(conn::send)
        PhoneBattery.snapshot()?.let(conn::send)
        if (clients.incrementAndGet() == 1) {
            LocationFeed.start(app)
            PhoneCalls.start(app)
            PhoneBattery.start(app)
            // the car just started: have Spotify ready before anyone presses play
            if (Prefs.wakeOnConnect(app)) SpotifyWaker.wake(app, prompt = false)
        }
    }

    override fun onClose(conn: WebSocket, code: Int, reason: String?, remote: Boolean) {
        // refused connections never counted
        if (code == 1008) return
        LinkService.update(app)
        if (clients.decrementAndGet() <= 0) {
            clients.set(0)
            TetherAwake.letGoSoon()
            SpotifyKeeper.carGone()
            PhoneCalls.stop()
            PhoneBattery.stop()
            PhoneViz.disconnected()
            LocationFeed.stop()
            NotificationForwarder.setEnabled(false)
        }
    }

    override fun onMessage(conn: WebSocket, message: String) {
        // only the tether (or the LAN when allowed) may ask for anything
        val remote = conn.remoteSocketAddress?.address ?: return
        if (!ClientFilter.allowed(remote, Prefs.allowLan(app))) return
        val type = try {
            org.json.JSONObject(message).optString("type")
        } catch (e: org.json.JSONException) {
            return
        }
        // a play on the Car Thing found no device: this phone's Spotify is asleep
        // quiet: a voice play's first try, started in the background without opening it
        if (type == "wake_spotify") {
            SpotifyWaker.wake(app, prompt = !org.json.JSONObject(message).optBoolean("quiet", false))
        }
        // the knob, for a phone Spotify won't take remote volume from: step the
        // phone's own music volume and say where it ended up
        if (type == "phone_volume") {
            val steps = org.json.JSONObject(message).optInt("steps", 0).coerceIn(-10, 10)
            if (steps != 0) conn.send(PhoneVolume.step(app, steps))
        }
        // Wisp's voice: speak this line, and keep the voice ready while it's on
        if (type == "say") {
            val msg = org.json.JSONObject(message)
            val text = msg.optString("text").trim()
            if (text.isNotEmpty()) {
                WispVoice.say(
                    app, text,
                    msg.optDouble("speed", 1.0).toFloat(),
                    msg.optDouble("volume", 1.0).toFloat(),
                )
            }
        }
        // Wisp is listening: the music lower or paused until it has the request
        if (type == "hush") WispHush.set(app, org.json.JSONObject(message).optString("mode"))
        if (type == "voice_wanted") {
            WispVoice.setWanted(app, org.json.JSONObject(message).optBoolean("enabled", false))
        }
        // the other music services (YouTube Music, SoundCloud)
        if (type == "svc_browse" || type == "svc_play" || type == "svc_now" || type == "svc_like" || type == "svc_add") {
            YtMusicLink.handle(app, conn, org.json.JSONObject(message))
        }
        // the Car Thing is showing a visualizer (or stopped): measure the music for it
        if (type == "viz_wanted") PhoneViz.setWanted(app, org.json.JSONObject(message).optBoolean("enabled", false))
        // a call: answer, decline or hang up from the Car Thing
        if (type == "call_control") PhoneCalls.control(app, org.json.JSONObject(message).optString("action"))
        // Drive Mode: music that follows the driving, played here
        if (type == "drive") DriveMode.handle(app, org.json.JSONObject(message))
        // the Car Thing's voice: "take me home", "call Mom"
        if (type == "navigate") VoiceActions.navigate(app, conn, org.json.JSONObject(message).optString("to"))
        if (type == "place_call") VoiceActions.call(app, conn, org.json.JSONObject(message).optString("who"))
        // what Wisp's own rules didn't understand, for the phone's model
        if (type == "think") WispThink.handle(conn, org.json.JSONObject(message))
        // Download, pressed on the Car Thing's "smarter voice" pop-up
        if (type == "think_download") WispThink.downloadFromCar()
        // a Wisp update, downloaded here and handed over the tether
        if (type == "update_fetch") {
            if (ClientFilter.allowed(remote, allowLan = Prefs.allowLan(app))) {
                UpdateRelay.handle(app, conn, org.json.JSONObject(message))
            }
        }
        // the Car Thing's settings, kept for after a reflash
        if (type == "settings_backup") {
            val settings = org.json.JSONObject(message).optJSONObject("settings")
            if (settings != null && message.length < 64 * 1024) {
                Prefs.setSettingsBackup(app, settings.toString())
                // an open Car Thing settings page shows it
                CarSettings.changed()
            }
        }
        // the Car Thing's "Notifications" setting
        if (type == "notifications") {
            NotificationForwarder.setEnabled(org.json.JSONObject(message).optBoolean("enabled", false))
        }
        // play/pause/skip/volume for whatever else the phone is playing
        if (type == "media_control") {
            val msg = try {
                org.json.JSONObject(message)
            } catch (e: org.json.JSONException) {
                return
            }
            MediaWatcher.control(msg.optString("action"), msg.optLong("position_ms", 0L))
        }
    }

    // which repo the Car Thing updates from (a fork's, if set); only over the tether
    private fun sendUpdateAuth(conn: WebSocket) {
        val remote = conn.remoteSocketAddress?.address ?: return
        if (!ClientFilter.allowed(remote, allowLan = false)) return
        conn.send(
            org.json.JSONObject()
                .put("type", "update_auth")
                .put("repo", Prefs.githubRepo(app))
                .put("token", "")
                .toString(),
        )
    }

    override fun onError(conn: WebSocket?, ex: Exception) {
        Log.w(TAG, "server error", ex)
    }

    companion object {
        const val PORT = 3679
        private const val TAG = "CarThingNav"

        @Volatile
        private var instance: NavServer? = null

        val connectedCars: Int get() = instance?.clients?.get() ?: 0

        /** the last connection turned away, and the last one let in, for the status screen */
        @Volatile
        var lastRefused: String? = null
            private set

        @Volatile
        var lastConnected: String? = null
            private set
        val running: Boolean get() = instance != null

        /**
         * A change from the Car Thing settings page, to every Car Thing on the
         * tether; false when none is connected to take it
         */
        fun sendSettings(patch: org.json.JSONObject): Boolean {
            val s = instance ?: return false
            val msg = org.json.JSONObject().put("type", "settings_set").put("settings", patch).toString()
            var sent = false
            s.connections.forEach { c ->
                val remote = c.remoteSocketAddress?.address
                if (c.isOpen && remote != null && ClientFilter.allowed(remote, allowLan = Prefs.allowLan(s.app))) {
                    c.send(msg)
                    sent = true
                }
            }
            return sent
        }

        /** after the token is changed in the app */
        fun pushUpdateAuth() {
            val s = instance ?: return
            s.connections.forEach { if (it.isOpen) s.sendUpdateAuth(it) }
        }

        @Synchronized
        fun ensureStarted(ctx: Context) {
            if (instance != null) return
            instance = NavServer(ctx.applicationContext).apply {
                isReuseAddr = true
                isDaemon = true
                start()
            }
        }
    }
}
