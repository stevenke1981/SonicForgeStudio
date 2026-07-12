# 專案、預設與素材格式

## 1. 副檔名

- `.sfsproj`：SonicForge project package。
- `.sfspreset`：單一 device / recipe preset。
- `.sfsbank`：preset bank。

## 2. `.sfsproj`

建議為 ZIP container：

```text
project.sfsproj
  manifest.json
  project.json
  assets/
  presets/
  thumbnails/
  recovery/
```

一般儲存可選 external assets；portable package 才把素材複製進 `assets/`。

## 3. manifest.json

```json
{
  "format": "sonicforge-project",
  "schema_version": 1,
  "app_version": "0.1.0",
  "created_utc": "2026-07-13T00:00:00Z",
  "modified_utc": "2026-07-13T00:00:00Z",
  "project_file": "project.json",
  "asset_mode": "portable"
}
```

## 4. project.json 最小結構

```json
{
  "id": "project-uuid",
  "name": "Untitled",
  "sample_rate": 48000,
  "ppq": 960,
  "tempo_map": [{"tick": 0, "bpm": 120.0}],
  "time_signatures": [{"tick": 0, "numerator": 4, "denominator": 4}],
  "tracks": [],
  "patterns": [],
  "devices": [],
  "automation": [],
  "assets": []
}
```

## 5. Asset reference

```json
{
  "id": "asset-uuid",
  "kind": "audio",
  "path": "assets/kick.wav",
  "original_name": "kick.wav",
  "sha256": "...",
  "size": 123456,
  "channels": 2,
  "sample_rate": 48000
}
```

## 6. 安全

- 解壓縮前驗證所有 entry path。
- 拒絕 absolute path、drive prefix、UNC、`..` traversal。
- 限制總解壓縮大小、entry count 與 compression ratio。
- JSON 限制最大深度與最大檔案大小。
- binary plugin state 另設上限。

## 7. Migration

每一版 migration：

```rust
trait Migration {
    fn from_version(&self) -> u32;
    fn to_version(&self) -> u32;
    fn migrate(&self, value: serde_json::Value) -> Result<serde_json::Value, MigrationError>;
}
```

規則：

- 只向前 migration。
- migration 前保留備份。
- migration 必須 deterministic。
- 每版保留 golden files。

## 8. Preset

Preset 必須保存：

- device type ID
- device schema version
- parameter IDs，不依賴 UI 顯示名稱
- recipe seed（若適用）
- metadata：author、license、tags

未知參數：忽略並警告；必要參數遺失：使用 default。
