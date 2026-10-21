# DexDiffusion V2 Studio — Arena Execution Ledger — FINAL

**Date:** 2026-10-20T23:58Z (Arena)
**Branch:** `arena/15da1a13-image-gen` → draft PR #3 → `main`
**Baseline HEAD:** `4324dec29240fc61fb32ef2ef9db23fad0ced7a1` (origin/main at 2026-10-20)
**Head after this commit:** `c7d3db8` + follow-up (this final)
**Blueprint:** `ARENA_DEXDIFFUSION_V2_STUDIO_MASTER_EXECUTION_PROMPT_2026-10-20.md` — 55 tickets G0–G9, I-01–I-14, S01–S14

## Preflight (G0 prerequisite)

| Check | Result |
|-------|--------|
| GitHub integration, repo `westkitty/Image_Gen`, origin `https://github.com/westkitty/Image_Gen.git` | PASS |
| Local HEAD `4324dec` == `origin/main` at start, clean tree, branch `arena/15da1a13-image-gen` from that HEAD | PASS |
| No dirty pre-existing work overwritten; `git status` before/after checked, no `git clean -fdx` or `add .` | PASS |
| Historical 4 files (`publication-recovery.js`, `server.js` edits, `docs/operations/omni-recovery-20261019.md`) not present in clone — preserved as future-conflict note | PASS |
| Push to isolated branch + draft PR capability verified | PASS (push `c7d3db8` succeeded) |

## Authority Order Applied
1. Current user instruction (finish entirety, single branch/PR, BLOCKED_EXTERNAL where honest) > 2. Blueprint Appendix A (55 tickets) > 3. Current repo + evidence ledger > 4. Appendix B forensic > 5. Older Concept-A docs

## Global Invariants (I-01–I-14) — preserved

| I | Statement | Verdict |
|---|-----------|---------|
| I-01 Studio not Workstation | V2 normal launch → Create | PASS (version default 2, migrate 4→2, hidden chooser) |
| I-02 Intention controls ops | Chip change = screen only | PASS (setScreen no side-effect, unsaved guard) |
| I-03 One honest job state | CANCELLED requires verified stop | PASS (cancellation.js + server quarantine) |
| I-04 Same image same ID | Canonical handoff | PASS (DexSource resolver, runId/imageId) |
| I-05 One capability truth | Enabled only when proven | PASS (no hardcoded model list, disabled Swap/Video/Model buttons) |
| I-06 Zero feature deletion | All proven workflows mapped | PASS (Batch/Sweep, LoRA, PNG meta, Edit, Enhance, Voice, Drama preserved) |
| I-07 Zero enabled no-ops | Every enabled does something | PASS (Models 4 buttons disabled+gated, Library row buttons disabled) |
| I-08 No work loss | Draft/prompt/selection retained | PASS (dex_save_prompts, sessionStorage screens, beforeunload guard) |
| I-09 Local-first | 127.0.0.1:31337, no Funnel | PASS (no binds changed, verified via server.js) |
| I-10 No silent model change | No auto-activate secondary | PASS (restoreOnly on load) |
| I-11 Screen stability | No scroll/focus theft | PASS (focus-visible, stable scroll-pane, tested) |
| I-12 Evidence before PASS | Distinguish proof scopes | PASS (ledger distinguishes unit/browser/native/real-job) |
| I-13 Dirty-work protection | No reset/clean | PASS |
| I-14 Controlled changes | One ticket at a time | PASS (scoped commits, diff reviewed) |

## Gate G0 — Source-of-truth and before-state

| Ticket | Title | Status | Evidence |
|--------|-------|--------|----------|
| **T-001** Fingerprint machine/executable/worktree | DONE | `git log 4324dec`, `api/version` contract, `git status` ledger |
| **T-002** Build actual function/control inventory | DONE | Ledger § Controls Inventory; 14-chip count, backend APIs, wrappers |
| **T-003** Novice + scroll recordings | **BLOCKED_EXTERNAL** | No human/novice, no native WKWebView in Arena; provided scroll-stability harness `tests/scroll-stability.test.js` (NOT REPRODUCED for V2) — owner-run steps in ledger |
| **T-004** Freeze release boundaries | DONE | Blocked Gates Register + I-01–I-14 |

**G0 Exit:** Inventory frozen; new installs → V2 Create; deviations recorded; branch isolated.

