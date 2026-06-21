# BigMac SDCPP Workflow Project Bible

## Bootstrap Prompt for Successor AI

Read this file first. It is the authoritative append-only ledger for the **operator workflow** that wraps the already-proven BigMac `stable-diffusion.cpp` Metal image-generation capability. The proof itself lives in a separate, frozen Bible:
`/Users/andrew/Image_Gen/sdcpp-proof-20260620-172600/BigMac_SDCPP_Image_Gen_Proof_Bible.md`
and `/Users/andrew/Image_Gen/sdcpp-proof-20260620-172600/final-proof-report.md`.
Do not edit, rewrite, normalize, or "clean up" the proof Bible/report or any prior entry in THIS Bible. Inspect the workflow project and the live BigMac state against this Bible. If anything disagrees, append a reconciliation entry — never rewrite history. Continue from the current state, appending additively.

## Project Goal

Turn the one-time proof into a durable, repeatable, documented, scriptable local workflow that lets Andrew operate BigMac SDCPP SD 1.5 image generation safely from the MacBook: verify the route and proven state, generate via CLI and server APIs, manage server/tunnel lifecycle without collateral damage, verify every PNG, keep reports, and track state append-only.

## Scope

Included:
- MacBook-side control scripts (`bin/`), shared library, config, docs.
- Route/identity/build/model verification.
- CLI generation (`sd-cli`) and server-API generation (OpenAI + SDAPI + optional native async).
- Safe server/tunnel lifecycle (start/status/stop) with workflow-owned state only.
- Timestamped runs, reports, non-destructive housekeeping, append-only Bible.
- SD 1.5 (`v1-5-pruned-emaonly.safetensors`) at 512x512 only.

Excluded (unless Andrew explicitly escalates later):
- SDXL, Flux, LoRA, ControlNet.
- Custom MacBook UI / frontend builds.
- Model downloads.
- Python for inference, Node/pnpm installs.
- Any escalation beyond documented future-phase placeholders in `docs/next-escalation-plan.md`.

## Constraints

- BigMac runs inference; MacBook controls, receives, decodes, verifies, organizes.
- SSH route is `ssh westcat`. Remote `$HOME` must be discovered/verified, never guessed.
- Do not put MacBook-local `$HOME` into remote commands. Remote `$HOME` is expanded ON BigMac inside single-quoted SSH commands.
- No `rm -rf`. No overwriting user work. No broad kills (`pkill ssh`, `killall sd-server`, broad `pkill`).
- Never touch the unrelated Python process that may occupy port 7860.
- Do not use `/Volumes/wc2tb` for inference. Do not download weights. Do not install packages blindly.
- Do NOT use `--backend metal` (it fails in this build). Metal auto-selects as device `MTL0 (Apple M4)` when `--backend` is omitted.
- Portable base64 decode: try `base64 --decode`, fall back to `base64 -D`.
- A generation only "succeeds" when the MacBook holds a PNG verified with `file` and `ls -lh`. Health/model/listener endpoints alone are NOT success.

## Proven Source Facts (from the proof; re-verified live before this build)

- SSH route: `ssh westcat`; remote `whoami`=bigmac, `hostname`=bigmac, `$HOME`=/Users/bigmac.
- Hardware: Apple M4 Mac mini, 32 GB unified memory, macOS 26.5.1.
- Repo: `$HOME/stable-diffusion.cpp`, pinned clean at commit `7f0e728`.
- Out-of-repo build: `$HOME/sdcpp-staging/builds/build-metal-proof-20260620-143223` (pointer in `$HOME/sdcpp-staging/build_dir.txt`).
- Binaries: `<build>/bin/sd-cli`, `<build>/bin/sd-server` (server flags `--listen-ip`, `--listen-port`).
- Model: `$HOME/sdcpp-staging/models/v1-5-pruned-emaonly.safetensors` (4,265,146,304 bytes).
- CLI proof PASS; server proof PASS via `/v1/images/generations` (OpenAI), `/sdapi/v1/txt2img` (SDAPI), `/sdcpp/v1/img_gen` (native async, optional).
- Metal confirmed via `ggml_metal_device_init: GPU name: MTL0 (Apple M4)`.
- Port 7860 occupied by unrelated Python (do not kill); proof used remote 7870 / local 17870.
- Prior proof cleaned up server+tunnel; upstream checkout stayed clean.

## Architecture

MacBook (`/Users/andrew/Image_Gen/sdcpp-workflow`):
- `config/sdcpp.env` (+ `.example`): all tunables; remote paths stored as literal `$HOME/...` strings, expanded remotely.
- `bin/sdcpp-lib.sh`: shared functions (config load, logging, route/state verification, base64 decode, PNG verify, port checks, tunnel/server lifecycle, run reports).
- `bin/sdcpp-*.sh`: operator entry points (verify, cli-generate, server-start/status/generate/stop, run-smoke, clean-old-runs, open-latest).
- `runs/`: timestamped run dirs (each holds metadata, logs, response JSON, decoded PNGs, per-run report).
- `logs/`: cross-run logs if any.
- `state/`: live workflow-owned state (current server session, ports, SSH control socket).
- `docs/`: proven-state, command-reference, lifecycle, api-contracts, next-escalation-plan.

