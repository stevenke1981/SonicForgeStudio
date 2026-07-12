# 給 Codex 的第一個任務

你現在位於 SonicForge Studio 專案根目錄。

先閱讀：

1. AGENTS.md
2. spec.md
3. architecture.md
4. test.md
5. todos.md

任務：完成 M0 開發基線，不擴充功能。保留現有可編譯 Rust prototype，新增正式 crates 與 Tauri/React shell 時，確保每一步仍可 build。

要求：

- 每個專案檔案只放在本專案根目錄內。
- 不修改其他專案。
- 不使用刪除命令，除非先詢問。
- 建立 `artifacts/test-results/m0.md` 記錄命令與結果。
- 未通過 `cargo fmt/clippy/test` 與前端 lint/typecheck/test/build，不可勾選 M0。
- 遇到相同錯誤兩次，停止盲修並寫 root cause。
