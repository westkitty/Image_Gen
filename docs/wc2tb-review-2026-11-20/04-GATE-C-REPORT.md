# Gate C — durable engine transfer: implementation and crash-injection report

Date: 2026-11-20 · Status: **implemented and tested in isolation; not committed, not deployed**

| Item | Value |
|---|---|
| Worktree | `/Users/andrew/Image_Gen-gatec-20261120` (new, MacBook) |
| Branch / base | `wip/gate-c-transfer-journal-20261120` at `39534f2` (uncommitted changes) |
| Untouched | Big Mac checkouts, both 2026-11-20 isolated worktrees, `edit-ui.js`, DEX//REACH WIP |
| Not done (not authorized) | commit, push, merge, worker deploy, service restart, Big Mac generation, supervisor/Gate E |

All tests ran on the MacBook against temp directories under `/tmp`, a fake PIL engine, synthetic PNGs and a temp `HOME`. The real `engine-worker.py` ran under a clock wrapper, and the bridge ran as a real child process. `DEX_LOCAL_ENGINE_DIRECT=1` is always set so the client can never fall back to `ssh westcat`. No model, mount, TCC, SMB or Tailscale state was read or changed.

---

## 1. Change set (bounded)

| File | Change |
|---|---|
| `sdcpp-workflow/worker/engine-worker.py` (+~80) | Retention contract (§3.1). `expire_once()` never deletes a completed, unacknowledged result. Admission refuses new work at the retention bound (32 jobs / 8 GiB) or below 1 GiB free. `save()` fsyncs the file and the directory, and the restart path uses `save()`. Outputs are fsynced before `complete`. ACK is idempotent and persists `acknowledged` **before** unlinking outputs. `health.retention` lists unacknowledged run IDs, never tokens or hashes. |
| `operator-console/engine-transfer-journal.js` (new, ~405) | Durable internal journal, `advanceTransfer` (the one ordered state machine, used by both the bridge and recovery), `reconcileTransfers`, `ownerBackedRequest`, `transferPendingRunId`. |
| `operator-console/bin/local-engine-generate.js` | Journal entry created **before** `generate`; one lock per run; `advanceTransfer` replaces download → ACK → publish → manifest. Staging no longer lives in `$TMPDIR` and is never deleted in `finally`. Any failure that leaves an entry prints `ENGINE_TRANSFER_PENDING: <run>` and `First failed gate: engine-transfer-pending`. `createJobImageStore` is kept; `createJobPublication` is added. |
| `operator-console/publication-recovery.js` | An unreadable `runs` root yields `runs-root-unreadable` and `blocked: true`. An unreadable owner or manifest file yields `run-evidence-unreadable`. ENOENT on a fresh install is still not a failure. |
| `operator-console/server.js` | Outbox reconciliation failure sets BLOCKED (it was log-only). Startup transfer reconciliation runs, then retries every 60 s while entries remain; until resolved, heavy compute is quarantined through the existing arbiter `quarantineCheck`. A bridge `FAIL` carrying the pending marker maps to generic `INTERRUPTED`, not `FAILED`, so the existing receipt path can complete it. `/api/publication-recovery` reports `UNRESOLVED` instead of `CLEAR` while jobs or journals are unresolved. Disabled under `TestIsolation`. |
| Tests (new) | `sdcpp-workflow/worker/test_worker_retention.py` (10), `operator-console/tests/engine-transfer-crash.test.js` (22), `operator-console/tests/engine-transfer-journal.test.js` (7). Fixtures: `tests/fixtures/gatec/{fault-preload.js, worker-clock.py, recover.js}`. |

Production code has no test hooks. Faults are injected by a `node --require` preload that wraps module exports (`request`, `createImageStore`, `createTransferJournal`, `fs.*`), so **the same scenarios run unchanged against the pristine HEAD tree**.

## 2. Before / after failure matrix

"Before" = pristine `39534f2` export (`git archive`) run through the identical harness. "After" = the worktree. Pass means: exactly *N* distinct canonical images whose digests equal the worker result, a PASS manifest, generic job `COMPLETE`, no journal residue, and the worker copy released only after all of that. For the block scenarios, pass means an explicit BLOCKED reason with no publication and no deletion.

