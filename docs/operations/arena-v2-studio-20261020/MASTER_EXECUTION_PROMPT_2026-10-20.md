# ARENA AGENT MODE — DexDiffusion V2 Studio full implementation mission

**Read this entire file before changing code. This is an EXECUTE instruction, not a request to critique, summarize, or rewrite a plan.** It includes the complete controlling 55-ticket blueprint and its supporting forensic report as verbatim appendices. The appendices are source material; the execution rules in this opening section determine how to carry them out in an Arena GitHub sandbox.

**Project:** `westkitty/Image_Gen`  
**Target:** Arena Agent Mode with GitHub repository access  
**Product decision:** **DexDiffusion V2 Studio is the ONLY normal user-facing product shell.**  
**Version of this instruction:** 2026-10-20  
**Desired delivery:** verified changes committed and pushed to **one dedicated working branch** with **one open, unmerged pull request**, a complete execution ledger, and candid evidence of what is still blocked.

## 1. Your mission and required autonomy

Implement the DexDiffusion V2 Studio blueprint end-to-end **as far as the connected repository and authorized test environment can honestly support**. This includes investigating current code, preserving the working product, fixing real defects, replacing the cluttered Workstation-first navigation with the specified simple Studio interface, making enabled actions functional, writing regression tests, and producing a branch that can be reviewed and finished safely on the actual MacBook/Big Mac environment.

**Do not stop after producing a plan, completing G0, fixing one ticket, or making a pretty mockup.** Do not ask the operator to send “next,” “continue,” or one new prompt for each ticket. Run the ticket protocol internally and advance through G0–G9 whenever the next action is safe and the prerequisite code-level test is satisfied. You may create small checkpoints during execution, but continue autonomously rather than treating a progress report as completion.

**Never claim an installed native app, real Big Mac job, worker shutdown, real human novice test, or final release was verified if you only have an isolated Arena sandbox.** Where evidence requires unavailable machines or human participants, finish the code and test harness where safe, mark that specific gate `BLOCKED_EXTERNAL`, push the verified work, and supply precise owner-run acceptance steps. A blocked physical acceptance gate must not be bypassed by a browser screenshot or fixture.

Work like a careful software maintainer, not a concept designer. Make the application easier for an unfamiliar person to use without removing expert functionality.

## 2. Explicit authority and boundaries

This current user request **authorizes**:

- Inspecting the selected repository, creating/reusing **one isolated working branch**, changing its source/tests/docs, running safe sandbox tests and local previews, staging scoped changes, committing meaningful verified milestones, pushing **only that working branch** to its authorized origin, and creating/updating **one** pull request targeting `main` for review.
- Advancing automatically from one safe, verified code-level ticket/gate to the next in this single Arena session.
- Adding focused tests, migration logic, help text, and evidence files required by the blueprint.

It **does not authorize**:

- Pushing to `main` or any default/release branch; merging or closing the PR; force-pushing; rebasing published user work without permission; deleting branches; modifying other repositories; altering real user assets or model files; running cleanup, hard-reset, destructive migrations, or deleting historical files.
- Installing/updating the real `/Applications/DexDiffusion.app` or Dock tile, deploying to an actual MacBook, connecting to Big Mac over SSH/Tailnet, terminating any real worker, starting real heavy GPU jobs, changing network exposure, downloading new models, accepting licenses, or publishing a production release without distinct owner authorization.
- Changing model pins, overriding failed source-identity guards, quietly enabling Swap or Video generation, inventing services, or replacing the local-first stack with ComfyUI or a new framework.

The blueprint predates the present implementation/push authorization. **Where its historical text says “do not commit/push” or “do not proceed past one ticket without separate authorization,” this current section supersedes that restriction ONLY for safe source edits, per-ticket continuation, Git staging, commits, pushes to the isolated branch, and the single review PR.** All original product, data-integrity, worker-safety, privacy, licensing, native/release, and acceptance boundaries remain controlling.

Treat the blueprint's MacBook-specific commands and `/Users/andrew/...` paths as **target-environment facts**, never as paths or services automatically available inside Arena. The Arena sandbox is not the owner's physical MacBook. Substitute sandbox-appropriate read-only checks without claiming you ran native steps.

## 3. Mandatory Git preflight: no edits before branch isolation

1. Ensure Arena's **GitHub integration is ON** and the selected repository is **exactly** `westkitty/Image_Gen`. If no repository access exists, report `BLOCKED_REPOSITORY_ACCESS` and do not substitute a new empty project.
2. Identify the actual Git root, origin, current branch, working-tree status, local HEAD, remote `origin/main`, Git author/push access, and sandbox environment. Verify that `origin` points to the intended repository. Record the full SHA and whether `main` advanced after the blueprint's baseline `4324dec29240fc61fb32ef2ef9db23fad0ced7a1`.
3. **Before editing any tracked file**, work on an isolated branch: preferred name `arena/dexdiffusion-v2-studio-20261020`. If Arena has already provisioned an isolated session branch, use that branch instead and record its exact name. If the preferred branch exists and clearly belongs to a separate workstream, create a distinct suffixed branch; never overwrite it. Do not switch to or edit `main` directly. Establish the branch's true base from fetched `origin/main`; do not silently discard intervening commits.
4. If Arena's branch selection UI must be used rather than a shell command, perform the equivalent through supported tools. If you cannot prove the branch is isolated, **stop before mutation** rather than proceeding on the default branch.
5. Preserve unexpected pre-existing uncommitted sandbox work. Do **not** run `git clean`, `git reset --hard`, `git checkout -- .`, `git restore` on unknown files, `git add .`, `git add -A`, or any forced reset; if isolation from existing dirty changes cannot be established, stop and report a blocker.
6. Important historical boundary: the physical MacBook checkout had **three tracked edits and one untracked operations note** at audit time: `operator-console/publication-recovery.js`, `operator-console/server.js`, `operator-console/tests/publication-recovery.test.js`, and `docs/operations/omni-recovery-20261019.md`. These might **not** be in the remote clone. Do not assume they were committed, erase them in a later sync, or claim they were included. If your changes touch overlapping logic, record the future integration conflict explicitly.
7. Preflight whether the session can **push to an isolated branch** and open a PR without pushing to `main`. If GitHub permissions are insufficient, identify this before expensive work, request the necessary external connection/permission, and preserve any allowed patch/export safely. Do not fabricate commit or push success.
8. Arena supports **one PR per chat**. This mission therefore uses **one branch and one PR throughout**. Open it as a **draft PR** after the first substantial verified milestone if supported, otherwise label it clearly `DO NOT MERGE — native/worker/novice acceptance pending`. Keep it open for the entire session. **Never merge or close it**, as doing so can prevent subsequent session pushes.

Use the GitHub-connected repository as the source-control authority. Do not edit or deploy a user Mac remotely by implication.

## 4. Source authority, inspect order, and anti-hallucination rule

**Order of authority for decisions:**

1. This mission's user instruction and explicit authorization boundaries.
2. **Appendix A** — complete `DEXDIFFUSION_V2_STUDIO_EXECUTION_BLUEPRINT_2026-10-20.md` (all 55 T-tickets, invariants I-01–I-14, exact categories, G0–G9, J01–J10, R1/R2, acceptance conditions).
3. The **actual current repository** for what code, tests, scripts, artifacts, and capabilities exist, with an evidence ledger of discrepancies.
4. **Appendix B** — supporting `DexDiffusion_Reconciled_Repair_Plan_2026-10-20.md` for historical diagnostics, never as a substitute for current code.
5. Older Concept A/Workstation PRDs, prior agent reports, old generated mockups, and old test claims as background only when compatible with the above.

The appendix is a **specification**, not proof that something is implemented. Re-verify factual defects against current code and dynamic runtime composition before patching. For example, media navigation handlers are dynamically added by `media-ui.js` and `drama-ui.js`; the previous claim that the routes are all dead was disproven by actual clicks. Conversely, the base V2 `onGenerate()` reset and the unsafe generic cancellation-manager transition were directly evidenced on the audited version. Treat either as **historical until reproduced on the branch**.

Read in this order, **when the paths exist in the clone**: `DEXDIFFUSION.md`, `OPERATIONAL_STATE.md`, `README.md`, `operator-console/package.json`, `operator-console/public/dexdiffusion/index.html`, `component.js`, `dc-runtime.js`, `media-ui.js`, `drama-ui.js`, `workstation-ui.js`, `concept-a.js`, `edit-ui.js`, `operator-console/cancellation.js`, the relevant `server.js` sections, native wrapper `native/macos/Image_Gen/ImageGenApp.swift`, and directly related tests. The appendix describes other targeted files. Do not start with an unbounded full-repo/vendor/history scan. Expand only if evidence crosses a boundary.

Maintain a `SOURCE_DISAGREEMENTS` section in the execution ledger: claim, source of claim, live observation, current verdict (`VERIFIED`, `CONTRADICTED`, `UNVERIFIED`, `STALE`, `BLOCKED_EXTERNAL`), and implementation consequence. Never average contradictory audits into a compromised design.

## 5. Preserve first: the non-negotiable product contract

### 5.1 Canonical Studio shell

- One normal app: **DexDiffusion Studio**, opening directly to **Create** for fresh and migrating users, never Workstation/Concept A or a version picker.
- **Exactly 14 top-level categories**, **in this exact order**: **Create · Batch · Swap · Voice · Drama · Music · Video · World · 3D · Library · Edit · Enhance · Models · System**.
- Colored, readable, keyboard-operable top chips with restrained category tints, visible active state, and a discoverable one-row overflow strategy for narrow windows. Colors distinguish groups and do not imply a mode works. No duplicate global sidebar or category chips scattered through unrelated screens.
- One large image/result preview and one contextual inspector. First-time Create shows a prompt field, a currently working model if available, image shape, optional valid preset, and **Generate image**. Advanced controls remain behind a clear disclosure and persist their values.
- Exactly one conspicuous **Jobs** entry point and one authoritative Job Center, not multiple conflicting queues or status labels. Every enabled action has a real observable behavior; every unavailable action explains why.
- Novice language: what to type, what to press, what is happening, where the result was saved, how to edit/enhance/download or recover. No wall of technical prose. Users never need to know SSH, lease, MLX, MFLUX, a checkpoint, artifact ID or worker jargon to make an image.

### 5.2 Zero functional loss and honest readiness

Keep the working Batch/Sweep systems, recipes, image-to-image, inpainting, masking, model options, LoRAs, PNG info, Edit variants, Enhance/upscale, World/3D, Voice/Drama/Music, library lineage, status and settings. Before hiding or moving an old button, map it to the new screen, an Advanced disclosure, a contextual action, or explicitly identified unavailable state. **Do not delete behavior because its old presentation was cluttered.**

Swap is a required **destination**, but its exact backend/semantics/license are still unresolved. Video's generation worker was unproven/dormant in the audited state. Both must be honest, useful screens with clear unavailable capability, not pretend generation controls, not dead clicks, and not silently dropped categories. Do not introduce or activate an unapproved face-swap model, license, download, or video worker. Distinguish **R1 stabilization** from **R2 fully realized capability** exactly as Appendix A does.

### 5.3 Safety and state correctness

- A job is **CANCELLED** only after it was proven never started or its actual worker process was verified stopped. A request, local reset, timeout, released lease, or `POST` response alone is not termination proof.
- Running unowned or identity-unknown durable jobs must not transition to false terminal `CANCELLED`. Queued, active, publication-race, retry, and remote-unreachable states must follow explicit, tested transitions. Preserve worker identity/nonce and quarantine uncertain remote state safely; no global process kills.
- V2 Generate while running does not magically become Cancel. Expose a separate true cancel affordance **only if supported**; otherwise show a truthful alternative and actual job state.
- Pass **one exact canonical source asset ID** from Library to Edit/Enhance/3D/World. No fallback to a different recent image, no silent draft overwrite, no guessed filename/ID, no model swap.
- Preserve text/drafts/masks/settings, scroll/focus/caret, user prompt-saving preference, output storage `/Users/andrew/images_made`, provenance/publication rules, loopback `127.0.0.1:31337`, local/Tailnet boundaries, proven model pins and only explicitly selected model activation.
- Do not repair a **V2 scroll issue** by assuming the known V4 shell-remount issue is the same. Reproduce a real V2 triggering path before changing the shared rendering engine.

## 6. How to execute ALL 55 tickets without creating another failed mega-patch

**Process one ticket at a time; execute the entire campaign in sequence.** For each ticket `T-xxx` in Appendix A:

1. Locate its full contract and dependencies in Appendix A. Confirm repo/source/test locations rather than fabricating missing paths.
2. Write the one-sentence user-facing result and protected invariants to the ledger. Assign a status; do not pre-mark it PASS.
3. Verify the stated defect or missing behavior with the narrowest reproduction possible; when appropriate, add a failing-before test. Existing successful code under another module may invalidate the complaint—record `NOT_REPRODUCED`, do not duplicate it.
4. Make the **smallest cohesive implementation** that satisfies that ticket and keeps earlier verified capabilities intact. Preserve proper lifecycle and error states. For missing features, build only what is technically and legally supported.
5. Run syntax/static checks, a focused behavior test, and relevant cross-module tests. For visual changes, perform **actual browser clicks and viewport/keyboard checks**, not just DOM existence. For cross-cutting or release-critical changes, expand to the existing integration/browser/release suites.
6. Inspect changed paths and staged diff. Record exactly what passed, failed, could not run, or changed because the current repository differs from the plan. One primary repair pass plus one bounded corrective pass per ticket; if still broken, mark it `FAILED`/`BLOCKED`, preserve evidence, and do not mask it with a succeeding unrelated test.
7. If the coherent milestone is independently safe and tests pass, stage **only its intended paths**, make a descriptive commit, and push the current **working branch only**. Record the commit SHA and confirm remote branch ref. Do not create empty commits or one cosmetic commit for every test fixture. Bundle closely related ticket fixes into a verified milestone when sensible, without skipping per-ticket evidence.
8. Continue to the next eligible ticket automatically. A blocked native/human/real-worker verification does not prohibit unrelated, provably safe **sandbox-only code**; it prohibits a release PASS, unsupported feature enablement, and actions dependent on the missing proof. A genuine safety regression or unproven branch identity stops dependent implementation.

### Phase/gate schedule and required proof

| Gate | Source tickets | Actual execution obligation | Minimum sandbox proof | What still requires external proof |
|---|---|---|---|---|
| **G0** | T-001–T-004 | Fingerprint clone/branch; capture baseline; inventory dynamic handlers and every control; define protected behaviors and test states. | Actual HEAD/dirty status, observable browser baseline, feature/control ledger, failing-before tests where safe. | Physical MacBook version/Dock stamp and native recording. Record `BLOCKED_EXTERNAL`, not `PASS`. |
| **G1** | T-101–T-104 | Fix cancellation manager, capability projection, job-specific stop protocol, response status, lease/race safety. | Synthetic unowned-running-job negative test plus queued/active/remote-unknown/race/duplicate tests; no fake success. | Actual targeted Big Mac stop proof. Do not enable unverified remote cancellation. |
| **G2** | T-201–T-203 | Repair WKUIDelegate JS confirm/alert contract; implement explicit V2 Cancel; reconnect job status across views/reload. | Swift source consistency/static build if toolchain exists, JS/UI tests with mocked jobs/confirm behavior. | Installed WKWebView dialogs and live stop/relaunch. |
| **G3** | T-301–T-305 | Canonical source resolver and stable Library→Edit→Enhance→3D/World handoffs, stale ID recovery, lineage and drafts. | Tests using canonical IDs, wrong/missing IDs, stale async selection, reload, multiple source images. | Actual relevant worker output where claimed PROVEN. |
| **G4** | T-401–T-404 | Clean V2 launch, migrate old version preference safely, 14 chips, single Studio layout, retire V4 front-facing choice without destroying modules. | Fresh/existing profile real browser interactions, all 14 tab clicks, desktop/compact screenshots, old capabilities retained. | Installed app first-run and Dock behavior. |
| **G5** | T-501–T-507 | Basic/Advanced disclosure; one primary action; one authoritative Jobs surface; every enabled control wired or honestly disabled; no advanced option loss. | Real click inventory across every visible screen/state, setting round-trip, keyboard/focus, explicit error and empty states. | Novice comprehension in real sessions. |
| **G6** | T-601–T-614 | Complete 14 per-module contracts and check actual support per worker; keep Swap/Video truthful if unavailable. | Screen-specific click/keyboard behavior; request/payload tests; artifacts/lineage fixtures; correct readiness. | Real media/model/World/3D outputs and licensing/activation decisions. |
| **G7** | T-701–T-703 | Reproduce exact V2 scroll/focus issue, fix only proven mechanism, protect polling/SSE/typing. | Focus/caret/scroll regression under varied state updates at target viewports. | Native V2 user-path reproduction/fix acceptance. |
| **G8** | T-801–T-807 | Unit, integration, real-click interaction coverage, accessibility, responsive behavior, performance, acceptance kit. | Full relevant automated suites, screenshots/video when helpful, J01–J10 fixture outcomes and blockers explicitly labeled. | Installed WKWebView, actual Big Mac work and **three real unfamiliar people** testing unassisted. |
| **G9** | T-901–T-904 | User-facing help, accurate docs and rollback/installation handoff, capability ledger, source/commit trace. | Reviewed code/docs, one open PR, pinned commit/branch, recorded rollback commands and native instructions. | **Do not install or release** from Arena. Product-owner sign-off, native install/readback and release decision remain external. |

**Critical distinction:** The table defines **implementation progress in the cloud sandbox** versus **full release gates**. G0–G9 cannot be declared fully passed when E4 native, E5 real worker, or E6 novice evidence is unavailable. Continue safe source implementation to completion while recording these release blockers explicitly; never fake them.

## 7. Minimum acceptance tests: these are executable outcomes, not screenshots

Implement or extend tests for the ten J01–J10 journeys in Appendix A. At minimum require:

- **First run:** clean/new account profile enters Studio > Create directly with one simple prompt, valid working default if one is proven, reachable Generate, one Jobs control, and visible result path/next actions; old V4 preference migration does not lose drafts.
- **Navigation:** 14 exact tabs in order; users click (not only invoke `setScreen`) and reach labeled content; keyboard access, active indicator, horizontal overflow and responsive layout. No nested global rail. Voice/Drama/Music/Video handlers are checked after all scripts extend the component.
- **Control inventory:** every visible enabled button and actionable field under default, empty, busy, error, offline, and result states has a real handler and observable behavior. Explicitly check previous inert Models controls (Check stage / SDXL smoke / Flux smoke / Inventory) and other prototype actions. A disabled control gives its reason. No placeholder action that only logs.
- **Cancel truth:** fake/unowned RUNNING job cannot become CANCELLED; no released heavy lease while compute might still be active; queued-before-start semantics differ from active remote; cancel while publishing respects canonical image publication; repeated cancel is idempotent/safe; remote unknown never success-colors; job status persists through navigation/relaunch.
- **Source identity:** one canonical image goes Library→Edit→Enhance→3D/World without changing its ID; changing selection to a second image cannot race in an old source; deleted/missing artifact yields recoverable error and retained draft.
- **Unsupported features:** Swap and Video tab still exist with honest unavailability and actionable next steps; the app never claims an uninstalled/unproven model is ready or suggests clicking a dead Generate control.
- **Usability:** all beginner interactions use clear nouns and verbs; a valid first image path requires no opening of Advanced, system diagnostics or model architecture explanations; experts can still access exact prior settings and preserve them.
- **Scroll/focus:** V2 Create/Library/Edit/Enhance panes do not jump under polling/SSE, typing/caret/IME, source selection, status update and tab navigation; do not generalize V4 remount observation to V2 without a new reproduction. If native-only symptom remains untestable, keep `BLOCKED_NATIVE`.
- **Resilience:** offline/Big Mac disconnected state accurately reflects ability to render without deleting saved work; recovery does not duplicate a heavy job; selected model never changes behind the user's back.
- **Performance/accessibility:** test desktop 1440/1024, narrow 768/390 and extreme ~320 CSS px where feasible; no invisible primary action, overlapping chips, horizontal page overflow, inaccessible dialog, contrast-only state, unstable listener accumulation or permanently mounted enormous Library results.

