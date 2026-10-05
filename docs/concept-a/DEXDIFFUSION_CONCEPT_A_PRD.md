# DexDiffusion Concept A — Product Requirements Document

**Document type:** Product Requirements Document (PRD)
**Status:** Approved direction / implementation not yet started by this document
**Project:** Image_Gen / DexDiffusion
**Repository:** `/Users/andrew/Image_Gen`
**Primary application:** `operator-console/` served at `http://127.0.0.1:31337/dexdiffusion/` and wrapped by `/Applications/DexDiffusion.app`
**Date:** 2026-10-05
**Product direction:** **Concept A — Single-Canvas Workstation**

---

## 1. Executive decision

DexDiffusion will be redesigned around **one shared application shell** rather than a collection of separate-feeling tool surfaces.

The redesign is a **UX migration over the existing proven system**, not a replacement of its runtime architecture. Existing working capabilities, security/privacy boundaries, storage behavior, compute routing, job infrastructure, capability gates, and operational truth surfaces remain protected unless an implementation task explicitly changes them and revalidates the affected behavior.

Concept A is chosen because it solves the actual product problem: DexDiffusion has accumulated substantial capability, but the interface has grown faster than the user's mental model. The next uplift must make the product easier to understand without making it less capable.

The product thesis is:

> **One canvas. Every possibility.**

A user should be able to move from image generation to editing, media management, voice, music, 3D assets, world construction, and cinematic/drama work without feeling that they have entered another application.

---

## 2. Current project truth that this plan must preserve

This PRD is grounded in the current repository state, not only the Concept A mockups.

### 2.1 Current architecture

DexDiffusion is currently a MacBook-hosted local creative application. The MacBook owns the UI, API, job state, metadata, and durable outputs. Big Mac is used for supported remote compute paths through the project's existing controlled bridges.

Protected architectural facts include:

- local operator console remains bound to `127.0.0.1:31337`;
- DexDiffusion tailnet access remains through the existing tailnet-only ingress;
- canonical image outputs remain under `/Users/andrew/images_made`;
- remote image outputs remain ephemeral according to the existing workflow contract;
- the primary FLUX.2 Klein 4B path remains protected;
- existing stable-diffusion.cpp targets remain available according to their current capability status;
- the DEX//REACH service, Ollama/Hermes, and unrelated workloads are outside this redesign's scope.

### 2.2 Existing capabilities that Concept A must surface rather than erase

The current Workstation V12 system already includes important infrastructure that Concept A should inherit:

- same-origin Server-Sent Events job/event bus;
- persistent global Job Center with Active, Queue, and Recent;
- durable job models and restart reconciliation;
- indexed media/library behavior and derived thumbnails;
- Collections / Boards without byte duplication;
- queue ETA and resource HUD;
- capability-driven Basic vs. Advanced controls;
- global command palette and keyboard shortcuts;
- lineage/settings diff;
- synchronized image comparison;
- safe workflow macros;
- reproducibility bundles;
- unified recipes;
- scoped cancellation;
- modularized backend services and a unified frontend live engine.

The redesign must not regress these capabilities merely because their presentation changes.

### 2.3 Existing feature truth

The product already contains a mixture of:

- fully usable features;
- partially usable or proofed features;
- experimental capabilities;
- intentionally unavailable/gated controls;
- internal maintenance functions that should not be promoted into normal creative UI.

Concept A must preserve **truthful capability exposure**. A prettier interface must never make an unavailable feature appear operational.

---

## 3. Problem statement

DexDiffusion has become functionally rich but cognitively expensive.

The problems to solve are:

### 3.1 Fragmented tool identity
Different sections can feel like independent utilities rather than parts of one product.

### 3.2 Inconsistent screen grammar
Users should not have to relearn where controls, settings, help, jobs, or outputs live when switching modules.

### 3.3 Weak cross-module flow
Generated or imported assets should move predictably between generation, editing, media, audio, 3D, world, and drama workflows.

