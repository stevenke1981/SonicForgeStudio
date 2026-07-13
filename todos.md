# SonicForge Studio — 可執行任務清單

規則：只有在對應測試與證據完成後，才可將 `[ ]` 改為 `[x]`。

## 本輪唯一工作項目：Post-0.1.0 audio / authoring / signing slice（已實作，待遠端 CI）

本輪在既有 GUI vertical slice 上完成 realtime transport/DSP graph playback、MIDI type 0/1、bounded crash-recovery journal、Step Sequencer 1–64 steps、bounded undo/redo、四語系顯示與 fail-closed Windows signing pipeline。`prototype/ui-mockup.html` 仍僅是靜態視覺參考。

### Acceptance criteria

| ID | 對應里程碑 | 驗收條件 | 狀態 |
|---|---|---|---|
| GVS-M0-01 | M0 GUI foundation | 建立可重現的 Tauri 2 + React + TypeScript 專案，具備 pnpm lockfile、lint、typecheck、unit test、build 與 Playwright smoke 命令。 | [x] 通過 |
| GVS-M0-02 | M0 architecture boundary | UI 只透過 Tauri allowlist / control command 與 Rust 應用層溝通；UI 不持有或直接修改 DSP node，Project model 不依賴 Tauri / React。 | [x] 通過 |
| GVS-M5-01 | M5 App shell | 啟動後可進入深色工作站 shell，呈現 Browser、主工作區、Inspector 與底部 Mixer / Automation / Event List 區域，並可切換 Music / SFX Lab / Mixer 入口。 | [x] 通過 |
| GVS-M5-02 | M5 Song Editor | Music 入口可建立或顯示 track，Song Editor 可完成 clip 的新增、拖曳、resize、split、duplicate，並提供 grid、snap、zoom 的可見狀態。 | [x] 通過 |
| GVS-M5-03 | M5 Piano Roll | Piano Roll 可完成 note 的 draw、select、erase、resize，且 UI 呈現的 command / state 與 engine-facing state 保持一致。 | [x] 通過 |
| GVS-M5-04 | M5 navigation / input | Browser、Inspector、Command palette 與核心快捷鍵可操作；至少覆蓋 1366×768 與 100%、125%、150%、200% DPI 驗證。 | [x] 通過 |
| GVS-M5-05 | M0/M5 evidence | 保存 Playwright 結果、必要 screenshot、失敗 log 與對應版本資訊；沒有證據不得勾選 M0/M5 GUI 項目。 | [x] 通過 |
| AUD-01 | Realtime playback | Play 將 Project graph snapshot 傳到 Rust，CPAL callback 使用預配置 engine；play/pause/stop/seek/loop 與 offline renderer 共用 DSP 路徑。 | [x] 單元與整合 gate 通過；實體裝置 soak 待有硬體時補做 |
| IO-01 | MIDI / recovery | MIDI SMF type 0/1 note、tempo、PPQ、malformed corpus 與 golden fixture 通過；journal 有 checksum、bounded append、checkpoint、truncated/corrupt tail recovery。 | [x] 通過 |
| UI-01 | Step Sequencer / history | 1–64 steps、velocity、probability、micro-shift、ratchet、鍵盤操作與 200-op bounded history 通過，變更可進入 Project playback snapshot。 | [x] 通過 |
| REL-01 | Signing gate | v* tag release 僅在 protected `release-signing` Environment 取得 PFX secrets 後簽署與驗證；缺少 PFX 時 fail closed。 | [x] workflow 通過靜態驗收；實際憑證 proof 待 secrets |

### 本輪驗收命令

Windows 本機使用 `corepack pnpm`（直接 `pnpm` 不在 PATH）；下列前端與 Tauri 命令均已執行通過。

```text
corepack pnpm install --frozen-lockfile       # passed
corepack pnpm lint                            # passed
corepack pnpm typecheck                       # passed
corepack pnpm test                            # passed: 3 tests
corepack pnpm build                           # passed
corepack pnpm exec playwright test             # passed: 2 tests
cargo fmt --manifest-path apps/desktop/src-tauri/Cargo.toml -- --check  # passed
cargo check --manifest-path apps/desktop/src-tauri/Cargo.toml           # passed
cargo tauri build                         # passed: desktop exe
```

