# DexDiffusion Concept A — UX Specification

**Status:** Approved design direction; implementation specification
**Project:** Image_Gen / DexDiffusion
**Companion PRD:** `docs/concept-a/DEXDIFFUSION_CONCEPT_A_PRD.md`
**Repository authority:** `OPERATIONAL_STATE.md`, `AGENTS.md`, `DEXDIFFUSION.md`, current source and runtime evidence

---

# 1. UX thesis

Concept A turns DexDiffusion into a **single-canvas creative workstation**.

The governing interaction rule is:

> **Same shell. Same logic. Different creative jobs.**

Users should build transferable muscle memory. Switching from Generate to Edit, Media, Voice, Music, 3D, World, or Drama must change the *work*, not the fundamental rules of the interface.

The shell therefore stays stable while the center workspace and contextual inspector adapt.

---

# 2. Universal shell

## 2.1 Desktop structure

The default desktop shell is composed of seven persistent regions:

1. **Top Bar**
2. **Left Navigation Rail**
3. **Module Header**
4. **Main Canvas**
5. **Right Inspector**
6. **Bottom Queue / History**
7. **Universal Help Entry**

The shell may collapse responsively, but the information hierarchy must remain the same.

## 2.2 Top Bar

### Responsibilities
- product identity;
- active project/workspace context;
- global search;
- global system/resource status;
- active-job count;
- notifications;
- global user/application menu.

### Must not contain
- module-specific editing controls;
- full backend diagnostics;
- destructive maintenance actions;
- noisy repeated cards already visible elsewhere.

### Behavior
- remains fixed while switching modules;
- global search can find projects, assets, runs, commands, and help targets that are truly indexed;
- system status should be compact and truthful;
- job count opens the global job surface rather than navigating away.

---

# 3. Left Navigation Rail

## 3.1 Order

1. Workstation
2. Generate
3. Edit
4. Media
5. Voice
6. Music
7. 3D Assets
8. World Viewer
9. Drama
10. Settings / Help

## 3.2 Visual identity

Each module uses a dedicated accent:

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
| Settings / Help | slate |

Every nav item also has:
- icon;
- text label;
- optional short descriptor;
- active-state shape/background.

No meaning may depend on hue alone.

## 3.3 Rail states

### Expanded
Icon + module name + short descriptor.

### Compact
Icon + accessible tooltip/name.

### Keyboard focus
Visible non-color-only focus ring.

### Unavailable module
Still label honestly. If a planned module has no executable backend path, its entry must be marked preview/planned rather than opening a fake working surface.

---

# 4. Module Header

All modules use the same geometry:

- module icon;
- module title;
- short purpose statement;
- horizontal mode tabs;
- contextual help button;
- optional module actions on the right.

Examples:

### Generate
Text to Image | Image to Image | Batch | other capability-backed modes

### Edit
Img2Img | Inpaint | Upscale/Enhance | Compare

### Music
Generate | Stems | Mastering — only as enabled features when backend support exists

### Drama
Script | Beats | Storyboard | Performance | Dialogue Polish — capabilities must be honestly staged as available, preview, or planned

---

# 5. Main Canvas rules

## 5.1 Primary-action clarity

Every screen state must answer:

> What is the most likely thing the user wants to do next?

There should normally be one visually dominant primary action.

## 5.2 Progressive disclosure

Default canvas:
- primary inputs;
- common presets;
- current preview;
- essential settings.

Advanced:
- detailed model parameters;
- specialist controls;
- diagnostic or technical metadata;
- compatibility caveats.

## 5.3 Persistent context

Switching a tab or opening help must not casually erase:
- prompts;
- selected assets;
- masks;
- timeline positions;
- current project/scene;
- unsent form values.

---

# 6. Right Inspector

The Inspector is contextual, not global.

## 6.1 Empty selection
Display:
- module defaults;
- useful settings;
- contextual explanation.

Do not show a blank wall of disabled inputs.

## 6.2 Selected asset
Display:
- identity;
- metadata;
- provenance;
- format/dimensions/duration as relevant;
- available actions;
- compatible destinations.

