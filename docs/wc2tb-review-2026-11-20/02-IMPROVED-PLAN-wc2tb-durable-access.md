# DexDiffusion: Durable wc2tb Access — Improved Plan, rev 3 (2026-11-20)

> **Rev 3 changes** (after the owner's second review and the Gate A/C read-only results in `03-GATE-A-C-REPORT.md`):
> - **Order:** Gate C moves **before** Gate B.
> - **Gate C journal:** a fixed internal path, independent of `DEX_DATA_ROOT`.
> - **Gate E:** a dedicated test launcher; the production guard is unchanged; no `DEX_TEST_ISOLATION`.
> - **Request channel:** a defined cross-machine restart-request path.
> - **Login vs boot:** login recovery and reboot-with-auto-login are proven separately, with no pre-login claim.
> - **TCC logs:** a missing tccd line is never proof.
> - **Gate A:** done except the items needing approval; no probe file is required.

**Replaces:** rev 1 of this file and, as the operative plan, `DEXDIFFUSION_WC2TB_PLAN2_FULL_HANDOFF_2026-11-20.md`. The dossier's constraint tables (§3.1) and worker-broker security invariants (§8.6) still apply where cited.
**Companions:** `01-CRITIQUE-plan2-handoff.md` (evidence E1–E12, plus errata in §6); the owner's rev-1 review (findings R1–R9 below).
**Project:** `westkitty/Image_Gen`. Big Mac `bigmac@bigmac` (`/Users/bigmac/Image_Gen`), MacBook `andrew` (`~/Image_Gen`). Both at `main 39534f2`.
**Authority:** this document authorizes nothing. 🔒 means owner approval in chat for that specific step. "Read-only" means no writes on either Mac except evidence files in this folder.

---

## 0. Summary

The leading hypothesis (**H0, not yet confirmed for every context**) is that wc2tb denials come from TCC Removable Volumes **attribution**. The backend and DEX//REACH run from deleted ad-hoc Homebrew `node` builds, and the SSH context is unattributable. The one stable identity, EngineHost.app, keeps access.

Two defects matter as much as access:

- **(1) Image loss after ACK.** Worker ACK deletes the worker's copy *before* local publication, and the transfer staging is deleted on any error.
- **(2) The backend is an unsupervised orphan.** Its recovery script probes from a context that is now denied.

The plan proves the cause, proves the worker, closes the publication window, then makes **Option A** (backend supervised under EngineHost) **earn** its place through a production-representative test before any cutover. A storage broker is the fallback, not the first build.

**Locks (unchanged):** no SMB, Tailscale, network, mount/APFS, TCC, or model-location changes. Never rebuild, re-sign, move, or rename EngineHost. Models and LoRAs stay on wc2tb; the existing internal exceptions (§1.4) stay where they are and are documented. Original dirty checkouts and pre-existing isolated worktrees are preserved (§1.5).

---

## 1. Facts this plan rests on

### 1.1 Verified (read-only, 2026-11-20; confirmed independently by the owner's review)

| # | Fact | Source |
|---|---|---|
| F1 | Backend PID 77247 and DEX//REACH PID 77284 have PPID 1 and run from Cellar `node` paths that no longer exist | E1, E3–E5 |
| F2 | `local.dexdiffusion.server` is not loaded but is enabled, so it loads at next login. `local.dexdiffusion.engine-worker` (EngineHost) is loaded, KeepAlive | E2, E10 |
| F3 | Homebrew `node` and EngineHost are both ad-hoc signed | E6 |
| F4 | SSH (Tailscale SSH, parent `tailscaled be-child`) read of wc2tb gets TCC Removable Volumes denial: "failed to construct a process for the responsible audit token" | E7 |
| F5 | The state/runs ACL is an inherited allow entry | E8 |
| F6 | Internal disk: **12 GiB free (95% used)** | df, 11:3x local |

### 1.2 Unproven (each has a gate below)

- **U1.** Whether the DEX//REACH shell denial has the **same** cause as F4 (stale executable vs. changed signing identity vs. missing grant vs. unresolvable responsible chain). These are four different failure modes and must not be merged.
- **U2.** Whether backend 77247 can do **fresh** wc2tb reads. The HTTP 200 in E9 may come from cache.
- **U3.** Whether the chain `EngineHost → python worker → bash → node backend → workflow child` preserves removable-volume access for every descendant, and keeps it across worker restart, reparenting, login, Homebrew replacement, and backend crash.
- **U4.** Whether a real wc2tb-model generation through the worker succeeds today.

### 1.3 The publication crash window (source-verified, not yet demonstrated)

The handoff in `operator-console/bin/local-engine-generate.js`:

1. lines 162–176: download each PNG over IPC, verify SHA-256, and write it to `mkdtemp(os.tmpdir()/dex-engine-transfer-*)`;
2. line 178: `publishAfterAcknowledgment` calls `owned('ack')` **first**. The worker (`engine-worker.py:404-410`) **unlinks `output*.png`**, then sets `acknowledged`;
3. then `store.publishFiles(...)`, whose `onPublished` creates the MacBook publication outbox entry;
4. `finally` (line 198) **`rmSync(stagingDir)` unconditionally**.

Consequences:

- **(a) Crash** between step 2 and step 3: the worker copy is gone, and the only copy is an orphan `dex-engine-transfer-*` directory that nothing reconciles. No code references that prefix (grep).
- **(b) Not only crashes.** If `publishFiles` **throws** (for example disk-full at 12 GiB free, or a staging-check failure), the `finally` block deletes the staging copy. That is a deterministic loss path with no crash needed.
- **(c) `TMPDIR`.** `os.tmpdir()` for this child may resolve to `scratchRoot`. `childStorageEnvironment` sets `TMPDIR=<dataRoot>/scratch` when unset, which is wc2tb in external mode. **Verify** which TMPDIR the bridge child actually gets.
- **Constraint on any fix:** the existing order intentionally avoids a network await after publication, and the worker also expires unacknowledged outputs after 3600 s (`expire_results`). Simply reversing the order is not acceptable without a crash-safe, idempotent contract (§3, Gate C).

### 1.4 Fallback mode is narrower than "bridge off" (source-verified)

| Behaviour in `internal-fallback` | Where |
|---|---|
| Different data root and job state (`/Users/bigmac/DexDiffusion-InternalFallback`) | `run-backend-service.sh` |
| `POST /api/actions/*` blocked except `/generate-controlled` | `server.js:94` |
| Only targets `flux2-klein-4b`, `sdxl-photonic`, `flux-fp8` exposed. These are **internal-SSD model exceptions** (`~/Library/Caches/DexDiffusion/mflux/…`, `~/sdcpp-staging/models/…`) | `server.js:82`, `capabilities.js:139-141` |
| LoRA, VAE, ControlNet rejected with 409 | `server.js:3692` |
| Chat disabled; `DEX_MACBOOK_IMAGES_URL` unset | runner |
| **Publication still enabled:** `crossHostPublicationEnabled` = data root set + host `bigmac`, so the outbox lives in **fallback** state and the MacBook client defaults to `127.0.0.1:31338` | `server.js:115-123` |
| Bridge forced off (line 61); bridge enablement also reads a wc2tb-resident JSON file | runner, `local-engine-routing.js` |
| Existing tests assert `DEX_LOCAL_ENGINE_BRIDGE=0` | `backend-service-reliability.test.js:128`, `internal-fallback.test.js:50` |

So fallback *can* generate, but only with three internal models and no LoRAs. That correction is recorded in the critique errata.

### 1.5 Work that must be preserved (Big Mac, read-only check)

| Tree | Base | Uncommitted content |
|---|---|---|
| `/Users/bigmac/Image_Gen` (original) | `39534f2` | `M operator-console/public/dexdiffusion/edit-ui.js` — **protected** |
| `/Users/bigmac/DEX-REACH` (original) | `55f1d9a` | `M src/gateway/mcp.ts, src/node/native.ts, src/shared/durable-execution.ts, src/shared/operations.ts`; `?? src/shared/dex-relay-task-envelope.ts, tests/dex-relay-task-envelope.test.ts, tests/diagnostic-inspect.test.ts` — **protected** |
| `/Users/bigmac/Image_Gen-dexdiffusion-20261120` (detached) | `39534f2` (= current main) | `M local-engine-routing.js, tests/local-engine-bridge.test.js`; `?? bin/probe-local-engine.js` |
| `/Users/bigmac/DEX-REACH-dexdiffusion-20261120` (detached) | `555befc` | `M scripts/install-macos.ts, scripts/install-node.ts`; `?? scripts/lib/node-service.ts, tests/dual-node-service.test.ts` |

**No rebase.** Before any reuse:

- export `git diff` plus the untracked files of each isolated worktree into a dated patch bundle with SHA-256, kept outside both trees;
- re-check that each base is still current;
- reconcile only after a source-preservation check (patch bundle re-applies cleanly to a scratch worktree).

---

## 2. Authority model: one recovery relationship

| Actor | Observe | Request restart | Execute restart | Veto |
|---|---|---|---|---|
| Owner | ✓ | ✓ | ✓ (🔒 steps) | ✓ always |
| **Today:** `recover-backend-authorized.sh` | ✓ | — | ✓ (only executor of backend restarts) | own guards (lease, jobs, children) |
| **Today:** MacBook `local.dexdiffusion.recovery` controller | ✓ | ✓ (tunnel/Studio scope; asks the executor for backend) | tunnel only | — |
| **Option A:** worker supervisor | ✓ | — | ✓ **sole executor** for its child backend | joint-idle check (§4) fails closed |
| **Option A:** MacBook controller | ✓ | ✓ via the closed worker IPC op `backend_request` over the **existing** Tailscale SSH (`ssh westcat … engine-worker.py client`); synchronous reply; never signals processes on Big Mac | — | — |
| **Option A:** `recover-backend-authorized.sh` | ✓ (`--status`) | ✓ (same op, `--request`) | **disabled** for the backend | — |
| **Option A:** launchd `local.dexdiffusion.server` | — | — | **booted out and disabled** (🔒), plist kept for rollback | — |

**Request channel** (full spec in report §7):

- no shared filesystem and no new network configuration;
- fields are enums only (`action`, `reason`, `requested_by`), plus a `request_id` and nonce;
- at most one pending request; at least 5 minutes between executed restarts; requests expire after 10 minutes; replays are rejected;
- every request is journaled to `~/.dexdiffusion-engine/backend-requests.jsonl`;
- authentication is the SSH key, the Tailscale identity and the Unix user `bigmac`. The op can only *request*. No HTTP route may proxy it.

**Invariant:** exactly one executor of backend restarts at any time. Every restart decision is journaled with who requested, who executed, and the evidence. A request that is not answered within its bound becomes `RECOVERY_BLOCKED`; it is never retried by a second actor.

---

## 3. Gates (in order; each stops on failure)

Proof vocabulary: `SOURCE_PASS`, `ISOLATED_PASS`, `LIVE_PASS`, `FAIL`, `BLOCKED`, `NOT_RUN`, `UNKNOWN` (dossier §11.1). One status never implies another. Each gate has a time-box; two overruns mean stop and report.

### Gate A — Prove the cause; keep the live backend (read-only + one trivial 🔒; ≤ 2 h)

1. **Baseline**, saved to `baseline-<ts>.md` in this folder:
   - identity, HEAD, and dirty files on both Macs;
   - the worktree inventory and patch bundles from §1.5;
   - process trees with `lsof` txt paths and on-disk status;
   - `launchctl print` / `print-disabled` for all `local.dexdiffusion.*` and `com.stinkyweasel.dex-reach.*` services;
   - `codesign -dv` (cdhash) of EngineHost and of `/opt/homebrew/bin/node` and `python3`;
   - Cellar contents and sizes for `node`, `python@3.15`, `coreutils`;
   - free disk space;
   - worker `health` JSON;
   - model registry ID → resolved path → wc2tb or internal exception.
2. **No probe file** (rev 3). Use retained tccd and backend logs, plus harmless existing reads such as worker `health`. Ask before any test-owned external write.
3. For each context, gather bounded, context-specific evidence and capture `log show --last 30s --predicate 'process == "tccd"' --info --debug` straight after. Contexts:
   - (a) DEX//REACH shell;
   - (b) Tailscale SSH;
   - (c) worker `health`;
   - (d) the **live backend doing a fresh read**: a historical voice file via `/api/media/:id`, with the returned bytes' SHA-256 compared against the Terminal-computed hash. An HTTP 200 alone is not proof.
   - Context (e), a controlled launchd-launched process, needs 🔒 for a throwaway test LaunchAgent label and moves to Gate E.
4. Classify each denial with a separate column for each of: stale executable, changed signing identity, missing/denied grant (`auth_value=0` with a resolved chain), unresolvable responsible chain.
5. Check for hardware/APFS faults: bounded `log show` for APFS/USB errors over 7 days.

**Rule:** a **missing** tccd entry proves nothing, because decisions are cached per process. Where logging is missing, incomplete or redacted, the mechanism is `UNKNOWN`.

**Exit:** a filled attribution table. H0 is `CONFIRMED` only for contexts whose tccd lines show it; everything else stays `UNKNOWN`. Do not restart 77247.

**Status (rev 3):** done except context (e) and the inference child. Results:

- **backend:** stale executable leading to attribution failure, `LIVE`;
- **DEX//REACH children:** the same mechanism, from logs;
- **Tailscale SSH:** an attribution failure whose cause is **not** a deleted binary (`UNKNOWN`);
- **worker:** `ALLOWED` by user-consent grant via the EngineHost app, `LIVE`.

See report §1.

### Gate B — Prove the native worker end to end (🔒 real compute; ≤ 1 h) — **runs after Gate C**

**Rev 3:** do **not** run Gate B through today's backend. It has live `EPERM` on `runs` and `state/staging`, so it would hit the loss paths B3/B5. Run it through the Gate-C-fixed client: either the Gate E test launcher, or a harness that keeps the bytes in the internal journal.

1. One small txt2img (for example 512², minimum steps) on a model whose resolved path is on **wc2tb** (not one of the §1.4 exceptions), through the existing worker, with an idle lease.
2. Capture the whole sequence: `generate` → `status` polls → `result` (SHA-256) → transfer staging path → `ack` → worker output unlinked → `publishFiles` → outbox entry → MacBook pull → SHA-256 ACK in `/Users/andrew/images_made`.
3. Capture tccd lines for the inference child's model read.

**Exit:** `LIVE_PASS` only when steps 1–3 all pass. If not, STOP and follow the runbook (§7). No architecture work rescues an incapable worker.

### Gate C — Close the publication crash window (isolated code + test-owned fixtures; ≤ 1 day)

1. **Audit first.** Look for any existing durable record or reconciliation that already closes §1.3 (the outbox, recovery journal, run manifests, worker receipts). Record each one as closes the window / does not close it, with evidence.
2. **Crash-injection harness** (test-owned worker root and image store, fake MacBook endpoint). Kill or throw at each boundary:
   - after `result`, before `ack`;
   - after `ack`, before `publishFiles`;
   - inside `publishFiles` (before and after the file write, before and after the outbox create);
   - after publish, before the manifest write;
   - plus a `publishFiles` *throw* (not a crash) with no crash.
   Record the outcome at each point: image lost / duplicated / falsely complete / recoverable.
3. **Fix contract** (design candidate; tests decide):
   - downloaded, checksum-verified bytes go to a **durable internal transfer journal** at the fixed path `/Users/bigmac/Library/Application Support/DexDiffusion/engine-transfer/`. It does **not** follow `DEX_DATA_ROOT`, `DEX_STATE_DIR` or `TMPDIR`, and has a test-isolation override only;
   - at startup, check every component (`lstat`, no symlinks), the realpath, that `st_dev` matches `/Users/bigmac`, owner, and modes `0700`/`0600`; any failure refuses bridge admission;
   - atomic write via `O_EXCL` tmp → fsync → rename → fsync dir;
   - full contract in report §4;
   - the intent record `{run_id, index, sha256, bytes, stage}` is fsynced **before** `ack`;
   - `ack` stays before publication, which keeps the "no network await after publish" property;
   - `publishFiles` reads from the journal and is idempotent by `(run_id, index, sha256)`;
   - journal entries are removed only after a confirmed publish; **never** in `finally` on error;
   - startup reconciliation re-publishes or quarantines journal entries, and never marks anything complete without a SHA-256 match;
   - a disk-reserve guard refuses new jobs (honest error) below **max(4 GiB, 3 × expected bytes × batch)**, with a journal cap of 2 GiB or 200 entries, instead of failing mid-publication;
   - `reconcileInterruptedPublications` must report `EPERM` on `runs` as `BLOCKED`, not as "no artifact";
   - the journal supplies the evidence for COMPLETE when the manifest is missing (boundary B7);
   - `/api/publication-recovery` must not report `CLEAR` while jobs are unresolved;
   - test **ordinary throws** (`EPERM`, `ENOSPC`, invalid index, owner mismatch) as well as SIGKILL crashes, at every boundary B1–B8 (report §2, §5).
4. Re-run the harness. Every boundary must end as *recoverable* or *never acknowledged*. None may end as *lost* or *falsely complete*.

**Exit:** `ISOLATED_PASS` for every injection point. This gate blocks Gates E–G: **an always-on backend that can lose images is not a fix.**

### Gate D — Fallback bootstrap repair (isolated; ≤ 4 h)

Start from the patch bundle of `/Users/bigmac/Image_Gen-dexdiffusion-20261120`. Its base equals current main, so no rebase is needed.

- **D-min (default):** bridge *enablement* no longer reads any wc2tb-resident file. It reads an internal owner-only config (`~/Library/Application Support/DexDiffusion/local-engine-bridge.json`, mode 0600, no symlink, internal device); `DEX_LOCAL_ENGINE_BRIDGE=0` remains a hard off. Fallback behaviour otherwise stays exactly as in §1.4 (three internal targets, bridge off). This removes the bootstrap circularity without creating a second job ledger.
- **D-wide (only on owner request):** allow wc2tb models through the bridge while in fallback. Additional requirements:
  - jobs carry `storage_epoch=internal-fallback`;
  - history shows "external history unavailable", never an empty ledger;
  - run-ID collision checks against worker receipts;
  - publication proven through the actual route (`crossHostPublicationEnabled`, `:31338`) with SHA-256 ACK;
  - reconciliation of the fallback outbox when external mode returns.
- **Both:**
  - honest capability fields (`worker_reachable`, `models_available (worker view)`, `backend_storage_readable`, `generation_verified_at`);
  - update the existing `DEX_LOCAL_ENGINE_BRIDGE=0` assertions in `backend-service-reliability.test.js` and `internal-fallback.test.js` to match the chosen variant;
  - a full-suite run with `/usr/bin` first on PATH (known environmental failures listed separately);
  - route-restriction, target-list, and publication-route tests unchanged or deliberately updated.

**Exit:** `SOURCE_PASS` + `ISOLATED_PASS`, and a diff-scope audit showing only the intended files changed.

### Gate E — Option A must earn it (🔒 worker restart in a quiet window; no production cutover; ≤ 1 day)

**Design (built in isolation first):**

- **Opt-in** via `~/.dexdiffusion-engine/supervise-backend.json` (0600). No IPC operation can start or stop it.
- The supervisor spawns exactly one fixed command, in its **own process group** (`start_new_session`). It takes a single-instance `lockf` lock, applies backoff (10 s → 5 min cap), and latches a crash-loop circuit after N failures.
- **Port guard:** before spawning, if `:31337` (or the test port) is held by *any* process, do not spawn. Report `PORT_HELD` with the owner PID. Never kill a process the supervisor did not start.
- **Worker shutdown:** SIGTERM the backend process group, wait (bounded), then verify the port is free and no group members remain. If they don't stop, report `ORPHAN_RISK` and keep the worker from silently exiting (log and latch).
- **Joint idle accounting.** The interpreter watcher and every supervisor restart call it "idle" only if **all** of these hold:
  - worker not active;
  - `/api/resources` has no owner and no waiters;
  - `/api/jobs` is empty;
  - the publication outbox has no `PUBLICATION_PENDING` / `PUBLICATION_FAILED_RETRYABLE`;
  - the Gate C transfer journal is empty.
  **Any HTTP error or timeout counts as busy** (fail closed).
- **Backend stale-binary watch:** if the backend's `lsof` txt path disappears or `/opt/homebrew/bin/node` resolves elsewhere, schedule an **idle** restart and report `STALE_BINARY`.
- `health` gains `backend {supervised, pid, pgid, restarts, circuit_open, last_exit, stale_binary}`.

**Production-representative test (live backend untouched):**

1. 🔒 Deploy the new `engine-worker.py` with an instant-rollback copy. Restart the worker only while idle. Verify worker `health` and wc2tb model access immediately; any regression means roll back.
2. The supervisor config points at the **test-only launcher** `scripts/test/run-optionA-probe-backend.sh`. The production `run-backend-service.sh` is **unchanged** and keeps rejecting noncanonical roots, with a regression test. The launcher:
   - runs only with `DEX_TEST_INSTANCE`, refuses ports 31337/31338, and uses port `31347`;
   - uses test data root `/Volumes/wc2tb/DexDiffusion-OptionA-Test/` (🔒 external write) and internal test root `/Users/bigmac/DexDiffusion-OptionA-Test-internal/` (staging, logs, `TMPDIR`, journal override);
   - **does not** use `DEX_TEST_ISOLATION`, because that blocks the generators and workflow scripts under test;
   - pins `DEX_MACBOOK_IMAGES_URL` to a loopback fake at `:31348` and refuses to start if it is unset or `:31338`; a fake puller drains the test outbox;
   - runs code from a dedicated read-only worktree at the candidate commit (report §6).
3. Capture tccd attribution for:
   - the test `node` doing a fresh read of a probe file;
   - one representative workflow child (for example `sdcpp-workflow/bin/sdcpp-read-run-metadata.sh` on a test-owned run);
   - one real inference through the test backend's bridge.
4. Lifecycle matrix. Each case must end with the port free and a single instance running:

   | Case | Required result |
   |---|---|
   | Kill test backend | Supervisor restart within bound |
   | Crash loop | Circuit latches |
   | Worker restart while test backend has an active job | Restart deferred (joint idle) |
   | Worker restart when idle | Backend group stopped, one new instance |
   | Simulated Homebrew replacement (supervisor uses a **test-owned copy** of `node`, then rename/replace it) | `STALE_BINARY`, idle restart, fresh read attribution captured again |
   | 🔒 Logout/login | Supervisor brings the test backend back with access |
   | 🔒 Reboot (Gate G window) | Auto-login (`autoLoginUser=bigmac`, FileVault off) → EngineHost agent → supervisor → backend with access. **No claim before login.** If auto-login is ever disabled, boot recovery is `BLOCKED` until someone logs in |

5. **Security sign-off (owner):** Option A gives the *whole* backend, its ~30 workflow scripts and any subprocess removable-volume access to all of wc2tb, **including write access to model folders**. This replaces the worker's narrow closed protocol. This is the same access the external-mode design already assumes, but it is now durable and has to be approved deliberately. Before sign-off, list the HTTP routes and child commands that accept path-like input, and confirm the Tailscale user allow-list (`DEX_AUTHORIZED_TAILSCALE_USERS`).

**Exit:** `LIVE_PASS` for items 1, 3 and 4 (login is required; reboot is deferred to Gate G), plus the owner's security sign-off. Otherwise Option A is `FAIL` and the test supervisor config is removed.

### Gate F — Choose the smallest architecture that passed

- Gates B, C and E pass → **Option A** (plus the Gate C fix and the Gate D-min fix).
- Gate E fails → **narrow worker mediation:**
  - backend stays in its own context;
  - generation goes only through the bridge;
  - wc2tb-dependent routes report `STORAGE_UNREADABLE_IN_BACKEND` honestly;
  - worker-mediated read operations only for routes the owner names, under dossier §8.6 invariants (opaque IDs, realpath containment, bounded streaming, no paths from HTTP);
  - an internal control ledger only for a demonstrated durability failure (dossier §8.4 guards).
- Option C (new signed host app plus one owner consent) needs an explicit owner choice, because it crosses the TCC lock.

### Gate G — 🔒 Controlled installation and acceptance (one window; ≤ 3 h, plus a separate reboot window)

**Preconditions:**
- Gates A–F met;
- no active lease, job, pending publication, or transfer-journal entry;
- release hash frozen;
- rollback script `--plan` reviewed;
- 77247's state recorded;
- Big Mac's other hosted services noted for the reboot window.

**Install:**
- versioned install via script with `--plan`, `--apply` and `--rollback`;
- for Option A: stop 77247 gracefully only when idle, with its own guards; boot out and disable the server LaunchAgent; write the production supervisor config; verify a single instance on `:31337`;
- switch `recover-backend-authorized.sh` to request mode and point its storage probe at worker `health`.

**Acceptance:** run §5. Any FAIL → `--rollback`, then report.

---

## 4. Homebrew risk containment (supporting measure, not the fix)

- **Do not** set a global `HOMEBREW_NO_INSTALL_CLEANUP` (internal disk is at 12 GiB free).
- 🔒 Evaluate **`HOMEBREW_NO_CLEANUP_FORMULAE=node,python@3.15`** (selective retention; see Homebrew FAQ) for the `bigmac` user and for any agent that runs `brew`. Measure the per-version keg size first, and add a bounded manual prune step to the maintenance window.
- Evaluate `brew pin` separately: pinned formulae can block upgrades of their dependents. Default: **no pin**.
- **Controlled upgrade window:** `brew upgrade` on Big Mac only inside a maintenance step, followed by `bin/dexdiffusion status` `STALE_BINARY` check, an idle restart by the authoritative executor (§2), and a tccd re-check.
- Retention keeps running processes attributable. It does **not** authorize a replacement executable. Under Option A, Gate E's replacement test shows whether that matters; under narrow mediation it does not matter for wc2tb.
- Add a `STALE_BINARY` read-only check (backend, DEX//REACH node, worker, EngineHost) to `bin/dexdiffusion status` and to the MacBook controller's observation output.
- Leave `tailscale` untouched (Tailscale lock).

---

## 5. Acceptance matrix (storage closure)

| # | Scenario | Proof |
|---|---|---|
| A1 | Model/LoRA availability shown from the worker's view; no green from mount alone | LIVE |
| A2 | Real txt2img, wc2tb model, run ID + SHA-256 | LIVE |
| A3 | Published to `/Users/andrew/images_made`, SHA-256 ACK matches | LIVE |
| A4 | Compatible LoRA generation, or honest incompatibility | LIVE |
| A5 | Cancel: no stuck lease, no partial "complete" | LIVE |
| A6 | Existing voice + music item streamed intact (range requests if used) | LIVE |
| A7 | World/3D project list + one asset opens | LIVE |
| A8 | Gate C injection points: none lost, none falsely complete | ISOLATED, plus LIVE for one safe point |
| A9 | Disk-reserve guard refuses new jobs below the floor with an honest error | ISOLATED |
| A10 | Backend killed (idle) → single authoritative restart, external mode, within bound | LIVE |
| A11 | Worker restart while backend busy → deferred; when idle → no orphan, one instance | LIVE |
| A12 | Fallback (chosen D variant): state selection, route restrictions, targets, history separation, publication route as specified | ISOLATED (+ LIVE if safely inducible) |
| A13 | Repeated denial → circuit latches, no loop, no competing executors | ISOLATED |
| A14 | Homebrew `node` replacement (test-owned copy) → `STALE_BINARY`, idle restart, access re-proven | LIVE (Gate E) |
| A15a | 🔒 Manual logout/login → backend up with access, A2 + A3 repeated | LIVE — `NOT_RUN` until witnessed |
| A15b | 🔒 Reboot → auto-login → backend up with access, A2 + A3 repeated. No pre-login availability claimed | LIVE — `NOT_RUN` until witnessed |
| A16 | Rollback restores the prior service layout; no user data rewritten | LIVE `--plan` + ISOLATED apply |
| A17 | No SMB/Tailscale/network/mount/TCC/model-location diff; protected dirty files (§1.5) byte-identical | LIVE audit |

`STORAGE COMPLETE` = A1–A17 pass, with A15a and A15b witnessed.

---

## 6. Separate contract: DEX//REACH node `dexdiffusion` (required, not part of storage closure)

This stays an explicit project requirement. It is tracked separately so it does not block storage closure, and it is **not** dropped or merged into `bigmac`.

| # | Acceptance item | Proof |
|---|---|---|
| N1 | Node ID exactly `dexdiffusion`, enrolled with **its own** credentials; revocable without affecting `bigmac` | LIVE (🔒 enrollment) |
| N2 | Distinct service label `com.stinkyweasel.dex-reach.node.dexdiffusion`; `bigmac` keeps `com.stinkyweasel.dex-reach.node`; collision protection tested | ISOLATED + LIVE |
| N3 | Upgrading either node never unloads or replaces the other | ISOLATED + LIVE |
| N4 | Shared physical-machine admission: no double-admission of heavy work across the two IDs; lease recovery after either restarts | ISOLATED + LIVE |
| N5 | Protocol compatibility with gateway/MacBook (Big Mac 0.3.2 / MacBook 0.4.0) decided from evidence | LIVE |
| N6 | Neither node needs wc2tb access (DEX//REACH context is denied by design; see Gate A) | LIVE |
| N7 | Source baseline = preserved patch bundle of `/Users/bigmac/DEX-REACH-dexdiffusion-20261120` (base `555befc`); original `/Users/bigmac/DEX-REACH` WIP untouched | audit |

Related, under DEX//REACH authority: the running `bigmac` node 77284 is on a deleted `node` build (F1), so schedule an idle restart there.

---

## 7. Runbook: EngineHost identity lost

1. Do not reset TCC or rebuild anything. Capture tccd lines plus `codesign -dv` and compare the cdhash with the Gate A baseline.
2. Same cdhash, still denied → escalate. Something outside this plan changed (OS update, revoked grant).
3. Changed cdhash → only one **owner-performed** consent for that exact app restores access. Agents never do this. Freeze the binary again afterwards.

---

## 8. Copy-ready brief for the next session

```text
PROJECT: DexDiffusion (westkitty/Image_Gen) — durable wc2tb access, plan rev 2
READ: docs/wc2tb-review-2026-11-20/02-IMPROVED-PLAN-wc2tb-durable-access.md (operative)
      docs/wc2tb-review-2026-11-20/01-CRITIQUE-plan2-handoff.md (evidence + errata)
THIS SESSION: Gate A is done (see 03 report). Next: Gate C journal fix + crash-injection
              harness in an isolated worktree (code only, temp dirs). Ask before every 🔒 item.
LOCKS: no SMB/Tailscale/network/mount/TCC/model-location changes; never rebuild or
       re-sign EngineHost; do not restart backend 77247 or DEX node 77284; do not
       rebase or edit the 20261120 isolated worktrees — export patch bundles first;
       protected dirty files: Image_Gen edit-ui.js, DEX-REACH src/* WIP.
STOP IF: worker cannot generate from a wc2tb model (Gate B); tccd shows I/O faults;
         identity checks fail; any lock would be crossed.
REPORT: attribution table (4 failure classes kept separate), baseline file, Gate C
        boundary outcomes, proof class per item, 🔒 approvals needed next.
```
