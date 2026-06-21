# Proven State (baseline this workflow rests on)

Source of truth (read-only, do not edit):
- `/Users/andrew/Image_Gen/sdcpp-proof-20260620-172600/BigMac_SDCPP_Image_Gen_Proof_Bible.md`
- `/Users/andrew/Image_Gen/sdcpp-proof-20260620-172600/final-proof-report.md`

## Proof result
- **PASS.** CLI PNG verified on MacBook AND server API verified on MacBook (3 of 3 paths).
- Re-verified live on 2026-06-20 before building this workflow: route, repo pin, binaries, model all green.

## Host / route
- SSH route: `ssh westcat` → user `bigmac`, hostname `bigmac`, `$HOME=/Users/bigmac`.
- Network: Tailscale (BigMac `100.67.12.66`). macOS 26.5.1.
- Hardware: Apple M4 Mac mini, 10 cores (4P/6E), 32 GB unified memory.

## Build path
- Repo: `$HOME/stable-diffusion.cpp`, detached HEAD pinned at `7f0e728`, working tree clean.
- Build: out-of-repo at `$HOME/sdcpp-staging/builds/build-metal-proof-20260620-143223`
  (configured `-DSD_METAL=ON -DCMAKE_BUILD_TYPE=Release`).
- Pointer: `$HOME/sdcpp-staging/build_dir.txt`.
- Binaries: `<build>/bin/sd-cli`, `<build>/bin/sd-server`
  (server flags `--listen-ip`, `--listen-port`; **not** `--host`/`--port`).

## Model path
- `$HOME/sdcpp-staging/models/v1-5-pruned-emaonly.safetensors` (4,265,146,304 bytes).
- Staged from a copy already present on BigMac (`/Volumes/wc2tb/ai-stack/...`); **not** downloaded.
- Inference reads from `$HOME` staging only; never from `/Volumes/wc2tb`.

## Metal evidence
- Runtime log: `ggml_metal_device_init: GPU name: MTL0 (Apple M4)`, unified memory,
  recommendedMaxWorkingSetSize ≈ 26800 MB.
- CLI 1-step 512×512 generate completed in ~12.83s.

## CLI proof artifact
- `sd15_cli_smoke.png` — `PNG image data, 512 x 512`, 556K, MD5 matched MacBook↔BigMac
  (`f82fdbbb1e860f0c53a4cbeaecbd3cc4`).

## Server proof artifacts (all 512×512 PNG, verified on MacBook)
- OpenAI `/v1/images/generations` → `sdcpp_openai_sd15.png` (501K).
- SD WebUI `/sdapi/v1/txt2img` → `sdcpp_sdapi_sd15.png` (579K).
- Native async `/sdcpp/v1/img_gen` + `/sdcpp/v1/jobs/<id>` → `sdcpp_native_sd15.png` (556K, optional).

## Deviations recorded during the proof (carried into this workflow as rules)
- Dropped `--backend metal` — invalid token in this build; Metal auto-selects as `MTL0`.
- Used remote port `7870` / local `17870` because `7860` was held by an unrelated Python process (left untouched).
- Model found on BigMac and staged locally (no download).
- Tailscale was briefly down at proof start; reconnected manually.

## Cleanup state after proof
- Proof server + tunnel were cleanly stopped and verified down.
- Unrelated Python on 7860 confirmed still listening (untouched).
- Upstream checkout remained clean at `7f0e728`.