| # | Fault boundary | Before (HEAD) end state | After |
|---|---|---|---|
| 1 | Client SIGKILL before first `result`, +3700 s | **Lost**: worker expired outputs; nothing canonical; job INTERRUPTED forever | ✔ published once |
| 2 | SIGKILL after `result`, before first durable write, +3700 s | **Lost** (same) | ✔; the journal held no prompt, token or `token` field |
| 3 | Partial batch (1 of 3 downloaded) then SIGKILL, +3700 s | **Lost ×3** | ✔ 3 distinct |
| 4 | Backend dies mid-generation, away >3600 s | **Lost** | ✔ |
| 5 | Worker restart with completed, unacknowledged result, +3700 s | **Lost** | ✔ |
| 6 | SIGKILL after worker ACK, before publication | **Lost** (ACK deleted the worker copy; staging orphaned in `$TMPDIR`) | ✔ |
| 7 | Ordinary exception during publication, after ACK | **Lost** (`finally` deleted staging) | ✔ retained, then published |
| 8 | Uncertain ACK (worker acted, reply lost) | **Lost**: same profile as the unproven 2026-11-10 `e71681a1` candidate | ✔ re-ACK idempotent |
| 9 | SIGKILL between canonical link and run index | Canonical bytes repaired, **no manifest, job never COMPLETE** | ✔ |
| 10 | SIGKILL after run index, before manifest | **No manifest, job never COMPLETE** | ✔ |
| 11 | Transfer write EIO, +3700 s | **Lost** | ✔ |
| 12 | Low disk (no free space + ENOSPC), +3700 s | **Lost** | ✔ refused before download/ACK; worker kept copy |
| 13 | SIGKILL after ACK of a 3-image batch | **Lost ×3** | ✔ |
| 14 | Two concurrent + one repeated reconciliation | No reconciliation exists; image lost | ✔ exactly once (per-run lock + run-index idempotency) |
| 15 | Repeated retries while worker unavailable | No reconciliation | ✔ `pending/worker-unavailable` ×3, then completes |
| 16 | Owner record missing, +3700 s | Worker expired the only copy | ✔ BLOCKED `owner-record-missing`; worker still holds it |
| 17 | Owner record corrupt, +3700 s | Same | ✔ BLOCKED `owner-record-corrupt` |
| 18 | Corrupt journal image bytes | No journal exists | ✔ BLOCKED `journal-digest-mismatch`; nothing published; evidence kept |
| 19 | Corrupt journal record | No journal exists | ✔ BLOCKED `journal-record-corrupt` |
| 20 | Cancel during generation (control) | ✔ | ✔ |
| 21 | Cancel after download, before ACK (control) | ✔ | ✔ explicit discard, worker released |
| 22 | Uninterrupted single + batch (control) | ✔ | ✔ |
| | **Totals** | **3 pass / 19 fail** | **22 / 22** |

Worker retention (`test_worker_retention.py`, same file run with `DEX_GATEC_WORKER` → HEAD): **before 2 pass / 8 fail** (expiry deletes unacknowledged single, batch and post-restart results; no fsync; unlink before receipt; no retention bound; no disk floor; no `health.retention`), **after 10 / 10**.

Recovery status (`engine-transfer-journal.test.js` against HEAD): an unreadable `runs` root and unreadable run evidence both come back as `no-exact-owned-published-artifact` (the live CLEAR-with-18-unresolved symptom). **Before 1 pass / 2 fail / 4 skipped (no journal)**, **after 7 / 7**.

## 3. Contracts

### 3.1 Worker retention contract
1. A `complete` result that hasn't been acknowledged is the only recoverable copy. **Time never deletes it.** The 3600 s expiry applies only to acknowledged, failed or cancelled jobs.
2. Capacity is bounded by **refusing admission**, never by deletion: new `generate` fails once unacknowledged results reach 32 jobs or 8 GiB, or free space on the worker root drops below 1 GiB. That is "blocked before generating unrecoverable output".
3. Receipt writes use tmp → fsync → rename → fsync dir. Outputs are fsynced before the receipt says `complete`.
4. `ack` persists `acknowledged` first, then unlinks outputs, and is idempotent. A crash between those two steps leaves an acknowledged receipt whose outputs the normal expiry removes later.
5. Restart keeps completed results. `health.retention` reports `{jobs, bytes, max_*, unacknowledged:[run_id]}`, with no secrets.

