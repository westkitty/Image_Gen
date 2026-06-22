# Command Reference

All scripts live in `bin/`, source `bin/sdcpp-lib.sh` and `config/sdcpp.env`,
run under `set -euo pipefail`, print a clear `==== PASS ====` / `==== FAIL ====`
banner, and (on failure) name the **first failed gate**. Every run writes a
timestamped folder under `runs/`.

---

## sdcpp-verify.sh
Read-only verification of the proven state. Never kills/starts/generates/dirties.
```sh
bin/sdcpp-verify.sh
```
Checks: local tools; SSH route; hostname == `bigmac`; remote `$HOME`; hardware summary;
remote build tools (informational); repo pin `7f0e728` + clean; build dir + binaries;
model present/non-empty; remote output/log dirs; remote + local port availability (reported).
Output: console PASS/FAIL + `runs/<ts>-verify/verify-report.md`.

---

## sdcpp-cli-generate.sh
Generate ONE image via `sd-cli` on BigMac, copy to MacBook, verify, checksum.
```sh
bin/sdcpp-cli-generate.sh [--prompt "..."] [--negative "..."] \
  [--steps N] [--width N] [--height N] [--seed N] [--out-name NAME]
```
- Defaults from config. Never uses `--backend metal`; uses `--diffusion-fa`.
- `--seed` optional (sd-cli default 42; `<0` = random).
Output: `runs/<ts>-cli/` with `*.png`, `run-metadata.json`, `cli-run-report.md`, logs.
PASS = verified PNG on MacBook (+ sha256 local/remote).

---

## sdcpp-server-start.sh
Start a workflow-owned `sd-server` (tmux) + SSH control-socket tunnel.
```sh
bin/sdcpp-server-start.sh [--remote-port N] [--local-port N] [--session-name NAME]
```
- Verifies state first. If a port is busy, **reports and stops** (never kills).
- Records session/ports to `state/current-server-session`, `state/current-ports.env`,
  and remote `server_session.txt` / `server_port.txt`.
Output: `runs/<ts>-server-start/server-start-report.md`. PASS = remote + local listeners up.

---

## sdcpp-server-status.sh
Read-only status of server/tunnel. Changes nothing.
```sh
bin/sdcpp-server-status.sh
```
Shows: local tunnel listener, ssh tunnel process, control socket, remote listener,
remote tmux session, remote log tail, configured ports, and a safe-action assessment.

---

## sdcpp-server-generate.sh
Generate via the running server through the tunnel.
```sh
bin/sdcpp-server-generate.sh [--prompt "..."] [--negative "..."] \
  [--steps N] [--width N] [--height N] [--api openai|sdapi|both|native]
```
- Default `--api openai`. `native` is bounded (polls ≤60s).
- Saves response JSON, decodes base64 portably, verifies PNG.
Output: `runs/<ts>-server-gen/` with `*.png`, `*-response.json`, `server-generate-report.md`.
PASS = at least one requested API yields a verified PNG.

---

## sdcpp-server-stop.sh
Stop ONLY the workflow's tunnel + tmux session; verify shutdown.
```sh
bin/sdcpp-server-stop.sh
```
- Closes the recorded SSH control socket; kills the recorded tmux session; both safe if absent.
- Verifies local/remote ports closed and session gone; confirms 7860 owner untouched.
Exit: 0 = fully stopped; 2 = PARTIAL (evidence in report). Never broad-kills.

---

## sdcpp-run-smoke.sh
End-to-end: verify → CLI → server-start → server-generate(openai) → (sdapi optional) → server-stop → repo re-check.
```sh
bin/sdcpp-run-smoke.sh
```
- On any failure: stops, safely cleans up if it started the server, reports first failed gate.
Output: `runs/<ts>-smoke/smoke-report.md`.
PASS = CLI PNG verified AND ≥1 server PNG verified AND cleanup done AND repo clean.

---