Use actual repo test entrypoints discovered in `operator-console/package.json`. As of the audit, examples included `npm test`, `npm run test:browser`, `npm run test:browser:matrix`, `npm run test:release`, and related specialized browser scripts; re-inspect them before running. **Do not** run `npm run test:live:cancel` or a test that contacts real workers unless its exact effects and ownership are explicitly authorized. Avoid exposing an external dev-server port or changing durable real data. Use isolated fixtures/stubs where realistic.

For every test, record the executor/environment, command/action, observed outcome and evidence level: `E1` source, `E2` fixture/integration, `E3` browser click, `E4` native WKWebView, `E5` real worker, `E6` actual novice. Never promote E2/E3 into E4–E6.

## 8. Operator-ready execution ledger and checkpoints

Create a compact, durable **project-local** record on the feature branch, e.g. `docs/operations/arena-v2-studio-20261020/EXECUTION_LEDGER.md` (adjust only if the repo has a mandatory existing project ledger). Populate it with:

- target repository/origin, branch, base SHA, latest pushed SHA, Arena sandbox fingerprint, initial dirty state, source blueprint checksum and governing precedence;
- all **55** ticket IDs, owner-visible objective, dependencies, status (`NOT_STARTED`, `IN_PROGRESS`, `VERIFIED_SANDBOX`, `BLOCKED_NATIVE`, `BLOCKED_REAL_WORKER`, `BLOCKED_HUMAN`, `BLOCKED_DECISION`, `FAILED`, `NOT_REPRODUCED`), touched file paths and exact evidence IDs;
- per-gate G0–G9 status distinguishing **code delivered** from **release acceptance**;
- source disagreements and decisions resolved by direct proof; known deficiencies not silently waived;
- every milestone's staged file list, command/test results, commit SHA, remote readback; PR link/status when available;
- R1 vs R2 feature scope and capability truth for each screen/worker;
- J01–J10 journey results, with `NOT_RUN` where real users/hardware are needed;
- external blockers and exact unambiguous steps for owner or next agent;
- next executable ticket(s) and how to resume from the branch without relying on this chat.

Use source-controlled documentation with concise, factual entries, not chat transcripts or giant log dumps. If the repo has an existing project Bible/Operational State convention, read and **append/reconcile** relevant entries without overwriting previous history. Preserve old Workstation/Concept A docs as history but update their “current direction” references to V2 where appropriate.

Commit/push **at verified milestones**. Suggested commit classes: `fix(jobs): ...`, `fix(native): ...`, `fix(assets): ...`, `feat(studio): ...`, `test(studio): ...`, `docs(studio): ...`. Actual granularity follows tested seams, not arbitrary phase numbering. Before *each* commit: `git status`, inspect diff, stage explicit paths, inspect `git diff --cached --name-status`, `git diff --cached --check`, ensure no secrets, test affected behavior, then commit with a truthful message. **No `git add .`**. Push explicitly to the feature branch and verify upstream SHA. If a push or PR action fails, report that exact state; do not say “pushed.”

Use a **single PR** from the Arena working branch to `main` with: summary, governed blueprint link/path/sha, verified milestones, test matrix, unverified native/worker/novice gates, screenshot evidence as available, and an explicit **DO NOT MERGE / PRE-RELEASE** warning until the owner's remaining checks pass. Do not merge/close the PR within this Arena session. Arena's single-PR-per-chat behavior is a real workflow constraint.

## 9. Stop, recovery and carry-forward rules

**Stop the dependent work immediately** for: wrong repo/branch/remote; unable to isolate dirty work; malicious or secret-bearing source; cancellation state change without process proof; data-corrupting migration; unsupported model activation or license uncertainty; discovered public exposure; unavailable required authorization; test failures that put existing jobs/assets at risk; accidental changes outside the authorized source envelope. Do not resolve by deleting history, bypassing tests, hiding failed UI, returning to Workstation, or claiming success.

If one ticket's **external** proof is unavailable, do not waste the whole session repeatedly attempting a Mac-only action. Mark the exact test blocked, implement independent code-safe work, and leave a deterministic native/real-worker/human acceptance packet. For a **local code defect**, perform one targeted repair pass after the initial implementation; if it still fails, stop the affected dependency chain and state the earliest failure. Continue unrelated safe tickets only if their evidence and code seams are independent.

If the session is close to exhausting its working context or must end unexpectedly: finish the current *safe* commit boundary, push verified work to the same branch, update the on-branch ledger with last completed ticket, in-progress file list, failing checks, exact next action, current branch/HEAD/upstream, and unrun gates. Never fabricate future continuation or claim an automatic background session.

## 10. Final report contract — no declaration of victory without evidence

At the end, produce a concise but complete delivery record using these exact headings:

1. **Repository / branch / base / remote head:** exact names and SHAs; was the branch actually pushed? PR URL and whether it remains open.
2. **What actually changed:** top user-visible behaviors, per-gate/ticket coverage, files touched.
3. **What was independently tested:** commands/visible click checks and observed results, grouped E1–E6; screenshots/preview links only if actually generated.
4. **What is BLOCKED or NOT RUN:** native WKWebView, Big Mac stop/render, three unassisted newcomers, unresolved Swap/Video, missing tools/permissions and any failed tests.
5. **Feature truth:** every one of the 14 tabs is functional, honestly unavailable, or blocked; R1/R2 readiness must be explicitly distinguished.
6. **Safety/data preservation:** status of cancellation proof, output location/source IDs, saved drafts and local-first boundary.
7. **Next precise actions for the owner:** smallest safe steps to test native, merge/resolve dirty Mac changes, approve worker tests, conduct novice study, and eventually review/merge PR.

**Completion vocabulary:** `IMPLEMENTED_AND_VERIFIED_IN_ARENA` applies only to tests actually run in the Arena sandbox. `BLOCKED_NATIVE`, `BLOCKED_REAL_WORKER`, `BLOCKED_HUMAN`, and `BLOCKED_DECISION` are not PASS. `PUSHED` requires observed upstream SHA; `PR_OPEN` requires a real returned PR link. **Never say “project fixed,” “ready to ship,” “fully functional,” or “release complete” while any required acceptance gate remains unproven.**

**Begin now:** verify GitHub repository and isolated branch; read the controlling appendix and current source; perform G0; write the ticket ledger; then implement G1 onward as far as evidence permits. Do not substitute another broad plan for execution.

---

<!-- BEGIN APPENDIX A: COMPLETE ORIGINAL SOURCE BLUEPRINT; PRESERVED VERBATIM. -->
# DexDiffusion V2 Studio — Zero-Loss Repair & Beginner-Usable Release Blueprint

**Planning baseline:** 2026-10-20  
**Document version:** 1.0 / implementation planning, **not** a claim of completed repairs  
**Intended readers:** Andrew (product owner), a developer/Codex operator, a designer, a first-time tester, and a future AI entering the project cold  
**Project:** `westkitty/Image_Gen`, local checkout `/Users/andrew/Image_Gen`  
**Core decision:** **V2 Studio is the product.** V4 Workstation/Concept A is **not** the default product direction.  
**Working rule:** Do not trade away a functioning capability just to make a screen look simpler. Keep the capability; relocate it to the appropriate task or Advanced disclosure.

> **This document is an implementation specification, not execution authorization.** No repository edits, Dock updates, model downloads, backend installations, generation jobs, cancellation tests against real workers, commits, or pushes are implied. Work must be performed and independently verified ticket by ticket, then accepted through both automated and actual human use.

---

## 0. Start here — what “finished” means

DexDiffusion is finished for this release only when a person who has **never** heard of MFLUX, stable-diffusion.cpp, model architectures, SSH, a lease, a checkpoint, or an image ID can open the Mac app and successfully perform ordinary tasks **without another person explaining the UI**. Expert controls must remain available, but the novice must not be confronted with them before needing them.

The core first-use task is:

1. Open **DexDiffusion Studio** from the Dock.
2. See the **Create** screen, not Workstation, a version selector, or an empty project setup.
3. Read a simple prompt field with a working default model already chosen when one is available.
4. Enter an image description and choose an image shape or use a sensible default.
5. Press **Generate image** and see one clear progress state.
6. If supported, press **Cancel job** and receive an accurate result about whether the **actual compute process** stopped. If not supported, learn that *before* starting or see a truthful Stop-after-current/unsupported status.
7. See the result, where it was saved, and the next actions: **Open in Library**, **Edit**, **Enhance**, **Download**.
8. Navigate elsewhere without losing a draft or being silently kicked to the top of the screen.

**Release blocker:** If any enabled button silently does nothing, if a job is represented as cancelled without verified termination, if a canonical source image silently changes, or if one of the core tasks requires a private explanation, the release fails.

### 0.1 Evidentiary starting point — verified versus unverified

| Claim | Status on the audited 2026-10-20 baseline | Why it matters |
|---|---|---|
| `main` HEAD `4324dec29240fc61fb32ef2ef9db23fad0ced7a1` | Observed in live MacBook checkout | Re-establish before edits; never assume this is still current. |
| Native app source stamp and served HTML/JS match current checkout | Verified at audit time | Avoid editing the wrong project copy. |
| Four working-tree edits exist | Verified at audit time | Preserve exactly: `operator-console/publication-recovery.js`, `operator-console/server.js`, `operator-console/tests/publication-recovery.test.js`, `docs/operations/omni-recovery-20261019.md` (untracked). |
| Fresh profile opens V4 Workstation | Verified in clean Chrome profile | Must become V2 Create. |
| All 13 existing V2 destinations can be *navigated to* | Verified with actual browser clicks | Preserve routes. This does **not** prove all functions inside them. |
| Media navigation is dead because `component.js` does not name its handlers | Contradicted by live test | `media-ui.js` and `drama-ui.js` extend `renderVals` after the base file loads. Do not implement bogus duplicate handlers. |
| V2 Generate button cancels actual work | Contradicted by source | It can reset local polling/state while remote work continues. |
| Generic cancellation truth is safe | Contradicted by synthetic in-memory test | An unowned `RUNNING` durable job was marked `CANCELLED` with no termination proof. |
| V2 Models includes inert enabled buttons | Verified on live page | Check stage, SDXL smoke, Flux smoke, Inventory were examples. |
| V4 scroll pane remount/reset occurs on state update | Reproduced in Chrome | V4 is not the canonical UI; do not generalize to V2. |
| Routine V2 seed/state/poll update resets the scroll pane | Not reproduced in controlled settled test | Investigate the *actual* native interaction path before touching rendering core. |
| Voice, Drama, Music and Video routes exist | Verified navigation | Each operation and its worker capability still needs its own proof. Video generation has been represented as not yet implemented. |
| Every model, Edit, Enhance, World, 3D handoff works | Not established by navigation | Real source identity, worker, job, and artifact-path tests required. |
| Native WKWebView JS `confirm` / `alert` work | Source evidence argues against it; native interaction not tested | Native `WKUIDelegate` was observed with file-open handling, not relevant JS-dialog delegates. Prove via native test. |

**Evidence authority:** live identity/runtime/filesystem and actual user journeys > reproducible tests and raw code > operational ledger and operator guide > dated agent reports and historic design notes. A test passing on Chrome is **not** a native WKWebView or Big Mac runtime acceptance test. A model card reading “available” is **not** a completed-generation proof.

### 0.2 Conflicting history that must not silently govern

- `docs/concept-a/DEXDIFFUSION_CONCEPT_A_PRD.md` documents a Workstation-first direction. It is retained as design history, not allowed to override this later, explicit V2 Studio product decision.
- The existing browser interaction matrix covers broad layout and fixture behavior, but a `setScreen()` exercise is not proof that people can click every action to completion.
- Some earlier model research listed models as *staged* although later operational evidence recorded successful model runs. Re-check local evidence instead of reverting proven targets or redownloading them.
- **Swap** is a requested top-level destination, but the exact operation, permitted model/license, and backend were not proven in the audit. Navigation can be designed; generation **must remain unavailable** until the user defines the operation and it passes compatibility, legal/license, and runtime gates. Do not misrepresent width/height swap as the promised Swap capability.

---

## 1. Unbreakable scope and product invariants

**I-01 — Studio, not Workstation:** The ordinary app launches into V2 Studio > Create. V1/V3/V4 research shells may remain behind developer-only access during migration, but no visible first-run version-picker, Workstation home, hidden forced workspace choice, or duplicated side navigation.

**I-02 — User intention controls operations:** Selecting a chip changes the screen. It does not start a compute job, activate a model, overwrite a draft, change the active source image, or delete history.

**I-03 — One honest job state:** A UI string saying `Cancelled` requires evidence of verified stop (or a job proven never to have started). A local state reset, accepted request, network timeout, or released queue lease never counts as actual remote termination.

**I-04 — Same image, same ID:** The selected canonical image travels unchanged between Library, Edit, Enhance, 3D and World. Use canonical artifact identifiers resolved by the server; do not guess an ID from a filename or localStorage record.

**I-05 — One capability truth:** Features, models, settings and actions are enabled only when the actual selected worker, model, backend and relevant source are capable. A dormant worker stays dormant; no optimistic “ready” labels.

**I-06 — Zero feature deletion:** Every currently proven workflow, including Batch/Sweep, prompt recipes, LoRA/model controls, PNG metadata, source masks, inpainting, img2img, upscaling, multi-step Edit, audio workflows, image lineage, debugging and test-only utilities, is mapped to its new home or explicitly identified as unsupported/unknown. Hiding a control is allowed; silently removing its function is not.

**I-07 — Zero enabled no-ops:** Every visible enabled action has one verified reaction: navigation, state change, file selection, API call, download, a dialog, or a concrete and accessible error. Disabled actions have an explanation and a path to fix/unlock when practical.

**I-08 — No work loss:** Preserve prompts, recipes, active image selection, mask edits, draft parameters, task state, unsaved-confirmation behavior, and progress after permissible navigation/reloads. Respect `dex_save_prompts`—do not newly persist private prompt text without opt-in.

**I-09 — Local-first boundary:** MacBook remains the UI/control and durable image storage machine; Big Mac remains the heavy compute worker. Preserve loopback `127.0.0.1:31337`, documented local-only / Tailnet ingress, `ssh westcat`, canonical `/Users/andrew/images_made`, model pins, authorized staging, provenance and publication receipts. Never enable public Funnel, broaden network binds, or alter unrelated DEX//REACH services.

**I-10 — No silent model changes:** Preserve proven FLUX.2 Klein 4B MFLUX operation and SDCPP options. On clean first use, prefer an existing `ACTIVE_PROVEN` primary target if available; never auto-activate an unproven secondary model or download one without user action. If no model can run, show an honest recovery screen, not a false Generate button.

**I-11 — Screen stability:** Scrolling, typing, focus, selection, and keyboard handling remain stable during polling, SSE events, model capability refresh, resize, job progress and tab transitions. Do not "fix" by freezing all refreshes.

**I-12 — Evidence before PASS:** A screenshot alone proves appearance. A unit test proves only its isolated contract. A browser click proves navigation. Native usability and real remote cancel/render need their own narrowly authorized proof. No report may blur these distinctions.

**I-13 — Dirty-work protection:** Existing uncommitted files, projects, library assets, models, staging, caches and production outputs are protected. No `git clean`, `git reset --hard`, mass movement, overwrites or deletion under this program.

**I-14 — Controlled changes:** One coherent ticket at a time, one behavior change per patch where possible, clear checkpoint/diff boundaries, narrow tests, then wider regression. Do not commit or push unless separately authorized.

---

## 2. The new user's mental model (must be legible without training)

The app is a **studio of creative activities**, not a resource manager, terminal, backend dispatcher, server dashboard or workspace shell. A nontechnical person should be able to answer four questions at all times:

1. **Where am I?** A labeled top chip and obvious page heading.
2. **What can I do here?** One dominant primary button and a small number of task-relevant inputs.
3. **What is happening?** A plain-language status, real progress if available, and truthful job controls.
4. **Where did my work go?** A visible result or an honest empty/error state; durable outputs appear in Library, with concrete next actions.

### 2.1 First-load contract

- Window title/brand: **DexDiffusion Studio**; keep existing Dexter identity, icon and native app wrapper.
- Selected chip: **Create**.
- On the left: a large result/preview canvas showing `Your image will appear here` before the first job—not a fake demo image or noisy technical drawing.
- On the right: **Describe your image**, **Model**, **Image shape**, optional **Quality preset**, and **Generate image**. Make a sane default selection when supported.
- Display a small, unobtrusive **Advanced settings** disclosure. The user must never have to open it for an ordinary first render.
- A single, persistent **Jobs** control in the top-right shows concise truthful state, e.g. `Ready`, `Running 1`, `Waiting 1`, or `Check required`, and opens one Job Center.
- No huge help wall, giant diagnostic log, multiple queue bars, sidebar competing with top chips, or text explaining internal architecture.
- On a successful job, the preview displays the saved canonical image and actions **Open in Library**, **Edit**, **Enhance**, **Download**. Do not show “Save” if saving is already automatic; display `Saved to Library` instead.
- If the service is unreachable: show `Studio can't reach the local service` plus **Retry connection** and **Open System details**. Preserve the current draft. Do not erase the stage or give a misleading Ready label.

### 2.2 Spatial specification (desktop concept, not a demand to rewrite the renderer)

```text
DEXDIFFUSION STUDIO                                   [Ready / Jobs]
[Create] [Batch] [Swap] [Voice] [Drama] [Music] [Video] [World] [3D] [Library] [Edit] [Enhance] [Models] [System]
-------------------------------------------------------------------------------------------------------------
  CREATE                                     |  DESCRIBE YOUR IMAGE
                                             |  [ multiline prompt                        ]
  [Large preview and image canvas]           |  Model           [working model  v]
  [Empty / running / error / actual result]   |  Image shape     [Square v]
                                             |  Quality         [Balanced v] (only if valid)
                                             |  [Generate image]  [Cancel job when supported]
                                             |  Advanced settings ▸
                                             |
  Saved to Library · image details           |
  [Open in Library] [Edit] [Enhance] [Download]  (appear when valid)
-------------------------------------------------------------------------------------------------------------
```

