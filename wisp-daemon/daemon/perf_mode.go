package daemon

import (
	"bufio"
	"encoding/json"
	"fmt"
	"os"
	"os/exec"
	"path/filepath"
	"sort"
	"strconv"
	"strings"
	"sync"
	"time"

	librespot "github.com/devgianlu/go-librespot"
)

// Performance mode (Settings → Display, on by default): more of
// the Car Thing for the screen.
//
//   - the browser draws with the graphics chip (GPU rasterization, which Chrome
//     69 keeps off for this chip), set through its own saved flags in Local
//     State so an update brings it with no reflash; the screen restarts to
//     take it, which is why only a change of the setting does that
//   - the processor at full speed (the "performance" cpufreq governor); it runs
//     a little warmer
//   - the browser's processes ahead of background work (voice sync, covers)
//   - compressed swap in memory (zram) where the kernel has it, so the
//     browser has more room on a long drive
//
// Turning it off puts each back as it was.

// the chrome://flags entries performance mode turns on (Chrome 69's names)
var perfChromeFlags = []string{
	"ignore-gpu-blacklist",
	"enable-gpu-rasterization@1",
	"enable-zero-copy@1",
}

const perfChromeNice = -5

const defaultChromeState = "/var/cache/chrome_storage/Local State"

type perfMode struct {
	log librespot.Logger
	// "/" on the device; tests point it at a folder
	root string
	// Chrome's Local State, where chrome://flags are kept
	chromeState string
	// stops Chrome, runs edit, starts it again (runit's sv on the device)
	restartChrome func(edit func())
	// runs a system tool (modprobe, mkswap, swapon, swapoff)
	run func(name string, args ...string) error
	// gives Chrome's processes a niceness (setpriority on the device)
	renice func(nice int)

	mu       sync.Mutex
	on       bool
	known    bool
	governor map[string]string // each policy's governor before performance mode
	hot      bool              // the processor is at its limit: hold off the clock
	stop     chan struct{}
}

func newPerfMode(log librespot.Logger) *perfMode {
	p := &perfMode{
		log:         log,
		root:        "/",
		chromeState: defaultChromeState,
		run: func(name string, args ...string) error {
			return exec.Command(name, args...).Run()
		},
		renice: reniceChrome,
	}
	p.restartChrome = func(edit func()) {
		if !onDevice {
			edit()
			return
		}
		_ = exec.Command("sv", "stop", "chromium").Run()
		edit()
		_ = exec.Command("sv", "start", "chromium").Run()
	}
	return p
}

// on unless the settings say off (it's the default since it eases off at 85 °C by itself)
func performanceFromSettings(body []byte) bool {
	var s struct {
		Perf *bool `json:"performanceMode"`
	}
	if json.Unmarshal(body, &s) != nil || s.Perf == nil {
		return true
	}
	return *s.Perf
}

// Set turns performance mode on or off; nothing happens when it's already so
func (p *perfMode) Set(on bool) {
	p.mu.Lock()
	if p.known && p.on == on {
		p.mu.Unlock()
		return
	}
	p.on, p.known = on, true
	p.mu.Unlock()

	p.log.Infof("performance mode: %v", on)
	p.mu.Lock()
	hot := p.hot
	p.mu.Unlock()
	// switched on while hot: the clock waits until it cools
	p.setGovernor(on && !hot)
	p.setSwap(on)
	// the browser's flags: rewritten (and the screen restarted) only when they differ;
	// only the Car Thing's browser (a test points chromeState elsewhere). Wisp OS's
	// Chromium already draws on the graphics chip, so it has no flags to change
	if !wispOS && (onDevice || p.chromeState != defaultChromeState) && p.chromeFlagsNeedChange(on) {
		p.restartChrome(func() {
			if err := p.writeChromeFlags(on); err != nil {
				p.log.Warnf("performance mode: browser flags: %v", err)
			}
		})
	}
	p.keepChromeAhead(on)
}

// --- the processor ---

func (p *perfMode) policies() []string {
	m, _ := filepath.Glob(filepath.Join(p.root, "sys/devices/system/cpu/cpufreq/policy*/scaling_governor"))
	sort.Strings(m)
	return m
}

