# SonicForge Studio — 最終交付與驗收紀錄

> 本次交付包含 M0 Rust headless 音訊原型、WAV smoke、CI / release workflow，以及可驗收的 Tauri 2 + React GUI vertical slice；不是完整 DAW 產品宣告。

## 1. 版本資訊

- Product：SonicForge Studio
- Version：0.1.0
- Commit：推送後的 `main` HEAD（baseline 與 GUI delivery 皆可由 `git log --oneline` 追溯）
- Build date：2026-07-13
- Rust：stable，`cargo/rustc 1.94.1`
- Target platforms：Windows 本機驗證；CI workflow 定義 Windows x64、Ubuntu x64、macOS x64

## 2. 已交付功能

- [x] Deterministic headless project render
- [x] Project / track / pattern 基本 validation
- [x] Stereo 16-bit PCM WAV writer 與 header validation
- [x] CLI demo WAV smoke command
- [x] Rust fmt / clippy / workspace test Gate
- [x] Windows release build script 與 SHA-256 manifest
- [x] GitHub Actions CI workflow
- [x] GitHub Actions tag-based release build workflow
- [x] Tauri 2 + React desktop shell、Browser、Inspector、Command palette
- [x] Song Editor / clip actions、SFX Lab、Mixer strips 的 GUI vertical slice
- [ ] Piano Roll、Step Sequencer、完整 engine-facing Mixer
- [ ] Subtractive Synth、Drum Sampler、SF2 Player
- [ ] 完整 Procedural SFX Recipe registry、Effects、Automation
- [ ] Project save / autosave / recovery、MIDI、Installer

## 3. 本輪 GUI vertical slice（已驗收主要切片）

本輪 GUI 範圍是 M0 GUI foundation 加上 M5 最小編曲介面切片。`prototype/ui-mockup.html` 只作為視覺參考；正式 GUI 位於 `apps/desktop/`。

| ID | Acceptance criterion | 狀態 |
|---|---|---|
| GVS-M0-01 | Tauri 2 + React + TypeScript 專案可重現，具備 pnpm lockfile、lint、typecheck、unit test、build、Playwright smoke。 | 通過 |
| GVS-M0-02 | UI 經 Tauri allowlist / control command 與 Rust 應用層溝通；不直接持有 DSP node，Project model 不依賴 Tauri / React。 | 通過 |
| GVS-M5-01 | App shell 顯示 Browser、主工作區、Inspector、底部區域，並可切換 Music / SFX Lab / Mixer 入口。 | 通過 |
| GVS-M5-02 | Song Editor 完成 track / clip 的新增、拖曳、resize、split、duplicate，以及 grid / snap / zoom 可見狀態。 | 通過 |
| GVS-M5-03 | Piano Roll 完成 note draw、select、erase、resize，UI command / state 與 engine-facing state 一致。 | 未實作 |
| GVS-M5-04 | Browser、Inspector、Command palette 與核心快捷鍵可操作；覆蓋 1366×768 與 100%、125%、150%、200% DPI。 | 部分通過；DPI pass 待補 |
| GVS-M5-05 | 保存 Playwright 結果、必要 screenshot、失敗 log 與版本資訊；沒有 evidence 不得勾選 M0/M5 GUI 項目。 | 通過 |

### GUI 驗收命令狀態

Windows 本機以 `corepack pnpm` 執行（直接 `pnpm` 不在 PATH）；下列命令均已通過：

```text
corepack pnpm install --frozen-lockfile       # passed
corepack pnpm lint                            # passed
corepack pnpm typecheck                       # passed
corepack pnpm test                            # passed: 3 tests
corepack pnpm build                           # passed
corepack pnpm exec playwright test             # passed: 2 tests
cargo fmt --manifest-path apps/desktop/src-tauri/Cargo.toml -- --check  # passed
cargo check --manifest-path apps/desktop/src-tauri/Cargo.toml           # passed
cargo tauri build                                      # passed: desktop exe
```

### 已知未完成範圍

- Piano Roll、Step Sequencer、完整 project model、undo/redo 與 real-time engine IPC 尚未完成。
- GUI shell / Song Editor / SFX Lab / Mixer slice 已完成；DPI 100/125/150/200% pass 尚未完成。
- Project save / autosave / recovery、real-time device playback、M6 I/O、installer 與正式 release GUI 不在本輪範圍。
- 靜態 prototype 不等同於正式 UI framework、IPC、engine state 或 pixel-perfect implementation。

## 4. 未完成與已知限制

