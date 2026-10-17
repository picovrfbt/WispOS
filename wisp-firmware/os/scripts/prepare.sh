#!/bin/sh
# Stages Wisp into the layer for a Wisp OS build: the arm64 daemon and its
# config, the UI, the static server, the voice bundle and (with Rust) the
# iPhone volume sidecar. Run from wisp-firmware/os on Linux or WSL:
#
#   sh scripts/prepare.sh v0.3.0
#
# Everything lands in meta-wisp/recipes-wisp/*/files/payload/ (gitignored) and
# meta-wisp/conf/distro/include/wisp-version.inc.
set -eu

VERSION="${1:?usage: prepare.sh <version, e.g. v0.3.0>}"
OS=$(cd "$(dirname "$0")/.." && pwd)
FW=$(cd "$OS/.." && pwd)
ROOT=$(cd "$FW/.." && pwd)
R="$OS/meta-wisp/recipes-wisp"
STATIC_WEB_SERVER_VERSION="${STATIC_WEB_SERVER_VERSION:-v2.38.0}"

say() { printf '>> %s\n' "$*"; }

for d in wisp-daemon wisp-ui wisp-voice; do
  rm -rf "$R/$d/files/payload"
  mkdir -p "$R/$d/files/payload"
done

say "version $VERSION"
mkdir -p "$OS/meta-wisp/conf/distro/include"
# the root password for ssh over USB (closed on the Bluetooth link), the same
# build setting and default as the original firmware's build.sh
# extrausers runs this through a shell, so the hash's $ signs are escaped
HASH=$(openssl passwd -6 "${DEFAULT_ROOT_PASSWORD:-thing}" | sed 's/\$/\\$/g')
{
  printf 'WISP_VERSION = "%s"\n' "${VERSION#v}"
  printf 'EXTRA_USERS_PARAMS = "usermod -p '"'"'%s'"'"' root;"\n' "$HASH"
} > "$OS/meta-wisp/conf/distro/include/wisp-version.inc"

# --- the daemon --------------------------------------------------------------
say "daemon (arm64)"
D="$R/wisp-daemon/files/payload"
(cd "$ROOT/wisp-daemon" && ./crosscompile.sh arm64 > /dev/null)
install -m 0755 "$ROOT/wisp-daemon/go-librespot-arm64" "$D/go-librespot"
cp "$ROOT/wisp-daemon/config.yml" "$D/config.yml"
# the primary lyrics provider's keys; empty for public builds (they fall back to lrclib)
cp "$ROOT/wisp-daemon/.env" "$D/lp.env" 2>/dev/null || : > "$D/lp.env"

if command -v cargo > /dev/null; then
  say "iPhone volume sidecar (aarch64)"
  (cd "$ROOT/wisp-daemon/iap2/sidecar" &&
    RUSTFLAGS="-C linker=rust-lld -C target-feature=+crt-static" \
      cargo build --release --target aarch64-unknown-linux-musl)
  install -m 0755 "$ROOT/wisp-daemon/iap2/sidecar/target/aarch64-unknown-linux-musl/release/iap2-sidecar" "$D/iap2-sidecar"
else
  say "no Rust: building without iPhone volume"
fi

# --- the voice ---------------------------------------------------------------
say "voice"
VA="$FW/voice-artifacts"
[ -d "$VA" ] || bash "$FW/scripts/get-voice-artifacts.sh" "$VA"
V="$R/wisp-voice/files/payload"
mkdir -p "$V/bin" "$V/lib" "$V/models"
cp -a "$VA"/bin/. "$V/bin/"

# speech-to-text: Wisp's own server (wisp-firmware/voice-src) running Zipformer
# Small, about 140 MB loaded where the bundle's general-purpose model took
# about 240 MB, and about three times faster on the Car Thing. Neither the
# bundle's server nor its model ships on Wisp OS
rm -f "$V/bin/sherpa_asr_server"
aarch64-linux-gnu-gcc -O2 -march=armv8-a+crypto+crc -mtune=cortex-a53 \
  -I"$FW/voice-src" -o "$V/bin/wisp_asr_server" "$FW/voice-src/wisp_asr_server.c" \
  -L"$VA/lib" -lsherpa-onnx-c-api -Wl,--allow-shlib-undefined
