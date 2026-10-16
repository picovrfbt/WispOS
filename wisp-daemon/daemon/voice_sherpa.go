package daemon

import (
	"bufio"
	"context"
	"fmt"
	"io"
	"os"
	"os/exec"
	"path/filepath"
	"strconv"
	"strings"
	"sync"
	"time"
)

// manages a single long-lived sherpa-onnx ASR process (for the gigaspeech-Zipformer transducer to prevent long load times each time we want to run a command)
type sherpaSidecar struct {
	v *voiceService

	mu    sync.Mutex
	stdin io.WriteCloser
	proc  *os.Process
	lines chan string

	readyMu sync.Mutex
	ready   bool
	readyCh chan struct{}

	// set aside (unloaded) to give memory back to the screen; guarded by mu
	parked   bool
	parkedAt time.Time
	busy     int
	wake     chan struct{}
}

const (
	sherpaThreads     = 4
	sherpaMethod      = "greedy_search"
	sherpaReadyWait   = 40 * time.Second
	sherpaDecodeMax   = 20 * time.Second
	sherpaRestartWait = 2 * time.Second
	sherpaMinFreeMB   = 30

	// the model is set aside when memory runs short so the screen never starves
	// (it holds ~135 MB), and comes back once there's room or when it's needed
	sherpaMemCheck      = 5 * time.Second
	sherpaParkBelowMB   = 60  // free memory that counts as short
	sherpaParkFullPct   = 10  // or this much time fully stalled on memory
	sherpaReloadAboveMB = 220 // free memory to bring it back on its own
	sherpaReloadNeedMB  = 170 // free memory to bring it back for a command
	sherpaParkMin       = 2 * time.Minute
)

func newSherpaSidecar(v *voiceService) *sherpaSidecar {
	return &sherpaSidecar{v: v, lines: make(chan string, 1), readyCh: make(chan struct{}), wake: make(chan struct{}, 1)}
}

// start launches the supervisor
func (s *sherpaSidecar) start() {
	go s.supervise()
	go s.watchMemory()
}

func (s *sherpaSidecar) setReady(r bool) {
	s.readyMu.Lock()
	switch {
	case r && !s.ready:
		close(s.readyCh)
	case !r && s.ready:
		s.readyCh = make(chan struct{})
	}
	s.ready = r
	s.readyMu.Unlock()
}

func (s *sherpaSidecar) waitReady(ctx context.Context) error {
	s.readyMu.Lock()
	if s.ready {
		s.readyMu.Unlock()
		return nil
	}
	ch := s.readyCh
	s.readyMu.Unlock()
	select {
	case <-ch:
		return nil
	case <-ctx.Done():
		return ctx.Err()
	}
}

// spawns or respawns the sidecar
func (s *sherpaSidecar) supervise() {
	for s.v.ctx.Err() == nil {
		if !s.waitUnparked() {
			return
		}
		if err := s.runOnce(); err != nil && s.v.ctx.Err() == nil && !s.isParked() {
			s.v.app.log.WithError(err).Warn("voice: sherpa sidecar exited; restarting")
		}
		s.setReady(false)
		select {
		case <-time.After(sherpaRestartWait):
		case <-s.v.ctx.Done():
			return
		}
	}
}

func (s *sherpaSidecar) runOnce() error {
	md := s.v.cfg.SherpaModelDir
	enc, err := globOne(md, "encoder*int8.onnx")
	if err != nil {
		return err
	}
	dec, err := globOne(md, "decoder*int8.onnx")
	if err != nil {
		return err
	}
	joi, err := globOne(md, "joiner*int8.onnx")
	if err != nil {
		return err
	}
	tokens := filepath.Join(md, "tokens.txt")

	bin := filepath.Join(s.v.cfg.BinDir, s.v.cfg.SherpaBin)
	args := append([]string{"--library-path", s.v.cfg.LibDir, bin}, sherpaArgs(s.v.cfg.SherpaBin, md, enc, dec, joi, tokens)...)
	cmd := exec.CommandContext(s.v.ctx, s.v.loader(), args...)
	// die with the daemon
	cmd.SysProcAttr = dieWithDaemon()

	stdin, err := cmd.StdinPipe()
	if err != nil {
		return err
	}
	stdout, err := cmd.StdoutPipe()
	if err != nil {
		return err
	}
	stderr, err := cmd.StderrPipe()
	if err != nil {
		return err
	}
	if err := cmd.Start(); err != nil {
		return err
	}
	s.v.app.log.Infof("voice: sherpa sidecar starting (%s, model=%s)", s.v.cfg.SherpaBin, filepath.Base(filepath.Dir(enc)))

	s.mu.Lock()
	s.stdin = stdin
	s.proc = cmd.Process
	s.mu.Unlock()

	go drainLog(s.v, stderr)

	sc := bufio.NewScanner(stdout)
	sc.Buffer(make([]byte, 0, 64*1024), 1024*1024)
	for sc.Scan() {
		line := sc.Text()
		if strings.TrimSpace(line) == "READY" && !s.isReady() {
			s.setReady(true)
			s.v.app.log.Info("voice: sherpa sidecar READY (model loaded)")
			continue
		}
		select {
		case s.lines <- line:
		default: // no waiter
		}
	}
	_ = cmd.Wait()
	s.mu.Lock()
	s.stdin = nil
	s.proc = nil
	s.mu.Unlock()
	return fmt.Errorf("sherpa sidecar process ended")
}

