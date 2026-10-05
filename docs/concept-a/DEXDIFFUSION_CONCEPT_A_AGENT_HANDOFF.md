# DexDiffusion Concept A — Agent Implementation Handoff

**Purpose:** bounded implementation contract for Anti-Gravity, Grok Build, Claude Code, Codex, or another repository-aware coding agent
**Preferred executor:** Anti-Gravity for the main implementation pass; Grok Build is an acceptable fallback. Claude Code or Codex may execute if they have equivalent repository and terminal access.
**Repository:** `/Users/andrew/Image_Gen`
**Branch at handoff creation:** `main`
**Remote:** `git@github.com:westkitty/Image_Gen.git`

---

# 1. Mission

Implement the approved **DexDiffusion Concept A — Single-Canvas Workstation** UX direction in the existing Image_Gen repository.

Do **not** start over.

Do **not** replace the working runtime architecture.

Do **not** treat the visual mockups as proof that features exist.

The task is to reorganize and uplift the existing user experience into one coherent shell while preserving verified functionality, capability truth, privacy, storage, compute routing, background jobs, and recovery behavior.

---

# 2. Read these files first, in order

1. `OPERATIONAL_STATE.md`
2. `AGENTS.md`
3. `DEXDIFFUSION.md`
4. `docs/concept-a/DEXDIFFUSION_CONCEPT_A_PRD.md`
5. `docs/concept-a/DEXDIFFUSION_CONCEPT_A_UX_SPEC.md`
6. `docs/concept-a/DEXDIFFUSION_CONCEPT_A_IMPLEMENTATION_CHECKLIST.md`
7. `docs/operator-console-ui-build-spec.md`
8. `docs/feature-function-inventory.md`
9. current implementation under `operator-console/`

Read historical reports only when a current source points to them for a specific claim.

---

# 3. Source-of-truth precedence

When sources disagree, use this order:

1. newest explicit user instruction;
2. current `OPERATIONAL_STATE.md`;
3. `AGENTS.md` project gates;
4. current repository source/runtime evidence;
5. Concept A PRD/UX specification for the desired experience;
6. existing UI build specification;
7. historical reports;
8. mockups/concept images.

Mockups are design references. They do not override actual capability state.

---

# 4. Protected project invariants

You MUST preserve unless the task explicitly changes them and proves the replacement:

- MacBook remains the UI/control/storage owner.
- Big Mac compute continues through the project's existing controlled routes.
- Operator console remains bound to `127.0.0.1:31337`.
- DexDiffusion tailnet ingress remains tailnet-only.
- Canonical durable image outputs remain under `/Users/andrew/images_made`.
- Remote image outputs remain ephemeral according to existing cleanup rules.
- FLUX.2 Klein 4B primary path remains protected.
- Existing stable-diffusion.cpp target behavior and caveats remain intact.
- Prompt/privacy behavior remains intact.
- Truthful progress remains intact.
- Capability gates remain authoritative.
- DEX//REACH 443, Ollama/Hermes, unrelated services, unknown files, and unrelated workloads remain untouched.
- Preserve unrelated dirty and untracked files.
- Do not delete historical evidence.
- Do not infer remote success from SSH exit code alone where the project requires in-band proof.

---

# 5. Existing V12 capabilities that must survive the redesign

The current system includes proven infrastructure that the UX redesign should reuse:

- same-origin SSE event bus;
- persistent Global Job Center;
- durable image/media job models;
- restart reconciliation to interrupted state;
- indexed Media/library with query/filter/sort/pagination;
- derived thumbnails;
- Collections / Boards using canonical artifact IDs;
- queue ETA/resource HUD;
- adaptive capability-driven controls;
- global command palette / keyboard shortcuts;
- lineage settings diff;
- synchronized image comparison;
- workflow macros;
- reproducibility bundles;
- unified recipes;
- scoped cancellation;
- modular backend services.

A design change that removes or breaks one of these without explicit authorization is a regression.

---

# 6. Approved Concept A information architecture

Use this primary module order and identity:

| Module | Accent |
|---|---|
| Workstation | warm red |
| Generate | electric blue |
| Edit | violet |
| Media | amber |
| Voice | cyan |
| Music | teal |
| 3D Assets | green |
| World Viewer | indigo |
| Drama | magenta/crimson |
| Settings / Help | slate gray |

Color supports recognition; every module also retains a text label and icon.

---

# 7. Target universal shell

All primary modules should converge on:

- persistent top bar;
- persistent left navigation;
- module header with tabs/modes and contextual help;
- main task canvas;
- contextual right inspector;
- global Queue / History access;
- universal help/tutorial modal.

The shell is shared. Module-specific work lives inside it.

---

# 8. Universal Help requirement

Implement one reusable help/tutorial system.

Required module-help tabs:

