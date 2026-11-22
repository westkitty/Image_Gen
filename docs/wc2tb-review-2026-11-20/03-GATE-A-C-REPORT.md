# Gate A + Gate C Report — read-only investigation (2026-11-20, 14:00–14:40 Big Mac local)

**Scope authorized:** read-only process, binary, signing, TCC and launch-service inspection; read-only examination of the worker, backend and recovery paths; a Gate C source audit; harness design; worktree preservation planning.
**Done on Big Mac:** read-only commands only, over the existing Tailscale SSH. That covered `ps`, `lsof`, `codesign`, `launchctl print`, `log show`, `git status/diff`, `shasum`, `stat`, `ls`, one worker `health` IPC call (it opens registered model files for 1 byte), and loopback `GET`s on `127.0.0.1:31337` (`/api/publications/status`, `/api/publication-recovery`, `/api/generic-jobs/:id`). Each SSH command used temp files under `/tmp` and deleted them in the same command.
**Not done:** no probe file and no external write; no restarts, Homebrew, permission, SMB, Tailscale or mount changes; no worker deploy; no inference; no source edits; no worktree changes. The DEX//REACH MCP tool is unauthenticated in this session, so I issued **no** DEX//REACH commands; DEX//REACH evidence below comes from existing logs only.

Proof labels: `LIVE` = observed today in the real context. `LOG-HISTORICAL` = taken from retained OS or app logs, not reproduced today. `SOURCE` = read from code. `INFERRED` = reasoned from other evidence. `UNKNOWN` = not established. Per your rule, a missing TCC log line is **never** treated as proof of anything.

---

## 1. Attribution matrix

Failure classes (kept separate): **SE** = stale executable (accessing or responsible binary path gone); **CS** = code-signing identity changed; **MG** = missing or denied grant (`authValue=0` with an attribution chain that resolved); **AC** = attribution chain could not be built.

| Context | Responsible root (TCC) | Removable Volumes result | Evidence | SE | CS | MG | AC | Proof |
|---|---|---|---|---|---|---|---|---|
| **Engine worker** PID 723 (python 3.15.2, on disk) | `local.dexdiffusion.engine-worker` PID 683, `responsible_path=…/DexDiffusion Engine Worker.app` | **ALLOWED** — `authValue=2, authReason=2` (user consent). The `AllFiles` preflight was `authValue=0` (denied), so access comes from the Removable Volumes grant, not Full Disk Access | tccd at 14:09:28 during my `health` call. Health: 19/19 models, 19/19 access probes, 2/2 ControlNets, interpreter_ok, idle, no recovery uncertainty | no | no (cdhash not compared to an earlier baseline: **UNKNOWN**) | no | no | **LIVE** |
| **Backend** PID 77247 (`node`, Cellar `26.13.1`, **deleted**) | itself (orphan, PPID 1) | **DENIED by attribution failure.** For each request sandboxd asks `AllFiles` then `RemovableVolumes`; tccd answers `proc_pidpath_audittoken() failed from PID[77247]: ENOENT`, "Failed to create Attribution Chain", `auth_error_code=5` | **308** failure events for PID 77247 in retained logs (first **2026-11-19 03:58**, latest 13:51 today). The backend's own stderr (`diagnostics/authorized-recovery-udBYyird`, created at its spawn on Nov 14 22:34) has **133** `EPERM`s: voice/drama media (`output/audio/voice/*.wav|mp3|m4b`), `scandir runs`, `state/staging/stg-*.png|jpg` | **yes** (its own binary is gone) | UNKNOWN | not tested (chain never resolves) | **yes** (consequence of SE) | **LIVE** (log of the live process) |
| Backend, earlier (Nov 14 spawn → before deletion) | spawned from a DEX//REACH session | worked at start (probe passed, `mode=external`) | E9 HTTP 200s; some reads still succeed today **without** any tccd event (no 77247 entries around my 11:11 `world/projects` call) | — | — | — | — | **UNKNOWN** why some reads still succeed. Candidates: in-memory cache, or a per-process decision cached from before the deletion. A missing tccd line proves nothing |
| **DEX//REACH shell children** of node PID 77284 (Cellar `26.13.0_2`, **deleted**) | 77284 | **DENIED by attribution failure:** `proc_pidpath_audittoken() failed from PID[77284]` → "failed to construct a process for the responsible audit token for PID[<child>]" | **31** events today (for example children 26109 and 26613 at 08:16). No DEX//REACH command issued by me | **yes** (responsible binary gone) | UNKNOWN | not tested | **yes** | **LOG-HISTORICAL** (today, not reproduced by me) |
| **Tailscale SSH** shell (parent `tailscaled be-child ssh-monitor`; `tailscaled` 1.104.7 **is on disk**) | not resolvable | **DENIED by attribution failure:** "Failed to fetch responsible file descriptor: ENOENT", "failed to construct a process for the responsible audit token" | my `ls` of `state` at 11:12 and 11:13 | **not shown**: the binary exists, so this is **not** the Homebrew-deletion mechanism | UNKNOWN | not tested | **yes** | **LIVE**; root cause **UNKNOWN** (likely how `be-child` is spawned or exits) |
| **Terminal.app** (user grant 2026-11-05, per project memory) | Terminal | not exercised today | memory only | — | — | — | — | **UNKNOWN** today |
| **launchd-launched backend** (`local.dexdiffusion.server`) | (would be the `node` job itself) | not exercised; it would need a load (🔒) | the `…plist.disabled-tcc-20261102` artifact; pre-Nov-11 `EPERM`s in `server-error.log` | — | — | — | — | **UNKNOWN** (Gate E/G) |
| **Inference child** of the worker | expected: EngineHost | not exercised (needs live inference 🔒) | 19/19 model *opens* by the worker itself; children not observed | — | — | — | — | **UNKNOWN** (Gate B) |

