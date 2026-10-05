# DexDiffusion Concept A — Screen-by-Screen Implementation Checklist

**Purpose:** execution checklist for implementing Concept A without regressing proven DexDiffusion behavior
**Companion documents:**
- `DEXDIFFUSION_CONCEPT_A_PRD.md`
- `DEXDIFFUSION_CONCEPT_A_UX_SPEC.md`
- `DEXDIFFUSION_CONCEPT_A_AGENT_HANDOFF.md`

**Rule:** A box is not complete because markup exists. It is complete only when the real user path works and applicable validation passes.

---

# 0. Pre-implementation gates

## Repository and authority
- [ ] Confirm repository root is `/Users/andrew/Image_Gen`.
- [ ] Confirm active branch and remote before mutation.
- [ ] Read `OPERATIONAL_STATE.md`.
- [ ] Read `AGENTS.md`.
- [ ] Read `DEXDIFFUSION.md`.
- [ ] Read `docs/operator-console-ui-build-spec.md`.
- [ ] Read `docs/feature-function-inventory.md`.
- [ ] Read the Concept A PRD and UX specification.
- [ ] Preserve unrelated dirty/untracked files.
- [ ] Do not treat historical reports as current runtime proof.

## Protected behavior
- [ ] Preserve loopback operator console binding.
- [ ] Preserve tailnet-only DexDiffusion ingress.
- [ ] Preserve canonical output ownership under `/Users/andrew/images_made`.
- [ ] Preserve primary FLUX.2 Klein 4B path.
- [ ] Preserve secondary stable-diffusion.cpp targets and capability caveats.
- [ ] Preserve prompt/privacy behavior.
- [ ] Preserve truthful progress.
- [ ] Preserve DEX//REACH, Ollama/Hermes, and unrelated workloads.
- [ ] Do not delete historical outputs/evidence.
- [ ] Do not promote unavailable features to working controls.

---

# 1. Foundation — shared shell

## 1.1 Design tokens
- [ ] Define base background/surface tokens using current dark navy/charcoal visual authority.
- [ ] Define primary/secondary text tokens.
- [ ] Define border/focus tokens.
- [ ] Define semantic status tokens: success, warning, error, information.
- [ ] Define module accent tokens:
  - [ ] Workstation — warm red
  - [ ] Generate — electric blue
  - [ ] Edit — violet
  - [ ] Media — amber
  - [ ] Voice — cyan
  - [ ] Music — teal
  - [ ] 3D — green
  - [ ] World — indigo
  - [ ] Drama — magenta/crimson
  - [ ] Settings/Help — slate
- [ ] Verify section identity does not rely on color alone.

## 1.2 Global shell
- [ ] Implement one top bar component.
- [ ] Implement one left navigation component.
- [ ] Implement one module-header component.
- [ ] Implement one main-canvas region.
- [ ] Implement one right-inspector framework.
- [ ] Integrate existing Job Center/queue into one persistent bottom/drawer surface.
- [ ] Implement one universal help entry.
- [ ] Preserve responsive behavior.
- [ ] Preserve native wrapper compatibility.

## 1.3 Navigation
- [ ] All modules use a shared navigation data source.
- [ ] Active module state is singular and obvious.
- [ ] Keyboard navigation works through all nav items.
- [ ] Compact rail provides accessible names/tooltips.
- [ ] Module order matches approved information architecture.
- [ ] Planned/unavailable modules are truthfully marked.

## 1.4 Top bar
- [ ] Global search remains accessible.
- [ ] Job count reflects actual job state.
- [ ] Resource/system indicator reflects actual system state.
- [ ] Notification control is keyboard accessible.
- [ ] No module-specific controls leak into the global bar.

---

# 2. Foundation — shared components

## 2.1 Buttons
- [ ] Primary action variant.
- [ ] Secondary action variant.
- [ ] Tertiary/ghost variant.
- [ ] Destructive variant.
- [ ] Disabled state.
- [ ] Loading state.
- [ ] Visible keyboard focus.
- [ ] Icon-only button accessible names.

