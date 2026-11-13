#!/usr/bin/env bash
# Mounts the DMG found in <dir>, checks that the .app inside carries a valid
# ad-hoc signature that seals the whole bundle (Info.plist + resources), and
# detaches. Exits non-zero if anything is off.
#
# A bundle that is only linker-signed fails `codesign --verify` with "code has
# no resources but signature indicates they must be present", and a downloaded
# copy then shows "is damaged" instead of the usual "unidentified developer".
#
# Usage: scripts/verify-dmg-signature.sh <dir-with-one-dmg>
set -euo pipefail

dir="${1:?usage: $0 <dir-with-one-dmg>}"

shopt -s nullglob
dmgs=("$dir"/*.dmg)
shopt -u nullglob
if [ "${#dmgs[@]}" -ne 1 ]; then
  echo "expected exactly one .dmg in $dir, found ${#dmgs[@]}" >&2
  exit 1
fi
dmg="${dmgs[0]}"

mnt="$(mktemp -d)"
cleanup() {
  hdiutil detach "$mnt" -force >/dev/null 2>&1 || true
  rmdir "$mnt" 2>/dev/null || true
}
trap cleanup EXIT

echo "Mounting $dmg"
hdiutil attach -nobrowse -readonly -mountpoint "$mnt" "$dmg" >/dev/null

shopt -s nullglob
apps=("$mnt"/*.app)
shopt -u nullglob
if [ "${#apps[@]}" -ne 1 ]; then
  echo "expected exactly one .app in the DMG, found ${#apps[@]}" >&2
  exit 1
fi
app="${apps[0]}"

echo "codesign --verify --deep --strict on $(basename "$app")"
codesign --verify --deep --strict --verbose=2 "$app"

echo "codesign -dv"
details="$(codesign -dv "$app" 2>&1)"
echo "$details"

if ! grep -q '^Signature=adhoc$' <<<"$details"; then
  echo "expected Signature=adhoc" >&2
  exit 1
fi
if grep -q '^Sealed Resources=none$' <<<"$details"; then
  echo "bundle has no sealed resources (only the linker signature)" >&2
  exit 1
fi
echo "OK: ad-hoc signature covers the whole bundle"