**Conclusions**

1. H0 (stale Homebrew executable → attribution failure) is **LIVE-confirmed for the backend** and **log-confirmed for DEX//REACH children**. It is **not** the mechanism for Tailscale SSH, which is a separate attribution failure with an unknown cause.
2. The one context with a resolved chain and a grant is the EngineHost app. It is `ALLOWED` by user consent for Removable Volumes and is not using Full Disk Access.
3. **Timing:** the earliest retained backend failure is 2026-11-19 03:58. The new `node` keg is dated 2026-11-16 07:34; the deletion time of the old keg is **UNKNOWN**. The last worker job, and the last `state`/`runs` mtimes, are 2026-11-16 ~01:06, so **no image has been generated since then**.
4. The backend's own `EPERM`s on `runs` and `state/staging` mean that **an image generation started on today's backend could fail, or could hit the publication defect in §2.** Do not run one until Gate C is fixed (blocker list, §6).

---

## 2. ACK / publication failure boundaries (source: `bin/local-engine-generate.js`, `image-store.js`, `engine-worker.py`)

Sequence and where each copy of the image lives:

| Step | Code | Worker copy | Transfer copy (`$TMPDIR/dex-engine-transfer-*`) | Canonical (`imageRoot`, internal staging in external mode) |
|---|---|---|---|---|
| S1 `generate`/`status` loop | 143–149 | being written | — | — |
| S2 `result` + SHA-256 verify + `writeFileSync` | 162–176 | ✓ | ✓ (not fsynced) | — |
| S3 `ack` | 178 → `engine-worker.py:404-410` | **unlinked**, `acknowledged=True` saved | ✓ | — |
| S4 `publishFiles` start: `copyFile` → `.incoming-*` (fsync) → validate | `image-store.js:245-253` | — | ✓ | `.incoming` |
| S5 read run index, run owner, `claimRunDecision` (**files in `runs/<id>` on wc2tb**) | 255–265 | — | ✓ | `.incoming` |
| S6 `.pending-*.json` intent journal (atomic + fsync) → `link` into root → fsync dir | 280–286 | — | ✓ | ✓ + journal |
| S7 `writeRunIndex` (**wc2tb**) → `committed=true` → `onPublished` (outbox create) → journal `run-index-committed` | 289–298 | — | source unlinked after commit (302) | ✓ |
| S8 manifest write `controlled-manifest.json` (**wc2tb**) | 183–190 | — | — | ✓ |
| S9 `finally rmSync(stagingDir)` — **runs on success and on every error** | 198 | — | **deleted** | — |

