# 建置驗證狀態

## M0 baseline（2026-07-13）

本輪驗收範圍包含 Rust headless prototype 與 Tauri 2 + React GUI vertical slice：核心資料驗證、deterministic offline render、stereo PCM16 WAV smoke、前端驗收、Tauri release build、CI workflow 與跨平台 release workflow。完整 real-time CPAL engine 與其餘里程碑仍未宣告完成。

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

- `.github/workflows/ci.yml`：push / pull request 執行 Rust gate、CLI WAV smoke，以及 Node 24 下的 frontend lint、typecheck、Vitest、build、Playwright Chromium acceptance。
- `.github/workflows/release.yml`：`v*` tag 觸發 Windows x64、Ubuntu x64、macOS x64 CLI release，並在 Windows build Tauri desktop executable artifact。
- Release workflow 交付 CLI 與 desktop executable artifact，沒有宣稱 installer、簽章或 notarization。
- `actionlint` 未安裝，因此未執行該額外靜態檢查；workflow 內容已人工檢查並與本機 Cargo 命令對齊。

## 未完成範圍

- 尚未建立完整 `audio`、`dsp`、`render`、`io`、`app` crates；Tauri/React 目前是 read-only desktop slice。
- 尚未實作 CPAL/WASAPI real-time callback；因此本輪沒有修改 audio callback boundary。
- 尚未建立 installer、SBOM、code signing、notarization 或正式 GitHub Release publish job。

## GUI vertical slice 驗證（M0/M5：主要切片通過）

正式 GUI 位於 `apps/desktop/`；`prototype/ui-mockup.html` 不算 GUI 驗收 evidence。前端使用 web preview fallback，Tauri command surface 僅提供 read-only app/audio status，未進入 audio callback。

### Acceptance criteria

| ID | 對應 | 驗收條件 | 狀態 |
|---|---|---|---|
| GVS-M0-01 | M0 | Tauri 2 + React + TypeScript workspace 可重現，並具備 pnpm lockfile、lint、typecheck、unit test、build、Playwright smoke。 | passed |
| GVS-M0-02 | M0 | UI 透過 allowlist / control command 與 Rust 應用層溝通，不直接持有 DSP node，Project model 不依賴 UI framework。 | passed |
| GVS-M5-01 | M5 | App shell、Browser、主工作區、Inspector、底部區域與 Music / SFX Lab / Mixer 入口可操作。 | passed |
| GVS-M5-02 | M5 | Song Editor 具備 track / clip 的新增、拖曳、resize、split、duplicate，以及 grid / snap / zoom。 | passed |
| GVS-M5-03 | M5 | Piano Roll 具備 note draw、select、erase、resize，且 UI state 與 engine-facing state 一致。 | not implemented |
| GVS-M5-04 | M5 | Browser、Inspector、Command palette、核心快捷鍵與 1366×768 / 100–200% DPI pass 有 evidence。 | partial; DPI pending |

### Frontend / Tauri 命令

Windows 本機以 `corepack pnpm` 執行；下列均已通過：

| 命令 | 狀態 | 原因 / required evidence |
|---|---|---|
| `corepack pnpm install --frozen-lockfile` | passed | `apps/desktop/pnpm-lock.yaml` 可重現安裝。 |
| `corepack pnpm lint` | passed | ESLint flat config，零 warning。 |
| `corepack pnpm typecheck` | passed | TypeScript strict check。 |
| `corepack pnpm test` | passed | 3 Vitest tests。 |
| `corepack pnpm build` | passed | Vite production build。 |
| `corepack pnpm exec playwright test` | passed | 2 Chromium tests；截圖 `apps/desktop/artifacts/screenshots/gui-sfx-lab.png`。 |
| `cargo fmt --manifest-path apps/desktop/src-tauri/Cargo.toml -- --check` | passed | Tauri Rust shell formatting。 |
| `cargo check --manifest-path apps/desktop/src-tauri/Cargo.toml` | passed | Tauri Rust shell compile check。 |
| `cargo tauri build` | passed | `apps/desktop/src-tauri/target/release/sonicforge-desktop.exe`，8,394,240 bytes。 |

### 已知未完成與回滾

- Piano Roll、完整 project model、undo/redo、real-time device playback 與 DPI 100/125/150/200% pass 尚未完成。
- Project save / autosave / recovery、M6 I/O、real-time device playback 與 installer 不屬於本輪 slice，仍是未完成範圍。
- 回滾方式是移除 desktop slice、GUI workflow jobs 與對應文件段落；保留既有 Rust baseline、`artifacts/`、`dist/` 與 project schema。
