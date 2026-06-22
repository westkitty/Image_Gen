# Image_Gen AI Context Lock

Date: 2026-06-22

This file is the durable operating boundary for future Codex passes in this repo.
It exists to stop the same release facts from drifting.

## Canonical repo facts

- Workspace root: `/Users/andrew/Image_Gen`
- Canonical model home: `/Volumes/wc2tb/ImageGen`
- Runtime bridge: `operator-console/server.js`
- Native wrapper installer: `scripts/install-macos-app.sh`
- Native wrapper output: `/Applications/Image_Gen.app`
- Clean source packager: `scripts/package-source.sh`

## Hard boundaries

- Do not add new model features unless the request explicitly asks for them.
- Do not introduce Flux or SDXL Turbo support by implication.
- Do not move model files, download models, or rewrite external-drive layout.
- Do not commit runtime outputs, caches, screenshots, package archives, or server logs.
- Do not touch `node_modules/`, `runs/`, `state/`, `logs/`, `Potential UI/`, `__MACOSX/`, or
  generated proof blobs.
- Keep Express bound to localhost only.

## Library / run history truth (updated 2026-06-22, Entries 25–36)

- `GET /api/run-index` returns paginated results (`limit`, `offset`, `filter`; default 50/page, max 200) with `filterCategory` and `controlledTargetLabel` per entry. Unknown filter → 400.
- `GET /api/runs/:runId/metadata` returns all manifest types under `manifests`, plus `run_type`, `status`, `created_at`, `primary_image`, `first_failed_gate`, `filter_category`, `controlled_target_label`, `controlled_target_caveat`, `prompt_private`, and a `replay` object.
- `replay` object: `{ available, target, width, height, steps, cfg_scale, seed, prompt_saved, prompt, negative_prompt, privacy_note, flux_caveat }`. `available` is true only for controlled runs with a valid manifest and allowlisted target. Target is always from the closed allowlist (`sd15`, `sdxl-base`, `sdxl-turbo`, `flux-fp8`). Prompts are null for redacted runs; `prompt` and `negative_prompt` are set for save_prompts=true runs.
- The Library screen has a filter bar (filter-aware empty states), paginated run cards (50/page) with Load More, a full detail overlay, a full-size image viewer/lightbox, and a "Reuse in Create" button for controlled runs. Detail overlay shows "🔒 Prompt redacted" or "📋 Prompt saved" correctly per run. FAIL runs always show a failure block (with gate or generic message). "Send to Upscale" is disabled when no primary image exists. "Copy settings JSON" exports generation params with prompt privacy.
- The Library screen has a controlled-run comparison view for 2-4 selected controlled runs. It reads existing `GET /api/runs/:runId/metadata` results only, shows side-by-side image/status/target/size/steps/CFG/seed/privacy cards, copies a privacy-respecting comparison summary, and explicitly does not claim full A1111 parity.
- The Create screen has a collapsible "Import / paste settings JSON" block (id=settings-import-input). `loadSettingsJson()` validates against a closed key allowlist and the four-target allowlist; blocks modelPath/checkpoint/lora/vae/controlnet and unknown keys; accepts target/width/height/steps/cfg_scale/seed/prompt/negative_prompt. Two buttons: Load into Create (from textarea) and Paste from clipboard. No auto-submit.
- When a controlled generation job finishes with FAIL or ERROR, `pollJob()` appends the first failed gate to the job status card and shows a Retry button that re-submits `state.lastParams` via generate-controlled. The button disables itself on click to prevent double-submit.
- `replayInCreate()` appends a note showing the restored seed value and instructs users to click "Random seed" to vary output.
- The Create screen has a "Controlled sweep planner" collapsible block. Supports seed sweep (N jobs, 2–8, optional start seed) and CFG scale sweep (comma-separated values, 2–8, each 0–30). Target validated against `SWEEP_TARGET_ALLOWLIST` (same 4-target closed set). Jobs run sequentially. Inherits all generate-controlled server validators. No model path, no LoRA/VAE/ControlNet, not full XYZ plot parity.
- Both prompt and negative prompt fields show live character count and rough token estimate (~chars/4, labeled approx, local heuristic only).
- Prompt privacy: `prompt_private` is derived from `manifest.prompt_redacted` for controlled runs (authoritative). For save_prompts=false runs: `prompt_private=true`, replay prompt null, privacy note shown. For save_prompts=true runs: `prompt_private=false`, replay prompt set, "Reuse in Create" fills the prompt field. Default is always save_prompts=false.
- `filter_category` and `run_type` in the metadata endpoint now fall back to directory-name inference when `ui-run-card.md` is absent or has no `run_type` field, making them consistent with run-index for UNKNOWN/incomplete runs.