1. Quick Start
2. What It Does
3. Steps
4. Tips
5. FAQ

Requirements:

- same structure in every module;
- content changes by module;
- accessible from module header;
- indexed in Settings / Help;
- optional first-run auto-open;
- user can disable automatic opening without losing manual access;
- keyboard accessible;
- focus trap/restore;
- Escape closes;
- missing tutorial content degrades gracefully to general help.

Help must explain real product behavior, especially:
- output destination;
- unavailable capabilities;
- recovery actions;
- cross-module handoffs.

---

# 9. Implementation strategy

Do not attempt a giant rewrite.

Use staged migration.

## Phase A — shared foundation

Implement or normalize:

- design tokens;
- module color tokens;
- navigation data model;
- shared top bar;
- shared module header;
- shared inspector framework;
- shared Queue/History presentation using current job infrastructure;
- universal help modal;
- shared buttons/forms/tabs/dialogs/drawers/state components.

Acceptance:
- current modules can render in the new shell without feature loss;
- global jobs still work;
- keyboard navigation works;
- responsive behavior does not destroy the main canvas.

## Phase B — migrate proven core modules

Recommended order:

1. Workstation
2. Generate
3. Edit
4. Media
5. Settings / Help
6. Voice
7. 3D Assets
8. World Viewer

For each module:
- move existing controls/behavior into the shared shell;
- preserve backend contracts;
- simplify hierarchy using progressive disclosure;
- do not remove expert features;
- update help content;
- verify shared state/error patterns.

## Phase C — richer target modules

### Music
Build the approved Music Lab structure only against real executable capabilities.

Target UX may contain:
- prompt;
- genre/mood/tempo;
- player/waveform;
- arrangement;
- stems;
- mastering;
- Media/Drama handoff.

But:
- no enabled control without backend support;
- planned functionality must be labeled preview/planned.

### Drama
Build the approved Drama structure as capability becomes real.

Target tabs:
- Script
- Beats
- Storyboard
- Performance
- Dialogue Polish

Integrations:
- Media
- Voice
- Music
- World/render outputs

Again:
- no fake AI assistant;
- no fake generation;
- no implied asset contract that is not implemented.

---

# 10. Module-specific constraints

## Workstation
Goal: launch/resume, not duplicate the whole application.

Must include:
- recent projects;
- quick starts;
- recent assets;
- active jobs summary;
- templates/recipes.

Must not become:
- full Media;
- full Job Center;
- full diagnostics.

## Generate
Preserve current capability-driven controls.

Keep actual supported workflows:
- controlled generation;
- batch;
- X/Y/Z plot with caveat;
- sweeps;
- prompt drafts/styles;
- wildcards;
- Ollama enhancement when available;
- command preview;
- import settings;
- retry;
- comparison/reuse;
- recipes/macros/repro as applicable.

Never enable unsupported fields such as currently unavailable CLIP skip/variation/face restore merely for visual completeness.

## Edit
Preserve:
- img2img;
- inpaint;
- supported upscale;
- Real-ESRGAN path;
- current partial Hires Fix behavior;
- compare/version/reuse paths.

Outpaint and face restore remain unavailable until real backend support exists.

## Media
Preserve:
- index;
- pagination;
- filters;
- thumbnails;
- collections without byte duplication;
- run details;
- metadata;
- comparison;
- privacy-aware replay/reuse.

Make Media the clear cross-module asset hub.

## Voice
Preserve current working Voice behavior and tests.
Do not invent new voice engines.

## 3D
Preserve current Hunyuan/3D job and transfer behavior.
Individual assets remain 3D's responsibility.

## World
World owns environments/world assembly.
Do not collapse 3D and World into one ambiguous screen.

## Settings / Help
Capability status must come from actual runtime truth.
Do not expose destructive maintenance casually.

---

# 11. State and error contract

Every module must use common patterns for:

- empty;
- first-run;
- queued;
- processing;
- success;
- warning/partial;
- error;
- interrupted;
- cancelled;
- disconnected.

Recovery rules:

1. never lose user input unnecessarily;
2. preserve context;
3. explain failure plainly;
4. offer the next best action;
5. offer retry only when safe;
6. keep technical details available but secondary;
7. distinguish local UI, remote host, model, network, and export failures;
8. never label interrupted work completed.

---

# 12. Cross-module contract

Do not implement handoff as file duplication just to make screens connect.

Required conceptual flows:

- Generate → Edit → Media
- Media → Generate/Edit
- Voice → Media → Drama
- Music → Media → Drama
- 3D → World
- World → Media/Drama
- Drama → Export

For each real handoff define:
- source asset ID/path contract;
- ownership;
- provenance;
- compatible destination;
- failure behavior;
- reopen behavior.

Where no real handoff exists yet, mark it planned instead of faking it.

---

