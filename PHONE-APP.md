# Wisp Phone: where it stands

This branch (`phone-app`) holds **Wisp Phone**: Wisp on a phone alone, no Car
Thing. You mount the phone sideways in the car; it shows Wisp's screens and
runs Wisp itself. It's a separate app from the Wisp app, so the two can sit
side by side. Not released yet, and nothing here is on `main`.

## Try it

Every push to this branch builds a test copy on GitHub (`.github/workflows/phone.yml`):
Actions → the latest **phone** run → Artifacts → **wisp-phone-test** (a zip with
`phone-debug.apk` inside). It's signed with a test key, so it installs beside
the Wisp app, but the eventual release won't install over it: uninstall it first.

## What's done

- **The app** (`wisp-companion/phone`, app id `dev.carthingfw.wispphone`):
  - Runs Wisp's background program, the Car Thing's own `wisp-daemon` built for
    Android, kept going by a small "Wisp is on" notification (`WispService.kt`).
  - Shows Wisp's screens full-screen and sideways (`MainActivity.kt`); the phone's
    back button is Wisp's Back.
  - Gives the program what Android doesn't: a home folder, a temporary folder,
    and the phone's DNS servers (Android has no `resolv.conf`; see
    `wisp-daemon/cmd/wisp-daemon/dns_android.go`).
- **Phone mode in the screens** (`wisp-ui/src/phone.ts`, opened with `?phone`):
  - Screens fill the phone's height and stretch to its width.
  - The Car Thing's buttons become a strip down the right: Home, Wisp, Back
    (`components/PhoneRail`).
  - Spotify sign-in is a **Sign in with Spotify** button that opens the browser,
    not a QR code.
  - No Car Thing connection screens (pair a phone, use a computer): instead
    "No internet" or "Starting Wisp…" (`components/PhoneOffline`).
  - When Wisp won't start, or the sign-in code doesn't come, the screen shows
    the end of Wisp's log, for a screenshot (`hooks/usePhoneDaemonLog.ts`).
  - Settings leaves out what only a Car Thing has: Bluetooth, brightness,
    performance and temperatures, the top buttons, Car Thing updates and the
    Phone section.
- The Car Thing itself is unchanged: phone mode only switches on in the app.

## Fixed after trying it on a real phone

1. The Car Thing's "connect a phone or computer" screen showed → replaced.
2. Wisp didn't start ("neither $XDG_CONFIG_HOME nor $HOME are defined") → the
   app now gives it a home folder.
3. The sign-in button didn't show → most likely the program couldn't look up
   Spotify's address: the app now has permission to read the phone's DNS
   servers, with IPv4 and IPv6 public ones as backup. If the button still
   doesn't come, the sign-in screen shows Wisp's log after 15 seconds:
   **send a screenshot of it**.

## Next

- Get past sign-in on a real phone, then check music, Home, lyrics and the map.
- Hands-free "Okay Wisp": the wake word and speech-to-text for Android
  (the Car Thing's are Car Thing programs), with a setting to turn it off for
  battery. The Wisp button on the strip says voice isn't available until then.
- Directions, calls, notifications and Wisp's spoken voice, which the Car
  Thing gets from the Wisp app: bring those parts of the Wisp app into this one.
- The background program checks the internet by running `ping` every second;
  on a phone that should be gentler on the battery.
- A release: a real version number, the Wisp release key, and a download on
  the releases page and the website.

## Building it yourself

Needs the Android SDK, Go and Node. `./gradlew :phone:assembleDebug` in
`wisp-companion`; `scripts/phone-parts.sh` builds the daemon and the screens
into the app first (only when this app is what's being built, so the Wisp
app's builds don't need Go or Node). More in `wisp-companion/phone/README.md`.
