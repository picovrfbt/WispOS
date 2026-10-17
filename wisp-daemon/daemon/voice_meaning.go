package daemon

import (
	"bufio"
	"context"
	"encoding/binary"
	"errors"
	"fmt"
	"io"
	"os"
	"os/exec"
	"path/filepath"
	"regexp"
	"sort"
	"strconv"
	"strings"
	"sync"
	"time"
	"unicode"
)

// The meaning-matcher: when Wisp's own rules (voice_understand.go) don't know
// a request and there's no phone model to ask, this compares what was said
// with a bank of examples by meaning (all-MiniLM-L6-v2, a 23 MB model) and
// hands the matching example's command back to the rules: "I'm nodding off"
// lands on "play something energetic".
//
// The Car Thing's memory is tight, so none of it stays loaded: the model runs
// in its own process (wisp_meaning_server, on the ONNX Runtime the speech
// recogniser already ships), started on the first miss and stopped, with the
// vocabulary and the bank, after a quiet minute. Files, in voice.meaning_dir:
// model_quantized.onnx, vocab.txt and bank.bin (wisp-firmware/voice-src/meaning).

const (
	// a match has to be at least this close (cosine) ...
	meaningThreshold = 0.6
	// ... and this much closer than the best different command, or it's a guess
	meaningMargin = 0.03
	// let go of the model after this long without a question
	meaningIdle   = time.Minute
	meaningLoad   = 20 * time.Second
	meaningAnswer = 5 * time.Second
	// the model's longest input
	meaningMaxTokens = 64
)

type meaningEntry struct {
	command string
	vec     []int8
}

type meaningMatcher struct {
	dir    string
	bin    string
	loader string
	libDir string

	mu      sync.Mutex
	vocab   map[string]int32
	bank    []meaningEntry
	dim     int
	proc    *os.Process
	stdin   io.WriteCloser
	lines   chan string
	lastUse time.Time
	idle    *time.Timer
}

func newMeaningMatcher(dir, bin, loader, libDir string) *meaningMatcher {
	return &meaningMatcher{dir: dir, bin: bin, loader: loader, libDir: libDir}
}

// available: the files are there
func (m *meaningMatcher) available() bool {
	if m == nil || m.dir == "" {
		return false
	}
	for _, f := range []string{"model_quantized.onnx", "vocab.txt", "bank.bin"} {
		if !fileExists(filepath.Join(m.dir, f)) {
			return false
		}
	}
	return fileExists(m.bin)
}

// match finds the command a request means, if one is close enough
func (m *meaningMatcher) match(ctx context.Context, text string) (string, float32, error) {
	m.mu.Lock()
	defer m.mu.Unlock()
	if err := m.ensureLocked(ctx); err != nil {
		return "", 0, err
	}
	m.lastUse = time.Now()
	m.idle.Reset(meaningIdle)

	ids := wordPiece(m.vocab, text, meaningMaxTokens)
	parts := make([]string, len(ids))
	for i, id := range ids {
		parts[i] = strconv.Itoa(int(id))
	}
	select {
	case <-m.lines:
	default:
	}
	if _, err := io.WriteString(m.stdin, strings.Join(parts, " ")+"\n"); err != nil {
		m.stopLocked()
		return "", 0, err
	}
	var line string
	select {
	case line = <-m.lines:
	case <-ctx.Done():
		return "", 0, ctx.Err()
	case <-time.After(meaningAnswer):
		m.stopLocked()
		return "", 0, errors.New("the meaning-matcher took too long")
	}
	vec, err := parseVector(line, m.dim)
	if err != nil {
		return "", 0, err
	}
	cmd, score := pickMeaning(strings.ToLower(text), vec, m.bank)
	return cmd, score, nil
}

func parseVector(line string, dim int) ([]float32, error) {
	if strings.HasPrefix(line, "ERR") {
		return nil, errors.New("meaning: " + line)
	}
	f := strings.Fields(line)
	if len(f) != dim {
		return nil, fmt.Errorf("meaning: %d numbers, want %d", len(f), dim)
	}
	v := make([]float32, dim)
	for i, s := range f {
		x, err := strconv.ParseFloat(s, 32)
		if err != nil {
			return nil, err
		}
		v[i] = float32(x)
	}
	return v, nil
}

// pickMeaning: the closest command that makes sense for these words, unless a
// different command is nearly as close
func pickMeaning(text string, vec []float32, bank []meaningEntry) (string, float32) {
	type scored struct {
		i int
		s float32
	}
	all := make([]scored, len(bank))
	for i, e := range bank {
		var dot float32
		for d, x := range e.vec {
			dot += vec[d] * float32(x)
		}
		all[i] = scored{i, dot / 127}
	}
	sort.Slice(all, func(a, b int) bool { return all[a].s > all[b].s })
	best, bestScore := "", float32(0)
	for _, c := range all {
		if c.s < meaningThreshold {
			break
		}
		cmd := bank[c.i].command
		if !meaningFits(text, cmd) {
			continue
		}
		if best == "" {
			best, bestScore = cmd, c.s
			continue
		}
		if cmd != best {
			if bestScore-c.s < meaningMargin {
				return "", bestScore
			}
			break
		}
	}
	return best, bestScore
}

