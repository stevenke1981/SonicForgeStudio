# Third-party notices planning

本原型程式碼目前只使用 Rust standard library。

正式版預計評估的依賴：

- Tauri 2：依其官方授權。
- React / TypeScript：依各自授權。
- CPAL：依 crate / repository 授權。
- RustySynth：依 repository 授權。
- Symphonia、rubato、midly、serde、zip 等：逐一由 `cargo-deny` 驗證。

加入依賴前必須：

1. 確認 SPDX license。
2. 確認可否靜態連結與重新散布。
3. 更新 SBOM。
4. 保留 copyright / notices。
5. 對 VST3 / ASIO SDK 另做法律與發行評估。

Factory samples 與 SoundFont 不因程式碼授權自動獲得散布權，必須個別記錄。
