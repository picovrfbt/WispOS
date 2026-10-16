# Wisp's splash behind the kiosk until the UI draws (files/wisp-splash.png),
# named by SUPERBIRD_WESTON_SPLASH_IMAGE in conf/distro/wisp.conf
FILESEXTRAPATHS:prepend := "${THISDIR}/files:"

# the knob turns the way it did on the original firmware: libinput's natural
# scrolling flips the wheel so clockwise moves forward through lists
# (weston reads natural-scroll with a hyphen; natural_scroll is ignored)
do_install:append() {
    ini=${D}${sysconfdir}/weston-kiosk.ini
    if grep -q '^\[libinput\]' $ini; then
        sed -i '/^\[libinput\]/a natural-scroll=true' $ini
    else
        printf '\n[libinput]\nnatural-scroll=true\n' >> $ini
    fi
}
