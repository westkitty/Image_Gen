# WC2TB recovery closure record — 2026-11-21

This is the durable record of the final preservation and prevention pass. It
holds facts with evidence pointers only, and no secrets. Raw logs stay on the
machines named below.

## A. GitHub

| Branch | Commit | Purpose |
|---|---|---|
| `codex/wc2tb-recovery-20261120` | `352e508ceebe950bac6b2115be6782564e7b2370` | exact deployed production source (frozen) |
| `rollback/wc2tb-fallback-safe-v1-20261120` | `227d8ce75c0e82291f59608fa6ee9dd2b220c275` | rollback v1: source `c7708e4` plus package plus proven starter (SHA-256 `03bb7a28…`) |
| `codex/wc2tb-prevention-20261121` | see `git log` (child of `352e508`) | prevention safeguards, source only, not deployed |

Nothing was merged into `main`, and no force-push was used. `main` remains `39534f2` and has no branch protection.

## B. MacBook controller reconciliation

| File | MacBook SHA-256 | `352e508` blob | Class |
|---|---|---|---|
| `bin/dexdiffusion` | `bb289f46…939b2c` | `bb289f46…939b2c` | IDENTICAL_AND_PUBLISHED |
| `scripts/dexdiffusion-recovery-controller.py` | `86542115…e7eed9` | `86542115…e7eed9` | IDENTICAL_AND_PUBLISHED |
| `operator-console/bin/canonical-publication-worker.js` | `7177db22…7aaa` | `7177db22…7aaa` | IDENTICAL_AND_PUBLISHED |

- These files remain uncommitted modifications in the MacBook `~/Image_Gen` checkout (main `39534f2`). That is deliberate: committing them would advance `main`.
- The pre-cutover baselines are backed up in `~/Library/Application Support/DexDiffusion/cutover-20261121/macbook-pre/` (`MACBOOK-PRE-SHA256SUMS`).

## C. Prevention

See `docs/WC2TB_PREVENTION.md` for:

- the doctor checks;
- the gate rules;
- the A–P test map;
- what CI cannot prove.

See `docs/WC2TB_RECOVERY_RUNBOOK.md` for operations.

Source validation, 2026-11-21. This is source evidence, not deployment evidence.

- **Big Mac** (venv Pillow, pinned Node v26.13.1), worktree `~/Image_Gen-wc2tb-prevention-20261121`:
  - related suite 171/171 pass. DD-04 now passes; it was 170/171 at `352e508`.
  - prevention, contract, publication-isolation and installer files: 45 pass, 1 skip. The skip is test O, which skips on the supported host.
  - doctor unit tests 12/12; prerequisite check OK.
- **MacBook:** doctor unit tests 12/12; CI-equivalent node set 27 pass, 0 fail.
- **Live read-only run:** `release-readiness --expect-revision 352e508…` against production returned PASS on all 15 checks. Disk was 4,790 MiB free, giving batch capacity 13 below the full 16-image reserve.
- **Defects found and fixed in this pass:**
  - the DD-04 test read the live supervision-mode file;
  - `install-backend-service.sh` looked up the `bigmac` account before rejecting an unknown argument.
- **Defect found and documented, not fixed:** the worker's `backend-pause` is rehearsal-only, so a production rollback has no owner-sanctioned way to free port 31337.

## D. Production (read-only at close)

Recorded in `OPERATIONAL_STATE.md` (entry dated 2026-11-21), together with the
final read-only check in the session receipt.
