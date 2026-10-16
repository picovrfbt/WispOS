#!/bin/sh
# Packs the over-the-air update for a release: the daemon and the UI from the
# last `just prepare`, plus the version, as output/wisp-app-<tag>.tar.gz (and a
# .sha256 beside it). Attach both to the GitHub release named <tag>; Wisp's
# updater (wisp-daemon/daemon/updater.go) looks for exactly that file name.
#
#   sh scripts/make-app-bundle.sh v0.2.5
set -eu
TAG="${1:?usage: make-app-bundle.sh <tag, e.g. v0.2.5>}"
cd "$(dirname "$0")/.."
[ -f go-librespot-armv6 ] && [ -f ui.zip ] || { echo "run 'just prepare' first" >&2; exit 1; }
# Wisp OS runs the 64-bit daemon: its bundles carry an -arm64 suffix
# (wisp-daemon/daemon/updater_split.go's bundleArch) and are made when
# go-librespot-arm64 is here (crosscompile.sh arm64)

STAGE=$(mktemp -d)
trap 'rm -rf "$STAGE"' EXIT
install -m 0755 go-librespot-armv6 "$STAGE/go-librespot"
mkdir -p "$STAGE/ui"
unzip -q ui.zip -d "$STAGE/ui"
echo "$TAG" > "$STAGE/version.txt"

mkdir -p output
OUT="output/wisp-app-$TAG.tar.gz"
tar -C "$STAGE" --owner=0 --group=0 -czf "$OUT" .
(cd output && sha256sum "wisp-app-$TAG.tar.gz" > "wisp-app-$TAG.tar.gz.sha256")
echo "$OUT ($(du -h "$OUT" | cut -f1)), sha256 $(cut -c1-16 "$OUT.sha256")"

# The same update in two parts, for updaters that fetch fonts only when they
# lack them (wisp-daemon/daemon/updater_split.go). The fonts are named by a
# digest of their contents: sha256 over "<sha256> <path>" lines in byte order,
# exactly as fontsDigest computes it.
FONTS_DIGEST=$(cd "$STAGE/ui/fonts" && find . -type f | sed 's|^\./||' | LC_ALL=C sort |
  while IFS= read -r f; do printf '%s %s\n' "$(sha256sum "$f" | cut -d' ' -f1)" "$f"; done |
  sha256sum | cut -d' ' -f1)
FONTS="output/wisp-fonts-$(echo "$FONTS_DIGEST" | cut -c1-12).tar"
tar -C "$STAGE" --owner=0 --group=0 -cf "$FONTS" ui/fonts
CORE_STAGE=$(mktemp -d)
cp -a "$STAGE/." "$CORE_STAGE/"
rm -rf "$CORE_STAGE/ui/fonts"
echo "$FONTS_DIGEST" > "$CORE_STAGE/fonts.sha256"
CORE="output/wisp-core-$TAG.tar.gz"
tar -C "$CORE_STAGE" --owner=0 --group=0 -czf "$CORE" .
rm -rf "$CORE_STAGE"
echo "$CORE ($(du -h "$CORE" | cut -f1)) + $FONTS ($(du -h "$FONTS" | cut -f1), only when a Car Thing lacks them)"

if [ -f go-librespot-arm64 ]; then
  for KIND in app core; do
    SRC="output/wisp-$KIND-$TAG.tar.gz"
    DST="output/wisp-$KIND-$TAG-arm64.tar.gz"
    T=$(mktemp -d)
    tar -C "$T" -xzf "$SRC"
    install -m 0755 go-librespot-arm64 "$T/go-librespot"
    tar -C "$T" --owner=0 --group=0 -czf "$DST" .
    rm -rf "$T"
    (cd output && sha256sum "$(basename "$DST")" > "$(basename "$DST").sha256")
  done
  echo "and the same for Wisp OS: wisp-app-$TAG-arm64.tar.gz, wisp-core-$TAG-arm64.tar.gz"
fi
