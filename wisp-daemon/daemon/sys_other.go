//go:build !linux

package daemon

import (
	"errors"
	"os"
	"syscall"
)

// desktop dev build: no uinput, statfs or parent-death signal

// onDevice is false here, so the power menu's reboot, sleep and reset only log
// instead of running Car Thing commands against the developer's PC
const onDevice = false

func ioctl(_, _, _ uintptr) error { return errors.New("ioctl is linux-only") }

func diskFreeMB(_ string) int { return 0 }

func dieWithDaemon() *syscall.SysProcAttr { return nil }

func signalListen(_ *os.Process) error { return errors.New("no wake listener on this platform") }

// reniceChrome: only the device runs the browser
func reniceChrome(int) {}
