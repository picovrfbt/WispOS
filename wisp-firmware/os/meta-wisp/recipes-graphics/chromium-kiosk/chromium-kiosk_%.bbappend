# Wisp's kiosk: the UI on localhost (CHROMIUM_KIOSK_URL in conf/distro/wisp.conf)
# once wisp-ui is serving it, plus the knob: Wisp reads the knob as wheel
# events, which cast_shell delivers like any Chromium
do_install:append() {
    cat >> ${D}${sysconfdir}/default/chromium-kiosk <<'ENV'
# Wisp: wait for the UI's server; per-device overrides go in /var/local/etc/kiosk-env
KIOSK_ENV_OVERRIDE_FILE=/var/local/etc/kiosk-env
ENV
    install -d ${D}${systemd_system_unitdir}/chromium-kiosk.service.d
    cat > ${D}${systemd_system_unitdir}/chromium-kiosk.service.d/10-wisp.conf <<'UNIT'
[Unit]
Wants=wisp-ui.service
After=wisp-ui.service
UNIT
}
FILES:${PN} += "${systemd_system_unitdir}/chromium-kiosk.service.d"
