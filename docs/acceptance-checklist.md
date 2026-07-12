# 驗收 Checklist

## 功能

- [ ] 建立第一個音效不超過 10 分鐘。
- [ ] 建立 8 小節 loop 不超過 30 分鐘。
- [ ] 儲存與重開一致。
- [ ] WAV 可在至少三個播放器開啟。

## 即時音訊

- [ ] callback 無 allocation 證據。
- [ ] 10 分鐘 soak。
- [ ] device lost 可恢復。
- [ ] buffer 選項可用。

## 資料安全

- [ ] atomic save。
- [ ] autosave recovery。
- [ ] malformed project 不崩潰。
- [ ] zip traversal 測試。

## UI

- [ ] 鍵盤操作。
- [ ] 125/150/200% DPI。
- [ ] 1366×768。
- [ ] 錯誤訊息含代碼與處理方式。

## 發布

- [ ] installer。
- [ ] uninstall。
- [ ] SBOM。
- [ ] third-party notices。
- [ ] final.md 更新。