// where each policy's governor from before performance mode is kept, so it
// comes back exactly, across restarts too
func (p *perfMode) savedGovernorsPath() string {
	return filepath.Join(p.root, "var/local/wisp/perf-governors.json")
}

func (p *perfMode) loadSavedGovernors() map[string]string {
	out := map[string]string{}
	if b, err := os.ReadFile(p.savedGovernorsPath()); err == nil {
		_ = json.Unmarshal(b, &out)
	}
	return out
}

func (p *perfMode) setGovernor(on bool) {
	p.mu.Lock()
	defer p.mu.Unlock()
	if p.governor == nil {
		p.governor = p.loadSavedGovernors()
	}
	changed := false
	for _, f := range p.policies() {
		cur, err := os.ReadFile(f)
		if err != nil {
			continue
		}
		if on {
			if g := strings.TrimSpace(string(cur)); g != "performance" && p.governor[f] != g {
				p.governor[f] = g
				changed = true
			}
			_ = os.WriteFile(f, []byte("performance"), 0o644)
		} else if was := p.governor[f]; was != "" {
			_ = os.WriteFile(f, []byte(was), 0o644)
		} else if strings.TrimSpace(string(cur)) == "performance" {
			// nothing saved (set before saving existed): the kernel's usual, schedutil on the Car Thing
			_ = os.WriteFile(f, []byte(defaultGovernor(filepath.Dir(f))), 0o644)
		}
	}
	if changed {
		if b, err := json.Marshal(p.governor); err == nil {
			_ = os.MkdirAll(filepath.Dir(p.savedGovernorsPath()), 0o755)
			_ = os.WriteFile(p.savedGovernorsPath(), b, 0o644)
		}
	}
}

// SetHot is the heat's say: at the processor's limit Performance mode lets go
// of the clock (the browser keeps its graphics flags), and takes it back once
// it's cooled. Returns whether it's now stepping aside
func (p *perfMode) SetHot(hot bool) bool {
	p.mu.Lock()
	on := p.on
	p.hot = hot
	p.mu.Unlock()
	if !on {
		return false
	}
	p.setGovernor(!hot)
	return hot
}

func defaultGovernor(policy string) string {
	b, _ := os.ReadFile(filepath.Join(policy, "scaling_available_governors"))
	have := strings.Fields(string(b))
	for _, g := range []string{"schedutil", "interactive", "ondemand", "conservative"} {
		for _, h := range have {
			if g == h {
				return g
			}
		}
	}
	return "ondemand"
}

// --- the browser's flags ---

func (p *perfMode) readChromeState() (map[string]any, error) {
	b, err := os.ReadFile(p.chromeState)
	if os.IsNotExist(err) {
		return map[string]any{}, nil
	}
	if err != nil {
		return nil, err
	}
	var st map[string]any
	if err := json.Unmarshal(b, &st); err != nil {
		return nil, err
	}
	return st, nil
}

func labsOf(st map[string]any) []string {
	browser, _ := st["browser"].(map[string]any)
	list, _ := browser["enabled_labs_experiments"].([]any)
	var out []string
	for _, v := range list {
		if s, ok := v.(string); ok {
			out = append(out, s)
		}
	}
	return out
}

// the flags list with performance mode's in or out, the user's others kept
func withPerfFlags(labs []string, on bool) []string {
	ours := map[string]bool{}
	for _, f := range perfChromeFlags {
		ours[strings.SplitN(f, "@", 2)[0]] = true
	}
	var out []string
	for _, l := range labs {
		if !ours[strings.SplitN(l, "@", 2)[0]] {
			out = append(out, l)
		}
	}
	if on {
		out = append(out, perfChromeFlags...)
	}
	sort.Strings(out)
	return out
}

func (p *perfMode) chromeFlagsNeedChange(on bool) bool {
	st, err := p.readChromeState()
	if err != nil {
		return false
	}
	have := append([]string(nil), labsOf(st)...)
	sort.Strings(have)
	return strings.Join(have, ",") != strings.Join(withPerfFlags(have, on), ",")
}

