# ADR-0001：採乾淨室功能設計

## 狀態

Accepted

## 決策

SonicForge Studio 只參考一般 DAW / 音效工具的功能概念，不複製 LMMS 或其他產品的程式碼、素材、圖示、商標、版面細節、專案格式或預設。

## 原因

- 降低授權與商標風險。
- 允許建立更適合 SFX Lab 的資訊架構。
- 保持可自由選擇授權。

## 後果

- 必須自行定義 project schema。
- 所有 factory presets / samples 都要建立來源記錄。
- UI review 需檢查是否過度近似特定產品。