- The preview and primary action are the visual anchors; static descriptions are subordinate.
- Only one parameter inspector is visible for the active activity. No persistent Workstation side rail. Avoid nesting a second product-navigation rail inside a tab.
- Context actions operate on the selected image, clip, voice, track or project **without silently changing its identity**.
- A mode switch inside a tab (e.g. Voice: `Quick`/`Designer`) is allowed when it controls *that task*, not when it duplicates global navigation.

### 2.3 Top navigation: exact 14 destinations

**Fixed semantic order** (not sortable by code or worker availability):

`Create · Batch · Swap · Voice · Drama · Music · Video · World · 3D · Library · Edit · Enhance · Models · System`

- Chips are real buttons or a semantically correct tablist; each has visible text, keyboard focus, and an active state (`aria-current`/`aria-selected` appropriate to chosen pattern).
- **Colors communicate grouping, not permission or success.** Four restrained category palettes: image production (Create/Batch/Swap/Edit/Enhance), sound (Voice/Drama/Music), moving/3D (Video/World/3D), library/operations (Library/Models/System). Each chip retains a distinguishable tint; labels remain legible, active chip has more than a color change. Exact token values must be validated against contrast, not simply guessed.
- This is the *only* primary navigation row. No duplicate category chips throughout panels, secondary global side rail, or topbar Jobs + rail Jobs + queue bar.
- Desktop: preserve order and one row. When width is insufficient, allow horizontal chip-row scrolling with visible end affordance/arrow and keyboard support; do **not** wrap into a multilevel chip waterfall. A labelled **More categories** menu may be used at narrow widths, retaining keyboard access and a clear active-location label. It is not a new category hierarchy.
- Tab changes preserve per-screen drafts and appropriate scroll; reject unsafe navigation only when there are genuinely unsaved changes, via a functioning native/in-app confirmation.
- Swap and Video remain navigable even when their **execution** is unavailable; tab content must truthfully explain capability instead of doing nothing.

### 2.4 Responsive behavior

| Width/surface | Layout rule | Never allow |
|---|---|---|
| Mac desktop wide (e.g. 1440–1920 CSS px) | Preview left; inspector right, roughly 320–380 px; all 14 categories accessible on a single top rail | 2+ stacked global nav rows, duplicate nav, overlapping footer/actions |
| Mac medium (e.g. 1024–1280) | Preview flexible; inspector compresses to min readable width; chip strip scrolls | Truncated chip names without tooltip, hidden primary CTA |
| Narrow split view / tablet (e.g. 768–1023) | One main column; inspector as visible section below or reachable by `Controls` tab; current image stays anchored | Inspector squeezed to 200px or competing with a nested vertical nav |
| Phone/PWA-like (e.g. 390–767) | Single column; prompt + Generate accessible, preview visible, top category overflow/scroll discoverable | Horizontal page-wide overflow, tiny buttons, only icon navigation |
| 320-ish extreme viewport | Graceful legible fallback; vertical content scrolling only; no field cropping | CTA or Cancel inaccessible, inaccessible overlays |

All viewports must retain text zoom, keyboard order, touch-size adequate controls and reduced-motion parity. These widths are **proposed test breakpoints**, not assertions about current CSS.

### 2.5 Visual/copy rules

- Use one heading per screen; section headers communicate tasks (`Image settings`, `Source image`, `Recent results`), not architecture labels (`resource class`, `orchestrator`, `checkpoint loader`).
- Prefer `Generate image`, `Choose image`, `Use this image`, `Cancel job`, `Open in Library`, `Try again`, `Show advanced settings`, `Connection details`.
- Never use a success-color chip to represent mere API acceptance. `Cancelling…` must not be green `Cancelled` before verified stop.
- Primary button: one per major screen. Secondary actions become visible when the relevant item/result exists. Destructive/irreversible actions require explicit confirmation naming the target.
- Empty states explain the next action in one sentence and a button; errors explain what failed and what the person can do now. Technical information is one expandable **Details** below the plain-language message.
- Small explanatory text must never be required reading to operate the app; provide `?` help/tooltips or a collapsible **What is this?** for technical terms.
- Preserve a low-density but capable expert path: a clearly labelled Advanced disclosure, not an entire separate “advanced UI version.”

---
## 3. Screen-by-screen functional contracts (14 top chips)

Every screen follows the same **location → purpose → inputs → primary action → status → output → next action** structure. Internal worker flags and raw IDs can be found in advanced detail panes, not spread across the initial screen. A screen without a working capability must still be an intelligible destination, not a clickable black hole.

### S01 — Create

**User intent:** “I want to make an image from words.”

**At first sight:** large preview, `Describe your image` textarea, `Model` selector showing a capability-backed selection, `Image shape` with Square/Portrait/Landscape plus Custom in Advanced, and **Generate image**. Optionally a simple `Balanced / Fast / Detailed` control **only when its mapping is valid for the chosen model**. Do not show irrelevant CFG/negative prompt controls for a model where the backend does not support them.

**Advanced only:** actual target-specific sampler/scheduler, steps, guidance/CFG, seed, exact dimensions, negative prompt, LoRAs, VAE, ControlNet or reference conditioning, wildcard tools, styles/recipes, advanced image scripts and model-specific warnings. Preserve existing prompt/recipe functionality; one disclosure per logical group, with no feature duplication.

**Behavior:** input is retained when changing screen; generate validates prompt, dimensions, compatible selected target and resource availability. It creates exactly one tracked job ID, shows stage/ETA only if evidence-backed, and provides **Cancel job** only if worker-specific safe termination is supported. If a job is queued, use `Waiting for Big Mac` and a truthful queue-cancel action. After success show actual canonical image and targeted next actions. After error show an understandable message and Retry (without silently changing model/settings).

**Must test:** no model available; one proven primary model; selected secondary model requiring explicit activation; incompatible settings auto-hidden/disabled but preserved when switching back; empty prompt; two fast clicks; backend restart; batch quantity where supported; long prompt without caret jump; successful canonical output and matching stored metadata.

### S02 — Batch

**User intent:** “I need several images or a controlled comparison.”

**At first sight:** a task switch *inside Batch* (e.g. `Multiple images` / `Parameter sweep`), a clearly visible count/plan preview, a primary **Start batch**, progress `Image 2 of 6`, and **Stop remaining** when supported. Show estimated workload only when calculable from validated settings; avoid presenting empty spreadsheet-like controls on load.

**Advanced only:** X/Y/Z plot axes, prompt matrix, variation seeds, batch-specific sampler/resource options, schedule/order, concurrency settings only if truthful and safe under the heavy compute lease.

**Behavior:** a batch owns individually identifiable child jobs and one parent status. Cancel/Stop remaining must explain what happens to the currently running child; successful completed images remain saved and usable if a later child fails. A failed image does not silently erase the batch. Restarts reconcile existing jobs; do not rerun completed cells without an explicit Resume/Retry decision.

**Must test:** batch with invalid count; duplicate submit; partial completion; worker unavailable; wait-for-lease; queued cancel; stop remaining; resume; 1, 2, 20-item bounded fixture; image count and canonical output manifest.

### S03 — Swap

**User intent:** “I want to replace or exchange some content in an image.” **Exact scope is a product-decision gate**, not yet proof of a working face-swap engine.

**At first sight:** page heading `Swap`, one clear sentence describing its *current* status, and `This tool isn't enabled yet` if no permitted verified backend exists. The rest of the studio remains usable. Do not give a functional-looking **Swap faces** or **Start swap** button that cannot do what it says. No installation prompt which secretly downloads large models.

**Gate before implementation:** confirm whether `Swap` means a face/identity swap, subject replacement, two-image element swap, or other editing workflow; identify the exact licensed backend and image-input requirements; check security, consent and capability boundaries; validate runtime on the existing Apple Silicon stack; explicitly select when/how outputs become canonical. Neither aspect ratio exchange nor ordinary img2img may be passed off as Swap.

**Must test (until enabled):** navigation works, status accurate, no remote compute request, unavailable CTA disabled with visible explanation, keyboard navigation and other tabs unaffected. **When activated later:** source/target preview, preview-before-run, cancellation truth, output provenance, and non-confusing result comparison become a separate implementation gate.

### S04 — Voice

**User intent:** “I want spoken audio, or I want to work with a voice.”

**At first sight:** approachable `Text to speech` / `Voice tools` task options according to installed, actually available capabilities, plain text entry, voice choice, **Generate speech** or actual task-specific button, listenable result, and download/save indication.

**Advanced only:** voice-specific settings, reference voice, style, conversion, voice-design features, embedding/technical parameters that the actual selected worker supports. Keep quick and designer modes inside Voice rather than global category duplicates.

**Behavior:** selected worker and voice availability determine controls. No synthetic `Cancel` if the running worker explicitly declares `cancel_supported:false`. For such a worker, state `This job can't be stopped after it starts` before submission, and provide **Stop after current** only if that is an actually implemented queue policy. Import and reference errors name the failing file/source and let the user recover.

**Must test:** route and actual form, voice model unavailable, empty text, source upload rejection, job queued/running/complete/error, saved audio playback and download, audio focus and keyboard navigation, long text, and worker-limited cancellation messaging.

### S05 — Drama

**User intent:** “I want to make a spoken scene with characters and parts.”

**At first sight:** `Create a drama`, list of recent projects, a simple `Script` entry/import, visible character/voice assignments when required, and a primary `Prepare scene` or task-valid **Render scene**. Keep the current project/line in context; do not land on orchestration logs.

**Advanced only:** casting variants, line-level direction, performance controls, speaker previews, multiple takes, render/resume rules, and assembly/export settings.

**Behavior:** draft script changes, per-line artifacts, progress and final assembly are distinct states. `Render project (resume)` must not duplicate already verified finished lines. Reject invalid voice bindings with a plain-language error. Preserve approvals and human adjustments after reload. Project output must be listenable and exportable through canonical storage.

**Must test:** new script, save/reopen, line assignment, invalid voice, line render in fixture mode, resumed mixed-success project, pause/stop truth, export integrity, unsaved confirmation, keyboard and long scripts.

### S06 — Music

**User intent:** “I want to create a song or a short musical loop.”

**At first sight:** `Song` / `Loop` modes only when available; prompt and optional lyrics when supported; duration/style options appropriate to selected worker; one **Generate music** primary action; player, metadata and Download after success.

**Advanced only:** ACE-Step/Magenta-specific configuration, generation steps, references, sections, additional control for an actually supported music worker. Never apply generic image sampler/CFG controls to music.

**Behavior:** worker availability drives the choice. Music jobs enter the same single global Job Center, but use truthful audio stages and cancellation. On completion, the artifact is stored and shown in Library without pretending it is an image. If only one worker is installed, don't show unusable competing presets as if they worked.

**Must test:** long lyrics, no model, incompatible duration, worker busy, audio playback, download, failure, user interruption/recovery where supported, save and return.

### S07 — Video

**User intent:** “I want to make a video.”

**Current truth:** the inspected V2 Video page stated `Video generation is not implemented yet` and described a planned/dormant LTX worker. **Keep the category visible, not falsely executable.**

**At first sight:** `Video` and concise actual availability. If no verified generator, `Video generation is not available on this installation` with **View system status**; do not show a fake timeline or a Generate control that returns no operation. Existing video artifacts, if present, may be browsed through Library without implying generation works.

**Activation gate:** approved backend, exact model, input image/video capability, local hardware fit, file storage, progress, cancel semantics, duration, memory budget and actual MP4/WebM proof through the intended route.

**Must test:** no enabled generation on unsupported state, no fake progress, truthful worker state and keyboard route; eventual functional mode requires the same end-to-end proof as Create.

### S08 — World

**User intent:** “I want to create or explore a world from an image.”

**At first sight:** `Choose a source image` from canonical Library or valid current result; thumbnail; short explanation of the available world mode; one valid **Create world** / **Open world** action.

**Advanced only:** world generation stages, resource controls, viewer settings and technical logs.

**Behavior:** show source identity and preview, not an arbitrary fallback to the latest old run. If an old reference disappeared, the UI explains and offers **Choose another image**. A running world job appears in the same Job Center; finished world/project appears under an identifiable, retrievable record. Distinguish “viewer available” from “generation available.”

**Must test:** no image, valid image, stale ID, background generation, wrong output type, project reopen, viewer load error, model unavailable, cancelled/uncertain state, next-action clarity.

### S09 — 3D

**User intent:** “I want a 3D object from a picture.”

**At first sight:** one selected canonical source image + live thumbnail; clearly named modes such as `Quick 3D`, `Mesh`, and `Textured` **only where supported**; primary **Create 3D model**; result preview/download when proven.

**Advanced only:** mesh resolution, processing options, texture/paint details, GLB validation, source/model provenance.

**Behavior:** invalid source always disables all applicable start modes, including Quick3D; do not use stale `runs[0].imageFile` as a silent substitute for an explicitly selected image. Validate image identity and existence server-side before asking Big Mac to work. If PBR/texturing is unavailable on the 32 GB worker, state why rather than drawing an apparently broken button.

**Must test:** empty Library, stale image, explicit canonical image, preview 404, Quick3D validation, worker capability transitions, source switching, job output and loadable 3D file, GLB not just file existence.

### S10 — Library

**User intent:** “Where are the things I made, and what can I do with them?”

**At first sight:** folder-first browsing consistent with existing recent work, thumbnails/media-type indicators, search/filter if truly implemented, and a straightforward selection/preview area. Do not show four contradictory libraries or multiple duplicate Reload actions.

**Context actions when selected:** **Open**, **Edit**, **Enhance**, **Use for 3D**, **Use for World**, **Compare**, **Download**, **Show details**—each conditionally shown or accurately disabled for the selected artifact type and implementation state. For audio, show Play rather than image-specific controls.

**Advanced only:** PNG metadata, seed, lineage, raw job/worker metadata, bulk actions, import/export details, provenance/diagnostics.

**Behavior:** preserve canonical IDs, folder navigation, pagination, large-library performance, keyboard selection, filtering, and an explicit empty state. Avoid reading/storing private prompt text if prompt saving is off. Selection must not silently start an edit job. Downloads must refer to actual durable files.

**Must test:** zero images, hundreds/thousands fixture records, folder navigation, filters, selection, compare, inspect, open full resolution, download, stale item, incorrect thumbnail MIME, use-as-source handoff, zero unbound card action buttons.

### S11 — Edit

**User intent:** “Change an existing image.”

**At first sight:** `Choose image` or preserved valid source; large image preview; task selector `Change image` / `Inpaint an area` / `Extend canvas` (use actual product vocabulary); prompt and one primary **Apply edit**. Mask paint controls appear only when Inpaint is selected.

**Advanced only:** denoise, seed, sampler, mask feathering/invert, scripts, image conditioning and any truly supported target-specific detail. Restore all currently working img2img, inpaint, outpaint and related pipelines; do not turn Edit into a single generic prompt box.

**Behavior:** drafts and masks are preserved. Invalid old image references must not repeatedly auto-open on every mount. If a file disappears, show `Source image could not be found` and **Choose another** while retaining unrelated unsaved work. `Use output as new source`, `Return to original`, `Undo`, and `Save output` must have clear identity semantics and correct lineage.

**Must test:** import, selection from Library, valid/stale source, masking with pointer and keyboard alternate, editing with prompt, chain result, return to original, async stale source race, model incompatible with edit operation, failures, undo, preservation through tabs.

### S12 — Enhance

**User intent:** “Make this image larger or improve its details.”

**At first sight:** source thumbnail + name; a simple `Upscale` / `Improve details` choice only where backed by proven capability; selected scale/quality; **Enhance image** and result compare/download.

**Advanced only:** Real-ESRGAN model selection, hires-fix parameters, resampling method, optional detailer and exact worker-specific controls. Existing proven image and prompt enhancement features remain accessible in their correct contexts; distinguish **Enhance image** from **Improve prompt**.

**Behavior:** accepting an image from Create/Library sends one canonical ID and actual pixels. A stale ID must be rejected early and visibly; no automatic substitution of `runs[0]`. Result is separately saved, linked to source, and visible in Library. The preview must represent the actual chosen image. An unavailable upscale worker does not look like a broken start button.

**Must test:** from Create result, from Library, stale source, switching source, worker absent, upscale and hires capability-specific settings, output dimensions and path, before/after, download, failure, no action duplicates.

### S13 — Models

**User intent:** “What can this installation actually create with?”

**At first sight:** plain statuses `Ready to use`, `Installed but not tested`, `Not installed`, `Unavailable` (plus optional `Requires activation`). List/tiles show friendly model name, what it is for, model family, known readiness. A helpful `Current model` indicator should refer to Create or relevant current tab, not fake global activation.

**Secondary action:** **Select for Create**, only when already compatible/active or an explicitly confirmed activation path exists. Model file details/sha, source repository, memory, format, stage/scan/smoke tools belong in Advanced/Diagnostics.

**Behavior:** do not infer model readiness from filename, family or `.safetensors` extension. `Check stage`, `SDXL smoke`, `Flux smoke`, and `Inventory`—currently observed as enabled inert V2 buttons—must each be wired to a safe real operation, moved to a verified diagnostics action, or disabled/removed if redundant *after* capability proof. Never launch an expensive smoke generation from an ambiguously labelled button without explicit confirmation of workload.

**Must test:** read-only status refresh, activation request with confirmation, no implicit secondary activation, staged vs proven, wrong version, missing file, error, multiple models, disabled controls explanation, no hidden downloads.

### S14 — System

**User intent:** “Why isn't the app working, and how do I fix it?”

**At first sight:** 3–5 human-readable health summaries: `Local studio service`, `Big Mac connection`, `Image model`, `Jobs`, `Storage` (plus audio/video under Details). Display precise health only when live. Provide **Retry connection**, **Open Job Center** and **Show diagnostics**; no pseudo-terminal as the first thing the user sees.

**Advanced only:** endpoints, raw worker capabilities, exact model revisions, test tools, logs, port diagnostics, Tailnet status, environment paths and troubleshooting export. Expose these for maintainers without making novices learn them.

**Behavior:** show MacBook/Big Mac separately, with last checked time. The Studio may be reachable while Big Mac isn't; report which one is failing. Never show fake green Ready because `/api/version` responded while generation backend is disconnected. Prevent broad process-kill, public network exposure or destructive actions from casual buttons.

**Must test:** all healthy, console only, remote offline, storage not writable, worker not installed, model missing, recovery action failures, status freshness, accessible diagnostics and no duplicate queue widgets.

### 3.1 Cross-screen capability crosswalk

The following are **protected behaviors to audit**, not assumptions that every current implementation is working:

| User capability | Must remain reachable through | Key owner/adapter to inspect | Proof needed |
|---|---|---|---|
| Txt2img, known active model, model-specific parameters | Create; Models for selection | `component.js`, `workstation-ui.js`, `client-helpers.js`, backend image routes | Real controlled job & canonical output |
| Batch, sweep, XYZ, prompt matrix, seed behavior | Batch + Advanced, never a duplicate main route | `workstation-ui.js`, batch endpoints and UI modules | Child progress, duplicates/cancel/retry, outputs |
| Realistic checkpoints, model inventory/capability truth | Models/Advanced Create | model-registry, `/api/capabilities`, `/api/models` | actual pinned runtime and per-target proof |
| Source import, img2img, mask/inpaint, outpaint | Edit | `edit-ui.js`, `edit-core.js`, source server endpoints | actual image and edit output through intended path |
| Upscale, hires fix, resampling | Enhance | `workstation-ui.js`, enhancement handlers | dimensions/pixels/lineage, applicable worker |
| Prompt recipes and prompt enhancement | Create, prompt tools in Advanced | `component.js`, prompt tools, Ollama route | preserve privacy, Undo and separate apply |
| Image browsing and source handoffs | Library, contextual result actions | `workstation-ui.js`, `edit-ui.js`, `imageStore` | canonical ID and media truth |
| Speech/voice design/conversion | Voice | `media-ui.js`, `voice-ui.js`, `voice-designer-ui.js`, media bridge | worker proof, actual audio and cancellation truth |
| Script/line/casting/takes/assembly | Drama | `drama-ui.js`, `drama-studio-ui.js`, `drama-direct-ui.js` | saved draft, line jobs, actual assembly |
| Song/loop | Music | `media-ui.js`, audio bridge | worker-specific proof, artifact/playback |
| Video generation | Video (unavailable until ready) | `media.js`, worker registry | exact executable worker and output proof |
| World environment/project stages | World | `component.js`, world bridge | valid source/project/viewer proof |
| Image-to-3D object | 3D | `component.js`, `asset3d-bridge.js` | valid canonical image, loadable output |
| Global operations, diagnostics, local-only status | Jobs/ System | `server.js`, `dexdiffusion-v12.js`, native wrapper | state consistency + health independent of UI |

---
## 4. Cross-cutting engineering contracts: how actions must really work

### 4.1 A job is one authoritative record, not five visually inconsistent copies

The current system mixes legacy image jobs in an in-memory `jobs{}` object, durable jobs in `jobStore`, worker-specific execution bridges, the global V12 Job Center, and other status surfaces. The repair must introduce/standardize **one read model** for the UI without casually replacing all existing storage/worker internals.

**Canonical minimum job projection** (names illustrative; map actual existing fields before changing API):

| Field | Meaning | Validation |
|---|---|---|
| `job_id` | Stable exact identity, never DOM index | Persist / reload / retry matches server record |
| `operation` + `media_kind` | e.g. image generation, speech, 3D | Determines relevant labels and lifecycle |
| `worker_id`, `model_id` | Identified backend, version as available | Not inferred from a color chip |
| `state` | Canonical finite job state | Lossless mapping from legacy + durable statuses |
| `progress` + `stage` | Only when worker reports real information | No invented percentages |
| `cancel_capability` | `queued_only`, `running_verified`, `stop_after_current`, `unsupported`, `unknown` | Computed from job ownership and worker contract |
| `cancel_request_state` | `none`, `requested`, `verifying`, `verified_stopped`, `unverified`, `refused` | Not conflated with terminal state |
| `remote_stop_evidence` | Exact stop/never-started evidence receipt where applicable | Required for terminal cancelled claim |
| `artifacts` | Canonical ID(s) of produced output | Resolve through durable storage |
| `failure_stage` + `safe_message` | User-facing failure and optional technical detail | Must be intelligible with next action |
| `created_at`, `updated_at` | ordering and stale-state detection | One timestamp format, no false time remaining |

**Job Center layout:** compact top summary; one grouped list (`Running`, `Waiting`, `Recent`) with operation, target, status, and valid action. Within a job detail drawer: stage, start time, optional log, exact source/output links, backend-specific reason. Do not keep an always-visible queue bar plus topbar Jobs plus side Jobs plus V12 drawer plus per-screen competing counts. Local transient toasts may announce a change but must never replace the authoritative job record.

**Operational UI state vocabulary** (mapping layer, not arbitrary backend renaming):

| Internal condition | Visible to a beginner | Allowed actions |
|---|---|---|
| Valid form, selected compatible available worker | `Ready` | Generate/start |
| Accepted but not started / waiting for lease | `Waiting for Big Mac` | `Cancel queued job` if worker never started |
| Worker actively executing | `Generating` / `Creating audio` / `Building 3D` | `Cancel job` only when safe, otherwise explanatory disabled/Stop after current if real |
| Stop request sent, termination unresolved | `Stopping — checking the worker` | prevent duplicate stop, show Details |
| Remote work not confirmed stopped | `Could not confirm the worker stopped` | `Check status` / `Reconnect` / actionable recovery, no green success |
| Evidence shows worker stopped, no publish raced | `Cancelled` | Return to edit/try again |
| Artifact completed and published legitimately | `Completed · Saved to Library` | Open/select output; never retroactively relabel it cancelled |
| Fatal job failure | `Couldn't finish` + reason | Retry / change model / details |
| Browser/console disconnected | `Connection interrupted — job may still be running` | Reconnect & reconcile; never silently start duplicate |
| Worker cannot cancel mid-run | `This type of job cannot be stopped once started` | Disabled stop with explanation, or legitimate Stop-after-current queue policy |

### 4.2 Cancellation state-transition rules — P0 before prettification

Inspect and unify these exact current locations before implementation: `operator-console/cancellation.js`, `operator-console/server.js` route `POST /api/jobs/:id/cancel`, in-memory `jobs` manager, durable `jobStore`, `remoteWorkers`/quarantine, `media.js` worker capability declarations, `operator-console/public/dexdiffusion/component.js:onGenerate`, `operator-console/public/dexdiffusion-v12.js:cancelJob`, Concept A/V2 per-screen job buttons, and native `ImageGenApp.swift`.

**Safety proof already available:** The in-memory synthetic test created a durable `RUNNING` job *without* an active process registration and observed `ok:true,status:CANCELLED,immediate:true`, including a state transition and lease release. The correct behavior is to **refuse to claim cancellation** for that case.

**Required terminal truth table:**

| Before request | Ownership / process evidence | Correct behavior | Forbidden behavior |
|---|---|---|---|
| QUEUED, definitely never started | Proven not dispatched; no remote child exists | Cancel queue; terminal `CANCELLED` with `not_started` proof; remove from queue | Accidentally send kill to another job |
| RUNNING, active local job registered | Identified PID/process group for exact job | Graceful targeted stop, verify exit, then `CANCELLED`; if exit uncertain return unverified | Treat `SIGTERM` call itself as proof |
| RUNNING, active Big Mac job registered | Exact job nonce/workdir/worker ownership | Targeted remote stop; confirm exact process ended and publication barrier; only then `CANCELLED` | Broad `pkill`, `killall`, killing unrelated image/audio process |
| RUNNING, **no registered owner** | Durable job only | Return non-success `cancel-unsafe` / unknown; **keep job running/unverified and lease held or safely quarantined** until reconciled | Immediately change to `CANCELLED` and release resource lease |
| RUNNING, worker explicitly `cancel_supported:false` | Owned but no safe cancel API | No enabled mid-run cancel; truthful unsupported status; if already requested, refuse and keep running | Show enabled Cancel then simulate successful stop |
| TRANSFERRING / publishing | Publication potentially wins race | Resolve durable output transaction first; accept valid completed output or prove stop before cancel | Destroy completed canonical output or mark already published PASS as Cancelled |
| Terminal PASS/FAILED/CANCELLED | Final record exists | Idempotent truthful response or explicit cannot-cancel terminal state | Rewrite completed history |
| Network timeout during stop | Confirmation lost | Show `Stop not verified`; reconcile against remote child/receipt on reconnect | Interpret timeout as stop success |
| Duplicate cancel click | Existing request in flight | Deduplicate by job ID; show already stopping | Fire concurrent remote kills |
| Server restart | Job in external worker | Recover durable job/worker identity, do not duplicate or lose lease | Treat missing in-memory object as safe stop or new job |

**Critical guard:** The caller releasing an arbiter lease cannot be treated as process termination. If the process may still be executing, the worker must remain occupied/quarantined until safe reconciliation, so a second heavy task does not collide with it. The prior published-output race protections must survive. State and safety logic belongs on the server; disabling the button in UI alone is insufficient.

**Request/response contract:** `POST /api/jobs/:id/cancel` should report separately: whether request was accepted, whether the job had already finished, whether it was never started, whether remote/local termination is **verified**, and if not, why. Keep existing backward-compatible fields where required; add structured status rather than breaking all clients in one patch. Return a non-2xx or explicit refusal state for unsafe cancellation, never `ok:true,CANCELLED` on an unverified running job. Document and test exact status values before wiring UI.

**Native confirmation:** Chrome `window.confirm` and macOS `WKWebView` are not equivalent. Implement native `WKUIDelegate` JavaScript alert/confirm/prompt delegates **or** use one accessible first-party in-app dialog system everywhere. A native Cancel path must not silently fail because the wrapper treats all confirms as rejection. Apply the same fix to unsaved-draft navigation and destructive actions; don't blindly remove all confirmations.

**UI control:** Generate starts work, Cancel requests termination. They must never be aliases or one toggle that merely clears `_pollTimer`. Retain the real `job_id` until final reconciliation. On reload, fetch active jobs from the server; never infer that polling stopped means the job is gone.

### 4.3 Asset identity and source selection — P0/P1

**Server is authoritative:** Existing storage/lookup code (notably `imageStore.resolveImage(...)` and the relevant image/staging endpoints) determines whether an image ID is canonical and still accessible. UI must not compute `sourceImageId` from a bare filename, guess the latest run, or silently swap in another image.

**Canonical selected-source contract** (structure descriptive; map to actual backend names):

```json
{
  "artifact_id": "real canonical ID from server",
  "media_kind": "image",
  "source_kind": "canonical|staged",
  "canonical": true,
  "accessible": true,
  "preview_url": "/api/images/<validated-id>",
  "width": 1024,
  "height": 1024,
  "parent_id": "optional prior image ID"
}
```

- Canonical Library image: choose -> async resolve -> display exact preview/metadata -> enable valid actions -> carry same ID to Edit/Enhance/3D/World. Verify response still corresponds to latest request (protect against race if another image was selected).
- Staged/imported file: show `Imported image` and separate staging identity; promote to canonical under existing server rules if/when the actual operation demands it. No fictitious `artifact_id` or hidden path substitution.
- Missing/old ID: display `That image is no longer available. Choose another source.` Keep the unrelated draft; clear only the invalid binding after user-visible warning. Stop infinite auto-load loops.
- Wrong media type: do not offer 3D or Edit-image on WAV/MP4. Disable only inapplicable actions.
- Image load failure: keep selection and show a repairable warning; don't automatically choose a different image.
- Job output: final output record must link source + operation + target/version + canonical image/other artifact ID. No UI may claim `Saved` unless canonical storage confirms it.
- Explicitly selected source wins over `runs[0]` fallback. If a fallback is ever necessary, it must be user-visible, verified, and not override explicit selection.

**Inspect** `operator-console/public/dexdiffusion/edit-ui.js` (`openImageInEdit`, `_ensureEditSource`, `sendToEdit`), `workstation-ui.js` (`sendToEnhance`, `wsSet`), `component.js` (`startAsset3d`, `startWorld`, source previews), `operator-console/asset3d-bridge.js`, `imageStore`, library APIs and session state. Keep existing edit draft/race protection.

### 4.4 Capability/status contract

Current GET surfaces observed on the local console: `/api/workers`, `/api/capabilities`, `/api/models`, `/api/operations/snapshot`. These provide distinct pieces of truth, not necessarily a single consolidated schema. **Inspect their current live shapes and tests, then build a non-mutating UI projection** so every screen consults one consistent capability map.

The result must distinguish:

- *Architecturally compatible* vs *actually installed* vs *runnable now* vs *locally proven to succeed*.
- Worker/model ready vs resource lease busy vs connection unreachable.
- Primary image target vs explicitly activated secondary target.
- Current model selected for a specific operation vs model file merely present.
- No current job vs a job whose status cannot yet be reconciled.

**Do not** mark a model proven from `/api/models` alone, promise functionality from CivitAI/Hugging Face compatibility, launch a smoke job without explicit intent, or auto-upgrade MFLUX/SDCPP. All UI states must be derived from authoritative server reality at a known `lastCheckedAt` time. Legacy registry fields that lag operation proof must be reconciled, not blindly trusted.

### 4.5 Draft, navigation, focus, and scroll contracts

**On tab change:** preserve per-tab draft; show normal screen immediately; no code can silently reset user inputs. If there is unsaved mask/critical project state, offer `Keep editing` and `Leave without saving`; the dialog must actually work in native WKWebView.

**On background update:** keep the exact `scrollTop`, `scrollLeft`, focused control, caret range, IME composition, text selection, pending DOM text, and expanded Advanced groups where feasible. Polling must not detach the entire canvas every few seconds. Show live job status without rebuilding the whole page or moving the user.

**Scroll bug evidence distinction:**

- In Chrome, the **V4** `.ca-canvas` root was observed disconnected and replaced with a new element at scroll zero after a seed state update. That is a verified V4 mechanism.
- In settled Chrome **V2**, the same `[data-scroll-pane]` element remained connected with `scrollTop=550` through seed state changes, a direct Random seed DOM click, and ~4.2 seconds of polling. A Playwright click on an off-screen button can legitimately scroll to make that button visible. This is **not proof of the reported V2 native snap-to-top root cause**.

**Required native trace before rewriting renderer:** On MacBook WKWebView reproduce the actual user's mouse/touchpad/keyboard sequence with timestamps, old/new pane DOM identity, `scrollTop`, `scrollHeight`, `clientHeight`, active element, screen/version, state update source, SSE/poll tick, and whether a script or browser performed `scrollIntoView` or focus. Include textarea/checkbox changes, navigating among screens, window resize, and a running job snapshot. A failing regression must reproduce *before* the fix and remain green *after*. A generic `setTimeout(() => scrollTo(lastY))` hack that races user input is unacceptable.

### 4.6 A visible control must have a behavioral contract

**Control ledger schema**, one row per visible action across clean/running/error states:

`control_id | screen | label | source_file:line | kind | enabled_when | operation/handler | API_or_state_effect | input_validation | pending_state | success_state | error_state | recovery | accessibility_name | keyboard | evidence_test | status | disposition`

Possible **status** values: `VERIFIED`, `WIRED_UNTESTED`, `VISIBLE_NO_HANDLER`, `BACKEND_UNSUPPORTED`, `BLOCKED_BY_PREREQUISITE`, `DUPLICATE`, `UNKNOWN`. The ledger is generated by a code/DOM inventory and then checked with event tracing, rather than trusting the mere presence of a CSS class or a JS method name.

Allowed **dispositions**:

- `KEEP_AND_PROVE`: legitimate action, correctly wired and tested.
- `WIRE`: intended action exists but missing handler/response.
- `MOVE_TO_ADVANCED`: real expert capability, preserved without clutter.
- `GATE_WITH_REASON`: currently unsupported/unavailable; visible status, no dishonest click.
- `MERGE_DUPLICATE`: redundant controls mapped to one verified capability, with before/after function count unchanged.
- `REMOVE_PROVEN_PLACEHOLDER`: genuinely decorative or falsely interactive element with no distinct supported function, removal justified and recorded.

The audit **starts** with the already observed enabled V2 Models buttons: `Check stage`, `SDXL smoke`, `Flux smoke`, `Inventory`, then extends to Library `Open`/`Create`/`JSON`, Create `Copy params`/`→ img2img`/`→ Upscale`, Batch, Enhance, source selectors and each 14-category module. Each action requires **an explicit test** where feasible; 14 successful route changes do not prove 14 screens functional.

**Interaction state matrix:** For each input/action, validate default, valid input, invalid input, busy, disabled, offline, network timeout, failed backend, completed, repeated click, keyboard, focus after update, and screen reload wherever applicable.

### 4.7 Simple UI must not become destructive UI

Progressive disclosure means hiding expert settings *visually*, not erasing them, resetting them, or lying about their effect. Changing from a complex view to Basic must preserve the underlying exact generation settings until user chooses to reset. Changes to model should warn if incompatible hidden settings would be ignored; either safely map them or explicitly disclose the difference before running.

The app must not silently reset model, prompt, seed, image ID, license choice, worker settings or unsaved masks when users switch modules. Defaults are not a licence to overwrite meaningful state. Apply scoped localStorage/sessionStorage migration with a one-time version marker and test it against old V4 preferences and existing drafts.

---
## 5. Execution order and dependencies

**All tickets below are NOT STARTED.** They are instructions for implementation, not claims of work completed. Each ticket must produce a small diff or evidence artifact and pass its own gate before the next dependent ticket starts. A developer may group adjacent trivial tickets in one patch, but may not collapse their separate acceptance evidence.

```text
G0 IDENTIFY + LOCK + CONTROL INVENTORY
    |
    +--> G1 BACKEND CANCEL/PROCESS-OWNERSHIP SAFETY --> G2 NATIVE DIALOG + V2 CANCEL
    |                                                   |
    +--> G3 CANONICAL ASSET HANDOFFS --------------------+
    |                                                   |
    +--> G4 V2 CANONICAL SHELL + 14-CHIP NAV ------------+
                                                        |
                    G5 SIMPLE PRIMARY FLOWS + EVERY CONTROL
                                                        |
                    G6 PER-MODULE CAPABILITY AND ACTION PASS
                                                        |
                    G7 EVIDENCE-BASED SCROLL/FRESHNESS FIX
                                                        |
                    G8 REGRESSIONS + NATIVE + NOVICE TESTS
                                                        |
                    G9 PACKAGE/DOCUMENT/RELEASE DECISION
```

Priority: **P0** = correctness, destructive/false status, lost work, or unsafe compute; **P1** = required Studio UX and reliable actions; **P2** = refinement needed for release; **P3** = future capability not authorized or proven. The requested simplicity is a release requirement, not optional P3 decoration.

### Gate G0 — Source-of-truth and before-state (read-only first)

#### T-001 · Fingerprint correct machine, executable and worktree [P0]
- **Inspect:** MacBook `git rev-parse HEAD`, branch/remotes/dirty files, `/api/version`, current served `/dexdiffusion/` and script hashes, `/Applications/DexDiffusion.app/Contents/Info.plist`, `bin/dexdiffusion status` as documented; Big Mac only when checking backend context.
- **Record:** exact `HEAD`, installed wrapper stamp, relevant port/PID, timestamps, local-vs-remote distinction; do not silently use a mismatched build.
- **Safety:** capture four known dirty paths and any new ones; do not stash/reset/overwrite without explicit scope.
- **Pass:** one authoritative execution fingerprint plus files-to-preserve list; mismatched runtime/build = STOP until resolved.

#### T-002 · Build the actual function and control inventory [P0]
- **Inspect:** 14 destination contract; existing 13 screens; rendered V1/V2/V3/V4 modules; `component.js`, `workstation-ui.js`, `media-ui.js`, `drama-ui.js`, `edit-ui.js`, `concept-a.js`, backend routes, worker registry, test files.
- **Capture:** one row per distinct *capability*, one row per visible enabled *control*. Distinguish a working capability hidden by UX from a function never implemented.
- **Action mapping:** use the ledger schema in §4.6; record handler path, API/state effect, source ID, worker support, required input, error/recovery, regression test.
- **Pass:** every visible control on every selected module has a status; exact known inert Models buttons are included; no `UNKNOWN` control is silently labelled functional.