## sdcpp-clean-old-runs.sh
Non-destructive housekeeping for `runs/`.
```sh
bin/sdcpp-clean-old-runs.sh                          # dry run (list only)
bin/sdcpp-clean-old-runs.sh --delete --older-than-days N
```
- Default dry-run. Never deletes the newest run, model files, the proof Bible/report, or remote files.

---

## sdcpp-open-latest.sh
Show + open the newest PNG. Read-only.
```sh
bin/sdcpp-open-latest.sh
```
Prints PNGs in the latest run dir and `open`s the most recent PNG (macOS).

---

# Optimization layer

All generators accept `--preset smoke|thumbnail|fast|balanced|quality|quality_plus`
(from `config/presets.env`). Explicit flags (`--steps/--width/--height/--cfg/--sampler`)
override preset values, which override `config/sdcpp.env`.

## sdcpp-run-fast.sh
One-command fast (preset `fast`, 8 steps).
```sh
bin/sdcpp-run-fast.sh [--mode cli|server] [--prompt ..] [--negative ..] [--open] [--keep-server-running]
```
CLI by default; `--mode server` starts/reuses a warm server and stops it after unless `--keep-server-running`. Prints `FAST PNG: <path>`.

## sdcpp-run-quality.sh
One-command quality (preset `quality`, 20 steps).
```sh
bin/sdcpp-run-quality.sh [--mode cli|server|both] [--prompt ..] [--negative ..] [--open] [--keep-server-running]
```
Default `both` = CLI + warm-server OpenAI for comparison.

## sdcpp-benchmark.sh
Bounded matrix across presets × modes (cli, server-openai). Verifies every PNG; stops the server unless `--keep-server-running`.
```sh
bin/sdcpp-benchmark.sh [--modes cli|server-openai|server-sdapi|both] \
  [--presets a,b,c] [--repeats N] [--prompt ..] [--negative ..] \
  [--skip-server] [--keep-server-running] [--output-dir DIR]
```
Writes `benchmark-results.tsv` + `benchmark-results.md` + per-cell PNGs/logs under `runs/<ts>-benchmark/`. Bounded to ≤40 cells.

## sdcpp-benchmark-server-warm.sh
Isolates server startup/load from warm per-request time. Sequence: smoke, fast×2, balanced, quality (OpenAI); `--include-sdapi` adds an SDAPI comparison.
```sh
bin/sdcpp-benchmark-server-warm.sh [--prompt ..] [--negative ..] [--include-sdapi] [--keep-server-running]
```
Writes `warm-report.md` + `warm-results.tsv`.

## sdcpp-summarize-benchmarks.sh
Summarize a benchmark TSV (latest by default) into `benchmark-summary.md` with rankings + recommendation.
```sh
bin/sdcpp-summarize-benchmarks.sh [path/to/benchmark-results.tsv]
```

---

# Phase 2: seed + batch + UI handoff

All generators accept `--seed N|random|fixed` (fixed=42; random=recorded integer;
omitted=not forced). Reports record the actual seed used, or `uncontrolled`.

## sdcpp-batch-generate.sh
Generate N images with controlled seeds; verify each; emit a stable batch folder.
```sh
bin/sdcpp-batch-generate.sh [--mode cli|server] [--count N] [--preset NAME] \
  [--prompt ..] [--negative ..] [--seed N] [--seed-start N] \
  [--seed-mode same|increment|random] [--api openai|sdapi|native] \
  [--keep-server-running] [--open] [--force-large-batch]
```
Defaults: `--mode cli --count 3 --preset fast --seed-mode increment --seed-start 42`.
Count cap 12 unless `--force-large-batch`. Output: `runs/<ts>-batch/` with
`images/`, `records/`, `logs/`, `responses/`, `batch-manifest.json`, `batch-manifest.tsv`,
`batch-report.md`, `ui-run-card.md`. PASS = all images verified (PARTIAL if some fail).