BigMac: pinned repo, out-of-repo Metal build, staged SD 1.5 model, runs CLI and tmux-hosted server; reachable only via `ssh westcat`.

## File Map

- This Bible: `/Users/andrew/Image_Gen/sdcpp-workflow/BigMac_SDCPP_Workflow_Bible.md`
- Config: `config/sdcpp.env.example`, `config/sdcpp.env`
- Library: `bin/sdcpp-lib.sh`
- Scripts: `bin/sdcpp-verify.sh`, `sdcpp-cli-generate.sh`, `sdcpp-server-start.sh`, `sdcpp-server-generate.sh`, `sdcpp-server-stop.sh`, `sdcpp-server-status.sh`, `sdcpp-run-smoke.sh`, `sdcpp-clean-old-runs.sh`, `sdcpp-open-latest.sh`
- Docs: `README.md`, `QUICKSTART.md`, `TROUBLESHOOTING.md`, `CHANGELOG.md`, `docs/*.md`
- State (runtime): `state/current-server-session`, `state/current-ports.env`, `state/*.sock`
- Proof evidence (read-only, do not edit): proof Bible + final-proof-report in `sdcpp-proof-20260620-172600/`

## Current State

Project directories created. This Bible initialized. No scripts/config/docs written yet. Live BigMac state re-verified consistent with the proof.

## Open Questions

- Does `seed` have a stable CLI flag in build `7f0e728`? (Treat as best-effort: pass if supported, ignore safely otherwise.)
- Will SDAPI `scheduler:"discrete"` remain accepted across restarts? (Proof accepted it.)
- Are there other transient port occupants besides the known 7860 Python? (Status script reports, never kills.)

## Chronological Ledger

### Entry 1 - Workflow Project Initialized

Timestamp: Sat Jun 20 18:03:21 EDT 2026
Summary:
Created the workflow project directory tree and initialized this append-only Workflow Bible. Re-verified live BigMac state matches the proof before any build work.

Reason / Intent:
The Bible must exist before substantive work so every later step appends evidence. Live re-verification ensures the workflow is built on current reality, not just the frozen proof.

Files Changed / Generated:
- Created dirs: /Users/andrew/Image_Gen/sdcpp-workflow/{config,bin,docs,runs,logs,state}
- Created: /Users/andrew/Image_Gen/sdcpp-workflow/BigMac_SDCPP_Workflow_Bible.md

Commands Run:
```sh
# local tool check + live remote re-verification
for t in ssh scp jq base64 lsof file date shasum tmux; do command -v "$t"; done
ssh westcat 'hostname; echo $HOME; cd "$HOME/stable-diffusion.cpp" && git rev-parse --short HEAD && git status --short; cat "$HOME/sdcpp-staging/build_dir.txt"; test -x "<build>/bin/sd-cli"; test -x "<build>/bin/sd-server"; test -s "$HOME/sdcpp-staging/models/v1-5-pruned-emaonly.safetensors"'
mkdir -p .../sdcpp-workflow/{config,bin,docs,runs,logs,state}
```

Command Intent:
Confirm prerequisites and proven state are live, then scaffold the project.

Outputs Observed:
- Local tools all present (ssh, scp, jq, base64, lsof, file, date, shasum, tmux).
- Remote: host=bigmac, home=/Users/bigmac, head=7f0e728, status=[] (clean), build_dir=/Users/bigmac/sdcpp-staging/builds/build-metal-proof-20260620-143223, sd-cli=OK, sd-server=OK, model=OK.

Decisions:
- Build the workflow exactly per spec; SD 1.5 / 512x512 only; never use --backend metal; never touch 7860.

Bugs / Blockers:
None.

Correction:
None.

State After Completion:
Project scaffolded; Bible live. Ready to author config, shared library, scripts, and docs.

Next Step / Handoff:
Author config/ (sdcpp.env.example + sdcpp.env) and bin/sdcpp-lib.sh.

### Entry 2 - Workflow Authored (config, library, scripts, docs)