func (p *perfMode) writeChromeFlags(on bool) error {
	st, err := p.readChromeState()
	if err != nil {
		return err
	}
	browser, _ := st["browser"].(map[string]any)
	if browser == nil {
		browser = map[string]any{}
	}
	labs := withPerfFlags(labsOf(st), on)
	list := make([]any, len(labs))
	for i, l := range labs {
		list[i] = l
	}
	browser["enabled_labs_experiments"] = list
	st["browser"] = browser
	b, err := json.Marshal(st)
	if err != nil {
		return err
	}
	if err := os.MkdirAll(filepath.Dir(p.chromeState), 0o755); err != nil {
		return err
	}
	tmp := p.chromeState + ".wisp"
	if err := os.WriteFile(tmp, b, 0o600); err != nil {
		return err
	}
	return os.Rename(tmp, p.chromeState)
}

// --- the browser ahead of background work ---

// keepChromeAhead renices the browser now and every minute while on (its
// renderers come and go), and back to normal once when turned off
func (p *perfMode) keepChromeAhead(on bool) {
	p.mu.Lock()
	if p.stop != nil {
		close(p.stop)
		p.stop = nil
	}
	if !on {
		p.mu.Unlock()
		p.renice(0)
		return
	}
	stop := make(chan struct{})
	p.stop = stop
	p.mu.Unlock()
	go func() {
		// the browser may be restarting: give it a moment first
		timer := time.NewTimer(8 * time.Second)
		defer timer.Stop()
		for {
			select {
			case <-stop:
				return
			case <-timer.C:
				p.renice(perfChromeNice)
				timer.Reset(time.Minute)
			}
		}
	}()
}

// chromePids lists the browser's processes, by name, under a /proc
func chromePids(proc string) []int {
	entries, _ := os.ReadDir(proc)
	var out []int
	for _, e := range entries {
		pid, err := strconv.Atoi(e.Name())
		if err != nil {
			continue
		}
		b, err := os.ReadFile(filepath.Join(proc, e.Name(), "comm"))
		if err != nil {
			continue
		}
		name := strings.TrimSpace(string(b))
		if name == "chrome" || name == "chromium" || strings.HasPrefix(name, "chromium-") {
			out = append(out, pid)
		}
	}
	return out
}

// --- compressed swap ---

func (p *perfMode) zramSwapOn() bool {
	f, err := os.Open(filepath.Join(p.root, "proc/swaps"))
	if err != nil {
		return false
	}
	defer func() { _ = f.Close() }()
	sc := bufio.NewScanner(f)
	for sc.Scan() {
		if strings.Contains(sc.Text(), "zram0") {
			return true
		}
	}
	return false
}

func (p *perfMode) setSwap(on bool) {
	if !onDevice && p.root == "/" {
		return
	}
	dev := filepath.Join(p.root, "sys/block/zram0")
	if !on {
		if p.zramSwapOn() {
			_ = p.run("swapoff", "/dev/zram0")
		}
		return
	}
	if p.zramSwapOn() {
		return
	}
	if _, err := os.Stat(dev); err != nil {
		_ = p.run("modprobe", "zram")
		if _, err := os.Stat(dev); err != nil {
			p.log.Infof("performance mode: no zram in this kernel, skipping compressed swap")
			return
		}
	}
	// a quarter of the memory, compressed
	size := memTotalKB(filepath.Join(p.root, "proc/meminfo")) / 4
	if size <= 0 {
		size = 128 << 10
	}
	if err := os.WriteFile(filepath.Join(dev, "disksize"), []byte(fmt.Sprintf("%dK", size)), 0o644); err != nil {
		p.log.Infof("performance mode: zram size: %v", err)
	}
	if err := p.run("mkswap", "/dev/zram0"); err != nil {
		p.log.Infof("performance mode: mkswap: %v", err)
		return
	}
	if err := p.run("swapon", "-p", "100", "/dev/zram0"); err != nil {
		p.log.Infof("performance mode: swapon: %v", err)
	}
}

func memTotalKB(meminfo string) int64 {
	b, err := os.ReadFile(meminfo)
	if err != nil {
		return 0
	}
	for _, l := range strings.Split(string(b), "\n") {
		if strings.HasPrefix(l, "MemTotal:") {
			f := strings.Fields(l)
			if len(f) >= 2 {
				n, _ := strconv.ParseInt(f[1], 10, 64)
				return n
			}
		}
	}
	return 0
}
