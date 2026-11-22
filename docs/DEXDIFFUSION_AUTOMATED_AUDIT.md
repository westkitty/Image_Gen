# DexDiffusion portable audit — CI and fault-injection contract

## Purpose

Discover and *verify* failure families faster than repeatedly naming isolated source-code suspicions. Preserve existing production inference, canonical image bytes, WC2TB storage ownership, MacBook publication and remote-worker quarantine. The historical conversational ledger reached BUG-119 on 2026-11-22, but it is **not** a claim that 119 independent runtime failures were reproduced. Historical IDs are kept stable; this automation reports probe IDs and links relevant historic IDs without renumbering them.

## What runs on a pull request to main

Workflow: `.github/workflows/dexdiffusion-audit.yml`.

1. **Strict release gate:** on GitHub-hosted Ubuntu, checks out the PR, installs locked dependencies and Pillow, verifies Chrome, and runs `npm run test:release`. That command checks syntax, all root `*.test.js` files and all browser `*.browser.js` suites serially. A failure **fails the release-gate job**. The existing browser harness uses isolated server state and blocks model, SSH and service mutations. This is portable evidence, **not** proof of live Apple Metal, Tailscale, MacBook publication, Android or WC2TB.
2. **Advisory static scan:** runs `node tests/audit/static-sweep.js` over console and Studio sources. Its JSON report contains pattern matches grouped by family. These are **review candidates**, not automatically confirmed bugs.
3. **Advisory fault matrix:** runs `node tests/audit/fault-matrix.js` against fresh disposable temporary directories using synthetic data. Known contract failures are reported as `CONTRACT_FAIL` and linked to earlier bug IDs; they **do not** falsely register as passes. Until those defects are fixed, the diagnostic execution is advisory so the new audit infrastructure can report the baseline without masking the independent release-gate result. Harness errors and missing reports fail the discovery job.
4. Reports are attached for seven days. Only sanitized machine-readable receipts are uploaded; do not add production logs, private prompts, credentials or user-generated images to CI artifacts.

PR executions cancel superseded runs for the same PR. Manual dispatch is also supported. Documentation-only changes are exempt from the automatic audit to avoid wasting compute. `contents: read` is the only workflow permission; no production, deployment, repository write or credential access is granted.

## Current diagnostic families

- Durable persistence falsely acknowledged: Collections, Recipes, Macros (`PERSIST-*`).
- Invalid/corrupt persisted records replaced by new records: Collections, Recipes, Styles, Macros and generic jobs (`RECOVER-*`).
- Job accepted before its identity is durable (`ADMIT-*`).
- Private prompt text leaking into nested Recipe or Macro settings despite opt-out (`PRIVACY-*`).
- World project still claiming RUNNING after an independent cold load (`RECOVER-006`).

These probes are deliberately **failure-seeking**. A failed test reports an observable contract violation in isolated source behavior, not observed production damage. A passing test proves only that specific fixture at that commit. Never turn one expected failure into 10 new bug numbers: group by root cause and keep affected surfaces in the evidence register.

## Validation ladder

1. **Portable CI**: syntax, root unit tests, browser acceptance, synthetic fault matrix, static candidates. Available on GitHub-hosted runners without Big Mac.
2. **Fault matrix expansion**: add fixed-delay HTTP response, duplicate submission, file retention, cancellation and worker-stop fixtures using existing isolated browser/server helpers. Every new contract gets an original failure proof, then a test that passes after correction. Promote repaired scenarios to the **strict** gate.
3. **Mac-only sandbox**: separate test worktree, verified state roots and process ownership. Do not point tests at live `DEX_STATE_DIR`, canonical storage or operating model services.
4. **Live hardware gate**: explicitly coordinated, read-only-first Big Mac and physical Android checks. Do not infer this from headless Chrome mobile emulation.

## Baseline and known limits

Baseline from source inspection on 2026-11-22: `main` at `dacf667aaefc8222ce4184cd69a37fc06cb1459d`, which differs from production release `774815d26df06d0e42d84187d31d6aed2f51f997` only in documentation. Source evidence does **not** establish that any automation has successfully completed against the new PR yet.

The comprehensive release gate may expose pre-existing Linux/Chrome environmental mismatches; do not reinterpret those as Mac production defects. CI results must distinguish code failure, missing dependency, timeout and infrastructure blocker. Never weaken original release-gate checks simply to obtain a green badge.

## How to run in an isolated checkout

From `operator-console/` after installing dependencies:

```sh
npm run test:release
node tests/audit/static-sweep.js
node tests/audit/fault-matrix.js
```

The fault matrix returns nonzero when known contracts fail; its JSON receipt describes each result. For private custom output paths set `DEX_AUDIT_REPORT` and `DEX_AUDIT_STATIC_REPORT`. All fixtures create and remove their **own** temporary directories; no network or generation request is issued by the matrix itself.

## Exit criteria for claiming broader coverage

- Complete suite receipt PASS on the exact commit.
- Every changed area mapped to a regression or explicit untested boundary.
- Fault probes classified as reproduced, fixed, still-failing, duplicate, suspected, or disproved.
- Live inference/Android claims supported by independent hardware evidence; otherwise unverified.
- No merge, deployment, service restart, large model downloads, cleanup or data migration is implied by a passing CI result.