### 3.4 Feature density
Powerful capabilities can become visual noise when everything is exposed simultaneously.

### 3.5 Uneven discoverability
Useful functions can exist but remain effectively invisible because there is no consistent hierarchy or guidance pattern.

### 3.6 Buried learning
Help and onboarding need to be designed as part of the product instead of being an afterthought.

### 3.7 Recovery anxiety
Long-running local generation and multi-step workflows require clear progress, failure, retry, cancellation, and recovery behavior.

---

## 4. Product goals

### G1 — One recognizable shell
Every major creative module uses the same persistent navigation and structural grammar.

### G2 — Faster orientation
A user can identify where they are, what the primary action is, where outputs go, and how to get help without hunting.

### G3 — Lower cognitive load
The default interface exposes essential controls first and advanced controls only when useful.

### G4 — Preserve power
Expert controls remain available. Simplification must not mean feature removal.

### G5 — Strong cross-module flow
Assets should move through the system without ambiguous copies, unexplained destinations, or loss of provenance.

### G6 — Universal learning system
Every module exposes a consistent contextual tutorial/FAQ system.

### G7 — Consistent recovery
Loading, success, warning, error, queue, offline, retry, and cancellation behavior follow shared patterns.

### G8 — Preserve operational truth
The UI reflects actual backend capability state and does not invent unsupported functionality.

### G9 — Extensible design
Future modules should be able to enter the shell without requiring a new navigation philosophy.

---

## 5. Non-goals

Concept A does **not** authorize the following by itself:

- replacing the current generation backend;
- changing model storage;
- changing MacBook/Big Mac ownership boundaries;
- deleting historical outputs or run records;
- removing existing validated features;
- installing new model families or dependencies;
- rewriting the backend because the frontend is being reorganized;
- replacing the existing privacy/prompt-saving contract;
- exposing destructive maintenance commands as normal user actions;
- converting DexDiffusion into a generic cloud SaaS;
- requiring every advanced tool to fit on the initial screen.

---

## 6. Primary users and modes

Concept A must serve two user states without splitting into two products.

### 6.1 Fast-path user
Wants to get a useful result quickly.

Needs:

- obvious starting point;
- sensible defaults;
- plain-language controls;
- strong examples;
- minimal required configuration;
- next-step suggestions.

### 6.2 Power user
Wants full access to settings, queues, comparisons, metadata, advanced editing, assets, and cross-module flows.

Needs:

- advanced settings without artificial limitations;
- reliable keyboard access;
- persistent job visibility;
- provenance and metadata;
- dense tools when intentionally requested;
- predictable locations for expert controls.

The solution is **progressive disclosure**, not a beginner mode and expert mode that drift apart.

---

## 7. Product information architecture

The target navigation contains ten major modules.

| # | Module | Primary role | Section identity |
|---|---|---|---|
| 1 | Workstation | Project hub, resume, quick launch | warm red |
| 2 | Generate | Image creation from prompt/reference | electric blue |
| 3 | Edit | Transform and enhance image assets | violet |
| 4 | Media Library | Central asset source of truth | amber |
| 5 | Voice Lab | TTS, narration, voice assets | cyan |
| 6 | Music Lab | Music, stems, ambience, mastering | teal |
| 7 | 3D Assets | Models, textures, materials | green |
| 8 | World Viewer | 3D environments, placement, camera, render | indigo |
| 9 | Drama Studio | Script, storyboard, scene package | magenta/crimson |
| 10 | Settings / Help | Preferences, system truth, learning | slate gray |

Color must support recognition but never replace an icon, label, heading, or status text.

---

## 8. Universal shell requirements

Every primary module must use the same shell anatomy.

### 8.1 Top bar

Must provide:

- DexDiffusion identity;
- current project/workspace context where relevant;
- global search;
- system/resource state appropriate to the current architecture;
- active job count;
- notification entry;
- account/application menu where applicable.

