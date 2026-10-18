#!/bin/sh
# Builds what Wisp Phone carries inside it: wisp-daemon for 64-bit ARM Android
# (as phone/src/main/jniLibs/arm64-v8a/libwispd.so) and the screens
# (wisp-ui's build, as phone/src/main/assets/ui). Needs Go and Node.
set -eu
here=$(cd "$(dirname "$0")/.." && pwd)
repo=$(cd "$here/.." && pwd)
out="$here/phone/src/main"

mkdir -p "$out/jniLibs/arm64-v8a"
(cd "$repo/wisp-daemon" && GOOS=android GOARCH=arm64 CGO_ENABLED=0 \
  go build -trimpath -ldflags "-s -w" -o "$out/jniLibs/arm64-v8a/libwispd.so" ./cmd/wisp-daemon)

(cd "$repo/wisp-ui" && { [ -d node_modules ] || npm ci; } && npm run build)
rm -rf "$out/assets/ui"
mkdir -p "$out/assets"
cp -R "$repo/wisp-ui/dist" "$out/assets/ui"
