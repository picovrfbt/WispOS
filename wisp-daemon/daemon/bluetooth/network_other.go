//go:build !linux

package bluetooth

import "errors"

// Desktop dev builds have no bnep0, netlink or BT mgmt socket. These stand in
// for network_linux.go so the daemon and its API run on Windows/macOS against
// the machine's own internet connection.

func (m *Manager) monitorNetworkInterfaces() {}

func (m *Manager) routeArbiterLoop() {}

func (m *Manager) watchMgmtDisconnects() error {
	return errors.New("bt mgmt socket is linux-only")
}

// tetherRouteDemoted reports whether bnep0's default route is demoted, and whether there is one
func tetherRouteDemoted() (demoted, ok bool) { return false, false }

// PanGateway is the tethering phone's address; desktop builds have no tether
func PanGateway() string { return "" }
