SUMMARY = "Wisp OS delta system update (.swu)"
DESCRIPTION = "The system as only what changed: the zchunk headers (chunk lists) \
of wisp-image's boot and root partitions. swupdate keeps the chunks the running \
slot already has and fetches the rest by byte range from the daemon \
(wisp-daemon/daemon/updater_delta.go), which gets them from the release's \
wisp-os-<v>-system.zck and wisp-os-<v>-boot.zck."

SUPERBIRD_OTA_SW_DESCRIPTION_VARIANT = "delta"

require recipes-core/superbird-bsp-update/superbird-bsp-update.inc

# the daemon's range proxy; also the board layer's default
SUPERBIRD_OTA_DELTA_URL_BASE = "http://127.0.0.1:8893"

SUPERBIRD_OTA_SOURCE_IMAGE = "wisp-image"
SUPERBIRD_OTA_SYSTEM_ARTIFACT = "${SUPERBIRD_OTA_SOURCE_LINKNAME}.ext4.zck.zckheader"
SUPERBIRD_OTA_SYSTEM_CPIO_NAME = "system.img.zck.zckheader"

SUPERBIRD_OTA_BOOT_ARTIFACT = "boot.vfat.zck.zckheader"
SUPERBIRD_OTA_BOOT_CPIO_NAME = "boot.vfat.zck.zckheader"
