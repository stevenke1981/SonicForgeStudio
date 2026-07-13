# SonicForge Studio — 測試與驗收規格

## 1. 測試原則

- 測試必須可重現。
- 即時音訊問題需保存裝置、sample rate、buffer、callback 統計。
- 不以「聽起來正常」取代數值與檔案證據。
- 聽覺測試可作為補充，不是唯一 Gate。
- 每個修正必須先加入會失敗的測試或重現腳本。

## 2. 必跑命令

```bash
cargo fmt --all --check
cargo clippy --workspace --all-targets -- -D warnings
cargo test --workspace
cargo run -p sonicforge-cli -- demo artifacts/demo.wav
```

正式前端加入後：

```bash
pnpm install --frozen-lockfile
pnpm lint
pnpm typecheck
pnpm test
pnpm build
pnpm playwright test
```

Tauri desktop crate 為獨立 workspace，亦為必要 Gate：

```bash
cargo fmt --manifest-path apps/desktop/src-tauri/Cargo.toml -- --check
cargo clippy --manifest-path apps/desktop/src-tauri/Cargo.toml --all-targets -- -D warnings
cargo test --manifest-path apps/desktop/src-tauri/Cargo.toml
cargo tauri build --bundles nsis
```

Release 前另須驗證 `.sfsproj` save/load deep round-trip、範本載入後 ID 唯一性、儲存競態 dirty flag、四種語系、DPR 與 UI scale 100/125/150/200% 的獨立組合，以及 installer SHA-256 / Authenticode 狀態。

本輪新增的實作驗收：

### SFX／Mixer／transport completion／export（2026-07-14）

- Rust workspace fmt、Clippy `-D warnings`、59 tests 通過；audio 26 tests 包含 non-loop auto-stop、loop duration clamp、coherent transport publication、每 256-frame quantum 最多 256 個 note events，以及不同 callback buffer 邊界的 dense-event parity。
- Tauri fmt、Clippy `-D warnings`、5 tests 通過；WAV helper 產生非靜音 PCM16 stereo，拒絕空 graph、path traversal、Windows device names 與既有同名輸出，並以序列化 worker、唯一 temporary、`sync_all`、no-clobber hard link 完成。
- Frontend lint、typecheck、production build 與 49 個 Vitest tests 通過；新增五個 recipe Preview／Stop、Mixer transport、WAV export 與 user-named Save As 驗收。
- Playwright 36/36 通過：DPI/UI scale 100/125/150/200% 均走過 SFX、Mixer、Save As、WAV export、九個 templates、四語系及播放頭；另以 DPI 125% 重複測試確認工具列不重疊。
- NSIS release build 通過；installer 2,326,326 bytes，SHA-256 `FAFE71E7B29C6B97C5EEB9F12145327C7B80BB61110C97D33E6793EB5B5C7881`，Authenticode `NotSigned`。

- `cargo test --workspace`：54 個 Rust tests 通過，包含 realtime graph、transport、offline/realtime parity、MIDI golden、malformed MIDI、journal checkpoint/tail recovery。
- `cargo clippy --workspace --all-targets -- -D warnings`：通過。
- `cargo fmt --all --check` 與 `apps/desktop/src-tauri` 獨立 fmt：通過。
- `corepack pnpm lint`、`typecheck`、`test`：通過；Vitest 42 tests。
- `corepack pnpm build`：通過。
- `corepack pnpm playwright test`：32 tests 通過，涵蓋 100/125/150/200% UI scale、四語系、Step Sequencer、Piano Roll、Project/audio controls。
- `cargo tauri build --bundles nsis`：通過，產生 `SonicForge Studio_0.1.0_x64-setup.exe`；本機未簽章，因未提供 PFX / signtool。
- `powershell -NoProfile -ExecutionPolicy Bypass -File scripts/sign-windows.tests.ps1`：static signing checks 通過；真實簽章僅能在受保護 GitHub Environment 執行。

### Factory instruments / movable playhead（2026-07-13）

- 音訊單元測試逐一建立 9 種單一音色與 drum-kit composite，驗證輸出 finite、非靜音且不同 preset 不產生相同 buffer。
- Drum Kit 驗證 MIDI 36=Kick、38/40=Snare、42/44/46=Hi-Hat；其他 note 使用可發聲 fallback。
- Project device ID 使用 schema-safe `instrument-<track-id>`；讀取端保留舊 `instrument:<track-id>` 相容。
- GUI 驗證選擇器列出 10 種樂器、新增軌道附可播放 pattern、Inspector 可切換音色並保存 device kind。
- 播放頭驗證 pointer seek、Arrow/Home/End 與播放期間 backend sample position 回報；在 UI scale 100/125/150/200% 分別執行。
- 本機結果：Rust workspace 54 tests、Tauri 2 tests、Vitest 42 tests、Playwright 32 tests，全數通過。
- 追加 transport 競態反例：同一 callback 前 stop→play、play→stop、seek→stop、stop→seek 均保留順序，queue full 明確回錯。
- 追加 percussion seek parity：Kick／Snare／Hi-Hat 的 continuous render 與 seeked render 尾段逐 sample 相等；position poll 會將 stream failure 轉成 deviceLost。
- 追加 GUI 反例：project/device sample rate 不同、factory parameters round-trip、選取軌道 editor 綁定、播放中換音色停止舊 graph、150/200% Inspector 與 modal focus。
- 追加 Step Sequencer 資料安全反例：變更單一步驟保留旋律音高、和弦與第一小節後音符；16→64 steps 只改解析度，不移動或替換既有 notes。
- 追加 callback deadline／seek history 反例：多 producer queue、每 callback 固定 command 上限、consumer state publication、100,000-note sparse seek checkpoint，以及「64 長音被後續短音偷聲後 seek 不得復活」的 continuous parity。

