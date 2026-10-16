# Wisp Companion (Android)

Sends Google Maps turn-by-turn and your phone's position to the Car Thing.
Free, no account, no Play Services.

- Reads Google Maps' **navigation notification**: the maneuver arrow, the
  distance, the instruction and the trip line (minutes · miles · ETA).
- Shares **GPS once a second, only while a Car Thing is connected**, so the
  map can follow you.
- Serves both on `ws://<phone>:3679/nav`. On the Bluetooth tether the phone is
  the Car Thing's gateway, so the daemon finds it with no setup.
- **Wakes Spotify** so the Car Thing can play on this phone. Android drops a
  backgrounded Spotify from Spotify Connect, and the Car Thing can only control
  devices Connect lists. When a Car Thing connects, the app starts Spotify in
  the background (through its media service, the way Android Auto does; nothing
  plays). If you then press play on the Car Thing and the phone still isn't
  listed, it also posts a "tap to open Spotify" notification that clears itself
  after 2 minutes.
- Only the tether can connect. The "Allow connections over Wi-Fi" switch also
  lets in your local network, for testing with the PC simulator. Leave it off
  otherwise, since anyone on that Wi-Fi could then read your location.

## Install

Build (or use the one already built at `app/build/outputs/apk/debug/app-debug.apk`):

```
gradlew.bat assembleDebug
```

Copy the APK to the phone and open it (allow installing from your file
manager), or with USB debugging on:

```
%LOCALAPPDATA%\Android\Sdk\platform-tools\adb.exe install -r app\build\outputs\apk\debug\app-debug.apk
```

Then open **Wisp Companion** and work through the setup buttons:

1. **Notification access**: needed to read Google Maps' directions. Android 13+
   may first make you allow "restricted settings" for sideloaded apps:
   Settings → Apps → Wisp Companion → ⋮ → Allow restricted settings.
2. **Location**.
3. **Location all the time**: Maps is on screen while you drive, so this app
   is in the background.
4. **Notifications**: only for the "open Spotify" prompt.

"Test: wake Spotify now" checks the wake on your phone: close Spotify, press
it, and see whether the phone shows up in Spotify's device list on another
device. The status line shows what happened.

Start directions in Google Maps. The status screen shows what it's sending,
and the last Maps notification it saw, which helps if a Maps update changes the
notification's layout.

## YouTube Music sign-in

Google refuses its sign-in page inside apps, so the app signs in to YouTube
Music the way a TV does: it shows a code, and you allow Wisp at
google.com/device in your own browser. That needs a Google OAuth client, built
into the app:

1. In the [Google Cloud console](https://console.cloud.google.com/), make a
   project and enable the **YouTube Data API v3**.
2. Under **Google Auth Platform**, fill in the app's name (Wisp), choose
   **External**, and set the publishing status to **In production** (in
   Testing, Google signs you out every 7 days). Until Google verifies the app,
   sign-in shows "Google hasn't verified this app": Advanced, then go to Wisp.
3. Under **Clients**, create one of type **TVs and Limited Input devices**.
4. Put its ID and secret in `~/.gradle/gradle.properties` as
   `wisp.googleClientId` and `wisp.googleClientSecret`, and for release builds
   in the repository secrets `WISP_GOOGLE_CLIENT_ID` and
   `WISP_GOOGLE_CLIENT_SECRET`.

Without them the app still builds; its YouTube Music sign-in says it isn't set
up. SoundCloud signs in on soundcloud.com's own page with an email and
password (its "Continue with Google" button hits the same refusal).

## Testing with the PC simulator

Turn on "Allow connections over Wi-Fi", note the `simulator address` on the
status screen, and set it in `dev-device/config/config.yml`:

```yaml
nav:
  phone_url: "ws://192.168.1.23:3679/nav"
```

Or skip the phone entirely: `dev-device\start.ps1 -FakePhone` replays a
recorded drive through San Francisco.
