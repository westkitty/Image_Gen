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

**Status.**
- The handoff exists on branch `codex/wc2tb-rollback-closure-20261121`. The running production (worker plus `352e508` supervisor) does **not** contain it.
- Today the doctor reports `handoff_capability` = BLOCKED and `rollback_activation_proof` = UNVERIFIED.
- The commands below exist only after the maintenance window in section I installs this branch.
- If you run them against the current worker:
  - the deployed `352e508` `request-worker-backend.sh` rejects the unknown action;
  - a newer script talking to the old worker gets `HANDOFF_REFUSED unknown fields; paths and commands are forbidden`.
- In both cases nothing is stopped.

**Owner.**
- The handoff belongs to the existing EngineHost → `engine-worker.py` → `backend-supervisor.py` Supervisor, which is the only backend owner.
- It adds no new daemon, LaunchAgent or supervisor.
- `backend-pause` stays rehearsal-only.

**How it stops and starts processes.**
- It stops only its own child, which it knows by its `Popen` handle and by that child leading its own session and process group.
- The external backend is stopped only after the backend's own drained seal, the same drain path proven by owner restarts.
- The fallback is the versioned package `~/Library/Application Support/DexDiffusion/wc2tb-fallback-rollback-v1`. It runs from `source/operator-console` as the owner's next child:
  - pinned Node `server.js`;
  - environment from the v1 starter (`DEX_STORAGE_MODE=internal-fallback`, data root `/Users/bigmac/DexDiffusion-InternalFallback`, no MacBook variable);
  - log `…/wc2tb-fallback-rollback-v1/logs/owner-handoff-<time>.log`.
- Survivors are never adopted, and nothing is killed by a remembered PID.

**Interface** (the only supported one):

```bash
ssh westcat 'bash ~/Image_Gen-wc2tb-20261120/scripts/request-worker-backend.sh --handoff-fallback --expect-revision 352e508ceebe950bac6b2115be6782564e7b2370 --reason "WC2TB regression drill approved in maintenance window"'
```

```bash
ssh westcat 'bash ~/Image_Gen-wc2tb-20261120/scripts/request-worker-backend.sh --return-external --expect-revision 352e508ceebe950bac6b2115be6782564e7b2370 --reason "return to external supervision after fallback drill"'
```

- `--expect-revision` must be the **installed** deployed-worktree HEAD. After the section I install, it is that revision, not `352e508`.
- The reason must be 20–500 characters. It is recorded in the journal.
- Exit codes:
  - 0: `HANDOFF_COMPLETE`.
  - 78: `HANDOFF_REFUSED`. The running backend was left untouched.
  - 70: `HANDOFF_FAILED`.
  - 75: `HANDOFF_PENDING`. Read the status with `request-worker-backend.sh --ensure`, or check the journal.
- Progress is shown by `backend-status` fields `profile` and `handoff.state`, and by the journal `~/.dexdiffusion-engine/backend-handoff.json` (0600, fsynced).

**State machine.**

```
RUNNING_EXTERNAL -> QUIESCING -> BACKEND_RELEASED -> STARTING_FALLBACK -> RUNNING_FALLBACK
RUNNING_FALLBACK -> QUIESCING_FALLBACK -> FALLBACK_RELEASED -> STARTING_EXTERNAL -> RUNNING_EXTERNAL
QUIESCING (cannot drain within 30 s) -> RUNNING_EXTERNAL   (aborted; external backend untouched)
any failure, or a worker restart mid-transition -> HANDOFF_FAILED   (terminal; paused; spawns nothing)
HANDOFF_FAILED -> STARTING_EXTERNAL   (only via --return-external, re-checked)
```

- **While in fallback:**
  - `backend-restart` is refused, so no external backend can reclaim 31337.
  - `--ensure` reports not-ready (its identity check expects the deployed cwd). This is expected.
  - A worker shutdown does not stop the fallback. A restarted worker records `HANDOFF_FAILED` and never adopts the survivor.

