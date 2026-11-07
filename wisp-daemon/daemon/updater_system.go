package daemon

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"os"
	"os/exec"
	"path/filepath"
	"regexp"
	"strings"
	"time"
)

// System updates on Wisp OS: the whole system, not just the app layer.
//
// Wisp OS has two system slots (A and B: a boot and a root partition each).
// A release can carry wisp-os-<version>.swu (built in WSL with `just ota`,
// carried forward by the release workflow), the boot and root partitions of
// that version, compressed. When it's newer than the running system:
//
//  1. it downloads to the data partition, as <name>.part, which carries on
//     where it stopped after the Car Thing loses power: at about 215 MB over
//     the phone's Bluetooth tether it can take more than one drive
//  2. the checksum is checked, then swupdate writes it onto the slot that isn't
//     running and points u-boot at that slot (three tries)
//  3. the switch happens at the next start: straight away when the install has
//     the screen, else whenever the Car Thing next turns on (or "Restart now")
//
// Three ways back, all to the slot that was running before: u-boot gives up on
// a slot that fails to boot three times; a system the UI never confirms within
// updateConfirmWindow is switched away from; and either way the daemon on the
// old system sees the new version didn't take, marks it bad (so it isn't
// offered again) and the UI says so once. The original firmware has one slot
// and never offers these.

const updateOSDir = "/var/local/wisp/os"

// wisp-os-v1.0.6.swu
var systemAssetRe = regexp.MustCompile(`^wisp-os-(v\d+\.\d+\.\d+)\.swu$`)

// SystemUpdate is a system update on offer, in UpdateState
type SystemUpdate struct {
	Version string `json:"version"`
	// the whole system's download; with Delta, only what changed comes down (less)
	Size  int64 `json:"size"`
	Delta bool  `json:"delta,omitempty"`
}

type systemOffer struct {
	version string
	asset   *ghAsset
}

// systemPending is os/pending.json: a system written to the other slot, waiting for a restart
type systemPending struct {
	Version string `json:"version"`
	// the system it replaces, and the slot that runs it
	From     string `json:"from"`
	FromSlot string `json:"from_slot"`
	// the boot it was written in: a later boot has tried it
	Boot string `json:"boot"`
}

// runningOSVersion is the Wisp OS version booted now ("v1.0.0"), "" on the original firmware
func runningOSVersion() string {
	b, err := os.ReadFile("/etc/wisp-os")
	if err != nil {
		return ""
	}
	v := strings.TrimSpace(string(b))
	if v == "" {
		return ""
	}
	return "v" + normalizeVersion(v)
}

func currentBootID() string {
	b, _ := os.ReadFile("/proc/sys/kernel/random/boot_id")
	return strings.TrimSpace(string(b))
}

// runningSlot is the slot u-boot booted ("a" or "b"): superbird.slot= on the
// kernel command line, else the boot env
func runningSlot() string {
	if b, err := os.ReadFile("/proc/cmdline"); err == nil {
		for _, f := range strings.Fields(string(b)) {
			if s, ok := strings.CutPrefix(f, "superbird.slot="); ok && (s == "a" || s == "b") {
				return s
			}
		}
	}
	if out, err := exec.Command("fw_printenv", "-n", "slot_active").Output(); err == nil {
		if s := strings.TrimSpace(string(out)); s == "a" || s == "b" {
			return s
		}
	}
	return ""
}

func otherSlot(s string) string {
	if s == "a" {
		return "b"
	}
	return "a"
}

// the newest system update on the release that's newer than the running system
// and hasn't failed here before
func (u *updater) systemOfferFor(rel *ghRelease) *systemOffer {
	if !u.systemOS {
		return nil
	}
	cur := u.osVersion()
	if cur == "" {
		return nil
	}
	var best *systemOffer
	for i := range rel.Assets {
		m := systemAssetRe.FindStringSubmatch(rel.Assets[i].Name)
		if m == nil || !versionLess(normalizeVersion(cur), normalizeVersion(m[1])) {
			continue
		}
		if fileExists(filepath.Join(u.osDir, "bad-"+m[1])) {
			continue
		}
		if best == nil || versionLess(normalizeVersion(best.version), normalizeVersion(m[1])) {
			best = &systemOffer{version: m[1], asset: &rel.Assets[i]}
		}
	}
	return best
}

func (u *updater) readSystemPending() *systemPending {
	b, err := os.ReadFile(filepath.Join(u.osDir, "pending.json"))
	if err != nil {
		return nil
	}
	var p systemPending
	if json.Unmarshal(b, &p) != nil || !validTag(p.Version) {
		return nil
	}
	return &p
}

