# CHANGELOG

All notable changes to the BigMac SDCPP workflow harness.
Format: reverse-chronological. Dates are absolute.

## [0.3.0] — 2026-06-20
Phase 2: seed + batch controls, stable run folders, and a UI integration contract.

Added:
- `bin/sdcpp-batch-generate.sh` — N images with controlled seeds; per-image verify;
  stable `runs/<ts>-batch/` (images/, records/, logs/, responses/, batch-manifest.json/.tsv,
  batch-report.md, ui-run-card.md). Count cap 12 (`--force-large-batch`).
- `bin/sdcpp-seed-test.sh` — reproducibility proof (same seed twice → SHA256 compare).
- `bin/sdcpp-export-latest-markdown.sh` — read-only UI handoff (paths + ui-run-card.md).
- `docs/ui-integration-contract.md`, `docs/markdown-output-contract.md`, `docs/seed-batch-controls.md`.
- `schemas/run-manifest.example.json`, `schemas/image-record.example.json`.
- `templates/run-report-template.md`, `templates/image-card-template.md`.

Changed:
- `sdcpp-lib.sh`: `resolve_seed`, `gen_random_seed`, `iso_now`, `yaml_escape`, `write_ui_run_card`.
- `sdcpp-cli-generate.sh` / `sdcpp-server-generate.sh`: `--seed N|random|fixed`; seed passed
  per-endpoint (CLI `--seed`; SDAPI/native payload `seed`; OpenAI via `<sd_cpp_extra_args>`);
  every run now emits `ui-run-card.md` with `sdcpp.run.v1` front matter; metrics record real seed.
- `sdcpp-run-fast.sh` / `sdcpp-run-quality.sh`: `--seed` passthrough.
- Docs updated: README, QUICKSTART, command-reference, lifecycle, api-contracts,
  optimization, next-escalation-plan (Phase 2 marked implemented; Phase 2B added), TROUBLESHOOTING.

Findings:
- CLI generation is **deterministic**: same seed+settings → identical SHA256 (verified).
- SDAPI default seed is `-1` (random); must pass a seed for reproducible SDAPI batches.
- Markdown + JSON outputs are the documented UI integration boundary. No UI built.

Unchanged guarantees:
- No `--backend metal`; no broad-kill; port 7860 untouched; SD 1.5 @ 512² only;
  no downloads / Node / pnpm / Python inference; verified-PNG = success.

## [0.2.0] — 2026-06-20
Optimization layer: presets, timing/metrics, benchmarks, fast/quality commands.

Added:
- `config/presets.env` (smoke/thumbnail/fast/balanced/quality/quality_plus).
- `bin/sdcpp-presets.sh`, `sdcpp-run-fast.sh`, `sdcpp-run-quality.sh`.
- `bin/sdcpp-benchmark.sh` (bounded cli×server matrix, ≤40 cells, self-cleaning).
- `bin/sdcpp-benchmark-server-warm.sh` (startup vs warm per-request).
- `bin/sdcpp-summarize-benchmarks.sh` (ranking + recommendation engine).
- `docs/optimization.md`, `docs/benchmark-results.md`, `docs/performance-notes.md`.

Changed:
- `sdcpp-lib.sh`: `apply_preset`/`load_presets`, `now_epoch`/`elapsed_seconds`,
  `metrics_header`/`png_bytes`/`sanitize_tsv`, and `make_run_dir` honors
  `SDCPP_RUN_DIR_OVERRIDE` (for benchmark per-cell dirs).
- `sdcpp-cli-generate.sh` / `sdcpp-server-generate.sh`: `--preset` + `--cfg`/`--sampler`,
  per-run timing, and a machine-readable `metrics.tsv`.
- `sdcpp-server-generate.sh` OpenAI path now embeds `<sd_cpp_extra_args>` so presets'
  steps/cfg/sampler actually take effect (OpenAI handler ignores them otherwise).
- Docs updated: README, QUICKSTART, command-reference, lifecycle, api-contracts,
  next-escalation-plan (Phase 1 + 1B marked implemented), TROUBLESHOOTING.

Findings:
- Steps dominate runtime; fast(8)≈15s, balanced(16)≈25s, quality(20)≈30s on M4 512².
- Warm-server startup ≈23s one-time; warm requests = pure sampling cost.
- CLI for one-offs; warm server for many images per session.

Unchanged guarantees:
- No `--backend metal`; no broad-kill; port 7860 untouched; SD 1.5 @ 512² only;
  no downloads / Node / pnpm / Python inference; verified-PNG = success.

## [0.1.0] — 2026-06-20
Initial workflow harness, packaging the successful proof
(`/Users/andrew/Image_Gen/sdcpp-proof-20260620-172600/`) into repeatable tooling.

Added:
- `config/sdcpp.env.example` + auto-created `config/sdcpp.env` (never overwritten).
- `bin/sdcpp-lib.sh` — shared helpers (config, logging, route/build/model verify,
  portable base64 decode, PNG verify, port checks, tunnel + server lifecycle, reports).
- `bin/sdcpp-verify.sh` — read-only proven-state verification with PASS/FAIL + report.
- `bin/sdcpp-cli-generate.sh` — one `sd-cli` image, copied + verified (sha256) on MacBook.
- `bin/sdcpp-server-start.sh` — tmux `sd-server` + SSH control-socket tunnel, port-safe.
- `bin/sdcpp-server-status.sh` — read-only lifecycle status.
- `bin/sdcpp-server-generate.sh` — OpenAI / SDAPI / both / native (bounded) generation.
- `bin/sdcpp-server-stop.sh` — stops only workflow-owned tunnel + tmux session.
- `bin/sdcpp-run-smoke.sh` — end-to-end smoke with first-failed-gate reporting.
- `bin/sdcpp-clean-old-runs.sh` — dry-run-by-default housekeeping.
- `bin/sdcpp-open-latest.sh` — show/open newest PNG.
- `README.md`, `QUICKSTART.md`, `TROUBLESHOOTING.md`, `docs/*`, `.gitignore`.
- `BigMac_SDCPP_Workflow_Bible.md` — append-only project ledger.

Conventions locked in:
- Never `--backend metal` (Metal auto-selects as `MTL0`).
- Never broad-kill; never touch the unrelated port-7860 process.
- SD 1.5 @ 512×512 only; no downloads; no Node/pnpm; no Python inference.
