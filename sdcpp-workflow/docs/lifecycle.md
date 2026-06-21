# Lifecycle

How the pieces fit together, what state they touch, and how to recover safely.

## Phases

### Verify
`sdcpp-verify.sh` — gate everything before doing work. Read-only. Confirms route,
hostname, remote `$HOME`, repo pin + cleanliness, build dir, binaries, model, and
port availability. Run it anytime; it never changes state.

### CLI generation
`sdcpp-cli-generate.sh` — self-contained: verifies, runs `sd-cli` on BigMac, copies
the PNG back, verifies it locally, and records sha256 on both ends. No server needed.

### Server start
`sdcpp-server-start.sh` — launches `sd-server` in a **named tmux session** on BigMac
and opens an SSH **control-socket** tunnel from a local port. Refuses (without killing)
if a chosen port is occupied or a workflow tunnel already exists.

### Server generation
`sdcpp-server-generate.sh` — talks to the tunnel (`http://127.0.0.1:<local-port>`),
hits one or more API contracts, decodes + verifies the PNG.

### Server stop
`sdcpp-server-stop.sh` — closes **only** the recorded control socket and kills **only**
the recorded tmux session, then verifies both ports closed and the session gone.

### Smoke run
`sdcpp-run-smoke.sh` — chains verify → CLI → server start → server generate → stop, with
automatic safe cleanup if a stage fails after the server was started.

### Cleanup (housekeeping)
`sdcpp-clean-old-runs.sh` — prunes old local `runs/` folders; dry-run by default.

### Batch / seed / UI handoff (Phase 2)
- `sdcpp-batch-generate.sh` — N images with controlled seeds; server mode starts ONE warm server and stops it after unless `--keep-server-running`. Emits a stable `runs/<ts>-batch/` folder (images/records/manifests/report/ui-card).
- `sdcpp-seed-test.sh` — reproducibility proof (same seed twice → SHA256 compare).
- `sdcpp-export-latest-markdown.sh` — read-only: prints the latest run's `ui-run-card.md` + manifest paths for a UI to consume.
- State files and ownership are unchanged; batch/seed reuse the same server-start/stop and only ever touch workflow-owned pieces.

### Optimization (presets / benchmarks)
- `sdcpp-presets.sh` — list/inspect presets (read-only).
- `sdcpp-run-fast.sh` / `sdcpp-run-quality.sh` — one-command preset generation (CLI or warm server).
- `sdcpp-benchmark.sh` — bounded matrix; starts the server ONCE (warm across presets) and stops it after unless `--keep-server-running`. Same ownership/safety rules: only the workflow's own session/socket are touched.
- `sdcpp-benchmark-server-warm.sh` — isolates startup cost from warm per-request time.
- `sdcpp-summarize-benchmarks.sh` — ranks results + recommends (read-only over a TSV).
All optimization commands run `verify` first and write timestamped `runs/<ts>-benchmark*/` dirs with `metrics.tsv` per cell.

## State files (`state/`)
- `current-server-session` — tmux session name of the live workflow server.
- `current-ports.env` — `REMOTE_SERVER_PORT`, `LOCAL_TUNNEL_PORT`, `SESSION`, `REMOTE_LOG`.
- `sdcpp-tunnel.sock` — SSH control socket for the workflow tunnel.

Remote mirrors (on BigMac, under `$HOME/sdcpp-staging/`):
- `server_session.txt`, `server_port.txt`, `logs/sd-server-<session>.log`.

These let `status` and `stop` act surgically on exactly what `start` created — nothing else.

## Ownership boundary (why it's safe)
- The workflow only ever closes the socket it created and kills the session it named.
- It never uses `pkill`/`killall`, never closes other SSH connections, and explicitly
  re-checks that the unrelated port-7860 process is still running after a stop.

## Safe recovery
1. `sdcpp-server-status.sh` — see the truth, change nothing.
2. `sdcpp-server-stop.sh` — idempotent; safe to run even if already stopped.
3. If `stop` reports PARTIAL, follow the surgical steps in `TROUBLESHOOTING.md`
   (close the specific socket, kill the specific session, re-verify).
4. Re-run `sdcpp-verify.sh` before generating again.