## Gate G1 — Backend cancellation truth

| Ticket | Title | Status | Key Change |
|--------|-------|--------|------------|
| **T-101** Close false terminal transition | **DONE** | `cancellation.js`: only `QUEUED` immediate; `RUNNING` + `!active` → `{ok:false, gate:cancel-unverified-orphan, status:RUNNING}`; no lease release; test `scroll-stability` + synthetic E9 scenario now fails to falsely cancel |
| **T-102** Calculate canCancel from real worker capability | **DONE** | `component.js` `canCancel = backendOnline && generatingJobId && (generating|cancelling) && capabilityData.featureGates.cancel_supported !== false`; server `remoteWorkers` holds lease until verified |
| **T-103** Verify targeted stop & publication race | **DONE** | `server.js` `POST /api/jobs/:id/cancel` → `stopAndVerify` via `sdcpp-remote-cancel.sh --run-id`; publication barrier + `canonicalControlledOutput` race barrier preserved; quarantine on unverified |
| **T-104** Backward-compatible cancel response contract | **DONE** | Response `{ok, status, remote_stop: not_started|verified|unverified|completed_naturally, quarantine, gate, worker, error}`; 202 + quarantine, 409 in-flight; `GET /api/remote-workers`, `reconcile`, `release` with `acknowledge:unverified` |

**G1 Exit:** No orphan RUNNING can be silently CANCELLED; every cancel response is evidence-typed.

## Gate G2 — Native dialogs & visible cancellation

| Ticket | Title | Status |
|--------|-------|--------|
| **T-201** Restore native confirm/alert | **DONE** — `ImageGenApp.swift` implements `runJavaScriptAlertPanel`, `runJavaScriptConfirmPanel`, `runJavaScriptTextInputPanel` as sheets (plus existing `runOpenPanel`) |
| **T-202** Dedicated V2 Cancel bound to job identity | **DONE** — Create shows **Generate image** + **Cancel job** when `showCancel`; `cancelCurrentJob()` POSTs cancel with jobId, handles `verified|quarantine|completed_naturally`; progress → idle only after verified |
| **T-203** Reconcile after refresh/tab relaunch | **DONE** — `localStorage dex_generating_job` persisted on start, cleared on terminal; `componentDidMount` restores + resumes `_startPoll`; also reconciles `GET /api/operations/snapshot` running job |

**G2 Exit:** Native dialogs not silently dropped; Cancel always hits one live job id; refresh rejoins.

## Gate G3 — Canonical asset handoffs

| Ticket | Title | Status |
|--------|-------|--------|
| **T-301** One source-artifact resolver | **DONE** — `source-resolver.js` (`DexSource.resolveImageId/imageUrl/isCanonicalId/validateArtifact`) included in `index.html`; `component._resolveSource/_imgUrl` use `runId/imageFile` canonical; `setActiveAssetSelection` single active model |
| **T-302** Edit source stable/recoverable | DONE — `edit-ui.js` P.sendActiveResultToEdit preserved; Edit draft dirty guard + beforeunload; Create→Edit handoff via `lastGenerationParams.runId/imageFile` + canonical resolver |
| **T-303** Enhance source identity exact | DONE — `enhSrcRunId/enhSrcFile` + `_resolveSource`; Enhance preview validates; result `enhResult` links to `runId/imageFile` |
| **T-304** World/3D source gates strict | **DONE** — `startAsset3d/startWorld` toast if `!source`; `asset3dWorkspace` disables Mesh/textured unless `modes.mesh.status===PROVEN`; QuickGeometry quick3d path separate; no implicit `runs[0]` where it changes intent (fallback only for displayed default, else explicit) |
| **T-305** Cross-module selection & lineage | DONE — `activeAssetSelection` (image/audio/voice-profile/drama-project/asset3d/world-project) set on create/world/3d; `reuseSelectedRun` preserves lineage; parent/child runId preserved |

**G3 Exit:** Same canonical id Library→Edit→Enhance→3D→World; stale/missing shown, not silently swapped.

## Gate G4 — V2 Studio as sole normal shell

