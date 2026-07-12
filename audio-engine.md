# 音訊引擎設計規格

## 1. Sample format

- 內部一律 `f32` planar buffers。
- I/O 邊界才轉 interleaved 或裝置格式。
- Master 限制到 finite range；匯出前依格式 dither。

## 2. Buffer model

```rust
pub struct AudioBlock<'a> {
    pub channels: &'a mut [&'a mut [f32]],
    pub frames: usize,
}
```

正式實作使用預先配置 buffer arena：

- 每 node 不自行 `Vec::new()`。
- Graph build 時計算最大 buffer 數。
- 可原地處理的 node 標記 in-place。

## 3. Transport

狀態：Stopped、Playing、Paused、Scrubbing、Rendering。

Stop 行為：

- position 回到 last start marker 或 0，可由設定決定。
- all notes off。
- reset tail 可選；預設效果 tail 仍可自然結束 100ms fade。

Seek 行為：

- 發送 all notes off。
- reset time-dependent nodes。
- 預讀新位置事件。
- 5–10ms crossfade，避免 click。

## 4. Voice engine

Voice fields：

- note、channel、velocity
- start sample
- state
- phase
- amp envelope
- filter envelope
- oscillator state
- smoothed parameters

Voice stealing：

1. 已 release 且最安靜。
2. 最舊 voice。
3. 若同 note retrigger，優先替換舊同 note。

## 5. 參數更新

參數分三類：

- Event rate：note、trigger。
- Block rate：preset、少量 UI 調整。
- Sample ramp：gain、cutoff、pan、automation。

禁止每 sample 透過 hash map 查參數。Graph build 時將 parameter ID 解析成 slot index。

## 6. 程序式音效

### Laser

- oscillator sweep
- harmonic layer
- noise burst
- pitch envelope
- amplitude envelope
- optional delay / distortion

### Explosion

- low-frequency sine burst
- multiple noise envelopes
- transient click
- filtered debris layer
- low rumble tail

### Whoosh

- band-passed noise
- center-frequency sweep
- stereo motion
- gain arch envelope

### Impact

- transient
- resonant modes
- body noise
- sub layer

所有 recipe 在 compile 後轉為一般 DSP graph，因此可 freeze、加入效果器或離線渲染。

## 7. Determinism

- Recipe PRNG 使用明確演算法與版本，例如 PCG32 v1。
- 不直接依賴平台預設 RNG。
- 浮點輸出允許同架構 bit-identical；跨架構以 tolerance 或 PCM hash version 管理。
- recipe 更新不得默默改舊專案；專案保存 recipe version。

## 8. Tail 與渲染

- Node 回報已知 tail samples，或 unknown。
- 自動 tail：連續 N blocks RMS 低於 threshold 後停止，並有 hard maximum。
- Reverb / delay feedback 需 bounded。
- 可取消 render；每數個 blocks 檢查 atomic cancel flag。

## 9. Meter

- Peak：block absolute max。
- RMS：平方平均。
- UI meter 30–60Hz。
- Clip latch 保存直到使用者清除或 3 秒。
- True peak 為 P1，使用 oversampling。

## 10. 低延遲 Windows

P0 使用 WASAPI Shared，部署容易。

P1 ASIO：

- 以 Cargo feature 隔離。
- 建置文件說明 SDK 與 Clang 需求。
- installer 不綁未授權驅動。
- 允許使用者在設定中選 host。

## 11. 安全失敗

- callback error：只寫 atomic code，控制執行緒再顯示訊息。
- node fault：該 node mute，保留其他 graph。
- xrun：統計並建議增加 buffer。
- device lost：停止 stream，不自動無限重試。
