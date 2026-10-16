package daemon

import (
	"archive/tar"
	"compress/gzip"
	"context"
	"crypto/sha256"
	"encoding/hex"
	"errors"
	"fmt"
	"io"
	"io/fs"
	"os"
	"path"
	"path/filepath"
	"runtime"
	"sort"
	"strings"
)

// Smaller updates. The UI's fonts (the CJK ones above all) are about three
// quarters of an update and almost never change, and everything crosses one
// Bluetooth link, so a release also carries the update in two parts:
//
//	wisp-core-<tag>.tar.gz     the daemon and UI without ui/fonts, plus
//	                           fonts.sha256 naming the fonts it expects
//	wisp-fonts-<digest12>.tar  those fonts, for when this Car Thing lacks them
//
// The fonts this Car Thing already has (the running update's, or the flash's)
// are copied when their digest matches, so most updates fetch only the core.
// wisp-app-<tag>.tar.gz stays on every release for older updaters.

// flashedUIDir is the UI the firmware image carries (tests point it elsewhere)
var flashedUIDir = sysPath("/etc/wisp/ui", "/etc/mira/ui")

// bundleArch names the daemon a bundle carries. The original firmware runs the
// 32-bit daemon (wisp-app-<tag>.tar.gz); Wisp OS, on the mainline kernel, runs
// the 64-bit one, from bundles named wisp-app-<tag>-arm64.tar.gz. A 64-bit
// Car Thing never takes a 32-bit bundle (tests set this)
var bundleArch = archSuffix(runtime.GOARCH)

func archSuffix(goarch string) string {
	if goarch == "arm64" {
		return "-arm64"
	}
	return ""
}

func coreAsset(rel *ghRelease) *ghAsset {
	return assetNamed(rel, "wisp-core-"+rel.TagName+bundleArch+".tar.gz")
}

func fontsAsset(rel *ghRelease, digest string) *ghAsset {
	if len(digest) < 12 {
		return nil
	}
	return assetNamed(rel, "wisp-fonts-"+digest[:12]+".tar")
}

func assetNamed(rel *ghRelease, name string) *ghAsset {
	for i := range rel.Assets {
		if rel.Assets[i].Name == name {
			return &rel.Assets[i]
		}
	}
	return nil
}

// fontsDigest names a fonts folder by its contents: sha256 over one
// "<sha256> <path>\n" line per file, in byte order of path. make-app-bundle.sh
// computes the same thing in shell
func fontsDigest(dir string) (string, error) {
	var names []string
	err := filepath.WalkDir(dir, func(p string, d fs.DirEntry, err error) error {
		if err != nil {
			return err
		}
		if d.Type().IsRegular() {
			rel, _ := filepath.Rel(dir, p)
			names = append(names, filepath.ToSlash(rel))
		}
		return nil
	})
	if err != nil {
		return "", err
	}
	if len(names) == 0 {
		return "", errors.New("no fonts")
	}
	sort.Strings(names)
	all := sha256.New()
	for _, n := range names {
		f, err := os.Open(filepath.Join(dir, filepath.FromSlash(n)))
		if err != nil {
			return "", err
		}
		h := sha256.New()
		_, err = io.Copy(h, f)
		_ = f.Close()
		if err != nil {
			return "", err
		}
		_, _ = fmt.Fprintf(all, "%s %s\n", hex.EncodeToString(h.Sum(nil)), n)
	}
	return hex.EncodeToString(all.Sum(nil)), nil
}

// localFonts finds fonts already on this Car Thing with the wanted digest
func (u *updater) localFonts(want string) string {
	var candidates []string
	if target, err := os.Readlink(filepath.Join(u.appDir, "current")); err == nil {
		if !filepath.IsAbs(target) {
			target = filepath.Join(u.appDir, target)
		}
		candidates = append(candidates, filepath.Join(target, "ui", "fonts"))
	}
	candidates = append(candidates, filepath.Join(flashedUIDir, "fonts"))
	for _, dir := range candidates {
		if d, err := fontsDigest(dir); err == nil && strings.EqualFold(d, want) {
			return dir
		}
	}
	return ""
}

