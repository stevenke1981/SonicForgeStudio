[CmdletBinding()]
param(
    [string[]] $Path,
    [string] $PfxPath,
    [System.Security.SecureString] $PfxPassword,
    [string] $CertificateThumbprint,
    [string] $TimestampUrl = 'http://timestamp.digicert.com',
    [switch] $ImportOnly,
    [switch] $VerifyOnly,
    [switch] $Cleanup,
    [string] $StatePath,
    [string] $GitHubOutputPath
)

$ErrorActionPreference = 'Stop'
$script:CertificateStorePath = 'Cert:\CurrentUser\My'
$script:CodeSigningOid = '1.3.6.1.5.5.7.3.3'
$script:AddedThumbprints = @()

function Normalize-Thumbprint {
    param([AllowNull()][string] $Value)

    if ([string]::IsNullOrWhiteSpace($Value)) {
        return $null
    }

    $normalized = $Value -replace '\s', ''
    return $normalized.ToUpperInvariant()
}

function Assert-WindowsSigningEnvironment {
    if (-not (Get-Command -Name Import-PfxCertificate -ErrorAction SilentlyContinue)) {
        throw 'Import-PfxCertificate is unavailable. Run this script on Windows PowerShell or PowerShell 7 on Windows.'
    }

    if (-not (Get-Command -Name Get-AuthenticodeSignature -ErrorAction SilentlyContinue)) {
        throw 'Get-AuthenticodeSignature is unavailable on this Windows host.'
    }
}

function Resolve-SignTool {
    $fromPath = @(Get-Command -Name signtool.exe -ErrorAction SilentlyContinue |
        Select-Object -ExpandProperty Source)
    if ($fromPath.Count -gt 0 -and (Test-Path -LiteralPath $fromPath[0] -PathType Leaf)) {
        return $fromPath[0]
    }

    $sdkRoots = @()
    if (-not [string]::IsNullOrWhiteSpace(${env:ProgramFiles(x86)})) {
        $sdkRoots += (Join-Path ${env:ProgramFiles(x86)} 'Windows Kits\10\bin')
    }
    if (-not [string]::IsNullOrWhiteSpace($env:ProgramFiles)) {
        $sdkRoots += (Join-Path $env:ProgramFiles 'Windows Kits\10\bin')
    }

    $candidates = @()
    foreach ($sdkRoot in $sdkRoots) {
        if (Test-Path -LiteralPath $sdkRoot -PathType Container) {
            $candidates += @(Get-ChildItem -Path (Join-Path $sdkRoot '*\x64\signtool.exe') -File -ErrorAction SilentlyContinue)
        }
    }

    if ($candidates.Count -eq 0) {
        throw 'Windows SDK signtool.exe was not found. Install the Windows SDK or put signtool.exe on PATH.'
    }

    return ($candidates | Sort-Object -Property FullName -Descending | Select-Object -First 1 -ExpandProperty FullName)
}

function Test-CodeSigningCertificate {
    param([System.Security.Cryptography.X509Certificates.X509Certificate2] $Certificate)

    if ($null -eq $Certificate -or -not $Certificate.HasPrivateKey) {
        return $false
    }

    foreach ($eku in @($Certificate.EnhancedKeyUsageList)) {
        if ($null -ne $eku -and
            (($eku.ObjectId.Value -eq $script:CodeSigningOid) -or ($eku.Value -eq 'Code Signing'))) {
            return $true
        }
    }

    return $false
}

function Select-CodeSigningCertificate {
    param(
        [object[]] $Certificates,
        [string] $RequestedThumbprint
    )

    $candidates = @($Certificates | Where-Object { Test-CodeSigningCertificate $_ })
    if ($candidates.Count -eq 0) {
        throw 'The PFX does not contain a certificate with a private key and Code Signing EKU.'
    }

    $requested = Normalize-Thumbprint $RequestedThumbprint
    if ($null -ne $requested) {
        $selected = @($candidates | Where-Object {
            (Normalize-Thumbprint $_.Thumbprint) -eq $requested
        })
        if ($selected.Count -ne 1) {
            throw 'The requested certificate thumbprint was not the unique Code Signing certificate in the PFX.'
        }
        return $selected[0]
    }

    if ($candidates.Count -ne 1) {
        throw 'The PFX contains multiple Code Signing certificates. Supply -CertificateThumbprint to select one.'
    }

    return $candidates[0]
}

