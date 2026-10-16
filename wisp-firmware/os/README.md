# Wisp OS

Wisp on a modern system: a mainline Linux 7.x kernel, the open-source Panfrost
driver for the Car Thing's Mali-G31, and Chromium 147 compositing on the GPU in
place of the stock Chrome 69. Everything Wisp does stays the same; the screen
gets faster and current web features become available to every screen after this.

> **Status:** builds, not yet run on a Car Thing. The first flash is the test.

## What's in it

| Layer | From |
| --- | --- |
| Kernel, u-boot, panel, touch, knob, Bluetooth, mic, light sensor, A/B slots, Chromium kiosk | [yocto-superbird](https://github.com/JoeyEamigh/yocto-superbird) (MIT), pinned in [`kas/wisp.yml`](kas/wisp.yml) |
| Wisp: the daemon (64-bit), the UI, the voice, and how they fit the system | [`meta-wisp/`](meta-wisp), this layer |

What `meta-wisp` adds:

- **[`wisp-daemon`](meta-wisp/recipes-wisp/wisp-daemon)**: the 64-bit daemon and its start script, which keeps the original firmware's behaviour: the config copied to the data partition, installed updates run unless they keep crashing, the shorter Bluetooth advertising interval.
- **[`wisp-ui`](meta-wisp/recipes-wisp/wisp-ui)**: the UI, served on `localhost` to the kiosk.
- **[`wisp-voice`](meta-wisp/recipes-wisp/wisp-voice)**: the on-device voice bundle ("Okay Wisp").
- **[`wisp-system`](meta-wisp/recipes-wisp/wisp-system)**: the phone's tether and a PC's internet (systemd-networkd), clock sync, brightness (the board's light sensor for auto, the slider for manual), the ssh guard on the Bluetooth link, and two small shims, `sv` and `uenv`, so the daemon's service and reset calls work on both systems.
- **Kernel additions** ([`wisp.cfg`](meta-wisp/recipes-kernel/linux/files/wisp.cfg)): Bluetooth tethering (BNEP) and the firewall.
- Wisp's name and Bluetooth settings, and the board's USB network interface as `usb0`, taking internet from a PC.

The daemon knows which system it's on from `/etc/wisp-os`
([`platform.go`](../../wisp-daemon/daemon/platform.go)), and over-the-air updates
fetch the 64-bit bundle (`wisp-core-<tag>-arm64.tar.gz`) there.

## Building

On Linux or in WSL, with Docker, [kas](https://kas.readthedocs.io/) and a
user that isn't root (Yocto refuses root). The build needs a Linux filesystem;
on Windows, build from a copy inside WSL.

```sh
sh scripts/prepare.sh v0.3.0     # stage Wisp: 64-bit daemon, UI, voice, sidecar
kas-container build kas/wisp.yml
```

The first build fetches yocto-superbird's shared cache, so most of it (Chromium
included) arrives prebuilt; on a 20-core PC it takes well under an hour.

The flashable zip lands at
`build/tmp/deploy/images/superbird/wisp-image-superbird-flashthing.zip`.

## Flashing

Like the original firmware: hold buttons 1 and 4 while plugging in, then
[Terbium](https://terbium.app) → **Local archive** with the zip (or
`flashthing-cli`). This writes a new bootloader as well as the system.

**Going back** to the original firmware should be the same: flash its zip the
same way. That path hasn't been tried from Wisp OS yet, so test it before
relying on it.

## Recovery

- The system has two slots. If a new one fails to boot three times, u-boot goes back to the other.
- Settings → Reset (or `uenv set firstboot 1`) wipes the data partition on the next boot.