### 3.2 Durable publication contract (ACK-after-durability, publication-after-ACK)
Order is unchanged in spirit: the worker is told to release only after the client is durable, and canonical publication follows a verified ACK.

1. **Journal location:** `~/Library/Application Support/DexDiffusion/engine-transfer/<run_id>/`. It must sit below `$HOME`, on the home device, with no symlink components, outside `DEX_DATA_ROOT`, owned by the user, mode `0700` (files `0600`). Validated before any run is announced.
2. **Record** `transfer.json` (schema `dexdiffusion.engine_transfer.v1`): run ID, job ID, run dir, count, run file names, allow-listed metadata (target, dims, steps, seed, sampler, scheduler, cfg, adapter IDs, `save_prompts` boolean), and digests. **No prompt, no negative prompt, no token.** The token stays in the protected owner record `~/.dexdiffusion-engine-client/<run_id>.json`. If that record is missing or corrupt, the result is BLOCKED wherever the worker would have to be asked.
3. **States:** `requested` (written before `generate`) → `downloading` → `downloaded` (every byte fsynced and re-hashed from disk) → ACK → `acked` → publish → `published` → PASS manifest (fsync) → outbox check → entry removed. Side paths: `discarding` (explicit cancel) and no-output (worker says failed or cancelled, or never accepted the job).
4. **Writes:** `O_EXCL` tmp → write → fsync → rename → fsync dir. Capacity check before download: free ≥ max(1 GiB, 3 × bytes); journal ≤ 200 entries and 2 GiB.
5. **Idempotency key** `(run_id, run_file, sha256)` against the run index. Already-indexed images are never republished, which prevents the `-2` duplicate the image store would otherwise create.
6. **One owner per run:** a `.lock` holding the owner PID. A live owner gets `transfer-in-progress`; a dead owner's lock is reclaimed.
7. **Cancellation** is durable (`cancel_requested` in the record, or the run's `publication-decision.json` saying `cancel`). It discards explicitly; it never publishes.
8. **No `finally` deletion.** An entry is removed only with publication evidence (run index + canonical bytes + digest + manifest + outbox record when cross-host) or a definite no-output answer.

### 3.3 End-to-end reconciliation (startup and every 60 s while pending)
Image-store `.pending` recovery → outbox rebuild (failure = BLOCKED) → `reconcileTransfers` (status → download → ACK → publish → manifest → outbox) → `reconcileInterruptedPublications`. That last step marks the job `COMPLETE` only with the existing validated-receipt contract.

The generic job becomes `INTERRUPTED`, not `FAILED`, when the bridge leaves an entry, so it can still complete. While any entry is pending or blocked, `/api/publication-recovery` is `BLOCKED` and heavy compute is quarantined. Historical no-output interruptions report `UNRESOLVED`, never `CLEAR`.

## 4. Test results (exact, including failures)

| Suite | Result |
|---|---|
| Worker existing `test_engine_worker` (`/usr/bin/python3`) | 28 / 28 OK |
| Worker `test_worker_retention` | 10 / 10 OK (HEAD: 2 / 8) |
| Gate C crash harness | 22 / 22 (HEAD: 3 / 19) — see §6 for final post-edit rerun |
| Gate C unit (`engine-transfer-journal.test.js`) | 7 / 7 (HEAD: 1 pass, 2 fail, 4 skip) |
| Baseline target suites (canonical publication, atomic race, publication recovery, worker publication, outbox, bridge, failure, media publication, ledger) | 69 / 69 before the change; included in the full run below |
| Full `node --test tests/*.test.js` (first run) | 1514 tests: 1503 pass, **7 fail**, 4 skipped |

The seven full-suite failures, triaged against the pristine HEAD export:

| Test | Cause | Mine? |
|---|---|---|
| `generic server completion requires a fresh canonical receipt…` | My `syncGenericTerminal` referenced the module-level `EngineTransfer`, but the test evaluates that function in a sandbox. **Fixed** (self-contained marker regex); file now 4 / 4 | **Yes — fixed** |
| `Big Mac worker CLI durably records MacBook-pull intent…` | Cross-host path requires hostname `bigmac`; MacBook | No (fails on HEAD) |
| `World fusion reads real Gaussian SH DC color…` ×2 | World/3D toolchain on this host | No (fails on HEAD) |
| `backend identity reports stable process-start timestamp…` | Host/environment | No (fails on HEAD) |
| `bin/dexdiffusion status is read-only and degrades…` | Host/environment | No (fails on HEAD) |
| `server wires the scanner into generation and edit validation` | Source-text assertion (`validatePromptLoras(...)`) unrelated to Gate C | No (fails on HEAD) |

## 5. Compatibility and regression findings
- **Worker ⇄ bridge mixed versions.** The new bridge works with the old worker (it uses only existing ops; `health.retention` is optional). But the old worker still expires unacknowledged results after 3600 s, so durability only holds end to end once **both** are deployed. The new worker with the old bridge is strictly safer (nothing expires; the old bridge's `finally` loss after ACK remains).
- **Storage location.** The journal is on the Big Mac internal volume by design, so external (wc2tb) EPERM can't strand it. Publication into an unreadable external `runs`/`images` stays `pending/publication-failed` (BLOCKED) and retries; it is never dropped.
- **Behaviour changes users will see:**
  - After an interruption a job reads INTERRUPTED instead of FAIL, then COMPLETE once reconciled.
  - The status endpoint reads UNRESOLVED instead of CLEAR when historical jobs remain unresolved.
  - Heavy compute stays quarantined while any transfer is pending.
  - The worker refuses new work when the retention bound or disk floor is hit.
- **Thresholds.** 1 GiB floors (journal and worker) were chosen because this MacBook has 2.96 GiB free and 4 GiB would fail every test here. **They must be confirmed on Big Mac** (~8–12 GiB free) before acceptance.
- **Edge cases accepted.**
  - Lock-PID reuse could wrongly report `transfer-in-progress` (fail-closed, retried).
  - A cancel after ACK that the bridge didn't survive to record is published by recovery rather than discarded (preferring retention over loss).
- `publishAfterAcknowledgment` and `createJobImageStore` exports are kept for existing tests and callers.

## 6. Remaining blockers for live acceptance
1. Owner review of the diff, then commit on the isolated branch (not authorized in this task).
3. Deploy the worker and the console together to Big Mac (needs explicit authorization; EngineHost/worker restart while idle).
4. Confirm 1 GiB / 32-job / 8 GiB thresholds against Big Mac free space.
5. Production-representative proof on Big Mac: one real SIGKILL-after-ACK and one uncertain-ACK run, under the authorized session, with the real wc2tb publication path. That is Gate E territory, not started.
6. Existing unresolved journals and jobs on Big Mac (the 18 jobs, the candidate `e71681a1` loss) are unchanged. The new status will show them as UNRESOLVED or BLOCKED; their investigation remains separate.
7. Gate B (TCC attribution) still governs whether external publication succeeds at all. Gate C only guarantees nothing is lost while it doesn't.

## 7. Final rerun (after the last bridge and server edits)
| Suite | Result |
|---|---|
| Gate C crash harness | **22 / 22 pass** |
| Worker `test_engine_worker` + `test_worker_retention` | **38 / 38 OK** |
| Full `node --test tests/*.test.js` | **1514 tests: 1504 pass, 6 fail, 4 skipped**. All 6 failures also fail on the pristine HEAD export (§4 triage); the one regression I introduced is fixed. |

No `/tmp/dgc-*` fixture directories remain. Nothing is committed (`git status`: 4 modified, 5 new paths on `wip/gate-c-transfer-journal-20261120`).

**Gate C verdict:** every required fault boundary in §2 either recovers without silent loss or is explicitly BLOCKED before unrecoverable output is generated, *in the isolated harness*. Live acceptance remains open (§6).

## 8. Owner-review corrections (2026-11-20, pre-commit)
| # | Defect | Correction | Regression test (pre-correction → corrected) |
|---|---|---|---|
| R1 | Missing `transfer.json` with surviving files returned `absent`; `reconcileTransfers` silently skipped it | `removeEmpty()` returns the surviving names; `advanceTransfer` throws `TransferBlocked('journal-record-missing')`; `absent` is reported as blocked defensively. Only a directory holding nothing but `.lock` or a record tmp is removed. | "record is missing but files survive": ✖ → ✔ (two attempts, evidence kept, nothing published) |
| R2 | `cancelled()` swallowed every error reading `publication-decision.json` and returned false (→ published) | `readDecision`: ENOENT = no decision; any other error or corrupt JSON = `TransferBlocked('cancellation-evidence-unreadable')`; `cancelled()` no longer catches | EPERM and EIO, each injected (a) live, before ACK and (b) during recovery, after ACK: 4 × ✖ → 4 × ✔ |
| R3 (audit) | A record's `run_dir` and `run_files` were trusted as written (path escape) | The record must have `basename(run_dir) == run_id` and plain `*.png` run files. Bridge and recovery require `run_dir` to be exactly `<runsRoot>/<run_id>`, else `run-dir-untrusted`. | "run_dir outside the runs root": new ✔ |
| R4 (audit) | `refreshPublicationBlocked()` ignored a BLOCKED rerun of job reconciliation | Includes `jobs.blocked` | covered by suite |

**Durability contract after corrections.** Every new check throws *before* the ACK or publish step it guards, and none deletes anything:
- R2 live: the worker stays un-ACKed and keeps its copy (asserted).
- R2 after ACK: the journal bytes are kept (asserted).
- R1 and R3: no worker call; the journal is kept.

Once the fault clears, the same entry publishes exactly once (asserted). Side effect: if the external `runs` folder is unreadable, the result stays on the worker (un-ACKed, never expired, bounded by worker admission) rather than being copied into the journal first.

**Exact final results:**
- Worker `test_engine_worker` + `test_worker_retention`: 38 / 38 OK.
- Journal unit tests: 7 / 7.
- Crash harness: 28 / 28 (22 + 6 new).
- Publication and cancellation suites (bridge, outbox, failure, canonical publication, atomic race, publication recovery, worker publication, media publication, ledger, server publication contract, 5 cancellation files): 105 / 105.
- Full suite: worktree **1520 tests, 1510 pass, 6 fail, 4 skip**; pristine full `git archive 39534f2`: **1485 tests, 1475 pass, 6 fail, 4 skip**. The **failure sets are identical** (diff empty in both directions): the hostname-gated Big Mac outbox CLI test, World fusion ×2, backend start-time, `bin/dexdiffusion status`, and the scanner source-text test.

The earlier "macOS installer" failure came only from my partial HEAD export; the full export passes it.

## 9. Source-control checkpoint (authorized development checkpoint, not a production release)
| Item | Value |
|---|---|
| Commit | `f01ef2d1d8a7d38c609fe997fc54f677f8defaed` (`f01ef2d`) |
| Message | `fix(dexdiffusion): preserve engine results across crashes and publication failures` |
| Branch / parent | `wip/gate-c-transfer-journal-20261120`, parent `39534f2` |
| Files | 11 (4 modified, 7 added); 1356 insertions, 66 deletions; `git diff --cached --check` clean |
| Working tree after commit | clean |
| Not done | push, merge, deploy, restart, any Big Mac change, Gate B, Gate E |

**Known baseline failures** (present identically at `39534f2` and `f01ef2d` on this MacBook; not introduced by Gate C):
1. `Big Mac worker CLI durably records MacBook-pull intent with canonical bytes` — cross-host path is gated on hostname `bigmac`.
2. `World fusion reads real Gaussian SH DC color, never fabricates gray` — world/3D toolchain on this host.
3. `World fusion rejects source missing color instead of silently whitening all points` — same.
4. `backend identity reports stable process-start timestamp across requests` — host environment.
5. `bin/dexdiffusion status is read-only and degrades when services are unavailable` — host environment.
6. `server wires the scanner into generation and edit validation` — source-text assertion unrelated to Gate C.

Live acceptance (§6) remains open. Unchanged requirements: permanent wc2tb model storage, SMB/TCC configuration, Gate B, Gate E.
