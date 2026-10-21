# DexDiffusion V2 Studio — Arena execution ledger

**Session:** Arena Agent Mode, 2026-10-20 (UTC) · **Status of this document:** living execution record, not a release claim.
**Controlling instruction:** [`MASTER_EXECUTION_PROMPT_2026-10-20.md`](MASTER_EXECUTION_PROMPT_2026-10-20.md) (verbatim copy) — sha256 `1279459cdaf31bcaf1aa1aed7994f059de106bad4216a155f2e23f919bdee758`.
**Governing precedence:** this task's user instruction and authorization boundaries > Appendix A blueprint > actual repository > Appendix B (historical diagnostics only).

## 1. Fingerprint and isolation

| Item | Value |
|---|---|
| Repository | `westkitty/Image_Gen` (`origin` = `https://github.com/westkitty/Image_Gen.git`) — verified, exact match |
| Working branch | `arena/f721222f-image-gen` (Arena-provisioned isolated session branch; preferred name `arena/dexdiffusion-v2-studio-20261020` was **not** created to avoid a second branch) |
| Base commit | `4324dec29240fc61fb32ef2ef9db23fad0ced7a1` = `origin/main` at session start (blueprint baseline; **main had not advanced**) |
| Initial worktree state | Clean — no pre-existing dirty files in this clone. The MacBook's four dirty paths (`publication-recovery.js`, `server.js`, `tests/publication-recovery.test.js`, `docs/operations/omni-recovery-20261019.md`) are **not present** here; nothing was assumed about them. |
| Environment | Arena Linux sandbox (`e2b`), Node v22.22.3, npm 10.9.8, Python 3.11.2. **Not** the owner's MacBook; no `/Applications`, no `/Users/andrew`, no Big Mac, no SSH, no Swift toolchain, no Chromium. |
| Dependencies | `npm install` run in `operator-console/` (Express/three/spark + `playwright-core`), plus `jsdom` added as a dev dependency for real-DOM tests. `node_modules/` is git-ignored. |
| Test baseline (with deps installed) | **755 pass / 88 fail / 80 skipped (923)** from a pristine `git archive` copy of the base SHA. All 88 are pre-existing and environment-related (missing `ffmpeg`, Python libraries, macOS paths, live-run fixtures). |

No `git clean`, `git reset --hard`, `git checkout --`, `git add .` or `git add -A` was used at any point.

## 2. What this session changed (scope manifest)

| Area | Files |
|---|---|
| Cancellation truth (G1) | `operator-console/cancellation.js`, `operator-console/server.js`, `operator-console/operational-jobs.js` |
| Cancellation tests | `operator-console/tests/cancellation-truth.test.js` (new) |
| Native dialogs (G2) | `native/macos/Image_Gen/ImageGenApp.swift`, `operator-console/tests/native-wrapper-launch.test.js` |
| Studio shell (G4) | `operator-console/public/dexdiffusion/studio-nav.js` (new), `component.js`, `index.html` |
| Offline robustness | `operator-console/public/dexdiffusion/media-ui.js` |
| Studio shell + cancel tests | `operator-console/tests/studio-shell.test.js` (new), `operator-console/tests/world-tab-navigation.test.js` (updated for the registry row) |
| Test dependency | `operator-console/package.json`, `operator-console/package-lock.json` (`jsdom`, dev-only) |
| Documentation | this ledger, `DEXDIFFUSION.md`, `OPERATIONAL_STATE.md`, `docs/acceptance/DEXDIFFUSION_HUMAN_ACCEPTANCE.md` |

## 3. Ticket ledger (all 55)

Status vocabulary: `NOT_STARTED`, `IN_PROGRESS`, `VERIFIED_SANDBOX`, `BLOCKED_NATIVE`, `BLOCKED_REAL_WORKER`, `BLOCKED_HUMAN`, `BLOCKED_DECISION`, `FAILED`, `NOT_REPRODUCED`.
Evidence levels: **E1** source, **E2** fixture/integration (includes the jsdom real-DOM mounts), **E3** browser click, **E4** native WKWebView, **E5** real worker, **E6** novice. Nothing below claims E3–E6.

