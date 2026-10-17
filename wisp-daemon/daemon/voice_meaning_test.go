package daemon

import (
	"bufio"
	"os"
	"path/filepath"
	"strconv"
	"strings"
	"testing"
)

// the bank, vocabulary and examples live with the model's other files
var meaningSrc = filepath.Join("..", "..", "wisp-firmware", "voice-src", "meaning")

func meaningFile(t *testing.T, name string) string {
	t.Helper()
	p := filepath.Join(meaningSrc, name)
	if !fileExists(p) {
		t.Skipf("%s not here", p)
	}
	return p
}

// the Go tokenizer must give the model exactly what Python's (Hugging Face) does
func TestWordPieceMatchesTheModelsTokenizer(t *testing.T) {
	vocab, err := loadVocab(meaningFile(t, "vocab.txt"))
	if err != nil {
		t.Fatal(err)
	}
	f, err := os.Open(meaningFile(t, "tokens.tsv"))
	if err != nil {
		t.Fatal(err)
	}
	defer func() { _ = f.Close() }()
	sc := bufio.NewScanner(f)
	n := 0
	for sc.Scan() {
		text, want, _ := strings.Cut(sc.Text(), "\t")
		var got []string
		for _, id := range wordPiece(vocab, text, meaningMaxTokens) {
			got = append(got, strconv.Itoa(int(id)))
		}
		if strings.Join(got, " ") != want {
			t.Errorf("%q: got %s, want %s", text, strings.Join(got, " "), want)
		}
		n++
	}
	if n < 20 {
		t.Fatalf("only %d samples", n)
	}
}

func TestMeaningBankLoads(t *testing.T) {
	bank, dim, err := loadMeaningBank(meaningFile(t, "bank.bin"))
	if err != nil {
		t.Fatal(err)
	}
	if dim != 384 || len(bank) < 150 {
		t.Fatalf("%d examples of %d", len(bank), dim)
	}
}

// every command in the bank must be one the rules carry out
func TestEveryBankCommandIsUnderstood(t *testing.T) {
	bank, _, err := loadMeaningBank(meaningFile(t, "bank.bin"))
	if err != nil {
		t.Fatal(err)
	}
	controls := map[string]bool{}
	for _, c := range controlPhrases {
		controls[c.phrase] = true
	}
	seen := map[string]bool{}
	for _, e := range bank {
		if seen[e.command] {
			continue
		}
		seen[e.command] = true
		cmd := normalizeLoose(e.command)
		if _, ok := understand(cmd); ok {
			continue
		}
		if controls[cmd] {
			continue
		}
		t.Errorf("the bank's %q isn't something Wisp does", e.command)
	}
}

func TestMeaningFitsCatchesOpposites(t *testing.T) {
	cases := []struct {
		text, cmd string
		ok        bool
	}{
		{"way too noisy", "turn it up", false},
		{"bump up the volume", "turn it down", false},
		{"the screen hurts my eyes", "make it brighter", false},
		{"i can't read the screen", "dim the screen", false},
		{"stop the music for now", "resume", false},
		{"is it raining where we're going", "play something rainy day", false},
		{"louder please", "turn it up", true},
		{"i'm nodding off", "play something energetic", true},
	}
	for _, c := range cases {
		if got := meaningFits(c.text, c.cmd); got != c.ok {
			t.Errorf("meaningFits(%q, %q) = %v", c.text, c.cmd, got)
		}
	}
}

func TestPickMeaning(t *testing.T) {
	v := func(xs ...int8) []int8 { return xs }
	bank := []meaningEntry{
		{"turn it up", v(127, 0, 0)},
		{"turn it down", v(120, 30, 0)},
		{"what's playing", v(0, 127, 0)},
	}
	// close to both volume commands, but the words rule "up" out
	if cmd, _ := pickMeaning("way too loud", []float32{0.97, 0.24, 0}, bank); cmd != "turn it down" {
		t.Fatalf("got %q", cmd)
	}
	// two different commands too close to call
	if cmd, _ := pickMeaning("hmm", []float32{0.99, 0.12, 0}, bank); cmd != "" {
		t.Fatalf("a near tie should be no answer, got %q", cmd)
	}
	// nothing close enough
	if cmd, _ := pickMeaning("hmm", []float32{0, 0, 1}, bank); cmd != "" {
		t.Fatalf("got %q", cmd)
	}
	if cmd, _ := pickMeaning("what is this", []float32{0, 1, 0}, bank); cmd != "what's playing" {
		t.Fatalf("got %q", cmd)
	}
}
