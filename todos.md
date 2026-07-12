# SonicForge Studio — 可執行任務清單

規則：只有在對應測試與證據完成後，才可將 `[ ]` 改為 `[x]`。

## M0 開發基線

- [ ] 建立正式 Cargo workspace：core、audio、dsp、render、io、app。
- [ ] 建立 Tauri 2 + React + TypeScript 桌面專案。
- [x] 設定 Rust stable toolchain 與 `rustfmt`、`clippy`。
- [ ] 設定 pnpm、ESLint、Prettier、Vitest。
- [ ] 設定 Playwright smoke test。
- [x] 建立 GitHub Actions：Windows、Ubuntu、macOS。
- [ ] 建立統一錯誤代碼與 `thiserror` 錯誤層。
- [ ] 建立 structured logging，排除 audio callback。
- [ ] 建立 feature flags：asio、jack、ffmpeg、sf2、midi。
- [ ] 將本包 prototype 移入正式 workspace。
- [ ] 驗證 `scripts/check.*` 全綠。

## M1 Transport 與音訊核心

- [ ] 定義 sample clock、tick、PPQ 與 tempo map。
- [ ] 實作 play、pause、stop、seek。
- [ ] 實作 loop region。
- [ ] 實作 lock-free SPSC command queue。
- [ ] 實作 preallocated event queue。
- [ ] 實作 immutable graph snapshot。
- [ ] 實作 block-based parameter smoothing。
- [ ] 建立 CPAL device enumeration。
- [ ] 建立 WASAPI shared output。
- [ ] 建立 device change / lost handler。
- [ ] 建立 xrun counter。
- [ ] 建立 master safety limiter。
- [ ] 讓即時與離線共用 DSP process API。
- [ ] 10 分鐘 soak test。

## M2 DSP 基礎

- [ ] Oscillator：sine。
- [ ] Oscillator：triangle。
- [ ] Oscillator：saw。
- [ ] Oscillator：square / pulse。
- [ ] Noise：white / pink approximation。
- [ ] ADSR envelope。
- [ ] Biquad LP / HP / BP。
- [ ] One-pole parameter smoother。
- [ ] Gain / pan。
- [ ] Delay line 與 feedback clamp。
- [ ] 3-band EQ。
- [ ] Compressor。
- [ ] Algorithmic reverb。
- [ ] Soft clipper / limiter。
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

## M5 編曲 UI

- [ ] App shell 與 workspace layout。
- [ ] Command palette。
- [ ] Browser panel。
- [ ] Song Editor canvas。
- [ ] Track headers。
- [ ] Clip drag / resize / split / duplicate。
- [ ] Grid / snap / zoom。
- [ ] Piano Roll canvas。
- [ ] Velocity lane。
- [ ] Quantize / humanize / transpose。
- [ ] Ghost notes / scale highlight。
- [ ] Step Sequencer 1–64 steps。
- [ ] Probability / ratchet / micro shift。
- [ ] Mixer strips。
- [ ] Insert rack。
- [ ] Sends。
- [ ] Inspector。
- [ ] Keyboard shortcut editor。
- [ ] Undo / redo history UI。

## M6 專案與 I/O

- [ ] `.sfsproj` manifest。
- [ ] JSON Schema 驗證。
- [ ] schema migration v1 framework。
- [ ] relative asset resolver。
- [ ] SHA-256 asset fingerprint。
- [ ] autosave journal。
- [ ] crash recovery UI。
- [ ] atomic save。
- [ ] WAV 16/24/32f writer。
- [ ] WAV import。
- [ ] MIDI import / export。
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
- [ ] High DPI 100/125/150/200% pass。

## M9 發布

- [ ] Windows MSI / NSIS installer。
- [ ] Windows code signing（有憑證時）。
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