## sdcpp-seed-test.sh
Prove/disprove seed reproducibility (same seed twice → compare SHA256).
```sh
bin/sdcpp-seed-test.sh [--mode cli|server-sdapi|native] [--preset NAME] [--seed N] [--prompt ..]
```
Default `--mode cli --preset smoke --seed 424242`. Writes `seed-test-report.md` with
`deterministic: PASS|FAIL|UNKNOWN`.

## sdcpp-export-latest-markdown.sh
Print the newest run's UI markdown + the paths a UI should read (read-only).
```sh
bin/sdcpp-export-latest-markdown.sh [--type any|batch|cli|server|seedtest] [--paths-only]
```

## sdcpp-presets.sh
Helper to list/inspect presets.
```sh
bin/sdcpp-presets.sh            # list all presets
bin/sdcpp-presets.sh fast       # show one preset's resolved values
```

---

## sdcpp-upscale.sh
Local Pillow resize upscale for existing run images. No SSH, no inference, no prompt fields.
```sh
bin/sdcpp-upscale.sh --path "<run-id>/<image.png>" [--scale 2|3|4] [--resample lanczos|bicubic|bilinear|nearest] [--overwrite]
bin/sdcpp-upscale.sh --run-id "<run-id>" --image "<relative.png>" [--scale 2] [--resample lanczos] [--overwrite]
```
- `run-id` must match `^[A-Za-z0-9_-]+$`. Image path must match `^[A-Za-z0-9._/-]+$`.
- All values passed to Python via `sys.argv` — never interpolated into Python source.
- Output: `runs/<run-id>/upscaled/<base>-upscale-<N>x-<resample>.png`
- Manifest: `runs/<run-id>/upscaled/upscale-manifest.json` (schema `sdcpp-upscale-manifest-v1`, no prompt fields)
- Also served via the Operator Console: `POST http://127.0.0.1:31337/api/actions/upscale`

## sdcpp-discover-assets.sh
Discover checkpoints, VAEs, LoRAs, embeddings, and hypernetworks on BigMac via SSH.
```sh
bin/sdcpp-discover-assets.sh
```
Writes `state/assets-cache.json`. Also available via `POST /api/actions/discover-assets`.

## sdcpp-model-stage-check.sh
Validate SDXL Turbo / Flux staging on BigMac wc2tb without downloading or moving models.
```sh
bin/sdcpp-model-stage-check.sh
```
Checks `ssh westcat` identity (`bigmac` / `bigmac`), `/Volumes/wc2tb`, write access under `/Volumes/wc2tb/ImageGen`, staged SDXL Turbo/SDXL/Flux candidates, GGUF candidates, and stable-diffusion.cpp help observations. Reads the dedicated SDXL, SDXL Turbo, and Flux smoke proof caches when present so a later proof survives a fresh stage scan. Writes `state/model-stage-cache.json`. Also available via `POST /api/actions/check-model-stage`; read the cache through `GET /api/model-stage`.

Target root:
```text
/Volumes/wc2tb/ImageGen
```

First SDXL Turbo target:
```text
/Volumes/wc2tb/ImageGen/checkpoints/sdxl-turbo/sd_xl_turbo_1.0_fp16.safetensors
```

Flux targets: `flux1-schnell.safetensors` or compatible GGUF/quantized model candidates under `flux/flux1-schnell/`, plus `ae.safetensors`, CLIP-L, and T5XXL candidates under `flux/shared/`. File presence is not support; a bounded BigMac Metal smoke run must produce a real PNG before enabling the gates.

## sdcpp-sdxl-turbo-smoke.sh
Run the bounded SDXL Turbo proof on BigMac wc2tb after the fp16 checkpoint is staged and nonzero.
```sh
bin/sdcpp-sdxl-turbo-smoke.sh
```
Checks the live route, confirms the staged Turbo checkpoint is present, probes the discovered `sd-cli` binary for the required flags, runs a low-step 512x512 smoke, and writes `runs/<timestamp>-sdxl-turbo-smoke/{sdxl-turbo-smoke.png,sdxl-turbo-smoke-report.md,sdxl-turbo-smoke-manifest.json}` plus `state/sdxl-turbo-smoke-cache.json`. Also available via `POST /api/actions/sdxl-turbo-smoke`.