### G0 — identify, lock, control inventory

| ID | Objective | Status | Evidence / note |
|---|---|---|---|
| T-001 | Fingerprint machine, executable, worktree | `VERIFIED_SANDBOX` | Repo/branch/SHA/clean tree recorded above. Native app stamp and Dock readback are `BLOCKED_NATIVE`. |
| T-002 | Function and control inventory | `VERIFIED_SANDBOX` | Automated inventory: every `onClick`/`onChange`/`onInput`/`onSubmit`/`onKeyDown` binding in the template is resolved against the live mounted instance, and every screen's enabled buttons are enumerated by the 14-screen matrix. A binding that points at nothing now fails a test. Screen-by-screen *intent* review (does this control do the right thing, not just something) is still incomplete. |
| T-003 | Pre-change novice + scroll recordings | `BLOCKED_HUMAN` | No native app, no browser, no participants in the sandbox. Nothing was fabricated. |
| T-004 | Freeze release boundaries and regression claims | `VERIFIED_SANDBOX` | Baseline suite + invariant list captured before edits (§1, §7). |

### G1 — backend cancellation truth (P0)

| ID | Objective | Status | Evidence |
|---|---|---|---|
| T-101 | No false terminal `CANCELLED` for an unowned running job | `VERIFIED_SANDBOX` | `cancellation.js` refuses `RUNNING`/`TRANSFERRING` without a verified owner; no transition, no lease release. E2: `cancellation-truth.test.js` "unowned durable RUNNING job is refused…". |
| T-102 | `canCancel` from real worker capability | `VERIFIED_SANDBOX` | `describeCancelCapability()` is the single source; `getOperationalJobSnapshot()` and the cancel route both use it; `cancel_supported:false` workers are refused. E2 tests + snapshot/route agreement test. |
| T-103 | Targeted stop, publication race preserved | `VERIFIED_SANDBOX` (fixtures) / `BLOCKED_REAL_WORKER` (live) | Nonce+workdir required for remote; local process exit is awaited before terminalizing; unverified stop keeps job + lease. Real Big Mac stop proof not attempted. |
| T-104 | Backward-compatible response contract | `VERIFIED_SANDBOX` | Structured fields `accepted`/`alreadyTerminal`/`neverStarted`/`terminationVerified`/`cancelState`/`leaseReleased` + `remote_stop`; 409 for unsafe/refusal, 202 for accepted-but-unverified. E2 tests. |

### G2 — native dialogs and visible cancellation

| ID | Objective | Status | Evidence |
|---|---|---|---|
| T-201 | Restore WKWebView JS alert/confirm/prompt | `BLOCKED_NATIVE` (code delivered) | Three delegates + main-thread/sheet guards in `ImageGenApp.swift`; E1 static test. No Swift toolchain and no macOS → never compiled or clicked here. |
| T-202 | Dedicated Cancel bound to job identity | `VERIFIED_SANDBOX` | Wired to the pre-existing `interruptGeneration()` (chosen over a duplicate implementation). E2 real-click tests: one request, job-scoped URL, no duplicate job on a second Generate, unverified stop not shown as success. |
| T-203 | Reconcile jobs after refresh/tab/relaunch | `VERIFIED_SANDBOX` | A restored job id is reconciled before anything is offered: `reconciling` gates Cancel, a running job is adopted (not duplicated), a terminal one is cleared, and an unconfirmable one is dropped with an explanation. `_jobTerminal`/`_jobOk` now normalize case — the durable store's `RUNNING` used to look terminal, which adopted live jobs as failures. E2: 4 jsdom reload cases. |

### G3 — canonical asset handoffs