# 13. Accessibility requirements

At minimum:

- full keyboard navigation;
- visible focus;
- semantic headings/labels;
- accessible names for icon buttons;
- no color-only state;
- ARIA live regions for async updates;
- reduced motion;
- sufficient contrast;
- useful alt text;
- modal focus trap and focus restoration;
- responsive/touch-safe control sizing.

Do not regress the accessibility requirements already documented in `docs/operator-console-ui-build-spec.md`.

---

# 14. Frontend lifecycle requirements

Prevent polished UI from introducing runtime degradation.

Check for:

- duplicate global listeners;
- multiple SSE subscriptions;
- listeners not removed during module transitions;
- hidden World/3D rendering loops;
- large Media grids loading originals;
- unbounded queue/history DOM growth;
- modal/drawer listener leaks;
- repeated polling when SSE already owns updates.

Reuse existing event/state owners wherever possible.

---

# 15. Scope discipline

Do NOT:

- re-scaffold the project;
- replace frameworks merely for preference;
- redesign backend APIs unless a UX requirement genuinely requires it;
- refactor unrelated code;
- install libraries without necessity;
- alter Big Mac model storage;
- restart/kill unrelated services;
- delete user files;
- touch unrelated untracked images;
- implement a feature because it appeared in a generated concept image;
- claim runtime validation from static source inspection.

Make the smallest cohesive architectural changes that establish the shared shell and allow module migration.

---

# 16. Required planning before implementation

Before editing code:

1. inspect the current `operator-console/public/dexdiffusion/` implementation and current V12 integration;
2. identify the actual current module/router/navigation mechanism;
3. identify shared state owners and global listeners;
4. map existing user-facing functions into Concept A modules;
5. identify controls that are working, partial, experimental, unavailable, or internal;
6. propose the exact first implementation slice;
7. confirm the slice does not remove protected capability.

Do not ask the user for facts available in the repository.

---

# 17. Recommended first implementation slice

The best first slice is **Foundation + Workstation + Generate shell migration**, not all ten modules.

It should produce:

- real shared shell;
- module navigation;
- section tokens;
- global Queue integration;
- universal help component with Workstation + Generate content;
- Workstation inside shell;
- Generate inside shell;
- existing Generate behavior preserved;
- enough structure for later modules to migrate without another shell rewrite.

Why:
- proves the architecture;
- touches the highest-value user path;
- exercises jobs/help/inspector/nav;
- avoids fake future modules;
- limits regression radius.

---

# 18. Validation

Follow the repository's existing validation guidance.

At minimum for affected operator-console code:

```bash
cd /Users/andrew/Image_Gen/operator-console
npm run check
npm test
```

Always:

```bash
cd /Users/andrew/Image_Gen
git diff --check
```

Run focused browser suites that match changed behavior, including existing Edit/Voice/matrix suites when their affected paths change.

Before final completion of a UI slice:
- open the real DexDiffusion route;
- verify current active source identity;
- exercise the changed user path;
- verify job state if the slice touches jobs;
- verify keyboard interaction;
- inspect desktop and narrow layout;
- verify capability truth against current runtime;
- do not run expensive model generations unless necessary to prove an affected generation path.

---

# 19. Git discipline

During implementation:

- preserve unrelated dirty/untracked files;
- inspect `git status` before staging;
- stage only files owned by the current task;
- inspect `git diff --cached`;
- do not force push;
- do not amend unrelated commits;
- commit only when the slice's required validation passes;
- push only when separately authorized for that implementation task.

This handoff document itself does not grant future agents standing permission to push implementation changes.

---

# 20. Completion report format

Return only:

## Changed
- files changed
- user-facing behavior changed

## Preserved
- protected capabilities/invariants verified in the affected radius

## Validation
- exact commands/checks
- results
- runtime/user-path evidence

## Not implemented / still planned
- capability-gated Concept A items not yet real

## Risks / blockers
- concise evidence-backed list

## Git
- branch
- commit if created
- push status if authorized

Do not return hidden chain-of-thought or a giant exploration transcript.

---

# 21. Stop conditions

Stop and report rather than guessing if:

- repository identity differs from the expected target;
- the active runtime is serving another checkout;
- an implementation would require changing a protected architectural invariant not authorized by the task;
- a concept control has no real backend contract and cannot honestly be represented as planned;
- required validation fails after one bounded repair pass;
- unrelated user work would have to be overwritten;
- a mutation requires authority not granted by the current task.

---

# 22. Acceptance criteria for the full Concept A program

The program is complete only when:

1. all current major modules are migrated into the shared shell;
2. all proven existing capabilities remain reachable;
3. unavailable features remain truthful;
4. Media is the clear asset hub;
5. Queue/History is global;
6. universal Help works across every module;
7. core cross-module handoffs work without fake duplication;
8. error/recovery patterns are consistent;
9. accessibility requirements pass;
10. responsive layouts preserve task usability;
11. applicable tests pass;
12. the actual DexDiffusion.app/browser experience receives human acceptance;
13. operational state records the verified final baseline.