## 6.3 Advanced controls
Use collapsible groups:
- Basic
- Output
- Model
- Advanced
- Metadata
- Diagnostics, only where genuinely useful

## 6.4 Sticky behavior
Primary output/export controls may remain visible at the bottom of the Inspector when it improves task completion.

---

# 7. Global Queue / History

Concept A should reuse the existing Workstation V12 job infrastructure rather than invent another queue.

## 7.1 Persistent views
- Active
- Queue
- Recent

## 7.2 Job row
A job row can show:
- module icon/color;
- task type;
- short name;
- status;
- progress;
- ETA if evidence-backed;
- output thumbnail/waveform where available;
- cancel;
- retry;
- reopen;
- overflow menu.

## 7.3 Queue rules
- queued work does not block unrelated UI;
- cancellation respects existing scoped-cancellation safeguards;
- a failed job preserves input/settings for recovery;
- interrupted work is visibly distinguished from failed or completed;
- duplicate submission should be detected when feasible.

## 7.4 Notifications
Completion may create a nonintrusive toast/notification with:
- View Result
- Open in Module
- Dismiss

Do not use success notifications for jobs that only reached an intermediate state.

---

# 8. Universal Help / Tutorial modal

## 8.1 Entry points
- module header: **How to use this section**
- Settings / Help tutorial index
- first-run contextual launch
- specific empty/error states

## 8.2 Modal anatomy
Header:
- module icon/accent;
- `How to use [Module]`;
- close control.

Tabs:
1. Quick Start
2. What It Does
3. Steps
4. Tips
5. FAQ

Footer:
- optional **Don't show automatically**
- contextual CTA
- link to full tutorial index

## 8.3 Content contract

### Quick Start
Maximum useful path to a first result.

### What It Does
Input → function → output → connected modules.

### Steps
Ordered workflow with no hidden prerequisite.

### Tips
Only tips that match real product behavior.

### FAQ
Prioritize:
- why a control is unavailable;
- where outputs go;
- which model/tool is being used;
- how to recover failed jobs;
- what privacy/storage behavior applies.

## 8.4 Accessibility
- modal announces title;
- initial focus placed meaningfully;
- focus trapped;
- Escape closes;
- focus restored to trigger;
- tab list uses appropriate semantics;
- tutorial graphics receive useful alt text or are decorative.

---

# 9. Shared state components

Every module uses the same vocabulary and component family.

## 9.1 Empty
Headline + short explanation + primary CTA + help/examples.

## 9.2 First run
Short orientation, not a blocking lecture.

## 9.3 Queued
Status + position if known + **Keep working**.

## 9.4 Processing
Progress + honest stage + cancel when supported.

## 9.5 Success
Result + relevant next actions.

## 9.6 Partial / warning
Explain what succeeded and what did not.

## 9.7 Error
Plain-language cause + retry + alternate safe action.

## 9.8 Interrupted
Explain that the app recovered state but the job did not complete.

## 9.9 Offline / remote unavailable
Distinguish:
- local app available;
- Big Mac unavailable;
- model unavailable;
- network unavailable.

Do not collapse distinct failures into “offline.”

---

# 10. Workstation UX

## 10.1 Purpose
Resume work, start work, see what matters now.

## 10.2 Main sections
- Recent Projects
- Quick Start
- Recent Assets
- Active Jobs
- Templates / Recipes
- Important System Notice, only when actionable

## 10.3 Quick Start examples
- Generate an image
- Edit an image
- Open Media
- Create voice
- Open a 3D asset
- Open World Viewer

Music/Drama quick starts should become active only as implementation makes their workflows real.

## 10.4 Anti-clutter rule
Do not duplicate full Queue, Media, Models, or System panels on Workstation.

---

# 11. Generate UX

## 11.1 Layout
Left/center input column:
- prompt;
- reference inputs;
- style/recipe selection;
- common generation controls.

Center preview:
- current output;
- comparison;
- variation strip;
- selected result.

Right inspector:
- target model;
- compatible parameters;
- output settings;
- advanced details.

