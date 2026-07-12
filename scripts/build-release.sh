#!/usr/bin/env bash
set -euo pipefail

root="$(cd "$(dirname "$0")/.." && pwd)"
dist="$root/dist"
artifact_name="sonicforge-cli-$(uname -s | tr '[:upper:]' '[:lower:]')-$(uname -m)"
artifact="$dist/$artifact_name"

cd "$root"
cargo build --workspace --release

binary="$root/target/release/sonicforge-cli"
if [[ ! -f "$binary" ]]; then
  echo "Release binary was not produced: $binary" >&2
  exit 1
fi

mkdir -p "$dist"
cp "$binary" "$artifact"
hash="$(sha256sum "$artifact" | awk '{print $1}')"
printf '%s  %s\n' "$hash" "$artifact_name" > "$dist/SHA256SUMS.txt"

echo "Created: $artifact"
echo "SHA-256: $hash"
