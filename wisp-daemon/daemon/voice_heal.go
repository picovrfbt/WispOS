package daemon

import (
	"os"
	"path/filepath"
	"sort"
	"strings"
)

// A config on the data partition is copied there once, at the first start,
// and kept from then on: a Car Thing flashed with Wisp OS over an older Wisp
// still has that Wisp's voice section, which names models and programs Wisp
// OS doesn't ship (the gigaspeech speech model, no meaning matcher). Speech
// then never starts. healVoicePaths points each voice path that isn't there
// at what this system does ship, so an update fixes it without a reflash.

// where Wisp OS keeps the voice (meta-wisp's wisp-voice recipe)
var voiceShipped = struct{ lib, share string }{"/usr/lib/wisp/voice", "/usr/share/wisp/voice"}

func exists(p string) bool {
	_, err := os.Stat(p)
	return err == nil
}

func hasGlob(dir, pattern string) bool {
	m, _ := filepath.Glob(filepath.Join(dir, pattern))
	return len(m) > 0
}

// healVoicePaths returns cfg with missing paths replaced by the shipped ones,
// and what it changed, for the log
func healVoicePaths(cfg VoiceConfig, lib, share string) (VoiceConfig, []string) {
	var fixed []string
	set := func(name string, field *string, to string) {
		if *field != to {
			fixed = append(fixed, name+": "+*field+" -> "+to)
			*field = to
		}
	}
	if !exists(share) {
		return cfg, nil // not Wisp OS: nothing to point at
	}
	if bin := filepath.Join(lib, "bin"); !exists(cfg.BinDir) && exists(bin) {
		set("bin_dir", &cfg.BinDir, bin)
	}
	if !exists(filepath.Join(cfg.LibDir, "ld-linux-aarch64.so.1")) && exists(filepath.Join(lib, "ld-linux-aarch64.so.1")) {
		set("lib_dir", &cfg.LibDir, lib)
	}
	if models := filepath.Join(share, "models"); !exists(cfg.ModelDir) && exists(models) {
		set("model_dir", &cfg.ModelDir, models)
	}
	if cfg.WakeModel != "" && !filepath.IsAbs(cfg.WakeModel) && !exists(filepath.Join(cfg.ModelDir, cfg.WakeModel)) &&
		exists(filepath.Join(cfg.ModelDir, "okay_wisp.tflite")) {
		set("wake_model", &cfg.WakeModel, "okay_wisp.tflite")
	}
	if cfg.SherpaEnabled {
		if !hasGlob(cfg.SherpaModelDir, "encoder*int8.onnx") {
			// the speech model this system has; the small English one first
			dirs, _ := filepath.Glob(filepath.Join(share, "zipformer", "*"))
			sort.SliceStable(dirs, func(a, b int) bool {
				return strings.Contains(dirs[a], "small") && !strings.Contains(dirs[b], "small")
			})
			for _, d := range dirs {
				if hasGlob(d, "encoder*int8.onnx") {
					set("sherpa_model_dir", &cfg.SherpaModelDir, d)
					break
				}
			}
		}
		if !exists(filepath.Join(cfg.BinDir, cfg.SherpaBin)) && exists(filepath.Join(cfg.BinDir, "wisp_asr_server")) {
			set("sherpa_bin", &cfg.SherpaBin, "wisp_asr_server")
		}
	}
	if meaning := filepath.Join(share, "meaning"); (cfg.MeaningDir == "" || !exists(cfg.MeaningDir)) && exists(meaning) {
		set("meaning_dir", &cfg.MeaningDir, meaning)
	}
	if cfg.EspeakDataDir != "" && !exists(cfg.EspeakDataDir) && exists(filepath.Join(share, "espeak-ng-data")) {
		set("espeak_data_dir", &cfg.EspeakDataDir, share)
	}
	return cfg, fixed
}
