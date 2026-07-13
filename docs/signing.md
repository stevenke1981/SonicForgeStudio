# Windows release signing

Windows release artifacts are signed only on a `v*` tag push. The workflow keeps the Windows CLI release, but it fails before uploading a Windows artifact when the protected signing Environment is missing either secret.

## GitHub setup

1. In **Settings → Environments**, create `release-signing`.
2. Add required reviewers and restrict deployment branches/tags to version tags (`v*`). Do not use an unprotected environment for these secrets.
3. Add these as **Environment secrets** under `release-signing`:

   - `WINDOWS_SIGNING_PFX_BASE64`: the complete PFX file encoded as base64.
   - `WINDOWS_SIGNING_PFX_PASSWORD`: the PFX password.

The PFX must contain exactly one certificate with a private key and the Code Signing EKU. A certificate with multiple Code Signing private keys is rejected unless a thumbprint is explicitly supplied to the script.

From a secure Windows machine, the base64 value can be sent directly to GitHub CLI without printing it:

```powershell
[Convert]::ToBase64String(
  [IO.File]::ReadAllBytes('C:\secure\sonicforge-release-signing.pfx')
) | gh secret set WINDOWS_SIGNING_PFX_BASE64 --env release-signing
```

Set the password through the GitHub UI or the GitHub CLI prompt; never put it in a repository file or command committed to source control.

The workflow writes the decoded PFX only below `RUNNER_TEMP`, imports it into the current-user certificate store, and removes both the temporary PFX and the certificate imported by the script. It never prints the PFX, password, or certificate contents. A missing or invalid PFX fails the Windows jobs before artifact upload.

## Local API

Run from a Windows PowerShell session with the Windows SDK installed. `signtool.exe` is resolved from `PATH` or the Windows SDK `x64` bin directory.

The password is prompted as a secure input when `-PfxPassword` is omitted:

```powershell
pwsh -NoProfile -File .\scripts\sign-windows.ps1 `
  -PfxPath 'C:\secure\sonicforge-release-signing.pfx' `
  -Path '.\apps\desktop\src-tauri\target\release\bundle\nsis\SonicForge Studio_0.1.0_x64-setup.exe'
```

The normal mode imports the PFX, resolves its Code Signing thumbprint, signs each target with `signtool sign /sha1`, SHA-256 file and timestamp digests, and then requires all of the following for every file:

- `signtool verify /pa /all /tw` succeeds.
- `Get-AuthenticodeSignature.Status` is `Valid`.
- The signer thumbprint matches the imported/Tauri thumbprint.
- `TimeStamperCertificate` is present.

For a Tauri build, `-ImportOnly -StatePath <file> -GitHubOutputPath <file>` imports the certificate and emits a safe `thumbprint=...` output entry without printing it. Pass that thumbprint to Tauri's `bundle.windows.certificateThumbprint`, with `digestAlgorithm: sha256`, `timestampUrl`, and `tsp: true`; call `-Cleanup -StatePath <file>` in an always-run cleanup step.

Release creation remains tag-only and uses GitHub's `--verify-tag`; this workflow does not create, move, or force-push tags.
