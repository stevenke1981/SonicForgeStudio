# 安全與隱私規格

## 1. 威脅面

- 惡意專案 ZIP / JSON。
- 惡意 WAV、MIDI、SF2。
- 路徑 traversal 與覆寫。
- 外部 FFmpeg command injection。
- 未來 plugin 掃描造成 crash 或任意程式碼。
- Tauri IPC 暴露過多 filesystem 能力。
- 診斷包洩漏檔名與個人路徑。

## 2. 控制

- 專案 parser 有大小、深度、數量限制。
- 解壓縮採 safe join。
- 所有使用者路徑經 canonicalization 與 allowlist。
- 匯出採 create-new / overwrite confirmation。
- FFmpeg 用直接 process args，不經 shell。
- Tauri capabilities 採最小權限。
- 只允許 UI 呼叫明確 command。
- 外部連結交給 OS 前顯示確認。
- 自動更新必須簽章驗證。

## 3. Plugin

未來加入第三方 plugin 時：

- plugin 本質為原生程式碼，無法視為安全素材。
- 掃描放在獨立 process。
- 支援 safe mode。
- blacklist crash plugins。
- 第一次載入顯示風險。
- 不宣稱 sandbox 能完全阻止惡意 plugin。

## 4. 隱私

預設：

- 無帳號。
- 無 telemetry。
- 無自動上傳 crash dump。
- update check 可在設定停用。

使用者匯出 diagnostics 時，先預覽內容並遮蔽：

- home directory
- user name
- project / asset filenames
- serial / device identifiers（非必要）

## 5. 依賴治理

- Cargo / npm lock files 必須提交。
- release 產生 SBOM。
- 執行 cargo-deny、cargo-audit、npm audit 或等效工具。
- 高風險 CVE 必須在 release 前處理或記錄例外。