## 11.2 Capability-driven UI
The existing capability system remains authoritative.

Example:
When an MFLUX target is selected, SD-specific fields must hide/disable according to capability truth.

## 11.3 Advanced features
Existing features such as:
- controlled sweeps;
- batch;
- X/Y/Z plot;
- wildcard expansion;
- prompt enhancement;
- command preview;
- settings import;
- recipes/macros/repro;

should be reorganized into discoverable advanced groups, not deleted.

## 11.4 Result actions
- Send to Edit
- Save/Open in Media
- Compare
- Reuse settings
- Export
- Generate variation

Actions must reflect actual support.

---

# 12. Edit UX

## 12.1 Modes
Primary:
- Img2Img
- Inpaint
- Upscale / Enhance
- Compare

Unavailable:
- Outpaint remains gated until real support exists.
- Face Restore remains gated until real support exists.

## 12.2 Canvas
Large editing canvas with:
- source;
- mask/edit overlays where relevant;
- zoom/pan;
- compare;
- result selection.

## 12.3 Tool rail
Only controls relevant to active edit mode.

## 12.4 Right Inspector
- model/target;
- strength;
- compatible sampling controls;
- upscale method;
- output dimensions;
- metadata.

## 12.5 Versions
Every completed edit should visibly relate to its parent when lineage exists.

---

# 13. Media Library UX

## 13.1 Role
Media becomes the user's canonical creative library.

## 13.2 Views
- All
- Images
- Video
- Audio
- 3D
- Collections

Only expose categories with actual stored/indexed asset behavior.

## 13.3 Toolbar
- search;
- filters;
- sort;
- collection selector;
- multi-select.

## 13.4 Card/row metadata
At minimum:
- preview;
- type;
- name;
- creation time;
- originating module/job;
- collection membership where relevant.

## 13.5 Detail panel
- larger preview;
- metadata;
- lineage/settings;
- privacy state;
- use/open actions;
- export.

## 13.6 Existing behavior to preserve
- incremental index;
- pagination;
- derived thumbnails;
- collections without duplicating bytes;
- comparison;
- replay/reuse where supported.

---

# 14. Voice Lab UX

## 14.1 Layout
Input:
- script/text;
- voice selection;
- common voice controls.

Preview:
- waveform/player;
- generated versions.

Inspector:
- output format;
- advanced voice settings that are truly supported;
- metadata.

## 14.2 Handoff
Results can:
- save to Media;
- export;
- attach to Drama when Drama integration is implemented.

## 14.3 Error handling
Differentiate:
- voice unavailable;
- invalid input;
- generation failed;
- output file failed;
- remote dependency unavailable.

---

# 15. Music Lab UX target

Music Lab should feel like a restrained creative audio workstation, not a miniature professional DAW dumped into the application.

## 15.1 Target tabs
- Song
- Instrumental
- Stems
- Mastering
- related audio modes only when supported.

## 15.2 Default Generate layout
Input:
- natural-language music description;
- genre;
- mood;
- tempo;
- instrumentation;
- duration.

Center:
- player;
- waveform;
- arrangement preview;
- generated variants.

Inspector:
- model/engine;
- structure;
- quality;
- export format;
- mastering/stem options.

## 15.3 Progressive disclosure
Beginner:
- prompt + presets + generate.

Advanced:
- structure;
- arrangement;
- stems;
- mastering.

## 15.4 Capability rule
The target UI is a specification, not evidence that Music generation exists today. Controls remain disabled/planned until implementation proves them.

---

# 16. 3D Assets UX

## 16.1 Primary screen
- asset library;
- active 3D preview;
- generation/import state;
- model properties;
- materials/textures where supported;
- export / send to World Viewer.

## 16.2 Preserve project boundary
Individual object generation belongs to 3D Assets.
Environment/360 work belongs to World Viewer.

## 16.3 Heavy compute state
3D jobs must integrate into global Queue with truthful remote compute ownership and cancellation behavior.

---

# 17. World Viewer UX

