# SonicForge Studio — 產品與工程規格

## 1. 名詞

- Project：完整工作檔。
- Track：軌道，可為 Instrument、Audio、Automation、Bus。
- Clip：時間軸上的容器。
- Pattern：可重複使用的音符或步進資料。
- Note event：音高、開始、長度、力度、表情。
- Device：樂器或效果器。
- Preset：Device 參數集合。
- Recipe：程序式音效產生規則。
- Transport：播放、停止、定位、循環與節拍狀態。

## 2. 使用者故事

### 音效設計者

- 我可以選擇「雷射」配方、調整長度與音高下降曲線，立即預聽。
- 我可以鎖定部分參數，只隨機化其餘參數。
- 我可以用固定 seed 重現同一音效。
- 我可以一次匯出 20 個變體，檔名自動編號。

### 音樂創作者

- 我可以在 Piano Roll 畫音符並量化。
- 我可以建立 Pattern，重複排列到 Song Editor。
- 我可以使用內建 synth、drum sampler 與 SF2 樂器。
- 我可以加入效果器與自動化，匯出完整 WAV。

### 遊戲開發者

- 我可以建立 UI、武器、環境等 preset bank。
- 我可以控制 peak、duration、loop point 與檔名規格。
- 我可以將專案與素材一起打包，交給團隊重現。

## 3. 功能需求

### FR-001 專案

- 新增、開啟、儲存、另存、最近使用清單。
- 專案 dirty 狀態。
- 自動儲存，預設每 2 分鐘；只在有變更時寫入。
- 儲存採 temporary + fsync + atomic rename。
- 專案格式包含 schema version。

### FR-002 Transport

- Play、Pause、Stop。
- Seek 至 tick / sample。
- Loop region。
- Tempo 20–400 BPM。
- Time signature：分子 1–32；分母 1、2、4、8、16、32。
- Metronome 與 count-in。

### FR-003 Song Editor

- Track 增刪、排序、命名、顏色、mute、solo、arm。
- Clip 移動、複製、裁切、loop、split、merge。
- Snap：off、1/1 至 1/64、triplet。
- 水平／垂直縮放。
- Marker 與 loop selection。

### FR-004 Piano Roll

- Draw、select、erase、split、resize。
- Velocity lane。
- Quantize、humanize、transpose、legato、duplicate。
- Scale highlighting。
- Ghost notes。
- MIDI preview。

### FR-005 Step Sequencer

- 1–64 steps。
- 每步 velocity、probability、micro shift、ratchet。
- Pattern length 可不同於 4/4。
- Swing 0–100%。

### FR-006 Mixer

- Track strip：gain、pan、mute、solo、meter。
- 8 個 insert slots。
- 至少 4 個 send buses。
- Master strip。
- Peak hold 與 clipping indicator。

### FR-007 Subtractive Synth

- 2 oscillators + noise。
- Wave：sine、triangle、saw、square、pulse、noise。
- Tune / fine / phase / pulse width。
- Amp ADSR、filter ADSR。
- Filter：LP、HP、BP；12/24 dB。
- 2 LFO。
- Mod matrix 至少 8 slots。
- Polyphony 1–64、mono、legato、portamento。

### FR-008 Drum Sampler

- 16 pads。
- 每 pad：sample、gain、pan、pitch、start/end、reverse、choke group。
- One-shot / gate。
- WAV 匯入。
- 可打包素材。

### FR-009 SoundFont

- SF2 載入。
- Bank / preset 選擇。
- MIDI program change 可選。
- 檔案遺失時顯示 relink UI。

### FR-010 程序式音效生成

內建 recipes：

1. Laser
2. Explosion
3. Whoosh
4. Impact
5. UI Click
6. Notification
7. Pickup / Coin
8. Footstep
9. Wind
10. Rain
11. Drone ambience
12. Retro 8-bit

每個 recipe 必須：

- 具參數 schema、範圍、單位與預設值。
- 可即時預聽。
- 可輸入 seed。
- 可隨機化全部或未鎖定參數。
- 可 freeze 成 audio clip。
- 可批次匯出變體。
- 可設定最大 peak 與 tail trimming。

### FR-011 效果器

P0：

- Utility Gain / Pan
- Biquad Filter
- 3-band EQ
- Compressor
- Delay
- Reverb
- Soft Clipper / Limiter

P1：

- Chorus
- Flanger
- Phaser
- Distortion
- Bitcrusher
- Gate

### FR-012 Automation

- 任何標示 automatable 的參數可建立 lane。
- Point、linear、bezier。
- Read、touch、latch（P1）。
- 參數變更使用 sample block ramp，避免 zipper noise。

