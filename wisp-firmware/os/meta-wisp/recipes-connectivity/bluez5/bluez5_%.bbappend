# Wisp's Bluetooth settings, from the original firmware's bluetooth.conf: the
# name phones see, the device class Wisp has always had, quick reconnects, and
# re-pairing without a prompt
do_install:append() {
    sed -i -e 's/^#\?Name = .*/Name = Wisp/' \
           -e 's/^Class = .*/Class = 0x02020C/' \
           -e 's/^#\?FastConnectable = .*/FastConnectable = true/' \
           -e 's/^#\?JustWorksRepairing = .*/JustWorksRepairing = always/' \
        ${D}${sysconfdir}/bluetooth/main.conf
    grep -q '^Name = Wisp$' ${D}${sysconfdir}/bluetooth/main.conf
    grep -q '^Class = 0x02020C$' ${D}${sysconfdir}/bluetooth/main.conf
}