// installSystem writes a system update to the other slot: only the parts that
// changed when the release has a delta (updater_delta.go), else the whole of it
func (u *updater) installSystem(ctx context.Context, rel *ghRelease, offer *systemOffer, focus bool) error {
	if err := os.MkdirAll(u.osDir, 0o755); err != nil {
		return err
	}
	from := u.slot()
	target := otherSlot(from)
	u.setState(func(s *UpdateState) {
		s.Phase, s.Error, s.Percent = "downloading", "", 0
		s.Focus, s.Installing = focus, offer.version
		s.BytesDone, s.BytesTotal, s.SpeedBps = 0, 0, 0
	})
	written := false
	if d := deltaAssetsFor(rel, offer.version); d != nil {
		err := u.installDelta(ctx, rel, offer, d, target)
		switch {
		case err == nil:
			written = true
		case ctx.Err() != nil, errors.Is(err, errDeltaOffline):
			// the connection, not the delta: next time carries on from what it kept
			return err
		default:
			u.log.Warnf("update: delta of system %s didn't work (%v), downloading the whole system", offer.version, err)
		}
	}
	if !written {
		if err := u.installFull(ctx, rel, offer, target); err != nil {
			return err
		}
	}
	pending, _ := json.Marshal(systemPending{
		Version: offer.version, From: u.osVersion(), FromSlot: from, Boot: u.bootID(),
	})
	if err := os.WriteFile(filepath.Join(u.osDir, "pending.json"), pending, 0o644); err != nil {
		return err
	}
	u.clearSystemDownloads("")
	syncFS()
	u.log.Infof("update: system %s written, starts at the next restart", offer.version)
	if focus {
		u.setState(func(s *UpdateState) { s.Phase, s.Step = "restarting", "Restarting" })
		u.reboot()
		return nil
	}
	u.setState(func(s *UpdateState) {
		s.Phase, s.Step, s.Percent, s.Focus, s.Installing = "idle", "", 0, false, ""
		s.BytesDone, s.BytesTotal, s.SpeedBps = 0, 0, 0
		s.Available, s.System, s.RestartPending = false, nil, offer.version
	})
	if u.publish != nil {
		u.publish("", nil)
	}
	return nil
}

// clearSystemDownloads removes what downloads and deltas left in osDir, all but keep's
func (u *updater) clearSystemDownloads(keep string) {
	entries, _ := os.ReadDir(u.osDir)
	for _, e := range entries {
		n := e.Name()
		if n == keep || !(strings.HasSuffix(n, ".part") || strings.HasPrefix(n, "delta-")) {
			continue
		}
		_ = os.RemoveAll(filepath.Join(u.osDir, n))
	}
}

// installFull downloads the whole system (.swu), checks it and writes it to slot target
func (u *updater) installFull(ctx context.Context, rel *ghRelease, offer *systemOffer, target string) error {
	asset := offer.asset
	part := filepath.Join(u.osDir, asset.Name+".part")
	// an older offer's download, or a delta's kept pieces: make room
	u.clearSystemDownloads(filepath.Base(part))
	var have int64
	if st, err := os.Stat(part); err == nil {
		have = st.Size()
	}
	if free := diskFreeMB(u.osDir); free > 0 && int64(free)<<20 < asset.Size-have+64<<20 {
		return fmt.Errorf("not enough space (%d MB free)", free)
	}
	want, err := u.expectedDigest(ctx, rel, asset)
	if err != nil {
		return err
	}
	u.setState(func(s *UpdateState) {
		s.Phase, s.Step = "downloading", "Downloading the system"
		s.BytesDone, s.BytesTotal, s.SpeedBps = have, asset.Size, 0
	})
	got, err := u.download(ctx, asset, part)
	if err != nil {
		return err
	}
	u.setState(func(s *UpdateState) {
		s.Phase, s.Percent, s.Step, s.SpeedBps = "installing", 100, "Checking the download", 0
	})
	if !strings.EqualFold(got, want) {
		// a resumed file that went wrong somewhere: start clean next time
		_ = os.Remove(part)
		return errors.New("download failed verification (checksum mismatch)")
	}
	u.setState(func(s *UpdateState) { s.Step = "Writing the new system" })
	u.log.Infof("update: writing system %s to slot %s (running %s)", offer.version, target, u.osVersion())
	if err := u.applySystem(ctx, part, target); err != nil {
		return fmt.Errorf("system write failed: %w", err)
	}
	return nil
}

