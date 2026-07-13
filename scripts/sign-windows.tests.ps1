[CmdletBinding()]
param()

$ErrorActionPreference = 'Stop'
$repoRoot = Split-Path -Parent $PSScriptRoot
$workflowPath = Join-Path $repoRoot '.github/workflows/release.yml'
$signingScriptPath = Join-Path $repoRoot 'scripts/sign-windows.ps1'

$workflow = Get-Content -LiteralPath $workflowPath -Raw
$signingScript = Get-Content -LiteralPath $signingScriptPath -Raw
$failures = @()

function Require-Text {
    param(
        [string] $Text,
        [string] $Pattern,
        [string] $Message
    )

    if ($Text -notmatch $Pattern) {
        $script:failures += $Message
    }
}

function Forbid-Text {
    param(
        [string] $Text,
        [string] $Pattern,
        [string] $Message
    )

    if ($Text -match $Pattern) {
        $script:failures += $Message
    }
}

Require-Text $workflow 'tags:\s*\r?\n\s*-\s*["'']v\*["'']' 'release workflow is not restricted to v* tag pushes'
Forbid-Text $workflow 'workflow_dispatch' 'release workflow exposes a non-tag dispatch path'
Require-Text $workflow "github\.event_name == 'push' && github\.ref_type == 'tag' && startsWith\(github\.ref_name, 'v'\)" 'release jobs lack an explicit tag-only guard'
Require-Text $workflow 'environment:\s*release-signing' 'release-signing Environment is not attached to a build job'
Require-Text $workflow 'WINDOWS_SIGNING_PFX_BASE64' 'PFX base64 secret is not wired'
Require-Text $workflow 'WINDOWS_SIGNING_PFX_PASSWORD' 'PFX password secret is not wired'
Require-Text $workflow 'sign-windows\.ps1' 'workflow does not use the shared signing script'
Require-Text $workflow 'if-no-files-found:\s*error' 'artifact upload is not fail-closed on missing files'
Require-Text $workflow 'tsp\s*=\s*\$true' 'Tauri RFC3161 timestamp mode is not enabled'
Require-Text $workflow 'Verify Windows Authenticode signatures' 'desktop signature verification step is missing'
Require-Text $workflow '-Cleanup\s+-StatePath' 'imported signing certificate cleanup is missing'
Forbid-Text $workflow '(?i)optional|unsigned|enabled=false|WINDOWS_CERTIFICATE:' 'workflow still contains an optional or unsigned Windows path'

Require-Text $signingScript 'Import-PfxCertificate' 'script does not import PFX material into the certificate store'
Require-Text $signingScript 'Cert:\\CurrentUser\\My' 'script does not use the current-user certificate store'
Require-Text $signingScript 'signtool\.exe' 'script does not resolve Windows SDK signtool'
Require-Text $signingScript "'/(sha1|tr|td|fd)'" 'script does not pin certificate thumbprint and SHA-256 timestamp options'
Require-Text $signingScript 'Get-AuthenticodeSignature' 'script does not use PowerShell Authenticode verification'
Require-Text $signingScript 'TimeStamperCertificate' 'script does not require a timestamp certificate'
Require-Text $signingScript 'signature\.Status -ne .Valid.' 'script does not fail on an invalid Authenticode status'
Require-Text $signingScript 'CertificateThumbprint' 'script does not expose thumbprint selection/verification'
Require-Text $signingScript 'Read-Host -Prompt .PFX password. -AsSecureString' 'local password input is not secure'
Require-Text $signingScript 'Remove-ImportedCertificates' 'script does not clean imported certificate material'

if ($failures.Count -gt 0) {
    throw (($failures | ForEach-Object { "- $_" }) -join [Environment]::NewLine)
}

Write-Output 'Windows signing static checks: PASS'