aarch64-linux-gnu-strip "$V/bin/wisp_asr_server"
SM=sherpa-onnx-zipformer-small-en-2023-06-26
MD="$FW/voice-models/$SM"
if [ ! -f "$MD/encoder-epoch-99-avg-1.int8.onnx" ]; then
  say "fetching the speech model ($SM)"
  T=$(mktemp -d)
  curl -fsSL -o "$T/m.tar.bz2" "https://github.com/k2-fsa/sherpa-onnx/releases/download/asr-models/$SM.tar.bz2"
  tar -xjf "$T/m.tar.bz2" -C "$T"
  mkdir -p "$MD"
  cp "$T/$SM"/*.int8.onnx "$T/$SM/tokens.txt" "$MD/"
  rm -rf "$T"
fi
mkdir -p "$V/zipformer/$SM"
cp "$MD"/encoder-epoch-99-avg-1.int8.onnx "$MD"/decoder-epoch-99-avg-1.int8.onnx \
   "$MD"/joiner-epoch-99-avg-1.int8.onnx "$MD"/tokens.txt "$V/zipformer/$SM/"
# ONNX Runtime settings: the memory arena off, so the longest clip's working
# memory isn't kept for good
printf 'EnableCpuMemArena=0\n' > "$V/zipformer/ort.conf"

# the meaning-matcher (voice-src/meaning): what a request means when Wisp's own
# rules miss and no phone model is there. all-MiniLM-L6-v2 (Apache-2.0, 23 MB),
# run on the ONNX Runtime above only while it's needed
aarch64-linux-gnu-gcc -O2 -march=armv8-a+crypto+crc -mtune=cortex-a53 \
  -I"$FW/voice-src/meaning" -o "$V/bin/wisp_meaning_server" "$FW/voice-src/meaning/wisp_meaning_server.c" \
  -L"$VA/lib" -lonnxruntime -lm -Wl,--allow-shlib-undefined
aarch64-linux-gnu-strip "$V/bin/wisp_meaning_server"
MM="$FW/voice-models/all-MiniLM-L6-v2"
if [ ! -f "$MM/model_quantized.onnx" ]; then
  say "fetching the meaning model (all-MiniLM-L6-v2)"
  mkdir -p "$MM"
  curl -fsSL -o "$MM/model_quantized.onnx" "https://huggingface.co/Xenova/all-MiniLM-L6-v2/resolve/main/onnx/model_quantized.onnx"
fi
mkdir -p "$V/meaning"
cp "$MM/model_quantized.onnx" "$FW/voice-src/meaning/vocab.txt" "$FW/voice-src/meaning/bank.bin" "$V/meaning/"
# Wisp's wake listener: openWakeWord's listener plus the Voice button's listen-now signal
[ -f "$FW/voice-bin/oww_wake" ] && install -m 0755 "$FW/voice-bin/oww_wake" "$V/bin/oww_wake"
cp -a "$VA"/lib/. "$V/lib/"
# the wake word itself comes from wake-models/ ("Okay Wisp"); Mira's "Hey Mira" isn't shipped
cp -a "$VA"/models/melspectrogram.tflite "$VA"/models/embedding_model.tflite "$V/models/"
for m in "$FW"/wake-models/*.tflite; do
  [ -f "$m" ] && cp "$m" "$V/models/"
done
cp -a "$VA"/espeak-ng-data "$V/"

# the voice section of the daemon's config, as the original firmware's stage 20 writes it
WAKE_MODEL="${WAKE_MODEL:-okay_wisp.tflite}"
WAKE_THRESHOLD="${WAKE_THRESHOLD:-0.3}"
WAKE_THRESHOLD_PLAYING="${WAKE_THRESHOLD_PLAYING:-0.45}"
[ -f "$V/models/$WAKE_MODEL" ] || { echo "wake model $WAKE_MODEL missing" >&2; exit 1; }
CFG="$D/config.yml"
awk 'BEGIN{inv=0} /^voice:/{inv=1; next} inv && /^[^ \t#]/{inv=0} !inv{print}' "$CFG" > "$CFG.tmp"
mv -f "$CFG.tmp" "$CFG"
cat >> "$CFG" << EOF
voice:
  enabled: true
  wake: true
  bin_dir: "/usr/lib/wisp/voice/bin"
  lib_dir: "/usr/lib/wisp/voice"
  model_dir: "/usr/share/wisp/voice/models"
  mic_device: "hw:0,0"
  cascade: true
  espeak_bin: "espeak-ng"
  espeak_data_dir: "/usr/share/wisp/voice"
  cache_dir: "/var/local/wisp/voice/cache"
  catalog_sync: true
  accept_threshold: 0.42
  sherpa_enabled: true
  sherpa_bin: "wisp_asr_server"
  sherpa_model_dir: "/usr/share/wisp/voice/zipformer/sherpa-onnx-zipformer-small-en-2023-06-26"
  meaning_dir: "/usr/share/wisp/voice/meaning"
  wake_model: "$WAKE_MODEL"
  wake_threshold: $WAKE_THRESHOLD
  wake_threshold_playing: $WAKE_THRESHOLD_PLAYING
EOF

# --- the UI ------------------------------------------------------------------
say "UI"
U="$R/wisp-ui/files/payload"
(cd "$ROOT/wisp-ui" && npm ci --silent && npm run build --silent)
mkdir -p "$U/ui"
cp -a "$ROOT/wisp-ui/dist/." "$U/ui/"

say "static-web-server $STATIC_WEB_SERVER_VERSION (aarch64)"
T=$(mktemp -d)
curl -fsSL -o "$T/sws.tar.gz" \
  "https://github.com/static-web-server/static-web-server/releases/download/$STATIC_WEB_SERVER_VERSION/static-web-server-$STATIC_WEB_SERVER_VERSION-aarch64-unknown-linux-musl.tar.gz"
tar -xzf "$T/sws.tar.gz" -C "$T" --strip-components=1 --wildcards '*/static-web-server'
install -m 0755 "$T/static-web-server" "$U/static-web-server"
rm -rf "$T"

say "staged: daemon $(du -sh "$D" | cut -f1), UI $(du -sh "$U" | cut -f1), voice $(du -sh "$V" | cut -f1)"
