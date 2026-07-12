# Codex / OpenCode 模型路由

依使用者既定偏好：

## GPT-5.5 高

- 多步驟 build
- smoke test
- Playwright
- UI 驗證
- 跨 Rust / TypeScript 整合

## GPT-5.5 超高

只在以下情況：

- 任務反覆失敗
- 多檔案架構錯誤
- 測試持續無法通過
- 需要重新設計 workflow / audio graph

## GPT-5.4 高

- 一般 bug fix
- 一般 refactor
- 補單元測試
- DSP 單一 node 實作

## GPT-5.4-Mini 中

- 搜尋檔案
- 整理 todos
- 文件同步
- 小 UI 文案
- 建立測試資料與清單

## 配額策略

- 5.5：指揮、架構、驗收。
- 5.4：主要實作。
- 5.4-Mini：整理與小改。
- Reviewer 儘量使用不同模型或不同 session，降低同源盲點。
