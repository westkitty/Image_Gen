# WC2TB five-minute recovery runbook (Big Mac DexDiffusion)

Run these steps from the MacBook with `ssh westcat`, which reaches `bigmac@bigmac`.

- The commands are read-only unless a step says otherwise.
- Never use `kill`, `launchctl kickstart`, or `bin/dexdiffusion stop|restart` on Big Mac. The EngineHost worker is the only restart owner.
- Never change TCC, mounts, SMB, Tailscale, or model storage to "fix" a symptom.

## Minute 0–1: what is true right now?

```bash
ssh westcat 'cd ~/Image_Gen-wc2tb-20261120 && /opt/homebrew/bin/python3 scripts/wc2tb-release-doctor.py'
```

> Until the prevention branch is merged and deployed, run the doctor from a checkout of
> `codex/wc2tb-prevention-20261121`, for example
> `ssh westcat '/opt/homebrew/bin/python3 -' < scripts/wc2tb-release-doctor.py`.

Read the failing check IDs in the output. Each one maps to a step below.

| Symptom / failing check | Go to |
|---|---|
| no 31337 listener; Studio down | A |
| `wc2tb_access` BLOCKED (backend in internal fallback) | B |
| `node`, `dependencies`, `enginehost_worker` BLOCKED | C |
| `restart_authority` / `legacy_agent` / `process_ancestry` BLOCKED | D |
| `disk_reserve` BLOCKED, or jobs refused "Insufficient shared disk" | E |
| `macbook_ack` pending, images not reaching the MacBook | F |
| a code regression after a cutover | G |

## A. Backend down (this never stops a working backend)

```bash
ssh westcat 'bash ~/Image_Gen-wc2tb-20261120/scripts/request-worker-backend.sh --ensure'
```

- `SERVICE_READY` means done.
- `SERVICE_PENDING` (exit 75) only means the 3-second loop expired. Rerun the doctor before doing anything else.
- `SERVICE_BLOCKED`: read the worker state.
  - `CIRCUIT_OPEN` means there were 4 crashes in 10 minutes. Check the logs first and fix the cause.
  - `PORT_HELD` means a foreign listener: identify it with `lsof -nP -iTCP:31337 -sTCP:LISTEN` and **do not kill it blindly**.

## B. WC2TB unreadable

- This is the designed behaviour: the runner selects the isolated internal fallback, and MacBook publication is suspended there.
- Shell EPERM on `/Volumes/wc2tb` is TCC attribution. It is **not** proof that the volume is unreadable.
- Only the backend's `storage.mode` counts as evidence.
- Restoring external mode needs the volume readable by the EngineHost lineage, followed by a gated owner restart (step G). Do not remount or change TCC from SSH.

## C. Runtime drift (Node, dependencies, EngineHost, worker)

- Stop here and do not restart: a restart would load the drifted runtime.
- Compare against the pins listed in `docs/WC2TB_PREVENTION.md`.
- Restore the exact file from its checksummed source only inside an owner-authorized window.

## D. More than one restart owner

- The legacy agent must be disabled and not loaded, and the supervision mode file must contain `production`.
- Re-enabling or bootstrapping `local.dexdiffusion.server` creates a second owner. Do not do it.
- Report the finding, and fix it only in an authorized window.

## E. Disk

- Admission needs 1280 + 256 × images MiB: 1536 MiB for one image, 5376 MiB for 16 or for unknown work.
- Free space by removing your own scratch files only.
- **Never** delete canonical images, historical job records, or publication staging that is still awaiting MacBook acknowledgement.

## F. MacBook delivery

On the MacBook:

```bash
~/Image_Gen/bin/dexdiffusion publication-sync
```

- This is a one-shot, lock-protected pull.
- Bytes are verified by SHA-256 before the acknowledgement is sent.
- Pending items stay on Big Mac until they are acknowledged.

## G. Restart or cutover to a revision (the gate is mandatory)

```bash
ssh westcat 'bash ~/Image_Gen-wc2tb-20261120/scripts/request-worker-backend.sh --restart --expect-revision <full sha>'
```

- **Result:** if the release gate refuses, the backend is left running (exit 78).
  - `BLOCKED` cannot be overridden.
  - `UNVERIFIED` can be overridden only with `--override-unverified "<20+ character reason>"`, after you verify the failing fact by hand. The override is logged.
