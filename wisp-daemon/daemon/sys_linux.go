//go:build linux

package daemon

import (
	"os"
	"syscall"
)

// linux-only syscalls; sys_other.go stands in for them on a desktop dev build

// onDevice gates commands that act on the machine itself (reboot, suspend, reset)
const onDevice = true

func ioctl(fd, req, arg uintptr) error {
	if _, _, errno := syscall.Syscall(syscall.SYS_IOCTL, fd, req, arg); errno != 0 {
		return errno
	}
	return nil
}

func diskFreeMB(path string) int {
	var st syscall.Statfs_t
	if err := syscall.Statfs(path, &st); err != nil {
		return 0
	}
	return int(uint64(st.Bavail) * uint64(st.Bsize) / (1024 * 1024))
}

// signalListen asks the wake listener to capture a command now (its SIGUSR1)
func signalListen(p *os.Process) error { return p.Signal(syscall.SIGUSR1) }

// helper processes die with the daemon
func dieWithDaemon() *syscall.SysProcAttr {
	return &syscall.SysProcAttr{Pdeathsig: syscall.SIGKILL}
}

// reniceChrome gives the browser's processes a niceness (performance mode)
func reniceChrome(nice int) {
	for _, pid := range chromePids("/proc") {
		_ = syscall.Setpriority(syscall.PRIO_PROCESS, pid, nice)
	}
}
