# UI / UX 設計規格

## 1. 設計方向

- 深色工作站介面，讓波形、音符與 meter 清楚。
- 不仿製 LMMS 的排列、圖示或配色。
- 核心模式切換：`Music`、`SFX Lab`、`Mixer`。
- 初學者可用 preset 與 macro；進階使用者可展開完整參數。

## 2. 主畫面

```text
┌─────────────────────────────────────────────────────────────────────────┐
│ Menu | Project | Undo | Transport | BPM | Time | CPU | Audio Device     │
├───────────────┬────────────────────────────────────────┬────────────────┤
│ Browser       │ Song Editor / Piano Roll / SFX Lab    │ Inspector      │
│ Instruments   │                                        │ Device params  │
│ Effects       │                                        │ Clip params    │
│ Samples       │                                        │ Track params   │
│ Presets       │                                        │                │
├───────────────┴────────────────────────────────────────┴────────────────┤
│ Mixer / Automation / Event List                                         │
└─────────────────────────────────────────────────────────────────────────┘
```

## 3. SFX Lab

左側：recipe categories。

中間：

- 大型預聽按鈕。
- 音效波形。
- Macro knobs：Character、Pitch、Body、Noise、Space、Length。
- Advanced 展開實際參數。

右側：

- Seed。
- Randomize。
- Lock toggles。
- Variant count。
- Peak target。
- File naming template。
- Freeze to Track。
- Export Batch。

## 4. Song Editor

- Track header 寬度可調。
- Clip 類型以形狀與 icon 區分，不只靠顏色。
- Playhead 與 loop region 清楚。
- Drag 時顯示 tick、bar、time。
- 右鍵選單與 command palette 同步。

## 5. Piano Roll

工具：Select、Draw、Erase、Split、Mute。

快捷鍵建議：

- Space：Play / pause
- Home：回到開始
- Ctrl+S：Save
- Ctrl+Z / Ctrl+Shift+Z：Undo / redo
- D：Draw
- S：Select
- E：Erase
- Q：Quantize
- Ctrl+D：Duplicate
- Alt+drag：copy
- Shift：暫時取消 snap

## 6. Mixer

每 channel：

- name / icon
- inserts
- send controls
- peak / RMS meter
- gain fader
- pan
- mute / solo

窄畫面以橫向 scroll，不壓縮到不可讀。

## 7. 新手流程

首次啟動：

1. 偵測輸出裝置。
2. 播放測試音。
3. 選擇用途：音效、音樂、兩者。
4. 顯示對應 starter template。
5. 提示儲存位置與 autosave。

## 8. 錯誤呈現

錯誤對話框包含：

- 人類可讀描述。
- 錯誤碼。
- 建議下一步。
- 複製診斷。
- 不顯示 Rust backtrace 給一般使用者。

## 9. 效能顯示

右上角簡化為：

- DSP：百分比
- XRUN：計數
- Buffer：frames

點擊後開啟完整 diagnostics。

## 10. Prototype

本包 `prototype/ui-mockup.html` 為靜態視覺原型，用來確認資訊架構，不代表最終 UI framework 或 pixel-perfect 設計。
