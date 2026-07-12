# SonicForge Studio — 開發計畫

## 1. 專案目標

建立一套可在 Windows、Linux 與 macOS 執行的桌面應用程式，讓使用者能：

1. 使用時間軸、鋼琴捲軸與鼓步進器編曲。
2. 使用內建虛擬樂器產生旋律、和弦、低音與鼓聲。
3. 以程序式參數快速產生雷射、爆炸、whoosh、UI 提示音、腳步、環境底噪等音效。
4. 載入樣本與 SoundFont 樂器。
5. 使用效果器、混音器與自動化軌完成基本後製。
6. 匯出 WAV；後續可選擇透過 FFmpeg 匯出 FLAC、OGG、MP3。
7. 讓 Codex / OpenCode 能依明確 Gate 自動開發、測試、修正與交付。

## 2. 產品定位

不是複製現有 DAW，而是打造「比一般 DAW 更容易產生遊戲／影片音效，又保留基本編曲能力」的輕量工作站。

核心差異：

- 音樂模式：時間軸、Pattern、Piano Roll、Mixer。
- 音效模式：配方、隨機種子、參數巨集、批次變體。
- 共用引擎：同一套合成、效果器與離線渲染。
- 非破壞式：原素材保持不變，編輯以事件與參數保存。

## 3. 平台與優先順序

### P0

- Windows 10/11 x64
- WASAPI Shared
- 44.1kHz / 48kHz
- 2 聲道輸出

### P1

- Windows ASIO（選配建置）
- Linux ALSA / JACK
- macOS CoreAudio
- MIDI 鍵盤輸入

### P2

- VST3 / LV2 / AU 外掛主機
- 多聲道與 sidechain
- 雲端協作

## 4. 技術策略

### 前端

- Tauri 2
- React + TypeScript
- Canvas 或 WebGL 繪製 Piano Roll、波形與自動化曲線
- Zustand 管理 UI 狀態
- UI 不直接處理即時聲音

### Rust 後端

拆成工作區：

- `sonicforge-core`：專案資料模型與操作命令
- `sonicforge-audio`：即時音訊圖、transport、buffer、clock
- `sonicforge-dsp`：振盪器、包絡、濾波器、效果器
- `sonicforge-render`：離線渲染與匯出
- `sonicforge-io`：MIDI、WAV、SoundFont、專案封裝
- `sonicforge-app`：Tauri 命令、事件與權限邊界

### 執行緒

- Audio thread：禁止配置記憶體、禁止鎖 mutex、禁止磁碟 I/O、禁止日誌格式化。
- Control thread：建立圖、載入素材、更新參數快照。
- Render worker：離線匯出，可使用多執行緒。
- UI thread：只顯示與發送命令。

## 5. 里程碑

### M0 — 開發基線

交付：

- Cargo workspace
- TypeScript 專案
- CI、格式化、lint、測試命令
- ADR、錯誤類型、日誌規範
- 可產生一個 WAV 的 headless smoke test

退出條件：

- `cargo test --workspace` 通過
- `cargo fmt --check` 通過
- `cargo clippy --workspace --all-targets -- -D warnings` 通過
- 前端 build 與 unit tests 通過

### M1 — 音訊核心

交付：

- Transport：play / pause / stop / seek / loop
- Sample clock 與 BPM / PPQ 轉換
- 基本 node graph
- Master gain、limiter 防爆音
- 離線與即時路徑使用同一 DSP

退出條件：

- 10 分鐘播放無崩潰
- 48kHz、256 frames 下無持續 underrun
- 離線渲染 deterministic

### M2 — 內建樂器與音效

交付：

- Subtractive Synth
- Drum Sampler
- SF2 Player
- 程序式音效配方：laser、explosion、whoosh、click、notification、wind/rain ambience
- 預設儲存與隨機種子

退出條件：

- 每個樂器至少 10 個 factory presets
- 相同 seed 與參數輸出相同 hash
- 每個配方可批次產生 1–32 個變體

### M3 — 編曲介面

交付：

- Song Editor
- Pattern / Step Sequencer
- Piano Roll
- Browser
- Inspector
- 基本 Mixer
- Undo / Redo

退出條件：

- 使用滑鼠完成 8 小節鼓＋貝斯＋旋律
- 儲存、重開後內容一致
- 2000 notes 操作保持可用

### M4 — 效果器與自動化

交付：

- Gain / Pan
- Filter
- EQ
- Compressor
- Delay
- Algorithmic Reverb
- Automation lanes
- Send bus

退出條件：

- 所有參數可自動化
- 無 NaN / Inf 流入 master
- bypass 不產生可聽爆音

### M5 — 匯入、匯出與復原

交付：

- WAV import/export
- MIDI import/export
- SF2 import
- 自動儲存與 crash recovery
- portable project package

退出條件：

- 15 分鐘專案可正確匯出
- 損壞專案顯示可行錯誤，而非崩潰
- 自動儲存可從強制終止復原

### M6 — 發布候選版

交付：

- Windows installer
- Linux AppImage / deb（擇一先行）
- macOS bundle（若有簽章環境）
- 首次啟動精靈
- 效能診斷頁
- 使用手冊

退出條件：

- test.md 的 P0/P1 全數通過
- 無 blocker / critical issue
- 授權清單完整
- 可重現建置

## 6. 估算方式

不以日期硬估，而以 Gate 估算。每個功能拆成：

- Spec
- Implementation
- Unit test
- Integration test
- UI test
- Performance evidence
- Documentation

未附證據不得標示完成。

## 7. 變更管理

任何新增功能必須：

1. 說明使用情境。
2. 指定資料格式與 API。
3. 定義 real-time safety。
4. 補測試與效能預算。
5. 更新 `todos.md`、`spec.md` 與 `final.md`。

## 8. 成功指標

- 新使用者 10 分鐘內做出第一個可匯出的音效。
- 30 分鐘內做出 8 小節完整 loop。
- 典型專案啟動時間小於 3 秒（排除首次掃描素材）。
- 一般操作不因離線匯出而凍結 UI。
- 專案格式具版本遷移能力。
