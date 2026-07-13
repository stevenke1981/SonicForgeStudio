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