## 2.2 Tabs
- [ ] Shared tab component.
- [ ] Keyboard arrow navigation where appropriate.
- [ ] Selected state uses semantics + more than color.
- [ ] Overflow strategy exists for narrow layouts.

## 2.3 Form controls
- [ ] Shared label/help/error pattern.
- [ ] Text field.
- [ ] Textarea.
- [ ] Select/dropdown.
- [ ] Toggle.
- [ ] Slider.
- [ ] Numeric field.
- [ ] Chip/tag.
- [ ] File/reference picker.
- [ ] Validation message.
- [ ] Disabled capability explanation.

## 2.4 Inspector groups
- [ ] Collapsible section.
- [ ] Basic/Advanced separation.
- [ ] Context-specific empty state.
- [ ] Sticky primary action where justified.

## 2.5 Drawers and dialogs
- [ ] Right drawer.
- [ ] Confirmation dialog.
- [ ] Destructive confirmation.
- [ ] Universal tutorial modal.
- [ ] Focus trap.
- [ ] Escape behavior.
- [ ] Focus restoration.
- [ ] Background interaction blocked only when appropriate.

## 2.6 Toasts/status
- [ ] Information.
- [ ] Success.
- [ ] Warning.
- [ ] Error.
- [ ] Actionable completion notification.
- [ ] ARIA live behavior.
- [ ] Reduced-motion behavior.

---

# 3. Universal Help / Tutorial System

## 3.1 Framework
- [ ] One reusable help modal component exists.
- [ ] Module determines content through data/config, not duplicated markup.
- [ ] Tabs: Quick Start / What It Does / Steps / Tips / FAQ.
- [ ] Each module has a stable help ID.
- [ ] Help is reachable from module header.
- [ ] Help index exists in Settings / Help.
- [ ] First-run auto-open preference is persistent.
- [ ] Manual help remains available after auto-open is disabled.

## 3.2 Content completeness
For each module:
- [ ] Quick Start written.
- [ ] What It Does written.
- [ ] Steps written.
- [ ] Tips written.
- [ ] FAQ written.
- [ ] Output destination explained.
- [ ] Capability caveats represented.
- [ ] Recovery guidance included.
- [ ] Cross-module next actions included.

## 3.3 Failure behavior
- [ ] Missing module tutorial falls back to general module help.
- [ ] Help failure does not block creative work.
- [ ] No dead tutorial links.
- [ ] Search result opens the correct tab/module.

---

# 4. Global Queue / History

## 4.1 Existing V12 preservation
- [ ] Reuse existing SSE/event architecture.
- [ ] Reuse current job ownership/status.
- [ ] Preserve Active / Queue / Recent semantics.
- [ ] Preserve scoped cancellation.
- [ ] Preserve restart/interrupted reconciliation.
- [ ] Preserve ETA truth rules.
- [ ] Preserve privacy-safe event payloads.

## 4.2 New presentation
- [ ] Module icon/accent visible.
- [ ] Task name visible.
- [ ] Status visible.
- [ ] Progress visible when real.
- [ ] ETA visible only when supported.
- [ ] Cancel available only when supported.
- [ ] Retry restores original context.
- [ ] Reopen goes to owning module/result.
- [ ] Queue can be opened from every module.
- [ ] Module switching does not stop jobs.

---

# 5. Workstation screen

## Structure
- [ ] Shared shell present.
- [ ] Recent Projects.
- [ ] Quick Start.
- [ ] Recent Assets.
- [ ] Active Jobs summary.
- [ ] Templates/Recipes.
- [ ] Actionable system notice region.

## Actions
- [ ] Create project.
- [ ] Open project.
- [ ] Resume recent task.
- [ ] Jump to Generate.
- [ ] Jump to Edit.
- [ ] Jump to Media.
- [ ] Jump to Voice.
- [ ] Jump to 3D.
- [ ] Jump to World.
- [ ] Music/Drama actions accurately reflect implementation status.

## Anti-clutter
- [ ] Full Media grid is not duplicated here.
- [ ] Full Job Center is not duplicated here.
- [ ] Full Models/System panel is not duplicated here.
- [ ] No giant backend diagnostics dominate the page.

