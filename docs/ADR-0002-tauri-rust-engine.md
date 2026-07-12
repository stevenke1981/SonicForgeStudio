# ADR-0002：Tauri UI + Rust 音訊引擎

## 狀態

Proposed for formal implementation

## 決策

以 Tauri 2 承載 React / TypeScript UI；即時音訊、專案、渲染與 I/O 由 Rust crates 負責。

## 約束

- WebView 不執行音訊 callback。
- IPC 不用於逐 sample 或逐 frame 音訊資料。
- meter 與 transport position 降採樣後傳 UI。
- Canvas/WebGL 處理大量 notes / clips。

## 替代方案

- egui：Rust 單語言，但複雜編輯器元件與 Web 技術人才可用性較低。
- Qt/C++：成熟，但不是本專案的 Rust 優先方向。
- Electron：開發方便，但包體與權限面較大。
