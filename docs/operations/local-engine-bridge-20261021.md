# Big Mac local engine bridge — 2026-10-21

Implemented and live for V2 controlled generation. Evidence: [machine-readable receipt](local-engine-bridge-20261021.json). Source remains uncommitted on `docs/dexdiffusion-omni-recovery-20261021`, base `d1d542631fd041ddf54b148a173da19415fa4dd6`. Existing dirty/untracked work was retained. No commit, push, wrapper rebuild, model download, checkpoint copy, model move, or permission-database change.

## Actual installed owner and startup

- Big Mac account: `bigmac`, UID 503, graphical session `gui/503`.
- Host executable: `/Users/bigmac/Applications/DexDiffusion Engine Worker.app/Contents/MacOS/DexDiffusionEngineHost`, bundle `local.dexdiffusion.engine-worker`. This is a background helper; the existing MacBook DexDiffusion application is unchanged.
- Worker: `/opt/homebrew/bin/python3 /Users/bigmac/.dexdiffusion-engine/engine-worker.py serve`.
- Startup: `/Users/bigmac/Library/LaunchAgents/local.dexdiffusion.engine-worker.plist`; Aqua session, RunAtLoad, KeepAlive, 10-second failure throttle, 20-second stop timeout.
- Socket: `/Users/bigmac/.dexdiffusion-engine/engine.sock`, mode `0600`; containing directory mode `0700`, owned by bigmac. No TCP listener is created by the helper.
- Source owners: [worker and watchdog](../../sdcpp-workflow/worker/engine-worker.py), [host](../../sdcpp-workflow/worker/EngineHost.swift), [installer](../../sdcpp-workflow/worker/install-remote.sh), [registry builder](../../sdcpp-workflow/worker/build-registry.js). The installer refuses an already registered/running service.
- The user approved macOS access for the actual helper. Original external checkpoint and all six adapter reads passed from the helper, after normal startup/restart and through fresh SSH connections. The precise Settings grant category was not inspected. SSH-to-Terminal Apple Events was denied (`-1743`) and was not bypassed. Original Tailscale SSH removable-volume access was not repaired or weakened.
- Idle LaunchAgent termination/restart and unload/bootstrap were tested; worker PID changed and model reads remained valid. Logout/login and reboot were not performed while user work was active, so that persistence gate remains untested.

## Request, execution and publication

The existing Generate route and V2 controls remain. `local-engine-routing.js` sends controlled jobs to `bin/local-engine-generate.js` when the machine-local `sdcpp-workflow/state/local-engine-bridge.json` enables the proven bridge. Browser fixture servers remain isolated. There is no ordinary-user routing selector.

The MacBook uses the existing `ssh westcat` connection only to run a fixed IPC client. JSON carries registry model/adapter IDs, bounded numeric settings and a run ID plus private random ownership token. The protocol rejects commands, executable/model/output paths, unknown fields, incompatible adapters and unverified recipes. The install-time registry comes from the existing server target declarations, model map, LoRA policy and installed asset cache. A newly registered model requires an updated worker registry; it cannot inject a path through the browser.

The graphical helper opens original model files and starts the existing `sd-cli` or MFLUX executables. SDCPP LoRA production remains `MTL0` / `at_runtime`; explicit verified CPU fallback combinations and model-specific FLUX.1/Turbo/Photonic flags are retained. MFLUX uses the existing FLUX.2 cache and hash-verified rsLoRA conversion. Original checkpoints/adapters stay on wc2tb. Native SDCPP batches and high-resolution settings retain their parameter paths; a real two-image native batch passed. High-resolution generation itself was not rerun in this bridge pass.

The existing console heavy-resource arbiter remains in front of generation. The worker additionally permits one owned job and refuses a detected concurrent image engine. Each converter/engine has an owned process group and a watchdog. It cannot start inference before process ownership is registered; parent death or the 30-minute deadline stops that group. Disconnecting SSH leaves a bounded, recorded worker job, rather than an SSH-owned inference process. Status/result polling uses fresh SSH connections.

Structured private results live under `~/.dexdiffusion-engine/jobs/<run-id>/result.json`. Engine scratch files and raw logs are deleted before terminal status. Both prompt fields and multiline/escaped fragments are excluded from retained diagnostic evidence. Prompt-saving-off outputs have PNG metadata stripped before hashing. Validated PNGs stage in the private home directory until the MacBook verifies their digest and publishes through the existing canonical image transaction. Acknowledgment then deletes remote staged outputs; unacknowledged output bytes expire after one hour. Receipts remain. The canonical library remains `/Users/andrew/images_made`, with one physical canonical image per output and run-owned index references.

