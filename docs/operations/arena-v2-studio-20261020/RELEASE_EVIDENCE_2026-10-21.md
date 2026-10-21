# DexDiffusion Studio V2 — release evidence (2026-10-21 UTC)

This is a source-grounded acceptance record for the V2 Studio repair. It does not override the original Arena execution prompt or claim complete beginner acceptance.

## Tests verified

- **E2:** Big Mac focused cancellation, source, Studio shell, native contract, publication recovery, jobs and workbench suite: **100 passed, zero failed** on the reviewed repair source. MacBook ran **84 passed, 16 skipped, zero failed** on the same subset because jsdom was missing from that local dependency tree.
- **E3:** Real Chromium-compatible browsers verified beginner launch, 14 module navigation, fixture generation and results, honest unverified cancellation behavior, exact Library-to-World/3D source identity, scroll/Advanced preservation, and capability-derived prelaunch noncancellation warnings in Voice and Music. A cross-host race in the final warning test was isolated to asynchronous workers fixture refresh and the test fixture was stabilized.
- **E4:** MacBook compiled a separate arm64 Swift WKWebView preview at port 31338. Its native window loaded Studio. An unsaved Create draft triggered a real AppKit confirmation sheet: Cancel retained the draft; Continue navigated to System; returning to Create retained the draft.
- **E5 real generation:** MacBook isolated server on port 31338 invoked Big Mac stable-diffusion.cpp. Job `a7e9513e-bf4c-482f-b7f4-39dacf879e8f`, run `20261020-223817-controlled-sd15`, finished PASS/exit 0 with one 512 × 512 PNG, SHA-256 `e50ffb7b786db61f6cc9133cc5bcc59ac5b63910e0fdbdc2a244624e46376b1e`. Heavy compute lease cleared, no quarantine. Test output was isolated from the user's canonical Library.
- **E5 real cancellation:** Separate job `83ad393d-2138-4f89-9cf3-a550a7486696`, run `20261020-224211-controlled-sd15`, was cancelled mid-run. API reported CANCELLED / verified remote stop; Big Mac process check showed zero surviving owned workers; lease cleared without quarantine.
- **Data preservation:** Original MacBook `main` contained pre-existing tracked edits and untracked documents, which were not overwritten during tests. The production runtime state, pre-cutover Dock preferences, and bundle metadata were backed up in `~/Library/Application Support/DexDiffusion/release-backups/v2-studio-20261020/`. Source rollback is possible using the original `4324dec` commit. Changes needed for historical publication recovery were incorporated into the repair branch.

## Not proven

- **E6:** Independent, unaided novice acceptance with real users has **not** occurred. Automated first-run browser tests do not replace this.
- **Full test suite:** Historical full-suite results included 88 baseline environment-related failures. The present session did **not** establish zero failures across the entire platform.
- Video and Swap execution remain explicitly gated rather than represented as implemented. Availability of optional workers depends on installed models and proven capabilities.
- The real SD1.5 8-step test took approximately three minutes. Performance is not certified.

## Production change guard

Only merge after final technical gate checks. Preserve source changes, the canonical image directory, workflow state, run history, original Dock state, and prior app bundle. Confirm no active or queued jobs before stopping old port 31337. After fast-forwarding `main`, rebuild the native app, confirm one Dock tile, verify native bundle source/root, API revision, live Library path, and resource health. If a cutover check fails, stop only project-owned new processes and restore without purging user data.
