# 專案、預設與素材格式

## 1. 副檔名

- `.sfsproj`：SonicForge project package。
- `.sfspreset`：單一 device / recipe preset。
- `.sfsbank`：preset bank。

## 2. `.sfsproj`

v0.1.0 採受限 ZIP container；目前只允許下列兩個 entry，其他 entry 會拒絕：

```text
project.sfsproj
  manifest.json
  project.json
```

每個 entry 上限 8 MiB、總解壓縮上限 16 MiB、entry 數上限 32。素材目前以安全的相對 reference 記錄；把實體素材封裝進 `assets/`、preset、thumbnail 與 recovery journal 是後續格式版本，加入時必須提升 schema 並提供 migration/golden test。

## 3. manifest.json

```json
{
  "format": "SonicForge Studio Project",
  "schemaVersion": 1,
  "projectFile": "project.json",
  "modifiedUtc": "2026-07-13T00:00:00Z"
}
```

## 4. project.json 最小結構

```json
{
  "id": "project-uuid",
  "name": "Untitled",
  "schemaVersion": 1,
  "sampleRate": 48000,
  "ppq": 960,
  "bpm": 120.0,
  "tempoMap": [{"tick": 0, "bpm": 120.0}],
  "timeSignatures": [{"tick": 0, "numerator": 4, "denominator": 4}],
  "tracks": [],
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
- writer 與 reader 使用相同大小限制，禁止產生「可存但不可重開」的 package。
- 同目錄 temporary file 完成 flush/sync 後才取代目的檔；失敗時保留原檔。

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