既有 Rust baseline 與 CLI release 命令仍維持通過狀態，詳見 `BUILD_VERIFICATION.md`。

### 已知未完成範圍

- 實體 Windows audio device 的長時間 soak 尚未在本機執行；目前以 callback boundary、offline/realtime parity、limiter、transport 與 device-lost tests 作為可重現證據。
- NSIS installer 已可建置；實際 Authenticode 需在 GitHub `release-signing` Environment 提供 PFX secrets，本機沒有 `signtool.exe`，因此不能宣稱已簽章。
- `prototype/ui-mockup.html` 不代表正式 UI framework、IPC、engine state 或 pixel-perfect implementation。

### 回滾說明

- GUI slice 與文件均在同一個可回退 commit 中；回滾時保留 Rust baseline，移除 desktop slice、workflow job 與對應文件段落即可。
- `apps/desktop/artifacts/screenshots/gui-sfx-lab.png` 是本輪通過截圖；Playwright 的 `test-results/` 與 build target 仍為本機生成物，不納入版本控制。
- 若驗收發現 real-time boundary 或 project model 需要改動，先停在目前 CLI / Rust baseline，依 AGENTS.md 的 F5 架構流程提出 ADR。

## M0 開發基線

- [x] 建立正式 Cargo workspace：core、audio、dsp、render、io、app。
- [x] 建立 Tauri 2 + React + TypeScript 桌面專案。（GUI vertical slice）
- [x] 設定 Rust stable toolchain 與 `rustfmt`、`clippy`。
- [x] 設定 pnpm、ESLint、Vitest。（GUI vertical slice）
- [x] 設定 Playwright smoke test。（GUI vertical slice）
- [x] 建立 GitHub Actions：Windows、Ubuntu、macOS。
- [ ] 建立統一錯誤代碼與 `thiserror` 錯誤層。
- [ ] 建立 structured logging，排除 audio callback。
- [ ] 建立 feature flags：asio、jack、ffmpeg、sf2、midi。
- [ ] 將本包 prototype 移入正式 workspace。
- [x] 驗證 `scripts/check.*` 全綠。

## M1 Transport 與音訊核心

- [x] 定義 sample clock、tick、PPQ 與 tempo map。
- [x] 實作 play、pause、stop、seek。
- [x] 實作 loop region。
- [ ] 實作 lock-free SPSC command queue。
- [ ] 實作 preallocated event queue。
- [x] 實作 immutable graph snapshot。
- [ ] 實作 block-based parameter smoothing。
- [x] 建立 CPAL device enumeration。
- [x] 建立 WASAPI shared output。
- [x] 建立 device change / lost handler。
- [x] 建立 xrun counter。
- [x] 建立 master safety limiter。
- [x] 讓即時與離線共用 DSP process API。
- [ ] 10 分鐘 soak test。

## M2 DSP 基礎

- [x] Oscillator：sine。
- [x] Oscillator：triangle。
- [x] Oscillator：saw。
- [x] Oscillator：square / pulse。
- [ ] Noise：white / pink approximation。
- [x] ADSR envelope。
- [ ] Biquad LP / HP / BP。
- [ ] One-pole parameter smoother。
- [x] Gain / pan。
- [ ] Delay line 與 feedback clamp。
- [ ] 3-band EQ。
- [ ] Compressor。
- [ ] Algorithmic reverb。
- [x] Soft clipper / limiter。
- [ ] 每個 DSP 補 impulse、silence、boundedness 測試。

## M3 樂器

- [ ] Subtractive Synth voice。
- [ ] Voice allocator 與 voice stealing。
- [ ] Mono / legato / portamento。
- [ ] LFO x2。
- [ ] Mod matrix。
- [ ] Factory preset schema。
- [ ] Drum sampler 16 pads。
- [ ] Sample cache 與 decode worker。
- [ ] Choke groups。
- [ ] Reverse / pitch / trim。
- [ ] RustySynth SF2 adapter。
- [ ] SF2 bank / preset browser。
- [ ] Missing asset relink flow。

## M4 程序式音效

