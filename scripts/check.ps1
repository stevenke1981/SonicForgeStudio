$ErrorActionPreference = "Stop"

Write-Host "[1/4] cargo fmt"
cargo fmt --all --check

Write-Host "[2/4] cargo clippy"
cargo clippy --workspace --all-targets -- -D warnings

Write-Host "[3/4] cargo test"
cargo test --workspace

Write-Host "[4/4] render smoke test"
New-Item -ItemType Directory -Force -Path artifacts | Out-Null
cargo run -p sonicforge-cli -- demo artifacts/demo.wav

if (-not (Test-Path artifacts/demo.wav)) {
    throw "demo.wav was not generated"
}

$size = (Get-Item artifacts/demo.wav).Length
if ($size -lt 1000) {
    throw "demo.wav is unexpectedly small: $size bytes"
}

Write-Host "All checks passed. WAV size: $size bytes"
