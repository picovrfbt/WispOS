package daemon

import (
	"bufio"
	"os"
	"strings"
	"testing"
)

// every command in the meaning-matcher's examples is one Wisp acts on, so a
// phrasing can't quietly land on a command nothing understands
func TestMeaningExamplesAreCommands(t *testing.T) {
	f, err := os.Open("../../wisp-firmware/voice-src/meaning/examples.tsv")
	if err != nil {
		t.Skip("examples not here:", err)
	}
	defer f.Close()
	control := func(cmd string) bool {
		words := strings.Fields(cmd)
		for _, e := range controlPhrases {
			pw := strings.Fields(e.phrase)
			if len(words) >= len(pw) && strings.Join(words[:len(pw)], " ") == e.phrase && restIsFiller(words[len(pw):]) {
				return true
			}
		}
		return false
	}
	seen := map[string]bool{}
	sc := bufio.NewScanner(f)
	for sc.Scan() {
		line := sc.Text()
		if strings.TrimSpace(line) == "" || strings.HasPrefix(line, "#") {
			continue
		}
		said, cmd, ok := strings.Cut(line, "\t")
		cmd = strings.TrimSpace(cmd)
		if !ok {
			t.Errorf("no tab: %q", line)
			continue
		}
		if cmd == "" || seen[cmd] {
			continue
		}
		seen[cmd] = true
		if _, ok := understand(normalizeLoose(cmd)); ok {
			continue
		}
		if !control(normalizeLoose(cmd)) {
			t.Errorf("%q -> %q, which Wisp doesn't act on", said, cmd)
		}
	}
	if len(seen) < 60 {
		t.Errorf("only %d commands in the examples", len(seen))
	}
}

// the bank the daemon carries was rebuilt after the examples last changed
func TestEmbeddedBankMatchesExamples(t *testing.T) {
	raw, err := os.ReadFile("../../wisp-firmware/voice-src/meaning/examples.tsv")
	if err != nil {
		t.Skip("examples not here:", err)
	}
	var want []string
	for _, line := range strings.Split(string(raw), "\n") {
		if strings.TrimSpace(line) == "" || strings.HasPrefix(line, "#") {
			continue
		}
		_, cmd, _ := strings.Cut(line, "\t")
		want = append(want, strings.TrimSpace(cmd))
	}
	bank, dim, err := parseMeaningBank(embeddedMeaningBank)
	if err != nil || dim != 384 {
		t.Fatalf("bank: %v, dim %d", err, dim)
	}
	if len(bank) != len(want) {
		t.Fatalf("bank has %d examples, examples.tsv %d: run make_bank.py", len(bank), len(want))
	}
	for i, e := range bank {
		if e.command != want[i] {
			t.Fatalf("example %d: bank says %q, examples.tsv %q: run make_bank.py", i, e.command, want[i])
		}
	}
}