## 3. 單元測試

### 時間與節拍

- BPM 20、120、400 的 tick/sample 互轉。
- 44.1kHz、48kHz、96kHz。
- 長度 24 小時不 overflow。
- Tempo map 邊界連續。
- Loop end 採 exclusive 定義。

### DSP

- silence in → finite silence out。
- bounded input 不產生 NaN / Inf。
- bypass 差異小於容許值。
- filter cutoff 接近 Nyquist 時穩定。
- compressor ratio / threshold 邊界。
- delay feedback 永遠 clamp 在安全範圍。
- envelope 不跳負值。

### 合成器

- note on/off voice 狀態。
- voice stealing 可預測。
- 同 seed 產生相同 samples。
- 不同 seed 產生不同輸出。
- oscillator phase 長時間不溢位。

### 專案資料

- serde round trip。
- unknown optional field 可忽略。
- unknown required version 拒絕並給錯誤碼。
- Unicode 路徑。
- relative path 正規化，不允許逃離 package root。

## 4. 整合測試

### IT-001 新建至匯出

1. 建立專案。
2. 新增 synth track。
3. 新增 4 個音符。
4. 加入 delay。
5. 匯出 2 秒 WAV。

驗收：

- WAV header 正確。
- channels、sample rate、frame count 正確。
- peak 在 -18 至 -0.1 dBFS。
- 檔案非全靜音。

### IT-002 音效 recipe

1. 選擇 Laser。
2. seed = 42。
3. 匯出兩次。
4. 比較 PCM hash。

驗收：hash 完全相同。

### IT-003 批次變體

- 產生 32 個 explosion variants。
- 檔名不可碰撞。
- 每個檔案可解碼。
- peak 不超過設定上限。

### IT-004 自動儲存復原

1. 建立未儲存變更。
2. 觸發 autosave。
3. 強制終止 process。
4. 重啟。

驗收：顯示 recovery，還原最後 journal。

### IT-005 素材遺失

- 移動 sample 或 SF2。
- 開啟專案。

驗收：不崩潰；列出遺失素材；可重新定位。

### IT-006 裝置中斷

- 播放中停用音訊裝置。

驗收：transport 安全停止；顯示 `SF-AUDIO-003`；可重新選裝置。

## 5. UI 測試

### UI-001 首次啟動

- 選擇輸出裝置。
- 測試音按鈕。
- 完成後進入主畫面。

### UI-002 Piano Roll

- 建立、拖動、縮放、刪除音符。
- undo / redo。
- 量化。

驗收：畫面與 engine state 一致。

### UI-003 Song Editor

- 新增軌道。
- 拖曳 clip。
- split、duplicate。
- loop playback。

### UI-004 音效模式

- 選 recipe。
- 調 macro。
- lock 參數。
- randomize。
- freeze。
- batch export。

### UI-005 鍵盤與 DPI

- Tab 順序。
- 100%、125%、150%、200%。
- 1366×768 最小工作區仍可操作。

## 6. 效能測試

### PERF-001 即時負載

條件：

- 48kHz
- 256 frames
- 16 instrument tracks
- 總計 128 synth voices
- 每軌 filter + delay

驗收：

- callback p99 < deadline 70%
- 10 分鐘 xrun <= 3；發布版目標 0
- UI 不長時間 freeze

### PERF-002 大型 Piano Roll

- 100,000 notes。
- 縮放與捲動。

驗收：

- 可見區域採虛擬化。
- 一般互動 p95 < 100ms。

### PERF-003 記憶體

- 連續播放與編輯 60 分鐘。

驗收：

- 無線性成長。
- stop 後 temporary render buffers 釋放。

## 7. 聲音品質測試

- 1kHz sine：頻率誤差與 THD 基線。
- impulse：檢查效果器延遲與 tail。
- swept sine：filter response。
- null test：bypass 與原訊號。
- aliasing check：高頻 saw，保存頻譜圖。
- click test：note、bypass、parameter change 不可出現異常脈衝。

## 8. 安全與健壯性

- Project JSON fuzz 10,000 cases。
- WAV / MIDI malformed corpus。
- Zip slip 測試。
- 超大檔案與宣稱錯誤尺寸。
- 路徑包含 `..`、UNC、長路徑、emoji、中文。
- Tauri command 僅暴露 allowlist。
- FFmpeg adapter 使用 argument array，不使用 shell string。

## 9. 發布 Gate

### Blocker

- 資料損毀。
- 未授權素材。
- 任意路徑寫入。
- 即時播放常態爆音或崩潰。
- installer 無法移除。

### Critical

- 自動儲存無法復原。
- 主要匯出格式錯誤。
- 專案無法重新開啟。
- 預設裝置啟動失敗且無替代流程。

### Release 條件

- Blocker = 0。
- Critical = 0。
- P0 tests = 100%。
- P1 tests >= 95%，其餘有已知問題與 workaround。
- 授權報告與 SBOM 完成。
- `final.md` 附 evidence 路徑。

## 10. 證據目錄

```text
artifacts/
  test-results/
  screenshots/
  audio/
  performance/
  logs/
  sbom/
```