function Import-CodeSigningCertificate {
    param(
        [string] $CertificatePath,
        [System.Security.SecureString] $Password,
        [string] $RequestedThumbprint
    )

    if (-not (Test-Path -LiteralPath $CertificatePath -PathType Leaf)) {
        throw 'The PFX path does not point to a file.'
    }
    if ($null -eq $Password) {
        throw 'A PFX password is required.'
    }

    $beforeThumbprints = @(
        Get-ChildItem -Path $script:CertificateStorePath |
            ForEach-Object { Normalize-Thumbprint $_.Thumbprint }
    )

    $imported = @(
        Import-PfxCertificate `
            -FilePath (Resolve-Path -LiteralPath $CertificatePath).Path `
            -CertStoreLocation $script:CertificateStorePath `
            -Password $Password
    )
    if ($imported.Count -eq 0) {
        throw 'The PFX import returned no certificates.'
    }

    $script:AddedThumbprints = @($imported | ForEach-Object {
        $thumbprint = Normalize-Thumbprint $_.Thumbprint
        if ($beforeThumbprints -notcontains $thumbprint) {
            $thumbprint
        }
    } | Where-Object { -not [string]::IsNullOrWhiteSpace($_) } | Select-Object -Unique)

    return (Select-CodeSigningCertificate -Certificates $imported -RequestedThumbprint $RequestedThumbprint)
}

function Save-ImportState {
    param(
        [string] $Path,
        [string] $Thumbprint
    )

    $parent = Split-Path -Parent $Path
    if (-not [string]::IsNullOrWhiteSpace($parent) -and
        -not (Test-Path -LiteralPath $parent -PathType Container)) {
        New-Item -ItemType Directory -Path $parent -Force | Out-Null
    }

    $state = @{
        Thumbprint = $Thumbprint
        AddedThumbprints = @($script:AddedThumbprints)
    } | ConvertTo-Json -Depth 3
    Set-Content -LiteralPath $Path -Value $state -Encoding UTF8
}

function Remove-ImportedCertificates {
    param([string[]] $Thumbprints)

    foreach ($thumbprint in @($Thumbprints | Select-Object -Unique)) {
        if ([string]::IsNullOrWhiteSpace($thumbprint)) {
            continue
        }

        $normalized = Normalize-Thumbprint $thumbprint
        $certificates = @(Get-ChildItem -Path $script:CertificateStorePath |
            Where-Object { (Normalize-Thumbprint $_.Thumbprint) -eq $normalized })
        foreach ($certificate in $certificates) {
            Remove-Item -LiteralPath $certificate.PSPath -Force
        }
    }
}

function Invoke-Cleanup {
    param([string] $Path)

    if ([string]::IsNullOrWhiteSpace($Path)) {
        throw '-StatePath is required with -Cleanup.'
    }
    if (-not (Test-Path -LiteralPath $Path -PathType Leaf)) {
        return
    }

    $state = Get-Content -LiteralPath $Path -Raw | ConvertFrom-Json
    Remove-ImportedCertificates -Thumbprints @($state.AddedThumbprints)
    Remove-Item -LiteralPath $Path -Force
}

function Resolve-TargetFiles {
    param([string[]] $Targets)

    if ($null -eq $Targets -or $Targets.Count -eq 0) {
        throw 'At least one file path is required.'
    }

    $files = @()
    foreach ($target in $Targets) {
        if (-not (Test-Path -LiteralPath $target -PathType Leaf)) {
            throw "Signing target does not exist or is not a file: $target"
        }
        $files += (Resolve-Path -LiteralPath $target).Path
    }

    return @($files | Select-Object -Unique)
}

function Assert-TimestampUrl {
    param([string] $Url)

    $uri = $null
    if (-not [Uri]::TryCreate($Url, [UriKind]::Absolute, [ref]$uri) -or
        $uri.Scheme -notin @('http', 'https')) {
        throw 'TimestampUrl must be an absolute http or https URL.'
    }
}

function Invoke-SignTool {
    param(
        [string] $SignToolPath,
        [string[]] $Arguments,
        [string] $FailureMessage
    )

    $null = & $SignToolPath @Arguments 2>&1
    $exitCode = $LASTEXITCODE
    if ($exitCode -ne 0) {
        throw "$FailureMessage (signtool exit code $exitCode)."
    }
}

function Sign-File {
    param(
        [string] $SignToolPath,
        [string] $FilePath,
        [string] $Thumbprint,
        [string] $Url
    )

    $arguments = @(
        'sign',
        '/sha1', $Thumbprint,
        '/s', 'My',
        '/fd', 'SHA256',
        '/tr', $Url,
        '/td', 'SHA256',
        '/u', $script:CodeSigningOid,
        '/d', 'SonicForge Studio',
        $FilePath
    )
    Invoke-SignTool `
        -SignToolPath $SignToolPath `
        -Arguments $arguments `
        -FailureMessage "signtool signing failed for '$FilePath'"
}

function Verify-File {
    param(
        [string] $SignToolPath,
        [string] $FilePath,
        [string] $ExpectedThumbprint
    )

    $verifyArguments = @('verify', '/pa', '/all', '/tw', '/q', $FilePath)
    Invoke-SignTool `
        -SignToolPath $SignToolPath `
        -Arguments $verifyArguments `
        -FailureMessage "signtool verification failed for '$FilePath'"

    $signature = Get-AuthenticodeSignature -FilePath $FilePath
    if ($signature.Status -ne 'Valid') {
        throw "Authenticode verification failed for '$FilePath': status was '$($signature.Status)'."
    }

    $actualThumbprint = Normalize-Thumbprint $signature.SignerCertificate.Thumbprint
    if ($actualThumbprint -ne (Normalize-Thumbprint $ExpectedThumbprint)) {
        throw "Authenticode signer thumbprint mismatch for '$FilePath'."
    }

    if ($null -eq $signature.TimeStamperCertificate) {
        throw "Authenticode signature has no timestamp for '$FilePath'."
    }
}

function Write-GitHubThumbprint {
    param(
        [string] $OutputPath,
        [string] $Thumbprint
    )

    if ([string]::IsNullOrWhiteSpace($OutputPath)) {
        Write-Output "Thumbprint: $Thumbprint"
        return
    }

    Add-Content -LiteralPath $OutputPath -Value "thumbprint=$Thumbprint" -Encoding UTF8
}

$modeCount = 0
if ($ImportOnly) { $modeCount++ }
if ($VerifyOnly) { $modeCount++ }
if ($Cleanup) { $modeCount++ }
$keepCertificate = $false

try {
    Assert-WindowsSigningEnvironment

    if ($modeCount -gt 1) {
        throw 'Use only one of -ImportOnly, -VerifyOnly, or -Cleanup.'
    }

    if ($Cleanup) {
        Invoke-Cleanup -Path $StatePath
        exit 0
    }

    Assert-TimestampUrl -Url $TimestampUrl
    $signToolPath = Resolve-SignTool

    if ($VerifyOnly) {
        $files = Resolve-TargetFiles -Targets $Path
        $expected = Normalize-Thumbprint $CertificateThumbprint
        if ([string]::IsNullOrWhiteSpace($expected)) {
            throw '-CertificateThumbprint is required with -VerifyOnly.'
        }

        foreach ($file in $files) {
            Verify-File -SignToolPath $signToolPath -FilePath $file -ExpectedThumbprint $expected
        }
        Write-Output ("Verified Authenticode signature, thumbprint, and timestamp for {0} file(s)." -f $files.Count)
        exit 0
    }

    if ([string]::IsNullOrWhiteSpace($PfxPath)) {
        throw '-PfxPath is required when importing or signing.'
    }
    if ($null -eq $PfxPassword) {
        $PfxPassword = Read-Host -Prompt 'PFX password' -AsSecureString
    }

    $certificate = Import-CodeSigningCertificate `
        -CertificatePath $PfxPath `
        -Password $PfxPassword `
        -RequestedThumbprint $CertificateThumbprint
    $thumbprint = Normalize-Thumbprint $certificate.Thumbprint

    if ($ImportOnly) {
        if ([string]::IsNullOrWhiteSpace($StatePath)) {
            $StatePath = Join-Path $env:TEMP ("sonicforge-signing-{0}.json" -f $PID)
        }
        Save-ImportState -Path $StatePath -Thumbprint $thumbprint
        Write-GitHubThumbprint -OutputPath $GitHubOutputPath -Thumbprint $thumbprint
        $keepCertificate = $true
        exit 0
    }

    $filesToSign = Resolve-TargetFiles -Targets $Path
    foreach ($file in $filesToSign) {
        Sign-File -SignToolPath $signToolPath -FilePath $file -Thumbprint $thumbprint -Url $TimestampUrl
        Verify-File -SignToolPath $signToolPath -FilePath $file -ExpectedThumbprint $thumbprint
    }

    Write-Output ("Signed and verified Authenticode signature, thumbprint, and timestamp for {0} file(s)." -f $filesToSign.Count)
    exit 0
}
catch {
    Write-Error $_.Exception.Message
    exit 1
}
finally {
    if (-not $keepCertificate -and $script:AddedThumbprints.Count -gt 0) {
        Remove-ImportedCertificates -Thumbprints $script:AddedThumbprints
    }
}
