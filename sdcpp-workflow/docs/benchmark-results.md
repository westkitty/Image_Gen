# Benchmark Results (recorded)

Measured on BigMac (Apple M4 Mac mini, 32 GB, Metal `MTL0`) on 2026-06-20,
SD 1.5 `v1-5-pruned-emaonly.safetensors`, build `7f0e728`, prompt
"a cozy concrete library with warm lights". Times are wall-clock seconds.
Live result dirs live under `runs/<ts>-benchmark*/`; this file is the human summary.

## Matrix: CLI vs warm server-openai (512×512)
| preset | steps | CLI (cold-ish) | server-openai (warm) | notes |
|--------|-------|----------------|----------------------|-------|
| smoke | 1 | 6.9s | 7.4s | proof only; not a real image |
| fast | 8 | 15.9s | 15.0s | day-to-day default |
| balanced | 16 | 25.7s | 25.1s | quality-when-it-matters |
| quality | 20 | 31.0s | ~30.0s (warm) | deliberate |

(Earlier observation: a cold CLI smoke right after boot/first-load measured ~13s;
once the 4 GB model is in the OS page cache, CLI smoke drops to ~7s. There is real
run-to-run variance from caching.)

## Warm server isolation
- **Server startup/load (one-time): ~22.8s** (model load into Metal).
- **Warm per-request:** smoke 6.8s · fast ~14.3s · balanced 24.5s · quality 30.0s.
- After startup, requests run at pure sampling cost — no reload.

## Reading the numbers
- **Steps dominate.** Each euler_a step ≈ ~1.2–1.5s at 512²; the rest is fixed
  per-image overhead (encode/decode/transfer) plus, for cold CLI, model load.
- **Warm server vs repeated CLI are close per-image** because this single Mac keeps
  the model in the OS page cache between CLI calls. The server's real advantage is
  amortizing the one-time load across **many** images and steadier latency.
- **smoke is not a deliverable** — 1 step is a noisy blob; it only proves the path.

## Recommendations (from sdcpp-summarize-benchmarks.sh)
- **Fastest verified:** smoke (~7s) — gate only.
- **Default day-to-day:** `fast` (8 steps, ~15s).
- **When it matters:** `balanced` (16 steps, ~25s; < 2× fast here).
- **Deliberate:** `quality` (20 steps, ~30s).
- **One-off image:** CLI (`sdcpp-run-fast.sh --mode cli`).
- **Multiple images in a session:** warm server (`sdcpp-run-fast.sh --mode server --keep-server-running`, then repeated `sdcpp-server-generate.sh`).

## How to regenerate
```sh
bin/sdcpp-benchmark.sh --modes both --presets smoke,fast,balanced,quality --repeats 2
bin/sdcpp-benchmark-server-warm.sh
bin/sdcpp-summarize-benchmarks.sh
```
