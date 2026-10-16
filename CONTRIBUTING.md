# Contributing to Wisp

Thanks for wanting to help. Bug reports, fixes, ideas and drive recordings all make Wisp better.

## Reporting a bug or an idea

[Open an issue](../../issues/new/choose) and pick the form that fits:

- **Car Thing bug**: something on the Car Thing itself (the screen, the knob, Spotify, voice, updates).
- **Wisp app bug**: something in the Android app (directions, calls, Drive Mode, phone media, settings).
- **Idea**: something Wisp could do.

Versions help most: the Car Thing's is in **Settings → Software update**, the app's is at the top of its main screen.

## The parts

| Folder | What it is | Built with |
| --- | --- | --- |
| [`wisp-daemon`](wisp-daemon) | The daemon on the Car Thing: Spotify Connect, the library, the phone link, voice, the updater | Go |
| [`wisp-ui`](wisp-ui) | The screen: a React app shown by the Car Thing's Chrome 69 | Node, Vite, React |
| [`wisp-companion`](wisp-companion) | The Android app (`:app`), the Drive Recorder (`:drive-recorder`) and Drive Mode's shared code (`:drive-core`) | Kotlin, Gradle |
| [`wisp-firmware`](wisp-firmware) | Builds the flashable image and the update bundles | Docker or Linux, `just` |
| [`dev-device`](dev-device) | Runs the real daemon and UI on a PC as a Car Thing simulator | PowerShell |

## Building and testing

**The UI** (Node 24):

```sh
cd wisp-ui
npm ci
npm run dev          # in a browser at http://localhost:5173
npm test
npm run lint
npm run build        # type-checks too (tsc -b)
```

**The daemon** (the Go version in `wisp-daemon/go.mod`):

```sh
cd wisp-daemon
go test ./daemon/ ./ap/ ./apresolve/
bash ./crosscompile.sh armv6      # the Car Thing build
```

**The Android apps** (JDK 17 and the Android SDK):

```sh
cd wisp-companion
./gradlew testDebugUnitTest assembleDebug
```

Your builds are signed with your own debug key, and Android won't install them over a released Wisp app: uninstall that first.

**The simulator** (Windows): `powershell -ExecutionPolicy Bypass -File dev-device\start.ps1` runs the real daemon signed in to your Spotify, with the UI in a Car Thing frame. See [`dev-device/README.md`](dev-device/README.md). It writes your Spotify login to `dev-device/config/state.json`, which git ignores; never share it.

**The firmware image**: see [`wisp-firmware/README.md`](wisp-firmware/README.md).

## Things to know

- **The Car Thing runs Chrome 69.** Newer CSS and JavaScript may not work there, and it's far slower than a desktop. Keep animations to `transform` and `opacity`, and check anything that moves on a real Car Thing if you can.
- **The knob drives everything.** New screens need to work with the knob and the back button, not only touch.
- **Tests come with changes.** Add or update tests next to the code you touch (`__tests__` folders in the UI, `*_test.go` in the daemon, `src/test` in the app).
- **Match the code around you**: its naming, comment style and how it's laid out. Run `npm run format` in `wisp-ui`.
- **Nothing personal in screenshots or tests**: use made-up songs, names and places.

## Pull requests

1. Fork the repo and make a branch.
2. Keep each pull request to one change, with the tests passing.
3. Say what it changes and how you checked it (on a Car Thing, in the simulator, in the emulator).

## Releases

Maintainers cut releases from the [release workflow](.github/workflows/release.yml): it tests and builds the daemon and UI into the over-the-air update, builds and signs the Android apps, and publishes them on the [releases page](../../releases). The flashable image is built separately with `wisp-firmware` and attached by hand. What changed goes in the release notes and in [CHANGELOG.md](CHANGELOG.md).

## Licenses

By contributing you agree your work is shared under the license of the part you changed: GPL-3.0 for `wisp-daemon`, Apache-2.0 for everything else. See [Licenses](README.md#-licenses).
