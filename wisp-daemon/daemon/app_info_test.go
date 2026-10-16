package daemon

import "testing"

func TestNormalizeVersion(t *testing.T) {
	t.Parallel()
	tests := []struct{ in, want string }{
		{"v1.0.0", "1.0.0"},
		{"1.0.0", "1.0.0"},
		{" v1.2.3 ", "1.2.3"},
		{"", ""},
	}
	for _, tt := range tests {
		if got := normalizeVersion(tt.in); got != tt.want {
			t.Errorf("normalizeVersion(%q) = %q, want %q", tt.in, got, tt.want)
		}
	}
}

func TestVersionLess(t *testing.T) {
	t.Parallel()
	tests := []struct {
		a, b string
		want bool
	}{
		{"1.0.0", "1.1.0", true},
		{"1.1.0", "1.0.0", false},
		{"1.0.0", "1.0.0", false},
		{"1.0.0", "1.0.1", true},
		{"1.9.0", "1.10.0", true},
		{"2.0.0", "1.9.9", false},
		{"1.0", "1.0.1", true},
		{"1.0.0", "1.0.1-rc1", true},
		{"1.2.0-beta", "1.2.0", true},
		{"1.2.0", "1.2.0-beta", false},
		{"1.2.0-beta", "1.2.1", true},
		{"1.2.0-beta", "1.1.0", false},
		{"1.2.0-beta", "1.2.0-beta2", false},
		{"unknown", "1.1.0", false},
		{"1.0.0", "garbage", false},
		{"", "1.0.0", false},
	}
	for _, tt := range tests {
		if got := versionLess(tt.a, tt.b); got != tt.want {
			t.Errorf("versionLess(%q, %q) = %v, want %v", tt.a, tt.b, got, tt.want)
		}
	}
}

