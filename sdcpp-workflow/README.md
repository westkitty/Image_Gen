# BigMac SDCPP Image-Gen Workflow

A small, boring, repeatable operator harness for generating images with
`stable-diffusion.cpp` on **BigMac** (Apple M4 Mac mini, Metal) and pulling
verified PNGs back to **this MacBook**. It packages the one-time proof
(see `docs/proven-state.md`) into safe, scriptable commands.

## What this is
- MacBook-side control scripts that drive BigMac over `ssh westcat`.
- CLI generation (`sd-cli`) and server-API generation (OpenAI + SD WebUI + optional native async).
- Safe server/tunnel lifecycle (start / status / stop) that only ever touches **its own** tmux session and SSH control socket.
- Every image is verified on the MacBook with `file` + `ls -lh` before being called a success.
- Append-only project ledger: `BigMac_SDCPP_Workflow_Bible.md`.

## What this is NOT
- Not full SDXL / Flux / LoRA / ControlNet / ComfyUI parity. SD 1.5 @ 512×512 remains the main generation path; bounded SDXL base smoke proof is available separately.
- Not a model downloader (weights are staged manually on BigMac).
- Not a UI. Not a Python pipeline. No Node/pnpm.
- Not a process manager for anything it didn't start.

## Proven baseline
- BigMac: Apple M4 Mac mini, 32 GB, macOS 26.5.1, hostname `bigmac`, `$HOME=/Users/bigmac`.
- Repo `$HOME/stable-diffusion.cpp` pinned clean at commit `7f0e728`.
- Out-of-repo Metal build; pointer at `$HOME/sdcpp-staging/build_dir.txt`.
- Model `$HOME/sdcpp-staging/models/v1-5-pruned-emaonly.safetensors`.
- CLI + 3 server APIs proved working. Full details in `docs/proven-state.md`.

## Requirements
- MacBook: `ssh`, `scp`, `jq`, `curl`, `base64`, `lsof`, `file`, `date`, `shasum` (all standard / Homebrew).
- A working `ssh westcat` route (Tailscale up — see TROUBLESHOOTING.md).
- BigMac: `tmux` (auto-checked; this workflow never auto-installs).

## Quick command examples
```sh
cd /Users/andrew/Image_Gen/sdcpp-workflow

# Full end-to-end smoke (verify -> CLI -> server -> stop):
bin/sdcpp-run-smoke.sh

# Just verify the proven state (read-only):
bin/sdcpp-verify.sh

# CLI-only generation:
bin/sdcpp-cli-generate.sh --prompt "a lovely cat" --steps 20

# Server flow:
bin/sdcpp-server-start.sh
bin/sdcpp-server-generate.sh --prompt "a lovely cat" --api openai
bin/sdcpp-server-status.sh
bin/sdcpp-server-stop.sh

# Open the newest result:
bin/sdcpp-open-latest.sh
```

## Speed presets & optimization
Presets live in `config/presets.env`: `smoke` (1 step, proof only), `thumbnail`
(384², 4), `fast` (8), `balanced` (16), `quality` (20), `quality_plus` (30).
Apply with `--preset NAME`; explicit flags override.

```sh
bin/sdcpp-run-fast.sh --mode cli --prompt "..."          # ~15s, daily driver
bin/sdcpp-run-quality.sh --mode both --prompt "..."      # quality, CLI + warm server
bin/sdcpp-benchmark.sh --modes both --presets smoke,fast,balanced,quality
bin/sdcpp-benchmark-server-warm.sh                       # warm throughput
bin/sdcpp-summarize-benchmarks.sh                        # rank + recommend
```

Measured defaults (M4, 512², euler_a): **fast ≈ 15s**, balanced ≈ 25s, quality ≈ 30s;
warm-server startup ≈ 23s (one-time). **Use CLI for one-offs, a warm server for many
images in a session.** Details: `docs/optimization.md`, `docs/benchmark-results.md`,
`docs/performance-notes.md`.

## Seed & batch controls (Phase 2)
```sh
bin/sdcpp-cli-generate.sh --preset fast --seed 42 --prompt "..."        # deterministic single
bin/sdcpp-batch-generate.sh --mode cli --count 3 --preset fast \
  --seed-mode increment --seed-start 42 --prompt "..."                  # batch with manifest
bin/sdcpp-seed-test.sh --preset smoke --seed 424242 --mode cli          # prove reproducibility
bin/sdcpp-export-latest-markdown.sh --type batch                        # UI handoff: paths + card
```
- `--seed N|random|fixed` on all generators (fixed=42; random=recorded). Reports show the actual seed or `uncontrolled`.
- Batch writes a stable folder: `images/`, `records/`, `batch-manifest.json`/`.tsv`, `batch-report.md`, `ui-run-card.md`.
- **CLI is verified deterministic** (same seed → identical SHA256). For server, prefer `--api sdapi`/`native` for direct seed control.
- Markdown + JSON outputs are the UI integration boundary — see `docs/ui-integration-contract.md`, `docs/markdown-output-contract.md`, `docs/seed-batch-controls.md`. **No UI is built yet.**

## Where outputs go
- Every command makes a timestamped folder under `runs/`, e.g. `runs/20260620-181500-cli/`.
- Each run dir holds: metadata, logs, API response JSON, decoded PNG(s), and a per-run report `*-report.md`.
- Live lifecycle state lives in `state/` (current session, ports, SSH control socket).

## Start / stop the server safely
- `bin/sdcpp-server-start.sh` verifies state, checks ports (and **stops** rather than killing if a port is busy), launches `sd-server` in a named tmux session, and opens an SSH control-socket tunnel.
- `bin/sdcpp-server-stop.sh` closes **only** the workflow's control socket and kills **only** the recorded tmux session, then verifies shutdown.
- `bin/sdcpp-server-status.sh` reports everything and changes nothing.

## Safety rules (enforced by the scripts)
- Never `--backend metal` (it fails in this build).
- Never broad-kill (`pkill`, `killall`); only the workflow's own pieces.
- Never touch the unrelated process that may hold port **7860**.
- Never use `/Volumes/wc2tb` for routine inference or model growth. The bounded SDXL base proof is the only explicit proof-only exception and is tightly scripted. Never download weights. Never auto-install packages.
- Remote `$HOME` is discovered/expanded on BigMac, never hard-guessed locally.

## Known gotchas
- **Do not use `--backend metal`.** Metal auto-selects as device `MTL0 (Apple M4)` when `--backend` is omitted. Adding the flag yields `backend 'metal' was not found`.
- **Port 7860 may be occupied** by an unrelated Python process — do not kill it. The workflow defaults to remote `7870` / local `17870` and both ports are configurable (`--remote-port`, `--local-port`, or `config/sdcpp.env`).

## Inspecting status / recovering
- `bin/sdcpp-server-status.sh` — full picture, read-only.
- Stuck tunnel/server? `bin/sdcpp-server-stop.sh` (safe, idempotent). If it reports PARTIAL, see `TROUBLESHOOTING.md` for the exact, surgical recovery steps.

## Configuration
- Defaults live in `config/sdcpp.env` (auto-created from `config/sdcpp.env.example` on first run; never overwritten).
- Remote paths there keep a literal `$HOME` on purpose — they are expanded on BigMac.

See `QUICKSTART.md`, `TROUBLESHOOTING.md`, and `docs/` for more.
