SUMMARY = "Wisp OS system update (.swu)"
DESCRIPTION = "The whole system as one over-the-air update: the boot and root \
partitions of wisp-image, zstd-compressed, written by swupdate to the A/B slot \
that isn't running. The daemon downloads it from a Wisp release \
(wisp-daemon/daemon/updater_system.go)."

require recipes-core/superbird-bsp-update/superbird-bsp-update.inc

# Wisp's own sw-description in place of the board layer's raw one: the same
# slots and boot counters, with both images compressed (about 215 MB for the
# whole system instead of 700) and their sha256 checked before they're written
FILESEXTRAPATHS:prepend := "${THISDIR}/files:"

SUPERBIRD_OTA_SOURCE_IMAGE = "wisp-image"
SUPERBIRD_OTA_SYSTEM_ARTIFACT = "${SUPERBIRD_OTA_SOURCE_LINKNAME}.ext4.zst"
SUPERBIRD_OTA_SYSTEM_CPIO_NAME = "system.img.zst"
SUPERBIRD_OTA_BOOT_CPIO_NAME = "boot.vfat.zst"

DEPENDS += "zstd-native"

# the board layer stages boot.vfat as it is; most of its 64 MB is empty
do_stage_swu_inputs:append() {
    zstd -q -f -19 -c ${DEPLOY_DIR_IMAGE}/${SUPERBIRD_OTA_BOOT_ARTIFACT} \
        > ${DEPLOY_DIR_IMAGE}/${SWU_STAGEDIR}/${SUPERBIRD_OTA_BOOT_CPIO_NAME}
}
do_stage_swu_inputs[depends] += "zstd-native:do_populate_sysroot"
