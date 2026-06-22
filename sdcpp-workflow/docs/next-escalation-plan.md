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

## Phase 3 — SDXL Turbo staging and smoke
- Goal: prove `stabilityai/sdxl-turbo` on BigMac Metal with a bounded 1-4 step smoke.
- First target: `/Volumes/wc2tb/ImageGen/checkpoints/sdxl-turbo/sd_xl_turbo_1.0_fp16.safetensors`.
- Prereqs: model file already staged on BigMac wc2tb (no auto-download), `bin/sdcpp-model-stage-check.sh` PASS or PARTIAL-with-file, and actual `sd-cli --help` flags inspected.
- Work: SDXL Turbo smoke script, low-step defaults, no SD 1.5 CFG/negative-prompt assumptions unless the local binary proves them.
- Exit: verified 512x512 SDXL Turbo PNG on MacBook; then and only then update the `sdxlTurbo` capability gate.
- Current state: proof is now landed and the gate is expected to follow the smoke cache, not the file presence alone.

## Phase 4 — Flux Schnell staging and smoke
- Goal: prove Flux Schnell can work on BigMac Metal.
- First targets: official `flux1-schnell.safetensors` if staged, `ae.safetensors`, CLIP-L, T5XXL, or stable-diffusion.cpp-compatible GGUF/quantized variants.
- Prereqs: files staged under `/Volumes/wc2tb/ImageGen/flux/`, actual `sd-cli --help` flags inspected for model/VAE/CLIP-L/T5XXL components.
- Work: dedicated Flux smoke script only after flags are known.
- Exit: verified Flux PNG on MacBook; then and only then update the `flux` capability gate.
- Current state: proof is now landed, but the docs should keep the current fp8 candidate choice explicit so the full safetensors checkpoint is not overstated.

## Phase 5 — SDXL base 768 / 1024
- Goal: prove SDXL base after SDXL Turbo / Flux staging work is concrete.
- Prereqs: SDXL checkpoint staged under `/Volumes/wc2tb/ImageGen/checkpoints/sdxl/`, memory headroom checked. Current live state already has `sd_xl_base_1.0.safetensors` staged and nonzero, so this is now the best immediate runtime proof target if `sd-cli --help` supports the needed flags.
- Exit: verified SDXL PNG on MacBook; documented timings/memory.

## Live update — 2026-06-22

- SDXL base is staged and smoke-proven.
- SDXL Turbo is staged and smoke-proven against `sd_xl_turbo_1.0_fp16.safetensors`.
- Flux is staged and smoke-proven against the currently accepted fp8 candidate.
- The stage checker now preserves the proof caches instead of letting later scans erase earlier proof.

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
