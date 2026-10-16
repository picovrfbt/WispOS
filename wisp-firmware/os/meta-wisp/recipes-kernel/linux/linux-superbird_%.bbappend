# what Wisp needs on top of the board's kernel (files/wisp.cfg)
FILESEXTRAPATHS:prepend := "${THISDIR}/files:"
SRC_URI += "file://wisp.cfg"