| ID | 項目 | 影響 | 暫時方案 | 預計里程碑 |
|---|---|---|---|---|
| M0-001 | 尚未建立完整 audio/dsp/render/io/app crates | 尚無 real-time device playback | 使用 headless deterministic render | M1 |
| M0-002 | Tauri/React 目前是 read-only GUI slice | 尚無 real-time device playback 與完整 project IPC | 使用 mock status command 與 CLI render | M1/M6 |
| M0-003 | Release workflow 產生 CLI 與 Windows desktop executable artifacts | 尚無 installer、簽章、notarization | 使用 Actions artifacts / 本機 release binary | M9 |

## 5. 測試摘要

| 類別 | Passed | Failed | Skipped | Evidence |
|---|---:|---:|---:|---|
| Rust unit | 15 | 0 | 0 | `BUILD_VERIFICATION.md` |
| Integration | 1 | 0 | 0 | `apps/cli/tests/demo_smoke.rs` |
| UI unit | 3 | 0 | 0 | `apps/desktop/src/App.test.tsx` |
| UI / Playwright | 2 | 0 | 0 | `apps/desktop/tests/app.spec.ts`、GUI screenshot |
| Audio smoke / WAV | 1 | 0 | 0 | `artifacts/demo.wav`，本機產生；CLI bytes determinism |
| Performance | 0 | 0 | 1 | real-time engine 尚未建立 |
| Security | 0 | 0 | 1 | 本輪未修改 filesystem/package parser boundary |

## 6. 效能結果

- Device / host：N/A，未接 real-time device
- Sample rate：48,000 Hz（offline demo）
- Buffer：N/A
- Tracks / voices：1 demo track，offline render
- Callback p50 / p95 / p99：N/A
- Xruns / 10 minutes：N/A
- Peak memory：未測量
- WAV peak：`-6.767 dBFS`
- Prototype render 具有 track/note/output allocation limits，並拒絕超出 pattern 的 note。

## 7. 安裝包與 release artifacts

| 平台 | 檔案 | SHA-256 | 簽章 |
|---|---|---|---|
| Windows | `dist/sonicforge-cli-windows-x86_64.exe` | `57a10c0e10c80da345f16fadcb93218a21534aceabb7e9b595a70ffc0b0a1ed8` | N/A |
| Windows desktop | `apps/desktop/src-tauri/target/release/sonicforge-desktop.exe` | `38a70b95f1387b69fd4c7651cd0e86a442d87e66eb1b41435efc9312c7355cf5` | N/A |
| Linux | GitHub Actions `sonicforge-ubuntu-x64-*` artifact | CI 產生 | N/A |
| macOS | GitHub Actions `sonicforge-macos-x64-*` artifact | CI 產生 | N/A |

## 8. 授權與素材

- App source license：MIT（以 `LICENSE` 為準）。
- 本輪未加入第三方音訊素材或 SoundFont。
- 不使用 LMMS 程式碼、素材、圖示、名稱或 UI。

## 9. 回滾

- Release tag：尚未建立
- Previous stable：以提交前 commit 為準
- Project schema downgrade：不適用；本輪未變更 project schema
- Installer rollback：不適用；尚未建立 installer
- 本輪文件限定變更的回滾：以審查後反向 patch 還原 `todos.md`、`final.md`、`BUILD_VERIFICATION.md`、`README.md` 的新增段落；不刪除 Rust baseline、`artifacts/`、`dist/` 或使用者素材。
- 若後續 GUI 實作另行落地且驗收失敗，回退到 CLI / Rust baseline，保留失敗 screenshot、log 與 workaround；目前沒有 GUI feature flag 或 schema migration 可回退，均為 TBD。

## 10. 驗收簽核

- Product owner：TBD
- Engineering：Codex / Hermes
- QA：由本機 Gate 與 CI workflow 執行
- Security / licensing：TBD
- Date：2026-07-13

## 11. 驗證命令

```powershell
cargo fmt --all --check
cargo clippy --workspace --all-targets -- -D warnings
cargo test --workspace
cargo run -p sonicforge-cli -- demo artifacts/demo.wav
pwsh -NoProfile -ExecutionPolicy Bypass -File ./scripts/check.ps1
pwsh -NoProfile -ExecutionPolicy Bypass -File ./scripts/build-release.ps1
corepack pnpm --dir apps/desktop install --frozen-lockfile
corepack pnpm --dir apps/desktop lint
corepack pnpm --dir apps/desktop typecheck
corepack pnpm --dir apps/desktop test
corepack pnpm --dir apps/desktop build
corepack pnpm --dir apps/desktop exec playwright test
cargo fmt --manifest-path apps/desktop/src-tauri/Cargo.toml -- --check
cargo check --manifest-path apps/desktop/src-tauri/Cargo.toml
Push-Location apps/desktop
cargo tauri build
Pop-Location
```

預期：Rust Gate 全綠、16 個 workspace tests 通過、frontend 3 tests 與 Playwright 2 tests 通過，產生有效 WAV、CLI release 與 Windows desktop executable。正式 installer / signing 仍未建立。