The top bar should remain stable between modules.

### 8.2 Left navigation rail

Must:

- remain visible on normal desktop layouts;
- show every primary module;
- use consistent icon + label + section accent;
- clearly indicate the active module;
- support keyboard navigation;
- avoid color-only meaning.

### 8.3 Module header

Must include:

- module name;
- concise purpose statement when helpful;
- module-level tabs/modes;
- primary contextual action when appropriate;
- universal help entry.

### 8.4 Main canvas

The central area changes by module but always owns the main task.

The canvas should not become a dumping ground for global controls. Global controls belong in the shell; contextual parameters belong in the inspector or progressive panels.

### 8.5 Right inspector

The right inspector is the canonical place for contextual properties and advanced settings.

It may contain:

- model configuration;
- selected asset properties;
- export settings;
- metadata;
- scene/camera properties;
- audio output settings;
- contextual actions.

When nothing is selected, it should show useful module defaults rather than meaningless empty chrome.

### 8.6 Bottom queue/history

The existing global job infrastructure should become a calm persistent surface.

It must support:

- active jobs;
- queued jobs;
- recent completed jobs;
- progress;
- ETA where evidence supports it;
- cancellation where supported;
- retry when safe;
- reopen result;
- jump to owning module.

The user should be able to keep working while background jobs run.

### 8.7 Universal help entry

Every module must expose the same help affordance and modal anatomy.

---

## 9. Universal Help & Tutorial System

The help system is a product feature, not decoration.

### 9.1 Required tabs

Every module help modal contains:

1. **Quick Start**
2. **What It Does**
3. **Steps**
4. **Tips**
5. **FAQ**

### 9.2 Quick Start

Answers:

- What can I accomplish here?
- What is the shortest successful workflow?
- What should I click first?

Must include a contextual CTA such as **Try it now** when appropriate.

### 9.3 What It Does

Explains:

- the module's purpose;
- when to use it;
- what inputs it accepts;
- what outputs it creates;
- which modules connect to it.

### 9.4 Steps

Provides a concise, ordered workflow.

Steps should describe user intent, not internal implementation details.

### 9.5 Tips

Contains real guidance derived from actual product behavior, such as:

- prompt construction;
- selecting generation settings;
- when to use advanced settings;
- export choices;
- asset reuse;
- recovery suggestions.

### 9.6 FAQ

Must prioritize actual confusion points and support questions.

### 9.7 Behavior requirements

The modal must:

- share the same component across modules;
- change content based on current module;
- be keyboard accessible;
- trap and restore focus correctly;
- close with Escape;
- support first-run auto-open when enabled;
- support a persistent "don't show automatically" preference;
- remain manually reachable at all times;
- not block background jobs.

---

## 10. Module requirements

### 10.1 Workstation

**Purpose:** home base and launch point.

Required surfaces:

- recent projects;
- templates / recipes where appropriate;
- recent assets;
- active job summary;
- quick launch;
- resume recent task;
- system alerts that genuinely need user attention.

The Workstation must not become an all-purpose dashboard. It should emphasize resumption and initiation.

### 10.2 Generate

**Purpose:** image creation.

Required surfaces:

- prompt composer;
- references;
- model target selection;
- aspect/output dimensions;
- essential settings;
- Advanced disclosure;
- generation preview/results;
- variation/retry;
- send to Edit;
- save/use in Media;
- queue status.

Existing capability-driven settings remain authoritative. SD-specific options must not appear as valid for incompatible targets.

### 10.3 Edit

**Purpose:** transform existing images.

Required functions should surface current supported behavior first:

- img2img;
- inpaint;
- supported upscaling;
- supported enhancement paths;
- compare;
- save version;
- send to Media/export.

Unavailable features such as currently gated outpaint/face restore must remain explicitly unavailable until the backend capability exists.

### 10.4 Media Library

**Purpose:** central asset source of truth.

Must integrate current:

- indexed library;
- run history;
- metadata;
- collections;
- filtering/search;
- comparison;
- reuse;
- lineage/provenance when available.

Media should become the primary routing surface for reuse, not another disconnected gallery.

### 10.5 Voice Lab

**Purpose:** voice and narration workflows.

The redesign must preserve actual voice feature availability and expose:

- text/script input;
- voice selection;
- generation controls;
- preview;
- output format;
- results;
- Media/Drama handoff;
- job state.

### 10.6 Music Lab

**Purpose:** music and audio creation workspace.

Planned information architecture:

- Song;
- Instrumental;
- Voiceover/audio-adjacent task entry where supported;
- Stems;
- Mastering.

The richer Music Lab shown in Concept A mockups is a **target UX structure**. Implementation must bind each control to real backend capability before enabling it. No placeholder control may impersonate a working feature.

### 10.7 3D Assets

**Purpose:** individual 3D asset generation/import/inspection.

Must preserve the current division where individual 3D assets belong to 3D and environments belong to World.

Required surfaces:

- asset browser;
- 3D viewport;
- model information;
- materials/textures where supported;
- generation/import actions;
- validation/status;
- send to World Viewer;
- Media/export.

### 10.8 World Viewer

**Purpose:** environment/world assembly and viewing.

Required concepts:

- viewport;
- scene/object organization;
- environment context;
- camera;
- lighting;
- supported generation/import paths;
- render/export;
- clear handoff from 3D Assets.

### 10.9 Drama Studio

**Purpose:** a structured convergence point for narrative and cinematic assembly.

Target modes:

- Script;
- Beats;
- Storyboard;
- Performance;
- Dialogue Polish.

Planned capabilities must be separated into:

- currently backed behavior;
- integrations that can be implemented using existing Media/Voice/Music/World outputs;
- future capabilities requiring backend work.

Drama must not become a fictional UI full of buttons that do nothing.

### 10.10 Settings / Help

**Purpose:** preferences, capability truth, system state, learning, and troubleshooting.

Must retain or expose:

- settings;
- model/capability truth;
- shortcuts;
- system status;
- tutorial index;
- FAQ search;
- diagnostics appropriate for end users.

Internal/destructive maintenance functions remain separated from normal creative use.

---

## 11. Shared interaction requirements

### 11.1 Primary actions
Every module has one obvious primary action for the current state.

Examples:

- Generate
- Apply Edit
- Generate Voice
- Generate Music
- Render
- Export

### 11.2 Secondary actions
Secondary actions must not visually compete with the primary action.

### 11.3 Advanced controls
Advanced settings use disclosure panels/drawers, not permanent full-screen clutter.

### 11.4 Compare
Where comparison exists, interaction should be consistent across modules:

- side-by-side;
- linked zoom/pan where relevant;
- swipe/flicker where relevant;
- clear selection of A/B.

### 11.5 Breadcrumbs / project context
Deep workflows must preserve context so the user knows the project, asset, scene, or module they are editing.

### 11.6 Keyboard
Existing global shortcuts must be preserved unless explicitly redesigned and migrated.

Keyboard behavior should be documented in Settings / Help.

---

## 12. Cross-module asset flow

Concept A treats outputs as reusable project assets rather than dead-end results.

### 12.1 Canonical flow

1. Create or import an asset.
2. Register/display it through the appropriate Media/project surface.
3. Reuse it in another module.
4. Preserve provenance and relevant settings.
5. Track async processing through Queue/History.
6. Export only when the user chooses an external/output boundary.

### 12.2 Expected flows

- Generate → Edit → Media → Export
- Media → Generate or Edit
- Voice → Media → Drama
- Music → Media → Drama
- 3D Assets → World Viewer → Media/Drama/Export
- World Viewer → Drama
- Drama → packaged export

### 12.3 Ownership rule

Every asset surface must answer:

- what is this?
- where is it stored?
- which job/run created it?
- which project/collection contains it?
- what can I do with it next?

---