var questionLead = regexp.MustCompile(`^(?:is|will|what|when|who|how|are|does|do i)\b`)

// meaningFits catches the opposites a small model mixes up ("too loud" isn't
// "turn it up") and questions taken for music ("is it raining" isn't a mood)
func meaningFits(text, cmd string) bool {
	has := func(words ...string) bool {
		for _, w := range words {
			if regexp.MustCompile(`\b` + regexp.QuoteMeta(w) + `\b`).MatchString(text) {
				return true
			}
		}
		return false
	}
	switch cmd {
	case "turn it up":
		return !has("loud", "down", "lower", "quiet", "quieter", "softer", "noisy")
	case "turn it down":
		return !has("louder", "up", "can't hear", "barely", "not loud")
	case "make it brighter":
		return !has("darker", "dimmer", "too bright", "blinding", "hurts", "lower")
	case "dim the screen":
		return !has("brighter", "too dark", "too dim", "can't see", "can't read", "hard to read")
	case "pause":
		return !has("carry on", "continue", "resume", "keep", "again", "unpause")
	case "resume":
		return !has("stop", "pause", "hold", "wait", "mute")
	case "next":
		return !has("previous", "before", "back", "last")
	case "previous":
		return !has("next", "skip", "ahead")
	}
	if strings.HasPrefix(cmd, "play something") && questionLead.MatchString(text) {
		return false
	}
	return true
}

// ---------------------------------------------------------------- loading and letting go

func (m *meaningMatcher) ensureLocked(ctx context.Context) error {
	if m.proc != nil {
		return nil
	}
	if m.vocab == nil {
		v, err := loadVocab(filepath.Join(m.dir, "vocab.txt"))
		if err != nil {
			return err
		}
		m.vocab = v
	}
	if m.bank == nil {
		b, dim, err := loadMeaningBank(filepath.Join(m.dir, "bank.bin"))
		if err != nil {
			return err
		}
		m.bank, m.dim = b, dim
	}
	cmd := exec.Command(m.loader, "--library-path", m.libDir, m.bin, filepath.Join(m.dir, "model_quantized.onnx"))
	cmd.SysProcAttr = dieWithDaemon()
	stdin, err := cmd.StdinPipe()
	if err != nil {
		return err
	}
	stdout, err := cmd.StdoutPipe()
	if err != nil {
		return err
	}
	if err := cmd.Start(); err != nil {
		return err
	}
	lines := make(chan string, 1)
	ready := make(chan struct{})
	go func() {
		sc := bufio.NewScanner(stdout)
		sc.Buffer(make([]byte, 0, 16*1024), 64*1024)
		once := false
		for sc.Scan() {
			t := sc.Text()
			if !once && t == "READY" {
				once = true
				close(ready)
				continue
			}
			select {
			case lines <- t:
			default:
			}
		}
		_ = cmd.Wait()
	}()
	select {
	case <-ready:
	case <-ctx.Done():
		_ = cmd.Process.Kill()
		return ctx.Err()
	case <-time.After(meaningLoad):
		_ = cmd.Process.Kill()
		return errors.New("the meaning-matcher didn't start")
	}
	m.proc, m.stdin, m.lines = cmd.Process, stdin, lines
	if m.idle == nil {
		m.idle = time.AfterFunc(meaningIdle, m.letGo)
	}
	return nil
}

// letGo stops the model and drops the vocabulary and bank after a quiet minute
func (m *meaningMatcher) letGo() {
	m.mu.Lock()
	defer m.mu.Unlock()
	if time.Since(m.lastUse) < meaningIdle {
		m.idle.Reset(meaningIdle - time.Since(m.lastUse))
		return
	}
	m.stopLocked()
	m.vocab, m.bank = nil, nil
}

func (m *meaningMatcher) stopLocked() {
	if m.proc != nil {
		_ = m.stdin.Close()
		_ = m.proc.Kill()
	}
	m.proc, m.stdin, m.lines = nil, nil, nil
}

func loadVocab(path string) (map[string]int32, error) {
	f, err := os.Open(path)
	if err != nil {
		return nil, err
	}
	defer func() { _ = f.Close() }()
	v := make(map[string]int32, 31000)
	sc := bufio.NewScanner(f)
	var i int32
	for sc.Scan() {
		v[sc.Text()] = i
		i++
	}
	return v, sc.Err()
}