| ID | Objective | Status | Evidence |
|---|---|---|---|
| T-301 | One source-artifact resolver + typed result | `VERIFIED_SANDBOX` | `public/dexdiffusion/source-asset.js`: canonical-id validation, typed failures (`no-source`/`not-canonical`/`staged`/`wrong-kind`/`not-image`), choice lists, lineage. `imageStore` remains the server authority. E2: 14 tests. |
| T-302 | Stable, recoverable Edit source | `VERIFIED_SANDBOX` (partial) | `openImageInEdit` now refuses a malformed id instead of normalizing it into a different asset, while keeping the `staged:` upload path. Existing draft/race protection untouched and still green. |
| T-303 | Exact Enhance source and result identity | `VERIFIED_SANDBOX` (partial) | `sendToEnhance` and `_resolveSource` validate the canonical/plain image name before any API call. Result identity (receipt/lineage display) is unchanged and not re-verified. |
| T-304 | Strict World/3D source gates | `VERIFIED_SANDBOX` | The `runs[0].imageFile` fallback is deleted from both `startAsset3d` and `startWorld`; pickers start empty with an explicit "Choose a source image…", and each screen states the rule. E2 tests plus a source assertion that the fallback cannot return. |
| T-305 | Preserve cross-module selection/lineage | `VERIFIED_SANDBOX` (partial) | Choosing a World/3D source publishes it via `setActiveAssetSelection`, so the next module resolves the same id; explicit pick > selection > explicit "newest" only. Library lineage read is guarded. A full round-trip through all four modules on real data is not run. |

### G4 — V2 Studio as sole normal shell

| ID | Objective | Status | Evidence |
|---|---|---|---|
| T-401 | Clean Studio launch + safe migration | `VERIFIED_SANDBOX` | `studio-nav.js` migration is idempotent, records `dex_legacy_version`, preserves model/preset/prompt-saving keys. Fresh profile, `dex_version=4` profile and `workstation` session screen all land on Create (E2 real mount). |
| T-402 | Exactly one 14-chip top navigation | `VERIFIED_SANDBOX` | Registry-driven row, exact order Create…System, tints per group, `aria-current`, `title` per chip, one row `overflow-x:auto` with labelled back/forward affordances. E2: 14 chips rendered and each one clicked to its own screen. |
| T-403 | Replace front-page clutter with one canvas + inspector | `IN_PROGRESS` | Honest partial only: Create now opens with a `Create` header and one sentence of intent, and the dead shell buttons around it are gone. The stacked legacy panels were **not** restructured into canvas + inspector. |
| T-404 | Retire V4 as default without destroying modules | `VERIFIED_SANDBOX` | Default is Studio; the version picker is `data-dev-only` and hidden unless developer mode; V1/V3/V4 modules and tests remain. |

### G5 — simple *and* complete

| ID | Objective | Status | Evidence |
|---|---|---|---|
| T-501 | Basic/Advanced disclosure with preserved semantics | `NOT_STARTED` | — |
| T-502 | Consistent action priority/result transitions | `NOT_STARTED` | — |
| T-503 | One Job Center; remove duplicate presentations | `NOT_STARTED` | Existing Job Center untouched. |
| T-504 | Eliminate enabled no-ops across the Studio | `IN_PROGRESS` | Removed the four known inert Models actions (`Check stage`, `SDXL smoke`, `Flux smoke`, `Inventory`) and `Discover`; removed five further inert shell buttons (`Save style ↗`, `Latest sweep`, Library card `Open`/`→ Create`/`JSON`). Three automated guards now exist: no `<button>` in the V2 markup without `onClick`/`disabled`; every template binding resolves to a real function; every enabled button on all 14 screens has an accessible name. **Not proven:** that each remaining control does something *useful* — that needs the click-level sweep on a real browser (E3). |
| T-505 | Model selection cannot silently surprise | `NOT_STARTED` | Existing `model-startup-activation` tests still pass; no new work. |
| T-506 | Recoverable, understandable states | `VERIFIED_SANDBOX` (core) | Three real crash classes fixed and tested: unguarded worker/resource payloads, a partial `/api/system-info` (whole shell blanked), and a malformed `/api/library/images` (stored `undefined` items). `render()` now keeps the last good view and records the error instead of leaving an unrenderable shell. Screen-by-screen empty states are not all reviewed. |
| T-507 | Micro-interactions without visual noise | `NOT_STARTED` | — |

### G6 — per-module capability passes

