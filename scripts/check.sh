#!/usr/bin/env bash
set -euo pipefail

echo "[1/4] cargo fmt"
cargo fmt --all --check

echo "[2/4] cargo clippy"
cargo clippy --workspace --all-targets -- -D warnings

echo "[3/4] cargo test"
cargo test --workspace

echo "[4/4] render smoke test"
mkdir -p artifacts
cargo run -p sonicforge-cli -- demo artifacts/demo.wav

test -f artifacts/demo.wav
size=$(wc -c < artifacts/demo.wav)
if [ "$size" -lt 1000 ]; then
  echo "demo.wav is unexpectedly small: $size bytes" >&2
  exit 1
fi

echo "All checks passed. WAV size: $size bytes"