## 17.1 Main canvas
Large viewport.

## 17.2 Left/secondary structure
Scene tree / environment assets as appropriate.

## 17.3 Inspector
- selected object transform;
- camera;
- lighting;
- environment;
- render properties.

## 17.4 Entry paths
- open existing world;
- create/open sample environment;
- receive 3D Asset;
- receive Media reference where supported.

## 17.5 Exit paths
- render;
- Media;
- Drama integration;
- export.

---

# 18. Drama Studio UX target

Drama should be a high-level assembly workspace.

## 18.1 Tabs
- Script
- Beats
- Storyboard
- Performance
- Dialogue Polish

## 18.2 Script
- premise;
- cast;
- goals/stakes;
- scene list;
- script editor;
- scene preview.

## 18.3 Beats
Story progression / scene-level purpose without turning the interface into a writing textbook.

## 18.4 Storyboard
- shot list;
- generated/reference frames;
- duration;
- shot purpose;
- reorder;
- regenerate where backed.

## 18.5 Performance
Character emotional intent, narration/performance notes, voice linkage.

## 18.6 Dialogue Polish
Focused revision surface, not a replacement for the full script editor.

## 18.7 Integrations
Drama is expected to consume:
- Media;
- Voice;
- Music;
- World renders/scene assets.

## 18.8 Capability rule
Each integration must surface a real asset contract. The UX may preview future capability but cannot pretend execution exists.

---

# 19. Settings / Help UX

Top-level sections:

- General
- Appearance
- Models / Capabilities
- Storage
- Notifications
- Keyboard
- Help / Tutorials
- System

## 19.1 Models / Capabilities
Should be a human-readable view over real capability truth.

Differentiate:
- Available
- Available with caveat
- Experimental
- Unavailable
- Planned

## 19.2 System
Keep advanced diagnostics out of ordinary creative screens.

## 19.3 Destructive operations
Any cleanup/delete operation must be separated, explained, and confirmed. Existing hidden maintenance should not be surfaced casually.

---

# 20. Modal / drawer rules

## Modal
Use for:
- tutorials;
- confirmations;
- short focused decisions.

## Right drawer
Use for:
- export configuration;
- queue details;
- detailed metadata;
- advanced nonblocking options.

## Inline panel
Use for:
- persistent contextual controls;
- inspectors;
- tool settings.

## Full screen/module switch
Use when:
- the user's primary job changes.

---

# 21. Microcopy rules

Use:
- concrete nouns;
- direct verbs;
- explicit state.

Prefer:
- **Generate Image**
- **Retry Job**
- **Open in Media**
- **Send to Edit**
- **Model unavailable**

Avoid:
- **Do Magic**
- **Oops**
- **Something went wrong**
- unexplained technical exceptions

Technical details can be available under **Details** without becoming the primary error message.

---

# 22. Responsive behavior

Desktop remains primary.

At narrower widths:

1. collapse left nav to icons;
2. make Inspector a drawer;
3. keep main canvas primary;
4. move queue to a persistent drawer/button with active count;
5. retain module identity and help;
6. avoid horizontally squeezing dense creative controls until unreadable.

Touch targets must remain usable.

---

# 23. Accessibility acceptance

Every shared component must be tested for:

- tab order;
- focus visibility;
- focus return;
- escape behavior;
- screen-reader names;
- status announcements;
- non-color states;
- reduced motion;
- contrast;
- keyboard-only completion of primary tasks.

---

# 24. UX non-regression contract

A Concept A implementation is defective if it:

- removes a working capability to make a screen cleaner;
- exposes a gated capability as working;
- changes canonical output ownership unintentionally;
- breaks global jobs/history;
- breaks prompt privacy;
- hides failure details needed to recover;
- introduces multiple inconsistent modal/help systems;
- creates module-specific navigation rules;
- duplicates assets to fake cross-module handoff;
- makes a background task block unrelated work.

---

# 25. Final UX acceptance statement

Concept A succeeds when DexDiffusion feels like **one instrument with multiple modes**, rather than a pile of powerful tools sharing a folder.
