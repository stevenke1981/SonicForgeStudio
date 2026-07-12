# SonicForge Studio — 最終交付與驗收紀錄

> 本次交付是 M0 baseline 的可驗收切片：Rust headless 音訊原型、WAV smoke、CI 與 release build workflow；不是完整 Tauri/React 產品宣告。

## 1. 版本資訊

- Product：SonicForge Studio
- Version：0.1.0
- Commit：`a880a73`（baseline implementation；本文件後續為驗收紀錄同步）
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
- [ ] Song Editor、Piano Roll、Step Sequencer、Mixer
- [ ] Subtractive Synth、Drum Sampler、SF2 Player
- [ ] 完整 Procedural SFX Recipe registry、Effects、Automation
- [ ] Project save / autosave / recovery、MIDI、Installer

## 3. 未完成與已知限制

| ID | 項目 | 影響 | 暫時方案 | 預計里程碑 |
|---|---|---|---|---|
| M0-001 | 尚未建立完整 audio/dsp/render/io/app crates | 尚無 real-time device playback | 使用 headless deterministic render | M1 |
| M0-002 | 尚未接入 Tauri/React UI | 只能以 CLI 驗證 | 使用 `prototype/ui-mockup.html` 與 CLI | M3 |
| M0-003 | Release workflow 只產生 CLI binary artifacts | 尚無 installer、簽章、notarization | 使用 `dist/` 本機 binary 或 Actions artifacts | M9 |

## 4. 測試摘要

| 類別 | Passed | Failed | Skipped | Evidence |
|---|---:|---:|---:|---|
| Rust unit | 15 | 0 | 0 | `BUILD_VERIFICATION.md` |
| Integration | 1 | 0 | 0 | `apps/cli/tests/demo_smoke.rs` |
| UI / Playwright | 0 | 0 | 1 | UI 尚未納入 workspace |
| Audio smoke / WAV | 1 | 0 | 0 | `artifacts/demo.wav`，本機產生；CLI bytes determinism |
| Performance | 0 | 0 | 1 | real-time engine 尚未建立 |
| Security | 0 | 0 | 1 | 本輪未修改 filesystem/package parser boundary |

## 5. 效能結果

- Device / host：N/A，未接 real-time device
- Sample rate：48,000 Hz（offline demo）
- Buffer：N/A
- Tracks / voices：1 demo track，offline render
- Callback p50 / p95 / p99：N/A
- Xruns / 10 minutes：N/A
- Peak memory：未測量
- WAV peak：`-6.767 dBFS`
- Prototype render 具有 track/note/output allocation limits，並拒絕超出 pattern 的 note。

## 6. 安裝包與 release artifacts

| 平台 | 檔案 | SHA-256 | 簽章 |
|---|---|---|---|
| Windows | `dist/sonicforge-cli-windows-x86_64.exe` | `57a10c0e10c80da345f16fadcb93218a21534aceabb7e9b595a70ffc0b0a1ed8` | N/A |
| Linux | GitHub Actions `sonicforge-ubuntu-x64-*` artifact | CI 產生 | N/A |
| macOS | GitHub Actions `sonicforge-macos-x64-*` artifact | CI 產生 | N/A |

## 7. 授權與素材

- App source license：MIT（以 `LICENSE` 為準）。
- 本輪未加入第三方音訊素材或 SoundFont。
- 不使用 LMMS 程式碼、素材、圖示、名稱或 UI。

## 8. 回滾

- Release tag：尚未建立
- Previous stable：以提交前 commit 為準
- Project schema downgrade：不適用；本輪未變更 project schema
- Installer rollback：不適用；尚未建立 installer

## 9. 驗收簽核

- Product owner：TBD
- Engineering：Codex / Hermes
- QA：由本機 Gate 與 CI workflow 執行
- Security / licensing：TBD
- Date：2026-07-13

## 10. 驗證命令

```powershell
cargo fmt --all --check
cargo clippy --workspace --all-targets -- -D warnings
cargo test --workspace
cargo run -p sonicforge-cli -- demo artifacts/demo.wav
pwsh -NoProfile -ExecutionPolicy Bypass -File ./scripts/check.ps1
pwsh -NoProfile -ExecutionPolicy Bypass -File ./scripts/build-release.ps1
```

預期：Rust Gate 全綠、16 個 workspace tests 通過、產生有效 stereo 16-bit PCM WAV，並產生 Windows release CLI 與 SHA-256 manifest。