## States
- [ ] No projects.
- [ ] Recent project exists.
- [ ] Active jobs.
- [ ] Recovered/interrupted work.
- [ ] Backend dependency warning.

---

# 6. Generate screen

## Inputs
- [ ] Prompt.
- [ ] Negative prompt only when compatible.
- [ ] Reference input where supported.
- [ ] Recipe/style controls.
- [ ] Model target.
- [ ] Aspect/size controls.
- [ ] Seed controls.
- [ ] Quantity/batch.
- [ ] Compatible sampler/scheduler.
- [ ] Compatible VAE.
- [ ] Advanced disclosure.

## Capability truth
- [ ] MFLUX hides/disables incompatible SD controls.
- [ ] Staged/proofed/experimental targets retain truthful labels.
- [ ] Unsupported CLIP skip remains unavailable.
- [ ] Unsupported variation controls remain unavailable.
- [ ] Face restore remains unavailable until backend support exists.
- [ ] Hires behavior is accurately described rather than mislabeled.

## Existing advanced workflows preserved
- [ ] Batch generation.
- [ ] Controlled sweep.
- [ ] X/Y/Z plot with existing limits/caveats.
- [ ] Prompt drafts.
- [ ] Styles/recipes.
- [ ] Wildcards.
- [ ] Ollama enhancement where dependency is available.
- [ ] Command preview.
- [ ] Settings import.
- [ ] Retry.
- [ ] Repro/recipe/macro workflows as currently supported.

## Results
- [ ] Preview.
- [ ] Variation thumbnails.
- [ ] Compare.
- [ ] Metadata.
- [ ] Send to Edit where supported.
- [ ] Send/save to Media.
- [ ] Export.
- [ ] Reuse settings.

## States
- [ ] Empty prompt.
- [ ] Validation error.
- [ ] Queued.
- [ ] Generating.
- [ ] Completed.
- [ ] Failed.
- [ ] Interrupted.
- [ ] Model unavailable.
- [ ] Remote compute unavailable.

---

# 7. Edit screen

## Modes
- [ ] Img2Img.
- [ ] Inpaint.
- [ ] Upscale.
- [ ] Real-ESRGAN path with dependency caveat.
- [ ] Existing partial Hires Fix accurately represented.
- [ ] Compare.
- [ ] Outpaint shown only as unavailable/planned.
- [ ] Face Restore shown only as unavailable/planned.

## Canvas
- [ ] Zoom/pan.
- [ ] Source preview.
- [ ] Mask tooling for inpaint.
- [ ] Before/after.
- [ ] Result selection.

## Inspector
- [ ] Mode-specific controls only.
- [ ] Target/model capability state.
- [ ] Denoise strength where relevant.
- [ ] Upscale algorithm/options.
- [ ] Output size.
- [ ] Metadata.

## Handoff
- [ ] Save version.
- [ ] Open in Media.
- [ ] Export.
- [ ] Return/reuse in Generate where supported.

---

# 8. Media Library

## Views
- [ ] Recent.
- [ ] Images.
- [ ] Other asset categories only when actual index/storage contracts exist.
- [ ] Collections.

## Existing infrastructure
- [ ] Incremental index preserved.
- [ ] Server-side query/filter/sort preserved.
- [ ] Pagination preserved.
- [ ] Thumbnail service preserved.
- [ ] Path traversal protections preserved.
- [ ] Collections use canonical IDs without byte duplication.
- [ ] Run detail metadata preserved.
- [ ] Comparison preserved.
- [ ] Reuse/replay preserved subject to privacy.
- [ ] Copy settings behavior preserved.
- [ ] Viewer/context actions preserved.

## New UX
- [ ] Search is prominent.
- [ ] Filters are understandable.
- [ ] Multi-select has visible selection count.
- [ ] Selected asset opens contextual inspector/detail.
- [ ] Origin module/job visible.
- [ ] Collection membership visible.
- [ ] Compatible destinations visible.

---

# 9. Voice Lab