- **Emergency rollback:** use the owner handoff in section H. The v1 starter script is for disposable-root proofs only. It refuses whenever 31337 has a listener, and it must never be used to "free" the port.

## H. Owner-authorized fallback handoff (implemented in source; NOT installed in production)

**Revisions, kept apart.**
- **Frozen production: `352e508`**, branch `codex/wc2tb-recovery-20261120`. It has no handoff, and it is never moved.
- **Handoff source:** the head of `codex/wc2tb-rollback-closure-20261121` (PR #28). Whatever commit an approved window installs is called `<installed sha>` below. It is not `352e508`.
- **Fallback package for the handoff: v2**, source commit `3f0abf5` on `rollback/wc2tb-fallback-drain-v2-20261121`. It is v1 plus the owner drain protocol. It is built only in section I.
- **v1 (`c7708e4`)** stays the disposable-root proof package. It cannot be drained by its owner, so the handoff refuses it with `FALLBACK_DRAIN`.

**Status today.**
- The doctor reports `handoff_capability` BLOCKED, because the running worker reports no handoff protocol, and `rollback_activation_proof` UNVERIFIED.
- If you run the commands below against the current worker:
  - the deployed `352e508` script rejects the unknown action;
  - a newer script talking to the old worker gets `HANDOFF_REFUSED`.
- Nothing is stopped in either case.

**Owner.**
- The existing EngineHost → `engine-worker.py` → `backend-supervisor.py` Supervisor is the only backend owner.
- The handoff adds no daemon, LaunchAgent or supervisor.
- `backend-pause` stays rehearsal-only.

**One stop contract, both directions.** A child (external or fallback) is signalled only by its owner, and only after all of the following:
1. Admission is fenced: the owner creates `DEX_BACKEND_CONTROL/drain`, and the backend then answers 503 to every request.
2. The backend writes a fresh (under 3 s) seal `"<owned pid> drained"`. It writes this only when it has no request in flight, no active or non-terminal job, no lease, waiter or quarantine, no held image journal and no unresolved publication recovery.
3. The worker is idle.
4. The child still leads its own session and process group.
5. It is still the sole listener, re-checked immediately before the signal.
6. For fallback entry, the fallback prerequisites are also re-checked at that moment.

Then SIGTERM goes to that process group only. If any check fails, the drain is withdrawn and the child keeps running. A timeout never authorizes a signal. A process group that survives keeps its owner record and is never adopted.

**Preparation happens before anything stops.** An accepted `--handoff-fallback` does the following while the external backend still serves:
- verifies the v2 package: `SOURCE_COMMIT`, starter, `edit-ui.js`, dependencies, and the trusted manifest (`rollback-packages/…-v2/SOURCE-SHA256SUMS` in the deployed revision; its SHA-256 `de9f5719…` is pinned in the supervisor), hashing every listed file of `package/source`;
- verifies the pinned Node and publication isolation;
- prepares the isolated fallback layout under `/Users/bigmac/DexDiffusion-InternalFallback`. The root is 0700, owned, not a symlink, with no symlinked ancestor, on the home device. Every subdirectory is owned, not a symlink, and on the same device; the private root is the access boundary.
- prepares the log `…/wc2tb-fallback-rollback-v2/logs/owner-handoff-<time>.log`, in a 0700 directory;
- checks for at least 2 GiB free;
- then re-validates everything read-only.

Any failure is a refusal, and the external backend is untouched. Canonical images and receipts are never touched.

**Interface** (the only supported one):

```bash
ssh westcat 'bash ~/Image_Gen-wc2tb-20261120/scripts/request-worker-backend.sh --handoff-fallback --expect-revision <installed sha> --reason "WC2TB regression drill approved in maintenance window"'
```

```bash
ssh westcat 'bash ~/Image_Gen-wc2tb-20261120/scripts/request-worker-backend.sh --return-external --expect-revision <installed sha> --reason "return to external supervision after fallback drill"'
```

- `--expect-revision` must be the installed deployed-worktree HEAD (`git -C ~/Image_Gen-wc2tb-20261120 rev-parse HEAD`). `352e508` is refused by any build that has the handoff.
- The reason must be 20–500 characters. It is journaled.
- **Exit codes:**
  - 0: `HANDOFF_COMPLETE`.
  - 78: `HANDOFF_REFUSED`. The backend is untouched.
  - 70: `HANDOFF_FAILED`.
  - 75: `HANDOFF_PENDING`. Read `backend-status` or the journal.
- **Progress** is visible in `backend-status` (`profile`; `handoff.state`, `protocol`, `supervisor_sha256`, `drill_id`) and in the journal `~/.dexdiffusion-engine/backend-handoff.json` (0600, fsynced, schema 2).

**State machine.**

```
RUNNING_EXTERNAL -> QUIESCING -> BACKEND_RELEASED -> STARTING_FALLBACK -> RUNNING_FALLBACK
RUNNING_FALLBACK -> QUIESCING_FALLBACK -> FALLBACK_RELEASED -> STARTING_EXTERNAL -> RUNNING_EXTERNAL
QUIESCING          (no drained seal within 30 s, or release refused) -> RUNNING_EXTERNAL  (aborted; untouched)
QUIESCING_FALLBACK (no drained seal within 15 s, or release refused) -> RUNNING_FALLBACK  (aborted; untouched)
STARTING_FALLBACK  (unverified after 90 s) -> drained-seal stop -> HANDOFF_FAILED
                   (if it cannot drain: HANDOFF_FAILED, fallback left running, not signalled)
STARTING_EXTERNAL  (not ready within 90 s, child alive or not) -> HANDOFF_FAILED (START_TIMEOUT)
STARTING_EXTERNAL  (child exits before readiness) -> HANDOFF_FAILED   (never respawned)
any other failure, or a worker restart mid-transition -> HANDOFF_FAILED (paused; spawns and signals nothing)
HANDOFF_FAILED -> STARTING_EXTERNAL     (only via --return-external, re-checked, port free, no owner record)
HANDOFF_FAILED -> RUNNING_EXTERNAL      (only via --return-external when the owner's own external child
                                         now proves ready: fresh idle seal, /api/version, sole listener)
```

- **External readiness** means all three of: a fresh `"<owned pid> idle"` seal, `/api/version` naming that pid, the deployed cwd and `external` storage, and the child being the sole listener. A live PID alone is not readiness.
- **After `START_TIMEOUT`,** the owned child is kept as evidence: its pid, return code, supervisor state and instance are in the journal `evidence`. It is not signalled or replaced.
- **While in fallback:**
  - `backend-restart` is refused.
  - `--ensure` reports not-ready.
  - A worker shutdown does not stop the fallback. A restarted worker records `HANDOFF_FAILED` and never adopts the survivor.

**Refusal and failure codes.**

| Code | Meaning |
|---|---|
| `REQUEST_INVALID` | not exactly `op,target,expect_revision,reason`; bad commit id; reason length. Extra fields (facts, config, force) are refused. |
| `STATE` | not `RUNNING_EXTERNAL` with a sealed-idle backend, or a transition is already in progress |
| `IDENTITY_ENGINEHOST` / `IDENTITY_WORKER` | worker parent is not the pinned EngineHost (`79faeb90…`); installed worker ≠ deployed `engine-worker.py` |
| `SOURCE_REVISION` / `RETURN_PATH` | deployed worktree not at `--expect-revision`, dirty, or external launcher missing |
| `NODE_HASH` | pinned Node missing or not `266dec4d…` |
| `ACTIVE_JOB` / `LEASE` / `PUBLICATION_PENDING` / `RECOVERY_UNSAFE` | work, lease, waiter, quarantine, MacBook backlog or unsafe transfer present (checked for the backend being stopped) |
| `FALLBACK_PACKAGE` | v2 `SOURCE_COMMIT` ≠ `3f0abf5`, starter ≠ `03bb7a28…`, `edit-ui.js` ≠ `44e7e739…`, `server.js` or a dependency missing |
| `FALLBACK_SOURCE` | trusted manifest missing or altered, malformed, or a listed file missing, symlinked or different (e.g. a modified `server.js`) |
| `FALLBACK_DRAIN` | the manifest does not cover `server.js`, `backend-quiescence.js`, `package.json` and `package-lock.json`: the package cannot be drained by its owner (the v1 shape) |
| `FALLBACK_ROOT` / `FALLBACK_DEVICE` / `FALLBACK_LOG` / `FALLBACK_DISK` / `FALLBACK_PREPARE` | unsafe, symlinked, foreign-owned or non-private root; wrong device; unusable log destination; under 2 GiB free; directory creation failed |
| `MACBOOK_CONTACT` | fallback environment holds a MacBook variable, or the package is not a publication-isolated revision |
| `BACKEND_IDENTITY` / `FOREIGN_LISTENER` | `/api/version` does not name the owned child; listeners are not exactly the owned child, or are unidentifiable |
| `CONCURRENT` | `authorized-backend-recovery.lock` or `backend-handoff.lock` held. The owner holds both for the whole transition. |
| `OWNER_PRESENT` | return refused: an unreleased `backend-instance` record exists (possible survivor) |
| `RELEASE_REFUSED: …` | last check before the signal failed (new listener, worker busy, fallback prerequisite changed); drain withdrawn |
| `QUIESCE_TIMEOUT` | no drained seal in time; drain withdrawn, child left running |
| `START_TIMEOUT` / `EXTERNAL_SEAL` / `EXTERNAL_IDENTITY` | external not ready by the deadline; child kept as evidence |

**Fallback verification.** All of the following must be seen within 90 s, or the fallback is drained (never killed) and the handoff records `FALLBACK_UNVERIFIED`:
- the child answers as itself;
- storage is `internal-fallback`;
- publication is `enabled:false`;
- models are exactly `flux-fp8`, `flux2-klein-4b`, `sdxl-photonic`;
- Studio returns 200;
- it is the sole listener.

**When the handoff fails (`HANDOFF_FAILED`).**
1. Do nothing destructive.
2. Read the journal `failure` and `evidence`, and the owner-handoff log.
3. Canonical images, receipts, journals and the 18 historical records are never touched by the handoff.
4. If the port is free and no `backend-instance` record exists, return with `--return-external`.
5. If the owner's own external child timed out but later became healthy, `--return-external` re-verifies it and resumes it.
6. Otherwise a survivor exists. Stop and plan a separately authorized window. Never kill it blindly.

**Proof identity (journal schema 2).** Every history entry carries:
- `seq`;
- `drill_id` (one per fallback entry, kept through its return);
- `transition_id` (one per owner request);
- `host`, `revision` and `worker_sha256`;
- `supervisor_sha256` (the digest of the supervisor the running worker loaded);
- `mode`;
- for the two authorized requests, `authorized` (the target and the reason).

`rollback_activation_proof` is PASS only for all of the following:
- the eight-event sequence above, contiguous `seq`, schema 2, mode `production`;
- one drill made of two distinct transitions, authorized fallback then external;
- every binding equal to the running system: host `bigmac`, the deployed HEAD, the installed worker digest, and the supervisor digest the running worker reports.

Older journals, isolated-test drills, other revisions or workers, mixed drills, reordered, interrupted or failed sequences, and corrupt journals are never proof.

**Tests that prove source behaviour.** All use isolated ports, fake processes and real `lsof`. None of them is a live proof.
- `sdcpp-workflow/worker/test_backend_handoff.py`, 34 tests:

  | Case | Test |
  |---|---|
  | A/L/M/N | full round trip, no MacBook contact, images unchanged, return, proof identity |
  | B–K, O, timeout | job/lease/publication, foreign listener, package/Node/identity, locks, failed boot, unverified fallback drained or kept, crash mid-transition, fixtures, quiesce timeout |
  | C1 A–G | drain-sealed fallback return: idle return; job before the fence protected; job after the fence refused (503); job/lease/worker work blocks stop; missing, stale, forged or unrequested seal never authorizes; failed drain keeps work; foreign listener; surviving process group keeps its owner record |
  | C2 A–G | startup deadline: unhealthy, never-sealing, exiting child; healthy completes; deterministic clock; no restart loop; evidence kept; worker restart never adopts |
  | C3 A–J | fallback validated before stop: permissions, device, symlinked root/subdirectory/ancestor, log, dependency, modified `server.js`, modified or undrainable manifest, disk, mutation before release, images and receipts unchanged |

- `scripts/test/test_wc2tb_release_doctor.py`:
  - proof A–I (revision-bound PASS; other revision, worker, supervisor or host; mixed, reordered, gapped, failed or unauthorized sequences; corrupt, truncated or legacy journal; isolated mode);
  - capability H (markers without live support; live unavailable; protocol, mode or digest mismatch; v1 package);
  - J (Q), K (read-only facts), P (read-only source), R.
- **v2 fallback** (`rollback/wc2tb-fallback-drain-v2-20261121`): `operator-console/tests/fallback-drain-protocol.test.js`, with the real backend.

**Only a live maintenance window can prove:**
- the real drain of the production backend;
- the v2 server under pinned Node starting as the owner's child, inside the EngineHost TCC context, on 31337, with the real fallback models;
- Studio and the image routes in fallback;
- the drained-seal stop of the real fallback;
- the return to WC2TB external mode;
- that the MacBook stays untouched;
- that the doctor flips `rollback_activation_proof` to PASS from the production journal.

## I. Approval-ready maintenance window: install the handoff, then run the live drill

**Prerequisites.**
- Explicit owner approval for one window.
- No jobs.
- `release-doctor` production health PASS.
- Disk ≥ 1536 MiB, plus 2 GiB free on the home device for the fallback.
- MacBook backlog 0.
- The v1 package check PASS.

**Steps.**
1. **Freeze evidence.** Copy `~/.dexdiffusion-engine/engine-worker.py`, `backend-instance` and the worker plist hashes, `/api/version`, `/api/publication-recovery` and the image-library count to a new `~/wc2tb-drill-<date>/`.
2. **Preflight, before anything changes.**
   - Use a separate clean Big Mac worktree of the approved closure commit `<installed sha>`, for example `/Users/bigmac/Image_Gen-wc2tb-rollback-closure-20261121`.
   - From it, run: `bin/dexdiffusion release-readiness --expect-revision <installed sha> --target-worktree /Users/bigmac/Image_Gen-wc2tb-rollback-closure-20261121`.
   - Expected result:
     - `handoff_capability` and `return_to_external`: BLOCKED (the running worker reports no handoff);
     - `rollback_activation_proof` and `recovery_plan`: UNVERIFIED;
     - every other check PASS.
   - Any other non-PASS ends the window before anything changes.
3. **Build the v2 package. Production is unaffected.**
   - Into `~/Library/Application Support/DexDiffusion/wc2tb-fallback-rollback-v2/`, put:
     - `source/` = `git archive 3f0abf5d0bd9c1d3777a9abbf46181ce2e040350`;
     - `SOURCE_COMMIT`;
     - the v1 starter (SHA-256 `03bb7a28…`);
     - `logs/` (mode 0700);
     - `source/operator-console/node_modules` resolving to the baseline modules, whose lockfile `414c3923…` is identical.
   - Verify `source/` against `rollback-packages/wc2tb-emergency-internal-fallback-rollback-v2/SOURCE-SHA256SUMS` (`shasum -a 256 -c`).
   - v1 is not modified.
4. **Stage.**
   - Fast-forward the deployed worktree `/Users/bigmac/Image_Gen-wc2tb-20261120` to `<installed sha>` from a *new* local branch, and confirm it is clean. **Never move** `codex/wc2tb-recovery-20261120`, which stays frozen at `352e508`.
   - Install that commit's `sdcpp-workflow/worker/engine-worker.py` to `~/.dexdiffusion-engine/engine-worker.py` atomically, and verify its SHA-256 against the commit blob.
   - The running backend is unaffected until step 5.
5. **Activate.**
   - Run `launchctl kickstart -k gui/503/local.dexdiffusion.engine-worker`. This is the one window-authorized exception to the "no kickstart" rule above; the same step was proven in the 2026-11-21 cutover.
   - The worker drains and stops its own sealed backend, relaunches under the same signed EngineHost, loads the new supervisor (loaded only at worker start), and spawns the staged revision.
   - Expect about 5 s of interruption.
   - EngineHost is not rebuilt or re-signed, and TCC is unchanged.
6. **Verify.** `release-doctor` shows production health PASS and `handoff_capability` PASS: the running worker reports protocol 2, with a supervisor digest equal to the deployed file.
7. **Drill.** Run `--handoff-fallback --expect-revision <installed sha>`, then:
   - verify storage `internal-fallback`, publication disabled, 3 models, Studio 200;
   - confirm the MacBook receipts count and `images_made` are unchanged.

   Then run `--return-external` and verify external mode, publication enabled, pending 0, and Studio 200.
8. **Close.** `release-doctor` must show `rollback_activation_proof` PASS, bound to `<installed sha>`, from the production journal. Record the evidence in `OPERATIONAL_STATE.md`.

**Abort rules.**
- Any `HANDOFF_REFUSED` ends the drill with production untouched.
- If `HANDOFF_FAILED` occurs, follow "When the handoff fails" above.
- If step 5 fails, reset the deployed worktree to `352e508` (still clean, no history rewrite: check out the frozen branch), restore the frozen `engine-worker.py`, and run the same kickstart. That rollback is proven by the 2026-11-21 cutover.
