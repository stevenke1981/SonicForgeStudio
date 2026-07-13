# 建置驗證狀態

## Audible SFX／Mixer、transport completion、export／save-as（2026-07-14，最新）

- Rust workspace fmt、Clippy `-D warnings` 通過；59 tests 通過（audio 26、CLI WAV smoke 1、core 19、I/O 13）。
- Tauri crate fmt、Clippy `-D warnings` 通過；5 tests 通過。
- Frontend lint、typecheck、production build 通過；Vitest 49 tests 通過。
- Playwright 36 tests 通過；100/125/150/200% 均涵蓋 SFX 五種 recipe、Mixer transport、Save As、WAV export、九個 templates、多語系、Piano Roll、Step Sequencer 與 movable playhead。
- Audio callback 維持無配置、鎖、blocking、I/O、panic；note-event 工作量以固定 256-frame engine quantum 限制，dense output 不依 callback buffer size 改變。
- Transport 自動在 project end 停止並以 sequence snapshot 發布 position/state；loop clamp 至 duration，尾端 Play 從頭重啟。
- WAV export 在 blocking worker 序列化執行，拒絕危險／保留檔名與同名覆寫，使用 unique temporary、`sync_all` 與 no-clobber finalize；輸出測試確認 RIFF/WAVE header 與非靜音 PCM data。
- `cargo tauri build --bundles nsis` 通過；installer 2,326,326 bytes，SHA-256 `FAFE71E7B29C6B97C5EEB9F12145327C7B80BB61110C97D33E6793EB5B5C7881`，Authenticode `NotSigned`（本機無 PFX）。

## Factory instruments / movable playhead（2026-07-13，最新）

- Rust workspace fmt、Clippy `-D warnings` 通過；workspace 54 tests 通過。
- Tauri crate fmt、Clippy `-D warnings` 通過；2 tests 通過。
- Frontend lint、typecheck、production build 通過；Vitest 42 tests 通過。
- Playwright 32 tests 通過；新增 factory instruments、pointer/keyboard seek 與 transport position 測試，涵蓋 UI scale 100/125/150/200%。
- Audio engine 為 10 種 preset 建立實際 DSP 差異與 drum-kit note dispatch；callback 未新增配置、鎖、blocking 或 I/O。
- Transport 使用固定容量 64-slot MPSC command queue 保留 stop/play/seek 順序；callback 每個 block 最多處理 16 個命令並只做一次 seek reset。Graph build 每 64 notes 預建 exact voice-slot checkpoint，因此 100,000-note sparse seek 最多 replay 63 events，且不會讓已被 voice stealing 取代的長音錯誤復活。percussion 使用 absolute-sample phase/noise，seek/loop 與 continuous render 對齊，polling 會消費 device-lost 狀態。
- GUI 使用實際 transport sample rate 換算播放頭；factory device parameters 不再於 save/load 清空，Piano Roll／Step Sequencer 綁定選取軌道，播放中修改 graph 會先停止舊 transport。Step 編輯只重建實際變更的 step，保留和弦、第一小節後音符及 16→64 resolution 變更前的音樂時間。
- 本輪未變更 project schema；新 device ID 為 `instrument-<track-id>`，仍可讀舊冒號格式。
- `cargo tauri build --bundles nsis` 通過；installer 2,308,159 bytes，SHA-256 `B0AE118A4748BD118A2DBD961A50735746008AFDECB6D0D614BB4E7E1C4573FF`，Authenticode `NotSigned`（本機無 PFX）。

## Realtime authoring slice（2026-07-13，最新）

本節取代下方舊的 M0 / GUI vertical-slice 未完成敘述；下方內容僅保留作為早期 baseline 紀錄。

### 已完成範圍

- Rust schema v1 project model，以及受限 ZIP `.sfsproj` 的 `manifest.json` / `project.json`、golden test、原子儲存與 round-trip。
- CPAL Windows/WASAPI 輸出裝置列舉、Project graph playback、transport play/pause/stop/seek/loop、xrun 與 device-lost 狀態；callback 維持無配置、無鎖、無 blocking、無 I/O、無 panic。
- Tauri IPC：專案 save/load/list、transport graph、MIDI bytes import/export、recovery journal write/recover 與音訊 device/status；Project model 不依賴 Tauri / React。
- realtime/offline 共用 PlaybackEngine，包含 immutable GraphSnapshot、sine/triangle/saw/square oscillator、envelope、voice stealing、gain/pan 與 safety limiter。
- MIDI SMF type 0/1、tempo/PPQ/time-signature、malformed input limits 與 deterministic golden fixtures；bounded checksummed recovery journal、atomic checkpoint 與 corrupt/truncated tail recovery。
- Step Sequencer 1–64、velocity/probability/micro-shift/ratchet、200-op bounded history 與 Ctrl/Cmd+Z/Y/Shift+Z。
- Piano Roll note draw/select/erase/resize、velocity、quantize、transpose、duplicate、legato、ghost notes 與 scale highlight。
- 英文、繁體中文、日文、韓文介面；空白、小星星、四拍鼓組、chiptune、SFX starter 五個範本。
- Playwright 分離覆蓋 DPR 與 UI 100/125/150/200% scale。
- Windows NSIS installer；tag-only release workflow 同時封裝三平台 CLI、installer 與 SHA256SUMS。

### Release 邊界

- 本機 NSIS 可重現建置，但目前沒有 PFX secrets，因此 Authenticode 狀態為 `NotSigned`。
- GitHub `release-signing` Environment 僅允許 `v*` tag；`WINDOWS_SIGNING_PFX_BASE64` 與 `WINDOWS_SIGNING_PFX_PASSWORD` 缺失時 workflow 在上傳前 fail closed。實際 PFX proof 尚未執行。
- 實體裝置長時間 soak、ASIO/JACK、SoundFont、effects rack、macOS notarization 仍屬後續里程碑。

### 最新驗證命令

```powershell
cargo fmt --all --check
cargo clippy --workspace --all-targets -- -D warnings
cargo test --workspace
cargo fmt --manifest-path apps/desktop/src-tauri/Cargo.toml -- --check
cargo clippy --manifest-path apps/desktop/src-tauri/Cargo.toml --all-targets -- -D warnings
cargo test --manifest-path apps/desktop/src-tauri/Cargo.toml
corepack pnpm --dir apps/desktop lint
corepack pnpm --dir apps/desktop typecheck
corepack pnpm --dir apps/desktop test
corepack pnpm --dir apps/desktop build
corepack pnpm --dir apps/desktop exec playwright test
Push-Location apps/desktop; cargo tauri build --bundles nsis; Pop-Location
```

最後一次 clean verification：Rust workspace 54 tests、Tauri 2 tests、frontend 42 tests、Playwright 32 tests，全數通過。`cargo tauri build --bundles nsis` 成功；本機產物未簽章，因沒有 `signtool.exe` 與 PFX secrets。`scripts/sign-windows.tests.ps1` static signing checks 通過；完整狀態見 `final.md` 與 `docs/signing.md`。

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