func (s *sherpaSidecar) isReady() bool {
	s.readyMu.Lock()
	defer s.readyMu.Unlock()
	return s.ready
}

// forces the given sidecar process down so the supervisor respawns a fresh one
func (s *sherpaSidecar) killProc(p *os.Process) {
	if p == nil {
		return
	}
	s.mu.Lock()
	cur := s.proc
	s.mu.Unlock()
	if cur == p {
		_ = p.Kill()
	}
}

func drainLog(v *voiceService, r io.Reader) {
	sc := bufio.NewScanner(r)
	for sc.Scan() {
		v.app.log.Debugf("voice: sherpa: %s", sc.Text())
	}
}

func globOne(dir, pat string) (string, error) {
	m, err := filepath.Glob(filepath.Join(dir, pat))
	if err != nil || len(m) == 0 {
		return "", fmt.Errorf("sherpa model %q not found in %s", pat, dir)
	}
	return m[0], nil
}

func (s *sherpaSidecar) isParked() bool {
	s.mu.Lock()
	defer s.mu.Unlock()
	return s.parked
}

// memPressured is whether memory is short enough to set the model aside
func memPressured(availMB int, fullPct float64) bool {
	return (availMB >= 0 && availMB < sherpaParkBelowMB) || fullPct >= sherpaParkFullPct
}

// canAutoReload is whether there's room to bring the model back unasked
func canAutoReload(availMB int, fullPct float64) bool {
	return availMB >= sherpaReloadAboveMB && fullPct < 1
}

// watchMemory sets the model aside when memory stays short for two checks
// running, never in the middle of a command
func (s *sherpaSidecar) watchMemory() {
	t := time.NewTicker(sherpaMemCheck)
	defer t.Stop()
	short := 0
	for {
		select {
		case <-s.v.ctx.Done():
			return
		case <-t.C:
		}
		if !s.isReady() {
			short = 0
			continue
		}
		free, full := availMemMB(), memFullAvg10()
		if !memPressured(free, full) {
			short = 0
			continue
		}
		if short++; short >= 2 {
			short = 0
			s.park(free, full)
		}
	}
}

func (s *sherpaSidecar) park(free int, full float64) {
	s.mu.Lock()
	if s.parked || s.busy > 0 || s.proc == nil {
		s.mu.Unlock()
		return
	}
	s.parked = true
	s.parkedAt = time.Now()
	p := s.proc
	s.mu.Unlock()
	s.v.app.log.Infof("voice: memory short (%dMB free, %.0f%% stalled); unloading the speech model", free, full)
	_ = p.Kill()
}

// waitUnparked holds the supervisor while the model is set aside; false when
// the daemon is stopping
func (s *sherpaSidecar) waitUnparked() bool {
	t := time.NewTicker(sherpaMemCheck)
	defer t.Stop()
	for {
		s.mu.Lock()
		parked, since := s.parked, time.Since(s.parkedAt)
		s.mu.Unlock()
		if !parked {
			return true
		}
		if since >= sherpaParkMin && canAutoReload(availMemMB(), memFullAvg10()) {
			s.mu.Lock()
			s.parked = false
			s.mu.Unlock()
			s.v.app.log.Info("voice: memory back; reloading the speech model")
			return true
		}
		select {
		case <-s.wake:
		case <-t.C:
		case <-s.v.ctx.Done():
			return false
		}
	}
}