- [ ] Shared shell.
- [ ] Voice accent = cyan.
- [ ] Script/text input.
- [ ] Voice picker.
- [ ] Supported voice controls.
- [ ] Preview/player.
- [ ] Output options.
- [ ] Job state.
- [ ] Media handoff.
- [ ] Export.
- [ ] Drama handoff only when real.
- [ ] Universal help content.
- [ ] Empty/loading/success/error/queued states.
- [ ] Applicable existing voice browser tests pass.

---

# 10. Music Lab

## UX target
- [ ] Shared shell.
- [ ] Music accent = teal.
- [ ] Tabs defined from real capabilities.
- [ ] Prompt-first default flow.
- [ ] Genre/mood/tempo controls mapped to actual backend contract.
- [ ] Player/waveform.
- [ ] Arrangement/timeline only when backed by real data.
- [ ] Stem controls only when real.
- [ ] Mastering controls only when real.
- [ ] Save to Media.
- [ ] Export.
- [ ] Drama handoff only when real.
- [ ] Tutorial/FAQ.

## Hard gate
- [ ] No enabled Music control exists without executable backend support or an explicitly labeled preview/planned state.

---

# 11. 3D Assets

## Existing capability protection
- [ ] Hunyuan 3D job path preserved.
- [ ] Generic job store integration preserved.
- [ ] Heavy-compute lease preserved.
- [ ] Staging preserved.
- [ ] Canonical media/store behavior preserved.
- [ ] Checksum-verified transfer behavior preserved.
- [ ] Remote cleanup preserved.
- [ ] Existing SHARP Quick3D comparison path preserved where applicable.

## UX
- [ ] 3D accent = green.
- [ ] Asset library.
- [ ] Active viewport.
- [ ] Import/generate.
- [ ] Model information.
- [ ] Material/texture controls only when supported.
- [ ] Validation/status.
- [ ] Send to World.
- [ ] Media/export.

## Boundary
- [ ] Individual assets stay in 3D.
- [ ] Environment/world creation stays in World.

---

# 12. World Viewer

- [ ] Shared shell.
- [ ] World accent = indigo.
- [ ] Viewport remains primary.
- [ ] Scene/object organization is clear.
- [ ] Camera controls.
- [ ] Lighting controls.
- [ ] Environment controls.
- [ ] 3D asset handoff.
- [ ] Render/export actions.
- [ ] Media handoff.
- [ ] Drama handoff only when real.
- [ ] Reset/recovery for camera/navigation.
- [ ] Universal help.

---

# 13. Drama Studio

## Target structure
- [ ] Shared shell.
- [ ] Drama accent = magenta/crimson.
- [ ] Script.
- [ ] Beats.
- [ ] Storyboard.
- [ ] Performance.
- [ ] Dialogue Polish.
- [ ] Scene list.
- [ ] Scene preview.
- [ ] Asset attachments.
- [ ] Export package.

## Integrations
- [ ] Media asset contract.
- [ ] Voice asset contract.
- [ ] Music asset contract.
- [ ] World/render asset contract.

## Hard gates
- [ ] Every enabled action has a real executable path.
- [ ] Planned actions are visually and semantically marked planned.
- [ ] No fake generation state.
- [ ] No invented “AI assistant” functionality unless implemented.
- [ ] Export package contents are explicit.

---

# 14. Settings / Help

## Sections
- [ ] General.
- [ ] Appearance.
- [ ] Models / Capabilities.
- [ ] Storage.
- [ ] Notifications.
- [ ] Keyboard.
- [ ] Help / Tutorials.
- [ ] System.

## Capability ledger
- [ ] Available.
- [ ] Available with caveat.
- [ ] Experimental.
- [ ] Unavailable.
- [ ] Planned.

## Safety
- [ ] Destructive maintenance separated from ordinary settings.
- [ ] Cleanup actions require explicit confirmation/evidence.
- [ ] System diagnostics do not crowd creative modules.

---

# 15. Cross-module flows

## Generate → Edit → Media
- [ ] Selected generated image can enter Edit without manual path copying.
- [ ] Edit preserves source identity.
- [ ] Edited result registers correctly in Media/history.
- [ ] Back/reopen route works.