func copyTree(src, dst string) error {
	return filepath.WalkDir(src, func(p string, d fs.DirEntry, err error) error {
		if err != nil {
			return err
		}
		rel, _ := filepath.Rel(src, p)
		to := filepath.Join(dst, rel)
		if d.IsDir() {
			return os.MkdirAll(to, 0o755)
		}
		if !d.Type().IsRegular() {
			return nil
		}
		in, err := os.Open(p)
		if err != nil {
			return err
		}
		defer func() { _ = in.Close() }()
		out, err := os.OpenFile(to, os.O_CREATE|os.O_WRONLY|os.O_TRUNC, 0o644)
		if err != nil {
			return err
		}
		_, err = io.Copy(out, in)
		if cerr := out.Close(); err == nil {
			err = cerr
		}
		return err
	})
}

// installCore installs from the split release: the core, then fonts copied
// from this Car Thing or, if it has none that match, downloaded
func (u *updater) installCore(ctx context.Context, rel *ghRelease, core *ghAsset, focus bool) error {
	if core.Size > updateMaxBundle {
		return errors.New("bundle too large")
	}
	want, err := u.expectedDigest(ctx, rel, core)
	if err != nil {
		return err
	}
	if err := os.MkdirAll(u.appDir, 0o755); err != nil {
		return err
	}
	u.setState(func(s *UpdateState) {
		s.Phase, s.Error, s.Percent = "downloading", "", 0
		s.Step, s.Focus, s.Installing = "Downloading", focus, rel.TagName
		s.BytesDone, s.BytesTotal, s.SpeedBps = 0, core.Size, 0
	})
	dl := filepath.Join(u.appDir, ".download")
	defer func() { _ = os.Remove(dl) }()
	got, err := u.download(ctx, core, dl)
	if err != nil {
		return err
	}
	u.setState(func(s *UpdateState) {
		s.Phase, s.Percent, s.Step, s.SpeedBps = "installing", 100, "Checking the download", 0
	})
	if !strings.EqualFold(got, want) {
		return errors.New("download failed verification (checksum mismatch)")
	}

	tag := rel.TagName
	if !validTag(tag) {
		return fmt.Errorf("bad release tag %q", tag)
	}
	u.setState(func(s *UpdateState) { s.Step = "Unpacking" })
	tmp := filepath.Join(u.appDir, tag) + ".new"
	_ = os.RemoveAll(tmp)
	ok := false
	defer func() {
		if !ok {
			_ = os.RemoveAll(tmp)
		}
	}()
	if err := extractGz(dl, tmp); err != nil {
		return err
	}

	// the fonts: the ones here if they're the same, else the release's
	b, err := os.ReadFile(filepath.Join(tmp, "fonts.sha256"))
	fontsWant := strings.TrimSpace(string(b))
	if err != nil || len(fontsWant) != 64 {
		return errors.New("bundle doesn't say which fonts it needs")
	}
	fontsDir := filepath.Join(tmp, "ui", "fonts")
	if src := u.localFonts(fontsWant); src != "" {
		u.setState(func(s *UpdateState) { s.Step = "Copying fonts already here" })
		if err := copyTree(src, fontsDir); err != nil {
			return err
		}
	} else {
		fa := fontsAsset(rel, fontsWant)
		if fa == nil {
			return errors.New("release is missing its fonts")
		}
		fontsSum, err := u.expectedDigest(ctx, rel, fa)
		if err != nil {
			return err
		}
		u.setState(func(s *UpdateState) {
			s.Phase, s.Step, s.Percent = "downloading", "Downloading fonts", 0
			s.BytesDone, s.BytesTotal, s.SpeedBps = 0, fa.Size, 0
		})
		fdl := filepath.Join(u.appDir, ".fonts")
		defer func() { _ = os.Remove(fdl) }()
		got, err := u.download(ctx, fa, fdl)
		if err != nil {
			return err
		}
		if !strings.EqualFold(got, fontsSum) {
			return errors.New("fonts failed verification (checksum mismatch)")
		}
		u.setState(func(s *UpdateState) { s.Phase, s.Step, s.Percent = "installing", "Unpacking fonts", 100 })
		f, err := os.Open(fdl)
		if err != nil {
			return err
		}
		err = extractTar(f, tmp)
		_ = f.Close()
		if err != nil {
			return err
		}
	}
	if d, err := fontsDigest(fontsDir); err != nil || !strings.EqualFold(d, fontsWant) {
		return errors.New("fonts don't match what the update expects")
	}

	if err := finishUnpack(tmp, tag); err != nil {
		return err
	}
	final := filepath.Join(u.appDir, tag)
	_ = os.RemoveAll(final)
	if err := os.Rename(tmp, final); err != nil {
		return err
	}
	ok = true

	u.setState(func(s *UpdateState) { s.Step = "Switching to " + tag })
	if err := u.activate(tag); err != nil {
		return err
	}
	u.log.Infof("update: installed %s (core and fonts), restarting into it", tag)
	u.setState(func(s *UpdateState) { s.Phase, s.Step = "restarting", "Restarting" })
	u.restart()
	return nil
}

