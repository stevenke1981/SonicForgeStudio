# SonicForge Studio 開發包

SonicForge Studio 是一套以 Rust 為核心、面向 Windows / Linux / macOS 的桌面音效與音樂製作工具規格與可執行原型。產品方向類似「輕量 DAW + 虛擬樂器 + 程序式音效生成器」，但採乾淨室設計，不複製 LMMS 的程式碼、圖示、素材、商標或版面。

## 這個 ZIP 包含什麼

- 完整產品規格：`plan.md`、`spec.md`、`todos.md`、`test.md`、`final.md`
- 系統與音訊架構：`architecture.md`、`audio-engine.md`
- UI 與互動規格：`ui-design.md`
- 專案檔、預設檔與自動儲存格式：`project-format.md`
- 安全、授權、風險、發布與路線圖文件
- 可交給 Codex / OpenCode 的 `AGENTS.md`、`TEAM.md`、模型路由與任務提示詞
- 可編譯的純 Rust 音訊核心原型
- 可產生 WAV 的 CLI 示範程式
- 可重現的 Tauri 2 + React + TypeScript 桌面 GUI（`apps/desktop/`），含 Piano Roll、專案存取、即時音訊裝置設定、多語系與預設範本
- PowerShell / Bash 驗證腳本

`prototype/ui-mockup.html` 是早期資訊架構與視覺參考；正式可驗收 GUI 位於 `apps/desktop/`，並以 web preview 與 Tauri desktop shell 共用 React workspace。

## 建議正式技術棧

- 桌面框架：Tauri 2 + React + TypeScript
- 即時音訊 I/O：CPAL
- 音訊核心：獨立 Rust crates，不讓 WebView 進入即時音訊執行緒
- SoundFont：RustySynth（SF2）
- MIDI：midly 或自有事件層
- WAV：自有 writer 或 hound
- 解碼：Symphonia
- 重採樣：rubato
- 狀態管理：Zustand
- UI 測試：Vitest + Playwright
- Rust 測試：cargo test + clippy + fmt

> Rust workspace 已將 project model、`.sfsproj` I/O、CPAL 裝置控制與 DSP/render 邊界拆分成獨立 crates；SoundFont 與完整 transport graph 仍屬後續里程碑。

## 立即驗證

### Windows PowerShell

```powershell
Set-ExecutionPolicy -Scope Process Bypass
./scripts/check.ps1
cargo run -p sonicforge-cli -- demo ./artifacts/demo.wav
```

### Linux / macOS

```bash
chmod +x scripts/check.sh
./scripts/check.sh
cargo run -p sonicforge-cli -- demo ./artifacts/demo.wav
```

產生完成後，可播放 `artifacts/demo.wav`。

### Release build

Windows：

```powershell
pwsh -NoProfile -ExecutionPolicy Bypass -File ./scripts/build-release.ps1
```

Linux / macOS：

```bash
./scripts/build-release.sh
```

產物放在 `dist/`，包含 CLI binary 與 `SHA256SUMS.txt`。GitHub Actions 的 `v*` tag workflow 會建立 Windows、Ubuntu、macOS CLI 發布包、Windows NSIS installer 與 `SHA256SUMS`，並發布 GitHub Release。若 `release-signing` Environment 設有 PFX secrets，Windows installer 會套用 Authenticode；沒有憑證時會明確產生未簽章版本。

## 目前驗收狀態

- Rust M0 headless baseline：已通過，完整命令與 WAV / release evidence 見 `BUILD_VERIFICATION.md`。
- Desktop GUI：Piano Roll、專案 save/load/autosave、CPAL/WASAPI 裝置設定、100–200% DPI、自動化驗收、英文／繁中／日文／韓文與五個起始範本均已落地。完整 acceptance 見 `todos.md`、`final.md`、`BUILD_VERIFICATION.md`。
- Tauri command layer 負責檔案與音訊控制；real-time callback 只做預配置音訊運算，不讓 UI 直接持有 DSP node。

GUI slice 的驗收命令如下（Windows 本機使用 `corepack pnpm`）：

```text
corepack pnpm --dir apps/desktop install --frozen-lockfile
corepack pnpm --dir apps/desktop lint
corepack pnpm --dir apps/desktop typecheck
corepack pnpm --dir apps/desktop test
corepack pnpm --dir apps/desktop build
corepack pnpm --dir apps/desktop exec playwright test
Push-Location apps/desktop; cargo tauri build; Pop-Location
```

GUI 本機開發可使用：

```powershell
corepack pnpm --dir apps/desktop dev
Push-Location apps/desktop; cargo tauri dev; Pop-Location
```

## UI 原型

直接用瀏覽器開啟：

```text
prototype/ui-mockup.html
```

## 開工順序

1. 閱讀 `AGENTS.md`
2. 閱讀 `spec.md` 與 `architecture.md`
3. 從 `todos.md` 的 M0 開始；M0/M5 GUI 項目需完成 GVS criteria 與 evidence 後才能勾選
4. 每個里程碑執行 `scripts/check.ps1` 或 `scripts/check.sh`
5. 依 `test.md` 保存驗證證據
6. 只在 Gate 通過後勾選 todos

## 邊界

首版不包含：

- 完整 VST3 / AU / LV2 外掛主機
- 專業錄音室等級多軌錄音與 comping
- 自動產生完整人聲歌曲的生成式 AI 模型
- 雲端帳號、訂閱、素材商城

這些列入後續路線圖，避免第一版範圍失控。