Cancellation uses the server's existing Cancel action and token-authenticated worker IPC. A terminal cancellation is returned only after process-group stop and scratch cleanup. Restart recovery preserves unresolved ownership as quarantine, including across repeated restarts. Batch results are first transferred into a private local staging directory, then committed together through the existing all-output publication transaction. A fault after the first canonical link rolls the batch back; its dedicated regression and a second real two-output batch passed. The local publication path writes the existing job-owner receipt and logical run output markers so publication/cancel arbitration remains owned by the existing image store.

## Measured acceptance

| Adapter | Live result | Evidence |
|---|---|---|
| SDXL Lightning | PASS; native V2 Studio | 20261021-134407-controlled-sdxl-base-2ab8aefe; 2364/2364 tensors |
| Hyper-SDXL | PASS; live Studio API | 20261021-134644-controlled-sdxl-base-f44dec4f |
| LCM-SDXL | PASS; live Studio API | 20261021-134750-controlled-sdxl-base-257f891e |
| LCM-SD1.5 | PASS; live Studio API | 20261021-134831-controlled-sd15-727105b4 |
| Hyper-SD15 | PASS; live Studio API | 20261021-135144-controlled-sd15-8c303aaf |
| Pixel Art 1.0 | PASS; live Studio API | 20261021-135320-controlled-flux2-klein-4b-e56e9acc |

All five SDCPP receipts contain actual Metal initialization and adapter application evidence. The first worker Lightning proof explicitly established child-engine access to original protected files, loaded/applied 2364/2364 LoRA tensors, and produced a decoded 512×512 canonical PNG; cold generation took 304.84 seconds. A subsequent native Lightning run reported 15.80 seconds. These are individual observations, not matched performance claims.

Pixel Art used matched prompt/seed 731960, 512×512 and four steps: mean absolute RGB differences were 25.4211 for strength 1.0 versus 0.5, 38.6034 for 1.0 versus OFF, and 27.7592 for 0.5 versus OFF. This proves a strength-dependent output change, not subjective quality.

Native `/Applications/DexDiffusion.app` Generate produced a visible result and Saved to Library state. A second native run was cancelled during the real engine process: durable state CANCELLED, remote stop `cancelled_verified`, no output, scratch cleanup true. A following native generation completed (adapter OFF). Both native and API requests use the same bridge. The wrapper bundle/root/source stamp remain `local.image-gen.wrapper`, this checkout, and the base SHA; the served console is the current dirty source tree.

With the helper deliberately stopped while idle, a live API request failed in 1.805 seconds with the precise unavailable-worker message, emitted no remote run ID and left no quarantine. The LaunchAgent was restored, model reads passed, and a subsequent native-batch job produced two canonical images at seeds 731972 and 731973. The batch had one real engine job; remote output acknowledgment/cleanup passed.

Validation: `npm run check` PASS; full `npm test` 1005 passed / 17 skipped / 0 failed (1022 total); focused worker/routing/cancellation/canonical-publication tests 85/85, including 15 Python worker tests; Edit browser 29/29; Library browser 8/8; [interaction matrix](../../output/playwright/matrix-20261021T134052-68487-MyGSzv/interaction-matrix-summary.md) 252/252. Browser suites use fixtures and are separate from real inference. Worker tests exercise a real private Unix socket plus controlled fake engines; those are not Metal proof. Shell syntax and diff whitespace checks passed.

## Remaining boundaries

Graphical logout/login, reboot persistence, power-loss recovery, all other model variants and a new live high-resolution render were not tested. Image quality remains subject to human review; the native Lightning result is not promoted to quality acceptance. Legacy Edit/ESRGAN routes remain separate and may still be blocked by the original SSH removable-volume denial; the doctor preserves those failures and adds a separate worker result. Overall doctor remains FAIL for separate legacy SSH/media checks, while the new MFLUX/SDCPP worker rows are READY. Historical missing images/publication gaps remain untouched. No existing image was deleted. This pass establishes the requested six-adapter controlled-generation bridge, cancellation, recovery and tested user-session restart behavior.
