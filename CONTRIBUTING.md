# Contributing

## Branch

- `feat/<area>-<name>`
- `fix/<area>-<name>`
- `test/<area>-<name>`

## Pull Request 必填

- 問題與使用情境
- 變更範圍
- real-time safety 影響
- project schema 影響
- 測試命令與結果
- audio / UI evidence
- rollback

## Rust Style

- `unsafe` 預設禁止；必要時建立 ADR 與 safety comments。
- production code 不使用 `unwrap()` / `expect()`，測試可合理使用。
- 公開 API 有文件。
- DSP constants 命名並說明單位。

## TypeScript Style

- strict mode。
- 禁止 `any`，除非隔離在 adapter 並附註解。
- Tauri IPC 有 typed wrapper。
- Canvas event 與 project command 分離。

## Tests

Bug fix 先加入 regression test。效能變更附前後 benchmark，不能只寫「更快」。