// writeSystemSlot runs swupdate on a downloaded .swu, onto slot target
func writeSystemSlot(ctx context.Context, swu, target string) error {
	if !onDevice {
		return errors.New("not on the device")
	}
	ctx, cancel := context.WithTimeout(ctx, 30*time.Minute)
	defer cancel()
	// in the background of whatever the Car Thing is doing: the screen and the
	// music come first, the write takes a few minutes either way
	cmd := exec.CommandContext(ctx, "nice", "-n", "15",
		"swupdate", "-f", "/etc/swupdate.cfg", "-e", "stable,slot_"+target, "-i", swu)
	var out bytes.Buffer
	cmd.Stdout, cmd.Stderr = &out, &out
	if err := cmd.Run(); err != nil {
		tail := out.String()
		if len(tail) > 600 {
			tail = tail[len(tail)-600:]
		}
		return fmt.Errorf("%v: %s", err, strings.TrimSpace(tail))
	}
	return nil
}

// systemStartup runs once at boot: was a system written last time, and did it take?
func (u *updater) systemStartup(ctx context.Context) {
	if !u.systemOS {
		return
	}
	p := u.readSystemPending()
	if p == nil {
		return
	}
	if p.Boot == u.bootID() {
		// the daemon restarted, the Car Thing didn't: still waiting
		u.setState(func(s *UpdateState) { s.RestartPending = p.Version })
		return
	}
	pendingPath := filepath.Join(u.osDir, "pending.json")
	cur := u.osVersion()
	if normalizeVersion(cur) != normalizeVersion(p.Version) {
		// u-boot went back to the old slot: the new one didn't boot
		u.log.Warnf("update: system %s didn't start, still on %s", p.Version, cur)
		u.systemFailed(p, "the new system didn't start")
		_ = os.Remove(pendingPath)
		syncFS()
		return
	}
	u.log.Infof("update: now on system %s, waiting for the UI to confirm it", p.Version)
	go func() {
		select {
		case <-ctx.Done():
		case <-u.confirmed:
			_ = os.Remove(pendingPath)
			syncFS()
			u.log.Infof("update: system %s confirmed", p.Version)
		case <-time.After(updateConfirmWindow):
			// it boots but Wisp doesn't come up on it: back to the slot that worked
			u.log.Warnf("update: system %s never confirmed by the UI, going back to slot %s", p.Version, p.FromSlot)
			if err := u.switchSlot(p.FromSlot); err != nil {
				u.log.Warnf("update: couldn't switch back: %v", err)
				return
			}
			u.systemFailed(p, "Wisp didn't come up on the new system")
			_ = os.Remove(pendingPath)
			syncFS()
			u.reboot()
		}
	}()
}

// systemFailed keeps a failed system version from being offered again and tells the UI once
func (u *updater) systemFailed(p *systemPending, why string) {
	_ = os.MkdirAll(u.osDir, 0o755)
	_ = os.WriteFile(filepath.Join(u.osDir, "bad-"+p.Version), []byte(why+"\n"), 0o644)
	_ = os.MkdirAll(u.appDir, 0o755)
	note, _ := json.Marshal(RollBack{From: p.Version, To: p.From, Why: why, At: time.Now().UnixMilli(), Kind: "system"})
	_ = os.WriteFile(filepath.Join(u.appDir, "rolled-back.json"), note, 0o644)
}

// switchSlotEnv points u-boot at slot s, with fresh tries
func switchSlotEnv(s string) error {
	if s != "a" && s != "b" {
		return fmt.Errorf("bad slot %q", s)
	}
	if !onDevice {
		return errors.New("not on the device")
	}
	if err := exec.Command("fw_setenv", "slot_"+s+"_tries", "3").Run(); err != nil {
		return err
	}
	return exec.Command("fw_setenv", "slot_active", s).Run()
}

// Restart is "Restart now" for a system written to the other slot
func (u *updater) Restart() error {
	u.mu.Lock()
	pending := u.state.RestartPending
	u.mu.Unlock()
	if pending == "" {
		return errors.New("nothing waiting for a restart")
	}
	u.setState(func(s *UpdateState) { s.Phase, s.Step = "restarting", "Restarting" })
	go u.reboot()
	return nil
}

func rebootNow() {
	if !onDevice {
		return
	}
	syncFS()
	if exec.Command("/sbin/reboot").Run() != nil {
		_ = exec.Command("reboot").Run()
	}
}
