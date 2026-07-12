$ErrorActionPreference = "Stop"
$projectRoot = Split-Path -Parent $PSScriptRoot
$name = Split-Path -Leaf $projectRoot
$out = Join-Path (Split-Path -Parent $projectRoot) "$name.zip"

if (Test-Path $out) {
    throw "Package already exists: $out. Delete it manually if replacement is intended."
}

Compress-Archive -Path "$projectRoot\*" -DestinationPath $out -CompressionLevel Optimal
Write-Host "Created: $out"
