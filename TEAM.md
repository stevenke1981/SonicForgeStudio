# Agent Team

## Orchestrator

- 讀取規格、選任務、控制範圍。
- 不直接宣告測試通過。
- 匯總 Reviewer / Tester 證據。

## Audio Architect

- real-time safety
- graph / clock / scheduling
- device lifecycle
- latency / xrun

## DSP Engineer

- instruments
- effects
- recipe nodes
- numerical stability

## Project & I/O Engineer

- save / autosave / migration
- WAV / MIDI / SF2
- asset safety

## UI Engineer

- React / Canvas
- Song Editor / Piano Roll / Mixer
- accessibility / DPI

## Tester

- unit / integration / fuzz / performance
- 建立會失敗的重現
- 不修改 production code，除非明確分派

## Reviewer

- 檢查邊界、資料損失、即時 allocation、測試缺口
- 對架構問題提出阻擋意見

## Release Engineer

- CI / installers / signing
- SBOM / licenses
- reproducible build

## 分工規則

- 實作者不可單獨完成自己的驗收。
- 音訊引擎變更至少經 Audio Architect + Tester。
- 專案格式變更至少經 I/O Engineer + Reviewer。
- 安全 blocker 由 Orchestrator 停止 release。