#### T-003 · Obtain pre-change novice and scroll recordings [P0]
- **Run read-only:** screenshot every route and state at declared Mac window widths; record ordinary mouse/trackpad actions for Create, Library, Edit, Enhance, Jobs, System; collect scroll/focus trace without invoking real heavy generation.
- **Record:** where user gets lost, repeated sections, controls that appear clickable but do not act, first-click time to action, native confirmation handling.
- **Pass:** time-stamped baseline notes and reproducible stimuli exist. Do not rely on one screenshot or agent narrative.

#### T-004 · Freeze release boundaries and regression claims [P0]
- **Record protected invariants:** I-01 to I-14; active model pins, canonical output path, localhost/Tailnet scope, Dock wrapper, prompt-saving policy, source lineage, publication barrier, existing unit/browser tests.
- **Build before-state table:** known proven capabilities vs unverified/dormant worker features; use explicit `proven`/`untested`/`unavailable` states.
- **Pass:** no team member has to guess what they must preserve or which claims need new evidence.

### Gate G1 — Backend cancellation truth and shared process ownership

#### T-101 · Close the false terminal transition [P0]
- **Files to inspect:** `operator-console/cancellation.js`, durable `jobStore`, resource arbiter consumers and server cancellation route.
- **Change:** when `jobStore` reports `RUNNING` or `TRANSFERRING` but no verified active process owner exists, `cancelJob` refuses to finalize cancellation. Return a structured unsafe/unknown response, do not release shared heavy lease, and trigger safe reconciliation rather than pretending the process stopped.
- **Preserve:** queued-never-started cancellation; already terminal jobs; existing durable state/history; original public image publication barrier.
- **Test first:** add a deterministic **failing-before** synthetic test matching E9 (`RUNNING` durable job, zero active registrations). Ensure it fails on old behavior, passes new behavior, and asserts no `CANCELLED` transition and no early lease release.
- **Pass:** `ok:true,CANCELLED` is impossible in that unowned case.

#### T-102 · Calculate `canCancel` from real worker capability [P0]
- **Files:** `server.js:getOperationalJobSnapshot`, `media.js` `cancel_supported`, worker/remote registration, V12 snapshot consumers.
- **Change:** replace generic `status in {QUEUED,RUNNING,TRANSFERRING}` truth with a structured capability computed per job. Queue cancelability requires “never started”; running cancellation requires job-scoped termination support; unsupported workers are not offered a fake enabled Cancel. Support a real Stop-after-current policy only if actually implemented.
- **Test:** table-driven fixtures for image, voice, music, video/dormant and 3D; compare snapshot capability and cancellation route response.
- **Pass:** no generic row says `canCancel:true` when the server would refuse or lie; no job has two disagreeing status surfaces.

#### T-103 · Verify targeted stop and preserve publication races [P0]
- **Files:** existing remote worker process/nonce tracking, Big Mac bridge, image publication code, arbiter/quarantine.
- **Change:** preserve exact PID/process-group identity, nonce, workdir and remote-stop readback; represent requested/verifying/verified/unverified explicitly. Keep the resource reserved/quarantined while unknown. If a valid artifact was committed before cancel, preserve PASS with output and clear explanation.
- **Non-goal:** no blanket `pkill`, no watchdog that can kill unrelated SSH or compute tasks, no force-stop of unsupported media workers.
- **Tests:** stop request arriving before launch, during process, during transfer, during publication, after publication, network drop, stop hook throws, lost worker record, late callback, repeat click, server restart.
- **Pass:** only the exact job can stop; artifact and lease truth are never contradictory.

#### T-104 · Publish a backward-compatible cancellation response contract [P0]
- **Files:** `POST /api/jobs/:id/cancel` route, Job Center client, V2 client, API tests.
- **Change:** define exact status/result fields, map legacy clients safely, and document which fields indicate verified stop vs accepted request. Avoid changing `ok` meaning in a way that silently breaks existing clients; update clients and tests in same coherent change.
- **Test:** full response matrix from §4.2, missing job, malformed ID, unauthorized/unknown process, already complete, remote quarantine; no active Big Mac kill needed for unit tests.
- **Pass:** clients can unequivocally distinguish queued cancelled, verified stopped, refused, unverified stop, and already completed.

### Gate G2 — Native dialogs and user-visible cancellation

#### T-201 · Restore native confirmation and alert behavior [P0]
- **File:** `native/macos/Image_Gen/ImageGenApp.swift` (actual wrapper target, not guessed Swift path).
- **Change:** implement required WKUIDelegate JavaScript dialog methods **or** use an accessible in-app dialog replacing the affected JS native dialogs. Guard against off-main-thread UI, orphaned completion handlers, duplicate dialogs and focus-loss. Keep existing file-picker support.
- **Test:** click a benign confirm path in actual packaged WKWebView and accept/cancel; test destructive warning and alert recovery; compare equivalent Chrome behavior. Do not use real remote cancellation as first proof.
- **Pass:** accepting/rejecting is observable and matches the user's choice; no silent automatic rejection.

#### T-202 · Dedicated V2 Cancel button bound to job identity [P0]
- **File:** `component.js:onGenerate`, V2 index template, shared job presenter; inspect any `interruptGeneration` proven code rather than recreating it.
- **Change:** Generate is never used to “cancel” by clearing `_pollTimer`. The primary action starts one job; once started, a separate **Cancel job** button invokes the safe endpoint exactly once, keyed by the recorded active job ID. State shown changes to `Stopping — checking the worker`, not instantly `Cancelled`.
- **Test:** spy on requests for a synthetic fixture; verify one generation, one cancel, no repeated submit, no silent local reset. Unsupported worker displays reason and no enabled action.
- **Pass:** UI and backend agree on terminal state; old job cannot keep running unseen because the user clicked Generate twice.

#### T-203 · Reconcile jobs after refresh, tab change, native relaunch [P0]
- **Files:** state manager, active-job lookup, `/api/operations/snapshot`, V12 and per-module presenters.
- **Change:** load/reconcile actual server job by ID on return; keep staging/result previews without cross-job identity confusion. If console restarts while Big Mac runs, mark `Connection interrupted / checking worker`, not `Idle` or “cancelled.” Only offer Retry after evidence prevents duplicate heavy work.
- **Test:** mock page reload, stale localStorage, disconnected/reconnected server, multiple jobs, queue-plus-image, completed/publication race.
- **Pass:** no hidden in-flight work, stale phantom CANCELLED, duplicate generation or lost output.

### Gate G3 — Canonical asset and context handoffs

#### T-301 · Define one source-artifact resolver and result type [P0]
- **Files:** imageStore routes/adapter, `workstation-ui.js`, `edit-ui.js`, `component.js`, 3D and World bridges.
- **Change:** add or consolidate one server-authoritative lookup for canonical/staged media with typed identity, preview and availability; do not convert filenames to IDs by string guessing. Typed result discriminates `VALID_CANONICAL`, `VALID_STAGED`, `MISSING`, `WRONG_MEDIA`, `UNAVAILABLE`.
- **Tests:** same image referenced from 4 modules, canonical ID returned, staged import, missing, wrong MIME, corrupt bytes, invalid traversal/input.
- **Pass:** a single selected image yields the same resolved ID and preview everywhere, or the same actionable reason for refusal.

#### T-302 · Make Edit source stable, preservable and recoverable [P0]
- **Files:** `edit-ui.js:openImageInEdit`, `_ensureEditSource`, workspace persistence and Edit draft/mask state.
- **Change:** preserve user-selected source on async changes; clear only a stale binding; never repeatedly auto-open a confirmed bad ID. Preserve current mask/prompt and user edits while presenting `Choose another image`.
- **Tests:** valid, stale, image fails to load, rapid A→B selection with A slow, source after relaunch, unsaved mask navigation confirm, return to original, chained result.
- **Pass:** no wrong-source render, no destroyed draft, no infinite source reloading.

#### T-303 · Make Enhance source and result identity exact [P0/P1]
- **Files:** `workstation-ui.js:sendToEnhance`, `_runEnhance`, image metadata resolver, result actions.
- **Change:** accept the exact canonical ID from Create/Library; show matching preview; fail fast on missing bytes; validate selected enhancement method against worker; link result to source and Library.
- **Tests:** source from Create, source from Library, stale ID after reopen, source rapidly switched, missing upscale backend, output size/lineage; real job only in later bounded acceptance.
- **Pass:** no silent “latest image” substitution and no false result success.

#### T-304 · Make World/3D source gates strict [P0/P1]
- **Files:** `component.js:startAsset3d`, `startWorld`, `buildAsset3dWorkspace`, `asset3d-bridge.js`, world bridge.
- **Change:** explicit selected canonical image; preview resolves; all generation modes disable if source invalid. Remove implicit unsafe fallback to `runs[0].imageFile` where it changes intent. Mode availability reflects worker proof (Quick3D/mesh/textured each separately).
- **Tests:** no canonical images, selected stale source, selected valid source, 404 image preview, mode unavailable, service offline, 3D output validation and viewer error states.
- **Pass:** no remote request with unverified source and no mismatched preview/job input.

#### T-305 · Preserve cross-module selection and lineage [P1]
- **Files:** Library selection, Create result actions, Edit/Enhance/World/3D handoff helpers, artifact metadata.
- **Change:** one active asset selection model with explicit handoff target and last successful result; passing an asset never silently changes other project settings. Keep parent/child output relationship.
- **Tests:** Create→Library→Edit→Enhance; Library→3D and World; tab change/reload and wrong-media rejection.
- **Pass:** human can always answer `Which image am I using?` from the screen and job details.

### Gate G4 — V2 Studio as sole normal product shell

#### T-401 · Canonical clean launch and safe old-preference migration [P1]
- **Files:** `component.js` `dex_version` and `screens` initialization, native launcher, persisted preference handling.
- **Change:** new installs and migrated ordinary users open V2 Studio Create. Preserve saved drafts and prior prompts according to save policy. Do not silently throw away the old V4 state. Use idempotent migration marker; developer-only version diagnostics may remain without public V1/V3/V4 chooser.
- **Tests:** brand-new browser profile, existing `dex_version=4` profile with drafts, persisted `dex_version=2`, corrupted storage, native relaunch, shortcut/Dock.
- **Pass:** Create appears first in all normal cases; no Workstation-first default; valid draft state survives.

#### T-402 · Implement exactly one global 14-chip top navigation [P1]
- **Files:** V2 `index.html`, screen dispatch, capability flags; preserve `media-ui.js`/`drama-ui.js` extensions that already correctly route.
- **Change:** fixed order from §2.3, text+accessibility names, category tint, active/disabled info, horizontal overflow controls, preserved screen state. Swap routes to honest gated status; Video routes to truthful worker status.
- **Tests:** click each visible chip, verify correct screen heading, active tab and no page JS errors, keyboard navigation all 14, widths 390/768/1024/1440, tab focus and draft retention.
- **Pass:** all 14 destinations reachable by actual UI click; no duplicate top-level rail, no hidden surprise Workstation redirect.

#### T-403 · Replace the V2 front-page clutter with one Create canvas + inspector [P1]
- **Files:** V2 Create template, existing `workstation-ui.js` widgets and shared Create components.
- **Change:** deduplicate repeated model/preview/settings areas. Preserve source code and high-value widgets but mount each in its correct simple/advanced location only once. Large preview, simple form, dominant Generate, result action strip. No giant explanatory blocks.
- **Tests:** before/after control crosswalk for Create; function parity; initial 5-second comprehension; no overlapping controls at tested widths; alternate worker state.
- **Pass:** ordinary render uses no advanced dialog; expert can still access each relevant parameter and retains its value.

#### T-404 · Retire V4 as default without destroying verified modules [P1]
- **Files:** shell selection/render pipeline and historical PRD, not worker backends.
- **Change:** route normal UI solely through V2; leave legacy shells debug/test-only initially. Mark old PRD as superseded **after** user-facing behavior matches. Remove only proven redundant UI mounts; do not delete functioning functions because they originated in Concept A.
- **Tests:** no visible version selector or global Workstation home; preserved drama/audio/edit features; no accidental regression in old browser tests that still serve as useful signal.
- **Pass:** one product interface, not four competing products accidentally rendered from one template.

---
### Gate G5 — Make the UI simple *and* complete

#### T-501 · Basic/Advanced disclosure with preserved semantics [P1]
- **Change:** default open controls = task-essential inputs, one main action and one preview. Move worker jargon and infrequently used tuning behind **Advanced settings** grouped by task (`Image details`, `Sampling`, `References`, `Scripts`, `Diagnostics`). The disclosure belongs to the active screen; no hidden second Studio version.
- **Preserve:** actual field values and defaults when closed, model-specific controls, LoRA and masks, recipe persistence, seed and dimension precision, expert keyboard accelerators where working.
- **Test:** fill every advanced field, close/reopen, navigate/reload as permitted, change model family, validate hidden-incompatible settings are not silently misapplied. Compare output request payload before/after for identical chosen settings.
- **Pass:** beginners never need Advanced for core tasks; experts do not lose access or underlying settings.

#### T-502 · Consistent action priority and result transitions [P1]
- **Change:** one clearly dominant primary CTA per screen; secondary result actions appear after a valid selection or output. Use the same action labels/order where reasonable (`Open in Library`, `Edit`, `Enhance`, `Download`) and surface output location.
- **Test:** new/empty/working/failed state, pointer and keyboard, at least three viewport sizes, compare display to actual action dispatch.
- **Pass:** nothing looks like a clickable action before its prerequisites exist; one source record produces one set of actions.

#### T-503 · One Job Center; remove only duplicate presentations [P1]
- **Change:** keep one top-right Jobs entry and one detailed panel. Remove duplicate queue bar, alternate rail Jobs button, repetitive per-screen status chip clusters **only after verifying none have unique functionality**. A concise in-place running indicator can remain next to the primary action, provided it reflects the exact same job record.
- **Test:** run simultaneous synthetic queued and active image/audio/3D records, refresh and compare every visible status, cancellation eligibility, ordering, stale remote state.
- **Pass:** no contradictory counts, progress or `cancel` states; every important job action remains reachable.

#### T-504 · Eliminate enabled no-op controls across the Studio [P1]
- **Change:** for **each** control ledger row in §4.6 choose KEEP/WIRE/MOVE/GATE/MERGE/REMOVE. Start with observed V2 Models no-ops; then V2 Library actions, Create Copy params/img2img/Upscale, Enhance selectors and controls, Batch controls, media, System.
- **Rules:** a label/visual state is not proof of a handler. A handler returning before effect with no user feedback also counts as a no-op. UI events must produce observable intent-consistent effect or actionable refusal.
- **Test:** automated visible-control sweep using relevant fixtures, event/API spies and outcome assertions; manual spot check each distinct control class. Protect against accidentally launching expensive backend jobs by mocking state-changing requests until bounded real E2E stage.
- **Pass:** **zero enabled visible no-ops** in tested states; 100% of controls have a ledger disposition and evidence link.

#### T-505 · Model selection that cannot silently surprise people [P1]
- **Change:** choose one genuinely runnable default image target when available; render unavailable model choices as disabled with readable reason. Do not silently switch backends/activate secondary model on page load. When a user selects a different model, map supported defaults and disclose incompatible or ignored settings before submitting.
- **Test:** MFLUX available, SDCPP only, Big Mac offline, model staged but not proven, explicitly activated secondary model, clear profile and V4 migration.
- **Pass:** a newcomer can press Generate with the initial valid defaults when a model is available; app never lies about readiness or silently changes model.

#### T-506 · Make all states recoverable and understandable [P1]
- **Change:** standardize loading/empty/error/success/unavailable components with direct next action and optional details; distinguish form error from worker/server failure. Add short contextual help, not an unsolicited tour.
- **Examples:** `No images yet. Create one to see it here.` / `That source image can't be found. Choose another.` / `Big Mac is unreachable. Your draft is safe. [Retry connection]` / `This feature isn't installed. [See requirements]`.
- **Test:** each screen's states below, screen reader announcement, focus after error, retry without duplicate submit, copy still legible at 200% zoom.
- **Pass:** there is no endless spinner, blank panel, hidden error, or error message without next action.

#### T-507 · Preserve micro-interactions without visual noise [P2]
- **Change:** visual focus rings, consistent hover/focus/pressed/disabled treatment, stable tooltips, clear load/stop animations only when informative, reduced-motion fallback, subdued background effects. No flashing, expensive full-surface remounts or decorative transitions that interrupt typing.
- **Test:** mouse, trackpad, keyboard, reduce motion, 200% text zoom, dark color contrast; performance spot check during polling.
- **Pass:** visual polish clarifies state but never creates new functionality regressions.

### Gate G6 — Per-module complete behavior and capability proof

Each item below is a **separate owner/acceptance ticket**. A pass requires: destination opens via actual top chip, initial layout and copy make sense, every visible enabled input/action works, no silent unsupported job, success/error/offline states are truthful, outputs/selection survive relevant navigation, and a targeted browser test exists. Tests must be safe fixture-based until real worker testing is authorized.

#### T-601 · Create [P1]
- **Actions to trace:** select model, preset, image shape/size, write prompt, show Advanced, sampler/seed/options when supported, Generate, Cancel, result actions, recipe save/load, prompt enhancement + Undo.
- **Repair sequence:** remove duplicated Create fields; select correct model default; validate target-specific settings; reconcile active ID; show result canonical storage; keep Edit/Enhance routes intact.
- **Proof:** novice creates image with default controls; serialized request matches visible settings; one correct output with lineage; test source handoffs. Unit/browser fixtures before a bounded real image proof.

#### T-602 · Batch [P1]
- **Actions:** multi-image quantity, axis selection, prompt matrix/XYZ, seed plan, submit, progress, stop remaining, resume, inspect/download completed results.
- **Repair:** one compact starting flow; preserve sweep and expert scripts in Advanced; separate parent/child statuses and queued/running stop semantics.
- **Proof:** fixture records correct cell count, no duplicate job on double click/reload, source outputs remain available after a partial failure.

#### T-603 · Swap [P1 for navigation truth / P3 for execution]
- **Actions now:** open chip; inspect meaningful unavailable reason; navigate away. **No fake swap job.**
- **Repair:** add V2 route, simple status and documented future backend requirements; do not relabel unrelated width↔height transformation as Swap.
- **Proof now:** no enabled execution control and no backend calls; when semantics/model are approved later, open a separately scoped implementation ticket.

#### T-604 · Voice [P1]
- **Actions:** choose task, enter text or source where supported, select voice, preview/generate, listen, save/download, worker-specific stop messaging, Quick/Designer without global nav duplication.
- **Repair:** unify `media-ui.js` / `voice-ui.js` / designer UI into one task-centered host, not rewrite voice worker or bypass native audio checks.
- **Proof:** correct worker decision, valid audio fixture, native playback, source upload and failure recovery, cancellation representation.

#### T-605 · Drama [P1]
- **Actions:** new/open project, edit script, cast/voice assign, direct line, preview, render/resume, assemble, listen/download; maintain line approvals and takes.
- **Repair:** a clear `Start with a script` empty state, task-status hierarchy, one project primary CTA, advanced line controls when selected.
- **Proof:** saved draft survives tabs and app reload, no duplicate line render on resume, assembly has valid output and source relationships.