## 13. System states

The following states are mandatory shared patterns:

| State | Required behavior |
|---|---|
| Empty | explain purpose + next action |
| First-run | contextual onboarding + skip |
| Loading | visible progress, preserve context |
| Queued | show queue position/status, keep working |
| Success | show result + next best actions |
| Warning | explain partial success/caveat |
| Error | plain-language reason + recovery |
| Offline/disconnected | explain limits + retry |
| Cancelled | confirm no longer running + preserve inputs |
| Interrupted/recovered | explain restored state without pretending success |

---

## 14. Error and recovery requirements

Failures should be designed, not improvised.

### 14.1 Model unavailable
Show the exact unavailable target in friendly language.

Offer:

- switch target;
- retry readiness;
- preserve current prompt/settings.

### 14.2 GPU or memory pressure
Offer safe alternatives such as:

- smaller dimensions;
- reduced batch;
- lower-cost preset;
- retry later.

Never silently change requested settings without disclosure.

### 14.3 Upload failure / unsupported file
State:

- what failed;
- accepted file requirements;
- retry action;
- conversion guidance if actually available.

### 14.4 Network interruption
Preserve local inputs.

Reconnect/retry automatically only when idempotent and safe.

### 14.5 Job failure mid-run
Keep:

- prompt/input;
- settings;
- source asset;
- failure status;
- retry path.

### 14.6 Duplicate job / queue conflict
Do not create accidental duplicates silently.

Offer:

- view existing job;
- intentionally duplicate;
- cancel existing job where allowed.

### 14.7 Asset missing
Offer:

- locate/relink;
- search Media;
- restore from known project state if supported.

Never invent a path.

### 14.8 Export failure
Keep the generated asset intact.

Explain the failed export layer separately from asset generation.

### 14.9 Long-running task
Allow work to continue.

Show progress and ETA only when evidence supports the estimate.

### 14.10 Missing tutorial
Fall back to general module help rather than rendering a dead modal.

---

## 15. Accessibility requirements

Concept A inherits and strengthens the existing accessibility contract.

Mandatory:

- complete keyboard navigation;
- visible focus;
- semantic headings;
- accessible names for icon-only buttons;
- no color-only meaning;
- ARIA live updates for async status;
- adequate text contrast;
- reduced-motion support;
- meaningful alt text for content images where appropriate;
- focus trap/restore for modal dialogs;
- minimum practical target sizing for interactive controls.

---

## 16. Visual system

Concept A extends the existing dark native-macOS/operator-console aesthetic.

### 16.1 Base
Use the established dark navy/charcoal family rather than redesigning the app as a bright SaaS dashboard.

### 16.2 Typography
- UI: clean system/technical sans-serif.
- Monospace: paths, hashes, job IDs, logs, seeds, command text only.

### 16.3 Section accents
Module colors provide identity but should stay restrained.

### 16.4 Density
- default screens: medium density;
- inspector/advanced surfaces: denser;
- Workstation/onboarding/help: calmer;
- do not reduce information density by burying frequently used operations behind arbitrary clicks.

---

## 17. Comparative precedent

Concept A is supported by mature creative-tool patterns rather than invented in isolation.

### Blender
Blender uses task-oriented Workspaces that retain one application model while changing the arrangement of editors for modeling, animation, scripting, and other jobs. Concept A adopts the transferable principle: **different work, same application grammar**.

Reference: https://docs.blender.org/manual/en/latest/interface/window_system/workspaces.html

### Figma
Figma centers the canvas while keeping navigation to the left and contextual properties to the right. Concept A uses the same transferable principle: **persistent global structure + selection-sensitive inspector**.

Reference: https://help.figma.com/hc/en-us/articles/360039832014-Design-prototype-and-explore-layer-properties-in-the-right-sidebar

### DaVinci Resolve
DaVinci Resolve separates creative domains into pages such as Media, Edit, Fusion, Color, Fairlight, and Deliver while preserving a single project pipeline. Concept A adapts this as **module identity with explicit cross-module flow**.

