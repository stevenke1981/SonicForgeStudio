# SonicForge Studio — 最終交付與驗收紀錄

## 最新主線：全介面可發聲、播放完成、WAV 匯出與九個範本（2026-07-14）

SFX Lab 的 Laser Pulse、Deep Impact、Fast Whoosh、Soft UI Click、Rain Ambience 現在都有實際 Preview／Stop，會建立合法 Project snapshot 並走與 Music 相同的 Rust `GraphSnapshot`／`PlaybackEngine`／CPAL 路徑。Mixer 也具 Play／Pause／Stop；mute 或 gain 變更會停止舊 graph，下一次播放使用更新後的完整 Project，不再是只有視覺狀態。

非 loop 播放抵達 project duration 時會由 audio consumer 自動發布 `stopped`，GUI polling 隨即恢復 Play；在尾端再按 Play 會從開頭重播。transport position/state 使用 sequence publication 保持同一 callback snapshot；loop 會 clamp 至 project duration。密集事件以固定 256-frame engine quantum 限制工作量，且 offline/realtime 不受裝置 callback buffer 邊界影響。

已新增 WAV 匯出與真正的另存新檔。WAV 由 blocking render worker 使用共用 engine 產生非靜音 stereo PCM16，檔名會拒絕 traversal、Windows reserved names、空／過大輸出與同名覆寫；寫入使用唯一 temporary、flush/sync 與 no-clobber finalize。Save As 可輸入新名稱與安全 ID，保留原專案並切換至新專案。範本由五個擴充為九個，新增 Piano Ballad、Bass Groove、Synthwave、Cinematic，四語系鍵完整。

最終 Gate：Rust workspace 59 tests、Tauri 5 tests、Vitest 49 tests、Playwright 36 tests、frontend production build 與 NSIS release build 全部通過。Windows installer 位於 `apps/desktop/src-tauri/target/release/bundle/nsis/SonicForge Studio_0.1.0_x64-setup.exe`，2,326,326 bytes，SHA-256 `FAFE71E7B29C6B97C5EEB9F12145327C7B80BB61110C97D33E6793EB5B5C7881`。本機未提供 PFX，Authenticode 如實為 `NotSigned`；實際簽章仍需 GitHub protected `release-signing` Environment 的憑證 secrets。

## 最新主線：Factory instruments 與可移動播放頭（2026-07-13）

已修正使用者看到的三個直接問題：Music Browser 現在有明確的「新增樂器」入口；新增後會建立含示範音符的可播放軌道；橘色播放頭可在時間軸點擊／拖曳、使用鍵盤移動，播放時會依 Rust callback 公布的 sample position 前進。

內建 10 種 factory presets：Analog Lead、Warm Pad、Electric Bass、Soft Keys、Bell、Pluck、Drum Kit、Kick、Snare、Hi-Hat。這些不是只改名稱：Rust 共用 realtime/offline PlaybackEngine 會依 Project device kind 選擇不同 oscillator、envelope、noise 與鼓組 MIDI note 分派；不加入第三方音訊素材，也不變更 project schema。

驗收包含 Rust realtime boundary、每種音色 finite/non-silent/distinct buffer、舊專案 device ID 相容、GUI 新增／切換／保存、播放頭 seek／position sync，以及四種 UI scale。獨立審查發現並修正 transport 命令失序、MPSC producer 競態、callback 無上限 command drain、長專案 seek 掃描、percussion seek 不一致、device-lost polling、裝置取樣率換算、device parameters 遺失、播放中 graph 失同步、editor ownership，以及 Step Sequencer 破壞和弦／長樂段的問題。實體音訊裝置的主觀音色與長時間 soak 仍需在有對應硬體時補做，不能以自動測試冒充硬體聽測。

Windows installer 位於 `apps/desktop/src-tauri/target/release/bundle/nsis/SonicForge Studio_0.1.0_x64-setup.exe`，2,308,159 bytes，SHA-256 `B0AE118A4748BD118A2DBD961A50735746008AFDECB6D0D614BB4E7E1C4573FF`。本機沒有 PFX，因此 Authenticode 狀態仍為 `NotSigned`。

## 最新主線：Realtime authoring slice（2026-07-13）

本次已修正「安裝後按播放沒有聲音」的根因：原本播放鍵只切換前端狀態，沒有建立或啟動 Rust 音訊 graph。現在 GUI 會把 Project snapshot 傳入 Tauri，於控制層建立 CPAL/WASAPI stream；callback 只執行預配置的 PlaybackEngine，透過 atomic command 接收 play、pause、stop、seek 與 loop。離線 render 與 realtime callback 共用同一個 oscillator、envelope、gain/pan、voice allocator、master limiter 路徑。

本次已交付：