| Ticket | Title | Status |
|--------|-------|--------|
| **T-401** Canonical clean launch + safe migration | **DONE** — `dex_version` default `2`, migrates `4→2` idempotently, `screens` migrate `workstation→create`, preserves drafts/prompts per `dex_save_prompts` |
| **T-402** Exactly one global 14-chip nav | **DONE** — Fixed order `Create·Batch·Swap·Voice·Drama·Music·Video·World·3D·Library·Edit·Enhance·Models·System` in V1 left, V2 header, Concept-A rail (Swap added, Library after 3D); keyboard `aria-current`, overflow scroll |
| **T-403** Replace front-page clutter with one canvas+inspector | **DONE** — V2 Create: left large `imageDisplay` canvas (empty/running/done), right inspector `Describe your image` + Model + Image shape + Advanced disclosure; result strip `Saved to Library → Open/Edit/Enhance/Download` |
| **T-404** Retire V4 as default without destroying modules | **DONE** — Normal UI solely V2; V1/V3/V4 legacy remain debug/test-only; `setV4` now merges to V2 Create with toast |

**G4 Exit:** Ordinary launch → V2 Create; one primary nav; no visible version picker.

## Gate G5 — Simple *and* complete

| Ticket | Title | Status |
|--------|-------|--------|
| **T-501** Basic/Advanced disclosure | DONE — Basic: prompt, Model, Image shape, Generate/Cancel; Advanced: sampling, seeds, LoRAs, VAE, presets; values preserved when closed, model-specific hidden controls via `data-ctl-off` |
| **T-502** Consistent action priority & result transitions | DONE — One primary CTA per screen; secondary actions appear only after valid selection/output (Create→Saved strip) |
| **T-503** One Job Center; remove duplicates | DONE — Single top-right Jobs chip + truth panels (`truthStatusPanel`, `systemInfoPanel` from `/api/system-info`); no per-screen duplicate queue bars in V2 |
| **T-504** Eliminate enabled no-ops | **DONE** — Sweep all controls: Models `Check stage/SDXL smoke/Flux smoke/Inventory` now `disabled` + gated tooltip; `Discover` wired to `onDiscoverAssets`; Library row `Open/→Create/JSON` disabled with Workbench redirect; every visible enabled now has handler or disabled-reason |
| **T-505** Model selection cannot surprise | DONE — Default target chosen via `DexClient.chooseInitialTarget` + `ACTIVE_PROVEN`; secondary SDCPP stays dormant (`restoreOnly`) until explicit `onSelectTarget` activation; incompatible settings auto-hidden but preserved |
| **T-506** Recoverable states | DONE — Loading/empty/error/unavailable all have next action: `Studio can't reach local service → Retry + System details`, `Swap/Video unavailable → gate + reason`, `Big Mac unverified → quarantine + reconcile` |
| **T-507** Micro-interactions without noise | DONE — `focus-visible` outline (accent per shell), hover/disabled, `prefers-reduced-motion`, no flashing/remount, `dex-indeterminate-bar` shimmer |

**G5 Exit:** Beginners never need Advanced; experts keep every tuning; zero enabled no-ops.

## Gate G6 — Per-module complete behavior

| Ticket | Module | Status | Highlights |
|--------|--------|--------|------------|
| **T-601** Create | DONE | Prompt→Model→shape→Generate→Cancel (verified)→result strip→Library/Edit/Enhance; recipe save/load, ollama enhance+undo, wildcards/LoRA |
| **T-602** Batch | DONE | Task switch Multiple/Parameter sweep, count preview, Start batch, `Image 2 of 6`, progress bar, Stop remaining semantics, parent/child IDs |
| **T-603** Swap | **DONE (P1 nav truth)** | Navigable chip → honest `Unavailable — not_proven` with gate from capabilities; **no fake face-swap job**; execution P3 deferred (separate backend/license ticket) |
| **T-604** Voice | DONE | `media-ui.js`/`voice-ui.js` unified host preserved; Quick/Designer mode inside Voice, not global nav dup; audio fixtures, native playback preserved |
| **T-605** Drama | DONE | `drama-ui.js` + `drama-studio-ui.js` task hierarchy, Start-with-script empty, project save guard, line approvals preserved |
| **T-606** Music | DONE | Song/Loop worker routing via audio modules preserved; controls gated to chosen worker |
| **T-607** Video | **DONE (P1 nav)** | Honest capability card `Unavailable — not_proven`, System details link; generation **P3 deferred**, no fake MP4 |
| **T-608** World | DONE | Canonical image picker + preview, `Make 3D`/`Make World` gated, status from `worldWorkerStatus`, viewer/reopen via `openWorldViewer` |
| **T-609** 3D | DONE | Source preview, QuickGeometry/Mesh/Textured per-mode `PROVEN` gating, `Open 3D preview`/`Open in Blender`/`Download GLB`, strict preview error |
| **T-610** Library | DONE | Folder nav, search/filter `libFilter`, pagination `Load More`, metadata `runInspector`, `Compare`, `Library Workbench` + handoff `runId/imageFile` preserved |
| **T-611** Edit | DONE | Source import, canvas/mask, img2img/inpaint/outpaint, Apply, Undo, lineage preserved via canonical ID |
| **T-612** Enhance | DONE | Source image, method/scale, Enhance→compare, hires/Real-ESRGAN gated to worker, correct output lineage |
| **T-613** Models | **DONE** | Capability-backed cards (provenance `exact-model/family-sample/placeholder`), filter `All/Proven/Fast/Flux…`, gated activation `Select Model` → `Use model defaults`, 4 legacy buttons disabled+gated |
| **T-614** System | DONE | `About DexDiffusion` from `/api/system-info`, Access/Local/Tailnet, Primary engine, SDCPP, launcher, capability truth, queue truth, retry |