func loadMeaningBank(path string) ([]meaningEntry, int, error) {
	b, err := os.ReadFile(path)
	if err != nil {
		return nil, 0, err
	}
	if len(b) < 12 || string(b[:4]) != "WMB1" {
		return nil, 0, errors.New("meaning: not a bank file")
	}
	count := int(binary.LittleEndian.Uint32(b[4:]))
	dim := int(binary.LittleEndian.Uint32(b[8:]))
	off := 12
	out := make([]meaningEntry, 0, count)
	for i := 0; i < count; i++ {
		if off+2 > len(b) {
			return nil, 0, errors.New("meaning: bank cut short")
		}
		n := int(binary.LittleEndian.Uint16(b[off:]))
		off += 2
		if off+n+dim > len(b) {
			return nil, 0, errors.New("meaning: bank cut short")
		}
		cmd := string(b[off : off+n])
		off += n
		vec := make([]int8, dim)
		for d := 0; d < dim; d++ {
			vec[d] = int8(b[off+d])
		}
		off += dim
		out = append(out, meaningEntry{cmd, vec})
	}
	return out, dim, nil
}

// ---------------------------------------------------------------- tokens

// wordPiece splits text the way the model's own (BERT, uncased) tokenizer
// does: [CLS], lowercase words and punctuation broken into vocabulary pieces
// ("##" for a piece inside a word), [SEP]
func wordPiece(vocab map[string]int32, text string, max int) []int32 {
	unk, cls, sep := vocab["[UNK]"], vocab["[CLS]"], vocab["[SEP]"]
	out := []int32{cls}
	for _, word := range basicTokens(text) {
		if len(out) >= max-1 {
			break
		}
		runes := []rune(word)
		if len(runes) > 100 {
			out = append(out, unk)
			continue
		}
		var pieces []int32
		for start := 0; start < len(runes); {
			end := len(runes)
			found := int32(-1)
			for ; end > start; end-- {
				sub := string(runes[start:end])
				if start > 0 {
					sub = "##" + sub
				}
				if id, ok := vocab[sub]; ok {
					found = id
					break
				}
			}
			if found < 0 {
				pieces = []int32{unk}
				break
			}
			pieces = append(pieces, found)
			start = end
		}
		out = append(out, pieces...)
	}
	if len(out) > max-1 {
		out = out[:max-1]
	}
	return append(out, sep)
}

// basicTokens: lowercased, accents off, split on spaces and around punctuation
func basicTokens(text string) []string {
	var toks []string
	var cur []rune
	flush := func() {
		if len(cur) > 0 {
			toks = append(toks, string(cur))
			cur = cur[:0]
		}
	}
	for _, r := range strings.ToLower(text) {
		r = foldAccent(r)
		switch {
		case r == 0 || r == 0xfffd || (unicode.IsControl(r) && !unicode.IsSpace(r)):
		case unicode.IsSpace(r):
			flush()
		case isBertPunct(r):
			flush()
			toks = append(toks, string(r))
		default:
			cur = append(cur, r)
		}
	}
	flush()
	return toks
}

func isBertPunct(r rune) bool {
	if (r >= 33 && r <= 47) || (r >= 58 && r <= 64) || (r >= 91 && r <= 96) || (r >= 123 && r <= 126) {
		return true
	}
	return unicode.IsPunct(r)
}

// the accented letters a song or artist name is likely to carry
var accentFold = map[rune]rune{
	'à': 'a', 'á': 'a', 'â': 'a', 'ã': 'a', 'ä': 'a', 'å': 'a', 'ç': 'c', 'è': 'e', 'é': 'e', 'ê': 'e', 'ë': 'e',
	'ì': 'i', 'í': 'i', 'î': 'i', 'ï': 'i', 'ñ': 'n', 'ò': 'o', 'ó': 'o', 'ô': 'o', 'õ': 'o', 'ö': 'o', 'ù': 'u',
	'ú': 'u', 'û': 'u', 'ü': 'u', 'ý': 'y', 'ÿ': 'y',
}

func foldAccent(r rune) rune {
	if f, ok := accentFold[r]; ok {
		return f
	}
	return r
}

// ---------------------------------------------------------------- the voice side

// meaningOf: what the meaning-matcher makes of a request, as a command the
// rules know; "" when it isn't sure
func (v *voiceService) meaningOf(ctx context.Context, transcript string) string {
	if !v.meaning.available() {
		return ""
	}
	start := time.Now()
	cmd, score, err := v.meaning.match(ctx, transcript)
	if err != nil {
		v.app.log.WithError(err).Warn("voice: meaning-matcher failed")
		return ""
	}
	if cmd == "" {
		v.app.log.Infof("voice: no meaning for %q (best %.2f) in %s", transcript, score, time.Since(start).Round(time.Millisecond))
		return ""
	}
	v.app.log.Infof("voice: %q means %q (%.2f) in %s", transcript, cmd, score, time.Since(start).Round(time.Millisecond))
	return cmd
}
