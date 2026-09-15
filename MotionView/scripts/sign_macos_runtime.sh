#!/usr/bin/env bash

# Sign executable PyInstaller payloads before Tauri packages them as resources.
# The PROS runtime is stored in a zip archive, so recreate that archive after
# signing its Mach-O files.
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

is_framework_member() {
  [[ "$1" == *.framework/* ]]
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

if [[ ! -d "$pros_runtime_dir" ]]; then
  echo "Missing bundled PROS runtime: $pros_runtime_dir" >&2
  exit 1
fi

while IFS= read -r -d '' candidate; do
  if is_framework_member "$candidate"; then
    continue
  fi
  if is_macho_file "$candidate"; then
    sign_file "$candidate"
  fi
done < <(find "$pros_runtime_dir" -type f -print0)

# Sign framework bundles after their inner executable and libraries.
while IFS= read -r -d '' framework; do
  sign_file "$framework"
done < <(find "$pros_runtime_dir" -type d -name '*.framework' -depth -print0)

# Sign the PyInstaller launcher after its runtime dependencies.
sign_file "$pros_runtime_dir/motionview-pros"

rm -f "$pros_archive"
ditto -c -k --keepParent "$pros_runtime_dir" "$pros_archive"