func extractGz(bundle, into string) error {
	f, err := os.Open(bundle)
	if err != nil {
		return err
	}
	defer func() { _ = f.Close() }()
	gz, err := gzip.NewReader(f)
	if err != nil {
		return err
	}
	return extractTar(gz, into)
}

// extractTar writes a tar's files under into, refusing anything that would
// land outside it or isn't a plain file or folder
func extractTar(r io.Reader, into string) error {
	if err := os.MkdirAll(into, 0o755); err != nil {
		return err
	}
	tr := tar.NewReader(r)
	var written int64
	for {
		hdr, err := tr.Next()
		if err == io.EOF {
			return nil
		}
		if err != nil {
			return err
		}
		name := path.Clean(strings.TrimPrefix(hdr.Name, "./"))
		if name == "." {
			continue
		}
		if path.IsAbs(name) || name == ".." || strings.HasPrefix(name, "../") {
			return fmt.Errorf("bundle entry outside the bundle: %q", hdr.Name)
		}
		dst := filepath.Join(into, filepath.FromSlash(name))
		switch hdr.Typeflag {
		case tar.TypeDir:
			if err := os.MkdirAll(dst, 0o755); err != nil {
				return err
			}
		case tar.TypeReg:
			if err := os.MkdirAll(filepath.Dir(dst), 0o755); err != nil {
				return err
			}
			mode := os.FileMode(0o644)
			if hdr.Mode&0o111 != 0 {
				mode = 0o755
			}
			out, err := os.OpenFile(dst, os.O_CREATE|os.O_WRONLY|os.O_TRUNC, mode)
			if err != nil {
				return err
			}
			n, err := io.Copy(out, io.LimitReader(tr, updateMaxBundle*3-written))
			_ = out.Close()
			if err != nil {
				return err
			}
			written += n
			if written >= updateMaxBundle*3 {
				return errors.New("bundle unpacks too large")
			}
		default:
			return fmt.Errorf("bundle entry of unsupported type: %q", hdr.Name)
		}
	}
}

// finishUnpack checks an unpacked update is whole and is the release it claims
func finishUnpack(dir, tag string) error {
	for _, need := range []string{"go-librespot", "ui/index.html", "version.txt"} {
		if !fileExists(filepath.Join(dir, need)) {
			return fmt.Errorf("bundle is missing %s", need)
		}
	}
	v, _ := os.ReadFile(filepath.Join(dir, "version.txt"))
	if strings.TrimSpace(string(v)) != tag {
		return fmt.Errorf("bundle says it is %q, release is %s", strings.TrimSpace(string(v)), tag)
	}
	return os.Chmod(filepath.Join(dir, "go-librespot"), 0o755)
}
