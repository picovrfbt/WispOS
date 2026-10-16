# Wisp's network interface to a PC is usb0 (the daemon and the original
# firmware call it that), and Wisp takes an address from the PC rather than
# serving one: wisp-system's 10-wisp-usb0.network replaces the board's.
do_install:append() {
    for f in $(grep -rl 'uncm' ${D}${sbindir} ${D}${bindir} ${D}${libexecdir} 2>/dev/null); do
        sed -i -e 's/uncm%d/usb%d/' -e 's/Name=uncm\*/Name=usb-board-unused*/' "$f"
    done
}
