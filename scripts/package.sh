#!/usr/bin/env bash
set -euo pipefail
root="$(cd "$(dirname "$0")/.." && pwd)"
parent="$(dirname "$root")"
name="$(basename "$root")"
out="$parent/$name.zip"

if [ -e "$out" ]; then
  echo "Package already exists: $out. Remove it manually if replacement is intended." >&2
  exit 1
fi

cd "$parent"
zip -r "$out" "$name" -x "$name/target/*" "$name/artifacts/*"
echo "Created: $out"