- `crates/sonicforge-audio`：TempoClock、immutable GraphSnapshot、PlaybackController、PlaybackEngine、CPAL playback stream、offline/realtime parity tests。
- `crates/sonicforge-io`：MIDI SMF type 0/1 import/export、tempo/PPQ/time-signature mapping、malformed input limits、deterministic golden files；bounded checksummed recovery journal、atomic checkpoint、truncated/corrupt tail recovery。
- Tauri IPC：`transport_start/play/pause/stop`、recovery journal write/recover、MIDI bytes import/export；project save 會先保留 recovery snapshot，成功後清理 transient journal。
- GUI：Step Sequencer 1–64 steps、velocity/probability/micro-shift/ratchet、鍵盤快捷鍵、200-op bounded history；Step pattern 會進入實際 playback Project snapshot；英／繁中／日／韓介面新增完整音序器字串。
- Release：v* tag-only workflow、protected `release-signing` Environment、PFX secrets、SHA-256/RFC3161 signing verification 與 fail-closed gate。

### 本輪驗收證據

| Gate | 結果 |
|---|---|
| Rust workspace fmt / clippy `-D warnings` / tests | 通過；54 tests |
| Tauri crate fmt / clippy `-D warnings` / tests | 通過；2 tests |
| Frontend lint / typecheck / Vitest / production build | 通過；42 Vitest tests |
| Playwright | 通過；32 tests，DPI/UI scale 100/125/150/200%、四語系、Step Sequencer、Piano Roll、audio/project controls |
| NSIS | `cargo tauri build --bundles nsis` 通過 |
| Signing static gate | `scripts/sign-windows.tests.ps1` 通過 |

目前唯一外部阻塞是「實際憑證簽章 proof」：本機沒有 `signtool.exe`，GitHub `release-signing` Environment 尚未提供 `WINDOWS_SIGNING_PFX_BASE64` 與 `WINDOWS_SIGNING_PFX_PASSWORD`。因此本機 installer 不宣稱已簽章；tag release 會在缺少 secrets 時 fail closed，不會上傳未簽章 Windows artifact。

## 0. Desktop 0.1.0 release slice（最新交付）

本節為目前狀態；後續章節保留早期 M0 / GUI vertical-slice 歷史紀錄，其「尚未實作」描述若與本節衝突，以本節及 `BUILD_VERIFICATION.md` 最新段落為準。

已交付：

- 完整 schema v1 project model、`.sfsproj` manifest/project JSON、migration boundary、golden/round-trip tests 與原子儲存。
- CPAL/WASAPI 裝置列舉與即時 test-tone stream、xrun/device-lost 狀態；Tauri save/load/list/audio IPC。
- Piano Roll、專案 save/save-as/load/autosave、100–200% DPI、英文／繁中／日文／韓文介面。
- 五個不含第三方音訊素材的起始範本：空白、小星星（公版旋律）、四拍鼓組、chiptune、SFX starter。
- Windows NSIS installer；`v*` tag GitHub Release 包含三平台 CLI archives、NSIS 與 SHA256SUMS。

未宣告完成：完整 transport/DSP graph playback、MIDI、undo/redo、Step Sequencer、autosave journal/crash recovery、macOS notarization。Windows 簽章 pipeline 已接好，但目前沒有 PFX secrets，因此本次 installer 會如實標記為未簽章。

### 最新本機驗收證據

| Gate | 結果 |
|---|---|
| Rust workspace fmt / Clippy `-D warnings` / tests | 通過；27 tests |
| Tauri crate fmt / Clippy `-D warnings` / tests | 通過；2 tests |
| Frontend lint / typecheck / Vitest / production build | 通過；21 tests |
| Playwright DPI、Piano Roll、project/audio、多語系／範本 | 通過；24 tests |
| `scripts/check.ps1` / `scripts/build-release.ps1` | 通過 |
| `cargo tauri build --bundles nsis` | 通過 |

| Windows 產物 | Bytes | SHA-256 | Authenticode |
|---|---:|---|---|
| `SonicForge Studio_0.1.0_x64-setup.exe` | 2,214,948 | `FBEB27A6A4EA1B3ECA7BE22C5DE07DAAEAFD3BF7BB513F08053A7F7D6DACA2F9` | `NotSigned` |
| `sonicforge-desktop.exe` | 9,584,640 | `4FE99DEA0FB8F46789A41E603A22987A2FC304F653A41B469854BDA7B1012598` | `NotSigned` |
| `sonicforge-cli-windows-x86_64.exe` | 186,368 | `95B15E2C1C9E5811483BAFCEA2FE6FB336CEC4947547D0B583A529FC530A4EC5` | `NotSigned` |

> 本次交付包含 M0 Rust headless 音訊原型、WAV smoke、CI / release workflow，以及可驗收的 Tauri 2 + React GUI vertical slice；不是完整 DAW 產品宣告。

## 1. 版本資訊

- Product：SonicForge Studio
- Version：0.1.0
- Commit：見本輪最終 `main` HEAD 與 `v0.1.0` tag
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
