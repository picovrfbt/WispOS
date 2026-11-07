#!/usr/bin/env bash
# Checks a published release has everything Car Things and phones look for,
# so a release that's missing something fails loudly instead of shipping.
#
#   GH_TOKEN=... bash tools/check_release.sh v1.1.0
#
# Run by the release workflow's last job; also fine to run by hand.
set -euo pipefail

TAG="${1:?usage: check_release.sh <tag, e.g. v1.1.0>}"
REPO="${GITHUB_REPOSITORY:-picovrfbt/WispOS}"
fail=0
bad() { echo "::error::$*"; fail=1; }

assets=$(gh release view "$TAG" --repo "$REPO" --json assets -q '.assets[].name')
has() { grep -qxF "$1" <<< "$assets"; }
has_like() { grep -qE "$1" <<< "$assets"; }

# Wisp's own update, for both systems (armv6 original firmware, arm64 Wisp OS)
for f in "wisp-app-$TAG.tar.gz" "wisp-app-$TAG.tar.gz.sha256" "wisp-core-$TAG.tar.gz" \
         "wisp-app-$TAG-arm64.tar.gz" "wisp-app-$TAG-arm64.tar.gz.sha256" \
         "wisp-core-$TAG-arm64.tar.gz" "wisp-core-$TAG-arm64.tar.gz.sha256"; do
  has "$f" || bad "missing $f"
done
has_like '^wisp-fonts-[0-9a-f]{12}\.tar$' || bad "missing the fonts (wisp-fonts-<digest>.tar)"

# the Wisp app, at the version its build file says
app_ver=$(grep -m1 'versionName' wisp-companion/app/build.gradle.kts | sed 's/.*"\(.*\)".*/\1/')
has "wisp-companion-v$app_ver.apk" || bad "missing wisp-companion-v$app_ver.apk"
n_apk=$(grep -c '^wisp-companion-v.*\.apk$' <<< "$assets" || true)
[ "$n_apk" -le 1 ] || bad "$n_apk Wisp app APKs on the release; keep only v$app_ver"

# what the app downloads on demand
has_like '^wisp-voice-.*\.zip$' || bad "missing the voice pack (wisp-voice-*.zip)"
for g in $(grep -o '"[a-z]*": true' wisp-daemon/daemon/phone_drive.go | tr -d '":' | sed 's/ true//'); do
  has_like "^wisp-drive-$g-v[0-9]+\.zip$" || bad "missing Drive Mode music for $g (wisp-drive-$g-v*.zip)"
done

# Wisp OS system updates: optional, but whole when there
for v in $(grep -oE '^wisp-os-v[0-9]+\.[0-9]+\.[0-9]+\.swu$' <<< "$assets" | sed -E 's/^wisp-os-(v[0-9.]+)\.swu$/\1/'); do
  d=0
  for p in "-delta.swu" "-system.zck" "-boot.zck"; do has "wisp-os-$v$p" && d=$((d + 1)); done
  [ "$d" = 0 ] || [ "$d" = 3 ] || bad "Wisp OS $v's delta is incomplete (needs -delta.swu, -system.zck and -boot.zck)"
done
n_os=$(grep -cE '^wisp-os-v[0-9.]+\.swu$' <<< "$assets" || true)
[ "$n_os" -le 1 ] || bad "$n_os whole-system updates on the release; keep the newest"
if grep -qE 'flashthing' <<< "$assets"; then
  grep -E 'flashthing' <<< "$assets" | grep -qv "wisp-os-$TAG-flashthing.zip" && bad "an older flash image was carried onto this release"
fi

# the Wisp app changed since the last release but kept its version: phones
# with the old one would never be offered it
prev=$(git tag --sort=-v:refname | grep -E '^v[0-9]+\.[0-9]+\.[0-9]+$' | grep -vxF "$TAG" | head -1 || true)
if [ -n "$prev" ] && ! git diff --quiet "$prev" HEAD -- wisp-companion/app/src wisp-companion/app/build.gradle.kts; then
  prev_ver=$(git show "$prev:wisp-companion/app/build.gradle.kts" | grep -m1 'versionName' | sed 's/.*"\(.*\)".*/\1/')
  [ "$prev_ver" != "$app_ver" ] || bad "the Wisp app changed since $prev but is still $app_ver: bump versionName/versionCode"
fi

if [ "$fail" = 0 ]; then
  echo "Release $TAG has everything."
else
  exit 1
fi
