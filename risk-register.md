# 風險登錄表

| ID | 風險 | 機率 | 影響 | 緩解 |
|---|---|---:|---:|---|
| R-01 | WebView UI 與音訊 IPC 過於頻繁 | 中 | 高 | UI 降採樣、批次命令、音訊狀態不逐 sample 傳送 |
| R-02 | Windows 裝置與 driver 差異 | 高 | 高 | WASAPI P0、診斷頁、裝置切換測試矩陣 |
| R-03 | ASIO 建置與授權複雜 | 中 | 中 | feature 隔離，不作預設發行必要條件 |
| R-04 | Rust plugin host 生態不成熟 | 高 | 高 | 延後 P2、獨立 process、先內建 device |
| R-05 | DSP aliasing / click | 中 | 高 | oversampling P1、parameter smoothing、品質測試 |
| R-06 | Project schema 太早固定 | 高 | 中 | versioned schema、migration、unknown fields |
| R-07 | 大型 Piano Roll UI 卡頓 | 中 | 高 | Canvas/WebGL、spatial index、viewport rendering |
| R-08 | 自動儲存造成檔案損壞 | 低 | 高 | journal、atomic rename、備份、故障注入測試 |
| R-09 | Factory samples 授權不明 | 中 | 高 | 只用自製/CC0，保存來源與授權 |
| R-10 | 功能範圍膨脹成完整 DAW | 高 | 高 | 里程碑 Gate、第一版 out-of-scope 固定 |
| R-11 | AI agent 誤標完成 | 高 | 中 | todo 證據制、Reviewer 與 Tester 分離 |
| R-12 | 即時執行緒意外 allocation | 中 | 高 | allocator instrumentation、callback tests、code review checklist |
