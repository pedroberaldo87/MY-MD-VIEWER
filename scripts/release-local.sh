#!/usr/bin/env bash
# Builds the release DMG on this Mac and prepares a GitHub draft release.
#
# Builds and releases are always done locally, never by GitHub Actions (CI only
# runs tests). By default this script only builds and prints the commands to
# publish. It tags and publishes only with --publish, and only as a DRAFT
# release that you review and publish by hand on GitHub.
#
# Usage: scripts/release-local.sh <version> [--publish]
#   <version>   e.g. 1.0.1 (a leading "v" is accepted). Must match
#               src-tauri/tauri.conf.json, src-tauri/Cargo.toml and package.json.
#   --publish   create the annotated tag, push it, and create the DRAFT release.
#
# Environment:
#   RELEASE_SKIP_BRANCH_CHECK=1  skip the "on main, up to date with origin"
#                                check. For testing this script from a branch
#                                or worktree. Refused together with --publish.
set -euo pipefail

die() {
  echo "error: $*" >&2
  exit 1
}

usage() {
  sed -n '2,/^set -euo/p' "$0" | sed '$d' | sed 's/^# \{0,1\}//' >&2
  exit 2
}

version=""
publish=0
for arg in "$@"; do
  case "$arg" in
    --publish) publish=1 ;;
    -h | --help) usage ;;
    -*) die "unknown option: $arg" ;;
    *)
      [ -z "$version" ] || die "only one version argument is allowed"
      version="${arg#v}"
      ;;
  esac
done
[ -n "$version" ] || usage
[[ "$version" =~ ^[0-9]+\.[0-9]+\.[0-9]+([-.][0-9A-Za-z.]+)?$ ]] || die "version '$version' is not X.Y.Z"
tag="v$version"

if [ "$publish" -eq 1 ] && [ "${RELEASE_SKIP_BRANCH_CHECK:-0}" = 1 ]; then
  die "--publish cannot be combined with RELEASE_SKIP_BRANCH_CHECK=1"
fi

root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$root"

[ "$(uname -s)" = Darwin ] || die "this script builds a macOS DMG and must run on a Mac"
[ "$(uname -m)" = arm64 ] || die "releases are Apple Silicon only; run this on an Apple Silicon Mac"
for tool in git node pnpm cargo hdiutil codesign shasum; do
  command -v "$tool" >/dev/null || die "missing tool: $tool"
done
[ "$publish" -eq 0 ] || command -v gh >/dev/null || die "missing tool: gh"

# --- 1. Repository state ---------------------------------------------------
if [ -n "$(git status --porcelain)" ]; then
  die "working tree is not clean; commit or stash first"
fi
if [ "${RELEASE_SKIP_BRANCH_CHECK:-0}" != 1 ]; then
  [ "$(git rev-parse --abbrev-ref HEAD)" = main ] || die "not on branch main"
  git fetch --quiet origin main
  [ "$(git rev-parse HEAD)" = "$(git rev-parse origin/main)" ] ||
    die "main is not the same commit as origin/main; pull or push first"
else
  echo "WARNING: branch check skipped (RELEASE_SKIP_BRANCH_CHECK=1)" >&2
fi
if git rev-parse -q --verify "refs/tags/$tag" >/dev/null; then
  die "tag $tag already exists locally"
fi
if git ls-remote --exit-code --tags origin "refs/tags/$tag" >/dev/null 2>&1; then
  die "tag $tag already exists on origin"
fi

