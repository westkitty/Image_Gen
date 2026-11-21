# WC2TB prevention safeguards (source only; NOT deployed)

Branch `codex/wc2tb-prevention-20261121`, cut from the deployed revision
`352e508ceebe950bac6b2115be6782564e7b2370`. Nothing here is installed on Big Mac
or the MacBook. Production still runs 352e508 from
`/Users/bigmac/Image_Gen-wc2tb-20261120`.

## 1. Read-only release doctor

`scripts/wc2tb-release-doctor.py`. You can also run it through the CLI:

```bash
bin/dexdiffusion release-doctor                       # inspect, on Big Mac as bigmac
bin/dexdiffusion release-readiness --expect-revision <full sha> [--target-worktree DIR]
```

- **Output:** one JSON document with verdict `PASS`, `BLOCKED` or `UNVERIFIED`.
- **Exit codes:** 0 PASS, 1 BLOCKED, 3 UNVERIFIED, 2 usage error.
- **Missing evidence:** always `UNVERIFIED`, never `PASS`.
- **What the doctor never does:** install, stop, restart, signal, clean up, remount, repair or write.
- **Read-only guarantee:** a source-level contract test enforces it (test P).

| Check | Evidence used | BLOCKED when |
|---|---|---|
| platform | system/arch/host | (UNVERIFIED off Big Mac arm64) |
| node | pinned path, SHA-256 `266dec4d…`, `--version` v26.13.1 | missing, non-executable, hash or version mismatch |
| dependencies | `node_modules` resolution, required packages, lockfile, dangling links | broken symlink, missing package, no lockfile |
| backend_revision | deployed worktree HEAD and cleanliness, `/api/version` gitHead/cwd | dirty, or running code ≠ worktree |
| enginehost_worker | EngineHost SHA-256 `79faeb90…`; installed worker = deployed blob | either hash differs |
| process_ancestry | one 31337 listener → engine-worker.py → EngineHost → launchd, uid 503 | 0 or more than 1 listener, or wrong lineage |
| restart_authority | supervision mode file, worker `backend-status` pid | two owners, mode not `production`, pid mismatch |
| legacy_agent | `launchctl print-disabled` / `print` | `local.dexdiffusion.server` enabled or loaded |
| wc2tb_access | mount, pinned volume UUID, **backend's own storage selection** | not mounted, wrong volume, backend in fallback |
| disk_reserve | free bytes on publication staging, same device as home | below the one-image reserve (1536 MiB) |
| publication_state | `/api/jobs`, `/api/resources` | release mode: active job, lease or quarantine |
| macbook_ack | `/api/publications/status` | publication disabled; release mode: pending > 0 |
| rollback | v1 package `SOURCE_COMMIT` c7708e4, starter SHA-256 `03bb7a28…`, deps | missing or altered |
| image_validation_python | venv imports Pillow | `PREREQUISITE MISSING: Pillow` |
| release_target (release mode) | `--expect-revision`, target HEAD, clean | not the expected revision, or dirty |

**WC2TB access rule.** A mount is never treated as permission. SSH shells get
EPERM from TCC. Only the EngineHost-descended backend can read WC2TB, so the
doctor accepts only one signal as evidence: that backend's own runner-probe
selection (`storage.mode == external`). Seeing the mount with no evidence from
the backend gives `UNVERIFIED`.

## 2. Safe activation (mandatory preflight)

- **`scripts/request-worker-backend.sh --restart`.** This stops a working backend, so it now runs `scripts/release-gate.sh` first. Usage: `--restart --expect-revision <full sha> [--target-worktree DIR] [--override-unverified "<reason>"]`.
  - If the gate refuses, the script exits 78 and the backend is left running.
  - No worker-socket call is made before the gate passes.
  - `--ensure` (recovery when the backend is down) is unchanged. It never stops a working backend.
