# 給 OpenCode 的第一個任務

工作目標：依 AGENTS.md 的 Controlled Workflow 執行 SonicForge Studio M0。

執行流程：

1. 讀 spec / architecture / test / todos。
2. 列出 M0 acceptance criteria。
3. 保持 prototype 隨時可編譯。
4. 建立正式 workspace 與 Tauri 2 + React shell。
5. 建立 CI 與驗證腳本。
6. 執行所有 Gate。
7. 將結果寫入 artifacts/test-results/m0.md。
8. 只有成功項目才能更新 todos。

權限：正常 build、run、讀檔、寫檔、測試可直接執行。刪除命令與 git push --force 必須詢問。