---

# 23. Paste-ready master implementation prompt

```text
You are implementing the approved DexDiffusion Concept A — Single-Canvas Workstation in the EXISTING Image_Gen repository at /Users/andrew/Image_Gen.

Do not start over. Do not re-scaffold. Do not implement mockup-only features as if they already exist.

READ FIRST, IN ORDER:
1. OPERATIONAL_STATE.md
2. AGENTS.md
3. DEXDIFFUSION.md
4. docs/concept-a/DEXDIFFUSION_CONCEPT_A_PRD.md
5. docs/concept-a/DEXDIFFUSION_CONCEPT_A_UX_SPEC.md
6. docs/concept-a/DEXDIFFUSION_CONCEPT_A_IMPLEMENTATION_CHECKLIST.md
7. docs/operator-console-ui-build-spec.md
8. docs/feature-function-inventory.md
9. the directly relevant current operator-console source

OBJECTIVE:
Transform the existing DexDiffusion UI into Concept A: one shared application shell with persistent top bar, color-coded left module navigation, module header, main canvas, contextual right inspector, global Queue/History access, and one reusable contextual Help/Tutorial modal.

PROTECTED REQUIREMENTS:
- Preserve all current verified functionality in the affected scope.
- Preserve MacBook UI/control/storage ownership and existing Big Mac compute routing.
- Preserve 127.0.0.1:31337 console binding and existing tailnet-only ingress.
- Preserve canonical output/storage and privacy behavior.
- Preserve FLUX.2 Klein 4B primary and existing secondary target behavior/caveats.
- Preserve Workstation V12 job/event infrastructure, global job center, capability-driven controls, Media indexing/collections, comparison, recipes/macros/repro, and scoped cancellation.
- Preserve unrelated dirty/untracked files.
- Never expose an unavailable capability as working.
- Do not modify unrelated services, model storage, or historical evidence.

FIRST IMPLEMENTATION SLICE:
Implement the shared Concept A foundation and migrate Workstation + Generate into it.

Required deliverables for this slice:
1. shared visual/design tokens including module accents;
2. shared top bar;
3. shared left module navigation;
4. shared module header;
5. shared contextual inspector framework;
6. existing global Job Center/Queue integrated into the shell;
7. reusable Help/Tutorial modal with Quick Start, What It Does, Steps, Tips, FAQ;
8. Workstation rendered in the shell without duplicating full Media/Jobs/System;
9. Generate rendered in the shell with all current supported generation behavior preserved;
10. honest planned/unavailable states for modules/features not yet implemented;
11. responsive and keyboard behavior;
12. no duplicate listeners/SSE subscriptions or lifecycle leaks.

IMPLEMENTATION RULES:
- Inspect current architecture before editing.
- Reuse existing state owners/components/services where practical.
- Prefer progressive disclosure over feature deletion.
- Keep advanced controls available but subordinate.
- Use icon + label + color for module identity.
- Keep technical diagnostics out of primary creative screens.
- Capability state must come from current runtime/source truth.
- Do not add dependencies unless existing primitives cannot reasonably implement the requirement.
- Make the smallest cohesive change that establishes the durable shell architecture.
- One bounded repair pass if required validation fails; then stop and report evidence.

VALIDATION:
- git diff --check
- cd operator-console && npm run check
- cd operator-console && npm test
- run applicable focused browser checks for changed behavior
- inspect the resulting diff for unauthorized collateral change
- validate the real DexDiffusion route for the changed user path
- confirm keyboard/focus behavior
- confirm queue remains operational across module navigation
- confirm Generate capability gating remains truthful
- do not run expensive model generations unless required to prove an affected generation path

DO NOT COMMIT OR PUSH unless the current task explicitly authorizes it.

COMPLETION REPORT:
- Changed
- Preserved
- Validation with exact results
- Still planned/unimplemented
- Risks/blockers
- Git status
```

---

# 24. Executor notes

## Anti-Gravity
Preferred for the main UI architecture pass because the task benefits from direct repository inspection and iterative browser/UI work. Keep scope to one implementation slice at a time.

## Grok Build
Use as fallback with the same contract. Do not let it expand into repo-wide cleanup. Require evidence for every completion claim.

## Claude Code
Strong fit for careful migration/refactor work. Preserve exact project authority and validate that it does not treat a generated mockup as implementation truth.

## Codex
Strong fit for bounded implementation when the slice, acceptance checks, and governing files are explicit. Keep the requested diff cohesive and avoid speculative refactors.

The same acceptance criteria apply regardless of executor.
