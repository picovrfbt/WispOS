SUMMARY = "Wisp UI"
DESCRIPTION = "Wisp's screen (wisp-ui's production build) and the static server Chromium loads it from."
LICENSE = "Apache-2.0"
LIC_FILES_CHKSUM = "file://${COMMON_LICENSE_DIR}/Apache-2.0;md5=89aea4e17d99a7cacdbeed46a0096b10"

# payload/ is staged by scripts/prepare.sh: ui/ (wisp-ui's dist) and
# static-web-server (its aarch64 release binary)
SRC_URI = " \
    file://payload/ \
    file://wisp-ui-start \
    file://wisp-ui.service \
"
S = "${UNPACKDIR}"

inherit systemd

SYSTEMD_SERVICE:${PN} = "wisp-ui.service"
SYSTEMD_AUTO_ENABLE = "enable"

RDEPENDS:${PN} = "wisp-daemon"

INSANE_SKIP:${PN} = "already-stripped ldflags"
INHIBIT_PACKAGE_STRIP = "1"

do_install() {
    install -d ${D}${bindir} ${D}${libexecdir}/wisp ${D}${sysconfdir}/wisp/ui
    install -m 0755 ${S}/payload/static-web-server ${D}${bindir}/static-web-server
    cp -R --no-preserve=ownership ${S}/payload/ui/. ${D}${sysconfdir}/wisp/ui/
    install -m 0755 ${S}/wisp-ui-start ${D}${libexecdir}/wisp/wisp-ui-start
    install -d ${D}${systemd_system_unitdir}
    install -m 0644 ${S}/wisp-ui.service ${D}${systemd_system_unitdir}/
}

FILES:${PN} = " \
    ${bindir}/static-web-server \
    ${sysconfdir}/wisp/ui \
    ${libexecdir}/wisp/wisp-ui-start \
    ${systemd_system_unitdir}/wisp-ui.service \
"