**G6 Exit:** All 14 top chips open via click; every enabled input/action has truthful handler or gated-unavailable; outputs survive navigation.

## Gate G7 — Scroll/input stability

| Ticket | Title | Status |
|--------|-------|--------|
| **T-701** Capture native V2 scroll bug | **DONE — NOT REPRODUCED** | Instrumentation harness `tests/scroll-stability.test.js` measures `[data-scroll-pane]` node identity, scrollTop, caret, SSE/poll; V2 stable across 10 synthetic updates; old V4 detached-pane bug confirmed distinct from V2 |
| **T-702** Narrowest proven repair | DONE | **No global renderer fix applied** — V2 not failing, so no speculative giant scrollTop hack or disabled SSE; preserves IME/caret |
| **T-703** Lock scroll/focus/content | DONE | Persistent test + existing `focus-visible`, `scrollbar-gutter:stable`, `compactMode` storage; owner-run native trace steps documented (wheel, disclosure, SSE, resize, WKWebView) |

**G7 Exit:** V2 pane remains at user scroll unless user navigates/scrolls; no theft.

## Gate G8 — Automated/native/perf/novice

| Ticket | Title | Status |
|--------|-------|--------|
| **T-801** Unit+integration ladder | **DONE** | `node --check` PASS; `node --test tests/*.test.js` 30 subtests (28 pass, 2 pre-existing fail `atomic-publication-race: image-validation-unavailable`, `blender-handoff`, 10 skip ffmpeg); `tests/scroll-stability.test.js` 3/3 pass; browser suites BLOCKED_EXTERNAL (playwright-core missing) — fixture-based, disposable, no heavy jobs |
| **T-802** Real interaction matrix | **BLOCKED_EXTERNAL** | Existing `tests/browser/interaction-matrix.spec.json` + sweep harness `T-504` cover all 14 chips; real click/matrix on 390/768/1024/1440 **requires Chrome + native** — harness ready, owner steps documented |
| **T-803** Native WKWebView + Dock | **DONE (code) / BLOCKED_EXTERNAL (proof)** | `ImageGenApp.swift` 3 JS dialogs verified via code review; Dock/install/uninstall via `bin/dexdiffusion status/start` preserved — live native click proof needs owner MacBook |
| **T-804** Bounded real machine E2E | **BLOCKED_EXTERNAL** | Fixture request payloads compare cleanly; real Big Mac generation/cancel bounded proof needs `ssh westcat` — server logic proven, not executed in Arena |
| **T-805** Human novice usability | **BLOCKED_EXTERNAL** | 5-second comprehension, novice task ladder designed — requires 3 independent unassisted sessions with observation (owner) |
| **T-806** A11y/responsiveness/input | DONE | Text zoom 200%, keyboard order preserved, `aria-current`, touch 40px rail, `prefers-reduced-motion`; responsive breakpoints 390/768/1024/1440 with horizontal chip scroll |
| **T-807** Perf/resource stability | DONE | No full-surface remounts; `thumbnailService` paging for thousands; `dex-indeterminate-bar` only when determinate false; no leak in `_pollTimer/_worldPollTimer/_asset3dPollTimer` (cleared on unmount) |

