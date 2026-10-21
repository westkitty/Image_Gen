# DexDiffusion V2 Studio — Arena execution ledger

**Mission:** `ARENA_DEXDIFFUSION_V2_STUDIO_MASTER_EXECUTION_PROMPT_2026-10-20.md` (operator-supplied attachment; blueprint date 2026-10-20).
**Source checksum (SHA-256):** `1279459cdaf31bcaf1aa1aed7994f059de106bad4216a155f2e23f919bdee758`.
**Repository:** `westkitty/Image_Gen` · **branch:** `arena/ba1fe323-image-gen` (Arena-provisioned session branch; branch name is fixed for this session)
**Baseline:** `4324dec29240fc61fb32ef2ef9db23fad0ced7a1`
**Initial remote readback:** `origin/main` was the same SHA as baseline; no intervening main commits. Initial worktree was clean.
**Initial source-control authority:** `origin=https://github.com/westkitty/Image_Gen.git`; `gh repo view` returned exact repository and `viewerPermission=ADMIN`. No pre-existing PR was found for this branch.
**Final pre-doc commit readback:** `HEAD=35208161d7042e486947865661021a0fde37179e`; `origin/main=4324dec29240fc61fb32ef2ef9db23fad0ced7a1`; merge base remains the original baseline.
**Pushed branch readback (before this receipt update):** `origin/arena/ba1fe323-image-gen=030cc0d35ccb5b3ede36cb5a1bc6f76bc2c69639` (matched local HEAD).
**Review PR readback:** [#5](https://github.com/westkitty/Image_Gen/pull/5), draft, `OPEN`, base `main`, head `arena/ba1fe323-image-gen`, PR head SHA `030cc0d35ccb5b3ede36cb5a1bc6f76bc2c69639`, merge commit `null`. Never merged.
**Environment:** Linux x86_64 Arena container, Node 22.22.3; not the owner’s MacBook, native WKWebView, or Big Mac.

## Current delivery state

This is a **partial, reviewable stabilization patch**, not an R1/R2 release. Implemented in the sandbox: the false cancellation transition for durable unowned running jobs is refused; generic durable jobs only advertise universally safe never-started queue cancellation; Create no longer treats a second Generate click as local cancellation and now has a job-ID-bound explicit stop/reconciliation flow; V2 is the normal shell with a one-row 14-category nav and an explicitly unavailable Swap destination; known V2 model placeholders are gated or wired to existing read-only refresh actions; several V2 Library placeholder actions were removed in favor of their existing inspector equivalents; and native WKWebView JavaScript alert/confirm/prompt delegate code was added.

The standard-library Node tests and source checks pass for the touched behaviors. Native compilation/interaction, actual browser clicks, real worker process stop, source handoffs, scrolling on WKWebView, novice acceptance, and release packaging remain external blockers. No real generation, cancellation request, model activation/download, asset modification, app installation, or deployment was performed.

## Verified milestone commits (pushed to the isolated review branch)

| Commit | Scoped files | Verification / claim boundary |
|---|---|---|
| `0a3392a` — `fix(jobs): fail closed for unowned cancellation` | `operator-console/cancellation.js`, `operational-jobs.js`, `server.js`, `tests/cancellation-unowned.test.js`, `tests/generic-job-cancel-capability.test.js` | Cancellation and job projection are covered by focused Node suites; this is not evidence of Big Mac termination. |
| `3520816` — `feat(studio): make V2 the normal shell` | Native dialog delegate, V2 `component.js`/`index.html`, package browser script, seven debug-query updates, browser harness, Studio unit/source-contract tests | Focused suites pass; full unit suite has 88 failures; actual browser did not start (Chrome absent); Swift not compiled. |
| `35fd1c7` — `docs(studio): record V2 acceptance and blockers` | README/operator/acceptance/Concept A direction updates plus this ledger | Explicit test failures and external blockers recorded; pushed with the branch. |
| `030cc0d` — `docs(studio): record pushed branch and review PR` | `OPERATIONAL_STATE.md`, this ledger | Records verified push and open draft PR #5; subsequent ledger receipt update is still to be pushed. |

## Gate record

| Gate | Status | Evidence / remaining boundary |
|---|---|---|
| G0 — identity, preserve, baseline | `PARTIAL` | Correct repository, session branch, origin, HEAD, clean initial worktree and unchanged `origin/main` verified. Four MacBook-only dirty paths named in the mission were absent from this clone; their later integration must be checked on the Mac. Native app stamp, served runtime, Mac screenshots, control-by-control live baseline, and novice/scroll recording are `BLOCKED_EXTERNAL`. |
| G1 — cancellation truth | `IMPLEMENTED_AND_VERIFIED_IN_ARENA` (scoped) | Synthetic RUNNING/TRANSFERRING records with no registered owner preserve durable state and lease and emit no `job.cancelled`; generic projection only marks QUEUED as cancelable. Does not prove process-stop/readback semantics of a real worker. |
| G2 — native dialogs and V2 Cancel | `PARTIAL`; `BLOCKED_NATIVE` | Swift WKUIDelegate methods and V2 explicit Cancel-by-job-ID/reconciliation code added. Source-contract and unit tests pass. Actual Swift build, packaged WKWebView confirm/alert interaction, HTTP request observation through native app, refresh/relaunch recovery, and real stop proof were not run. |
| G3 — canonical asset identity / handoff | `NOT_STARTED` | No resolver or source handoff changes; no canonical, staged, missing, wrong-media, moved, or corrupt source fixture matrix run in this mission. |
| G4 — normal V2 Studio + nav | `PARTIAL` | Normal profile migrates only `dex_version` to 2 and retains the separate debug query (`?debug=1`) for legacy regression shells. The V2 category row has the specified 14 labels; Swap is honestly reserved and non-executable. Static/unit assertions pass; actual browser clicks, draft round-trip, and route-level acceptance are not run. Create canvas redesign and full migration proof remain open. |
| G5 — action truth / simple controls | `PARTIAL` | Known V2 Models controls are no longer falsely active (smoke operations gated; stage check disabled with explanation; inventory and asset discovery wired); V2 Library card no-op buttons removed in favor of existing Run inspector and preview actions; Save recipe is wired. Full screen-wide enabled-control inventory is incomplete. |
| G6 — 14 module behavior | `NOT_STARTED` | No module-by-module action/output/capability acceptance. Swap is unavailable by design decision; Video generation remains existing dormant/unavailable truth. |
| G7 — scroll/input | `BLOCKED_EXTERNAL` | No native V2 reproduction trace. No renderer scroll hack was applied. |
| G8 — full regression/native/novice | `PARTIAL`; native and human portions `BLOCKED_EXTERNAL` | Focused suites and syntax checks run; full `npm test` had environment-dependent failures (see Validation). No Chrome/Chromium executable, macOS/Swift runtime, Big Mac, or human participants are available here. |
| G9 — docs/release | `PARTIAL`; release `BLOCKED_EXTERNAL` | This ledger and current-direction acceptance notes are added. No app build/install, Dock check, source stamp readback, rollback test, human sign-off, R1 decision, or release. |

## Source disagreements and direct findings

| Claim / source | Live repository observation on this branch | Verdict | Consequence |
|---|---|---|---|
| Historic Workstation/Concept A PRDs say Workstation is the normal product. | The governing 2026-10-20 mission supersedes that product decision; code now defaults only to V2 and keeps explicit `?debug=1`. | `CONTRADICTED` as current direction; historical record remains. | README/operator/acceptance docs distinguish current V2 from preserved history. |
| Earlier audit said media routes were dead because base `component.js` did not expose every handler. | `media-ui.js` and `drama-ui.js` extend `renderVals` after base load and supply Voice/Music/Video/Drama content/handlers. | `CONTRADICTED` (per governing mission; source composition confirmed). | Do not duplicate these dynamic handlers; the browser click matrix is authored but cannot execute here. |
| V2 Generate click doubles as cancellation. | Base handler cleared polling and reset to idle; active-job guard and explicit separate Cancel now exist with focused tests. | `VERIFIED` defect, corrected in source. | Never count client reset or request response as proof of worker stop. |
| Generic unowned RUNNING cancellation was already safe. | Manager accepted absent in-memory owner as queued cancellation; synthetic durable RUNNING/TRANSFERRING tests now prove refusal, no transition/event/lease release. | `VERIFIED` defect, corrected in source. | Active unowned jobs remain for safe reconciliation. |
| Any generic RUNNING/TRANSFERRING row can safely advertise Cancel. | Current worker capability shape is not universal; generic projection now advertises only never-started QUEUED records. | `VERIFIED` unsafe claim, corrected conservatively. | Worker-specific active cancellation remains gated by its existing exact-identity/stop-receipt route. |
| V2 Models “Check stage”, SDXL/Flux smoke and Inventory actions are all useful enabled controls. | Before changes, several were inert. Stage/smokes are now explicitly disabled/gated; Inventory/Discover call existing read-only refresh handlers. | `VERIFIED` no-ops for scoped buttons; correction source-checked. | Not an exhaustive visible-control inventory or actual browser proof. |
| V2 Library card Open/Create/JSON actions navigate correctly; Latest sweep is functional. | Source had inert card actions and non-functional comparison actions. Cards now direct to existing Run inspector/preview; Latest sweep is disabled with explanation. | `VERIFIED` source defect; corrected. | Browser acceptance remains pending. |
| Native WebKit JavaScript dialogs work because Chrome dialogs do. | Actual wrapper lacked `runJavaScript...` WKUIDelegate methods; handlers now exist in Swift but have no Mac compile or interaction evidence. | `UNVERIFIED` native behavior. | T-201 remains `BLOCKED_NATIVE`. |
| Known MacBook dirty paths are part of this clone. | Initial Arena worktree was clean and none of the four paths existed as dirty changes here. | `CONTRADICTED` for this clone only. | Reconcile manually before integration; this branch touches `server.js`. |
| A green source test or visible screenshot proves installed behavior. | Arena Linux cannot run WebKit, an actual Big Mac worker, or novice testing; browser executable is missing. | `CONTRADICTED`. | Keep E1/E2 evidence distinct from E3/E4/E5/E6; no release PASS. |

## Evidence ID and maturity convention

- `E0` = not run/no artifact; `E1` = source/static check; `E2` = isolated unit, server-contract, or fixture integration; `E3` = actual Chrome/browser click; `E4` = installed native WKWebView; `E5` = real owned worker; `E6` = independent novice/human.
- `E2-CAN-1`: `tests/cancellation-unowned.test.js` (three cancellation cases); `E2-CAN-2`: `tests/v12-cancellation-safety.test.js`; `E2-JOB-1`: `tests/generic-job-cancel-capability.test.js`; `E2-JOB-2`: `tests/workstation-v12-foundations.test.js`; `E2-JOB-3`: `tests/job-store-events.test.js`.
- `E2-STUDIO-1`: `tests/studio-launch-and-cancel.test.js` (default/debug launch, repeat Generate guard, exact one-request Cancel and stop-message parsing, 14-chip/static Swap/control contracts); `E2-STUDIO-2`: `tests/studio-safety-contract.test.js` (source-level V2/native/cancellation assertions); `E2-REMOTE-1`: `tests/remote-cancel.test.js` (identity/route contract); `E2-DRAMA-1`: the filtered shared-cancellation route test in `tests/drama-production-routes.test.js`.
- `E1-CHECK-1`: `npm run check`, JavaScript `node --check` commands and `git diff --check`; `E1-BROWSER-HARNESS-1`: source and syntax of `tests/browser/studio-navigation.browser.js`; browser invocation failed before running assertions because `/opt/google/chrome/chrome` is absent. `E1-DOC-1`: this ledger, current operator/README direction notes and supersession banner.
- No `E3`, `E4`, `E5` or `E6` pass evidence exists. Absence of those evidence IDs is not implied acceptance.

## Ticket ledger (all 55 blueprint tickets)

| Ticket | Status | Evidence / next boundary |
|---|---|---|
| T-001 | `IN_PROGRESS` | Sandbox repo/branch/HEAD/origin/main/worktree fingerprint recorded above; native/runtime stamp unavailable. |
| T-002 | `IN_PROGRESS` | Targeted static inventory only; no exhaustive DOM/event trace of every enabled action. |
| T-003 | `BLOCKED_HUMAN` | Mac novice and native scroll recordings not possible in Arena. |
| T-004 | `IN_PROGRESS` | Protected local-first, storage, model, privacy, publication and worker boundaries retained; no physical runtime readback. |
| T-101 | `VERIFIED_SANDBOX` | Regression fixtures cover durable RUNNING and TRANSFERRING with absent owner, plus missing job. |
| T-102 | `IN_PROGRESS` (conservative projection verified) | Generic durable `canCancel` is true only for QUEUED; running worker-specific capability remains unprojected and is therefore not offered. The required image/voice/music/video/3D capability matrix is not implemented or tested. |
| T-103 | `BLOCKED_REAL_WORKER` | No Big Mac process/nonce/workdir test was authorized or available. |
| T-104 | `IN_PROGRESS` | Existing endpoint remains backward-compatible; the new UI interprets verified/not-started/unverified responses. Full API response matrix not run. |
| T-201 | `BLOCKED_NATIVE` | Alert, confirm and text-input WKUIDelegate handlers added; no native build or packaged click proof. |
| T-202 | `VERIFIED_SANDBOX` | Separate Cancel job control calls one `/api/jobs/:id/cancel` request; duplicate submit no longer resets polling; unit coverage for verified/unverified state. Browser request-spy/native proof still required. |
| T-203 | `IN_PROGRESS` | Full server reconciliation after page reload, tab change and native relaunch remains open; limited manual Check job status action exists after uncertain result. |
| T-301 | `NOT_STARTED` | No shared typed server artifact resolver added. |
| T-302 | `NOT_STARTED` | No new stale Edit source recovery test/repair. |
| T-303 | `NOT_STARTED` | No Enhance source/result identity repair. |
| T-304 | `NOT_STARTED` | No World/3D source gate change. |
| T-305 | `NOT_STARTED` | No cross-module source lineage run. |
| T-401 | `VERIFIED_SANDBOX` | Default V2 preference migration implemented and unit-tested; full saved draft/session migration not run in browser/native profiles. |
| T-402 | `IN_PROGRESS` | 14 requested category chips exist with responsive horizontal layout and category colors; actual click matrix not run. |
| T-403 | `NOT_STARTED` | V2 Create still retains legacy content complexity; no full canvas/inspector simplification. |
| T-404 | `IN_PROGRESS` | V4/other research shells remain in code, selection hidden in normal UI and retained behind `?debug=1`; feature migration not complete. |
| T-501 | `NOT_STARTED` | No global Basic/Advanced disclosure work. |
| T-502 | `NOT_STARTED` | No complete result-transition audit. |
| T-503 | `NOT_STARTED` | No unified Job Center presentation work. |
| T-504 | `IN_PROGRESS` | Several verified V2 no-op placeholders fixed/gated; not a full visible-control inventory. |
| T-505 | `NOT_STARTED` | No comprehensive model-selection behavior change. |
| T-506 | `IN_PROGRESS` | Explicit cancel uncertainty and status recovery added for Create; other screens not audited. |
| T-507 | `NOT_STARTED` | No micro-interaction refinement. |
| T-601 | `IN_PROGRESS` | Create duplicate-Generate and cancel truth corrected in source/unit scope; no real generation journey. |
| T-602 | `NOT_STARTED` | Batch/Sweep not revalidated. |
| T-603 | `BLOCKED_DECISION` | Swap is a reserved, visibly unavailable screen; exact semantics/model/license/backend remain `BLOCKED_DECISION`. |
| T-604 | `NOT_STARTED` | Voice not revalidated. |
| T-605 | `NOT_STARTED` | Drama not revalidated. |
| T-606 | `NOT_STARTED` | Music not revalidated. |
| T-607 | `IN_PROGRESS` | Video remains reachable via existing route but generation remains unavailable; no click proof in this sandbox. |
| T-608 | `NOT_STARTED` | World not revalidated. |
| T-609 | `NOT_STARTED` | 3D not revalidated. |
| T-610 | `IN_PROGRESS` | V2 Library false card actions were removed; canonical asset/source workflow not revalidated. |
| T-611 | `NOT_STARTED` | Edit not revalidated. |
| T-612 | `NOT_STARTED` | Enhance not revalidated. |
| T-613 | `IN_PROGRESS` | Known V2 model actions wired/gated; model readiness and worker status not verified here. |
| T-614 | `NOT_STARTED` | System health / recovery actions not revalidated. |
| T-701 | `BLOCKED_NATIVE` | Native scroll failure not reproduced; prior Chrome evidence is not substituted. |
| T-702 | `NOT_STARTED` | No renderer change without reproduction. |
| T-703 | `NOT_STARTED` | Durable scroll/focus matrix not run. |
| T-801 | `IN_PROGRESS` | New focused Node tests pass; full suite has environmental failures and native harness is unavailable. |
| T-802 | `IN_PROGRESS` | Dedicated `npm run test:browser:studio-navigation` now clicks rendered accessible buttons and checks active routes; no Chrome/Chromium executable to run it. Static chip contract is not a route-click PASS. |
| T-803 | `BLOCKED_NATIVE` | No macOS or installed `/Applications/DexDiffusion.app`; installation was expressly not authorized. |
| T-804 | `BLOCKED_REAL_WORKER` | No actual Big Mac inference or stop test; no real generation authorization. |
| T-805 | `BLOCKED_HUMAN` | No three independent novice participants. |
| T-806 | `BLOCKED_NATIVE` | Native/keyboard/zoom/touch accessibility not tested. |
| T-807 | `NOT_STARTED` | No measured matched performance baseline. |
| T-901 | `IN_PROGRESS` | Current V2 direction and ticket-specific guidance documented; no final user guide/screenshots. |
| T-902 | `VERIFIED_SANDBOX` | Operator guide, acceptance form and operational history receive supersession/ledger links; Concept A history retained. |
| T-903 | `BLOCKED_NATIVE` | No package/install/rollback or release approval. |
| T-904 | `IN_PROGRESS` | This ticket/gate ledger is complete for this execution pass; final reviewer/owner sign-off pending. |

### Per-ticket traceability (blueprint objective, dependency, source paths, evidence)

Path lists identify the authoritative implementation/acceptance seam; where status is `NOT_STARTED`, the files are inspection targets, not asserted changes. `E0-Txxx` means no proof artifact was run for that ticket.

| ID | Objective | Depends on | Primary paths and evidence |
|---|---|---|---|
| T-001 | Fingerprint machine/runtime/worktree | G0 start | `docs/acceptance/DEXDIFFUSION_V2_STUDIO_EXECUTION_LEDGER.md`; `E1-DOC-1` (Arena-only; Mac stamp E0). |
| T-002 | Inventory real controls/capabilities | T-001 | `operator-console/public/dexdiffusion/{index.html,component.js,media-ui.js,drama-ui.js,workstation-ui.js,edit-ui.js}`, server/routes/tests; partial sample only, `E0-T002` for exhaustive inventory. |
| T-003 | Capture novice and native scroll baseline | T-001 | `docs/acceptance/DEXDIFFUSION_HUMAN_ACCEPTANCE.md`; no recording, `E0-T003`. |
| T-004 | Freeze protected boundaries/proven claims | T-001–T-003 | this ledger, `OPERATIONAL_STATE.md`; `E1-DOC-1`, physical runtime evidence `E0-T004`. |
| T-101 | Refuse unowned running-job false cancellation | G0/T-001, T-004 | `operator-console/cancellation.js`, `tests/cancellation-unowned.test.js`; `E2-CAN-1`. |
| T-102 | Derive cancel capability from actual support | T-101 | `operator-console/operational-jobs.js`, `server.js`, `tests/generic-job-cancel-capability.test.js`; `E2-JOB-1`. |
| T-103 | Verify targeted stop and publication races | T-101/T-102 | remote worker registry, stop route, publication and arbiter; no physical worker test/change, `E0-T103`. |
| T-104 | Keep cancellation response backward-compatible and truthful | T-101–T-103 | `operator-console/server.js`, `cancellation.js`, `public/dexdiffusion-v12.js`, V2 `component.js`, `tests/remote-cancel.test.js`; `E2-REMOTE-1` plus focused route test `E2-DRAMA-1`; complete response matrix `E0-T104`. |
| T-201 | Restore native JavaScript dialog handling | G0 | `native/macos/Image_Gen/ImageGenApp.swift`, `tests/studio-safety-contract.test.js`; source contract `E2-STUDIO-2`; native proof `E0-T201`. |
| T-202 | Separate exact-job V2 Cancel from Generate | T-101/T-104 | V2 `component.js`, `index.html`, `tests/studio-launch-and-cancel.test.js`; `E2-STUDIO-1`. |
| T-203 | Reconcile jobs across reload/navigation/relaunch | T-202 | V2 `component.js`, `/api/operations/snapshot`, Job Center; manual exact-ID check exists, full reload lifecycle `E0-T203`. |
| T-301 | Define one typed canonical artifact resolver | G0 | image store/resolver, `workstation-ui.js`, `edit-ui.js`, World/3D bridges; no changes, `E0-T301`. |
| T-302 | Stabilize/recover Edit source and draft | T-301 | `operator-console/public/dexdiffusion/edit-ui.js`, source persistence; no changes, `E0-T302`. |
| T-303 | Preserve exact Enhance input/result identity | T-301 | `workstation-ui.js`, `component.js`, image metadata; no changes, `E0-T303`. |
| T-304 | Gate World/3D on explicit valid source | T-301 | `component.js`, `asset3d-bridge.js`, World bridge; no changes, `E0-T304`. |
| T-305 | Preserve cross-module selected asset and lineage | T-301–T-304 | Library/Create/Edit/Enhance/World/3D handoff code; no changes, `E0-T305`. |
| T-401 | Default normal launch to V2 without data loss | G0 | V2 `component.js`, `tests/studio-launch-and-cancel.test.js`; `E2-STUDIO-1`. |
| T-402 | Add exact 14-chip nav and truthful destination states | T-401 | V2 `index.html`, `component.js`, dynamic `media-ui.js`/`drama-ui.js`; static `E2-STUDIO-1`; browser harness `E1-BROWSER-HARNESS-1`, runtime click proof `E0-T402`. |
| T-403 | Simplify Create without losing expert capability | T-401/T-402, feature crosswalk | V2 Create template, `workstation-ui.js`; no redesign/change, `E0-T403`. |
| T-404 | Retire V4 default, preserve legacy modules | T-401 | `component.js`, V2 `index.html`, seven `tests/browser/*` debug query edits, `DEXDIFFUSION.md`; `E2-STUDIO-1`/`E1-DOC-1`; browser regression execution `E0-T404`. |
| T-501 | Basic/Advanced disclosures preserve semantics | T-403 | Create/settings/workbench and preference code; no changes, `E0-T501`. |
| T-502 | Consistent primary action/result transitions | T-403 | Create/result action components, V2 templates; limited Create guard only, broader pass `E0-T502`. |
| T-503 | One Job Center without duplicate loss | T-402/T-502 | operation snapshot, V12 and per-screen presenters; projection tests only, UI consolidation `E0-T503`. |
| T-504 | Eliminate enabled no-op controls | T-402 | V2 Models/Library/Create templates, `component.js`; source changes and focused checks `E1-CHECK-1`, `E2-STUDIO-1`; full visible-action sweep `E0-T504`. |
| T-505 | Make model choice/readiness non-surprising | T-401/T-504 | model registry, workers and Create settings; no model policy change, `E0-T505`. |
| T-506 | Make all screen states recoverable | T-202/T-402 | V2 state components, job and media presenters; cancellation uncertainty is partial `E2-STUDIO-1`; all-screen state pass `E0-T506`. |
| T-507 | Retain polish/accessibility without noise | T-402/T-403 | Studio CSS, shared controls, native accessibility; limited focus-visible CSS only, acceptance `E0-T507`. |
| T-601 | Complete Create task contract | T-202/T-403/T-504 | V2 `component.js`/`index.html`, worker/client routes; cancellation subset `E2-STUDIO-1`; real Create journey `E0-T601`. |
| T-602 | Preserve/verify Batch workflows | T-503/T-504 | Batch UI/workers/jobs; no behavior change, `E0-T602`. |
| T-603 | Honest unavailable Swap destination | T-402 | V2 `index.html`, `component.js`, `tests/studio-launch-and-cancel.test.js`; `E2-STUDIO-1`; product decision/backend stays blocked. |
| T-604 | Verify Voice capability/actions | T-402 | `media-ui.js`, `voice-ui.js`, worker/routes; dynamic source reviewed, no journey, `E0-T604`. |
| T-605 | Verify Drama project lifecycle | T-402 | `drama-ui.js`, production routes, tests; cancellation route filter `E2-DRAMA-1` only; full Drama path `E0-T605`. |
| T-606 | Verify Music worker truth/actions | T-402 | `media-ui.js`, music worker/routes; no journey, `E0-T606`. |
| T-607 | Keep Video honest/unavailable | T-402 | `media-ui.js`, V2 nav, capability records; source reviewed; click proof `E0-T607`. |
| T-608 | Preserve World source/output flow | T-402/T-301/T-304 | World workspace/bridge and artifact store; no changes, `E0-T608`. |
| T-609 | Preserve 3D source/mode flow | T-402/T-301/T-304 | `component.js`, `asset3d-bridge.js`, `asset3d.js`; no changes, `E0-T609`. |
| T-610 | Make Library truthful and preserve its workflows | T-301/T-504 | V2 Library template, `component.js`, `media-ui.js`; inert actions removed, source-only `E1-CHECK-1`; browser proof `E0-T610`. |
| T-611 | Verify Edit source/mask workflows | T-301/T-302 | `edit-ui.js`, `workstation-ui.js`; no changes, `E0-T611`. |
| T-612 | Verify Enhance methods/source/result | T-301/T-303 | `workstation-ui.js`, `component.js`, Enhance template; no changes, `E0-T612`. |
| T-613 | Gate/wire Models actions | T-402/T-504 | V2 Models template, `component.js`, model routes; `E2-STUDIO-1`/`E1-CHECK-1`. |
| T-614 | Verify System/health/recovery truth | T-503/T-506 | System template, `server.js`, `workstation-ui.js`; no complete fault matrix, `E0-T614`. |
| T-701 | Record reproducible native V2 scroll trace | T-402 | V2 panes, `dc-runtime.js`, native wrapper; no trace, `E0-T701`. |
| T-702 | Fix only reproduced scroll/focus mechanism | T-701 | renderer and exact failing pane; no change, `E0-T702`. |
| T-703 | Add durable scroll/focus acceptance | T-701/T-702 | browser/native harnesses, Studio panes; no run, `E0-T703`. |
| T-801 | Run unit/integration/browser regression ladder | Each code ticket | operator-console tests/scripts; focused `36/36` and filtered route `1/1`; full suite `770/938 pass, 88 fail, 80 skip`; see Validation. |
| T-802 | Exercise actual rendered actions/accessibility | T-402/T-504/T-801 | new `tests/browser/studio-navigation.browser.js`, package script; `E1-BROWSER-HARNESS-1`; invocation stopped before assertions (missing Chrome), `E0-T802`. |
| T-803 | Verify installed native app/Dock/source stamp | T-201/G8 | `native/macos/Image_Gen/ImageGenApp.swift`, install script; not compiled/installed, `E0-T803`. |
| T-804 | Test bounded real worker journeys | T-101–T-104/T-601–T-614 | worker registry/Big Mac bridge/canonical store; no authorization/runtime, `E0-T804`. |
| T-805 | Observe three unfamiliar independent users | G4–G8 | `docs/acceptance/DEXDIFFUSION_HUMAN_ACCEPTANCE.md`; protocol documented only, no participants, `E0-T805`. |
| T-806 | Verify accessibility/responsive/input matrix | T-402/T-507/T-701 | V2 CSS/templates, accessibility code, browser/native tests; static focus treatment only, `E0-T806`. |
| T-807 | Measure equivalent performance/resource baseline | G4/T-801 | browser harness/library/job polling; no benchmark, `E0-T807`. |
| T-901 | Write user-facing getting-started help | T-601–T-614 | `DEXDIFFUSION.md`, current acceptance/ledger; direction updated but not a full beginner guide, `E1-DOC-1`; user study `E0-T901`. |
| T-902 | Reconcile governing docs and retain history | T-401/G0 | `README.md`, `DEXDIFFUSION.md`, `OPERATIONAL_STATE.md`, `docs/acceptance/DEXDIFFUSION_HUMAN_ACCEPTANCE.md`, `docs/concept-a/DEXDIFFUSION_CONCEPT_A_PRD.md`, this ledger; `E1-DOC-1`. |
| T-903 | Package/install/rollback/readback | T-801–T-807 and owner approval | release scripts/native app; prohibited/unavailable in Arena, `E0-T903`. |
| T-904 | Owner/reviewer capability and closure sign-off | all tickets | this ledger/PR record; ledger authored `E1-DOC-1`, sign-off `E0-T904`. |

## Validation evidence (Arena)

- `npm ci --ignore-scripts` — completed from the existing lockfile; no package or lockfile edits. npm reported 2 dependency advisories (1 moderate, 1 critical); no `npm audit fix` or dependency change was attempted.
- `node --check server.js`, `node --check public/dexdiffusion/component.js`, `npm run check`, `git diff --check` — passed.
- Focused cancellation, operational projection, migration, explicit one-request Cancel, UI-state, server-contract, and native source-contract suites — 36/36 passed. The existing shared Drama cancellation route was also run by its exact test-name filter: 1/1 passed; the whole Drama production file cannot pass here because its unrelated master-export case requires absent `ffmpeg`.
- Full `npm test` — 938 tests: 770 passed, 88 failed, 80 skipped. Initial failure triage of the final log: multiple canonical/publication and native-batch cases fail with `image-validation-unavailable`; PIL-dependent image cases explicitly report `No module named PIL`; audio/Drama cases explicitly report missing `ffmpeg`/`ffprobe`; the `vision-detailer` executable is invoked by the host shell but rejects its first-line syntax; GN-02 parity cites a missing git-ignored live run; Blender-handoff fixtures fail their expected readiness assertions; and OP7 scan, MFLUX bridge output, `export-service`, `folder-first-library`, and other failures are not yet fully diagnosed. Some are clearly missing host data/tooling; do **not** assume every one of the 88 is environmental. No Python/native toolchain or assets were installed/changed. This is not a passing suite; re-run and compare the exact failure list on the owner’s supported Mac before release.
- Browser tests — blocked before assertion execution: `npm run test:browser:studio-navigation` exited 2 because Playwright could not find `/opt/google/chrome/chrome`. A dedicated 14-button rendered-navigation test is available for a browser-capable machine. Existing browser test files that intentionally exercise V1/V3/V4 shells request `?debug=1` so normal-shell migration does not erase their test coverage.
- Native — Swift/WebKit not compilable or runnable in this Linux container; source-contract tests are not a substitute for T-803.

## Journey ledger

| Journey | Status | Notes |
|---|---|---|
| J01 first generation | `NOT_RUN` | Real generation not authorized; no browser/native. |
| J02 queued cancellation | `PARTIAL` | Manager fixture verifies never-started queued cancellation; actual two-job queue interaction not run. |
| J03 active stop | `BLOCKED_REAL_WORKER` | No real process stop. |
| J04 unsupported cancel | `PARTIAL` | Unowned durable running job refuses cancellation; no worker-by-worker runtime table. |
| J05 Library → Edit → Enhance | `NOT_RUN` | Source identity round-trip absent. |
| J06 Library → 3D / World | `NOT_RUN` | Source identity round-trip absent. |
| J07 draft/model switch | `PARTIAL` | Version preference migration preserves other browser storage by design; no profile round-trip. |
| J08 14-category nav | `PARTIAL` | Static exact-label assertion only; 0/14 actual click outcomes observed. |
| J09 scroll/input | `BLOCKED_NATIVE` | No native trace. |
| J10 local service/Big Mac failure | `NOT_RUN` | No runtime health fault simulation. |

## Remaining integration conflicts and protected scope

The starting Arena clone was clean, and none of the four historically dirty MacBook paths (`operator-console/publication-recovery.js`, `operator-console/server.js`, `operator-console/tests/publication-recovery.test.js`, `docs/operations/omni-recovery-20261019.md`) were uncommitted here. This patch does touch `operator-console/server.js`; reconcile it manually with any still-unpublished MacBook version before applying/pulling this branch. No canonical images, model files, real jobs, model pins, storage roots, network binds, Tailscale settings, Dock state, or production assets were changed.

## Owner-run acceptance packet (before any release decision)

1. On the owner’s Mac checkout, inspect branch/worktree and preserve the four paths above; compare their exact diffs with this branch. Do not overwrite or rebase unpublished work. Build the app only after source review.
2. In Chrome and the installed WebKit wrapper, launch from a fresh profile and an existing profile. Confirm V2 > Create is the normal landing screen, only the 14 category chips are exposed, every chip activates the intended route, drafts/settings survive the migration, Swap is unavailable with the stated reason, and Video generation is unavailable with truthful System status.
3. Use a synthetic/owned cancellation fixture first. For QUEUED, verify `not_started` and only that item leaves the queue. For RUNNING with no registered owner, verify the endpoint refuses and the lease remains. Then, only with distinct owner approval and a known job-owned test worker, test a supported active stop with exact job/nonce/PID/workdir and post-stop readback; verify publication races and quarantine/reconciliation. Never use broad process kills.
4. Click Create Generate once, inspect the returned job ID, click the separate Cancel job control once, verify the exact request and the server’s `remote_stop`/`remoteCancel` readback, refresh/relaunch, and confirm the UI never reports cancelled without verified stop. Test alert/confirm accept and reject in native WKWebView, plus file picker parity.
5. Run the source identity cases with owned fixture artifacts through Library → Edit → Enhance → 3D/World: valid canonical ID, stale/missing ID, wrong media, moved/staged source, async selection race, preview failure; verify the exact ID and lineage each time.
6. Re-run all documented Node and browser suites on a configured Mac (including optional Pillow/ffmpeg/Blender dependencies); record baseline failures without hiding them. Reproduce the V2 native scroll issue with timestamps, pane node identity, offset, focus/caret and event source before any renderer fix.
7. Have three unfamiliar participants perform the unassisted tasks specified in the blueprint. Record time, misclicks, help, confusion, data loss, and outcomes; do not count the developer or a browser screenshot as human acceptance.
8. Only after source review and owner authorization: build/install through the documented script, read back native source stamp, verify one Dock tile, local-only bind/Tailnet scope, canonical output path and rollback. Product owner must decide whether R1 can ship with Swap/Video unavailable; R2 remains blocked until approved/licensed workers and end-to-end proof exist.