Reference: https://documents.blackmagicdesign.com/UserManuals/DaVinci-Resolve-20-Fusion-Visual-Effects.pdf

Concept A should copy none of these interfaces. It should borrow the proven structural ideas that fit DexDiffusion.

---

## 18. Performance and reliability requirements

The redesign must not create a frontend that feels slower because it looks richer.

Requirements:

- module switches should avoid unnecessary full-page reinitialization;
- background job updates should remain event-driven;
- large Media sets should use existing indexed/paginated behavior;
- previews/thumbnails should not force original asset loads unnecessarily;
- hidden modules should not continuously run expensive observers or media rendering;
- modal/help content should load without blocking active work;
- UI state must remain recoverable after refresh/restart according to existing durable-state boundaries.

Any performance claim requires measurement; this PRD does not declare numeric thresholds without a matched benchmark.

---

## 19. Privacy and security requirements

Concept A must preserve the current privacy model.

Particularly:

- unsaved/private prompt behavior stays truthful;
- private data must not leak into lineage/help/log surfaces;
- same-origin API architecture is preserved unless separately approved;
- path containment rules remain enforced;
- UI convenience must not weaken destructive-operation gates;
- capability status must be sourced from the runtime rather than guessed client-side.

---

## 20. Success criteria

### 20.1 Structural
- all primary modules use the shared shell;
- active module identity is obvious;
- help entry is consistent;
- queue/history remains globally available;
- Media is the canonical asset routing surface.

### 20.2 Usability
A user should be able to answer within seconds:

- Where am I?
- What is the main thing I can do here?
- Where are the detailed settings?
- Where will the result go?
- Is my job still running?
- How do I get help?
- How do I recover from failure?

### 20.3 Non-regression
- existing working feature paths remain available;
- capability gating remains truthful;
- current privacy/storage/compute boundaries remain intact;
- current job/event infrastructure remains operational.

### 20.4 Accessibility
The shared shell and universal components meet the accessibility rules in this document and the existing UI build specification.

---

## 21. Implementation phases

### Phase 1 — Foundation
Build the shared shell and design system.

Includes:

- navigation;
- module tokens;
- module header;
- inspector framework;
- queue/history presentation;
- universal help modal;
- shared state components;
- shared form/button/tab patterns.

### Phase 2 — Core module migration
Move existing functionality into the new shell without feature invention.

Recommended order:

1. Workstation
2. Generate
3. Edit
4. Media
5. Settings / Help
6. Voice
7. 3D Assets
8. World Viewer

### Phase 3 — Expanded creative modules
Bind richer target experiences to real capability:

- Music Lab
- Drama Studio
- deeper cross-module handoffs

No control becomes enabled until its backend contract is real.

### Phase 4 — Refinement
- onboarding tuning;
- templates;
- power-user accelerators;
- accessibility hardening;
- performance refinement;
- user-tested information density.

---

## 22. Release gates

Concept A is not complete because screenshots look good.

Before claiming implementation completion:

1. shared shell exists in real source;
2. affected existing features still work;
3. required states exist;
4. capability gating remains truthful;
5. queue/history works across module changes;
6. help modal works in every migrated module;
7. keyboard and focus behavior passes;
8. `npm run check` passes;
9. `npm test` passes;
10. applicable browser suites pass for changed modules;
11. `git diff --check` passes;
12. actual DexDiffusion.app/browser path receives human visual acceptance.

---

## 23. Final product decision

**Proceed with Concept A.**

It is the strongest design because it does not ask DexDiffusion to become less powerful. It asks the product to become understandable.

The current project already has the beginnings of the right platform architecture: event-driven jobs, global job visibility, capability gates, Media indexing, comparison, collections, reusable workflow definitions, 3D/world separation, and strong local-first operational boundaries.

Concept A supplies the missing layer:

**one coherent product experience around that machinery.**