#### T-606 · Music [P1]
- **Actions:** choose available Song/Loop worker, description/lyrics, duration if supported, Generate, progress, audio player, Library/Download and unavailable feedback.
- **Repair:** do not present unsupported song/loop choices as live; tie controls and stop behavior to chosen audio worker.
- **Proof:** generated/fixture media has playable artifact, proper metadata/length, one job identity, no fake stop.

#### T-607 · Video [P1 navigation / P3 generation]
- **Actions now:** open Video, understand that no runnable generator is configured, open System details or Library for existing videos if implemented.
- **Repair:** honest capability card rather than dormant but enabled Generate; keep eventual video worker integration out of this UI-repair release unless separately authorized.
- **Proof:** no misleading success/enablement, no fake frames or MP4; a backend-not-available test is green.

#### T-608 · World [P1]
- **Actions:** choose actual canonical image, preview, select proven mode, create/open world, view status and output, return to source.
- **Repair:** source validation, resilient viewer/project state, clean error when backend unavailable.
- **Proof:** World receives exact image ID, shows it before work, output source relationship and reopenability verified.

#### T-609 · 3D [P1]
- **Actions:** source picker + preview, valid Quick3D/Mesh/Textured modes, start, model viewer/download, failure/help.
- **Repair:** remove implicit unsafe latest-run fallback; gate *all* modes on validated input and live per-mode status, not just named mesh routes.
- **Proof:** invalid source produces no job, valid fixture uses same ID, GLB checked with model parser/viewer after real run.

#### T-610 · Library [P1]
- **Actions:** folder navigation, select, search/filter, preview, full-resolution open, metadata/PNG Info, compare, download, send to Edit/Enhance/World/3D, media-aware actions, bounded pagination.
- **Repair:** replace dead legacy card action buttons with actual functional module actions; keep existing folder-first behavior and large-library optimization; deduplicate preview/reload.
- **Proof:** handoffs preserve IDs, file downloads work, no dead Open/JSON actions, thousands-item fixture scrolls smoothly.

#### T-611 · Edit [P1]
- **Actions:** source selection/import, image/canvas, mask and brush, img2img/inpaint/outpaint task, prompt and valid parameters, Apply, Undo/revise, use result as new source, return original, Library/Download.
- **Repair:** stale source recovery without draft loss, supported controls per operation; keep existing advanced editing and pointer/keyboard behavior.
- **Proof:** source truth, mask survival, correct generated-output parent, async selection race safety, no surprise source swap.

#### T-612 · Enhance [P1]
- **Actions:** choose image, method/scale, preview, Enhance, compare, Library/Download; advanced Real-ESRGAN/hires-refinement and resampling where verified.
- **Repair:** remove inert prototype source/model options or wire them; distinguish image versus prompt enhancement; preserve target-specific limitations.
- **Proof:** visible selected image equals submitted ID, correct output dimensions/lineage, error and worker-unavailable flows.

#### T-613 · Models [P1]
- **Actions:** read capability state, filter/select ready model, view missing details, explicit activation, validated diagnostic refresh.
- **Repair:** resolve `Check stage`/`SDXL smoke`/`Flux smoke`/`Inventory` four known no-ops, without making accidental compute side effects.
- **Proof:** no enabled unknown button; status backed by model+worker truth and activation independent of mere file presence.

#### T-614 · System [P1]
- **Actions:** inspect local service, remote worker, storage and current errors, Retry connection, Job Center, Advanced diagnostics/export where proven.
- **Repair:** human-first health labels; remove duplicate banners and technical noise; preserve responsible diagnostic capability.
- **Proof:** independently simulated local-offline, Big Mac-offline, model-missing, busy-worker, unreadable storage and recovery states.

### Gate G7 — Scroll/input stability (evidence-led, not guesswork)

#### T-701 · Capture a reproducible *native V2* scroll bug [P1]
- **Change:** add a temporary read-only tracing helper/test (removed or gated before normal release) measuring `[data-scroll-pane]` element identity, scroll offsets, focused element, caret, rerender cause and timing.
- **Exercise:** trackpad wheel, click offscreen buttons, input typing, toggling disclosure, background SSE/poll, 1→2→1 navigation, Library large list, Edit masks, window resize, native WKWebView.
- **Pass:** exact reproduction or an explicit `NOT REPRODUCED` result with test trace. Never assert a fix when there was no failing test.

#### T-702 · Apply the narrowest proven scroll/focus repair [P1]
- **Change:** repair the actually responsible component/rerender mechanism, preserve input and screen reader semantics, avoid whole-tree replacement where possible. No giant arbitrary scroll reset/restoration hack, no disabled SSE to mask defect.
- **Test:** T-701 fails on before-state and passes after. Run typing/IME/caret and element reflow regressions.
- **Pass:** pane remains at user-chosen position unless user explicitly navigates, scrolls, or focus legitimately moves to an offscreen control.

#### T-703 · Lock durable scroll, focus and content updates [P1]
- **Change:** add lasting Chrome **and native** tests for Create/Batch/Library/Edit/System with empty, populated and running states.
- **Test:** 10+ controlled state updates and 30-second SSE/poll fixture at mid-scroll, keyboard focus, textarea editing, open Advanced and active job changes.
- **Pass:** no surprise snap, field reset, focus theft or content loss; accepted automatic focus scroll is distinguishable from defect.

---
### Gate G8 — Automated, native, performance and novice acceptance

#### T-801 · Unit + integration regression ladder [P0/P1]
- **Run after each relevant ticket:** focused test for changed module, then all `operator-console` unit tests and existing browser paths. Run tests against disposable fixtures or isolated test server, not the production job queue.
- **Known scripts in `operator-console/package.json`:** `npm test`, `npm run test:browser`, `npm run test:browser:matrix`, `npm run test:browser:library`, `npm run test:browser:edit`, `npm run test:browser:voice`, `npm run test:release`, `npm run test:perf`. The existing `test:browser` aggregate covers selected Edit/Voice/Drama suites, **not** every 14-tab interaction by itself. Additional focused tests must cover the others.
- **Tests to add:** safe cancel state table, native-dialog integration harness where feasible, 14 actual chip clicks, exact model capabilities, 100% visible enabled action inventory, source handoff and stale-ID behavior, scroll retention, offline/resume, prompt privacy.
- **Pass:** zero new test failures; every fixed defect has failing-before/passing-after proof; known unrelated baseline failures recorded rather than hidden.

#### T-802 · Complete real interaction matrix, not merely geometry [P1]
- **Change:** extend browser test contract from existing `12×5×3` layout emphasis to actual user action sequences for 14 destinations and all enabled primary/secondary controls.
- **Method:** use a clean browser context and existing/owned fixture API records; click rendered buttons by accessible label rather than directly calling `__dex.setScreen()`; intercept mutations only when test intentionally validates a request; assert effects and postconditions. Capture console/page errors. Do not let a screenshot with visible controls count as operational proof.
- **Cases:** empty/filled/invalid/working/pending/error/offline, 390/768/1024/1440 wide, 200% text zoom, mouse/keyboard, dynamic model/worker capability changes.
- **Pass:** no enabled silent no-ops; no untracked API calls or broken routes; truthful unavailable states.

#### T-803 · Native WKWebView acceptance and Dock packaging [P0/P1]
- **Use:** actual `/Applications/DexDiffusion.app`, installed through the project-documented `scripts/install-macos-app.sh` only after its preflight and authorized update path; inspect first.
- **Verify:** source commit stamp equals tested source, local web service restarts/loads correctly, dialogs work, file picker still works, images and audio play/preview, app icon unchanged, one correct Dock tile, no secondary launcher, local/Tailnet boundary preserved.
- **Tests:** fresh macOS app process launch, existing app state, 14 tab clicks, job center, confirmation Accept/Cancel, source select, scroll, appearance on window resize; then matching Chrome behavior.
- **Pass:** native behavior not merely inferred from headless Chrome; no deployment to Dock until both backend+UI acceptance is green.

#### T-804 · Bounded real machine end-to-end tests [P0/P1]
- **Precondition:** explicit authorization for real generation/cancellation and verified Big Mac machine identity/compute availability; work on a known test fixture, not an unrelated live job.
- **Order:** one smallest permitted primary model image generation; verify actual bytes at canonical `/Users/andrew/images_made`, metadata/lineage and Library; one bounded supported Edit/Enhance job; only then a specifically job-owned safe queued cancel and, if implemented, one supported active-job cancel. Repeat per separately claimed worker/operation; don't generalize one image worker proof to media/3D.
- **Measure:** request ID, timestamps, exact worker/target, CLI exit, stop proof, canonical output SHA where sensible, API status, UI status, expected result, data-retention outcome.
- **Pass:** every feature labelled `PROVEN` has a corresponding real run receipt; others remain `UNTESTED/UNAVAILABLE` even if their UI is beautiful. Unverified stop keeps the release blocked.

#### T-805 · Human novice usability acceptance [P1 release blocker]
- **Participant criterion:** ideally at least **three** people unfamiliar with DexDiffusion and the user's architecture. A technical developer testing their own implementation **does not count** as an independent novice. People can be local; avoid making private media/accounts available unnecessarily.
- **Facilitation:** start from clean profile or clearly documented pre-existing saved profile. Read exactly: `This is DexDiffusion Studio. Use it to make or work with something. Please say aloud what you expect each button to do. I cannot teach you the interface during this test.` Answer questions only after recording inability to proceed; count prompts as assisted.
- **Core tasks:** find Create; identify prompt/model; produce a simple image when worker available; tell where saved; find it in Library; return/select for Edit; find the relevant Enhance action; identify ongoing Jobs and what Cancel really means; understand Video/Swap status; navigate back without draft loss. Separate no-compute mock tests from actual authorized creation.
- **Observe:** time to locate controls, wrong turns, assistance needed, silent action attempts, unexpected scroll jumps, fear of losing work, error recoverability, task completion and emotional confidence. Do not steer or interpret hesitations as success.
- **Pass threshold:** 3/3 participants find and start the core Create path without instruction; 3/3 find the saved result (or a truthful documented output path if a test backend is simulated); 3/3 understand real vs unavailable action status and locate Jobs; **at least 90% of all applicable remaining novice tasks unassisted**; zero data loss/false-cancel cases. Any repeated confusion seen in ≥2/3 testers is a required design repair, not a “user education” problem.
- **Important:** until actual humans do this, label `HUMAN ACCEPTANCE NOT RUN`, even with green test automation.

#### T-806 · Accessibility, responsiveness and input stability [P1]
- **Check:** all top chips and action controls by keyboard; visible focus; natural Tab order; ARIA names and status; label for each form field; no color-only meaning; readable contrast in each chip state; no unsupported disabled control without explanation; 200% zoom; reduced-motion; input/caret preserved during state changes; no modal focus trap failure.
- **Responsive:** widths from §2.4, especially macOS split-view, browser/mobile PWA-style narrow screen, touch targets, dialogs and media viewers.
- **Pass:** no unreachable primary CTA/Cancel, clipped essential label, horizontal whole-page overflow, inaccessible error or focus theft.

#### T-807 · Performance and resource stability [P2 release blocker if significant]
- **Check:** repeated navigation 14 tabs, active SSE/poll, library of 1k/10k fixture items if existing harness supports it, large scripts, long sessions, memory/CPU effects and unnecessary whole-tree DOM replacement. Measure before/after same fixture, not unrelated machines.
- **Protect:** source library paging and resource leases. No optimization that stops progress updates or sacrifices keyboard/scroll behavior.
- **Pass:** UI remains responsive and does not regress materially in frame time, leaked listeners or memory on equivalent baseline; new regression thresholds grounded in measured baseline rather than invented FPS numbers.

### Gate G9 — Documentation, rollout, and actual definition of done

#### T-901 · Write user-facing help that matches what ships [P1]
- **Produce:** a single short `Getting started` page reachable through an unobtrusive help control and context `?` for technical settings; one paragraph per major task; screenshots **of the final product** only.
- **Explain:** where images/audio/media are saved, how to choose a source, safe cancellation, model availability, Library, how to recover connection. No user should need to know `ssh westcat` for a normal generation.
- **Pass:** novice test users succeed before reading help; help accelerates recovery rather than standing in for a usable UI.

#### T-902 · Update governing documentation without erasing history [P1]
- **Files:** `DEXDIFFUSION.md`, `OPERATIONAL_STATE.md`, relevant README, `docs/acceptance/DEXDIFFUSION_HUMAN_ACCEPTANCE.md`, historical Concept A PRD, project Bible/ledger when applicable.
- **Change:** establish V2 Studio as the current authority, link the capability+control ledger, identify superseded Workstation-first direction, record exact known limitations and proof. Preserve previous decisions and result paths as history.
- **Pass:** another AI with repo+docs can tell (a) current default; (b) which features are working; (c) which are unavailable; (d) how to reproduce tests; (e) what remains to finish.

#### T-903 · Stage/install/release with source readback and rollback [P0/P1]
- **Precondition:** all mandatory tests green; updated wrapper build/install route reviewed, original app/version and working tree protected, no unauthorized model/runtime changes.
- **Sequence:** run release preflight; build a separately verifiable app; confirm stamp and served assets; review changed-file scope; install or replace the existing wrapper via project script; open from **one** Dock tile; smoke-test native workflows; record rollback location and actual reversion procedure **before** declaring success.
- **Repository:** only include intentional files, never indiscriminately stage dirty unrelated code; commit/push only on separately granted approval and after fresh status/diff review.
- **Pass:** installed Dock version and repo version match tested release; source/outputs intact; network/local/remote properties unchanged; rollback has been proven or explicitly classified unverified.

#### T-904 · Produce a signed-off capability and defect closure ledger [P0/P1]
- **Record per ticket:** before defect, fix diff, focused tests, suite result, browser outcome, native outcome, human outcome (if applicable), actual Big Mac operation evidence when applicable, remaining limitations, source commit/stamp, reviewer and acceptance decision.
- **Closure:** a defect cannot be `FIXED` merely because a patch was written or an AI reported completion. Use `FIXED_VERIFIED`, `FIXED_UNVERIFIED`, `BLOCKED`, `UNAVAILABLE_BY_DESIGN`, `DEFERRED_WITH_APPROVAL` distinctly.
- **Pass:** every mandatory ticket and invariant has an inspectable link/receipt or a visible release blocker, never a vague “looks done.”

---

## 6. Mandatory user journeys (ordered action-level scripts)

The following are **acceptance scripts**, not implementation shortcuts. Record both visible UI outcome and backend effect. Use mocks until explicit authorization for real compute. An implementation is not finished because its route appears to exist.

### J01 — First-time image generation (critical)
1. Launch app in fresh profile; **Create** is visibly selected within one render.
2. User locates `Describe your image` and enters a short harmless description.
3. UI displays a *working current* model, without requiring manual backend knowledge or silent secondary activation.
4. Default shape/preset are valid for that model; **Generate image** enabled.
5. Click once; one network request, one returned job ID, clear waiting/running status and visible Jobs linkage. Additional click cannot duplicate.
6. On success, actual canonical image appears, status `Saved to Library`; expected source model and settings recorded.
7. Click `Open in Library`; same exact artifact selected, not a loosely matched filename.
8. **Pass:** no manual server setup, no unexplained blank status, no invisible output and no silent model switching.

### J02 — Cancel a queued image (critical)
1. Queue two deterministic fixture jobs while resource lease is occupied; identify the one *not yet started*.
2. Click `Cancel queued job` on that specific ID.
3. Server verifies never dispatched; removes only that queued item and marks `CANCELLED` with not-started evidence.
4. Other job continues; no shared child process killed.
5. UI reflects one cancelled item and one still waiting/running, in **the same Job Center**.

### J03 — Stop active running job safely (critical)
1. Select a **known cancellable** test worker, log exact job ID/nonce/PID/workdir ownership.
2. Submit active cancellation through its visible control.
3. While remote stop pending UI says `Stopping — checking worker`; duplicate click disabled.
4. Only after process exit + publication reconciliation can UI display `Cancelled`.
5. Simulate lost stop confirmation: UI must say `Could not confirm stop`; lease safe/quarantined, no second heavy task scheduled falsely.
6. **Pass:** client state, durable status, worker and arbiter all agree. No broad kill.

### J04 — Worker cannot cancel (critical)
1. Show installed worker explicitly declaring `cancel_supported:false`.
2. Before launch the UI communicates the limitation clearly, at point of action.
3. During run no enabled **Cancel job** pretends it can kill work; a supported Stop-after-current may be offered only if backend implements it.
4. **Pass:** no green Cancelled toast, no false `canCancel` snapshot.

### J05 — Library → Edit → Enhance (critical)
1. Open Library, select a known canonical image A, note its preview/ID.
2. Click **Edit**; Edit preview must show A, not latest image B.
3. Modify Edit draft/mask, visit Library and return. Draft is intact; if unsaved change guard triggers, it must respond to actual Accept/Cancel.
4. Produce edit result A1 in controlled fixture; assert parent A.
5. Click **Enhance** for A1; show A1 preview and source metadata.
6. Generate/fixture enhanced A2; show source A1 and output A2 in Library.
7. **Pass:** correct identity, no stale automatic fallback, no lost edits.

### J06 — Library → 3D / World (critical)
1. Start with empty Library: clear next action; all source-dependent Generate controls disabled.
2. Select valid canonical image A and open 3D; selected preview must be A; supported modes reflect worker proof.
3. Switch to stale ID X using fixture: show source missing, disable Quick3D/mesh/textured; no job API call.
4. Select A again, launch bounded valid 3D fixture; verify model file format/viewer; go to World, same A selected if user explicitly carries it.
5. **Pass:** no source-file mismatch or remote call with unknown image.

### J07 — Saved draft and model switching
1. Write a distinct prompt; set advanced sampler/seed/dimensions; close Advanced.
2. Switch to Voice and back to Create; inputs remain.
3. Select another supported model family; incompatible hidden settings are disclosed or carefully mapped, not silently applied.
4. Force an expected recoverable offline state; reconnect; prompt remains and no duplicate job launches.
5. **Pass:** no silently reset/persisted sensitive data outside user policy.

### J08 — 14-category navigation and status truth
1. From fresh normal Studio, click every category in exact order: Create, Batch, Swap, Voice, Drama, Music, Video, World, 3D, Library, Edit, Enhance, Models, System.
2. Assert each chip activates one correctly titled screen via actual user interaction (not direct state calls), no blank or dead screen.
3. Swap and Video may be unavailable; their unavailable state is visible, honest, keyboard-accessible, and non-executable.
4. On each screen, perform one supported meaningful primary action under fixture conditions or verify a genuine unavailable reason.
5. **Pass:** 14/14 navigation, 100% enabled actions meaningful.

### J09 — Scroll/input while activity updates (critical)
1. In native Mac app, scroll halfway through actual V2 Create pane, record DOM identity/scroll offset.
2. Type in a textarea/field, change seed, open/close Advanced, let SSE/poll update, switch tabs and return.
3. Repeat in Library large list, Edit with mask, Batch and System; resize window.
4. Assert scroll/focus/caret do not jump unexpectedly; legitimate scroll-to-clicked-offscreen-control is distinguished and documented.
5. **Pass:** observed failing native sequence is fixed, with regression proof, or unresolved user report remains `UNREPRODUCED` and cannot be called fixed.

