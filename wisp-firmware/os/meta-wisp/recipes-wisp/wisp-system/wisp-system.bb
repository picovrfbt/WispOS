SUMMARY = "Wisp OS system integration"
DESCRIPTION = "What the daemon expects of the system: the sv and uenv shims, networking for the phone's tether and a PC, clock sync, brightness, the ssh guard, Bluetooth settings and the data directories."
LICENSE = "Apache-2.0"
LIC_FILES_CHKSUM = "file://${COMMON_LICENSE_DIR}/Apache-2.0;md5=89aea4e17d99a7cacdbeed46a0096b10"

SRC_URI = " \
    file://sv \
    file://uenv \
    file://10-wisp-usb0.network \
    file://20-wisp-bnep.network \
    file://wisp-clock-sync \
    file://wisp-clock-sync.service \
    file://wisp-brightness \
    file://wisp-brightness.service \
    file://wisp-firewall.service \
    file://bluetoothd-wisp.conf \
    file://sysctl-wisp.conf \
    file://tmpfiles-wisp.conf \
"
S = "${UNPACKDIR}"

inherit systemd allarch

SYSTEMD_SERVICE:${PN} = "wisp-clock-sync.service wisp-brightness.service wisp-firewall.service"
SYSTEMD_AUTO_ENABLE = "enable"

RDEPENDS:${PN} = "bash curl iptables iproute2 libubootenv-bin superbird-als"

do_install() {
    install -d ${D}${bindir} ${D}${libexecdir}/wisp
    install -m 0755 ${S}/sv ${S}/uenv ${D}${bindir}/
    install -m 0755 ${S}/wisp-clock-sync ${S}/wisp-brightness ${D}${libexecdir}/wisp/

    install -d ${D}${systemd_system_unitdir}
    install -m 0644 ${S}/wisp-clock-sync.service ${S}/wisp-brightness.service \
        ${S}/wisp-firewall.service ${D}${systemd_system_unitdir}/
    install -d ${D}${systemd_system_unitdir}/bluetooth.service.d
    install -m 0644 ${S}/bluetoothd-wisp.conf ${D}${systemd_system_unitdir}/bluetooth.service.d/10-wisp.conf

    install -d ${D}${sysconfdir}/systemd/network
    install -m 0644 ${S}/10-wisp-usb0.network ${S}/20-wisp-bnep.network ${D}${sysconfdir}/systemd/network/

    install -d ${D}${sysconfdir}/sysctl.d ${D}${sysconfdir}/tmpfiles.d
    install -m 0644 ${S}/sysctl-wisp.conf ${D}${sysconfdir}/sysctl.d/30-wisp.conf
    install -m 0644 ${S}/tmpfiles-wisp.conf ${D}${sysconfdir}/tmpfiles.d/wisp.conf

    # the daemon tells the two systems apart by this file (wisp-daemon/daemon/platform.go)
    echo "${DISTRO_VERSION}" > ${D}${sysconfdir}/wisp-os
    # the flashed version, which the updater compares installed updates with
    install -d ${D}${sysconfdir}/wisp
    echo "v${DISTRO_VERSION}" > ${D}${sysconfdir}/wisp/version.txt
}

FILES:${PN} = " \
    ${bindir}/sv ${bindir}/uenv \
    ${libexecdir}/wisp \
    ${systemd_system_unitdir} \
    ${sysconfdir}/systemd/network \
    ${sysconfdir}/sysctl.d ${sysconfdir}/tmpfiles.d \
    ${sysconfdir}/wisp-os ${sysconfdir}/wisp/version.txt \
"
