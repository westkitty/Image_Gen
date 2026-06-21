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
