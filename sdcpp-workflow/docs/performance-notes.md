# Performance Notes

Durable observations behind the numbers in `benchmark-results.md`.

## Where the time goes
1. **Model load** (~7–23s) — reading/initializing the 4 GB SD 1.5 checkpoint into
   Metal. Paid every CLI call (cheap when OS page-cached, expensive cold) and once
   per server start.
2. **Sampling** — ~1.2–1.5s per euler_a step at 512². This is the knob presets turn.
3. **VAE decode + encode + transfer** — small, roughly fixed per image (~1–4s).

## Consequences
- **Step count is the primary speed lever.** fast(8) ≈ half of quality(20).
- **Resolution matters too** (thumbnail 384² is cheaper) but we stay at 512² for SD 1.5.
- **Warm server removes reload** from every request after the first; the one-time
  ~23s load is amortized across a session.
- **OS page cache blurs CLI-vs-server** on a single machine: back-to-back CLI calls
  reuse the cached model, so per-image CLI ≈ warm server for the same steps. The
  server still wins for *many* images and for predictable latency.

## Practical guidance
- Quick one-off: `bin/sdcpp-run-fast.sh --mode cli`.
- A working session (several images): start a warm server once and reuse it:
  ```sh
  bin/sdcpp-server-start.sh
  bin/sdcpp-server-generate.sh --preset fast --prompt "..."
  bin/sdcpp-server-generate.sh --preset balanced --prompt "..."
  bin/sdcpp-server-stop.sh
  ```
- Final keeper: `bin/sdcpp-run-quality.sh`.

## Measurement method (boring on purpose)
- Wall-clock via `now_epoch` (prefers `gdate +%s.%N`, falls back to `date +%s.%N`,
  then integer `date +%s`); diff via `awk` (`elapsed_seconds`).
- CLI also extracts the remote `generate_image completed in N.NNs` line for a
  pure-remote figure (excludes ssh/transfer).
- Server records per-request curl time and a separate base64 decode time.
- Every run writes a machine-readable `metrics.tsv`; benchmarks aggregate those.

## Caveats / honesty
- Single-sample timings have run-to-run variance (caching, thermal). Use `--repeats N`
  for averages when it matters.
- We measure **speed, PNG size, and completion**. We do **not** judge aesthetics —
  final visual preference between presets needs human review of the PNGs in `runs/`.
- smoke (1 step) is a path-proof, not an image.

## Gotchas confirmed here
- OpenAI `/v1/images/generations` ignores steps unless embedded via
  `<sd_cpp_extra_args>` (the workflow does this automatically). Without it, every
  OpenAI request runs at the server-default step count (~20) — which initially made
  all server cells look identical (~30s). Fixed.
- Never `--backend metal`. Never trust remote ssh exit codes (use `remote_test`).
  Never touch port 7860. See `optimization.md` / `TROUBLESHOOTING.md`.
