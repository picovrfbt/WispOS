package bluetooth

import "net"

// isDefaultDst reports whether a route's destination is the default route.
// netlink leaves Dst nil for it in older versions and fills in 0.0.0.0/0
// (as iproute2 does) since v1.2, so both have to count; matching only nil
// found no default route at all, and with it no tether gateway.
func isDefaultDst(dst *net.IPNet) bool {
	if dst == nil {
		return true
	}
	ones, _ := dst.Mask.Size()
	return ones == 0 && dst.IP.IsUnspecified()
}
