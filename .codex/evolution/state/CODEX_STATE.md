# Current delivery checkpoint

## Objective

Ship SonicForge Studio 0.1.0 with multilingual desktop GUI, Piano Roll, schema-v1 project persistence, real-time audio-device control, DPI coverage, templates, NSIS release workflow, verified Git commit/push and GitHub Release.

## Completed

- Project/audio/I/O crates and Tauri IPC implemented.
- Piano Roll, project controls, four locales and five starter templates implemented.
- Local NSIS installer built once; final rebuild is pending integrated reviewer fixes.
- Release workflow reviewed with no remaining P0/P1/P2; GitHub `release-signing` Environment is tag-restricted.
- Reviewer P1 fixes for frontend project round-trip/IDs/save race and Rust device-lost/size/durable replace integrated.

## Pending

- Commit by intent, push `main`, wait for CI, tag `v0.1.0`, wait for Release and verify remote parity/assets.

## Current blockers

- None. Windows signing secrets are absent by design, so the release installer will be unsigned and reported as such.

## Next exact action

Review the final diff, commit by intent, push `main`, wait for CI, then tag and verify the GitHub Release assets.