**Refusal codes.** Every one is checked before the running backend is touched.

| Code | Meaning |
|---|---|
| `REQUEST_INVALID` | not exactly `op,target,expect_revision,reason`; bad commit id; reason length. Extra fields (facts, config, force) are refused. |
| `STATE` | not `RUNNING_EXTERNAL` with a sealed-idle backend, or a transition is already in progress |
| `IDENTITY_ENGINEHOST` | the worker's parent is not the pinned signed EngineHost (`79faeb90…`) |
| `IDENTITY_WORKER` | the installed worker differs from the deployed revision's `engine-worker.py` |
| `SOURCE_REVISION` / `RETURN_PATH` | deployed worktree not at `--expect-revision`, dirty, or external launcher missing |
| `NODE_HASH` | pinned Node missing or not `266dec4d…` |
| `ACTIVE_JOB` | worker job active, uncertain or unacknowledged, or backend `/api/jobs` not empty |
| `LEASE` | compute lease owner, waiter or quarantine present |
| `PUBLICATION_PENDING` | publications awaiting MacBook acknowledgment |
| `RECOVERY_UNSAFE` | publication recovery blocked, or transfers pending or blocked |
| `FALLBACK_PACKAGE` | `SOURCE_COMMIT` ≠ c7708e4, starter ≠ `03bb7a28…`, `edit-ui.js` ≠ `44e7e739…`, `server.js` or a dependency missing |
| `MACBOOK_CONTACT` | fallback environment holds a MacBook variable, or the package is not a publication-isolated revision |
| `BACKEND_IDENTITY` | `/api/version` does not name the owned child pid, cwd and storage mode |
| `FOREIGN_LISTENER` | 31337 listeners are not exactly the owned child (or not empty after release), or cannot be identified |
| `CONCURRENT` | `authorized-backend-recovery.lock` or `backend-handoff.lock` is held. The owner holds both for the whole transition. |
| `OWNER_PRESENT` | return refused: an unreleased `backend-instance` record exists (possible survivor) |

**Fallback verification.** The owner must see all of the following within 90 s, or it stops its own fallback child and records `FALLBACK_UNVERIFIED`:
- the child answers `/api/version` as itself;
- storage is `internal-fallback`;
- `/api/publications/status` is `enabled:false`;
- models are exactly `flux-fp8`, `flux2-klein-4b`, `sdxl-photonic`;
- Studio returns 200;
- it is the sole listener.

**When fallback startup fails (`HANDOFF_FAILED`).**
1. Do nothing destructive.
2. Read the journal `failure` and the owner-handoff log.
3. Canonical images, receipts, journals and the 18 historical records are never touched by the handoff.
4. If the port is free and no `backend-instance` record exists, return with `--return-external`.
5. Otherwise a survivor exists. Stop and plan a separately authorized window. Never kill it blindly.

**Return to external.**
- `--return-external` first re-checks identity, revision, Node and locks.
- It then requires the fallback to be idle (no jobs, no lease) and its owned child to be the sole listener.
- It stops that child, releases the owner record, starts the deployed external backend, and completes only when that backend is sealed idle.

**Tests that prove source behaviour.** All are isolated ports and fake processes. None of them is a live proof.
- `sdcpp-workflow/worker/test_backend_handoff.py`:

  | Case | Test |
  |---|---|
  | A/L/M/N | full round trip, no MacBook contact, images unchanged, return |
  | B/C/D | job, lease, pending publication |
  | E | foreign listener, before and after release |
  | F/G/H | package, Node, worker, EngineHost, revision |
  | I | lock and in-progress serialization |
  | J | failed boot; unverified fallback |
  | K | crash mid-transition; corrupt journal; survivor never adopted |
  | O | fixtures and extra fields; constant production config |
  | — | quiesce timeout |

