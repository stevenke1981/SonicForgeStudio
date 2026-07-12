# AGENTS.md — SonicForge Studio

所有 Codex / OpenCode agents 必須遵守。

## 1. 任務開始

1. 讀 `spec.md`。
2. 讀 `architecture.md` 與相關文件。
3. 在 `todos.md` 找到唯一工作項。
4. 寫出 acceptance criteria 與預計驗證命令。
5. 不得在未理解 audio real-time boundary 前修改引擎。

## 2. 必須保持的邊界

- Audio callback：不配置、不 blocking、不 I/O、不 panic。
- UI 不持有或直接修改 DSP node。
- Project model 不依賴 Tauri / React。
- 即時與離線 DSP 不得分叉成兩套邏輯。
- 任何格式變更需 migration 與 golden test。
- 不複製 LMMS 程式碼、素材、圖示、名稱或 UI。

## 3. Controlled Workflow

### Gate A — Spec

- 功能需求清楚。
- 失敗行為清楚。
- real-time / filesystem / security 影響已評估。

### Gate B — Implement

- 最小變更。
- 不做未要求重構。
- 無 placeholder 假裝完成。

### Gate C — Verify

至少執行：

```bash
cargo fmt --all --check
cargo clippy --workspace --all-targets -- -D warnings
cargo test --workspace
```

有 UI 變更再執行：

```bash
pnpm lint
pnpm typecheck
pnpm test
pnpm build
pnpm playwright test
```

### Gate D — Evidence

- 列出命令與結果。
- 保存必要 screenshot / WAV / benchmark。
- 更新 todos 與 final。

## 4. 刪除與危險操作

以下必須先詢問使用者：

- `rm`、`rmdir`、`del`、`delete` 或等效刪除。
- `git push --force`。
- 清除未提交變更。
- 刪除 migration、golden files、使用者素材。

其他正常讀檔、build、test、建立檔案可直接進行。

## 5. Fail Classes

- F1 Compile：先修最小編譯錯誤。
- F2 Unit：定位最小 failing test。
- F3 Integration：保存重現專案與 log。
- F4 Audio glitch：記錄 device/sample rate/buffer/callback stats。
- F5 Architecture：停止疊補丁，提出 ADR。
- F6 Data loss / security：立即視為 blocker。

相同錯誤連續兩次修正失敗，升級 Reviewer；三次失敗，重新檢查設計，不得盲目重試。

## 6. 完成定義

不是「程式已寫」，而是：

- acceptance criteria 滿足。
- tests 通過。
- 無新增 warnings。
- 文件更新。
- 有證據。
- rollback 清楚。

## 7. Commit 建議

- `feat(audio): ...`
- `feat(sfx): ...`
- `feat(ui): ...`
- `fix(render): ...`
- `test(dsp): ...`
- `docs(spec): ...`

一個 commit 一個意圖。
