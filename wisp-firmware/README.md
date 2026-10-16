# wisp-firmware

Builds what goes on the Car Thing. Part of [Wisp](../README.md).

There are two systems:

| | Wisp OS ([`os/`](os)) | The original firmware (this folder) |
| --- | --- | --- |
| Base | Yocto on a mainline 7.x kernel ([yocto-superbird](https://github.com/JoeyEamigh/yocto-superbird)) | Void Linux on the Car Thing's stock 4.9 kernel |
| Screen | Chromium 147, drawing on the graphics chip (Panfrost) | Chrome 69, mostly in software |
| Daemon | 64-bit | 32-bit |
| Updates | Wisp's updates, plus whole-system A/B updates | Wisp's updates |

Wisp OS is where Wisp is heading; see [`os/README.md`](os/README.md). The rest
of this file is the original firmware.

## Flashing

See [Getting started](../README.md#-getting-started) in Wisp's README.

## Building the original firmware

From this folder, with `wisp-daemon` and `wisp-ui` beside it (as in this
repo), on Linux or WSL:

Toolchains

- Go
- `npm` (or `bun`)
- `huggingface-cli` or `git-lfs`, for the voice models
- Rust + `rustup target add armv7-unknown-linux-musleabihf`, for iPhone volume (optional)

Image tools: `curl`, `zip`/`unzip`, `genimage`, `m4`, `xbps-install`,
`mkpasswd` and `patchelf`. `xbps-install` runs on any distro from the
[Void Linux static binaries](https://docs.voidlinux.org/xbps/troubleshooting/static.html).

> Don't extract `xbps-static` blindly into your root filesystem; pin the destination:
>
> ```
> sudo tar --no-overwrite-dir --no-same-owner --no-same-permissions -xvf xbps-static-latest.x86_64-musl.tar.xz -C /
> ```

On a host that isn't arm64, register QEMU once:

```
docker run --rm --privileged multiarch/qemu-user-static --reset -p yes
```

Then build in Docker (or `just run` on the host):

```
IMAGE_VERSION=vX.Y.Z just docker-run
```

Output lands in `output/`. Don't use `sudo`: it resets `PATH`, so tools in your
home directory (`cargo`, `bun`) vanish. Add yourself to the `docker` group instead.

Without the on-device voice (no model download, much smaller):

```
BUNDLE_VOICE=0 just docker-run
```

The over-the-air update for a release: `just app-bundle vX.Y.Z` after `just prepare`.

## Attributions

Wisp grew out of [Mira](https://github.com/mira-thing); this builder came with it, and was itself forked from [usenocturne/nocturne](https://github.com/usenocturne/nocturne) - credit to Brandon Saldan, shadow, Dominic Frye, and bbaovanc for the original work it builds on

Their builder was itself based on:

- [raspi-alpine/builder](https://gitlab.com/raspi-alpine/builder) by Benjamin Böhmke and Duncan Bellamy
- [JoeyEamigh/nixos-superbird](https://github.com/JoeyEamigh/nixos-superbird)
- [bishopdynamics' superbird-tool](https://github.com/bishopdynamics/superbird-tool) and modified [aml-imgpack](https://github.com/bishopdynamics/aml-imgpack)
- [Thing Labs' superbird-tool fork](https://github.com/thinglabsoss/superbird-tool)

The bundled kernel (`resources/kernel/boot_custom.dump`) is a patched fork of Thing Labs'/spsgsb [kernel-common](https://github.com/thinglabsoss).

## License

This firmware builder is **Apache 2.0**.

The bundled kernel image is **GPL-2.0** (Linux), a patched fork of Thing Labs'/spsgsb kernel-common. The complete corresponding source is available to any third party on request for at least three years from distribution: open an issue on this repo.

> "Spotify" and "Car Thing" are trademarks of Spotify AB. This software is not affiliated with or endorsed by Spotify AB.
