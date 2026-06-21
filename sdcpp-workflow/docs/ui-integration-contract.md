# BigMac SDCPP UI Integration Contract

Standalone contract for a future UI-building agent. You can build the UI from this
document alone. The UI is NOT built yet. **The Markdown + JSON outputs are the API**;
do not scrape terminal text unless nothing else is available.

## 1. Purpose
Drive SD 1.5 image generation on BigMac (Apple M4, Metal) from a UI, by shelling out
to the workflow scripts in `/Users/andrew/Image_Gen/sdcpp-workflow/bin` and reading
their stable run folders. The backend handles inference, verification, lifecycle, and
safety. The UI handles presentation and user intent.

## 2. What the UI owns
- Presentation, input forms, image grids, history browsing.
- Choosing which allowed command to run and with which arguments.
- Reading run folders (Markdown/JSON) and rendering them.
- Surfacing PASS/FAIL, cleanup state, and errors to the user.

## 3. What the backend workflow owns
- All inference (CLI `sd-cli`, server `sd-server` via SSH tunnel).
- PNG verification (`file` + size) — success is defined here, not in the UI.
- Seeds, presets, batch logic, manifests, timing/metrics.
- Server/tunnel lifecycle and safe cleanup.
- Append-only state ledger (`BigMac_SDCPP_Workflow_Bible.md`).

## 4. Hard safety boundaries (must hold)
- Never `--backend metal` (it fails; Metal auto-selects as `MTL0`).
- Never broad-kill (`pkill`/`killall`), never kill ssh/sd-server directly.
- Never touch the unrelated process on port **7860**.
- Never edit `/Users/bigmac/stable-diffusion.cpp`; never use `/Volumes/wc2tb` for inference.
- Never download weights; no Node/pnpm; no Python inference.
- Remote booleans are derived from command OUTPUT, not ssh exit codes (BigMac masks them).

## 5. Commands the UI MAY call
```sh
bin/sdcpp-verify.sh
bin/sdcpp-server-status.sh
bin/sdcpp-cli-generate.sh --preset fast --prompt "..." [--seed N|random|fixed]
bin/sdcpp-batch-generate.sh --mode cli --count 3 --preset fast --seed-mode increment --seed-start 42 --prompt "..."
bin/sdcpp-server-start.sh
bin/sdcpp-server-generate.sh --preset fast --api openai --prompt "..." [--seed N]
bin/sdcpp-server-stop.sh
bin/sdcpp-run-fast.sh --mode cli --prompt "..." [--seed N] [--open]
bin/sdcpp-run-quality.sh --mode cli --prompt "..." [--seed N] [--open]
bin/sdcpp-seed-test.sh --preset smoke --seed 424242 --mode cli
bin/sdcpp-export-latest-markdown.sh [--type batch|cli|server|seedtest]
bin/sdcpp-open-latest.sh
bin/sdcpp-presets.sh
bin/sdcpp-model-stage-check.sh
```

## 6. Commands to gate behind "advanced mode"
```sh
bin/sdcpp-benchmark.sh
bin/sdcpp-benchmark-server-warm.sh
bin/sdcpp-summarize-benchmarks.sh
bin/sdcpp-clean-old-runs.sh --delete --older-than-days N
```

## 7. Commands the UI MUST NEVER do
```
pkill / killall / rm -rf
directly killing ssh or sd-server
editing /Users/bigmac/stable-diffusion.cpp
using --backend metal
touching port 7860
running model downloads
```

## 8. Environment assumptions
- macOS, bash 3.2 (avoid bash-4-only features if you script around it).
- `ssh westcat` reaches BigMac over Tailscale (must be up; see TROUBLESHOOTING.md).
- Tools present locally: ssh, scp, jq, curl, base64, lsof, file, date, shasum, gdate (optional).
- Project root: `/Users/andrew/Image_Gen/sdcpp-workflow`. Run commands from there.
- Default ports: remote `7870`, local tunnel `17870` (configurable in `config/sdcpp.env`).

## 9. Output directories
- All runs go to `runs/<timestamp>-<type>/` (types: `cli`, `server-gen`, `batch`, `seedtest`, `verify`, `benchmark`, ...).
- Live lifecycle state in `state/` (current session, ports, ssh control socket).
- Config in `config/` (`sdcpp.env`, `presets.env`).

## 10. Stable run folder structure
Single (cli/server) run:
```
runs/<ts>-cli/        ui-run-card.md  cli-run-report.md  run-metadata.json  metrics.tsv  <name>.png
runs/<ts>-server-gen/ ui-run-card.md  server-generate-report.md  metrics.tsv  openai.png|sdapi.png|native.png  *-response.json
```
Batch run:
```
runs/<ts>-batch/
  ui-run-card.md
  batch-report.md
  batch-manifest.json
  batch-manifest.tsv
  images/   image-001.png image-002.png ...
  records/  image-001.md  image-002.md  ...
  logs/     batch.log image-001.log ...
  responses/ <copied response/metadata json>
```

## 11. Markdown outputs
See `markdown-output-contract.md`. UI-facing: `ui-run-card.md` (every run),
`batch-report.md`, `records/image-###.md`. All have YAML front matter.

## 12. Image record schema (`sdcpp.image.v1`)
See `schemas/image-record.example.json`. Fields: index, status, mode, api, preset,
prompt, negative_prompt, width, height, steps, cfg_scale, sampler, seed, png_path,
file_output, bytes, sha256, elapsed_seconds, created_at.

## 13. Batch run schema (`sdcpp.run.v1`)
See `schemas/run-manifest.example.json`. Top-level run metadata + `images[]` array of
image records. `count_requested` vs `count_succeeded` indicate partial runs.

