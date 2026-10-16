# wisp-daemon

Wisp's daemon on the Car Thing: Spotify Connect, the library, the phone link,
voice and over-the-air updates. Part of [Wisp](../README.md).

wisp-daemon does not play audio. It runs as a non-playable Spotify Connect
device that watches what's playing on your other devices, gives the state to
[wisp-ui](../wisp-ui) over HTTP and WebSocket, and sends controls back to
whichever device is playing.

## Features

- **Observer-only Spotify Connect**: reads the dealer's cluster updates and sends controls to the active device through the Connect-state protocol (spclient), not the Web API.
- **HTTP/WebSocket API** for the UI: `/observer/status`, `/player/*`, `/auth/*`, `/bluetooth/*`, `/network/status`, `/lyrics/*`, `/nav/*`, `/phone/*`, plus the `/events` WebSocket.
- **Sign-in by QR** (the RFC 8628 device flow).
- **Bluetooth**: BlueZ pairing, the phone's tether (PAN), and the knob as a volume control for the phone.
- **The phone link**: directions, the route, calls, notifications and other music apps from the Wisp app.
- **Synced lyrics** from a primary provider, falling back to LRCLIB.
- **On-device voice**: the "Okay Wisp" wake word, speech-to-text and a phonetic match against your library, all on the Car Thing.
- **Updates** from this project's GitHub releases, with rollback to the previous update.

## Building

```bash
go build ./cmd/wisp-daemon
```

For the Car Thing:

```bash
./crosscompile.sh armv6   # the original firmware (32-bit userland)
./crosscompile.sh arm64   # Wisp OS
```

## License

GPLv3, see [LICENSE](LICENSE). Inherited from upstream `devgianlu/go-librespot`. As a derivative work, all modifications in this repo are also GPLv3.

The original Spotify Connect protocol implementation and most of the audio, dealer, spclient, and login5 packages are authored by [devgianlu](https://github.com/devgianlu) and the go-librespot contributors. Full authorship history is preserved in the git log of this repo.

For upstream's docs (Docker setup, standalone usage, etc.), see the upstream README at https://github.com/devgianlu/go-librespot.

## Attributions

Wisp grew out of [Mira](https://github.com/mira-thing)'s daemon.

wisp-daemon is a heavily modified fork of [`devgianlu/go-librespot`](https://github.com/devgianlu/go-librespot) - the Spotify Connect protocol implementation and most of the dealer, spclient, and login5 packages are authored by devgianlu and the go-librespot contributors.

iOS volume control is built on [`usenocturne/iap2-rs`](https://github.com/usenocturne/iap2-rs), Nocturne's iAP2 protocol implementation, in [`iap2/`](iap2/).

> "Spotify" and "Car Thing" are trademarks of Spotify AB. This software is not affiliated with or endorsed by Spotify AB.
