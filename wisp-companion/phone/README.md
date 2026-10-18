# Wisp Phone

Wisp on a phone alone, no Car Thing: the phone, held sideways in a car mount,
shows Wisp's screens and runs Wisp itself. The Car Thing's buttons become a
strip down the right edge (Home, Wisp, Back), and the phone's back button is
Wisp's Back.

Inside the app:

- **wisp-daemon**, the Car Thing's own background program, built for 64-bit ARM
  Android and shipped as `libwispd.so` (`WispService.kt` runs it and restarts it
  if it stops). Its settings are `src/main/assets/config.yml`: no Bluetooth link,
  no over-the-air updates, and voice off for now.
- **wisp-ui**, the Car Thing's screens, opened with `?phone` (`wisp-ui/src/phone.ts`):
  they fill the phone's height and stretch to its width beside the strip, and
  Spotify's sign-in opens in the phone's browser.

## Build

Needs Go and Node besides the Android SDK. `scripts/phone-parts.sh` builds the
daemon and the screens into `src/main/jniLibs` and `src/main/assets/ui` (left
out of git); Gradle runs it before every build of this app.

```
./gradlew :phone:assembleDebug
```

`-Pwisp.skipParts` builds with what's already there.

## Not yet

- Hands-free "Okay Wisp" (the wake word and speech-to-text, for Android).
- Directions, calls, notifications and Wisp's spoken voice, which the Car Thing
  gets from the Wisp app.
- Settings that only mean something on a Car Thing (brightness, performance
  mode) still show.
