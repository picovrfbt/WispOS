#!/bin/sh

# install the on-device voice/ML stack into the rootfs
if [ "${BUNDLE_VOICE:-1}" = "0" ]; then
  color_echo "  Stage 20 - voice bundling SKIPPED (BUNDLE_VOICE=0)" -Yellow
  return 0 2>/dev/null || exit 0
fi

VA="${SAVED_PWD}/voice-artifacts"
if [ ! -d "$VA" ]; then
  color_echo "Missing ${VA}. Run 'just prepare' (it runs mira-vs/collect-artifacts.sh)." -Red
  exit 1
fi

# is it a stale bundle without the memory fix
if ! grep -qa "zipformer/ort.conf" "$VA/bin/sherpa_asr_server" || [ ! -f "$VA/zipformer/ort.conf" ]; then
  color_echo "Stale voice bundle in ${VA} (sherpa_asr_server/ort.conf predate the arena fix). Rerun 'just prepare'." -Red
  exit 1
fi

# rootfs locations
VLIB="$ROOTFS_PATH/usr/lib/mira/voice" 
VSHARE="$ROOTFS_PATH/usr/share/mira/voice"
mkdir -p "$VLIB/bin" "$VSHARE/models" "$VSHARE/espeak-ng-data"

install -m0755 "$VA"/bin/* "$VLIB/bin/"

# Wisp's wake listener: Mira's oww_wake plus a manual "listen now" trigger
# (SIGUSR1, the Voice button). Source change: voice-patches/; built with
# mira-voice's aarch64 toolchain image against the same TFLite C API
if [ -f "${SAVED_PWD}/voice-bin/oww_wake" ]; then
  install -m0755 "${SAVED_PWD}/voice-bin/oww_wake" "$VLIB/bin/oww_wake"
fi

cp -a "$VA"/lib/. "$VLIB/"
chmod 0755 "$VLIB/ld-linux-aarch64.so.1"

cp -a "$VA"/models/melspectrogram.tflite \
      "$VA"/models/embedding_model.tflite \
      "$VA"/models/hey_mira.tflite \
      "$VSHARE/models/"

# custom wake words: any openWakeWord .tflite in wake-models/ ships too, and
# WAKE_MODEL=<file> picks the one the daemon listens for. Wisp listens for
# "Okay Wisp" (wake-models/okay_wisp.tflite), which at 0.3 also catches "Hey Wisp";
# WAKE_MODEL=hey_mira.tflite WAKE_THRESHOLD=0.4 WAKE_THRESHOLD_PLAYING=0.6 restores Mira's
if [ -d "${SAVED_PWD}/wake-models" ]; then
  for m in "${SAVED_PWD}"/wake-models/*.tflite; do
    [ -f "$m" ] && install -m 0644 "$m" "$VSHARE/models/"
  done
fi
WAKE_MODEL="${WAKE_MODEL:-okay_wisp.tflite}"
# tuned on the device: 0.3 is reliable for Okay Wisp; stricter while music
# plays, since lyrics are where false wakes come from
WAKE_THRESHOLD="${WAKE_THRESHOLD:-0.3}"
WAKE_THRESHOLD_PLAYING="${WAKE_THRESHOLD_PLAYING:-0.45}"
if [ ! -f "$VSHARE/models/$WAKE_MODEL" ]; then
  color_echo "Wake model $WAKE_MODEL not found in voice-artifacts/models or wake-models/" -Red
  exit 1
fi

# sherpa gigaspeech-Zipformer
cp -a "$VA"/zipformer "$VSHARE/"

cp -a "$VA"/espeak-ng-data/. "$VSHARE/espeak-ng-data/"

CFG="$ROOTFS_PATH/etc/go-librespot/config.yml"
awk 'BEGIN{inv=0} /^voice:/{inv=1; next} inv && /^[^ \t#]/{inv=0} !inv{print}' \
  "$CFG" > "$CFG.tmp" && mv -f "$CFG.tmp" "$CFG"
cat >> "$CFG" <<'EOF'

voice:
  enabled: true
  wake: true
  bin_dir: "/usr/lib/mira/voice/bin"
  lib_dir: "/usr/lib/mira/voice"
  model_dir: "/usr/share/mira/voice/models"
  mic_device: "hw:0,0"
  cascade: true
  espeak_bin: "espeak-ng"
  espeak_data_dir: "/usr/share/mira/voice"
  cache_dir: "/var/local/mira/voice/cache"
  catalog_sync: true
  accept_threshold: 0.42
  sherpa_enabled: true
  sherpa_bin: "sherpa_asr_server"
  sherpa_model_dir: "/usr/share/mira/voice/zipformer/sherpa-onnx-zipformer-gigaspeech-2023-12-12"
EOF
{
  echo "  wake_model: \"$WAKE_MODEL\""
  echo "  wake_threshold: $WAKE_THRESHOLD"
  echo "  wake_threshold_playing: $WAKE_THRESHOLD_PLAYING"
} >> "$CFG"

color_echo "  voice stack installed (lib=$(du -sh "$VLIB" 2>/dev/null | cut -f1) share=$(du -sh "$VSHARE" 2>/dev/null | cut -f1))" -Green