| ID | Module | Status | Note |
|---|---|---|---|
| T-601 | Create | `IN_PROGRESS` | Primary action + Cancel verified in DOM; legacy layout and Advanced disclosure untouched. |
| T-602 | Batch | `NOT_STARTED` | Route reachable, contents unchanged. |
| T-603 | Swap | `IN_PROGRESS` | Destination added and honest: states the tool is not enabled, explains what is missing, offers Library/Edit/System, issues zero requests, ships no execution control. Execution remains `BLOCKED_DECISION`. |
| T-604 | Voice | `NOT_STARTED` | Reachable; unchanged. |
| T-605 | Drama | `NOT_STARTED` | Reachable; unchanged. |
| T-606 | Music | `NOT_STARTED` | Reachable; unchanged. |
| T-607 | Video | `NOT_STARTED` | Reachable and still truthfully non-executable; not re-verified in this session. |
| T-608 | World | `NOT_STARTED` | Reachable; unchanged. |
| T-609 | 3D | `NOT_STARTED` | Reachable; unchanged. |
| T-610 | Library | `NOT_STARTED` | Dead card buttons removed; contextual actions not yet replaced. |
| T-611 | Edit | `NOT_STARTED` | — |
| T-612 | Enhance | `NOT_STARTED` | — |
| T-613 | Models | `IN_PROGRESS` | Inert actions removed; real Refresh remains. |
| T-614 | System | `IN_PROGRESS` | Worker/resource payload validation keeps the health surface honest when the backend misbehaves. |

### G7 — scroll/input stability

| ID | Objective | Status | Evidence |
|---|---|---|---|
| T-701 | Reproduce a native V2 scroll bug | `NOT_REPRODUCED` | No native app and no browser in the sandbox. Consistent with the audit's "not reproduced for settled V2"; no fix claimed. |
| T-702 | Narrowest proven repair | `NOT_STARTED` | Blocked on T-701; the renderer was not touched. |
| T-703 | Durable scroll/focus tests | `NOT_STARTED` | — |

### G8 — regression, native, novice acceptance

| ID | Objective | Status | Evidence |
|---|---|---|---|
| T-801 | Unit + integration regression ladder | `IN_PROGRESS` | Full `npm test` run before and after; see §6. |
| T-802 | Real interaction matrix | `VERIFIED_SANDBOX` (E2) | One jsdom mount walks all 14 chips with real click events and asserts each screen draws without a render error, is not blank, names itself, has no unnamed enabled button, gives every image `alt` text and wraps nothing in a form. Create's Generate, Cancel, reattach and Swap are covered by their own cases. **No E3 browser matrix** (no Chromium in this sandbox). |
| T-803 | Native WKWebView + Dock | `BLOCKED_NATIVE` | Requires the owner's Mac. |
| T-804 | Bounded real-machine E2E | `BLOCKED_REAL_WORKER` | Requires explicit authorization and Big Mac availability. |
| T-805 | Independent novice acceptance | `BLOCKED_HUMAN` | `HUMAN ACCEPTANCE NOT RUN`. |
| T-806 | Accessibility/responsiveness | `IN_PROGRESS` | Chips are real buttons with titles and `aria-current`, one row with labelled keyboard-reachable overflow controls; every screen is asserted to expose no unnamed enabled button and no image without `alt`. **Not done:** 200% zoom, 1280/1440/1920 layout measurement, screen-reader pass — all need a real browser (E3). |
| T-807 | Performance/resource stability | `NOT_STARTED` | — |

### G9 — documentation and rollout

| ID | Objective | Status | Evidence |
|---|---|---|---|
| T-901 | User-facing getting-started help | `IN_PROGRESS` | `docs/acceptance/DEXDIFFUSION_HUMAN_ACCEPTANCE.md` updated with the Studio first-run script. |
| T-902 | Update governing docs without erasing history | `VERIFIED_SANDBOX` | Appended V2-authority sections to `DEXDIFFUSION.md` and `OPERATIONAL_STATE.md`; history preserved. |
| T-903 | Stage/install/release with rollback | `BLOCKED_EXTERNAL` | Not installed or released from Arena. Rollback instructions recorded in §9. |
| T-904 | Capability and defect closure ledger | `VERIFIED_SANDBOX` | This document. |

## 4. Gate status — code delivered vs release acceptance