## Current truth to preserve

- SDXL base, SDXL Turbo, and Flux each have bounded proof-only smoke paths.
- `POST /api/actions/sdxl-smoke`, `POST /api/actions/sdxl-turbo-smoke`, and `POST /api/actions/flux-smoke` are proof-only and do not mean full Automatic1111 parity.
- Flux proof uses `/Volumes/wc2tb/ImageGen/flux/flux1-schnell/flux1-schnell-fp8.safetensors`; the full `/Volumes/wc2tb/ImageGen/flux/flux1-schnell/flux1-schnell.safetensors` file was acquired but is not the runtime-proven file.
- `POST /api/actions/generate-controlled` now exposes a closed allowlist for SD1.5 standard, SDXL base, SDXL Turbo, and Flux fp8 only; it uses fixed proofed model behavior and does not imply arbitrary checkpoint switching.
- SD1.5 controlled generation uses the proven server-tunnel path through `sdcpp-server-generate.sh` and the active local tunnel (`127.0.0.1:17870` when `current-ports.env` says so). The browser Create form may send normal UI fields (`preset`, `model`, `api`, `sampler`, etc.); the backend tolerates those only as controlled-form fields and still rejects arbitrary path/model overrides such as `modelPath` and `checkpoint_path`.
- `GET /api/version` is the stale-server marker endpoint. Check it before trusting a long-running local console.
- `/Applications/Image_Gen.app` is the real macOS Dock wrapper built from `native/macos/Image_Gen/ImageGenApp.swift`. It uses AppKit + WKWebView, verifies or starts the local operator console, checks the existing BigMac tunnel scripts, and keeps browser opening as a fallback menu item only.
- `POST /api/actions/generate-controlled` is positively proven through the Create selector and job polling for the closed allowlist; Flux 512x512 can hit Metal out-of-memory on this hardware, so Flux proof remains bounded to smaller accepted sizes.
- When `save_prompts` is false, controlled runs strip PNG metadata as well as redacting manifests and logs, so prompt privacy applies to the saved image files too.
- Proof-only support does not mean full Automatic1111 parity.
- `scripts/package-source.sh` packages `git archive HEAD` and refuses dirty trees by default.
- `sdcpp-workflow/bin/sdcpp-model-stage-check.sh` must preserve the SDXL smoke proof cache.
- Model files, runtime runs, smoke caches, logs, screenshots, zips, and generated artifacts remain outside git.
- Final RC closure audit ran on HEAD `5509dd8` (2026-06-22). All 9 phases passed. Package SHA256 `128c22d7...` (pre-doc-commit); final post-commit SHA in Bible entry 33. Install test PASS from `/tmp/Image_Gen_install_test_20260622-174058`. Smoke check 32/32 PASS. Security regressions 3/3 PASS. Privacy canary CLEAN.
- Final handoff freeze started from HEAD `b07e9bb` (2026-06-22). Release-facing docs now align on the local Operator Console, closed controlled target set, `/Volumes/wc2tb/ImageGen` as bounded proof-path staging only, and "DONE / freeze here" as the release posture.

## Preferred verification order

1. Read the current docs and the Bible entry that matches the requested boundary.
2. Verify the live tree before claiming anything is complete.
3. Run the narrowest useful sanity checks first.
4. Package only after the tree is clean and the release claim is defensible.

## What this file is not

- It is not a product roadmap.
- It is not a feature wish list.
- It is not a place to restate stale release claims.