### FR-013 匯出

- WAV：16-bit PCM、24-bit PCM、32-bit float。
- 44.1 / 48 / 88.2 / 96 kHz。
- Entire song、loop region、selected clips。
- Master 或 stems。
- Normalize：off、peak、true peak（true peak P1）。
- Tail：固定秒數或自動偵測。
- MP3/OGG/FLAC 由可選 FFmpeg adapter 提供，未偵測到 FFmpeg 時不得影響 WAV。

### FR-014 Undo / Redo

- 命令模式。
- 最少保存 200 個操作，或依記憶體上限淘汰。
- 連續拖曳合併為單一命令。
- 音訊 device graph 變更須可撤銷。

### FR-015 設定

- Audio device / host / sample rate / buffer size。
- MIDI devices。
- Theme、language、autosave interval。
- Sample library paths。
- Diagnostics export。

## 4. 非功能需求

### NFR-001 即時安全

Audio callback 中禁止：

- heap allocation
- blocking lock
- filesystem
- network
- process spawn
- JSON serialize
- dynamic logging formatting
- panic

### NFR-002 效能預算

參考機器：4 cores、8GB RAM、一般內顯。

- 48kHz / 256 frames 下，16 軌、8 個 synth voices/軌、基礎效果器可持續播放。
- UI 目標 60 FPS；最低可接受 30 FPS。
- Audio callback p99 小於 buffer deadline 的 70%。
- 10 分鐘播放不得持續累積記憶體。

### NFR-003 穩定性

- 無效專案與素材不得造成 process crash。
- DSP 發現 NaN/Inf 時隔離節點、輸出靜音並回報。
- Device lost 時停止 transport，提示重新選擇。
- Panic hook 產生可匿名化診斷包。

### NFR-004 可攜性

- 路徑保存為 project-relative 優先。
- Windows Unicode 路徑必須通過。
- 不假設檔名為 ASCII。
- 不直接保存平台專屬絕對路徑到 portable package。

### NFR-005 可測試性

- DSP 皆可 headless 執行。
- 離線 render 可固定 seed。
- UI command 與 engine command 有序列化測試。
- Project migration 有 golden files。

### NFR-006 無障礙

- 主要操作可鍵盤完成。
- 可調整 UI scale 80–200%。
- 顏色不是唯一狀態提示。
- Meter 提供數值文字。

## 5. 資料與 API

### EngineCommand

```rust
pub enum EngineCommand {
    Play,
    Pause,
    Stop,
    SeekSamples(u64),
    SetLoop { start: u64, end: u64, enabled: bool },
    NoteOn { track_id: u64, note: u8, velocity: f32 },
    NoteOff { track_id: u64, note: u8 },
    SetParameter { device_id: u64, parameter_id: u32, value: f32 },
    ReplaceGraph(GraphSnapshot),
}
```

### EngineEvent

```rust
pub enum EngineEvent {
    Position { sample: u64, tick: u64 },
    Meter { channel: u16, peak: f32, rms: f32 },
    Xrun { total: u64 },
    DeviceLost,
    RenderProgress { job_id: u64, progress: f32 },
    Error { code: String, message: String },
}
```

### RecipeDefinition

```json
{
  "id": "builtin.laser.v1",
  "name": "Laser",
  "version": 1,
  "parameters": [
    {"id":"duration_ms","type":"float","min":30,"max":5000,"default":600,"unit":"ms"},
    {"id":"start_hz","type":"float","min":80,"max":12000,"default":1800,"unit":"Hz"},
    {"id":"end_hz","type":"float","min":20,"max":8000,"default":120,"unit":"Hz"}
  ]
}
```

## 6. 錯誤代碼

- `SF-PROJECT-001`：專案格式不支援。
- `SF-PROJECT-002`：專案檔損壞。
- `SF-AUDIO-001`：找不到輸出裝置。
- `SF-AUDIO-002`：不支援 requested stream config。
- `SF-AUDIO-003`：裝置中斷。
- `SF-ASSET-001`：素材遺失。
- `SF-ASSET-002`：素材格式不支援。
- `SF-RENDER-001`：輸出路徑不可寫。
- `SF-RENDER-002`：渲染取消。
- `SF-DSP-001`：節點輸出非有限數值。

## 7. 明確不做

第一版不做：

- 複製 LMMS 的 UI、專案格式、圖示、預設或名稱。
- 專業影片同步、SMPTE、Dolby Atmos。
- 即時多人協作。
- 生成式歌聲與歌詞模型。
- 未經授權的商用 sample pack 內附。
