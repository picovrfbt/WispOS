package daemon

// Wisp runs on two systems: its original firmware (Void Linux on the Car
// Thing's 4.9 kernel, Chrome 69, services under runit) and Wisp OS (Yocto on a
// mainline kernel, Chromium 147 with GPU compositing, services under systemd).
// Wisp OS writes /etc/wisp-os. On it, `sv` and `uenv` are small shims onto
// systemctl and the u-boot environment, so most of the daemon is the same on both
var wispOS = fileExists("/etc/wisp-os")

// sysPath is one of the system's own files: Wisp OS names them for Wisp; the
// original firmware, built on Mira, keeps the names its flash already has
func sysPath(wisp, original string) string {
	if wispOS {
		return wisp
	}
	return original
}

// chromiumProfileDirs are where the browser keeps a profile on each system
func chromiumProfileDirs() []string {
	if wispOS {
		return []string{"/var/lib/chromium-kiosk"}
	}
	return []string{"/var/cache/chrome_storage"}
}
