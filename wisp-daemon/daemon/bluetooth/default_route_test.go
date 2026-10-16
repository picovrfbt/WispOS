package bluetooth

import (
	"net"
	"testing"
)

func TestIsDefaultDst(t *testing.T) {
	_, zero, _ := net.ParseCIDR("0.0.0.0/0")
	_, subnet, _ := net.ParseCIDR("10.13.231.0/24")
	_, host, _ := net.ParseCIDR("0.0.0.0/32")
	if !isDefaultDst(nil) {
		t.Fatal("a nil Dst (older netlink) is the default route")
	}
	if !isDefaultDst(zero) {
		t.Fatal("0.0.0.0/0 (netlink >= 1.2) is the default route")
	}
	if isDefaultDst(subnet) || isDefaultDst(host) {
		t.Fatal("a subnet or host route is not the default route")
	}
}
