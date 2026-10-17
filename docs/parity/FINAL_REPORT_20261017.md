# DexDiffusion A1111 parity — final report (2026-10-17)

**VERDICT: PARTIAL for full A1111 parity; COMPLETE for the bounded application-level cancellation, hires, and atomic-publication closure.** The release implements and verifies scoped application behavior. Engine features that need unapproved weights or engine changes remain gated; this report does not claim complete A1111 parity.

- Repository: `/Users/andrew/Image_Gen` (GitHub `westkitty/Image_Gen`). Starting parity commit: `ecf8e9fcffbaf446df8f44f73d0384538685cc6`; the final published commit is recorded in the current closure receipt in `OPERATIONAL_STATE.md` and the Git history.
- Branch, remote SHA, working-tree, publication and CI state are time-sensitive; use the current closure receipt and GitHub checks rather than the historical runtime identifiers below.

## Completed application-level scope

- **OP-7 cancellation:** run-scoped worker identity, verified remote stop, compute lease/quarantine handling, restart reconciliation, and completion/cancellation race behavior are implemented and covered by tests. Browser interrupt suite passed 2/2.
- **OP-4A pixel-space hires:** independent second-pass options, cover-and-center-crop resize geometry, base/refined canonical artifacts and lineage, unsupported-setting rejection, and mutual exclusion with in-engine hires are implemented. Hires browser suite passed 5/5.
- **Atomic publication:** publication journals, exact job/run ownership, digest validation, durable idempotent receipts, and restart recovery are implemented. Live publication cases A–C and deterministic fault-injection case D are recorded in `OPERATIONAL_STATE.md`.
- **API/history agreement:** canonical image projection uses the owned run index and receipt; regression coverage verifies that API output and history identify the same canonical artifact.
- **Performance:** matched warm-path measurements are preserved in `docs/parity/perf/`. The latest measured median is 25.73 seconds versus 26.07 seconds previously; this small difference is not presented as a causal speedup. Stage-level attribution remains incomplete.
- **Current automated validation:** `npm run check`, `npm test` (844/844), atomic-publication/cancellation/recovery tests within the full suite, browser interrupt (2/2), browser hires/OP-4A (5/5), shell syntax for changed SDCPP scripts, Node syntax, and whitespace checks are recorded in the closure receipt.

## Full parity status

The schema-v2 ledger `docs/parity/DEXDIFFUSION_A1111_PARITY_LEDGER.json` covers 266 requirements. Its full-parity verdict remains `PARTIAL`; the ledger is the detailed authority for row-level status. Engine work including OP-2, OP-1A, OP-1B, OP-6, OP-5, OP-3 and OP-4B remains subject to each row's evidence and approval status. Do not treat UI controls, unit tests, or a passing application workflow as proof of unsupported engine capabilities.

## Retained limitations

- Nine older interrupted jobs remain unresolved because no exact owned published artifact was found.
- Historical missing image references remain recorded; current integrity and historical-reference counts are distinct.
- Provenance of the older `op4a_ab.py` driver remains unresolved.
- Remaining performance overhead lacks independent stage-level attribution.
- No pre-restart baseline exists for the unrelated `:443` listener; DEX//REACH remains separate and untouched.
- Engine/weight approval gates and all other PARTIAL, PENDING, BLOCKED, or EXCLUDED ledger rows remain as recorded in the ledger.

## Historical evidence

Earlier full release-gate results, inference receipts, privacy checks, and browser artifacts remain in the local operational evidence area. Their original scope and limitations are retained in `docs/parity/EXECUTION_LEDGER.md` and `OPERATIONAL_STATE.md`; they are not silently upgraded to proof for later code revisions.