## Media → Generate/Edit
- [ ] Compatible image can be chosen as reference/source.
- [ ] Unsupported types show a clear explanation.
- [ ] No duplicate bytes merely for handoff.

## 3D → World
- [ ] Asset identity survives handoff.
- [ ] World opens/places or offers place action.
- [ ] Failure does not lose generated asset.

## Voice/Music → Drama
- [ ] Define asset schema/contract before implementation.
- [ ] User sees attached source and duration/type.
- [ ] Missing asset can be relinked.

## World → Drama
- [ ] Define scene/render handoff.
- [ ] Do not imply editable 3D scene transfer if only rendered media is passed.

---

# 16. Error/recovery acceptance matrix

For every module, verify:

- [ ] user input remains after ordinary failure;
- [ ] retry is available when safe;
- [ ] cancel is available when supported;
- [ ] alternate path is offered when useful;
- [ ] technical details are available but not the primary message;
- [ ] failed export does not destroy source result;
- [ ] remote failure is distinguished from local UI failure;
- [ ] model/capability unavailability is explicit;
- [ ] interrupted state is not mislabeled completed;
- [ ] background jobs survive navigation.

---

# 17. Accessibility checklist

- [ ] Full keyboard navigation.
- [ ] Visible focus.
- [ ] Logical focus order.
- [ ] Icon-only buttons named.
- [ ] No color-only meaning.
- [ ] ARIA live for async job status.
- [ ] Help modal focus trap.
- [ ] Help modal focus restoration.
- [ ] Escape stack remains sane.
- [ ] Reduced motion.
- [ ] Contrast.
- [ ] Useful alt text.
- [ ] Touch target sizing in compact layouts.
- [ ] Zoom/text scaling does not destroy primary flows.

---

# 18. Performance/lifecycle checklist

- [ ] Module switching does not recreate global listeners repeatedly.
- [ ] SSE subscriptions are singular/cleaned up.
- [ ] Hidden modules do not run heavy rendering loops unnecessarily.
- [ ] Media uses paginated/indexed data.
- [ ] Thumbnails used instead of loading originals for grids.
- [ ] World/3D render loops pause/dispose appropriately when hidden.
- [ ] Modals/drawers clean up listeners.
- [ ] No unbounded queue/history DOM growth.
- [ ] Long sessions do not accumulate duplicate event handlers.

---

# 19. Responsive checklist

- [ ] Left nav collapses gracefully.
- [ ] Right Inspector becomes a drawer before crushing the canvas.
- [ ] Queue becomes accessible drawer/button with job count.
- [ ] Module header remains legible.
- [ ] Primary action remains visible.
- [ ] Tables/grids have usable mobile/narrow behavior.
- [ ] Creative canvas remains prioritized.

---

# 20. Validation ladder

For each implementation slice:

1. [ ] `git diff --check`
2. [ ] static/syntax checks for affected files
3. [ ] focused tests for changed component/module
4. [ ] `cd operator-console && npm run check`
5. [ ] `cd operator-console && npm test`
6. [ ] applicable browser suite:
   - [ ] `npm run test:browser:edit`
   - [ ] `npm run test:browser:voice`
   - [ ] `npm run test:browser:matrix`
7. [ ] real wrapper/browser user-path check for affected UI
8. [ ] visual acceptance for affected desktop/narrow layout
9. [ ] capability truth check against `/api/capabilities`
10. [ ] operational-state update only for materially changed/verified behavior

Do not run model renders merely to validate documentation or shell styling unless an affected runtime path actually requires them.

---

# 21. Definition of done

Concept A implementation is complete only when:

- [ ] all migrated modules share one shell;
- [ ] all currently supported functionality remains reachable;
- [ ] unavailable features remain truthfully unavailable;
- [ ] Media is the clear asset hub;
- [ ] Queue/History is globally visible;
- [ ] universal Help works across modules;
- [ ] primary cross-module flows pass;
- [ ] error/recovery patterns are shared;
- [ ] keyboard/accessibility baseline passes;
- [ ] required repository tests pass;
- [ ] actual rendered UI receives human acceptance;
- [ ] no unrelated user files were changed;
- [ ] operational state accurately records the new verified baseline.