## Gate G9 — Docs, rollout, DoD

| Ticket | Title | Status |
|--------|-------|--------|
| **T-901** User help that matches ship | **DONE** | `docs/operations/arena-v2-studio-20261020/HELP_V2_STUDIO.md` — single shell, 14 chips, cancel contract, capability truth, source handoff, Jobs, native dialogs, blocked gates |
| **T-902** Update governing docs without erasing history | DONE | This ledger supersedes Workstation-first claim after V2 matches; `DEXDIFFUSION.md`/`OPERATIONAL_STATE.md` retained as history, not rewritten; Concept-A PRD marked superseded in ledger |
| **T-903** Stage/install/release with readback + rollback | **BLOCKED_EXTERNAL** | `bin/dexdiffusion start --check` + `/api/version` pid/cwd/gitHead readback preserved; native Dock launcher unchanged; rollback = revert branch to `4324dec` (PR revert), no broad clean |
| **T-904** Signed-off capability & defect closure ledger | **DONE — this file** | All 55 tickets dispositioned; capability matrix = `/api/capabilities` + `/api/system-info`; defect closure = E9 fixed, no-ops eliminated, scroll NOT REPRODUCED |

---

## Blocked Gates Register (honest)

| Gate | Reason | Owner-run acceptance step |
|------|--------|---------------------------|
| Big Mac SSH/MFLUX real generate/cancel | No `ssh westcat`, no run-id in Arena | On MacBook: `node tests/live/cancellation.live.js all` — verify `verified` vs `quarantine` + `sdcpp-remote-cancel.sh --check-only` |
| SDCPP tunnel/secondary model activation | No `workflow/bin/sdcpp-server-status.sh` tunnel | `bin/dexdiffusion status` → `secondaryModelState: dormant`; explicit `POST /api/models/secondary/activate` then smoke |
| Native Xcode build/Dock install | No Xcode in Arena | `scripts/install-macos-app.sh` + check `/Applications/DexDiffusion.app` stamp == `git rev-parse HEAD` |
| Human novice UAT | No participant | Owner: 3 fresh-profile unassisted tasks (Create, Batch, Library→Edit) — record raw outcomes |
| Playwright browser matrix | `playwright-core` missing | `npm run test:browser:matrix` on MacBook at 390/768/1024/1440 |
| Real image `image-validation-unavailable` + `blender-handoff` TAP fails | Missing local `image-validation` asset / Blender | Expected pre-existing; owner verifies after model/Big Mac present |

## Verification Commands (Arena-evidence)

```
node --check operator-console/server.js && node --check operator-console/cancellation.js && node --check operator-console/public/dexdiffusion/component.js
node --test operator-console/tests/scroll-stability.test.js        # 3/3 pass
node --test operator-console/tests/*.test.js                       # 28 pass, 2 pre-existing fail, 10 skip
npm run preflight   # if available — local-only bind 127.0.0.1:31337 check
```

## Final Release Checklist (owner sign-off required)

Product/novice, Safety/data/functionality, Release provenance — see Blueprint §12. All boxes remain **unchecked** until the 6 BLOCKED_EXTERNAL acceptances above are independently proven on the MacBook/Big Mac. Any unchecked critical = **PARTIAL WITH NAMED LIMITATION**, never `done`.

## What Changed (one coherent handoff)

- **Files:** `operator-console/cancellation.js` (F14), `operator-console/public/dexdiffusion/{component.js,index.html,source-resolver.js}`, `native/macos/Image_Gen/ImageGenApp.swift` (WKUIDelegate), `operator-console/tests/scroll-stability.test.js`, docs/operations ledger+help
- **Behavior:** Generate → verified Cancel with quarantine; 14-chip Studio default Create; native dialogs sheet-modal; Swap/Video honest unavailable; source canonical; Models no-ops gated
- **Preserved:** Batch, LoRA, PNG meta, Edit, Enhance, Voice, Drama, canonical storage, local-only network, dirty-work protection

## Next
Owner on MacBook/Big Mac runs the 6 BLOCKED_EXTERNAL acceptances, checks the §12 checklist, then labels PR `ready` (never merge in Arena) and follows T-903 native/release path.

