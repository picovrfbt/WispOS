package daemon

import (
	"os"
	"path/filepath"
	"strings"
	"testing"
)

func TestHealVoicePaths(t *testing.T) {
	root := t.TempDir()
	lib, share := filepath.Join(root, "lib"), filepath.Join(root, "share")
	touch := func(p string) {
		_ = os.MkdirAll(filepath.Dir(p), 0o755)
		_ = os.WriteFile(p, nil, 0o644)
	}
	touch(filepath.Join(lib, "ld-linux-aarch64.so.1"))
	touch(filepath.Join(lib, "bin", "wisp_asr_server"))
	touch(filepath.Join(share, "models", "okay_wisp.tflite"))
	small := filepath.Join(share, "zipformer", "sherpa-onnx-zipformer-small-en-2023-06-26")
	touch(filepath.Join(small, "encoder-epoch-99-avg-1.int8.onnx"))
	touch(filepath.Join(share, "meaning", "model.onnx"))

	// a Car Thing's config from the Wisp before Wisp OS
	old := VoiceConfig{
		BinDir: filepath.Join(lib, "bin"), LibDir: lib, ModelDir: filepath.Join(share, "models"),
		WakeModel: "okay_wisp.tflite", SherpaEnabled: true, SherpaBin: "wisp_asr_server",
		SherpaModelDir: filepath.Join(share, "zipformer", "sherpa-onnx-zipformer-gigaspeech-2023-12-12"),
	}
	got, fixed := healVoicePaths(old, lib, share)
	if got.SherpaModelDir != small || got.MeaningDir != filepath.Join(share, "meaning") || len(fixed) != 2 {
		t.Fatalf("healed %+v, %v", got, fixed)
	}
	if !strings.HasPrefix(fixed[0], "sherpa_model_dir: ") {
		t.Fatalf("log %v", fixed)
	}
	// a right config stays as it is
	if again, fixed := healVoicePaths(got, lib, share); len(fixed) != 0 || again != got {
		t.Fatalf("changed a good config: %v", fixed)
	}
	// not on Wisp OS: left alone
	if _, fixed := healVoicePaths(old, lib, filepath.Join(root, "nope")); fixed != nil {
		t.Fatal("touched a config off Wisp OS")
	}
}
