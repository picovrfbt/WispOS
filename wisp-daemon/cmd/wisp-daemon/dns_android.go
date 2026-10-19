//go:build android

package main

import (
	"context"
	"net"
	"os"
	"strings"
	"time"
)

// Android has no /etc/resolv.conf, so Go's own resolver (no cgo here) would
// ask 127.0.0.1 and find nothing. Wisp Phone hands over the phone's DNS
// servers in WISP_DNS ("ip,ip"); public ones stand in when it can't
func init() {
	servers := publicDNS
	if env := strings.TrimSpace(os.Getenv("WISP_DNS")); env != "" {
		servers = nil
		for _, s := range strings.Split(env, ",") {
			if ip := net.ParseIP(strings.TrimSpace(s)); ip != nil {
				servers = append(servers, net.JoinHostPort(ip.String(), "53"))
			}
		}
		servers = append(servers, publicDNS...)
	}
	net.DefaultResolver = &net.Resolver{
		PreferGo: true,
		Dial: func(ctx context.Context, network, _ string) (net.Conn, error) {
			d := net.Dialer{Timeout: 3 * time.Second}
			var err error
			for _, s := range servers {
				var c net.Conn
				if c, err = d.DialContext(ctx, network, s); err == nil {
					return c, nil
				}
			}
			return nil, err
		},
	}
}

// IPv6 too: some mobile networks give a phone no IPv4 to reach them over
var publicDNS = []string{"1.1.1.1:53", "8.8.8.8:53", "[2606:4700:4700::1111]:53", "[2001:4860:4860::8888]:53"}
