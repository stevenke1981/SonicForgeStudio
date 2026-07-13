# Current delivery checkpoint

## Objective

Ship the post-0.1.0 realtime authoring slice: audible Project playback after installation, transport/DSP graph, MIDI, bounded recovery journal, Step Sequencer, undo/redo, signing gate, verified commit and push.

## Completed

- Project/audio/I/O crates and Tauri IPC implemented.
- Piano Roll, project controls, four locales and five starter templates implemented.
- Local NSIS installer rebuilt successfully after the integrated reviewer fixes.
- Release workflow reviewed with no remaining P0/P1/P2; GitHub `release-signing` Environment is tag-restricted.
- Reviewer P1 fixes for frontend project round-trip/IDs/save race and Rust device-lost/size/durable replace integrated.
- Realtime `GraphSnapshot`/`PlaybackEngine` and Tauri `transport_start/play/pause/stop` integrated; frontend Play now starts the real project graph.
- MIDI type 0/1, bounded checksummed recovery journal, Step Sequencer 1–64, 200-op history and signing scripts/workflow integrated.
- Local gates passed: workspace 41 Rust tests, Tauri 2 tests, frontend 28 Vitest tests, 28 Playwright tests, NSIS build, signing static checks.

## Pending

- The verified feature slice is committed and pushed to `main`; CI and remote parity are green.
- Do not create a release tag until protected Environment PFX secrets are supplied; actual Authenticode proof is externally blocked.

## Current blockers

- No local `signtool.exe` and no GitHub `release-signing` PFX secrets; signing workflow is intentionally fail-closed.

## Next exact action

Supply the protected release-signing PFX secrets, then create a version tag to exercise the fail-closed signed release workflow.
