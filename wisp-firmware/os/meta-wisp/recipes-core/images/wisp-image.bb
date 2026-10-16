SUMMARY = "Wisp OS"
DESCRIPTION = "Wisp on a mainline kernel: the daemon, the UI in Chromium 147 on the GPU, the voice stack, read-only root, A/B slots."
LICENSE = "MIT"

inherit core-image
inherit superbird-headroom-check
inherit superbird-image
inherit mainline-flashthing

IMAGE_FEATURES += "ssh-server-openssh"

# root's password: scripts/prepare.sh sets EXTRA_USERS_PARAMS from
# DEFAULT_ROOT_PASSWORD, the same setting and default as the original firmware
inherit extrausers

IMAGE_INSTALL = " \
    packagegroup-core-boot \
    packagegroup-wisp \
"

BAD_RECOMMENDATIONS += "kernel-modules udev-hwdb wpa-supplicant wireless-regdb wireless-regdb-static weston-init"

# read-only ext4 root, as the board layer's production kiosk image
EXTRA_IMAGECMD:ext4 = "-i 16384 -m 0 -O ^has_journal -O ^huge_file"
IMAGE_FSTYPES = "wic ext4 ext4.zck ext4.zck.zckheader"
IMAGE_CLASSES += "image_types_zchunk"
IMAGE_OVERHEAD_FACTOR = "1.0"
IMAGE_ROOTFS_EXTRA_SPACE = "4096"

WKS_FILE = "superbird-mainline.wks.in"
do_image_wic[depends] += " \
    virtual/kernel:do_deploy \
    superbird-uenv:do_deploy \
    superbird-extlinux:do_deploy \
    superbird-logo:do_deploy \
"
EXTRA_IMAGEDEPENDS += "superbird-uboot"