# --- 2. Version consistency ------------------------------------------------
conf_version="$(node -p "require('./src-tauri/tauri.conf.json').version")"
pkg_version="$(node -p "require('./package.json').version")"
cargo_version="$(awk -F'"' '/^\[package\]/{p=1;next} /^\[/{p=0} p && /^version[[:space:]]*=/{print $2; exit}' src-tauri/Cargo.toml)"
product="$(node -p "require('./src-tauri/tauri.conf.json').productName")"
for pair in "tauri.conf.json=$conf_version" "package.json=$pkg_version" "Cargo.toml=$cargo_version"; do
  [ "${pair#*=}" = "$version" ] || die "${pair%%=*} has version '${pair#*=}', expected '$version'"
done
echo "Version $version matches tauri.conf.json, Cargo.toml and package.json"

# --- 3. Tests --------------------------------------------------------------
echo "==> Install dependencies"
pnpm install --frozen-lockfile
echo "==> Typecheck"
pnpm run typecheck
echo "==> Unit tests"
pnpm test
echo "==> Audit production dependencies"
pnpm audit --prod
# `pnpm build` produces the real front-end (../dist) that the Tauri macro embeds
# when the Rust tests compile, and that `tauri build` bundles.
echo "==> Front-end build"
pnpm build
echo "==> Rust tests"
(cd src-tauri && cargo test --locked)

# --- 4. Build --------------------------------------------------------------
# The Tauri CLI is the one pinned by pnpm-lock.yaml (@tauri-apps/cli).
tauri=(pnpm tauri)

bundle_dir="src-tauri/target/release/bundle"
dmg_dir="$bundle_dir/dmg"
# Never ship or verify a leftover from an earlier build.
rm -rf "$dmg_dir" "$bundle_dir/macos"

log="$(mktemp)"
trap 'rm -f "$log"' EXIT
echo "==> tauri build --bundles dmg"
if ! "${tauri[@]}" build --bundles dmg 2>&1 | tee "$log"; then
  # The DMG step styles the window through Finder/AppleScript, which fails in
  # headless or ssh sessions. Everything else failing is a real error.
  if ! grep -qiE 'osascript|applescript|bundle_dmg|finder' "$log"; then
    die "tauri build failed (not a DMG/Finder problem, see output above)"
  fi
  echo "==> DMG step failed (Finder/AppleScript unavailable?); falling back to hdiutil"
  rm -rf "$dmg_dir" "$bundle_dir/macos"
  "${tauri[@]}" build --bundles app
  app="$bundle_dir/macos/$product.app"
  [ -d "$app" ] || die "expected $app after 'tauri build --bundles app'"
  case "$(uname -m)" in
    arm64) arch=aarch64 ;;
    *) arch="$(uname -m)" ;;
  esac
  mkdir -p "$dmg_dir"
  hdiutil create -volname "$product" -srcfolder "$app" -ov -format UDZO \
    "$dmg_dir/${product}_${version}_${arch}.dmg"
fi

# --- 5. Verify, checksum, notes --------------------------------------------
echo "==> Verifying the signature inside the DMG"
scripts/verify-dmg-signature.sh "$dmg_dir"

dmg_path="$(find "$dmg_dir" -maxdepth 1 -name '*.dmg' -print)"
[ -f "$dmg_path" ] || die "no DMG found in $dmg_dir"
dmg_name="$(basename "$dmg_path")"
(cd "$dmg_dir" && shasum -a 256 "$dmg_name" >SHA256SUMS)
echo "==> SHA256SUMS"
cat "$dmg_dir/SHA256SUMS"

notes="$dmg_dir/RELEASE_NOTES.md"
cat >"$notes" <<EOF
$product $version for Apple Silicon Macs.

Built locally by the maintainer. Not signed with an Apple Developer ID and not
notarized, so macOS Gatekeeper blocks it on first launch. See the README for
the steps to open it.

Verify the download: \`shasum -a 256 -c SHA256SUMS\` (SHA256SUMS is attached to this release).
EOF

# --- 6. Tag and draft release ----------------------------------------------
tag_cmd=(git tag -a "$tag" -m "$product $version")
push_cmd=(git push origin "$tag")
release_cmd=(gh release create "$tag" "$dmg_path" "$dmg_dir/SHA256SUMS"
  --draft --verify-tag --title "$product $version" --notes-file "$notes")

echo
echo "Built: $dmg_path"
if [ "$publish" -eq 0 ]; then
  echo "Nothing was tagged or published. To publish, run these (or rerun with --publish):"
  printf '  %q' "${tag_cmd[@]}"
  echo
  printf '  %q' "${push_cmd[@]}"
  echo
  printf '  %q' "${release_cmd[@]}"
  echo
  exit 0
fi

echo "==> Publishing (draft release)"
"${tag_cmd[@]}"
"${push_cmd[@]}"
"${release_cmd[@]}"
echo "Draft release created. Review it on GitHub and publish it by hand."