| Gate | Code delivered | Release acceptance |
|---|---|---|
| G0 | Yes (partial inventory) | `BLOCKED_NATIVE` (no app stamp) |
| G1 | Yes | `VERIFIED_SANDBOX` only; live Big Mac stop `BLOCKED_REAL_WORKER` |
| G2 | Yes (Swift + UI) | `BLOCKED_NATIVE` for dialogs; Cancel `VERIFIED_SANDBOX` |
| G3 | No | `NOT_STARTED` |
| G4 | Yes | `VERIFIED_SANDBOX`; Dock/first-run `BLOCKED_NATIVE` |
| G5 | Partial | `IN_PROGRESS` |
| G6 | Partial (Swap, Models, System) | `IN_PROGRESS` |
| G7 | No | `NOT_REPRODUCED` / `BLOCKED_NATIVE` |
| G8 | Partial | `BLOCKED_NATIVE`, `BLOCKED_REAL_WORKER`, `BLOCKED_HUMAN` |
| G9 | Docs yes | **Release `BLOCKED`** — no install, no sign-off |

## 5. Control inventory (sampled, E1/E2)

| Control | Screen | Before | Now | Disposition |
|---|---|---|---|---|
| `Check stage` | Models (V1/V2/V3) | Enabled, no handler | Removed | `REMOVE_PROVEN_PLACEHOLDER` |
| `SDXL smoke` / `Flux smoke` | Models | Enabled, no handler, implied heavy compute | Removed | `REMOVE_PROVEN_PLACEHOLDER` (heavy tests must be launched deliberately from Create) |
| `Inventory` / `Discover` | Models | Enabled, no handler | Removed; `Refresh Models` (wired) remains | `MERGE_DUPLICATE` |
| `Save style ↗` | Create (V2) | Enabled, no handler | Removed | `REMOVE_PROVEN_PLACEHOLDER` |
| `Latest sweep` | Library (V2) | Enabled, no handler | Removed | `REMOVE_PROVEN_PLACEHOLDER` |
| Library card `Open` / `→ Create` / `JSON` | Library (V2) | Enabled, no handler | Removed (contextual actions still to be rebuilt) | `REMOVE_PROVEN_PLACEHOLDER` |
| `Generate image` | Create | Second click cleared local polling while the worker kept running | Second click is refused with a message; a separate `Cancel job` is bound to the job id | `WIRE` |
| `Cancel job` | Create | Did not exist as a discrete control | Posts once to `/api/jobs/<id>/cancel`, reports verified/unverified/refused | `WIRE` (delegates to the proven `interruptGeneration`) |
| 14 category chips | Global | 13 static tabs, no Swap | 14 registry-driven chips in exact order | `WIRE` |

## 6. Milestones, commands and results

| Milestone | Commit | Staged paths | Verification |
|---|---|---|---|
| M1 cancellation truth | `b1253ca` | `cancellation.js`, `server.js`, `operational-jobs.js`, `tests/cancellation-truth.test.js` | `node --test tests/cancellation-truth.test.js` → 16/16 pass. Related suites (`v12-cancellation-safety`, `workstation-v12-foundations`, `job-store-events`, `op7-remote-workers`) pass; the only failures there are the pre-existing `scan-owned` fixture and `drama-production-routes` (missing `ffmpeg`). |
| M2 native dialogs | `50e6b97` | `ImageGenApp.swift`, `tests/native-wrapper-launch.test.js` | Static test 4/4 pass. Not compiled (no toolchain) → `BLOCKED_NATIVE`. |
| M3 Studio shell | `d9779e0` | `studio-nav.js`, `component.js`, `index.html`, `media-ui.js`, `tests/studio-shell.test.js`, `tests/world-tab-navigation.test.js`, `package.json`/`package-lock.json` (jsdom, dev) | `node --test tests/studio-shell.test.js` → 20/20 pass; `world-tab-navigation` 4/4. |
| M4 documentation | `07290f8` | `docs/operations/arena-v2-studio-20261020/*`, `DEXDIFFUSION.md`, `OPERATIONAL_STATE.md`, `docs/acceptance/…` | Reviewed by hand. |
| Full suite | — | — | See §6.1. |