## 14. Server lifecycle states
Parse `bin/sdcpp-server-status.sh` (read-only). It reports:
- local tunnel listener (17870), ssh tunnel process, control socket presence,
- remote server listener (7870), remote tmux session, remote log tail,
- an Assessment line: "Nothing running" / "Server + tunnel appear UP" / "Partial/mixed".
Treat states as: `stopped` | `running` | `partial`.

## 15. Recommended UI flows
1. **One-off fast image**: `sdcpp-run-fast.sh --mode cli --prompt "..."` → read latest `ui-run-card.md` → show `primary_image`.
2. **Batch concept exploration**: `sdcpp-batch-generate.sh --mode cli --count 4 --preset fast --seed-mode increment --prompt "..."` → read `batch-manifest.json` → render grid from `images/`.
3. **Warm server session**: `sdcpp-server-start.sh` → repeated `sdcpp-server-generate.sh` (or `sdcpp-batch-generate.sh --mode server --keep-server-running`) → `sdcpp-server-stop.sh`. Always show cleanup status.
4. **Status-only**: `sdcpp-server-status.sh` → show running/stopped/partial.
5. **Failure recovery**: `sdcpp-server-status.sh` → `sdcpp-server-stop.sh` (safe, idempotent). Never broad-kill.

## 16. Error handling
- Every script prints `==== PASS ====` / `==== FAIL ====` and, on failure, a
  `First failed gate:` line. The run card / report `status` mirrors this.
- Non-zero exit = failure (scripts use `fail`). Batch may exit 0 with `status: PARTIAL`
  — always read `status`/`count_succeeded`, don't rely on exit code alone for batches.
- On failure, read the run dir's `logs/` and `*-report.md`.

## 17. Status polling
- Generation is synchronous from the UI's perspective (the script blocks until done,
  then the run dir is complete). Poll by watching for the run dir's `ui-run-card.md`.
- For long batches, `logs/batch.log` and partial `images/` appear incrementally.
- Native async (`--api native`) polls internally and is bounded (~60s); the UI still
  sees a single synchronous call.

## 18. Cleanup behavior
- Scripts that start a server/tunnel stop them on completion unless
  `--keep-server-running` is passed.
- If kept running, the run card/report says `server_left_running` and includes the
  stop command (`bin/sdcpp-server-stop.sh`). The UI MUST surface this.
- `sdcpp-server-stop.sh` only stops the workflow-owned tmux session + control socket.

## 19. Presets
`smoke`(1) · `thumbnail`(384², 4) · `fast`(8, default) · `balanced`(16) · `quality`(20) ·
`quality_plus`(30). `--preset NAME`; explicit `--steps/--width/--height/--cfg/--sampler`
override. Inspect via `bin/sdcpp-presets.sh`. Measured: fast ≈15s, balanced ≈25s, quality ≈30s.

## 20. Seed and batch controls
- `--seed N | random | fixed` (fixed=42; random=recorded integer). Reports show the
  actual seed or `uncontrolled`. See `seed-batch-controls.md`.
- Batch: `--count` (default 3, cap 12 unless `--force-large-batch`),
  `--seed-mode same|increment|random`, `--seed-start N`.
- **Determinism is proven for CLI** (same seed → identical SHA256; see seed-test). For
  server, prefer `--api sdapi` or `--api native` for direct seed control; treat
  cross-run determinism as verified only when `sdcpp-seed-test.sh` reports
  `DETERMINISTIC PASS` for that mode.

## 21. Security / process safety
- The UI is a thin caller. It must pass user text as a single `--prompt` argument
  (already shell-safe inside the scripts; do not build prompts via string concatenation
  into a shell). Never let user text become a flag or a separate command.
- No command in section 7, ever. Gate destructive/advanced commands (section 6).

## 22. Known gotchas
- OpenAI `/v1/images/generations` ignores steps/seed unless embedded via
  `<sd_cpp_extra_args>` — the workflow does this automatically; the UI just passes flags.
- BigMac ssh masks remote exit codes — never gate UI logic on raw `ssh` exit status.
- Port 7860 is someone else's; the workflow uses 7870/17870.
- Tailscale down → `ssh westcat` times out → `verify`/`status` will FAIL fast; prompt the user to reconnect.
- smoke (1 step) is a path-proof, not a real image — don't present it as a deliverable.

## 23. Future extension points (not implemented)
- Persistent "session mode" wrapper (keep one warm server for a UI session).
- A `runs/index.json` history aggregator for fast browsing.
- SDXL/Flux/larger sizes — highest-priority next model paths, but still gated. Stage files under `/Volumes/wc1tb/Ai/Image_Gen/sdcpp-models`, run `bin/sdcpp-model-stage-check.sh`, then require bounded BigMac Metal PNG proof before enabling.

## 24. SDXL Turbo / Flux staging contract

- API read: `GET /api/model-stage`
- API action: `POST /api/actions/check-model-stage`
- Cache: `state/model-stage-cache.json`
- Docs: `operator-console/docs/model-staging-sdxl-turbo-flux.md`
- Root: `/Volumes/wc1tb/Ai/Image_Gen/sdcpp-models`

SDXL Turbo first target:

```text
/Volumes/wc1tb/Ai/Image_Gen/sdcpp-models/checkpoints/sdxl-turbo/sd_xl_turbo_1.0_fp16.safetensors
```

Flux first targets:

```text
/Volumes/wc1tb/Ai/Image_Gen/sdcpp-models/flux/flux1-schnell/flux1-schnell.safetensors
/Volumes/wc1tb/Ai/Image_Gen/sdcpp-models/flux/shared/ae.safetensors
```

The UI must show staged/missing/smoke-required states separately. It must not mark `sdxlTurbo`, `flux`, or `sdxl` supported from file presence alone.
