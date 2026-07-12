# 建置驗證狀態

## M0 baseline（2026-07-13）

本輪驗收範圍是目前可執行的 Rust headless prototype：核心資料驗證、deterministic offline render、stereo PCM16 WAV smoke、CI workflow 與跨平台 release build workflow。完整 Tauri/React、即時 CPAL engine 與其餘里程碑仍未宣告完成。

### 本機通過

- Toolchain：Rust stable，`cargo 1.94.1`、`rustc 1.94.1`。
- `cargo fmt --all --check`：通過。
- `cargo clippy --workspace --all-targets -- -D warnings`：通過。
- `cargo test --workspace`：通過，16 tests（15 Rust unit + 1 CLI integration）。
- `cargo run -p sonicforge-cli -- demo artifacts/demo.wav`：通過。
- WAV：`artifacts/demo.wav`，864,044 bytes、stereo、48,000 Hz、16-bit、216,000 frames、peak `-6.767 dBFS`。
- CLI integration：完整驗證 RIFF/WAVE、fmt/data chunk、header size、frame alignment、非靜音，並比較兩次 CLI 輸出 bytes 完全一致。
- Project/render safety：限制 prototype track/note/output allocation，拒絕超出 pattern 的 note，通過對應 regression tests。
- `pwsh -NoProfile -ExecutionPolicy Bypass -File .\scripts\check.ps1`：通過。
- `pwsh -NoProfile -ExecutionPolicy Bypass -File .\scripts\build-release.ps1`：通過，產生 `dist/sonicforge-cli-windows-x86_64.exe` 與 `dist/SHA256SUMS.txt`。

直接以本機預設 PowerShell policy 執行 `.\scripts\check.ps1` 會被未簽章 policy 阻擋；驗收使用上面的 Process/命令級 bypass，未修改系統 execution policy。

### CI / Release workflow

- `.github/workflows/ci.yml`：push / pull request 執行 fmt、clippy、workspace test、CLI WAV smoke，並保存 demo WAV artifact。
- `.github/workflows/release.yml`：`v*` tag 觸發 Windows x64、Ubuntu x64、macOS x64 `cargo build --release --workspace`，保存各平台 CLI binary artifact。
- Release workflow 僅交付 CLI binary artifact，沒有宣稱 installer、簽章或 notarization。
- `actionlint` 未安裝，因此未執行該額外靜態檢查；workflow 內容已人工檢查並與本機 Cargo 命令對齊。

## 未完成範圍

- 尚未建立完整 `audio`、`dsp`、`render`、`io`、`app` crates，也尚未接入 Tauri/React。
- 尚未實作 CPAL/WASAPI real-time callback；因此本輪沒有修改 audio callback boundary。
- 尚未建立 installer、SBOM、code signing、notarization 或正式 GitHub Release publish job。