**Later commits on the same branch** (each independently tested):
`6e093d9` canonical source resolution + reload reconciliation + render survival;
`a90f600` Create screen header + the 14-screen render matrix.

**Source control readback:** branch `arena/f721222f-image-gen` pushed to `origin`; remote head observed at `07290f893f6cf84f809cecefa26a89afea21608e`.
Pull request **#4** — https://github.com/westkitty/Image_Gen/pull/4 — **open, converted to DRAFT, never merged or closed**.

### 6.1 Full-suite comparison

- **Before** (pristine base SHA copy, same dependencies): 923 tests, **755 pass / 88 fail / 80 skipped**.
- **After** (this branch, latest full run): 979 tests, **811 pass / 88 fail / 80 skipped** (+56 tests, +56 passes). An interim run after G1-G4 was 960/792/88/80.
- Failure names were compared with `comm` against the baseline list: **0 new failures, 0 newly-fixed-by-accident**. The 88 failures are byte-identical to the baseline set (`ffmpeg`, Python/numpy, macOS paths, live-run fixtures).
- Known environmental gaps: no Chromium, so every `test:browser*` suite is **skipped, not passed**; no Swift toolchain, so the native test is source-level only.

## 7. Protected invariants and their state

- **I-01 Studio, not Workstation** — enforced for normal users (migration + hidden picker).
- **I-03 one honest job state** — enforced on the server (unsafe cancellation refused) and in the UI (unverified stop never green).
- **I-04 same image, same ID** — untouched; no source-resolution code was modified.
- **I-05 capability truth** — Swap and Video remain explicitly unavailable; `canCancel` now derives from worker contract + ownership.
- **I-06 zero feature deletion** — only decorative controls with no handler were removed; every module, engine and test remains.
- **I-07 zero enabled no-ops** — enforced for the V2 shell by an automated guard; other screens still to sweep.
- **I-08 no work loss** — migration preserves all existing storage keys; no draft is cleared.
- **I-09 local-first boundary** — untouched: no network bind, port, Tailscale or storage change.
- **I-10 no silent model changes** — untouched; existing activation tests still pass.
- **I-13 dirty-work protection** — clean clone preserved; no destructive git operation used.

## 8. R1 vs R2

- **R1 (stabilization)** — partially delivered: honest cancellation, a single Studio shell with 14 truthful destinations, honest Swap, no inert Models actions, offline shell resilience. Remaining R1 work: G3 handoffs, G5 disclosure, G7 scroll evidence, full control sweep, novice study.
- **R2 (fully realized)** — **not delivered and not claimed.** Swap has no approved backend/licence; Video generation is unproven; no real worker proof exists for any screen in this session.

## 9. External blockers and owner steps

1. **Native (E4):** on the MacBook, run `scripts/install-macos-app.sh` from this branch after review, open the Dock app, then (a) trigger any `window.confirm` path and confirm both Accept and Cancel behave, (b) scroll the Create pane while a job runs and record `[data-scroll-pane]` identity/`scrollTop`, (c) click all 14 chips.
2. **Real worker (E5):** with explicit authorization, one smallest MFLUX/SDCPP generation, then one queued cancel and one owned active cancel; record run id, timestamps, output SHA and the remote-stop evidence string.
3. **Novice (E6):** three unfamiliar people using the card in `docs/acceptance/DEXDIFFUSION_HUMAN_ACCEPTANCE.md`, unassisted.
4. **MacBook dirty work:** the four paths listed in §1 must be reconciled on the MacBook before any sync; this branch does not touch them, but `operator-console/server.js` overlaps and will need a manual merge.
5. **Rollback:** `git checkout main` (or the previous reviewed commit) and reinstall the wrapper; no data migration was performed, so no data rollback is required.

## 10. Resume here

Next tickets in dependency order: **T-203** (job reconciliation) → **T-301/T-302** (source resolver, Edit source) → **T-403/T-501** (Create layout + Advanced disclosure) → **T-504** (continue the control sweep on Library/Edit/Enhance/Batch) → **T-701** (native scroll trace, requires E4).

Resume from the branch: `git fetch origin && git checkout arena/f721222f-image-gen && cd operator-console && npm install && npm test`.
