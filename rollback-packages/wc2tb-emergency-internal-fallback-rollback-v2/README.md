# wc2tb-emergency-internal-fallback-rollback-v2 (source only; NOT built or installed)

The package the owner-authorized handoff starts. v2 is the v1 fallback
(`c7708e4`, package manifest `3ead15d`) plus the owner drain protocol, so the
EngineHost owner can stop it only after a fresh `<pid> drained` seal, never by
an unsealed signal.

| Item | Value |
|---|---|
| Source commit | `3f0abf5d0bd9c1d3777a9abbf46181ce2e040350` on `rollback/wc2tb-fallback-drain-v2-20261121` (parent `227d8ce`, v1 lineage) |
| Change from v1 | `operator-console/backend-quiescence.js` (verbatim from production `352e508`); `server.js` wires it exactly as the external backend does, with `isFallbackIdle()`; `tests/fallback-drain-protocol.test.js` |
| Behavior without `DEX_BACKEND_CONTROL` | identical to v1 |
| Trusted manifest | `SOURCE-SHA256SUMS`: every first-party file under `operator-console/` except `tests/`, `artifacts/`, `docs/`, `.resurrection/` and `public/dexdiffusion/uploads/` (244 files, including `server.js`, `backend-quiescence.js`, `package.json` and `package-lock.json`) |
| Manifest digest pinned in the supervisor | `de9f5719a59d621596e9e133ec2582c9eeda8f0e86cfe5c792343248cbdf3ba3` |
| Expected install path | `~/Library/Application Support/DexDiffusion/wc2tb-fallback-rollback-v2/` with `SOURCE_COMMIT`, `start-fallback-rollback.sh` (same starter as v1, SHA-256 `03bb7a28…`), `logs/` (mode 0700) and `source/` (a `git archive` of the source commit) |

## Validation (source)

On Big Mac, from a temporary export with the baseline `node_modules` and the
pinned Node v26.13.1:

- `tests/fallback-drain-protocol.test.js`: 2/2 pass. These cover the idle seal for its
  own pid, the 503 fence on drain, reopening when the drain is withdrawn, and an
  in-flight request blocking the drained seal.
- The v1 regressions `tests/internal-fallback.test.js` and
  `tests/fallback-publication-runtime.test.js` pass on the v2 tree (7/7 together with the drain test).

## Not done here

- **Build and install.** The package is built and installed only in a
  separately approved maintenance window (docs/WC2TB_RECOVERY_RUNBOOK.md §I).
  Until then, the release doctor reports `handoff_capability` BLOCKED.
- **Idle predicate scope.** `isFallbackIdle()` does not include the external
  Ollama occupancy probe. That probe gates admission in production, but it
  does not describe work owned by this backend.
