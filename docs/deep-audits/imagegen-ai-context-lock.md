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
