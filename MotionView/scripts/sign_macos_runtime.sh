#!/usr/bin/env bash

# Sign executable PyInstaller payloads before Tauri packages them as resources.
# The bridge is a macOS onedir runtime, and the PROS runtime is also archived
# after signing its Mach-O files.
set -euo pipefail

signing_identity="${1:?usage: sign_macos_runtime.sh <signing-identity>}"
script_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
app_dir="$(cd "$script_dir/.." && pwd)"
bin_dir="$app_dir/src-tauri/bin"
pros_runtime_dir="$bin_dir/motionview-pros"
pros_archive="$bin_dir/motionview-pros.zip"

sign_file() {
  local path="$1"
  codesign --force --options runtime --timestamp --sign "$signing_identity" "$path"
}

is_macho_file() {
  [[ "$(file -b "$1")" == Mach-O* ]]
}

is_framework_root_executable() {
  [[ "${1%/*}" == *.framework ]]
}

sign_runtime_tree() {
  local runtime_dir="$1"
  local launcher="$2"

  if [[ ! -d "$runtime_dir" ]]; then
    echo "Missing bundled runtime: $runtime_dir" >&2
    exit 1
  fi

  while IFS= read -r -d '' candidate; do
    if [[ "$candidate" == "$runtime_dir/$launcher" ]]; then
      continue
    fi
    # copyResolvedTree flattens PyInstaller framework symlinks into duplicate
    # wrapper binaries. They are ambiguous to codesign and unused; retain and
    # sign the versioned framework binaries instead.
    if is_framework_root_executable "$candidate" && is_macho_file "$candidate"; then
      rm -f "$candidate"
      continue
    fi
    if is_macho_file "$candidate"; then
      sign_file "$candidate"
    fi
  done < <(find "$runtime_dir" -type f -print0)

  sign_file "$runtime_dir/$launcher"
}

for sidecar in \
  "$bin_dir"/motionview-py \
  "$bin_dir"/motionview-py-* \
  "$bin_dir"/motionview-bridge/motionview-py \
  "$bin_dir"/motionview-bridge/motionview-py-*; do
  [[ -f "$sidecar" ]] || continue
  if is_macho_file "$sidecar"; then
    sign_file "$sidecar"
  fi
done

# macOS launches the bridge from this signed onedir runtime. Its Python
# framework must have the same Team ID as the launcher under hardened runtime.
sign_runtime_tree "$bin_dir/motionview-bridge" "motionview-py"
sign_runtime_tree "$pros_runtime_dir" "motionview-pros"

rm -f "$pros_archive"
ditto -c -k --keepParent "$pros_runtime_dir" "$pros_archive"
