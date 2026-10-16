SUMMARY = "Wisp OS runtime"
DESCRIPTION = "The board's runtime, the graphics stack and kiosk, and Wisp itself"
LICENSE = "MIT"
LIC_FILES_CHKSUM = "file://${COMMON_LICENSE_DIR}/MIT;md5=0835ade698e0bcf8506ecda2f7b4f302"

inherit packagegroup

PACKAGES = "${PN}"

RDEPENDS:${PN} = " \
    packagegroup-superbird-runtime \
    \
    mesa \
    weston \
    blank-cursor \
    cursor-suppress \
    superbird-fbpaint \
    superbird-weston-init-kiosk \
    chromium-ozone-wayland \
    chromium-kiosk \
    \
    wisp-system \
    wisp-daemon \
    wisp-ui \
    wisp-voice \
    \
    bash \
    curl \
    iproute2 \
    iptables \
    bluez5-noinst-tools \
"
