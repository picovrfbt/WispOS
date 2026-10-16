SUMMARY = "Wisp daemon"
DESCRIPTION = "The Car Thing's Spotify Connect observer, library, phone link, voice and updater (wisp-daemon, a go-librespot fork), built for arm64 by scripts/prepare.sh."
LICENSE = "GPL-3.0-only"
LIC_FILES_CHKSUM = "file://${COMMON_LICENSE_DIR}/GPL-3.0-only;md5=c79ff39f19dfec6d293b95dea7b07891"

# payload/ is staged by scripts/prepare.sh (and gitignored): the arm64
# daemon, its config, the lyrics provider's keys (may be empty) and the iPhone
# volume sidecar (absent when Rust isn't installed)
SRC_URI = " \
    file://payload/ \
    file://wisp-daemon-start \
    file://wisp-daemon.service \
    file://wisp-app-dir \
"
S = "${UNPACKDIR}"

inherit systemd

SYSTEMD_SERVICE:${PN} = "wisp-daemon.service"
SYSTEMD_AUTO_ENABLE = "enable"

RDEPENDS:${PN} = "wisp-system bluez5 busybox"

# a Go binary built outside the build system: static, already stripped
INSANE_SKIP:${PN} = "already-stripped ldflags"
INHIBIT_PACKAGE_STRIP = "1"
INHIBIT_SYSROOT_STRIP = "1"

do_install() {
    install -d ${D}${sbindir} ${D}${libexecdir}/wisp ${D}${sysconfdir}/go-librespot
    install -m 0755 ${S}/payload/go-librespot ${D}${sbindir}/go-librespot
    install -m 0644 ${S}/payload/config.yml ${D}${sysconfdir}/go-librespot/config.yml
    if [ -s ${S}/payload/lp.env ]; then
        install -m 0600 ${S}/payload/lp.env ${D}${sysconfdir}/go-librespot/lp.env
    fi
    if [ -f ${S}/payload/iap2-sidecar ]; then
        install -d ${D}${bindir}
        install -m 0755 ${S}/payload/iap2-sidecar ${D}${bindir}/iap2-sidecar
    fi
    install -m 0755 ${S}/wisp-daemon-start ${D}${libexecdir}/wisp/wisp-daemon-start
    # where the original firmware's scripts and the updater look for it
    install -d ${D}/usr/libexec
    install -m 0755 ${S}/wisp-app-dir ${D}/usr/libexec/wisp-app-dir

    install -d ${D}${systemd_system_unitdir}
    install -m 0644 ${S}/wisp-daemon.service ${D}${systemd_system_unitdir}/
}

FILES:${PN} = " \
    ${sbindir}/go-librespot ${bindir}/iap2-sidecar \
    ${sysconfdir}/go-librespot \
    ${libexecdir}/wisp/wisp-daemon-start /usr/libexec/wisp-app-dir \
    ${systemd_system_unitdir}/wisp-daemon.service \
"
CONFFILES:${PN} = "${sysconfdir}/go-librespot/config.yml"