| Boundary | Failure | Outcome with **current** code | Covered by an existing mechanism? |
|---|---|---|---|
| **B1** crash after S2, before S3 | kill | Worker keeps the PNG until `expire_results` (**3600 s**), then deletes it; the job stays not-ACKed. Backend restart marks the job `INTERRUPTED` and does not re-run it. The transfer dir is orphaned (internal `$TMPDIR`), with nothing to reconcile it | **No** (nothing re-fetches from the worker within the hour) → **LOST after 1 h** |
| **B2** crash after S3, before S4 | kill | Worker copy gone; the only copy is in an orphan `dex-engine-transfer-*` | **No.** Nothing references that prefix → **LOST** |
| **B3** *throw* in S4/S5, e.g. `EPERM`/`ENOENT` on `runs/<id>` (today's backend), `ENOSPC` (12 GiB free), invalid index, run-owner mismatch | throw | publishFiles cleans up `.incoming`; the error reaches S9 `finally`, which deletes the transfer copy | **No** → **LOST, deterministically, without any crash** |
| **B4** crash in S6 (after intent, before/after link) | kill | `.pending` journal plus `.incoming`/linked file are internal | **Yes:** `recoverPendingPublications` (`image-store.js:318+`) → RECOVERABLE (journal design + existing `fault` hooks). Must still be proven in the harness |
| **B5** *throw* at S7 `writeRunIndex` (wc2tb EPERM/ENOSPC) | throw | `committed=false`, so links and `.incoming` are rolled back, then S9 deletes the transfer copy | **No** → **LOST** |
| **B6** crash in S7 after `committed`, before or during `onPublished`/journal phase update | kill | Canonical bytes plus run index exist; the outbox entry may be missing, so the MacBook may never pull | **UNKNOWN** — the outbox-recreation path must be tested |
| **B7** crash after S7, before S8 manifest | kill | The image is canonical, but `reconcileInterruptedPublications` requires `controlled-manifest.json` with `status: PASS`, so the job stays `INTERRUPTED/unresolved` | **Partly:** not lost, but **falsely incomplete** |
| **B8** worker restart (interpreter watcher) between S2 and S3 | restart | The worker reloads jobs from receipts; outputs persist until expiry; the client sees `ack` fail → the S9 cleanup and the catch-block `cancel` run | **Partly:** worker copy exists ≤ 1 h, transfer copy deleted, so → **LOST after 1 h** unless re-fetched |

**Supporting live observations (not proof of loss):**

- `/api/publication-recovery`: status `CLEAR`, yet `jobs.inspected=18, recovered=0, unresolved=18`, all `no-exact-owned-published-artifact`, all `INTERRUPTED`, gate `server-restart`, dated Sep 26 – Nov 10. A `CLEAR` status alongside 18 unresolved jobs is itself a reporting gap.
- I matched those jobs to worker receipts by time window, which is fuzzy: 3 jobs share one receipt. One strong candidate: **job `55643cbe` (Nov 10 00:03 local)** → worker run `20261110-070346-controlled-sdxl-epicrealism-e71681a1`, receipt `complete, acknowledged=True` at 00:08:54. Its image is **not** in the MacBook `~/images_made` or `~/images_made_nah` by run ID or by SHA-256 `f0f124b1…85ccf`, and not in Big Mac `PublicationStaging`. That matches **B2/B3/B5**. It is **not proven**: the owner may have deleted it, a copy may exist under wc2tb `runs/`, and canonicalization could change bytes (the run-ID name search also missed). **Closing it needs one read-only Terminal `ls` of `/Volumes/wc2tb/DexDiffusion/runs/20261110-070346-controlled-sdxl-epicrealism-e71681a1/` by the owner.**
- One empty orphan `$TMPDIR/dex-engine-transfer-CCTVUQ` (Nov 13 03:35) exists. That shows S9 did not run at least once (process killed); it does not show a loss.
- `reconcileInterruptedPublications` wraps `readdirSync(runsRoot)` in `try {} catch (_) {}`. If `runs` is unreadable (today's `EPERM`), **every** interrupted job silently becomes "no artifact" even when the image exists. That is a misclassification risk at the next restart.
- `$TMPDIR` for the bridge child is inherited (`/var/folders/...`, internal) because the orphan got it from its spawning session. `childStorageEnvironment` sets `TMPDIR=<dataRoot>/scratch` (**wc2tb**) whenever `TMPDIR` is unset, so under a launchd or worker-spawned backend the transfer copy may land on wc2tb. That is context-dependent and must be pinned.

---

## 3. Existing recovery mechanisms vs. boundaries

| Mechanism | Protects | Does not protect |
|---|---|---|
| `image-store` `.pending` journal + `recoverPendingPublications` + `fault` hooks (`before-transfer … after-metadata`) | B4; possibly B6 (UNKNOWN) | anything before S6 (B1–B3) and throws that roll back (B5) |
| `reconcileInterruptedPublications` (startup) | marks a job COMPLETE **only if** a canonical image + run index + PASS manifest already exist | B1–B3, B5 (no bytes to find); B7 (manifest missing → falsely incomplete); swallows `EPERM` |
| Worker receipts + `expire_results` (1 h) | keeps unACKed outputs for 1 h | nothing re-fetches them after a client crash |
| Publication outbox → MacBook pull + SHA-256 ACK | after S7 | before S7 |

**No existing mechanism closes B1, B2, B3, B5 or B7.**

---

## 4. Corrected internal journal: location and durability contract

**Location:** `/Users/bigmac/Library/Application Support/DexDiffusion/engine-transfer/`. This is a fixed constant and does **not** follow `DEX_DATA_ROOT`, `DEX_STATE_DIR` or `TMPDIR`. Application Support is not purged the way Caches or `/var/folders` are. The only override is a test-isolation variable, which is honoured only when `TestIsolation.enabled()`.

**Startup validation:** refuse to admit bridge jobs, with an honest error, if any of these fail:

- every path component from `$HOME` down is `lstat`-checked as a real directory, not a symlink;
- the final `realpath` equals the constant;
- `st_dev` equals `st_dev` of `/Users/bigmac`, so it is on the internal device;
- owner is `bigmac` and mode is `0700`; files are `0600`.

**Layout:** `<run_id>/` (same `ID` regex as `local-engine-client.js`) containing `output-<i>.png` and `transfer.json`.

**Atomic write rule:** write `.<name>.tmp-<rand>` with `O_EXCL` → `fsync` the file → `rename` → `fsync` the directory. Never overwrite in place.

**`transfer.json` (schema `dexdiffusion.engine_transfer.v1`):**

- fields: `run_id`, `job_id`, and `images[{index, file, sha256, bytes}]`;
- `state` is one of `downloaded`, `acked`, `published`, `quarantined`;
- `image_ids` is set after publication;
- timestamps for each state;
- **no** worker token (secret) and no prompt.

**New sequence:**

1. Download and verify the SHA-256.
2. Write the PNGs and `transfer.json{downloaded}` (all fsynced).
3. `ack` the worker.
4. Set `{acked}`.
5. `publishFiles(src = journal files)`. The existing `.pending` journal takes over from S6.
6. Set `{published, image_ids}`.
7. Write the manifest.
8. Delete the `<run_id>/` directory.
9. **On any error, never delete journal files.** Report the job as `PUBLICATION_RECOVERY_PENDING` instead of failed.

This keeps "ack before publish" and "no network await after publish".

**Reconciliation:** the backend runs it at startup before admitting jobs, and on a timer. It is the single owner of this directory.

| State found | Action |
|---|---|
| `downloaded` | re-verify the SHA-256. If the worker receipt is not ACKed, ACK it; if expired or ACKed, continue. Then publish |
| `acked` | look for `(run_id, run_file, sha256)` in the run index or canonical store. If present, mark `published`; otherwise publish |
| SHA mismatch or unreadable | `quarantined`, with the reason shown in `/api/publication-recovery`. **Never** mark complete |
| After publication | transition the job through the existing job store (fixes B7: the journal replaces the manifest as evidence) |

**Idempotency:** the key is `(run_id, index, sha256)`. Before linking, `publishFiles` callers check the run index for an existing matching entry and reuse it, so no duplicate canonical files are created.

**Capacity:** at admission, require internal free space ≥ **max(4 GiB, 3 × expected bytes × batch)**. The journal has a hard cap of **2 GiB or 200 entries**; quarantined entries count toward it. Above the cap, refuse new bridge jobs with an honest error. Published entries are deleted immediately; quarantined entries are kept until the owner acts.

**`runs` dependency:** S5, S7 and S8 still write `runs/<id>` on wc2tb. With the journal, a wc2tb failure there becomes **recoverable** instead of a loss. Separately, `reconcileInterruptedPublications` must surface `EPERM` on `runs` as `BLOCKED`, not as `no-artifact`.

---

## 5. Proposed crash-injection harness and expected results (design only; no code written)

**Setup:**

- Node test under `operator-console/tests/`, with `TestIsolation` on;
- a stub worker implementing `request()` for `generate/status/result/ack`, holding PNG fixtures and applying the real ack semantics (unlink + `acknowledged`);
- the real `image-store` on temporary **internal** roots;
- the journal path overridden to a temporary directory;
- a fake outbox.

**Fault injection:** a `fault(point)` hook that either throws (mode `throw`, including synthetic `EPERM`/`ENOSPC`) or SIGKILLs a child process (mode `crash`). After each fault, run startup reconciliation and assert the outcome. Points: `after-result`, `after-journal-downloaded`, `after-ack`, `after-journal-acked`, the existing image-store points (`before-transfer`, `after-transfer`, `after-validation`, `after-decision`, `after-intent`, `before-publication`, `after-publication`, `before-metadata`, `after-metadata`), `after-published`, `before-manifest`, `after-manifest`.

| Point (crash / throw) | Current code (expected, to demonstrate the defect) | Fixed code (required) |
|---|---|---|
| after-result | LOST after the worker's 1 h expiry / LOST | recoverable (journal `downloaded` or worker re-fetch) |
| after-ack | **LOST / LOST** | recoverable from journal `acked` |
| before-transfer … after-decision (incl. synthetic EPERM on `runs`) | LOST / **LOST** | recoverable |
| after-intent … after-publication | recoverable (existing) / rolled back → **LOST** | recoverable / recoverable |
| before-metadata (`writeRunIndex` EPERM/ENOSPC) | — / **LOST** | recoverable |
| after-metadata (outbox not yet created) | UNKNOWN / UNKNOWN | published **and** outbox entry present after reconciliation |
| before-manifest | falsely incomplete | COMPLETE from journal evidence |
| any point × duplicate reconciliation run | — | exactly one canonical file per `(run_id, index, sha256)` |
| journal dir symlinked / wrong device / mode wrong | — | admission refused, honest error |
| free space below floor | publish fails mid-way | admission refused before `generate` |

**Pass rule:** in the fixed column, no point may end LOST, duplicated or falsely complete. Also run the existing `canonical-publication`, `atomic-publication-race` and `publication-recovery` suites unchanged.

---

## 6. Corrected Gate E test-launch design

The production runner `scripts/run-backend-service.sh` **stays unchanged**. It keeps rejecting any `DEX_DATA_ROOT` other than `/Volumes/wc2tb/DexDiffusion`, and a regression test will assert that.

**New test-only launcher** `scripts/test/run-optionA-probe-backend.sh`, never referenced by any plist or installer:

- **Identity guard:** runs only as `bigmac@bigmac`, only with `DEX_TEST_INSTANCE=optionA-<ts>`, and refuses to start if `OPERATOR_CONSOLE_PORT` is `31337` or `31338` (fixed test port `31347`).
- **Roots:**
  - test data root `/Volumes/wc2tb/DexDiffusion-OptionA-Test/` (🔒: creating it is an external write);
  - internal test root `/Users/bigmac/DexDiffusion-OptionA-Test-internal/` holding staging, logs, journal override and `TMPDIR`;
  - both are checked with the same symlink and device rules as the production runner;
  - `DEX_DATA_ROOT_MOUNT=/Volumes/wc2tb` and the `assertDataRootMount` check remain on.
- **Isolation:**
  - **Not** `DEX_TEST_ISOLATION`. It deliberately blocks the local-engine generators and every `sdcpp-workflow/bin` script (`test-isolation.js:6-10`), which are exactly what this gate must exercise.
  - `crossHostPublicationEnabled` stays on (data root set, host `bigmac`), so the test instance uses the real outbox code. Pin `DEX_MACBOOK_IMAGES_URL=http://127.0.0.1:31348`, a loopback **fake MacBook image service** owned by the test, so it never falls back to `127.0.0.1:31338`, the real MacBook image path.
  - The real MacBook puller only targets `:31337`, so it never pulls from `:31347`. A test-side fake puller drains the test outbox with `macbook-pull-v1` semantics into a test-owned directory. The launcher refuses to start if `DEX_MACBOOK_IMAGES_URL` is unset or points at `:31338`.
  - `DEX_CHAT_ENABLED=0`.
  - The bridge is on, using the **real** worker socket, so the shared heavy-job lease and worker admission still apply.
  - Real MacBook publication stays in Gate G.
- **Code under test:** a dedicated read-only worktree at the exact candidate commit (`/Users/bigmac/Image_Gen-optionA-test`), running the same `/opt/homebrew/bin/node server.js`, the same external-mode code paths and the same workflow scripts. The production checkout is untouched.
- **Spawn path:** the worker supervisor, configured with `supervise-backend.json`, pointing at this launcher. That requires deploying a modified `engine-worker.py` (🔒, idle worker restart, instant rollback copy).

**What it must show:**

- tccd attribution for the test `node` (fresh read of an **existing** test-owned file under the test root) and for one workflow child, both resolving to `local.dexdiffusion.engine-worker`;
- the lifecycle matrix (plan §3 Gate E);
- that `TMPDIR` resolves internally.

**Boot and login (corrected):**

- Big Mac has `autoLoginUser=bigmac` and FileVault off. EngineHost is a **per-user gui-domain LaunchAgent**, so it starts only after `bigmac`'s session exists.
- "Survives reboot" therefore means **reboot → auto-login → agent start**, which must be witnessed. Separately, a **manual logout/login** must be witnessed.
- No claim of availability **before login**. Auto-login can be disabled by OS updates or by turning on FileVault; if that happens, boot recovery is `BLOCKED` until someone logs in.

---

## 7. Cross-machine recovery request mechanism

**Constraint:** there is no shared filesystem and no new network configuration. The existing authorized connection is the MacBook → Big Mac **Tailscale SSH** (`ssh westcat`), which the recovery controller already uses for the tunnel and `local-engine-client.js` already uses for `engine-worker.py client`.

**Mechanism (Option A only):**

1. A new closed worker IPC op, `backend_request`, with exactly these fields: `{op, request_id (uuid), action ∈ {restart, status}, reason ∈ {health-failed, stale-binary, operator}, requested_by ∈ {macbook-recovery-controller, operator}, nonce}`. No paths, commands, env or free text. It is added to the existing `validate()` allow-list.
2. The MacBook controller calls it through the **existing** command `ssh -o BatchMode=yes westcat '/opt/homebrew/bin/python3 /Users/bigmac/.dexdiffusion-engine/engine-worker.py client'`, passing JSON on stdin. This needs no wc2tb access, so the SSH attribution failure does not matter.
3. **Authentication** is the existing SSH key, the Tailscale identity, and the Unix user `bigmac` (socket `0600`). Limitation, stated honestly: any `bigmac` process could call it, which is why it can only **request**. No HTTP route may proxy this op; a test will assert there is none.
4. **Bounds:** at most one pending request; at least 5 minutes between executed restarts; requests expire after 10 minutes; replayed `request_id`s or nonces are rejected; everything is journaled to `~/.dexdiffusion-engine/backend-requests.jsonl` (`0600`, size-capped).
5. **Decision:** the supervisor alone decides: execute, defer (joint-idle busy), or reject (circuit open, rate, expired). It replies synchronously with `{decision, reason, backend_pid}`. The controller **never** signals Big Mac processes and never runs `recover-backend-authorized.sh` for the backend under Option A. That script becomes `--status`, or forwards `--request` to this op.
6. **Before Option A:** the current executor stays `recover-backend-authorized.sh`. It **cannot** restore external mode today because its probe runs in the denied DEX//REACH context. That is a known `BLOCKED` state, not something to work around.

---

## 8. Worktree preservation inventory (fingerprints; nothing exported yet)

| Tree | HEAD | Tracked diff SHA-256 (first 16) | Untracked (SHA-256 first 16) |
|---|---|---|---|
| `/Users/bigmac/Image_Gen` (main) | `39534f2` | `c4616cc4dd98e5ed` (1 file +36/−2: `edit-ui.js`) | — |
| `/Users/bigmac/Image_Gen-dexdiffusion-20261120` (detached) | `39534f2` | `f3e4b302800c3c59` (2 files +42/−15) | `3dbec22ad41caef5 operator-console/bin/probe-local-engine.js` |
| `/Users/bigmac/DEX-REACH` (main) | `55f1d9a` (ancestor of `555befc`, so **behind** the remote main) | `e8ed70b1e6d103a9` (4 files +23/−1) | `90b3ceb3… src/shared/dex-relay-task-envelope.ts`, `27086708… tests/dex-relay-task-envelope.test.ts`, `a3f4a8da… tests/diagnostic-inspect.test.ts` |
| `/Users/bigmac/DEX-REACH-dexdiffusion-20261120` (detached) | `555befc` | `73442f3b923b9672` (2 files +49/−13) | `233ef468… scripts/lib/node-service.ts`, `f9b7bd4b… tests/dual-node-service.test.ts` |

Big Mac has a further 8+ Image_Gen and 3 DEX-REACH worktrees. Do not touch them.

**Preservation step** (🔒 because it writes on Big Mac, though only to a new backup directory):

- `git diff HEAD --binary > …/<tree>.patch`, plus `tar` of the untracked files, into `/Users/bigmac/DexDiffusion-preservation/wc2tb-20261120/` with a `SHA256SUMS` file;
- verify each bundle re-applies cleanly with `git apply --check` in a throwaway worktree at the same base;
- the Image_Gen isolated worktree's base is current main, so it needs **no rebase**;
- the DEX//REACH isolated worktree belongs to the separate `dexdiffusion` node project and is left as is.

---

## 9. Blockers needing owner authorization

| # | Item | Why |
|---|---|---|
| X1 | **Do not run live generation on today's backend** until the Gate C fix ships. Gate B should run only through a fixed client, or through the worker IPC directly with a test harness that keeps the bytes | the backend has live `EPERM` on `runs` and `state/staging` → B3/B5 loss path |
| X2 | 🔒 One read-only `ls -la` in **Big Mac Terminal** of `/Volumes/wc2tb/DexDiffusion/runs/20261110-070346-controlled-sdxl-epicrealism-e71681a1/` | closes or refutes the candidate loss |
| X3 | 🔒 Gate A context (d), a fresh backend read: there is **no** harmless existing-file read in the live backend that guarantees a fresh open with tccd capture; the existing logs already prove denial. **Recommendation: no probe file is needed for Gate A.** A test-owned external directory is needed only for Gate E (`/Volumes/wc2tb/DexDiffusion-OptionA-Test/`) | your "ask before external write" rule |
| X4 | 🔒 Writing the preservation bundles on Big Mac (§8) | write on Big Mac |
| X5 | 🔒 Deploying a modified `engine-worker.py` for Gate E (idle restart, rollback copy) | worker code deploy |
| X6 | DEX//REACH MCP is unauthenticated in this session. Needed only to re-run a DEX//REACH-context probe; current evidence comes from logs | authorize via `/mcp` if a live DEX//REACH probe is wanted |
| X7 | Backend 77247 is degraded: it is denied on media, runs and staging, and the recovery script cannot restore external mode. Restarting it from a denied context would start it in fallback | decide whether to accept the degraded state until Gate G, or to use the owner-run Terminal restart path (Terminal context, user-granted) as a stopgap. **Not recommended without Gate C** |

**Recommended next step:** write the Gate C journal fix and the crash-injection harness in an isolated worktree (code only, test-owned temp directories, no Big Mac writes). Before that: X2 and X4.