## sdcpp-flux-smoke.sh
Run the bounded Flux proof on BigMac wc2tb after the component set is staged.
```sh
bin/sdcpp-flux-smoke.sh
```
Checks the live route, confirms the staged Flux model/VAE/text encoders are present, probes the discovered `sd-cli` binary for Flux flags, runs a 512x512 smoke, and writes `runs/<timestamp>-flux-smoke/{flux-smoke.png,flux-smoke-report.md,flux-smoke-manifest.json}` plus `state/flux-smoke-cache.json`. Also available via `POST /api/actions/flux-smoke`.

## sdcpp-sdxl-smoke.sh
Run the bounded SDXL base proof on BigMac wc2tb after the base checkpoint is staged and nonzero.
```sh
bin/sdcpp-sdxl-smoke.sh
```
Checks the live route, confirms the staged SDXL base checkpoint is larger than 1 GiB, probes the discovered `sd-cli` binary for the required flags, runs a 512x512 / 4-step smoke, and writes `runs/<timestamp>-sdxl-smoke/{sdxl-smoke.png,sdxl-smoke-report.md,sdxl-smoke-manifest.json}` plus `state/sdxl-smoke-cache.json`. Also available via `POST /api/actions/sdxl-smoke`.

## sdcpp-image-edit-capabilities.sh
Probe BigMac for img2img / inpaint CLI support.
```sh
bin/sdcpp-image-edit-capabilities.sh
```
Writes `state/image-edit-capabilities.json`. Also via `POST /api/actions/probe-image-edit`.

## sdcpp-upscale-capabilities.sh
Probe BigMac for upscale tools (Pillow, Real-ESRGAN, face restore).
```sh
bin/sdcpp-upscale-capabilities.sh
```
Writes `state/upscale-capabilities.json`. Also via `POST /api/actions/probe-upscale`.

## sdcpp-read-run-metadata.sh
Read structured metadata from a run directory (run-card, manifest, PNG chunks, metrics).
```sh
bin/sdcpp-read-run-metadata.sh <run-id>
```
Also available via `GET /api/runs/<run-id>/metadata`.

## sdcpp-xyz-plot.sh
X/Y/Z parameter sweep — generate a grid of images varying two axes.
```sh
bin/sdcpp-xyz-plot.sh --prompt "..." --x-type steps --x-values "10,20,30" \
  [--y-type cfg --y-values "5,7,9"] [--negative "..."] [--preset NAME] [...]
```
Max 16 cells (x_count × y_count). Requires running BigMac server tunnel.
Also via `POST /api/actions/xyz-plot` (validated: max 16 cells enforced server-side).

## sdcpp-model-stage-check.sh
Validate staged SDXL Turbo / Flux files on BigMac and write `state/model-stage-cache.json`.
- Uses local `Path.stat()` on the mounted `/Volumes/wc2tb/ImageGen` tree for accurate size checks.
- Rejects zero-byte and tiny placeholder files.
- Preserves SDXL smoke proof state when `state/sdxl-smoke-cache.json` exists, and also preserves the SDXL Turbo / Flux proof caches when those files are present.
- Emits `sdxl_staged_state`, `sdxl_turbo_staged_state`, `flux_staged_state`, and `invalid_candidates`.

## sdcpp-model-inventory-wc2tb.sh
Inventory model candidates and write the move plan/result manifests under `/Volumes/wc2tb/ImageGen/manifests/`.
- Reports `remaining_high_confidence_outside_root`, `still_actionable_high_confidence_count`, `duplicate_skip_count`, `missing_source_skip_count`, and previews for each.
- `GET /api/model-inventory` reads the cache and now exists in the live server again after restart.