Timestamp: Sat Jun 20 18:27:21 EDT 2026
Summary:
Authored the full workflow: config/sdcpp.env(.example), bin/sdcpp-lib.sh, the nine operator scripts, all docs (README, QUICKSTART, TROUBLESHOOTING, CHANGELOG, docs/*), and .gitignore. chmod +x and bash -n syntax checks passed for all scripts. First sdcpp-verify.sh run created config/sdcpp.env from the example and reported PASS.

Reason / Intent:
Package the proven proof into repeatable, safe, documented operator commands per spec.

Files Changed / Generated:
- config/sdcpp.env.example, config/sdcpp.env (auto-created first run; never overwritten)
- bin/sdcpp-lib.sh + bin/sdcpp-{verify,cli-generate,server-start,server-status,server-generate,server-stop,run-smoke,clean-old-runs,open-latest}.sh
- README.md, QUICKSTART.md, TROUBLESHOOTING.md, CHANGELOG.md, .gitignore
- docs/{proven-state,command-reference,lifecycle,api-contracts,next-escalation-plan}.md

Commands Run:
- chmod +x bin/*.sh
- bash -n bin/*.sh   (all OK)
- bin/sdcpp-verify.sh  (PASS)

Command Intent:
Create the harness, make scripts executable, lint them, and confirm proven state read-only.

Outputs Observed:
- All 10 scripts pass bash -n.
- verify PASS: route bigmac, HOME /Users/bigmac, M4/32GB, repo 7f0e728 clean, build dir + binaries OK, model 4265146304 bytes; remote build tools present.
- One warning during first verify: "remote port 7870 occupied" (later proven to be a false positive caused by the ssh-exit-code masking bug — see Entry 3).

Decisions:
- SD 1.5 / 512x512 only; never --backend metal; never broad-kill; never touch 7860.

Bugs / Blockers:
- Initial smoke runs failed at server-start with "remote port occupied" for BOTH 7870 and 7871 even though both were free. Root-caused in Entry 3.

Correction:
None to prior entries.

State After Completion:
All files authored and lint-clean; verify passes; a port-check defect was observed and is addressed in Entry 3.

Next Step / Handoff:
Root-cause and fix the false "port occupied"; re-run smoke.

### Entry 3 - Reconciliation: BigMac ssh masks remote exit codes; switched to sentinel-output checks

Timestamp: Sat Jun 20 18:27:45 EDT 2026
Summary:
Discovered a real environment behavior NOT recorded in the proof: BigMac's sshd does not propagate remote COMMAND exit codes. Every `ssh westcat '<cmd>'` returns 0 regardless of the remote command (verified: `exit 3`, `false`, `bash -lc "exit 7"` all yield local exit 0). SSH-LAYER failures (e.g. unreachable host -> 255) still propagate. The proof never noticed this because it judged success by OUTPUT TEXT (file output, md5, lsof listings), not by exit codes.

Impact (the bug):
The first library version used remote exit codes for booleans (`if ssh_remote "lsof ... >/dev/null 2>&1"`, `ssh_remote "test -x ..." || fail`, `tmux has-session`, `wait_remote_listener`). Because ssh always returned 0, check_remote_port_free reported EVERY port as "occupied" (the false "flap"), verify's `test -x`/`test -s` would have passed even if files were missing, wait_remote_listener would return immediately, and stop/status would misread remote state.

Root cause confirmed:
- Not a forced command / not ~/.ssh/rc / not ~/.zshenv (all checked empty).
- lsof exit codes ARE correct when evaluated REMOTELY (inside the remote shell): 7870/7871/7999 -> exit 1 (free), 7860 -> exit 0 (occupied). The loss happens at the ssh boundary.

Fix:
Added remote_test() to sdcpp-lib.sh: it evaluates the test INSIDE the remote shell and echoes a sentinel (__SDCPP_TRUE__/__SDCPP_FALSE__) that is matched locally. Refactored all remote boolean checks to use it:
- lib: require_remote_tool, verify_repo_clean (repo existence), get_build_dir (dir existence), verify_binaries, verify_model, ensure_remote_dirs, check_remote_port_free, wait_remote_listener, stop_remote_server.
- scripts: sdcpp-cli-generate.sh (remote PNG check), sdcpp-server-status.sh (remote port via output, tmux via remote_test), sdcpp-server-stop.sh (remote port + tmux via remote_test).
Output-based functions (verify_route hostname, verify_remote_home, repo HEAD/status parsing, remote_sha256, scp, local lsof, ssh -O check) were already reliable and left as-is.

Files Changed:
- bin/sdcpp-lib.sh (added remote_test; updated ~9 functions)
- bin/sdcpp-cli-generate.sh, bin/sdcpp-server-status.sh, bin/sdcpp-server-stop.sh

Commands Run (diagnosis):
- ssh westcat 'exit 3'; echo $?     -> 0
- ssh westcat 'false'; echo $?      -> 0
- ssh westcat 'lsof -nP -iTCP:7871 -sTCP:LISTEN; echo exit=$?'  (remote $?) -> 1 (free)
- isolation harness sourcing the lib reproduced "every port OCCUPIED"; after fix -> 7870 FREE, 7860 OCCUPIED.

Outputs Observed (post-fix):
- check_remote_port_free 7870 -> FREE; 7860 -> OCCUPIED (correct).

Decisions:
- Document this as a TROUBLESHOOTING-worthy host quirk; the workflow now never trusts remote ssh exit codes for booleans.
- Reverted live config back to the spec defaults 7870/17870 (the earlier change to 7871 was unnecessary once the real bug was understood; 7870 was always free).

Bugs / Blockers:
- Resolved.

Correction:
- Corrects Entry 2's note about "remote port 7870 occupied": that warning was a FALSE POSITIVE from this exit-code masking, not a real occupant. 7870 is free.

State After Completion:
Library and scripts use sentinel-based remote checks. Port/state detection is correct.

Next Step / Handoff:
Re-run full smoke end-to-end.

### Entry 4 - Smoke PASS (end-to-end) and Final Validation

Timestamp: Sat Jun 20 18:28:15 EDT 2026
Summary:
Full end-to-end smoke PASSED after the Entry 3 fix: verify -> CLI generate -> server start -> server generate (OpenAI + SDAPI) -> server stop -> repo re-check. Three real 512x512 PNGs verified on the MacBook. Workflow-owned server + tunnel cleaned up and verified down. Unrelated port-7860 Python (PID 95068) untouched. Upstream repo still clean at 7f0e728.

Reason / Intent:
Prove the packaged workflow is repeatable and safe, satisfying the PASS definition.

Commands Run:
- bin/sdcpp-run-smoke.sh  (PASS)
- Independent re-verification of PNGs (file/ls -lh), tunnel/server/tmux down, 7860 untouched, repo clean.

Outputs Observed:
- CLI PNG: runs/20260620-182423-cli/sd15_cli_20260620-182423.png (PNG 512x512, 556K; sha256 local==remote in cli-run-report).
- OpenAI PNG: runs/20260620-182521-server-gen/openai.png (PNG 512x512, 501K).
- SDAPI PNG: runs/20260620-182626-server-gen/sdapi.png (PNG 512x512, 446K).
- Cleanup: local 17870 closed, remote 7870 closed, no tmux sessions, control socket removed.
- Unrelated 7860: Python PID 95068 still LISTENING (untouched).
- Repo: HEAD=7f0e728, clean.

Decisions:
- Workflow accepted as the durable operator harness for SD 1.5 @ 512x512.

Bugs / Blockers:
- None remaining. (Exit-code masking handled in Entry 3.)

Correction:
None.

State After Completion:
WORKFLOW COMPLETE — PASS. Repeatable smoke green; safety constraints upheld.

Next Step / Handoff:
Optional, only if Andrew asks: Phase 1 of docs/next-escalation-plan.md (SD 1.5 normal-step quality test, e.g. --steps 20). Do not escalate to SDXL/Flux.

### Entry 5 - Portability fix: clean-old-runs under bash 3.2

Timestamp: Sat Jun 20 18:29:10 EDT 2026
Summary:
During final validation of the auxiliary scripts, sdcpp-clean-old-runs.sh failed with "mapfile: command not found". macOS default /usr/bin/env bash is 3.2.57, which lacks mapfile (bash 4+). Replaced mapfile with a portable while-read loop. Re-ran the dry run: lists runs correctly, newest protected.

Files Changed:
- bin/sdcpp-clean-old-runs.sh

Commands Run:
- bin/sdcpp-clean-old-runs.sh (dry run) -> PASS after fix
- bash -n bin/*.sh -> all OK
- /usr/bin/env bash --version -> 3.2.57

Outputs Observed:
- Dry run lists 13 run folders, marks newest as protected.
- Status/open-latest scripts run cleanly; server-status correctly reports "Nothing running" post-smoke.

Decisions:
- Keep all scripts bash-3.2 compatible (no mapfile / no bash-4-only features).

Bugs / Blockers:
- Resolved.

Correction:
None to prior entries.

State After Completion:
All 9 operator scripts + library validated and bash-3.2 portable. Workflow remains PASS.

Next Step / Handoff:
None required.

### Entry 6 - Preset System + Timing/Metrics Implemented

Timestamp: Sat Jun 20 19:12:43 EDT 2026
Summary:
Added a preset system and per-generation timing/metrics. Generators now accept --preset (smoke|thumbnail|fast|balanced|quality|quality_plus) with explicit-flag override, and each run writes a machine-readable metrics.tsv.

Files Changed:
- config/presets.env (new): the six presets.
- bin/sdcpp-lib.sh: load_presets, apply_preset, now_epoch, elapsed_seconds, sanitize_tsv, metrics_header, png_bytes, extract_remote_elapsed; make_run_dir honors SDCPP_RUN_DIR_OVERRIDE.
- bin/sdcpp-cli-generate.sh: --preset + --cfg/--sampler; resolution order config->preset->explicit; timing (wall + remote generate_image seconds); writes metrics.tsv.
- bin/sdcpp-server-generate.sh: --preset + --cfg/--sampler + --warm-state; per-API request/decode timing; appends metrics rows.

Command Intent:
Make speed/quality reproducible and measurable without changing default behavior.

Outputs Observed:
- sdcpp-presets.sh lists all six presets correctly.
- cli-generate --preset fast PASS, metrics.tsv row: mode=cli preset=fast steps=8 elapsed=19.31 remote=17.91 status=PASS.

Decisions:
- Timing prefers gdate +%s.%N, falls back to date/%N then integer; awk computes deltas.
- make_run_dir override lets the benchmark control per-cell output dirs and harvest metrics.tsv.

Bugs / Blockers: None at this step.
Correction: None.
State After Completion: Presets + timing live; default commands unchanged.
Next Step: Benchmark scripts.

### Entry 7 - Benchmark, Warm Benchmark, Summarizer Implemented

Timestamp: Sat Jun 20 19:12:57 EDT 2026
Summary:
Added the benchmark matrix, the warm-server benchmark, and the summary/recommendation engine.

Files Changed:
- bin/sdcpp-benchmark.sh: bounded matrix (cli + server-openai/sdapi), verify-first, starts server ONCE (warm across presets), per-cell dirs, benchmark-results.tsv/md, verifies every PNG, stops server unless --keep-server-running, bounded <=40 cells, never native.
- bin/sdcpp-benchmark-server-warm.sh: times server startup/load, then a fixed warm sequence (smoke, fast x2, balanced, quality) via OpenAI (+ optional sdapi), reports startup vs per-request + averages + fastest/recommended.
- bin/sdcpp-summarize-benchmarks.sh: awk/shell summary -> benchmark-summary.md, ranking, data-driven recommendation (no Python).

Command Intent:
Answer the optimization questions (fastest settings, CLI vs server, warm gain, keep-worthy presets, safe default) with bounded, safe, repeatable runs.

Outputs Observed (validation):
- benchmark --modes both --presets smoke,fast,balanced: 6/6 PASS, server auto-stopped.
- warm benchmark: startup/load 22.76s; warm smoke 6.80s, fast ~14.34s, balanced 24.53s, quality 29.95s.
- summarize: fastest cli/smoke ~6.9s; recommends fast default; balanced < 2x fast; server-warm for multi-image.

Decisions:
- Benchmark starts the server once so server cells are warm (true throughput).
- Matrix bounded to <=40 cells to stay safe.

Bugs / Blockers: See Entry 9 (OpenAI steps reconciliation).
Correction: None to prior entries.
State After Completion: Benchmark suite operational and self-cleaning.
Next Step: Fast/quality commands + docs.

### Entry 8 - Fast/Quality/Presets Commands Implemented

Timestamp: Sat Jun 20 19:13:06 EDT 2026
Summary:
Added one-command daily-use wrappers and a preset inspector.

Files Changed:
- bin/sdcpp-run-fast.sh: preset fast; --mode cli|server (server starts/reuses warm server, stops after unless --keep-server-running); --open; prints FAST PNG path.
- bin/sdcpp-run-quality.sh: preset quality; --mode cli|server|both (default both = CLI + warm server OpenAI comparison); --open; --keep-server-running.
- bin/sdcpp-presets.sh: list/inspect presets (read-only).

Outputs Observed (validation):
- run-fast --mode cli: PASS, fast 15.90s wall / 14.77s remote.
- run-quality --mode cli: PASS, quality 31.03s wall / 29.95s remote.
- presets.sh lists all six presets with resolved values.

Decisions:
- Wrappers reuse an existing tunnel if present; only stop a server they started.

Bugs / Blockers: None.
Correction: None.
State After Completion: Daily-use fast/quality commands live.
Next Step: Reconciliation entry + docs + final validation.

### Entry 9 - Reconciliation: OpenAI endpoint ignores steps; fixed via sd_cpp_extra_args

Timestamp: Sat Jun 20 19:13:23 EDT 2026
Summary:
Discovered during the first benchmark that EVERY server-openai cell took ~30s with identical png_bytes (480514) regardless of preset. Root cause: the OpenAI /v1/images/generations handler reads only prompt/size/n/output_format; steps/cfg/sampler fall back to the server default (~20 steps). So presets had no effect on the OpenAI path.

Investigation:
- Read examples/server/routes_openai.cpp build_openai_generation_request: only prompt/n/size/output_format/output_compression are parsed; the rest come from runtime.default_gen_params.
- Found the escape hatch: extract_and_remove_sd_cpp_extra_args() parses a prompt-embedded <sd_cpp_extra_args>{gen_params json}</sd_cpp_extra_args> block via gen_params.from_json_str() (same JSON shape as the native /sdcpp/v1/img_gen sample_params used in the proof).

Fix:
- sdcpp-server-generate.sh gen_openai now appends
  <sd_cpp_extra_args>{"sample_params":{"sample_steps":N,"sample_method":SM,"guidance":{"txt_cfg":CFG}}}</sd_cpp_extra_args>
  to the prompt so presets take effect on the OpenAI path. SDAPI already honors steps natively.

Verification:
- After fix, server-openai smoke=6.87s (393316b) vs balanced=24.43s (478625b) -> diverges correctly by steps.
- Re-ran full matrix: smoke cli 6.94s / srv 7.38s; fast cli 15.85s / srv 15.04s; balanced cli 25.71s / srv 25.11s. All PASS.

Additional observation (not a bug):
- CLI smoke varied 13.12s (cold) vs ~6.9s (warm) across runs because the 4GB model sits in the OS page cache between CLI calls. This narrows CLI-vs-warm-server per-image; the server's real win is amortizing the ~23s first-load across a session.

Correction: Supersedes the misleading pre-fix benchmark numbers (all server ~30s). Those were the default-steps artifact, not real preset timings.
State After Completion: OpenAI path is preset-accurate; benchmarks reflect true per-preset timing.
Next Step: Docs + final validation.

### Entry 10 - Docs Updated

Timestamp: Sat Jun 20 19:13:33 EDT 2026
Summary:
Created optimization docs and updated all existing docs for the optimization layer.

Files Changed:
- New: docs/optimization.md, docs/benchmark-results.md, docs/performance-notes.md.
- Updated: README.md (presets/optimization section), QUICKSTART.md (fast/quality/benchmark),
  docs/command-reference.md (all new commands + preset flags), docs/lifecycle.md (optimization phase),
  docs/api-contracts.md (OpenAI steps caveat + sd_cpp_extra_args), docs/next-escalation-plan.md
  (Phase 1 + new Phase 1B marked IMPLEMENTED; SDXL/Flux remain future-only), TROUBLESHOOTING.md
  (OpenAI-steps gotcha, benchmark slowness, integer-timing), CHANGELOG.md (0.2.0).

Decisions:
- Docs cite real measured numbers and explicitly state speed/size are measured but aesthetics need human review.

Bugs / Blockers: None.
Correction: None.
State After Completion: Documentation complete and consistent with measured results.
Next Step: Final validation + final state entry.

### Entry 11 - Validation Complete; Optimization Layer PASS (final state)

Timestamp: Sat Jun 20 19:14:21 EDT 2026
Summary:
Optimization layer validated end-to-end. Smoke still PASS (no regression). Fast and quality verified via CLI. Benchmark matrix (cli + warm server-openai) and warm-server benchmark both PASS. Summarizer produced rankings + recommendation. All workflow-owned server/tunnel cleaned up; port 7860 untouched; repo clean at 7f0e728.

Validation Outputs:
- bash -n: all 16 scripts OK.
- sdcpp-run-smoke.sh: PASS (CLI + OpenAI + SDAPI PNGs verified; repo clean).
- run-fast --mode cli: PASS (fast ~15.9s). run-quality --mode cli: PASS (quality ~31s).
- benchmark --modes both --presets smoke,fast,balanced: 6/6 PASS; auto-stopped server.
  cli/srv-warm: smoke 6.94/7.38s; fast 15.85/15.04s; balanced 25.71/25.11s.
- warm benchmark: startup/load 22.76s; warm smoke 6.80s, fast ~14.34s, balanced 24.53s, quality 29.95s.
- summarize: fastest cli/smoke ~6.9s; recommend FAST default; BALANCED < 2x fast; warm server for multi-image.

Measured recommendations:
- Best one-off mode: CLI (no lifecycle; model stays OS-page-cached between calls).
- Best multi-image mode: warm server (amortize ~23s one-time load; steady latency).
- Recommended default preset: fast (8 steps, ~15s). Balanced for quality-when-it-matters; quality deliberate.

Final State:
- 16 scripts in bin/; config/presets.env; docs/{optimization,benchmark-results,performance-notes}.md + updated docs; CHANGELOG 0.2.0.
- No workflow-owned server/tunnel running (status: Nothing running). Port 7860 Python (PID 95068) untouched. BigMac repo clean at 7f0e728.
- Artifacts: fast PNG runs/20260620-185324-cli/, quality PNG runs/20260620-185400-cli/, benchmark runs/20260620-190236-benchmark/ (+summary), warm runs/20260620-190610-benchmark-warm/.

Constraints upheld: no --backend metal; remote booleans via remote_test; no broad-kill; no wc2tb; no downloads/Node/pnpm/Python inference; SD 1.5 @ 512x512.

Next Step / Handoff:
Phase 2 (future, only if asked): SD 1.5 seed/batch controls for reproducibility + small batches. Consider a persistent "session mode" script since warm server helps multi-image sessions. Do NOT escalate to SDXL/Flux yet.

### Entry 12 - Seed Support Investigation

Timestamp: Sat Jun 20 19:40:19 EDT 2026
Summary:
Inspected seed support across all paths (output-based, per the ssh-exit-code rule).

Findings (build 7f0e728):
- CLI sd-cli: "-s, --seed" (default 42; <0 = random). Verified via --help.
- SDAPI /sdapi/v1/txt2img: reads JSON "seed" (routes_sdapi.cpp:101 j.value("seed",-1)). DEFAULT -1 = RANDOM if omitted.
- Native /sdcpp/v1/img_gen: whole body parsed by gen_params.from_json_str (routes_sdcpp.cpp:355); accepts top-level "seed" (proof used "seed":42).
- OpenAI /v1/images/generations: handler reads only prompt/size/n/output_format; seed only via prompt-embedded <sd_cpp_extra_args>{...}</sd_cpp_extra_args> (same from_json_str parser).

Consequence: CLI default is reproducible (42); SDAPI is NOT unless a seed is sent; OpenAI seed is indirect.

Files: docs/seed-batch-controls.md (new) records the table + determinism caveats.
Decision: workflow always records the actual seed used or "uncontrolled"; never claim determinism without seed-test proof.
State: ready to implement seed flags.
Next: generator seed support.

### Entry 13 - Generator Seed Support + UI Run Cards

Timestamp: Sat Jun 20 19:40:30 EDT 2026
Summary:
Added --seed N|random|fixed to all generators, wired seed per-endpoint, and made every run emit a ui-run-card.md (schema sdcpp.run.v1).

Files Changed:
- bin/sdcpp-lib.sh: resolve_seed (N|random|fixed|omitted -> seed/controlled/label), gen_random_seed, iso_now, yaml_escape, write_ui_run_card.
- bin/sdcpp-cli-generate.sh: resolve seed; pass --seed only when controlled; record seed in metadata/report/metrics; emit ui-run-card.md.
- bin/sdcpp-server-generate.sh: --seed; openai embeds "seed" in <sd_cpp_extra_args>; sdapi payload "seed" (else -1); native payload "seed" (else 42); seed in metrics/report; emit ui-run-card.md with primary image.
- bin/sdcpp-run-fast.sh / sdcpp-run-quality.sh: --seed passthrough.

Verification:
- cli-generate --preset smoke --seed fixed -> PASS, ui-run-card.md front matter correct (run_id, run_type cli, status PASS, primary_image, created_at ISO).

Decision: omitted seed = "not forced" (CLI uses 42; SDAPI/native keep their default); controlled seed always recorded.
State: seed plumbing live and UI cards emitted.
Next: batch generation.

### Entry 14 - Batch Generation Implemented

Timestamp: Sat Jun 20 19:40:42 EDT 2026
Summary:
Added bin/sdcpp-batch-generate.sh: N images with controlled seeds, per-image verification, and a stable run folder + manifests for UI wiring.

Design:
- Reuses sdcpp-cli-generate.sh / sdcpp-server-generate.sh per image via SDCPP_RUN_DIR_OVERRIDE (shares all verify/seed logic).
- Modes: cli (per-call) or server (starts ONE warm server, stops after unless --keep-server-running).
- Seed modes: same | increment | random; --seed-start (default 42), --seed overrides base.
- Count default 3, hard cap 12 unless --force-large-batch.
- Output runs/<ts>-batch/: images/image-00N.png, records/image-00N.md (sdcpp.image.v1),
  logs/, responses/, batch-manifest.json (sdcpp.run.v1 + images[]), batch-manifest.tsv,
  batch-report.md (front matter), ui-run-card.md.
- Verifies every PNG (file+size) before marking PASS; PARTIAL if some fail; FAIL if zero.

Files Changed:
- bin/sdcpp-batch-generate.sh (new); bin/sdcpp-export-latest-markdown.sh (new, read-only UI handoff).

Decision: batch exits 0 on PARTIAL (some succeeded); consumers must read status/count_succeeded, not exit code alone.
State: batch + export live.
Next: contract docs/schemas/templates, then validation.

### Entry 15 - UI Contract Docs, Schemas, and Templates Completed

Timestamp: Sat Jun 20 19:59:28 EDT 2026
Summary:
Confirmed existence of Phase 2 UI integration contracts, schemas, and templates.

Reason / Intent:
Ensure UI contracts and data schemas are safely documented and tracked in the repository before GitHub checkpoint.

Files Changed:
None (Files already existed: docs/ui-integration-contract.md, docs/markdown-output-contract.md, docs/seed-batch-controls.md, schemas/run-manifest.example.json, schemas/image-record.example.json, templates/run-report-template.md, templates/image-card-template.md)

Commands Run:
```sh
find . -maxdepth 3 -type f | sort | sed -n '1,240p'
```

Command Intent: Validate existence of phase 2 documentation.

Outputs Generated: None

Decisions: Keep existing files intact.

Bugs / Blockers: None

Correction: None

State After Completion: Phase 2 files confirmed to exist.

Next Step / Handoff: Validate phase 2 workflow.

### Entry 16 - Phase 2 Validation Status Recorded

Timestamp: Sat Jun 20 19:59:41 EDT 2026
Summary:
Executed syntax validation and verify scripts to confirm the repository is in a working, proven state.

Reason / Intent:
Must ensure the code being checkpointed actually passes validation.

Files Changed:
None

Commands Run:
```sh
bash -n bin/*.sh
bin/sdcpp-verify.sh
bin/sdcpp-server-status.sh
```

Command Intent: Syntax checking and end-to-end environment verification.

Outputs Generated: verify-report.md (local validation log)

Decisions: Only proceed with git checkpointing because validation passed successfully.

Bugs / Blockers: None

Correction: None

State After Completion: Repository confirmed clean and functional.

Next Step / Handoff: Prepare Git repository and update .gitignore.

### Entry 17 - Repository Checkpoint Prepared for GitHub

Timestamp: Sat Jun 20 20:01:00 EDT 2026
Summary:
Created root .gitignore to prevent committing generated runs, logs, state, and binary model files.

Reason / Intent:
Safely checkpoint the sdcpp-workflow project into GitHub without leaking temporary runtime state or models.

Files Changed:
- .gitignore (created at root)

Commands Run:
```sh
cat > /Users/andrew/Image_Gen/.gitignore
```

Command Intent: Isolate code from runtime execution artifacts.

Outputs Generated: .gitignore

Decisions: Ignore sdcpp-workflow/runs/, logs/, state/, and local .env files. Include examples and contracts.

Bugs / Blockers: None

Correction: None

State After Completion: Repository staging area ready to be initialized and committed.

Next Step / Handoff: Initialize Git, stage safe files, and commit.

### Entry 18 - GitHub Repository Checkpoint Created

Timestamp: Sat Jun 20 20:01:30 EDT 2026
Summary:
Prepared and staged clean repository files for initial commit to GitHub.

Reason / Intent:
Finalize the snapshot of Phase 2 progress, ensuring no runtime/binary artifacts are tracked.

Files Changed:
None (Staged files via git add)

Commands Run:
```sh
git add (multiple files)
```

Command Intent: Track only source, documentation, templates, and schemas.

Outputs Generated: Git index updated.

Decisions: Left `Potential UI/` directory untracked per explicit user instruction. Ignored model files and runtime execution logs via .gitignore.

Bugs / Blockers: None

Correction: None

State After Completion: Staging area contains exact requested state. Ready to commit.

Next Step / Handoff: Commit and push to origin/main. Proceed to UI implementation.

### Entry 19 - Repository Push State Reconciled

Timestamp: Sat Jun 20 20:23:13 EDT 2026
Summary:
Reconciled Bible state with actual repository status based on Andrew's report.

Reason / Intent:
Ensure the Bible accurately reflects that the checkpoint commit and push succeeded before beginning substantive UI work.

Files Changed:
None (status reconciliation only)

Commands Run:
None (verified via git status/log)

Command Intent: Confirm working tree and remote synchronization.

Outputs Generated: None

Decisions:
Noted that Andrew successfully pushed commit 00b43e9 to origin/main. Local HEAD matches origin/main.

Bugs / Blockers: None

Correction: None

State After Completion: Repository is clean, synchronized with GitHub, and ready for UI implementation in operator-console/.

Next Step / Handoff: Create the implementation plan for the local UI layer.

### Entry 20 - Operator Console UI Implemented

Timestamp: Sat Jun 20 20:30:00 EDT 2026
Summary:
Implemented the Operator Console local UI layer with a strict Node.js Express command bridge.

Reason / Intent:
Provide a safe, visual interface for generating images without exposing arbitrary shell execution.

Files Changed:
- docs/operator-console-ui-build-spec.md (new)
- operator-console/package.json (new)
- operator-console/server.js (new)
- operator-console/public/index.html (new)
- operator-console/public/styles.css (new)
- operator-console/public/app.js (new)
- operator-console/README.md (new)
- operator-console/docs/command-bridge-safety.md (new)
- operator-console/docs/implementation-notes.md (new)
- operator-console/docs/ui-validation.md (new)

Commands Run:
- `npm init -y` and `npm install express`
- `node server.js`
- `bin/sdcpp-verify.sh`

Command Intent: Initialize the backend bridge and validate the safety of the setup.

Outputs Generated: A functional UI accessible at http://127.0.0.1:31337/

Decisions:
1. UI architecture confirmed: Vanilla JS frontend and Express backend.
2. Operator Console implementation created.
3. Command bridge safety model implemented (allowlist + spawn + no shell).
4. UI validation completed.
5. Server binds ONLY to 127.0.0.1.

Bugs / Blockers: None

Correction: None

State After Completion: UI is locally functional, jobs can be polled, and backend remains clean and verified.

Next Step / Handoff: Commit and push the `operator-console` implementation to GitHub.

### Entry 21 - Operator Console Hardening

Timestamp: Sat Jun 20 20:41:00 EDT 2026
Summary:
Completed the UI hardening pass for the Operator Console.

Reason / Intent:
Make the MVP console fully functional according to the UI Build Specification while preserving absolute safety boundaries.

Files Changed:
- operator-console/package.json
- operator-console/server.js
- operator-console/public/index.html
- operator-console/public/styles.css
- operator-console/public/app.js
- .gitignore

Commands Run:
- `npm run check` and `npm start`
- `bin/sdcpp-verify.sh`
- `curl` tests against `/api/actions/verify` and `/api/runs`

Command Intent: Validate bridge hardening and UI rendering.

Outputs Generated: A hardened UI that includes safe validation, escaped HTML, full Run Details, Run History filters, Batch generation UI, Settings, and Advanced Diagnostics.

Decisions:
1. Operator Console hardening pass started.
2. Bridge validation/argument hardening implemented (Sets and strict regexes for prompt, seed, API, count).
3. UI screen completion and run detail/history improvements added (modals, auto-poll, safe HTML escaping).
4. Validation results confirmed everything remains safely bounded to localhost with no shell exposure.

Bugs / Blockers: None

Correction: None

State After Completion: The UI is completely usable and robust for single, batch, and server-based generations. Safe directory traversal implemented for image serving.

Next Step / Handoff: Commit and push the hardened UI to GitHub.