### J10 — Local service/BIG Mac failure
1. Simulate local service down while UI is open: Studio shows local failure, offers retry, draft safe.
2. Simulate console reachable but Big Mac unreachable: image generation cannot report Ready; other local Library functions remain available.
3. Reconnect: reconcile job IDs/status; do not auto-retry potentially running heavy work.
4. **Pass:** a novice knows what failed, what is saved and their next action; no status falsehood.

---
## 7. Test evidence and sign-off system

### 7.1 Evidence levels — never substitute lower for higher

| Evidence level | What it proves | What it does **not** prove |
|---|---|---|
| E0 — Design/spec | Expected behavior clearly defined | Actual behavior |
| E1 — Static source analysis | Binding or code path exists | Runtime click works or backend success |
| E2 — Unit/integration fixture | Narrow function/state contract behaves under fixture | Real GPU/worker, native WebKit and user comprehension |
| E3 — Browser interaction (real click) | Accessible control and rendered screen work in tested browser | Native app wrapper or real remote output |
| E4 — Native WKWebView | Installed app functions in the actual wrapper | Big Mac or human usability unless included |
| E5 — Bounded real backend | Actual target completed/was safely stopped and output persisted | Other targets, sessions or user comprehension |
| E6 — Independent novice | Actual unfamiliar person can use the core interface unassisted | Every edge case or all worker families |

A feature may be `VERIFIED_WEB` at E3 and `UNVERIFIED_NATIVE` at E4. Do **not** collapse those into one green checked row.

### 7.2 Release test matrix

| Surface / category | Clean + existing profiles | Empty, ready, busy, error, offline | Real click / keyboard | Canonical output/handoff | Native wrapper | Bounded real worker | Human novice |
|---|---|---|---|---|---|---|---|
| Global V2 nav + Create first screen | Required | Required | Required | N/A | Required | N/A | Required |
| Create | Required | Required | Required | Required | Required | Required for claimed models | Required |
| Batch | Required | Required | Required | Required | Required | Required if `PROVEN` claimed | Secondary novice |
| Swap | Required | Unavailable truth required | Required | Blocked pending real backend | Required | Not permitted without activation | Must recognize unavailable |
| Voice | Required | Required | Required | audio file | Required playback | Per claimed worker | Secondary novice |
| Drama | Required | Required | Required | project/assembled audio | Required playback | Per claimed worker | Secondary novice |
| Music | Required | Required | Required | song/loop artifact | Required playback | Per claimed worker | Secondary novice |
| Video | Required | Unavailable truth required | Required | N/A until activated | Required status | Not permitted without activation | Must recognize unavailable |
| World | Required | Required | Required | project/world artifact | Required viewer | Per claimed mode | Secondary novice |
| 3D | Required | Required | Required | loadable 3D file | Required viewer | Per claimed mode | Secondary novice |
| Library | Required | Required | Required | storage/download/selection | Required | N/A | Required |
| Edit | Required | Required | Required | source + result lineage | Required | Per claimed mode | Required |
| Enhance | Required | Required | Required | source + result lineage | Required | Per claimed method | Required |
| Models | Required | Required | Required | exact selection/activation | Required | Only explicit smoke authorization | Secondary novice |
| System + Job Center | Required | Required | Required | status correctness | Required | cancellation/remote validation | Required |

**Every cell** must be assigned `PASS / FAIL / BLOCKED / NOT APPLICABLE / NOT RUN`, with evidence and date; never prepopulate PASS. A screen's capability can remain unavailable by design when no worker is proven, but this does **not** count as full DexDiffusion feature-complete status.

### 7.3 Nontechnical acceptance card (copy for each participant)

```text
DEXDIFFUSION V2 STUDIO — INDEPENDENT USER SESSION
Participant code: _______  Date/time: _______  App stamp: _______
Profile: [fresh] [existing]  Input: [mouse] [trackpad] [keyboard] [touch]
Observer: _______  Local service: _______  Big Mac status: _______

TASK                         FIRST CORRECT ACTION      COMPLETED       HELP?
1. Find Create               ______ seconds            YES / NO        NO / YES
2. Identify prompt/model     ______ seconds            YES / NO        NO / YES
3. Begin image generation    ______ seconds            YES / NO        NO / YES
4. Find saved output         ______ seconds            YES / NO        NO / YES
5. Open result in Edit       ______ seconds            YES / NO        NO / YES
6. Locate Enhance            ______ seconds            YES / NO        NO / YES
7. Find/understand Jobs      ______ seconds            YES / NO        NO / YES
8. Identify unavailable tool ______ seconds            YES / NO        NO / YES
9. Return without losing draft ______ seconds         YES / NO        NO / YES
10. Recover visible error    ______ seconds            YES / NO        NO / YES

Misclicks / wrong predictions: ___________________________________
Controls that looked clickable but failed: ________________________
Unexplained terms or wording: ____________________________________
Unexpected scroll/focus/selection movement: ______________________
Any real data loss / wrong source / false cancel? _________________
What did the participant expect to happen? _______________________
What actually happened? __________________________________________
Observer intervention (quote exactly): ___________________________

Outcome: PASS / FAIL / BLOCKED
Blocking defects opened: _________________________________________
```

**Facilitator instruction:** Don't explain the interface first. Don't give hints during a task and then count the task as unassisted. A novice seeing a disabled unavailable feature and understanding why may pass *truthfulness*, but cannot pass a functioning feature test until that operation exists.

### 7.4 Implementer evidence record (one record per ticket)

```yaml
id: T-___
status: NOT_STARTED # NOT_STARTED | IN_PROGRESS | BLOCKED | VERIFIED | FAILED
scope:
  machine: MacBook or Big Mac
  repository_root: /Users/andrew/Image_Gen
  branch: main
  base_head: <full_sha>
  app_source_stamp: <exact_value>
  worktree_before: <saved_file_list>
source_claims: [C__]
user_problem: ""
files_touched: []
why_each_change_is_needed: []
implementation_summary: ""
protected_capability_checks: []
focused_failing_before: []
focused_passing_after: []
full_unit_suite: NOT_RUN
browser_ui: NOT_RUN
native_wkwebview: NOT_RUN
real_big_mac_worker: NOT_RUN
human_novice: NOT_RUN
output_evidence: []
remaining_unknowns: []
regressions_or_known_failures: []
release_blocker: true
review_decision: PENDING
commit_sha: null
remote_push: NOT_AUTHORIZED
```

### 7.5 Hard acceptance gates

**G0 — Baseline PASS:** correct checkout, runtime, native stamp, dirty files, feature/control baseline and scope recorded. **If not:** stop; cannot attribute changes reliably.

**G1 — Cancellation safety PASS:** unowned running jobs cannot falsely become CANCELLED; tested stop truth and lease behavior; owned cancel succeeds only with proof. **If not:** stop other UI deployment and real compute tests.

**G2 — Native correctness PASS:** real dialogs, V2 Cancel, status reconnection and Dock wrapper actions work. **If not:** browser-only PASS is insufficient.

**G3 — Source contract PASS:** canonical source round-trip among Library/Edit/Enhance/3D/World and stale-source recovery. **If not:** never label source operations ready.

**G4 — V2 product shell PASS:** clean and migrated profiles land Create; exact 14 top destinations; none route to Workstation unexpectedly; drafts survive. **If not:** design work incomplete.

**G5 — Control truth PASS:** all visible enabled controls have observable correct action or actionable refusal; genuine duplicates removed without capability loss; Advanced values retained. **If not:** do not approve the redesigned UI.

**G6 — Module PASS:** each currently claimed working module meets its own action/output/capability assertions. Unsupported modes remain visibly gated. **If not:** relevant model/feature status downgraded; not a product PASS.

**G7 — Scroll/input PASS:** native user-reported V2 path reproduced and fixed, or honestly unresolved and release held if still observed by human tester; caret/focus/poll regressions green. **If not:** do not say the scroll defect is fixed.

**G8 — Unassisted novice PASS:** criteria in T-805 met by real unfamiliar people; no enabled no-ops, false-cancel, wrong-source or data-loss. **If not:** the UI is not beginner-usable yet regardless of a pretty screenshot.

**G9 — Release PASS:** tested build installed via authorized route, one Dock tile, stamp matches, actual local/network/storage invariants, documentation and rollback readback correct. **If not:** use prior known-good version and report blocker.

### 7.6 Two different completion claims; never blur them

**R1 — V2 Studio stabilization:** all *present, supported* workflows are honestly and simply exposed; cancellation and source handoff safe; placeholder destinations are truthfully gated; every enabled button works; human novice passes. R1 can potentially ship with **Swap and Video generation labelled unavailable** if the product owner explicitly accepts that limitation.

**R2 — Fully realized requested feature set:** every requested creative mode (including functional Swap/Video when those are within the accepted scope) has an approved, licensed, integrated worker and real end-to-end proof. **R2 cannot pass while those remain dormant, blocked or unspecified.** R1 must not be advertised as R2.

**Product decision still required:** whether R1 can be released as a trustworthy interim Studio or whether the release remains blocked until separately scoped Swap/Video capability projects are implemented. Do not silently decide this in code.

---

## 8. Why this plan avoids the previous failure pattern

| Previous failure pattern | Countermeasure in this blueprint |
|---|---|
| Agent sees HTML with a button and reports it “works” | Actual button-click + observable result/API assertion, control ledger, failing-before/passing-after test |
| Agent sees `component.js` missing handler and calls it dead | Inspect dynamically loaded extensions and test actual rendered UI |
| Chrome visual matrix passes, native app still wrong | Separate Chrome and WKWebView evidence with Dock source stamp |
| User clicks Cancel, UI goes idle but remote machine continues | Job-owned safe stop state machine, verified stop receipt, no early lease release |
| AI simplifies by removing expert functionality | Capability crosswalk + zero-loss mapping + exact advanced homes |
| Four UI concepts keep returning as the default | Single V2 product contract, migrated preference and hidden debug shells |
| Fixes scroll globally based on guessed cause | Native reproduction and narrow failing regression before renderer changes |
| Dead or unlicensed video/swap button appears ready | Capability-aware disabled state, distinct R1 versus R2 definition |
| Model reported `available` because filename exists | Runtime capability/selection vs installation vs proven-generation separation |
| Random old image appears when a source is missing | Server-authoritative canonical IDs and strict handoff verification |
| Developer says `fixed` from a unit test | Evidence hierarchy E0–E6, release gates G0–G9, independent novice acceptance |
| Coding agent touches unrelated staged work | Scope manifest and pre/post Git diff, no broad clean, no automatic commit/push |

## 9. Risk register — specific triggers and responses

| Risk | Early trigger | Mitigation | Stop condition / fallback |
|---|---|---|---|
| Model or image generation regresses during UI rewrite | Request payload differs with same visible settings | Compare before/after payload by target; preserve existing backend adapters | Roll back only targeted UI change, retain safe base |
| Job cancelled on UI but still running on Big Mac | `CANCELLED` without remote verification | Job ownership, nonce, remote readback, arbiter quarantine | Release blocked; reconcile exact worker, never broad-kill |
| Data loss from V4→V2 preference migration | User drafts/recipes missing after launch | Idempotent tested migration, preserve old data; no mass delete | Restore saved state/test fixture before further UI changes |
| Scroll fix breaks typing or keyboard | caret/focus jumps in render test | Narrow scope and native trace; test IME, focus and SSE | Revert renderer alteration, keep prior behavior until root cause known |
| Hidden Advanced option silently changes generation | Different worker defaults after collapse | Model-aware settings truth and payload parity tests | Halt release if output request not predictable |
| Video/Swap marketing looks ready without backend | Green `Ready` chip on dormant mode | Capability-projected disablement and honest copy | R2 blocked; R1 needs explicit limitation acceptance |
| Native wrapper uses old assets | Installed app stamp/source mismatch | Preflight, readback, one Dock launcher, cache check | Do not report installed; rebuild via authorized route |
| Tailnet/localhost boundary accidentally broadened | Listening on public address or Funnel enabled | Network invariant check after every server/native change | Stop rollout and restore local-only configuration |
| Huge Library freezes UI | Long paint/listener growth with 10k fixture | Existing paging/virtualization, lifecycle tests | Revert problematic presentation before release |
| Existing dirty work overwritten/staged | Changed paths outside ticket scope | `git status` before/after, narrow diff review, no `git add .` | Stop, protect/recover original state before continuing |
| Browser test “green” but user can't find action | Independent novice confusion | Unassisted test with observation and copy changes | G8 fails; UI not beginner usable |
| Attempt to solve usability with more help text | Initial screen becomes wall of words | Five-second task hierarchy, inline one-line guidance | Cut visible explanatory prose; move to contextual help |

---

## 10. Single-ticket execution protocol for any developer or coding assistant

The *implementation process* also has to be simple enough to resume safely. Do not hand a low-reliability coding agent this entire document with the instruction “fix everything.” Give it **one ticket at a time** and its dependency context.

**Before a ticket:**

1. Confirm `machine / cwd / git branch / HEAD / origin / current dirty files / installed app stamp`; STOP if they are not the expected target or if the repo changed unexpectedly.
2. Read `DEXDIFFUSION.md`, `OPERATIONAL_STATE.md`, current test instructions and the sections of this document relevant to the ticket. Reconcile stale claims against live state.
3. Write the one-sentence user-visible success outcome and exact files to inspect; check whether the capability already works under another module or patch.
4. Reproduce the failing case with fixtures. If the alleged defect no longer exists, return `NOT REPRODUCED` plus evidence; do not patch based on assumption.
5. List protected invariants and tests. Confirm no feature removal, model swap, unsafe new network path, or unrelated file changes are planned.

**During ticket:**

6. Implement the smallest coherent correction against the observed root cause, keeping UI state labels and backend truth aligned.
7. Make explicit disabled/error/recovery states; no fake success or empty click handler.
8. Add regression assertion that would fail on the old behavior; preserve tests for earlier known-good journeys.

**After ticket:**

9. Run the focused test, then relevant cross-module tests, then appropriate full suite. For UI, use actual Chrome clicks and targeted native WKWebView path where needed. Real job tests require separate bounded authorization.
10. Inspect diff and `git status` against frozen scope. Record unrelated changes and stop for explanation; do not accidentally commit them.
11. Return an evidence record (§7.4) with exact claim status, screenshots or logs when needed, remaining limitations, and whether the next ticket is safe.
12. Do **not** start unrelated cleanup, dependency upgrades, new model installs, ComfyUI replacement, broad CSS rewrite, or release just because the ticket now passes.

**One phase handoff must answer, without extra chat context:**

```text
WHAT CHANGED?          file:line summary and user-visible behavior
WHY WAS IT WRONG?      reproducible defect and controlling evidence
WHAT WAS PRESERVED?    explicit behavior invariant list
WHAT WAS TESTED?       commands, exact results, Chrome/native/real backend scope
WHAT IS STILL UNKNOWN?  failures, blockers, untested paths
WHAT STATE EXISTS NOW? Git HEAD/diff, app source stamp, job/output proof if relevant
WHAT IS NEXT?          exact next ticket ID and entry condition
```

**One-ticket prompt envelope (fill with the specific ticket, not the entire backlog):**

```text
TASK: Implement ticket T-___ from the ATTACHED file
DEXDIFFUSION_V2_STUDIO_EXECUTION_BLUEPRINT_2026-10-20.md. If that file
is not actually accessible, STOP and request the exact ticket text; do not
assume it already exists inside the repository.
Target: /Users/andrew/Image_Gen on the verified MacBook only.
Read DEXDIFFUSION.md, OPERATIONAL_STATE.md, the ticket, its dependencies,
and the relevant source/tests. Preserve current dirty work. First reproduce
and prove the stated defect; inspect dynamically loaded modules as well as
base source before assuming a handler is missing. Inspect only named and
nearby files first; expand search only when observed evidence requires it.

Scope: implement only this ticket and its required regression tests.
Preserve all I-01 to I-14 constraints. Do not remove capabilities, alter
model pins/storage/Tailnet, run real heavy jobs, install the native app,
commit, or push without separate authorization.

Stop immediately on uncertain machine identity, a conflicting user decision,
unsafe job ownership, missing model/license authorization, or scope expansion.

Use one focused implementation pass and, only if necessary, one bounded
repair pass. Run focused tests then relevant broader checks according to risk.
Return: exact changed files, failing-before/passing-after evidence, executed
tests, protected-function checks, remaining blockers, current Git status,
and whether this ticket meets its acceptance gate. Do not claim full project
completion. Do not proceed to another ticket automatically.
```

---
## 11. Recon, tradeoffs and decisions that should not drift

### 11.1 Evidence-based UX principles adopted

