# Voice patches

Wisp's changes to [mira-voice](https://github.com/mira-thing/mira-voice).

- `oww_wake-manual-listen.patch`: SIGUSR1 makes the wake listener capture a
  command immediately, as if the wake word had been heard. The daemon sends it
  for `POST /voice/listen`, which is what the Voice button calls.

The built binary is `../voice-bin/oww_wake` (aarch64). The firmware build
installs it over the one in the voice bundle. To rebuild it, apply the patch
to `mira-voice/src/oww_wake.c` and build mira-voice's toolchain image:

```
docker build -t oww-wake-aarch64 .
docker cp "$(docker create oww-wake-aarch64)":/build/oww_wake ../wisp-firmware/voice-bin/oww_wake
```
