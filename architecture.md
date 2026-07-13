# 系統架構

## 1. 架構原則

1. UI 與音訊引擎分離。
2. 即時執行緒只讀取預先配置的資料。
3. 所有昂貴操作在 worker 完成，再以 snapshot 交換。
4. 即時與離線渲染共用 DSP，避免結果不一致。
5. Project model 不綁定 Tauri 或任何 UI framework。
6. 檔案格式具 schema version 與 migration。

## 2. 邏輯圖

```text
React / TypeScript UI
  ├─ Song Editor / Piano Roll / Mixer / SFX Lab
  ├─ UI Store
  └─ Tauri IPC allowlist
             │ commands / events
             ▼
Rust Application Layer
  ├─ Project Service
  ├─ Command History
  ├─ Asset Service
  ├─ Render Jobs
  └─ Diagnostics
             │ control messages
             ▼
Audio Control Layer
  ├─ Graph Builder
  ├─ Parameter Store
  ├─ Device Manager
  └─ Snapshot Publisher
             │ lock-free swap / bounded MPSC
             ▼
Real-time Audio Thread
  ├─ Transport Clock
  ├─ Event Scheduler
  ├─ DSP Graph
  ├─ Meter Tap
  └─ Safety Limiter
             │
             ▼
CPAL → WASAPI / ASIO / ALSA / JACK / CoreAudio
```

## 3. Crates

### sonicforge-core

- ID types
- Project、Track、Clip、Pattern、Note
- Undo commands
- Tempo map
- Validation

### sonicforge-dsp

- AudioBuffer / ProcessContext
- Oscillators
- Envelopes
- Filters
- Effects
- Instruments shared primitives
- No GUI, no filesystem

### sonicforge-audio

- CPAL adapter
- Device enumeration
- Stream lifecycle
- Command queue
- Graph snapshot
- Event scheduling
- Meter ring buffer

### sonicforge-render

- Offline engine
- Stem render
- Progress / cancellation
- WAV writer
- Tail detector

### sonicforge-io

- Project package
- WAV decode
- MIDI
- SF2 adapter
- Asset fingerprints
- Migrations

### sonicforge-recipes

- Recipe registry
- Parameter schema
- Seeded randomization
- Built-in SFX recipes

### sonicforge-app

- Tauri commands
- Permission allowlist
- Dialogs
- Settings
- Update checks（可選）

## 4. 即時資料交換

### UI → control

一般 channel，可等待；命令先驗證。

### Control → audio

- Bounded MPSC command queue：多個 control-side producer 提交 transport、note 與 small parameter event；audio callback 是唯一 consumer，每個 block 有固定處理上限。
- Atomic scalar：少量高頻 macro parameter。
- ArcSwap / epoch snapshot：graph replacement；真正釋放在非 audio thread。

### Audio → UI

- Fixed-size ring buffer。
- Meter 30–60 Hz 降採樣。
- Xrun counter 使用 atomic。

## 5. DSP node API

```rust
pub trait AudioNode: Send {
    fn prepare(&mut self, spec: PrepareSpec) -> Result<(), DspError>;
    fn reset(&mut self);
    fn process(&mut self, ctx: &ProcessContext, input: &[&[f32]], output: &mut [&mut [f32]]);
    fn latency_samples(&self) -> u32 { 0 }
    fn tail_samples(&self) -> Option<u64> { Some(0) }
}
```

要求：

- `process()` 不配置。
- 不 panic。
- 參數已轉為 block ramp 或 event span。
- 任何非 finite sample 立即置零並累計 fault。

## 6. 排程

- 專案時間以 tick 儲存。
- Audio engine 使用 sample position。
- 每 block 依 tempo map 將事件轉 sample offset。
- Note event 落在 block 內時使用 offset，不能只在 block boundary 觸發。
- Loop 跨越時拆分 block 或重新排程。

## 7. UI Canvas

Piano Roll 與 Song Editor 避免每個 note / clip 建立 DOM：

- 使用 Canvas/WebGL。
- spatial index 搜尋可見事件。
- 只繪製 viewport。
- selection 與 drag preview 以 overlay layer。
- waveform 使用 multi-resolution peak cache。

## 8. Plugin hosting 邊界

VST3、AU、LV2 的生命週期、sandbox、GUI embedding、掃描與授權複雜度高，首版不放入核心。

正式加入時：

- 以獨立 process 掃描 plugin。
- plugin crash 不得拖垮主程式。
- 建立 blacklist 與 scan cache。
- 明確記錄 SDK / license 義務。
- plugin state 使用 binary blob，限制大小。

## 9. 可觀測性

Diagnostics：

- app version / commit
- OS
- audio host / device
- sample rate / buffer
- callback p50/p95/p99
- xrun count
- graph node count
- memory summary
- recent structured errors

預設不包含專案音訊、檔名與個人路徑；需使用者明確勾選。