- `scripts/test/test_wc2tb_release_doctor.py`: P (read-only), Q, R.
- `operator-console/tests/wc2tb-prevention.test.js`: interface refuses fixtures.

**Only a live maintenance window can prove:**
- the real drain of the production backend;
- the c7708e4 server under pinned Node starting as the owner's child, inside the EngineHost TCC context, on 31337, with the real fallback models;
- Studio and the image routes in fallback;
- the return to WC2TB external mode;
- that the MacBook stays untouched;
- that the doctor flips `rollback_activation_proof` to PASS from the production journal.

## I. Approval-ready maintenance window: install the handoff, then run the live drill

**Prerequisites.**
- Explicit owner approval for one window.
- No jobs.
- `release-doctor` production health PASS.
- Disk ≥ 1536 MiB.
- MacBook backlog 0.
- The rollback package doctor check PASS.

**Steps.**
1. **Freeze evidence.** Copy `~/.dexdiffusion-engine/engine-worker.py`, `backend-instance` and the worker plist hashes, `/api/version`, `/api/publication-recovery` and the image-library count to a new `~/wc2tb-drill-<date>/`.
2. **Preflight, before anything changes.**
   - Use a separate clean Big Mac worktree of the approved closure commit, for example `/Users/bigmac/Image_Gen-wc2tb-rollback-closure-20261121`.
   - From it, run: `bin/dexdiffusion release-readiness --expect-revision <closure sha> --target-worktree /Users/bigmac/Image_Gen-wc2tb-rollback-closure-20261121`.
   - Expected verdict: BLOCKED, and only for these four checks:
     - `handoff_capability` and `return_to_external`: BLOCKED, because the handoff is not installed yet;
     - `rollback_activation_proof` and `recovery_plan`: UNVERIFIED.
   - Every other check, including all of `production_health`, `rollback` and `release_target`, must be PASS. Any other non-PASS ends the window before anything changes.
3. **Stage.**
   - Fast-forward the deployed worktree `/Users/bigmac/Image_Gen-wc2tb-20261120` to the closure commit, from a *new* local branch, and confirm it is clean. **Never move** `codex/wc2tb-recovery-20261120`, which stays frozen at `352e508`.
   - Install that commit's `sdcpp-workflow/worker/engine-worker.py` to `~/.dexdiffusion-engine/engine-worker.py` atomically, and verify its SHA-256 against the commit blob.
   - The running backend is unaffected until step 4.
4. **Activate.**
   - Run `launchctl kickstart -k gui/503/local.dexdiffusion.engine-worker`. This is the one window-authorized exception to the "no kickstart" rule above; the same step was proven in the 2026-11-21 cutover.
   - On SIGTERM the worker drains and stops its own sealed backend. It then relaunches under the same signed EngineHost, loads the new supervisor (which is loaded only at worker start), and spawns the staged revision.
   - Expect about 5 s of interruption.
   - EngineHost is not rebuilt or re-signed, and TCC is unchanged.
5. **Verify.** `release-doctor` shows production health PASS and `handoff_capability` PASS.
6. **Drill.** Run `--handoff-fallback`, then:
   - verify storage `internal-fallback`, publication disabled, 3 models, Studio 200;
   - confirm that the MacBook receipts count and `images_made` are unchanged.

   Then run `--return-external` and verify external mode, publication enabled, pending 0, and Studio 200.
7. **Close.** `release-doctor` must show `rollback_activation_proof` PASS, from the production journal. Record the evidence in `OPERATIONAL_STATE.md`.

**Abort rules.**
- Any `HANDOFF_REFUSED` ends the drill with production untouched.
- If `HANDOFF_FAILED` occurs, follow "When fallback startup fails" above.
- If step 4 fails, reset the deployed worktree to `352e508` (still clean, no history rewrite: check out the frozen branch), restore the frozen `engine-worker.py`, and run the same kickstart. That rollback is proven by the 2026-11-21 cutover.