- **Gate decisions:**
  - `PASS` → proceed.
  - `BLOCKED` → refuse. **This can never be overridden.** Fix the cause, or use the rollback runbook.
  - `UNVERIFIED` → refuse, unless `--override-unverified` gives a reason of at least 20 characters. The reason is printed and appended to `~/Library/Logs/DexDiffusion/release-gate-overrides.log`.
  - Legitimate override example: a probe timed out (say, diskutil), and the operator checked that fact by hand.
- **Fixtures never authorize.** When `DEX_RELEASE_GATE_FIXTURE_FACTS` is set, the gate evaluates recorded facts and exits 79 (would authorize) or 78. `request-worker-backend.sh` refuses to run at all with that variable set.
- **Restart ownership is unchanged.** The EngineHost worker remains the only restart owner. `bin/dexdiffusion stop|restart` on Big Mac still exits 78 under supervision.
- **No silent bypasses.** No environment variable skips the gate, and test E plus the source contract assert this.

## 3. Regression and negative-control tests

| Letter | Contract | Test |
|---|---|---|
| A | Node missing or hash mismatch → BLOCKED | `scripts/test/test_wc2tb_release_doctor.py` `test_A_*`; gate negative control in `operator-console/tests/wc2tb-prevention.test.js` |
| B | Broken dependency symlink → BLOCKED | `test_B_*` (real temp-dir symlinks) |
| C | WC2TB unreadable by the worker → BLOCKED; mount alone → UNVERIFIED | `test_C_*` |
| D | Two restart owners → BLOCKED | `test_D_*`; gate cannot override it |
| E | Legacy direct stop refused safely | `wc2tb-prevention.test.js` "E: …" |
| F | One-image disk reserve = 1536 MiB | `test_F_G_H_*`; JS/Python parity test; `backend-quiescence.test.js` |
| G | Full 16-image reserve (5376 MiB) kept for large or unknown work | same |
| H | Insufficient disk → BLOCKED | same |
| I | Fallback with explicit MacBook URL → zero contact | `fallback-publication-runtime.test.js` (loopback canary records no request) |
| J | Receipts unchanged | same (outbox records equal before/after) |
| K | Fallback never deletes canonical bytes | same (bytes and SHA-256 preserved) |
| L | External publication still works | same, external-mode test |
| M | Missing Pillow → clear prerequisite error | `test_M_*`, `scripts/check-test-prerequisites.py` |
| N | Unsupported installer `status` argument cannot reinstall | "N: …" (installer now parses arguments before any lookup) |
| O | Unsupported platform → UNVERIFIED | `test_O_*`, "O: …" |
| P | Test processes terminate without touching production | "P: …"; `test_P_doctor_source_is_read_only` |
| DD-04 | Fixed: test no longer reads the live Big Mac supervision-mode file | `dock-tunnel-recovery.test.js` uses an isolated HOME |

**Negative control.** Corrupting any single field of the passing fixture
prevents PASS (`test_negative_control_broken_fixture_fails`), and the gate
refuses a broken fixture (exit 78).

## 4. CI

`.github/workflows/wc2tb-prevention.yml` runs on Ubuntu and macOS. It covers:

- syntax checks;
- the prerequisite check;
- doctor fixtures;
- disk boundaries;
- gate negative controls;
- the ownership contract;
- publication isolation, on macOS only.

**What CI cannot prove:**

- the live Node and EngineHost hashes;
- TCC attribution;
- whether WC2TB is readable by the worker;
- launchd state;
- process ancestry;
- the real disk margin;
- MacBook reachability and acknowledgments;
- that production runs any given revision.

Those are covered only by the hardware-bound, read-only local command on Big Mac:
`bin/dexdiffusion release-doctor` (or `release-readiness`). A CI pass is source
evidence, never deployment evidence.

**Branch protection.** Inspected read-only on 2026-11-21. `main` is not protected
(HTTP 404 "Branch not protected") and the repository has no rulesets. No account
or repository settings were changed. Recommended for the owner to decide: protect
`main`, and require this workflow on pull requests.