- [ ] Recipe registry 與版本管理。
- [ ] Seeded PRNG abstraction。
- [ ] Parameter lock / randomize。
- [ ] Laser recipe。
- [ ] Explosion recipe。
- [ ] Whoosh recipe。
- [ ] Impact recipe。
- [ ] UI click recipe。
- [ ] Notification recipe。
- [ ] Pickup / coin recipe。
- [ ] Footstep recipe。
- [ ] Wind recipe。
- [ ] Rain recipe。
- [ ] Drone ambience recipe。
- [ ] Retro 8-bit recipe。
- [ ] Freeze recipe to clip。
- [ ] Batch variants 1–32。
- [ ] Peak target、tail trim、naming template。
- [ ] Determinism hash tests。

## M5 編曲 UI（本輪 GUI vertical slice；部分完成）

以下 M5 GUI 項目全部維持 `[ ]`；只有完成對應 `GVS-M5-*` criteria 與 evidence 後才能改為 `[x]`。

- [x] App shell 與 workspace layout。
- [x] Command palette。
- [x] Browser panel。
- [x] Song Editor canvas。
- [x] Track headers。
- [x] Clip drag / resize / split / duplicate。
- [x] Grid / snap / zoom。
- [x] Piano Roll canvas。
- [x] Velocity lane。
- [x] Quantize / transpose。（humanize 待後續）
- [x] Ghost notes / scale highlight。
- [x] Step Sequencer 1–64 steps。
- [x] Probability / ratchet / micro shift。
- [x] Mixer strips。
- [ ] Insert rack。
- [ ] Sends。
- [x] Inspector。
- [ ] Keyboard shortcut editor。
- [x] Undo / redo history UI（Step Sequencer bounded 200-op history）。

## M6 專案與 I/O

- [x] `.sfsproj` manifest。
- [x] schema v1 model validation 與 golden test。
- [x] schema migration v1 framework。
- [x] relative asset resolver。
- [ ] SHA-256 asset fingerprint。
- [x] autosave journal。
- [x] crash recovery UI。
- [x] atomic save。
- [ ] WAV 16/24/32f writer。
- [ ] WAV import。
- [x] MIDI import / export（Tauri bytes API、SMF type 0/1）。
- [ ] SF2 import。
- [ ] portable package。
- [ ] missing asset report。

## M7 Automation 與進階混音

- [ ] Automation data model。
- [ ] Point / linear / bezier curves。
- [ ] Lane editor。
- [ ] Sample block interpolation。
- [ ] Read mode。
- [ ] Touch / latch（P1）。
- [ ] Send bus graph。
- [ ] Meter peak / RMS。
- [ ] Clipping history。
- [ ] Stem export。

## M8 效能與品質

- [ ] Benchmark 16 tracks / 128 voices。
- [ ] Callback p50 / p95 / p99 telemetry。
- [ ] Memory soak test。
- [ ] Project open benchmark。
- [ ] 100k notes load test。
- [ ] Fuzz project parser。
- [ ] Fuzz WAV / MIDI adapters。
- [ ] Property tests for time conversion。
- [ ] Denormal handling。
- [ ] NaN / Inf node isolation。
- [ ] Accessibility keyboard pass。
- [x] High DPI 100/125/150/200% pass。

## M9 發布

- [x] Windows NSIS installer。
- [x] Windows code-signing gate（有憑證時；缺憑證 fail closed）。
- [ ] Linux package。
- [ ] macOS bundle / notarization（有環境時）。
- [ ] First-run audio setup。
- [ ] Factory presets 與授權清單。
- [ ] Diagnostics export。
- [ ] User manual。
- [ ] Changelog。
- [ ] Reproducible release checklist。
- [ ] P0 / P1 acceptance 全綠。

## 後續 P2

- [ ] ASIO 官方選配建置說明。
- [ ] JACK routing。
- [ ] MIDI controller mapping。
- [ ] VST3 host 可行性與授權研究。
- [ ] LV2 host。
- [ ] AU host。
- [ ] Recording / punch in / comping。
- [ ] Time stretch / pitch shift。
- [ ] AI prompt-to-SFX adapter，需模型授權隔離。