- **Adopt — progressive disclosure:** Nielsen Norman Group's documented design recommendation is to show frequently used actions first and present advanced features on request; direct fit for a tool with many image/audio/model controls. See [NN/g: Progressive Disclosure](https://www.nngroup.com/articles/progressive-disclosure/).
- **Adopt — reduce clutter without reducing capability:** complex creative applications need flexible expert routes without making every option visible at once; therefore keep the module implementations and simplify where they are mounted. See [NN/g: 8 Design Guidelines for Complex Applications](https://www.nngroup.com/articles/complex-application-design/).
- **Adapt — macOS toolbar/navigation:** Apple recommends a clear toolbar, deliberately selected commands and an overflow strategy for narrow widths; the user's exact 14 Studio destinations govern, but a naive fixed-width 14-chip row would itself fail on smaller windows. Use a one-row chip strip with visible overflow/navigation and keyboard semantics. See [Apple HIG: Toolbars](https://developer.apple.com/design/human-interface-guidelines/toolbars).
- **Adapt — contextual inspector:** Apple's panel guidance makes the inspector follow the selected item. In DexDiffusion, the right controls must follow the *current Studio task and selected source*, never present generic unrelated backend settings. See [Apple HIG: Panels](https://developer.apple.com/design/human-interface-guidelines/panels).

**Counterpoint:** More prominently visible destinations do not automatically make navigation easier. Fourteen top chips can be overwhelming and can fail on narrow windows. This plan honors the fixed user-selected taxonomy, but requires observed discoverability, stable ordering, good group differentiation and responsive overflow. Do not justify 14 by color alone; test it.

### 11.2 Owner decisions to carry forward, not silently invent

| Decision | Controlling default until explicit change | Implementation consequence |
|---|---|---|
| Product shell | V2 Studio | Normal launch never Workstation |
| Default location | Create | No mandatory workspace setup |
| Top-level taxonomy | Exact 14 categories and order in §2.3 | Don't reshuffle based on current worker readiness |
| Visibility of capabilities | Hide advanced controls, preserve underlying functions | No deletion disguised as simplification |
| Swap semantics | **Unresolved**; no verified backend/license | Accessible but truthfully gated, execution separate decision |
| Video generation | Dormant/unproven in inspected code | Category visible, generation disabled until actual proof |
| Release scope R1 versus R2 | **Not yet decided** | Never report all requested features complete if Swap/Video still missing |
| Native cancellation | Evidence-based verified stop only | Unsafe false success is release blocker |
| Models/architecture | Preserve proven current stack/pins | No ComfyUI pivot, implicit download/upgrade or activation |
| Dirty project work | Protected | No broad reset/clean/add/commit |
| Storage and local network | Preserve currently documented authority | No public exposure or silent movement of outputs |

### 11.3 Glossary for an unfamiliar implementer

- **Studio:** the user's single top-tab creative interface. *Not* a Workstation or project manager.
- **Chip:** labeled top navigation action, e.g. Create or Library.
- **Model:** a collection of weights/code used to create an image or other output. `Installed` is not the same as `Working`.
- **Worker:** backend that performs the expensive actual action, typically on Big Mac.
- **Job:** one precisely identified operation and lifecycle; a screen can close while the job continues.
- **Lease:** exclusive control of a heavy compute resource; should not be released if work may still be running.
- **Canonical image:** durable image stored and registered by DexDiffusion, not a temporary filename or preview.
- **Source ID:** exact identifier for image/audio/media selected as input to a follow-on task.
- **Draft:** unsaved settings, prompt or mask currently being edited; must not disappear on a tab switch.
- **Proven:** actually completed through the intended route with preserved evidence; does not mean “listed as compatible.”
- **WKWebView:** web rendering component inside the installed macOS app; can behave differently from Chrome.
- **P0/P1/P2/P3:** repair priority, not evidence of implementation.
- **R1/R2:** stabilization release versus fully realized capability scope; never conflate.

## 12. Final release checklist — product-owner sign-off

These are **unchecked** until independently proven. Copy to a release record; never pre-check from a model's confident wording.

### Product/novice

- [ ] Normal Mac app opens V2 Studio Create, not Workstation.
- [ ] All 14 named colored top categories are discoverable and in the agreed order.
- [ ] No competing global navigation shell, no visible version selector.
- [ ] The first image action is understandable and runnable with valid defaults when a model is available.
- [ ] Advanced controls remain reachable and keep their values without dominating the UI.
- [ ] Job and output actions are clear; output location visible.
- [ ] No enabled button is a no-op, even on low-connectivity or error states.
- [ ] A real newcomer can complete the required tasks without training or prompts.

### Safety/data/functionality

- [ ] Running unowned durable job cannot be falsely cancelled.
- [ ] All job cancellation responses accurately distinguish requested, stopped, refused and unverified.
- [ ] Unsupported worker cannot advertise a fake Cancel.
- [ ] Queued/active/publishing/cancelled terminal race paths verified.
- [ ] One Jobs control and one authoritative Job Center; no contradictory status.
- [ ] Native confirmation/dialog accept and reject work.
- [ ] Canonical source is correct through Library, Edit, Enhance, 3D and World.
- [ ] Stale/missing source does not overwrite a draft or trigger hidden fallback.
- [ ] Batch, Voice, Drama, Music, advanced Edit/Enhance and image scripts retained if previously proven.
- [ ] Swap and Video cannot be misrepresented as working without their own actual worker proof.
- [ ] No silent model/backend activation, downloads, public exposure, file deletions or storage migration.
- [ ] User-reported V2 scroll issue has a native reproduced-and-fixed test, or an honest unresolved blocker.

### Release provenance

- [ ] All mandatory ticket evidence records and current capability matrix completed.
- [ ] Unit/integration/browser/native scopes distinguished; no blanket PASS from layout test.
- [ ] Real Big Mac job proofs attached only for features actually claimed proven.
- [ ] Three independent novice sessions and their raw unassisted outcomes recorded.
- [ ] One correct Dock app and source stamp; current installed behavior matches tested build.
- [ ] Full relevant regression ladder complete and changed-file scope reviewed.
- [ ] Prior library outputs, models, saved drafts, unrelated dirty files and local network state preserved.
- [ ] Documentation matches actual release and historical Workstation claims are marked superseded.
- [ ] Rollback path recorded; reviewer signs off on R1 versus R2 scope.
- [ ] Commit, push and publication done only if separately authorized, and independently verified.

**Final verdict rule:** any unchecked critical requirement means **BLOCKED** or **PARTIAL WITH NAMED LIMITATION**, not `done`. A clean design screenshot, successful shell build, or 252/252 visual/layout matrix does not waive any missing operational proof.

---

## Reference and transport notes

**Primary document:** `DEXDIFFUSION_V2_STUDIO_EXECUTION_BLUEPRINT_2026-10-20.md`. It is an output of this planning task, **not currently guaranteed to exist in the user's Git checkout**. A coding assistant must be given this file directly as an attachment or through an explicitly authorized, verified file copy before following a ticket. Do not assume a ChatGPT download link is an accessible Mac filesystem path. Preserve source reference/sha when copying into a repository.

**Source plan read:** `DexDiffusion_Reconciled_Repair_Plan_2026-10-20.md`, created after direct 2026-10-20 MacBook source/browser inspection and an isolated, synthetic cancellation proof. Supporting user-provided analyses were treated as claims, not as proof. This blueprint is a more granular *planned* execution path; it does not extend the scope of what was actually runtime-verified.

**Current repo files/commands that were read or identified at planning time:** `DEXDIFFUSION.md`, `OPERATIONAL_STATE.md`, `README.md`, `operator-console/package.json`, `operator-console/public/dexdiffusion/index.html`, `component.js`, `dc-runtime.js`, `media-ui.js`, `drama-ui.js`, `concept-a.js`, `workstation-ui.js`, `edit-ui.js`, `operator-console/server.js`, `operator-console/cancellation.js`, `operator-console/media.js`, `operator-console/asset3d-bridge.js`, native wrapper `native/macos/Image_Gen/ImageGenApp.swift`, browser tests in `operator-console/tests/browser`, `docs/acceptance/DEXDIFFUSION_HUMAN_ACCEPTANCE.md`, and `scripts/install-macos-app.sh`. Code changed after the audit must be freshly inspected rather than assumed identical.

**Comparable product/UX reading:** Apple Human Interface Guidelines for [Toolbars](https://developer.apple.com/design/human-interface-guidelines/toolbars) and [Panels](https://developer.apple.com/design/human-interface-guidelines/panels); Nielsen Norman Group [Progressive Disclosure](https://www.nngroup.com/articles/progressive-disclosure/) and [Complex Application Design](https://www.nngroup.com/articles/complex-application-design/). These support UX mechanisms; they are not proof that DexDiffusion is usable until T-805 is performed.

**Archive/rollout:** This document must not be mistaken for a completed Git or native release. Drive archival, if requested or automated by the producing workflow, needs confirmed provider write and must not silently overwrite older reports.

*End of granular plan. Earliest authorized implementation entry point: T-001 → T-002 → T-003 → T-004; first defect correction T-101 only after G0.*


<!-- END APPENDIX A -->

---

<!-- BEGIN APPENDIX B: SUPPORTING FORENSIC ADJUDICATION, HISTORICAL EVIDENCE ONLY; PRESERVED VERBATIM. -->
# DexDiffusion: Reconciled Forensic Findings and Repair Plan

Date: 2026-10-20
Mode: Read-only project diagnosis. No repository changes, worker terminations, installations, or actual generation/cancellation jobs performed.

## Adjudication question
Which disagreements among the three supplied October 20 forensic reports survive independent inspection of the current MacBook repository and running web console, and what order of repairs avoids capability regression?

## Sources and proof hierarchy
E1: Uploaded report `Pasted text.txt` (live V2 audit, asserted 13 reachable destinations, cancellation/source handoff defects, scroll movement).
E2: Uploaded report `Pasted text (2).txt` (source-only forensic diagnosis, claimed four V2 dead top chips and full-shell scroll remount).
E3: Uploaded report `Pasted text (3).txt` (source-only report, highlighted generic false cancellation, inert controls, and V2 requirements).
E4: Current DEX//REACH MacBook `reach_fingerprint` and `reach_repo_info` targeting `/Users/andrew/Image_Gen`: main, HEAD `4324dec29240fc61fb32ef2ef9db23fad0ced7a1`, correct origin; four unrelated modifications left intact.
E5: Read-only shell inspection on MacBook: `/api/version`, PID 60063, app Info.plist source HEAD, and served SHA256 for `index.html`/`component.js` match source.
E6: Current inspected JS/Swift: `component.js`, `index.html`, `media-ui.js`, `drama-ui.js`, `concept-a.js`, `dc-runtime.js`, `dexdiffusion-v12.js`, `cancellation.js`, `server.js`, `media.js`, `edit-ui.js`, `workstation-ui.js`, `ImageGenApp.swift`.
E7: Isolated headless Chrome tests against the running localhost console, with POST/PUT/DELETE requests blocked. All 13 V2 header chips were clicked; all routed successfully, no page errors or mutating requests.
E8: Controlled headless V2 scroll probes: at scrollTop 550, seed state change, direct Random seed DOM click, and 4.2-second poll preserved the same pane and 550 offset when settled; Playwright-driven offscreen clicking induced scroll-to-element movement. Separate V4 render test disconnected `.ca-canvas` and reset scrollTop to zero.
E9: Synthetic in-memory `cancellation.js` test: durable RUNNING job lacking active registration was returned `ok:true,status:CANCELLED,immediate:true` and transitioned/released without process verification.
E10: Headless V2 Models test: enabled `Check stage`, `SDXL smoke`, `Flux smoke`, `Inventory` buttons lacked bindings; clicking `Check stage` changed no state and sent no request.

## Claim adjudication
| ID | Claim | Proof state | Reason | Implication |
|---|---|---|---|---|
| C01 | Fresh clean profile opens V2 | contradicted | E6 component.js defaults version 4/workstation; E7 independent fresh profile showed same | Change canonical default, migrate existing preferences safely |
| C02 | Installed server and native source identity match current checkout | verified (identity scope only) | E4-E5 matching HEAD, port, API, app stamp, served HTML/JS | Changes can target identified checkout; do not infer live UI preference from HEAD |
| C03 | Four V2 media nav chips are inert | contradicted | E6 later-loaded media-ui/drama-ui augment renderVals; E7 all 13 chips clicked and routed | Do not remove or recreate working routes |
| C04 | All 13 routes are functional workflows | scope-exaggerated | E7 proves reachability only, not internal actions or generation | Audit controls and operation contracts individually |
| C05 | V2 Generate cancels actual work | contradicted | E6 `component.js:onGenerate()` clears local timer/state when generating; no POST to cancel | Build explicit active job ownership and cancellation control |
| C06 | Every running job can be safely cancelled | contradicted | E6 generic canCancel unconditional; media workers cancel_supported:false; E9 proves false terminal transition | P0 backend truth/safety correction |
| C07 | Native wrapper JS confirm/alert dialogs work | strongly-supported contrary evidence | E6 Swift WKUIDelegate implements open panel only, no JavaScript confirm/alert; native click test absent | Add native delegates or in-app dialogs; acceptance must be in wrapper |
| C08 | V4 shell scroll resets on rerender | verified (Chrome mode) | E6 dynamic-slot replacement; E8 old .ca-canvas detached, new pane top 0 | Do not use V4 behavior to diagnose V2 automatically |
| C09 | V2 routine rerender resets scroll to top | contradicted for tested settled case, otherwise unverified | E8 original V2 pane remained connected/top 550 through seed and poll; E1 saw movement after click without instrumented offsets | Instrument real V2 user interaction/native WebKit before changing renderer |
| C10 | V2 Models enabled actions all work | contradicted | E10 four inert enabled actions and Check stage click no-op | Full screen-wide control action inventory |
| C11 | Swap is already a defined working module | contradicted | E1-E3 and E6: only W↔H dimension operation; no separate proven route | User's 14-chip request is authority for placement, but semantics must not be invented; reserve/gate until defined |
| C12 | Video generation is ready | contradicted | E6 video UI states not implemented; dormant worker | Keep reachable Video destination truthfully disabled, do not fake backend |
| C13 | Edit/Enhance/3D source handoffs work end to end | unverified with observed failures | E1 reported live failures; E6 shows stale ID recovery asymmetry; not re-run with actual canonical fixtures | Shared canonical source resolver and empty/stale/valid tests |
| C14 | 252/252 matrix pass proves product acceptance | scope-exaggerated | E6 matrix tests layout and fixtures including direct setScreen; no full production operations | Introduce actual click/action/state/API tests and native wrapper acceptance |
| C15 | Current project default docs require Workstation | verified as historical source content; superseded as user direction | E6 Concept A PRD still Workstation-first; latest user selects V2 | Update docs after implementation, without rewriting history |
| C16 | V2 studio has duplicate prototype actions | verified in sampled locations | E6 V2 legacy blocks coexist with modern workspaces; E10 inert models buttons | Consolidate interface only after capability crosswalk |

## Immediate repair priority and acceptance

### Phase 0 — Freeze scope and evidence, no behavior changes
- Treat V2 Studio top-chip layout as controlling product direction, Create as landing screen, studio not Workstation.
- Retain all existing functional module engines and canonical image storage; preserve four dirty files in the baseline.
- Record every visible button/field and action, worker support, and backend status with proof scopes, not blanket verified labels.
- Capture native WKWebView behavior and a V2 scroll trace including `scrollTop`, pane node identity, focused element, viewport, and user action.
- Output: immutable baseline / action contract matrix.

### Phase 1 — P0: Stop false cancellation truth
- Fix `cancellation.js`: durable RUNNING/TRANSFERRING with no verified cancel ownership must refuse cancellation, not become CANCELLED. Queued never-started jobs can transition safely.
- Ensure operational snapshot `canCancel` reflects job type + worker contract + registered owner; `stop after current`, `stop requested`, `verified stopped`, `unverified/quarantined` are distinct.
- Keep remote-scoped termination and publication-race barriers; never broad-kill Big Mac processes.
- Test queued, running unowned, running owned, cannot-cancel media, completion race, cancel replay, shared server.
- Accept only if terminal state correlates with actual stop verification or truthful qualified state.

### Phase 2 — P0: Restore native confirmation + real V2 Cancel
- Implement WKWebView `runJavaScriptConfirmPanelWithMessage` and alert handling, or replace blocking native dialogs with accessible in-app confirmation. No silent no-op.
- Store active V2 job ID; use explicit Cancel action calling the safe `/api/jobs/:id/cancel`; do not turn Generate into local polling reset.
- Native wrapper must demonstrate that Cancel sends one request; status is verified or clearly uncertain; stop/retry after refresh works.

### Phase 3 — P0/P1: Source identity / cross-workspace handoffs
- Normalize canonical image IDs and source lookups across Edit, Enhance, 3D and World; resolve ID via server rather than assuming run filename.
- Invalid old Edit source must not repeatedly reopen; preserve draft, clear invalid reference and explain recovery; Enhance source must not diverge from display.
- 3D must show valid preview or precise error, disable submission without validated source; Quick3D also needs source gating.
- Test stale, missing, valid, moved, staging, and library-to-edit/enhance/3D scenarios with fixtures.

### Phase 4 — P1: V2 canonical product shell and navigation
- Make V2 default for clean user; migrate stored V4 preference deliberately, preserving drafts and sessions. Create is landing.
- One top row of 14 requested category chips: Create, Batch, Swap, Voice, Drama, Music, Video, World, 3D, Library, Edit, Enhance, Models, System.
- Preserve Batch/Sweep under Batch. Swap concept has no proven workspace and must not be represented as working until specified: put an honest gated placeholder/reserved action rather than counterfeit face-swap backend.
- All 13 currently reachable routes must remain live. Video remains visible but not executable.
- Hide V1/V3/V4 switches in developer/debug mode, not destroy their internal tests before migration.

### Phase 5 — P1: Control inventory and complete functional wiring
- Sweep all visible controls, inputs and action chips, starting with Models: Check stage, SDXL smoke, Flux smoke, Inventory.
- Link to exactly one real handler and API/worker contract, or disable with a visible reason, or remove only a proven duplicate after capability preservation proof.
- Replace prototype Library, Batch, Enhance panels with working module surfaces while preserving unique features (comparison, sweeps, masks, inspect/download, etc.).
- Verify all destinations through real user clicks; test valid/invalid input, alerts, pending/done/failed states and keyboard.

### Phase 6 — P2: UX simplification without feature deletion
- Canvas/result left, contextual parameters right; prompt/model/core settings and main action prominent.
- Color-code the top chips by creative category; responsive horizontal scroll + keyboard access.
- Basic controls default visible, Advanced/Diagnostics collapsed (state preserved, not deleted).
- One Job Center with one compact status/control entry; unify contradictory job statuses and avoid multiple duplicate banners.
- One source of truth for model selection, source image, job identity and status. Preserve Dexter branding and app icon.

### Phase 7 — P2: Scroll investigation and durable regression
- Before touching core renderer, distinguish V2 programmatic scrolling, Playwright offscreen click auto-scroll, dynamic content-height changes, and real native WKWebView scroll jumps.
- Assert pane identity and offsets during state changes, status SSE, form edits, resize, navigation, focus changes, button click and refresh; test Create, Library, Edit, Batch, System.
- If problem is V2 widget or content remount, fix scoped subtree/state. If global runtime involved, preserve focus/caret, pending typing and accessibility; do not use a giant scrollTop hack without proof.

### Phase 8 — Verification, native packaging, documentation
- Run targeted regression tests and full non-destructive test suite; run actual generation/cancel only once explicitly authorized and bounded.
- Test Chrome and installed native WKWebView, clean and existing profiles, 13 current + Swap gated destination, narrow screens and keyboard.
- Rebuild/install native wrapper only after code acceptance and proven package route; preserve Dock icon and one launcher, local-only bind, port 31337, Tailscale Serve 8443 (never Funnel), SSH westcat to Big Mac, canonical `/Users/andrew/images_made`.
- Update PRD, capability crosswalk, acceptance checklists, OPERATIONAL_STATE and project bible with source-verified status and supersession notices.
- Commit/push only after explicit approval.

## Scope / hard preservation
- Do not delete or reset four current uncommitted files; no broad cleanup, no model downloads or backend upgrades.
- Do not expose the console or Big Mac publicly; do not touch unrelated DEX//REACH HTTPS 443 gateway.
- Do not alter canonical image storage, remote ephemeral cleanup, model inference pins, pinned models, Tailscale-only ingress, or image publication/lineage semantics.
- Do not claim human acceptance, native cancellation proof, model readiness, or every control working without an observed test.
- Swap's semantic design remains unresolved, not an excuse to omit the requested nav concept.

## Next implementation packet (summary)
1. Recheck repo HEAD, native app stamp, and dirty status.
2. Fix false generic cancellation truth and tests before frontend polish.
3. Fix native confirmation and V2 explicit Cancel with protected, owned fixtures.
4. Repair canonical source handoffs.
5. Consolidate canonical V2 Studio; preserve all 13 working nav routes; expose 14th Swap as explicitly gated, not bogus.
6. Inventory/fix every enabled action and progressive disclosure; native and Chrome verification.
7. Reproduce native V2 scroll bug before editing render core.
8. Close only on complete source-to-user acceptance; no unapproved commit/push.

## Unrun / limits
No real Big Mac generation, live active-job cancellation, native UI interaction, or human acceptance were performed. This artifact is a verified repair plan, not an implementation claim.


<!-- END APPENDIX B -->