// begin marks a command in progress, bringing the model back first if it was
// set aside and there's room for it
func (s *sherpaSidecar) begin() error {
	s.mu.Lock()
	defer s.mu.Unlock()
	if s.parked {
		if free := availMemMB(); free >= 0 && free < sherpaReloadNeedMB {
			return fmt.Errorf("sherpa: unloaded for memory (%dMB free < %dMB to reload)", free, sherpaReloadNeedMB)
		}
		s.parked = false
		s.v.app.log.Info("voice: reloading the speech model for a command")
		select {
		case s.wake <- struct{}{}:
		default:
		}
	}
	s.busy++
	return nil
}

func (s *sherpaSidecar) end() {
	s.mu.Lock()
	s.busy--
	s.mu.Unlock()
}

// memFullAvg10 is the share of the last 10 s every task stalled on memory
func memFullAvg10() float64 {
	b, err := os.ReadFile("/proc/pressure/memory")
	if err != nil {
		return 0
	}
	return parseFullAvg10(string(b))
}

func parseFullAvg10(psi string) float64 {
	for _, line := range strings.Split(psi, "\n") {
		rest, ok := strings.CutPrefix(line, "full ")
		if !ok {
			continue
		}
		for _, f := range strings.Fields(rest) {
			if v, ok := strings.CutPrefix(f, "avg10="); ok {
				if x, err := strconv.ParseFloat(v, 64); err == nil {
					return x
				}
			}
		}
	}
	return 0
}

// returns the available memory
func availMemMB() int {
	b, err := os.ReadFile("/proc/meminfo")
	if err != nil {
		return -1
	}
	for _, line := range strings.Split(string(b), "\n") {
		if rest, ok := strings.CutPrefix(line, "MemAvailable:"); ok {
			if f := strings.Fields(rest); len(f) >= 1 {
				if kb, err := strconv.Atoi(f[0]); err == nil {
					return kb / 1024
				}
			}
		}
	}
	return -1
}

// transcribe sends clipPath to the recognizer and returns the transcript
func (s *sherpaSidecar) transcribe(ctx context.Context, clipPath string) (string, error) {
	if err := s.begin(); err != nil {
		return "", err
	}
	defer s.end()
	rctx, cancel := context.WithTimeout(ctx, sherpaReadyWait)
	defer cancel()
	if err := s.waitReady(rctx); err != nil {
		return "", fmt.Errorf("sherpa not ready: %w", err)
	}
	// if mem is low (potential for leaks nott really tested extensively)
	if free := availMemMB(); free >= 0 && free < sherpaMinFreeMB {
		return "", fmt.Errorf("sherpa: low memory (%dMB free < %dMB floor), abstaining to avoid OOM", free, sherpaMinFreeMB)
	}

	s.mu.Lock()
	stdin := s.stdin
	proc := s.proc
	s.mu.Unlock()
	if stdin == nil {
		return "", fmt.Errorf("sherpa stdin unavailable")
	}

	select {
	case <-s.lines:
	default:
	}

	if _, err := io.WriteString(stdin, clipPath+"\n"); err != nil {
		return "", fmt.Errorf("sherpa write: %w", err)
	}

	dctx, dcancel := context.WithTimeout(ctx, sherpaDecodeMax)
	defer dcancel()
	select {
	case line, ok := <-s.lines:
		if !ok {
			return "", fmt.Errorf("sherpa sidecar closed")
		}
		return cleanTranscript(line), nil
	case <-dctx.Done():
		s.killProc(proc)
		return "", fmt.Errorf("sherpa decode timeout: %w", dctx.Err())
	}
}

// sherpaArgs is how each speech server is started. Wisp OS runs Wisp's own,
// wisp_asr_server (wisp-firmware/voice-src), which takes named options and the
// ONNX settings file beside the model (ort.conf: the memory arena off); the
// original firmware runs Mira's sherpa_asr_server, which takes them in order
func sherpaArgs(bin, modelDir, enc, dec, joi, tokens string) []string {
	if bin != "wisp_asr_server" {
		return []string{enc, dec, joi, tokens, fmt.Sprintf("%d", sherpaThreads), sherpaMethod}
	}
	args := []string{
		"--type", "offline-transducer",
		"--encoder", enc, "--decoder", dec, "--joiner", joi, "--tokens", tokens,
		"--threads", fmt.Sprintf("%d", sherpaThreads), "--method", sherpaMethod,
	}
	if conf := filepath.Join(filepath.Dir(modelDir), "ort.conf"); fileExists(conf) {
		args = append(args, "--provider-config", conf)
	}
	return args
}
