$ErrorActionPreference = "Stop"

$projectRoot = Split-Path -Parent $PSScriptRoot
$binary = Join-Path $projectRoot "target\release\sonicforge-cli.exe"
$dist = Join-Path $projectRoot "dist"
$artifactName = "sonicforge-cli-windows-x86_64.exe"
$artifact = Join-Path $dist $artifactName
$checksum = Join-Path $dist "SHA256SUMS.txt"

Push-Location $projectRoot
try {
    cargo build --workspace --release
    if ($LASTEXITCODE -ne 0) {
        throw "cargo build --workspace --release failed"
    }
} finally {
    Pop-Location
}

if (-not (Test-Path -LiteralPath $binary)) {
    throw "Release binary was not produced: $binary"
}

New-Item -ItemType Directory -Force -Path $dist | Out-Null
Copy-Item -LiteralPath $binary -Destination $artifact -Force
$hash = (Get-FileHash -LiteralPath $artifact -Algorithm SHA256).Hash.ToLowerInvariant()
[System.IO.File]::WriteAllText(
    $checksum,
    "$hash  $artifactName`r`n",
    [System.Text.UTF8Encoding]::new($false)
)

Write-Host "Created: $artifact"
Write-Host "SHA-256: $hash"
