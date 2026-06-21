# Next Escalation Plan (FUTURE — not implemented)

This document defines future phases only. **Nothing here is implemented**, and
none of it should be started unless Andrew explicitly asks. The working harness
stays SD 1.5 @ 512×512 until then. Each phase must keep the same safety rules
(no `--backend metal`, no broad-kill, no touching port 7860, no weight downloads
without explicit approval, append-only Bible, verified-PNG = success).

## Phase 1 — SD 1.5 normal-step quality test  ✅ IMPLEMENTED (2026-06-20)
- Goal: move beyond 1-step smoke to realistic quality (e.g. 20–30 steps).
- Delivered: preset system (`config/presets.env`), `--preset` on all generators,
  `sdcpp-run-quality.sh`. Quality (20 steps) verified via CLI (~31s) and warm server.
- Exit met: verified 512×512 PNGs at fast/balanced/quality via CLI and server.

## Phase 1B — Speed profiling & preset optimization  ✅ IMPLEMENTED (2026-06-20)
- Goal: benchmark presets/modes and pick safe fast defaults.
- Delivered: `sdcpp-benchmark.sh`, `sdcpp-benchmark-server-warm.sh`,
  `sdcpp-summarize-benchmarks.sh`, timing/metrics capture (`metrics.tsv`), and
  `docs/{optimization,benchmark-results,performance-notes}.md`.
- Findings: steps dominate runtime; fast(8)≈15s default; warm server amortizes the
  ~23s one-time load across a session; OpenAI endpoint needs `<sd_cpp_extra_args>`
  to honor steps (handled automatically).
- Exit met: benchmark matrix + warm benchmark PASS; recommendation engine works.

## Phase 2 — SD 1.5 batch + seed controls  ✅ IMPLEMENTED (2026-06-20)
- Goal: deterministic reproduction and small batches.
- Delivered: `--seed N|random|fixed` on all generators; `sdcpp-batch-generate.sh`
  (count/seed-mode/manifests); `sdcpp-seed-test.sh`; stable run folders + JSON/TSV
  manifests + `ui-run-card.md`; `docs/{ui-integration-contract,markdown-output-contract,seed-batch-controls}.md`;
  `schemas/` + `templates/`.
- Exit met: CLI proven deterministic (same seed → identical SHA256); CLI + server
  (sdapi) batches verified each PNG. **UI contract written; no UI built.**

## Phase 2B — UI handoff package / persistent session mode  (next, future)
- Goal: make the documented contract trivially consumable: a `runs/index.json` history
  aggregator and/or a persistent warm-server "session mode" wrapper.
- Exit: a UI agent can list runs and reuse one warm server across a session.

## Phase 3 — SDXL 768 smoke
- Goal: prove SDXL base at 768×768, 1-step smoke.
- Prereqs: SDXL checkpoint **already staged on BigMac** (no auto-download), memory headroom checked.
- Work: model-family abstraction in config; SDXL-specific defaults; new run kind.
- Exit: verified 768×768 SDXL PNG on MacBook (CLI + one server path).

## Phase 4 — SDXL 1024
- Goal: full-resolution SDXL.
- Prereqs: Phase 3 stable; confirm 32 GB unified memory is sufficient at 1024.
- Exit: verified 1024×1024 SDXL PNG; documented timings/memory.

## Phase 5 — Flux (only after SDXL stable)
- Goal: Flux generation.
- Prereqs: Phases 3–4 reliable; Flux weights staged; backend/quantization validated.
- Exit: verified Flux PNG; documented constraints.

## Phase 6 — Minimal MacBook UI (only after server workflow is reliable)
- Goal: thin local UI over the existing server scripts (no new inference path).
- Constraints: no Node/pnpm unless Andrew approves the toolchain; could be a static
  HTML page hitting the tunnel, or a tiny TUI wrapping the existing scripts.
- Exit: UI triggers a generation and displays a verified PNG; lifecycle still script-owned.

## Guardrails for any escalation
- Re-run `sdcpp-verify.sh` first; keep `7f0e728` pin unless a new pin is deliberately chosen and recorded.
- Add new model paths to config; never hard-code.
- Extend, don't rewrite, the lifecycle scripts; keep PASS = verified PNG.
- Record every escalation step in `BigMac_SDCPP_Workflow_Bible.md` (append-only).
