# Optimization Guide

How to go fast safely with the BigMac SDCPP workflow (SD 1.5 @ 512×512).

## Presets (config/presets.env)
| preset | size | steps | cfg | sampler | use |
|--------|------|-------|-----|---------|-----|
| smoke | 512² | 1 | 7.0 | euler_a | proof gate only (not a real image) |
| thumbnail | 384² | 4 | 7.0 | euler_a | tiny quick sanity |
| fast | 512² | 8 | 7.0 | euler_a | **day-to-day default** |
| balanced | 512² | 16 | 7.0 | euler_a | normal use when quality matters |
| quality | 512² | 20 | 7.0 | euler_a | deliberate quality |
| quality_plus | 512² | 30 | 7.0 | euler_a | slow comparison point |

Apply with `--preset NAME` on `sdcpp-cli-generate.sh` / `sdcpp-server-generate.sh`
(and `sdcpp-benchmark*`). **Explicit flags always override preset values**, which
override `config/sdcpp.env` defaults.

## Fast vs balanced vs quality
- **fast (8 steps)** — quickest usable image. Best default.
- **balanced (16 steps)** — noticeably cleaner; on this hardware it is **< 2× fast**, so it's a good "looks good" choice.
- **quality (20 steps)** — deliberate; ~2× fast. Use when you'll keep the image.
- steps are the dominant runtime cost once the model is loaded; cfg/sampler barely move the clock here.

## CLI vs server mode
- **CLI** (`sdcpp-cli-generate.sh`): one `sd-cli` invocation per image. Simplest; no lifecycle. Each call loads the model (fast when the 4 GB file is in the OS page cache, slower cold).
- **Server** (`sdcpp-server-start.sh` + `sdcpp-server-generate.sh`): the model is loaded once and stays warm; subsequent requests skip load entirely.

## Cold server vs warm server
- **Server startup/load** is a one-time cost (~20s measured) paid when you start `sd-server`.
- **Warm requests** then run at pure sampling cost (smoke ~7s, fast ~14s, balanced ~25s, quality ~30s).
- On this single-Mac setup the OS page cache also keeps the model warm for repeated CLI, so warm-server vs repeated-CLI are close *for the same step count*. The clear server win is amortizing the first-load cost across **many** images in one session, plus steadier latency.

## How to run a benchmark
```sh
# matrix (cli + warm server-openai), bounded:
bin/sdcpp-benchmark.sh --modes both --presets smoke,fast,balanced,quality --repeats 1

# warm-only throughput (startup isolated from per-request):
bin/sdcpp-benchmark-server-warm.sh
```
Both verify first, write timestamped run dirs, verify every PNG, and stop the
workflow-owned server/tunnel unless `--keep-server-running`.

## How to summarize a benchmark
```sh
bin/sdcpp-summarize-benchmarks.sh                 # latest benchmark
bin/sdcpp-summarize-benchmarks.sh path/to/benchmark-results.tsv
```
Produces `benchmark-summary.md` with rankings + a data-driven recommendation.

## What PASS means
A generation PASSes only when a PNG is **decoded/copied to the MacBook and verified
with `file` + non-zero size**. HTTP 200, `/v1/models`, `/sdcpp/v1/capabilities`,
and a listening port are **not** success.

## Batch & seeds (Phase 2)
- `sdcpp-batch-generate.sh` reuses one warm server in `--mode server` (best for several
  images) and per-call CLI in `--mode cli`. Same speed characteristics as single runs.
- Seeds: `--seed N|random|fixed`; CLI is verified deterministic. See `seed-batch-controls.md`.
- Manifests (`batch-manifest.json/.tsv`) carry per-image timing for ad-hoc analysis.

## What NOT to optimize yet
- No SDXL / Flux / LoRA / ControlNet / ComfyUI / custom UI.
- No model downloads, no Node/pnpm, no Python inference.
- Stay at SD 1.5 / 512×512 (smaller dims are allowed only inside a benchmark matrix, e.g. the thumbnail preset).

## Why not `--backend metal`
In build `7f0e728`, `--backend` takes a device token (cpu/cuda0/…); `metal` is not a
device name and yields `backend 'metal' was not found`. Metal auto-selects as device
`MTL0 (Apple M4)` when `--backend` is omitted. All scripts omit it.

## Why remote SSH exit codes are untrusted
BigMac's sshd does not propagate remote *command* exit codes (`ssh westcat 'exit 3'`
returns 0; only ssh-layer failures like 255 propagate). All remote booleans use the
output-sentinel `remote_test()` in `sdcpp-lib.sh`. Never gate on a raw `ssh` exit code.

## How to avoid touching port 7860
An unrelated Python process listens on 7860. The workflow defaults to remote `7870`
/ local `17870` and **reports, never kills** an occupied port. Pick another with
`--remote-port` / `--local-port` if needed.

## How to clean up server/tunnel
```sh
bin/sdcpp-server-status.sh    # read-only check
bin/sdcpp-server-stop.sh      # stops ONLY the workflow's tmux session + control socket
```
Benchmarks self-clean unless `--keep-server-running`.

## OpenAI endpoint + presets (important)
The OpenAI `/v1/images/generations` handler only reads `prompt`, `size`, `n`,
`output_format`; steps/cfg/sampler otherwise fall back to **server defaults**. The
workflow makes presets take effect on this endpoint by embedding
`<sd_cpp_extra_args>{...}</sd_cpp_extra_args>` (sample_steps / sample_method / txt_cfg)
into the prompt — handled automatically by `sdcpp-server-generate.sh`. SDAPI
(`/sdapi/v1/txt2img`) takes `steps`/`cfg_scale`/`sampler_name` natively.
