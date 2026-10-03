# Edit workbench, exact image recall, resources and fullscreen (2026-10-02)

Replaces the earlier Edit screen (static template + `buildInpaintTools` + 384×384 mask canvas).
Code: `public/dexdiffusion/edit-core.js` (pure, unit-tested), `edit-ui.js`, `lightbox.js`;
server: per-image generation record in `workstation.js`/`server.js`.

## Recon lessons (read-only, 2026-10-02) and what was taken from them

| Source | Mechanism | Used here |
|---|---|---|
| AUTOMATIC1111 | "Send to img2img/inpaint" moves the selected image; generation parameters are re-read from the image (PNG Info / "Read parameters"), not from the current form | `openImageInEdit(imageId, mode)` loads **that image's** record |
| InvokeAI | Info/recall menu restores parameters from the image's own metadata (Use all / prompt / seed); image-to-image routing moves the exact image | recall is metadata-driven; banner shows what was restored; "Re-apply source settings" |
| Forge / Fooocus | Input-image mode with progressive disclosure (Advanced toggles), one primary action | one Run button for img2img/Inpaint/Outpaint; secondary sections are accordions |

No source code was copied; only UX/mechanism ideas.

## The defects and what changed

1. **Wrong parameters in Edit.** Edit used `i2i*` fields and the Create form; images stored no sampler/VAE/LoRA/prompt.
   Now every canonical output gets an effective generation record (`gen_schema: 1`) in
   `sdcpp-workflow/state/image-meta.json`: target, seed, size, steps, cfg, sampler, scheduler, vae, preset,
   structured `loras`, `edit_target`, `strength`, `prompt_saved`, and prompt/negative **only when prompt saving was on**
   (the store itself refuses prompt text unless `prompt_saved === true`).
   `GET /api/images/:id/meta` returns a `recall` object built by the shared `buildRecall()`.
   Multi-output runs record each image with its own seed. Edit state is built by `applyRecallToEdit(recall, {snapshot})`,
   which has no access to the Create form by construction.
2. **Privacy.** Prompt saving off → structured settings are still recalled; the prompt shows
   `Source prompt unavailable — prompt saving was off`. An in-memory, same-session snapshot (`_snaps`, never persisted)
   restores the prompt for images made in this tab. Create's text is never substituted.
3. **"Run does nothing".** Reproduced 2026-10-02: with an empty prompt (the normal state for a Library image) Run sent nothing and
   only flashed a 3 s toast; the old Edit panel also had no progress. Now a blocked Run explains itself inline
   ("Enter a prompt — Source prompt unavailable…"), a click on a blocked Run surfaces the reason, and there is
   no empty `catch` on the run path: failures show **stage + actual message** (`request`, `polling`, job gate, `result-resolution`)
   with a safe retry (re-run, or re-attach to the same job id after a polling loss).
   Text inputs write state on `input` without re-rendering (and Run is patched in place), so typing then clicking
   can never be lost to a DOM rebuild.
4. **Progress.** `GET /api/jobs/:id` now carries `stage` (from `deriveStage`). Percent is shown only when sd-cli's own log reported
   `N/M - s/it` sampling steps; weight-loading `MB/s` bars are ignored; otherwise stage text + an indeterminate bar.
   Stages: waiting for Big Mac (with owner) → checking Big Mac/model → uploading → encoding/loading → sampling step N/M → decoding →
   validating → transferring → complete/failed (stage and gate). The redaction filter in `sdcpp-img2img.sh`/`sdcpp-inpaint.sh` now
   splits on `\r` and flushes so progress arrives live.
5. **Mask editor.** One transformed stage (source `<img>` + canvas, both at source resolution) inside a viewport; pointer events are
   converted with `screenToImage()` (pure geometry in `edit-core.js`, unit-tested for square/landscape/portrait/odd sizes,
   zoom, pan, resize). Fit (default, whole image visible), 100%, ± and slider zoom (to 16×), Pan tool / Space / middle button,
   Ctrl/⌘+wheel and pinch, brush ring, undo/redo, grow/shrink/feather/blur/invert/clear. The viewport carries `data-no-fullscreen`.
   The mask PNG sent to the backend has the source's own pixel dimensions.
6. **Fullscreen.** One viewer (`lightbox.js`, `window.DexLightbox`). Elements opt in with `data-fullscreen` (+ `-src`, `-image-id`, `-caption`).
   Rule: large/primary images (Create hero, Edit source/result, Library thumbnails and detail, compare panes, Enhance, queue/A-B thumbs,
   legacy run cards) open it on click; **selector strips** (Create filmstrip, Edit results strip) select on the first click and open it on a
   click of the already-active thumbnail. Library thumbnails have a ⓘ button to select for details. Never inside `[data-no-fullscreen]`.
   Esc/✕ close, focus is trapped and returned, Fit/100%, and the viewer offers `→ img2img / Inpaint / Outpaint / Details` for that exact image.
7. **Resources.** LoRAs are structured state (`createLoras`, `ed.state.loras`: `{name, weight}`), shown in a Resources panel in
   Create and Edit with weight sliders, trigger words, compatibility from the discovered catalog (`/api/extra-networks?target=`) and VAE.
   The server serializes `loras` → `<lora:name:weight>` at the request boundary (`EC.resolveResources`; tags typed in the prompt still
   merge; structured wins). Incompatible LoRAs after a model change are held back unless the user chooses "Use anyway".
   `sdcpp-img2img.sh`/`sdcpp-inpaint.sh` gained the same `--lora-model-dir` handling as Create (guarded; fails with gate `lora-dir`
   if the directory is missing). **No LoRA file exists on Big Mac**, so a real LoRA render is TEST WITHHELD (LIM-008).
8. **Model picker.** Concise trigger (name · family · readiness) and a searchable popover grouped by family with readiness and a
   one-line blurb; the detailed card browser is unchanged ("Browse Models").
9. **Edit layouts.** `A · Compact` and `B · Studio` are thin layouts over one state (`this.ed`); preference persists in
   `localStorage.dex_edit_layout`. Edit runs on the **active SDCPP slot model**; a recalled model that differs is activated through the existing
   managed-slot route as a visible "Switching edit model" stage on Run. A FLUX-made source shows "cannot run image edits" and uses the active SDCPP model.
10. **Presets.** Recipes are versioned (`v: 2`, `mode: create|img2img|inpaint|outpaint`, `loras`, outpaint extents). Legacy recipes migrate on
    load; prompt text is stored only when prompt saving is on; sources are never part of a preset.

## Tests

`tests/edit-core.test.js`, `tests/edit-resources-server.test.js`, plus additions in `workstation.test.js`/`client-workstation.test.js`.
Browser acceptance (real Chrome, hermetic fixtures): `npm run test:browser`
(`tests/browser/edit-workbench.browser.js`, `voice-drama.browser.js`).
