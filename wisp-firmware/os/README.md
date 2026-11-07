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

## System updates

Wisp OS updates over the air as a whole system too, not only Wisp's own
software. The build also makes `wisp-os-update-superbird.swu`
([`wisp-os-update`](meta-wisp/recipes-core/wisp-os-update)): the boot and root
partitions, zstd-compressed (about 215 MB). Uploaded to a release as
`wisp-os-<version>.swu`, it reaches every Car Thing on an older Wisp OS:

1. The daemon finds it on the latest release (the release workflow carries it forward to later releases) and offers it before any app update.
2. **Only what changed**, when the release has the delta ([`wisp-os-update-delta`](meta-wisp/recipes-core/wisp-os-update-delta)): `swupdate` compares the new system's chunk lists with the running slot, keeps every chunk it already has, and asks for the rest by byte range. The daemon answers on `127.0.0.1:8893`, fetching those ranges from the release's `.zck` files and keeping them, so a drive that ends mid-update loses nothing ([`updater_delta.go`](../../wisp-daemon/daemon/updater_delta.go)). Every chunk's hash is checked; a delta that fails for any reason but the connection falls back to step 3's whole download.
3. **The whole system** otherwise: it downloads to the data partition, carrying on next time when the car turns off part way, and after the checksum `swupdate` writes it.
4. Either way it goes to the slot that isn't running, and u-boot points at that slot. It takes over at the next start: right away from the update screen, otherwise next time the Car Thing turns on (or Settings → Restart to finish).

If the new system doesn't boot, or boots but Wisp's screen never comes up
within three minutes, the Car Thing goes back to the slot it came from, and that
version isn't offered again. See
[`updater_system.go`](../../wisp-daemon/daemon/updater_system.go).

```sh
just ota v1.0.6                  # after a build: the whole system, the delta, and its two piece files
gh release upload v1.0.6 ../output/wisp-os-v1.0.6.swu ../output/wisp-os-v1.0.6-delta.swu \
  ../output/wisp-os-v1.0.6-system.zck ../output/wisp-os-v1.0.6-boot.zck
```

The original firmware has one slot, so it only takes Wisp's own updates.

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

- The system has two slots. If a new one fails to boot three times, u-boot goes back to the other; if it boots but Wisp doesn't come up, the daemon switches back.
- Settings → Reset (or `uenv set firstboot 1`) wipes the data partition on the next boot.
