# Image_Gen AI Context Lock

Date: 2026-06-22

This file is the durable operating boundary for future Codex passes in this repo.
It exists to stop the same release facts from drifting.

## Canonical repo facts

- Workspace root: `/Users/andrew/Image_Gen`
- Canonical model home: `/Volumes/wc2tb/ImageGen`
- Runtime bridge: `operator-console/server.js`
- Clean source packager: `scripts/package-source.sh`

## Hard boundaries

- Do not add new model features unless the request explicitly asks for them.
- Do not introduce Flux or SDXL Turbo support by implication.
- Do not move model files, download models, or rewrite external-drive layout.
- Do not commit runtime outputs, caches, screenshots, package archives, or server logs.
- Do not touch `node_modules/`, `runs/`, `state/`, `logs/`, `Potential UI/`, `__MACOSX/`, or
  generated proof blobs.
- Keep Express bound to localhost only.

## Library / run history truth (updated 2026-06-22, Entries 25–27)

- `GET /api/run-index` returns paginated results (`limit`, `offset`, `filter`; default 50/page, max 200) with `filterCategory` and `controlledTargetLabel` per entry. Unknown filter → 400.
- `GET /api/runs/:runId/metadata` returns all manifest types under `manifests`, plus `run_type`, `status`, `created_at`, `primary_image`, `first_failed_gate`, `filter_category`, `controlled_target_label`, `controlled_target_caveat`, `prompt_private`, and a `replay` object.
- `replay` object: `{ available, target, width, height, steps, cfg_scale, seed, prompt_saved, prompt, negative_prompt, privacy_note, flux_caveat }`. `available` is true only for controlled runs with a valid manifest and allowlisted target. Target is always from the closed allowlist (`sd15`, `sdxl-base`, `sdxl-turbo`, `flux-fp8`). Prompts are null for redacted runs; `prompt` and `negative_prompt` are set for save_prompts=true runs.
- The Library screen has a filter bar, paginated run cards (50/page) with Load More, a full detail overlay, a full-size image viewer/lightbox, and a "Reuse in Create" button for controlled runs. Detail overlay shows "🔒 Prompt redacted" or "📋 Prompt saved" correctly per run.
- Prompt privacy: `prompt_private` is derived from `manifest.prompt_redacted` for controlled runs (authoritative). For save_prompts=false runs: `prompt_private=true`, replay prompt null, privacy note shown. For save_prompts=true runs: `prompt_private=false`, replay prompt set, "Reuse in Create" fills the prompt field. Default is always save_prompts=false.

## Current truth to preserve

- SDXL base, SDXL Turbo, and Flux each have bounded proof-only smoke paths.
- `POST /api/actions/sdxl-smoke`, `POST /api/actions/sdxl-turbo-smoke`, and `POST /api/actions/flux-smoke` are proof-only and do not mean full Automatic1111 parity.
- Flux proof uses `/Volumes/wc2tb/ImageGen/flux/flux1-schnell/flux1-schnell-fp8.safetensors`; the full `/Volumes/wc2tb/ImageGen/flux/flux1-schnell/flux1-schnell.safetensors` file was acquired but is not the runtime-proven file.
- `POST /api/actions/generate-controlled` now exposes a closed allowlist for SD1.5 standard, SDXL base, SDXL Turbo, and Flux fp8 only; it uses fixed proofed model behavior and does not imply arbitrary checkpoint switching.
- `POST /api/actions/generate-controlled` rejects arbitrary path/model overrides and only accepts the documented controlled fields for the closed allowlist.
- `POST /api/actions/generate-controlled` is positively proven through the Create selector and job polling for the closed allowlist; Flux 512x512 can hit Metal out-of-memory on this hardware, so Flux proof remains bounded to smaller accepted sizes.
- When `save_prompts` is false, controlled runs strip PNG metadata as well as redacting manifests and logs, so prompt privacy applies to the saved image files too.
- Proof-only support does not mean full Automatic1111 parity.
- `scripts/package-source.sh` packages `git archive HEAD` and refuses dirty trees by default.
- `sdcpp-workflow/bin/sdcpp-model-stage-check.sh` must preserve the SDXL smoke proof cache.
- Model files, runtime runs, smoke caches, logs, screenshots, zips, and generated artifacts remain outside git.

## Preferred verification order

1. Read the current docs and the Bible entry that matches the requested boundary.
2. Verify the live tree before claiming anything is complete.
3. Run the narrowest useful sanity checks first.
4. Package only after the tree is clean and the release claim is defensible.

## What this file is not

- It is not a product roadmap.
- It is not a feature wish list.
- It is not a place to restate stale release claims.
