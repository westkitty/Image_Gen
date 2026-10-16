\# DexDiffusion: Whole-Workstation A1111 Generation-Parity Implementation Blueprint  
  
\*\*Plan status:\*\* READ-ONLY REPOSITORY STUDY; NOT IMPLEMENTED   
\*\*Compiled:\*\* 2026-10-16   
\*\*DexDiffusion:\*\* \`westkitty/Image\_Gen\`, GitHub \`main\` HEAD \`169ad079af02a22d738079276291c93c86bf299f\`; MacBook path \`/Users/andrew/Image\_Gen\`.   
\*\*AUTOMATIC1111 baseline:\*\* \`AUTOMATIC1111/stable-diffusion-webui\` commit \`82a973c04367123ae98bd9abdf80d9eda9b910e2\`.   
\*\*Companion gate:\*\* \[\`DEXDIFFUSION\_A1111\_PARITY\_LEDGER.json\`\](./DEXDIFFUSION\_A1111\_PARITY\_LEDGER.json), \*\*258 provisional atomic obligations\*\*.   
\*\*Exclusions:\*\* Training, checkpoint merging. This excludes their features and infrastructure but \*\*not\*\* inference-time LoRA/embedding/hypernetwork usage or inference-time token merging.  
  
\> \*\*Evidence boundary:\*\* The installed MacBook is on the specified branch, but its working tree is \*\*heavily dirty\*\* with ongoing Voice/Drama, media, model access and UI changes; the current \`index.html\` dynamically loads the new Drama Studio, Drama Director and Voice Designer scripts. Some source observations below refer to the checked-in HEAD, with direct local spot checks of the modified Concept A UI and live Git identity. The complete dirty overlay has \*not\* been diff-reviewed or live-tested during planning. Claims such as “not implemented” therefore mean “not found in the inspected applicable implementation” and require confirmation against the entire current working tree before writing code. Prior October 5–16 test receipts are historical, not new results.  
  
\#\# 0. Binding contract and definition of done  
  
1\. \*\*The artifact is the existing DexDiffusion workstation UI, version 4 / Concept A\*\*, not a new site, A1111 clone, standalone Gradio server or replacement application. A1111 controls must appear as discoverable, usable \*part of its existing Generate/Edit/Enhance/Media/Settings/Workstation experience\*.  
2\. Every function available during AUTOMATIC1111 stock image generation, image editing, image-conditioned generation, scripts, postprocessing, metadata handling and generation-affecting settings at the pinned baseline must have a requirement ID, a Dex UI location, an input contract, an executable backend mapping and at least one real compatible model/backend proof. \*\*Do not count an inert or permanently disabled control as parity.\*\*  
3\. \*\*Training and checkpoint merging are the only blanket feature exclusions.\*\* Explicitly requested ControlNet-style conditioning is included even though ControlNet is normally an external A1111 extension. Stock built-in image-generation extensions (upscalers, soft inpainting, optimization options) must be audited and handled.  
4\. Do \*\*not\*\* promise that every model can perform every operation. Controls must show exact model compatibility, but the overall workstation only achieves complete parity when every applicable function has a proven implementation on at least one installed/approved compatible local runtime. Unresolved engine-only functions stay \*\*OPEN\*\*; a blocked card is a truthful UI, \*\*not\*\* a completion claim.  
5\. Preserve every existing useful workspace: Workstation, Generate, Edit, Media, Voice, Music, 3D Assets, World Viewer, Drama and Settings/Help. Keep the native Dock app, mobile, tailnet, media identity, job control, 3D viewer, WorldGen, music/voice pipelines and Drama Studio usable throughout.  
6\. No training, checkpoint merging, Docker, Gemini/cloud inference, unapproved model downloads, broad Full Disk Access grants, extra public listeners, second queue, second artifact store, Big Mac final-output retention, destructive Git cleanup or unauthorized commits/pushes.  
7\. Preserve user data and local uncommitted work, including modified tracked files, all untracked Voice/Drama files and images, media ledgers, prompts/recipes, source masks, original model weights and historical missing-image records.  
8\. Prompt/script privacy stays opt-in. With \`save\_prompts=false\`, no persistent prompt, negative prompt, script, wildcards expansion or inferred source text may leak into jobs, SSE, image metadata, disk cache, history, exported provenance, console logs or crash reports. User-initiated export of prompt-bearing A1111 metadata requires an explicit privacy choice.  
9\. Every released change needs reproducible test receipts and positive \*\*and\*\* negative compatibility tests. Preserve fresh artifacts, original sources, checksums, leased compute ownership and cleanup.  
  
\#\#\# What exactly “every function” means  
  
The manifest records \*\*258 initial atomic behaviors\*\* across 13 areas (plus two exclusions). The executor must expand/validate that inventory automatically from the pinned A1111 code, not treat 258 as a magical final count. Scan: \`modules/ui.py\`, \`modules/ui\_toprow.py\`, \`modules/ui\_postprocessing.py\`, \`modules/shared\_options.py\`, \`modules/processing\_scripts/\`, \`scripts/\`, \`modules/ui\_common.py\`, extra-network UI, sampler/scheduler definitions and generation-affecting \`extensions-builtin/\`. For each function either link a manifest requirement ID or document the \*specific\* accepted exclusion. All previously missed stock controls found during this scan must be appended with immutable IDs. No arbitrary catalog of \*\*third-party\*\* extensions is implied, except explicitly required conditioning.  
  
\#\#\# Acceptable evidence states  
  
\- \`SOURCE\_PRESENT\`: method/control/schema exists; not a pass.  
\- \`UI\_EXPOSED\`: accessible on actual Concept A screen and model selection; not a pass.  
\- \`WIRED\`: exact normalized request/CLI/inference input consumes parameter; not a pass.  
\- \`MOCK\_TESTED\`: simulated worker and browser happy/negative paths pass; not a pass.  
\- \`LIVE\_PROVEN\`: real compatible backend action and expected output/metadata verified.  
\- \`BLOCKED\`: dependency, unsupported engine or missing model; requirement remains open.  
\- \`EXCLUDED\`: only training or checkpoint merging, linked to user scope.  
  
An atomic item graduates to \`PASS\` \*\*only after\*\* the entire relevant acceptance chain is proven. Even “default” generation-affecting settings must be tested for correct defaults and per-job override/persistence behavior.  
  
\#\# 1. Repository and UI architecture: actual inspected ownership  
  
\#\#\# UI construction and script load order  
  
\`operator-console/public/dexdiffusion/index.html\` runs the existing DC runtime and bootstraps \`window.DexDiffusionComponent\`. Current checked-in source loads \`dc-runtime.js\`, \`client-helpers.js\`, \`edit-core.js\`, \`component.js\`, \`workstation-ui.js\`, \`edit-ui.js\`, \`lightbox.js\`, \`media-ui.js\`, \`voice-ui.js\`, \`drama-ui.js\`, \`concept-a.js\`, \`a11y.js\` and \`../dexdiffusion-v12.js\`. \*\*Live local \`index.html\` additionally loads \`drama-studio-ui.js\`, \`drama-direct-ui.js\` and \`voice-designer-ui.js\` before \`concept-a.js\`.\*\* Their prototypes and composition are active work; do not remove or reorder them blindly.  
  
Concept A's ten real navigation modules are:  
  
| Module | Live Concept A composition | New A1111 parity ownership | Must not regress |  
|---|---|---|---|  
| \*\*Workstation\*\* | \`buildConceptWorkstation()\` in \`concept-a.js\` | Quick launch of existing Generate workflows; global parity/readiness badges if useful; global queue only | Recent images, projects, Quick Start, active jobs |  
| \*\*Generate\*\* | \`buildConceptGenerate()\` composing \`buildCreateWorkbench()\`, \`buildBatchWorkspace()\`, \`buildResultStaging()\` | \*\*Primary txt2img control surface\*\*, seeds, samplers, Hires, refiner, scripts and experiment subviews | Primary Klein, all SDCPP paths, prompt focus, results, model selection |  
| \*\*Edit\*\* | \`buildEditWorkbench()\` or \`buildEnhanceWorkbench()\` | Img2img, Sketch, mask modes, inpaint, outpaint, batch Edit and full Extras | Current undo/redo masks, coordinate mapping, same-source edit state |  
| \*\*Media\*\* | \`buildLibraryWorkbench()\` + \`buildMediaLibraryPanel()\` | PNG Info, metadata restore, save/export, batch grids and send-to | Canonical asset identity, lineage, audio/video collection |  
| \*\*Voice\*\* | \`buildVoiceWorkspace()\` and Voice Designer | \*\*No A1111 UI transplant here\*\*; shared Job Center must continue working | Voice profiles, Qwen/Kokoro, approved samples, audio export |  
| \*\*Music\*\* | \`buildMusicWorkspace()\` | \*\*No A1111 form transplant\*\* | ACE-Step / Magenta routes and existing audio job state |  
| \*\*3D Assets\*\* | \`buildAsset3dWorkspace()\` | May accept resulting image assets unchanged | Hunyuan mesh/textured, Quick Geometry, GLB validation/viewer |  
| \*\*World Viewer\*\* | \`buildWorldWorkspace()\` | May accept generated image/pose artifacts via canonical Media | WorldGen, Complete360, scenes, cameras, export |  
| \*\*Drama\*\* | \`buildDramaWorkspace()\` plus new Director/Studio mixins | \*\*No A1111 form transplant\*\*; preserve long-form jobs and provenance | Cast Bible, takes, timeline, production, mastering, Golden Reel work |  
| \*\*Settings / Help\*\* | \`buildConceptSettings()\` | Add generation-specific categorized options, presets, per-engine capability inspector and help | Existing system truth, tutorials, privacy, app lifecycle |  
  
A planned Puppet Master integration may become a \*\*separately approved module/subworkspace\*\* inside this same Concept A shell. It is not currently one of the ten navigation modules.  
  
\#\#\# Runtime/service ownership  
  
| Existing owner | Responsibility to retain |  
|---|---|  
| \`operator-console/server.js\` | MacBook loopback Node API \`127.0.0.1:31337\`; validators and route dispatch; do not turn into second independent API service |  
| \`operator-console/capabilities.js\` | Live asset/readability checks plus successful-job evidence: PROVEN / AVAILABLE / DORMANT / BROKEN / UNAVAILABLE |  
| \`operator-console/model-registry.js\`, \`extra-networks.js\` | Real target/model and LoRA/VAE/embedding discovery and compatibility |  
| \`operator-console/controlled-args.js\` | Pure controlled-generation CLI arguments; must be the authoritative \*consumed-flag\* map |  
| \`sdcpp-workflow/bin/sdcpp-controlled-generate.sh\` | Secondary SDCPP model worker and canonical transfer/cleanup; preserve target-specific safeguards |  
| \`sdcpp-workflow/bin/mflux-controlled-generate.sh\` and \`mflux-remote-generate.sh\` | FLUX.2 Klein primary, internal Big Mac model + Python environment |  
| \`operator-console/media.js\`, \`image-store.js\`, \`library-index.js\` | Existing job and canonical media ownership; never create competing originals |  
| \`operator-console/event-bus.js\`, \`cancellation.js\`, \`timing-store.js\` | Existing SSE events, stop/cancel semantics, ETA evidence |  
| \`operator-console/public/dexdiffusion/\` + \`../dexdiffusion-v12.js\` | One React/DC-runtime UI with V12 global Job Center, shell, queue and all workspaces |  
| \`/Users/andrew/images\_made\` | Canonical image outputs, MacBook |  
| \`/Users/andrew/audio\_made\` | Canonical generated audio, MacBook |  
| \`/Users/andrew/worlds\` | Canonical worlds/3D outputs, MacBook |  
| \`bigmac-heavy-inference\` | The shared heavy-compute arbiter across modalities; never route plots/batches around it |  
  
\#\#\# Concrete inspected mismatches — fix, not rewrite  
  
1\. \*\*Sampler disappears along the primary job path.\*\* \`workstation-ui.js::\_createBody()\` serializes target, prompt, negative, steps, CFG, scheduler, VAE, seed, quantity and Hires options but \*\*not\*\* \`sampler\`. \`server.js::normalizeControlledGenerationBody()\` allowlists \`sampler\` yet does \*\*not\*\* include it in the returned params. \`controlled-args.js::buildControlledArgs()\` never adds a sampler option. \`sdcpp-controlled-generate.sh\` uses configured \`TARGET\_SAMPLER\` defaults. The older \`generate-single\` route \*does\* forward sampler: do not conflate that legacy route with the actual Concept A Create path. This is a verified source-routing gap, pending live test.  
2\. \*\*Fields accepted but ignored.\*\* The controlled route allowlists \`clip\_skip\`, \`tiling\` and \`restore\_faces\`, yet the current checked-in normalizer doesn't carry them forward. Reject instead of silently dropping until every field is truly consumed, then wire exact behavior. Current \`generation-job.schema.json\` describes \`variation\_seed\` as visible but not wired. Audit other undocumented drops systematically.  
3\. \*\*X/Y/Z is currently limited.\*\* \`server.js\` implements \`ALLOWED\_XYZ\_AXIS\_TYPES = {steps,cfg,sampler,seed,width,height}\`, two axes at most, and 16 cells maximum; A1111 has a third Z axis plus many more parameter types. The current endpoint also uses the \*legacy\* SDCPP generation normalization; future experiments must honor the actually selected target and its permitted capabilities.  
4\. \*\*Concept A Generate renders a small core form.\*\* It includes prompt, supported negative prompt, model picker/target selector, steps, CFG, seed, dimensions, scheduler and Generate; \`buildCreateWorkbench()\` exposes quantity, aspect presets, reuse seed, model cards, a small Hires subset. The old \`component.js\` still contains additional bindings that should not be mistaken for discoverable version-4 controls. The model picker plus target selector can appear as two target controls; review with browser QA, preserving one authority.  
5\. \*\*Current Hires is real but limited.\*\* Scale, steps, denoising and \`Latent\`/\`Lanczos\`/\`Nearest\` are wired through controlled generation. Separate high-res prompt/negative prompt, explicit target pixel dimensions, hires checkpoint/sampler/scheduler and refiner are not present on the source-inspected Create path.  
6\. \*\*Edit is real.\*\* \`edit-ui.js\` already implements canonical-source recall, img2img/inpaint/outpaint, independent Edit state, model switching, sampler/scheduler/CFG/seed input, a source-coordinate mask editor, grow/shrink/feather/blur/invert, zoom/pan, undo/redo, precise error stages, multi-result replay and edit-from-result. \*\*Do not replace it.\*\* Fill in the stock A1111 mode and setting gaps additively.  
7\. \*\*Enhance and Auto Detailer exist.\*\* Lanczos, Real-ESRGAN and native high-res routes are exposed; Apple Vision-based detailer is an independent retained feature. Neither substitutes for A1111 CodeFormer/GFPGAN, dual-upscaler blending, full Extras or all built-in scripts.  
8\. \*\*Recipes, wildcards, extra networks, media indexing and results actions already exist.\*\* Reuse and extend rather than build second catalogs/stores. Existing built-in A1111 \`Prompts from File\` is not equivalent to DexDiffusion's numbered text queue.  
9\. \*\*Historical compatibility JSON is stale/incomplete.\*\* \`operator-console/schemas/model-compatibility.json\` contains September statuses and categories. Treat it as historical policy input, not stronger proof than today's runtime. Replace static assertions with derived per-target state tied to a receipt.  
10\. \*\*The worktree is not disposable.\*\* Today's MacBook \`git status\` lists modified Voice/Drama and generation files and many untracked new \`drama-\*\`, audio, studio UI and test modules, plus image files. Read the entire dirty diff/safety snapshot before touching \*any\* shared \`server.js\`, \`index.html\`, \`media.js\`, \`concept-a.js\` or package/test harness file.  
  
\#\# 2. Required final UI: component and navigation blueprint  
  
\*\*Do not add 258 fields into one giant form.\*\* Make all required functions discoverable and operable through progressive disclosure in the existing Concept A visual system. An unsupported function is still findable, with a truthful reason and a pointer to the engine/model that can satisfy it, but it is \*not\* counted complete merely because it is visible.  
  
\#\#\# Workstation (existing)  
  
\- Retain current Quick Start, Recent Projects, Recent Assets, Active Jobs, saved recipes and right-hand inspector.  
\- Add a \*\*Generate \> Advanced Controls\*\* quick link; do not duplicate generation state at Workstation level.  
\- Global Job Center must identify child operations for LoRA preparation, batch, X/Y/Z, SD Upscale, Loopback, refiner, face restoration and conditioning without privileging image jobs over Voice/Drama/Music/3D jobs.  
\- Where practical, include \*\*Image Capability Coverage\*\* in Settings/Help rather than claiming completion in Workstation.  
  
\#\#\# Generate (same global module)  
  
Create these \*internal\* tabs/sections under the existing Generate page (not top-level competing apps):  
  
1\. \*\*Text to Image\*\* — existing large prompt and result-first layout. Primary form: Positive, compatible Negative, Style, Model, VAE/resource drawer, Sampler, Scheduler, Steps, CFG, Width, Height, Swap, aspect presets, Batch Count, Batch Size, Seed, Generate and Stop/Skip.  
2\. \*\*Seeds & Variations\*\* — accordion for random/reuse seed, variation seed, variation strength, seed-resize dimensions, RNG compatibility and reproducibility notices.  
3\. \*\*Hires & Refiner\*\* — toggles, dimensions, scale, upscaler, denoising, second-pass steps, checkpoint, sampler, scheduler, prompts, refiner model and switch semantics; hide \*nothing\* behind silent backend no-ops.  
4\. \*\*Prompt Tools\*\* — token counts, bracket/schedule syntax inspector, styles, prompt comment handling, wildcard preview, Prompt Matrix entry, compatible interrogate input and “effective prompt” preview.  
5\. \*\*Experiments\*\* — full X/Y/Z; Prompt Matrix; Prompts from File/Textbox; Seed Lab; A/B; bounded Loopback when starting from an image; before-run cell count/time/model swaps; save all grid/cell outputs.  
6\. \*\*Advanced Sampling\*\* — per-engine solver/sigma/eta/noise/CLIP skip/guidance settings and defaults. Allow expert search by upstream A1111 term so rare options are still findable.  
7\. \*\*Output\*\* — format/export preferences, grids, filename templates, metadata opt-in, preview behavior and provenance.  
  
Keep the \*\*result staging hero/filmstrip\*\* from \`workstation-ui.js\`. Advanced controls should occupy compact accordions or a responsive drawer; never displace the primary output viewer or break small-screen navigation. One canonical generation request object must own the values; do not duplicate state in legacy V1/V2/V3 variants.  
  
\#\#\# Edit (same global module)  
  
Create submodes \*\*Img2Img / Sketch / Inpaint / Inpaint Sketch / Inpaint Upload / Outpaint / Batch Edit\*\*. Each is a mode adapter around the current \`edit-ui.js\` image-source editor, \*not a new editor with its own job store\*. The mask editor retains source-image coordinates and focus/keyboard support.  
  
For all modes expose: exact source image, source dimensions, “resize to” versus “resize by”, four A1111 resize methods where applicable, denoise, effective target checkpoint, sampling settings, seed, source-to-result lineage. Masked modes add inverse mask, masked fill strategy, whole vs masked-only ROI, padding, blur, transparency, conditioning mask strength, save mask/composite, soft inpainting. Outpaint adds mode selector for current Dex outpaint and A1111 algorithm equivalents with visibly different options.  
  
Batch Edit must accept selected Media items and explicitly staged uploads; directory ingestion is constrained to authorized MacBook roots and matched mask input—not unrestricted arbitrary system paths. Show every output and failed image separately.  
  
\#\#\# Enhance / Extras (existing Edit \> Enhance subview)  
  
Keep current Lanczos and ESRGAN actions, add \*\*Single / Batch Upload / Authorized Directory\*\* scope, upscale-by/to, primary/secondary upscaler blend, maximum side length, crop, tiled SD Upscale, GFPGAN and CodeFormer with real local model assets, ordered postprocessing chain, and lossless-original preserving export. Source assets never mutate.  
  
\#\#\# Media  
  
\- Existing image browser + current multi-media library stay in place; do not turn Media into image-only UI.  
\- \*\*PNG Info drawer\*\*: import/inspect original PNG text chunks and native metadata, explicit restore preview, supported-vs-unavailable highlights, selected original model/hash, parser warnings, one-click Send-to-Generate/Img2Img/Inpaint/Extras and a neutral source-inspector mode that never rerenders.  
\- \*\*Gallery/output\*\*: grid artifacts plus all underlying cells, full-screen/lightbox, compare, keeper, lineage, save selected, save all ZIP, metadata/sidecar/export policy and per-item histories. Selected image remains stable across rerenders.  
\- Keep prompt-saving restrictions: arbitrary PNG Info can be displayed at user request, but never automatically persisted into existing private history when saving is off.  
  
\#\#\# Model/resource browser and Settings/Help  
  
\- Reuse \`buildModelPicker\`, \`buildResourcesControl\`, \`model-registry.js\`, \`extra-networks.js\` and \`capabilities.js\`. Provide search, family, checkpoint hash, loading status, actual LoRA weight and applicable target; embeddings and hypernetwork inference where an engine exists.  
\- Settings groups: \*\*Image Generation / Sampling / Noise & Sigma / Prompt Handling / Models & Resources / Img2Img & Inpaint / High Resolution & Refiners / Postprocessing / Output & PNG Info / Live Preview / Reproducibility & Legacy Compatibility\*\*. Differentiate global defaults from one-job overrides.  
\- Help/tooltips define genuine effects, prerequisites, memory impact and unsupported model reasons. \*\*No cosmetic “Parity Complete” badges\*\* until the entire manifest passes.  
  
\#\#\# Puppet Master and other modalities  
  
\- Puppet Master remains an integration workstream, sharing the conditioning executor and canonical Media with Generate and Edit. Do not create an alternative ControlNet service in that module.  
\- Voice Designer, Drama Studio, Music, 3D and World Viewer need \*regression tests\*, not A1111 controls transplanted into their creative screens. Their active changes remain protected.  
  
  
\#\# 3. File-level change ledger (precise owners, additive by default)  
  
\*\*Existing files to inspect/modify in narrowly scoped commits\*\*  
  
| Existing file | Required targeted modifications | What must remain untouched |  
|---|---|---|  
| \`operator-console/public/dexdiffusion/concept-a.js\` | Compose new Generate subsections, Edit/Extras tabs, capability message, Help links; eliminate duplicate target-selector presentation after visual proof; keep full hero/result viewer | Ten module IDs, native shell, responsive inspector, queue dock, Voice/Drama/World/3D routing |  
| \`operator-console/public/dexdiffusion/workstation-ui.js\` | Extend \`\_createBody()\` with truly supported validated controls; upgrade \`buildCreateWorkbench\`; preserve result staging; add script/experiment links and consistent session recipe behavior | Existing \`\_ws\` active job IDs, hero/filmstrip, Seed Lab, A/B, Auto Detailer, batch queue, restart recovery |  
| \`operator-console/public/dexdiffusion/component.js\` | Register only new common state and event adapters that have one owner; retire V4 dependence on obsolete render value bindings only after regression proof | V1–V3 migration fallbacks, \`DexDiffusionComponent\` runtime entry, existing model and metadata handlers |  
| \`operator-console/public/dexdiffusion/client-helpers.js\` | Extend model-specific \`controlsFor()\` and request/session serialization for new settings; add compatibility descriptions | \`save\_prompts\` persistence rules and existing recipe versions |  
| \`operator-console/public/dexdiffusion/edit-ui.js\` | Compose Sketch, Inpaint Sketch, independent mask upload, batch edit, ROI/fill/padding/resize options into authoritative \`ed\` state; retain editor | \`openImageInEdit()\` source-specific recall, zoom/pan/mask accuracy, one Run action |  
| \`operator-console/public/dexdiffusion/edit-core.js\` | Expand recall/save/migration fields and pure image/mask transformation specs; adapt custom modes without direct DOM ownership conflicts | Existing privacy-safe recall schema and mask geometry math |  
| \`operator-console/public/dexdiffusion/media-ui.js\` | PNG Info inspector, per-asset restore preview, selective export, grid metadata, selected image handoffs | Canonical media API, collections, audio/video records, no duplicated bytes |  
| \`operator-console/public/dexdiffusion/index.html\` | Reference new self-contained UI/CSS scripts after their dependencies and before \`concept-a.js\`, carefully preserving the \*\*actual uncommitted\*\* Voice Designer/Drama script imports | DC runtime boot, \`voice-designer-ui.js\`, \`drama-studio-ui.js\`, \`drama-direct-ui.js\`, V12, mobile styles, focus targets |  
| \`operator-console/public/dexdiffusion/a11y.js\` | Keyboard shortcuts, accessible mask/experiment controls, modal focus where new panels require it | Existing global focus/keyboard/lightbox behaviors |  
| \`operator-console/server.js\` | Evolve normalization, validation and endpoints; remove silent accepts; wire lightweight service modules instead of growing the monolith indefinitely | Every in-flight Voice/Drama/Music/3D/World route, staging, leases, media, privacy, active job history |  
| \`operator-console/controlled-args.js\` | Explicit field-to-worker mapping for sampler, supported noise controls, tiling, CLIP skip and highres; detect unsupported fields before spawn | Existing safe \`spawn\` argument arrays, MFLUX isolation and native batch optimization |  
| \`operator-console/capabilities.js\` | Derive per-model/per-operation/per-control support from observed binaries, installed weights and proof ledger; add granular reasons | Historical proof retention, \`wc2tbReadable\` current-read behavior, primary Klein proof |  
| \`operator-console/model-registry.js\`, \`extra-networks.js\` | Expand metadata hashes, resource type, compatibility and confirmed applied LoRA values | Model paths and currently proven selections; never infer actual compatibility from a filename alone |  
| \`operator-console/schemas/generation-job.schema.json\` | New additive generation contract (v2) retaining backwards-compatible flat v1 inputs; typed options and hard rejects | Existing job schema consumers and privacy rules |  
| \`operator-console/schemas/model-compatibility.json\` | Migrate stale static assertions to versioned \*capability policy\*; leave real proof to derived ledger | Historical target/model caveats |  
| \`sdcpp-workflow/bin/sdcpp-controlled-generate.sh\` | Add validated flag parsing for supported new features; exact \`sd-cli\` flag/help detection, output receipts, no-op prevention; native two-pass/secondary model support | All model paths, \`wc2tb\` access, controlled exit markers, canonical transfer/cleanup, existing feature behavior |  
| \`sdcpp-workflow/bin/mflux-controlled-generate.sh\` and \`mflux-remote-generate.sh\` | \*\*No default modification\*\*; add separate reference/edit adapter only after proven upstream MFLUX support | Internal hot model/venv, remote temp cleanup, existing Klein txt2img path |  
| \`operator-console/media.js\`, \`event-bus.js\`, \`cancellation.js\`, \`timing-store.js\`, \`image-store.js\` | Only additive schema/events/artifact variants needed to represent image experiment children, conditional previews, runtime proofs and skip | One job/artifact authority; no arbitrary process kills, no leaked prompts, no duplicated library |  
| \`operator-console/package.json\`, \`tests/browser/\*\` | Add explicit scripts and clean temporary browser output directory; run focused and full tests where changed | Existing tests, generated-output nonoverwrite safety, no unexpected installs |  
| \`OPERATIONAL\_STATE.md\`, \`Image\_Gen\_Bible.md\` | Append only verified status/change/receipts \*\*after\*\* implementation and authorization; preserve earlier contradictions as dated history | Ongoing dirty revisions must never be overwritten from a stale HEAD |  
  
\*\*Suggested new helper files\*\* — these names are \*\*proposals\*\*, not claims they already exist. Add only when the existing modules do not already provide equivalent ownership:  
  
| Proposed file | Single responsibility |  
|---|---|  
| \`operator-console/generation-params.js\` | Pure versioned request normalization, typed validation and field-consumption tracking; target-aware effective parameters |  
| \`operator-console/generation-compatibility.js\` | Compare a request's controls against selected model/backend and required runtime evidence; errors include precise unsupported field |  
| \`operator-console/prompt-parity.js\` | Parse/simulate A1111 prompt scheduling, emphasis, \`BREAK\`, \`AND\`, escapes, prompt matrix and text transformations when possible; expose backend-specific compilation plan, not fake text substitution |  
| \`operator-console/experiment-plan.js\` | Immutable per-cell experiment DAG and seed/fingerprint calculation for X/Y/Z, Prompt Matrix, Loopback, Prompts from File |  
| \`operator-console/image-postprocess.js\` | Processing graph for Extras/upscale/blend/face restore with FFmpeg/Pillow/approved-worker adapters, CPU/memory/disk budget |  
| \`operator-console/png-info.js\` | Bounded parser for A1111 PNG tEXt/iTXt, native Dex metadata and restore preview; no image bytes outside authorized staging |  
| \`operator-console/image-conditioning.js\` | Model-specific preprocessor/ControlNet inputs, proof gates, run provenance; one contract shared with Puppet Master |  
| \`operator-console/public/dexdiffusion/a1111-generate-ui.js\` | Compose compact A1111-complete Create sections into existing \`P\` prototype pattern |  
| \`operator-console/public/dexdiffusion/a1111-experiments-ui.js\` | X/Y/Z, Prompt Matrix, file input, preview grid, estimate and result matrix |  
| \`operator-console/public/dexdiffusion/a1111-edit-modes-ui.js\` | Extra edit inputs/mode selectors that reuse \`this.ed\` and existing canvas editor |  
| \`operator-console/public/dexdiffusion/a1111-extras-ui.js\` | Extras and postprocess controls inside existing Edit/Enhance route |  
| \`operator-console/public/dexdiffusion/a1111-pnginfo-ui.js\` | Media inspector and one-click parameter restoration transaction |  
| \`operator-console/public/dexdiffusion/a1111-settings-ui.js\` | Searchable backend-aware settings groups and accessibility/help text |  
| \`operator-console/public/dexdiffusion/a1111-conditioning-ui.js\` | ControlNet UI shared with pose/reference work |  
| \`operator-console/public/dexdiffusion/a1111-parity.css\` | Scoped classes for new form groups, responsive layout, high-contrast status and focus |  
| \`operator-console/tests/a1111-parity-\*.test.js\` | Pure unit, shape, privacy, invalid-input and worker argument-invariant tests |  
| \`operator-console/tests/browser/a1111-parity.browser.js\` | Real Concept A v4 navigation and interactive controls with exact request interception |  
  
\*\*Architecture constraint on all new helpers:\*\* neither a new event bus nor a new scheduler nor a second job store is allowed. Helper modules compose into \`server.js\` and the existing \`this.\_ws\`/\`this.ed\`/V12 ownership. Existing files already uncommitted are read/diff-reviewed first; proposed file names may change if current local work provides equivalent functionality.  
  
\#\# 4. Phased, executable implementation packets  
  
All packets start with a fresh repository fingerprint and clean preservation proof for their \*specific change set\*, then finish with a narrowly scoped test receipt. Do not run all phases in one enormous coding-agent task; do not let one failed experimental backend change block unrelated verified UI work. Roll back \*\*only that packet's changes\*\* without discarding pre-existing dirty files.  
  
\#\#\# Phase P00 — Preservation and baseline freeze (no feature implementation)  
  
\*\*Entry:\*\* Current local Git root exists; \`main\` points to the expected repo. Verify, do not assume, \`/api/version\` and the real app checkout.  
  
\*\*Specific actions\*\*  
  
1\. Read \`AGENTS.md\`, \`OPERATIONAL\_STATE.md\`, \`DEXDIFFUSION.md\`, \`Image\_Gen\_Bible.md\`, current Studio progress doc and \`docs/operations/DEXDIFFUSION\_EXTERNAL\_FIRST\_20261009.md\` without overwriting any.  
2\. Record git HEAD/branch/remotes and byte-hash all already modified tracked/untracked source files needed by the program. Preserve a labeled reversible snapshot \*outside\* the repo when source mutations begin; ensure untracked PNGs remain untracked.  
3\. Diff current \`concept-a.js\`, \`server.js\`, \`edit-core.js\`, \`index.html\`, capability/worker source against HEAD, paying attention to Voice/Drama/Media changes. Map prototype composition order and new API routes. Do not start a new feature while source owners conflict.  
4\. Capture current UI wiring for 1440x900, 1024x768, 768x1024, 390x844 and Mac native WebKit, including actual Concept A \`Generate\`, \`Edit\`, \`Media\`, \`Settings\`; page-specific key, focus, scroll, modal and responsive behavior. Use a \*new\* output location for screenshots/test logs; never overwrite \`output/rev19/interaction-matrix\*\`.  
5\. Run cheap read-only diagnostics: active job/lease states, model volume accessibility and which local services are reachable. Reuse October 9/16 receipts as \*\*historical\*\* evidence only.  
6\. Obtain \`npm run check\` and test baselines only if safe and resource bounded; do not run a heavy Big Mac model and audio production simultaneously.  
  
\*\*Deliver:\*\* \`docs/plans/a1111-baseline-current.md\` in future implementation change; dirty-file protection table, screenshot capture IDs and active source/route dependency map. \*\*Acceptance:\*\* Existing work preserved byte-for-byte and every future targeted edit has a trusted owner and rollback mechanism. \*\*STOP\*\* if dirty file lineage cannot be distinguished from a planned replacement.  
  
\#\#\# Phase P01 — Source-locked parity ledger and coverage gate  
  
\*\*Dependency:\*\* P00. \*\*Purpose:\*\* Prevent the model from deciding “that was probably optional.”  
  
1\. Pin the exact A1111 upstream commit and code-file manifest. Extract every \`gr.\*\` generation control, built-in script \`ui()\` field, generation setting \`OptionInfo\`, UI button, copy/send action and relevant stock built-in-extension control; exclude training and checkpoint merging by explicit symbol/location.  
2\. Normalize aliases (e.g. \`Sampling method\`/\`sampler\_name\`, \`Image CFG Scale\`/\`image\_cfg\_scale\`, \`Denoising\`/\`denoising\_strength\`) without merging functionally distinct fields (notably \`seed\` versus \`subseed\`, \`batch\_size\` versus \`batch\_count\`, \`skip\` versus \`interrupt\`, \`Hires Fix\` versus \`Extras upscale\`, checkpoint merging versus token merging).  
3\. Reconcile extracted stock source with the 258-row provisional ledger: append every newly found applicable function with a stable ID; retire none silently. For every ID record upstream file+symbol+commit, UI location, normalized field, backend adapter, target capability, test fixture, output artifact, and read-back proof status.  
4\. Create an automated \*\*coverage-check\*\* that fails if an A1111-applicable discovered item has no mapping or if an item is marked PASS without test and runtime receipts. Preserve a human-readable blocked list.  
5\. Add a search/filter surface in Settings/Help for users to find obscure upstream controls by exact name; expose all functions in Generate/Edit/Extras/Media as appropriate.  
  
\*\*Candidate files:\*\* \`schemas/model-compatibility.json\`, new \`schemas/a1111-parity-ledger.json\`, \`tests/a1111-parity-coverage.test.js\`, Settings UI. \*\*Exit:\*\* Zero unclassified upstream functions, two explicit exclusions and zero invented \`PASS\` rows. This is an \*\*inventory gate\*\*, not finished generation parity.  
  
\#\#\# Phase P02 — Request contract, sampler bug and silent-parameter-loss fixes  
  
\*\*Dependency:\*\* P00/P01. \*\*This is the best first actual code slice\*\* because it corrects a confirmed issue without a redesign.  
  
1\. Write characterization tests against the existing flat API body for SD1.5 \`sampler\`, \`scheduler\`, \`cfg\_scale\`, \`clip\_skip\`, \`tiling\`, \`restore\_faces\`, negative prompt, seed, model, VAE and LoRA. Prove which fields currently drop; freeze already-working behavior.  
2\. Add a \*\*single pure normalization function\*\* (existing server function or proposed \`generation-params.js\`) which converts legacy flat bodies to a versioned internal request and \*never silently discards a recognized control\*. \`schema\_version\` can be optional for old clients; do not break existing stored recipes or batch payloads.  
3\. Extend \`P.\_createBody()\` to include the actual selected sampler and newly exposed parameters; avoid dispatching unsupported fields when they are not user-selected. Keep the render/focus strategy that avoids losing keystrokes on every input event.  
4\. Extend \`normalizeControlledGenerationBody()\` to retain each field that the dispatch accepts. Normalize aliases once, clamp/validate using per-target contracts, and mark each field \`applied\`, \`defaulted\`, \`unsupported\` or \`rejected\`. If no worker can implement an accepted field, return an explicit 422/409 with its name/reason instead of accepting and ignoring it.  
5\. Extend \`buildControlledArgs()\` \*\*only\*\* with flags proven by the installed SDCPP CLI/help or approved secondary backend. Add \`--sampler NAME\` to the controlled shell script as a new allowed, validated option; map to the supported CLI sampling name. Preserve SDXL Turbo fixed requirements. Do \*\*not\*\* pass nonexistent negative/CFG/scheduler/VAE controls to Klein.  
6\. Ensure \`/api/preview/generation\` derives from \*\*the same\*\* pure builder that actual jobs use. Today its args are manually reconstructed in \`server.js\`; that is a drift risk. Show \`appliedFields\`, \`ignoredFields=\[\]\`, \`backend\`, \`modelHash\`, \`effectiveArgs\` with prompt redaction when disabled.  
7\. Persist exact effective sampler/scheduler/steps/CFG and applied advanced options in the run record. Never claim that \`sampler\` is applied because it appears in the UI text.  
8\. Add negative tests: unrecognized key, known but unsupported key, unsupported sampler, attack strings in selector, nonexistent VAE, mismatched target, CFG 0 versus 1 rules, fallback model selection, prompt privacy on and off.  
  
\*\*Touched:\*\* \`workstation-ui.js\`, \`server.js\`, \`controlled-args.js\`, \`sdcpp-controlled-generate.sh\`, CLI tests, \`schemas/generation-job.schema.json\`; shared functions only as required. \*\*Exit:\*\* Selecting two supported SDCPP samplers produces two different \*verified effective worker invocations\*, captured metadata accurately describes both, and an incompatible control returns a clear gate rather than silently succeeding. Do not require visually different noise samples as the sole signal: the actual sampler API/CLI proof is decisive.  
  
\#\#\# Phase P03 — Full Generate UI inside Concept A  
  
\*\*Dependency:\*\* P02. \*\*No backend-engine work in this packet:\*\* integrate newly verified controls and truthful disabled states.  
  
1\. Keep current \`buildConceptGenerate()\` with its two-column result-first layout. Add internal tab/accordion navigation described in §2; responsive beneath 900 px and keyboard-accessible across browser/WebKit.  
2\. Present model selector \*\*once\*\* as the authoritative input. If legacy \`vals.targetSelectV1\` and the local \`targetSelect\` are both mounted, reconcile rather than layering a third select.  
3\. Integrate sampler, scheduler, batch count/size, tiling, face restoration, CLIP skip, prompts and saved styles without rerouting through legacy \`generate-single\`. Label backend-specific values and live effect.  
4\. Add a model-bound \*\*Effective parameters\*\* read-only drawer beside Generate, with \`unknown/unavailable/proven\` status for options. Every change regenerates the preview without submitting a job.  
5\. Validate form-to-request state equality: selecting target B changes valid samplers/settings but does not silently replace user prompt/seed; switching back restores compatible previous choices and explains incompatible ones.  
6\. Use \`aria-labelledby\`, proper labels and error messages for the large number of controls. New accordion expansion never steals typing focus; submit button remains reachable without obscuring result or inspector.  
7\. Keep existing result staging actions: variation, seed reuse, Img2Img, Inpaint, Enhance, Detailer, fullscreen, keeper, lineage. Add only missing A1111 send-to/save/export operations.  
  
\*\*Touched:\*\* \`concept-a.js\`, \`workstation-ui.js\`, new UI mixin and scoped CSS, \`index.html\` script tags (preserve Voice/Drama imports), browser tests. \*\*Exit:\*\* User can find every P01 control and distinguish applicable vs not applicable at 390 px, 768 px and native WebKit; the pre-existing generation, music and drama journeys remain accessible.  
  
\#\#\# Phase P04 — A1111 prompt language and styles semantics  
  
\*\*Dependency:\*\* P02 request normalization. \*\*Rationale:\*\* A UI message currently says “A1111 syntax supported,” but that statement requires concrete parser/conditioning proof.  
  
1\. Test how the actual SDCPP and MFLUX paths treat attention parentheses, bracket weighting, escaping, long prompts, \`BREAK\`, \`AND\`, prompt scheduling \`\[red:blue:0.5\]\`, alternating sequences \`\[red|blue\]\`, comments, negative prompt syntax, LoRA tags and textual-inversion terms. Use exact prompts and backend argument/progress receipts; avoid inferring behavior from ordinary text generation success.  
2\. For any feature that the backend natively consumes, preserve text verbatim and record the native-parser proof. For missing semantics, implement a \*\*pure deterministic compiler\*\* that emits a per-step conditioning schedule only when a backend supports stepwise conditioning hooks. Literal string replacement in a final prompt does \*\*not\*\* count as A1111 step scheduling.  
3\. Implement tokenizer-aware counts with the \*\*correct installed encoder\*\*, including positive/negative, styles and long-prompt chunking; show “token count unknown for this backend” rather than fabricated counts.  
4\. Build genuine A1111 prompt styles (positive and negative templates, placeholder insertion) with Apply/Preview/Edit/Save/Rename/Delete. Reuse the project recipes and profile helpers but do not conflate a style with a full job settings recipe.  
5\. Add safe prompt-comment handling; preserve literal \`\#\` escapes and opt-out. Add weighted-prompt keyboard shortcuts only after input focus and undo tests.  
6\. Keep wildcard expansion and Ollama prompt enhancement as \*\*independent optional Dex features\*\*, not substitutes for missing A1111 grammar. Never send prompt text to external cloud services.  
7\. Add bracket/schedule validation with exact offset, preview and fix hints. With \`save\_prompts=false\` none of the expanded text may enter persistent history.  
  
\*\*Touched:\*\* new \`prompt-parity.js\`, \`workstation-ui.js\`, \`client-helpers.js\`, backend adapters where truly required, \`prompt-profiles.js\`, \`recipes-store.js\`, browser and parser golden tests. \*\*Exit:\*\* Every prompt language form is either live-proven or remains blocking in the parity ledger; no misleading “supported” help text survives.  
  
\#\#\# Phase P05 — Seeds, noise, sampling and advanced solver options  
  
\*\*Dependency:\*\* P02/P03/P04 as relevant.  
  
1\. Implement the distinct \*\*base seed / variation (sub)seed / variation strength / seed-resize W,H\*\* parameters in the canonical job model and UI. The existing new-seed variation and Seed Lab must remain separate features and should not be relabeled as latent variation-seed equivalence.  
2\. Generate a seed plan once on the MacBook for N output items. Record resolved seeds, per-item effective params and result IDs. Prevent double-randomization when queuing or resuming a job.  
3\. Support A1111 seed-from-dimensions only through an actual compatible latent-noise calculation. If the required latent machinery does not exist in SDCPP, classify the need for an additional compatible local adapter in P14.  
4\. Source solver options from installed backend help and actual sampler implementation: eta and eta-noise delta, sigma churn/Tmin/Tmax/noise, sigma min/max/rho, beta distribution alpha/beta, UniPC variant/order/skipping, early guidance/negative sigma, zero-terminal-SNR, sigma discard and legacy compatibility controls. Apply only to the selected solver where they have real meaning.  
5\. Implement target-bound compatibility filtering and runtime backend proof. The \`RNG source NV\` option cannot honestly run as NVIDIA on Apple Silicon; a compatible deterministic reproduction mode must prove the same user-level result or remain blocked.  
6\. Add an A1111 setting search index and tooltip description for each advanced option. Expose read-only sigma schedule information where available; avoid decorative graphs implying a supported solver.  
7\. Test seed reproduction for a same-model/same-sampler/same-size job, seed stability across native batch versus sequential (when documented to be equivalent), variation strength 0 versus positive, resize seed and arbitrary out-of-range input.  
  
\*\*Touched:\*\* generation params, capability registry, worker flags, \`workstation-ui.js\`, advanced UI mixin and tests. \*\*Exit:\*\* No visible noise/seed/sampler setting is an inert no-op. All required A1111 solver-family controls have a real capable route before claiming full parity.  
  
\#\#\# Phase P06 — Hires Fix and refiner completion  
  
\*\*Dependency:\*\* P02/P05. Preserve current native SDCPP second-pass output.  
  
1\. Keep the existing \`--hires\` path, and expand the request/UI to include \*\*scale-by OR explicit target width/height\*\*, with correct rounded output-size preview. Apply the preflight against first- and second-pass memory/dimensions; never infer exact second-pass behavior from a resampling-only Lanczos result.  
2\. Add separate Hires positive and negative prompts. They require a worker mode that changes second-pass conditioning; refusing them is better than silently using first-pass text.  
3\. Add second-pass checkpoint, sampler and scheduler controls using the existing secondary-model slot and approved per-job model loading semantics, not a global model switch that disrupts another job.  
4\. Add proper A1111 refiner checkpoint/switch-at threshold when a two-model inference runtime is proved. Distinguish true in-sampling refiner transition from an after-the-fact img2img pass; if exact equivalence is impossible, label it differently and keep parity item OPEN.  
5\. Preserve existing \`High-Res Refine\` shortcut under Enhance as a parameterized handoff that restores exact source settings. Protect both base and final canonical artifacts and link them in lineage.  
6\. Test source-sensitive prompts, model availability failure, dim overshoot, cancelled second pass with surviving base, correct final size, repeated seeds, switched sampler and memory contention against ongoing other modalities.  
  
\*\*Touched:\*\* Create controls, model registry, job arg builder, SDCPP controlled script, run metadata and tests. \*\*Exit:\*\* Second-pass-specific settings are verifiably effective and do not corrupt first-pass or another model's state; refiner remains an explicit blocker until equivalent runtime exists.  
  
  
\#\#\# Phase P07 — Complete Img2Img modes, image sources, resize, and batch edits  
  
\*\*Dependency:\*\* P02, P03 and P12's agreed import/metadata contract (the production implementation can sequence PNG Info after editing, but agree on the imported-image record first). \*\*Existing owner:\*\* \`edit-ui.js\` with \`this.ed\` state and \`openImageInEdit()\`; never create a parallel image editor.  
  
\*\*Specific changes\*\*  
  
1\. In the existing Edit module's top operation row, preserve \`Img2Img\`, \`Inpaint\`, \`Outpaint\` and Enhance handoffs; add mode tabs/subtabs for \*\*Img2Img, Sketch, Inpaint, Inpaint Sketch, Inpaint Upload, Batch\*\*. Each mode must have an explicit source specification, supported model notice and \*\*one\*\* authoritative Run action. Do not make an unsupported mode silently fall back to ordinary img2img.  
2\. Keep the existing source-coordinate mask canvas with zoom/pan, undo/redo and transform safety. Provide \*\*color-sketch painting\*\* on a distinct compositing layer with opacity and color picker, not the binary white-mask layer. Store source image pixels, optional sketch color layer, and generated inpaint mask as separate stage assets; use a non-destructive preview before submitting.  
3\. \*\*Img2Img:\*\* preserve strength, sampler, scheduler, steps, CFG, seed, negative prompt, LoRAs, VAE and target; add \`Resize mode\` variants Just resize, Crop and resize, Resize and fill, Just resize (latent upscale) where a backend accepts the mode. Add Resize to dimensions, Resize by scale, Swap W/H, Detect original size, and a calculated output resolution preview. Preserve the source ratio and exact crop/fill geometry when selected.  
4\. \*\*Sketch:\*\* allow drawing colors on an existing image; distinguish the edited color image from mask guidance. The resulting image must become the actual init image or an explicitly supported encoded guidance image; do not label a simple painted PNG as structurally conditioned generation.  
5\. \*\*Inpaint:\*\* support draw mask over source. Existing mask controls remain. Add explicit switch \`Inpaint masked\`/\`Inpaint not masked\` that deterministically complements the actual raster mask before worker dispatch. Confirm full-mask jobs; block empty mask. Show exact masked area.  
6\. \*\*Inpaint Sketch:\*\* support a color sketch/guide overlay plus original image, derive and preview an inpaint mask from edited pixels where A1111's semantics require it, and preserve original unedited pixels. Distinguish this from standard alpha-painted inpaint.  
7\. \*\*Inpaint Upload:\*\* accept independent source image and mask using existing authenticated same-origin \`/api/staging\` or a narrowly typed \`mask\` staging route. Validate dimensions, alpha/grayscale meaning, MIME/content signature, decoded pixel counts and max size. Do not trust browser-supplied file extensions. Crop/resize masks deterministically only after explicit user mode selection.  
8\. \*\*Batch:\*\* support multiple uploaded images, a bounded directory-based input only on an authorized MacBook path (no arbitrary Big Mac directory reads) and optional corresponding mask set. Provide per-image filename mapping and a manifest preview before submitting. When importing A1111-style directory PNG Info, show exactly which fields override prompt/negative/seed/CFG/sampler/steps/hash. No blind path traversal, glob explosion or overwrite of source files.  
9\. Batch output uses existing canonical image store, generic jobs/queue and Media lineage per output. Broken item N does not erase successful outputs 1..N-1. Expose Cancel current/Stop after current/Resume according to the true backend contract; record missing-input rows with explicit errors.  
10\. Compose the new modes using a \*\*pure editable operation specification\*\* such as \`{mode, sourceId, sketchId?, maskId?, prep, effectiveSettings, outputDims}\`. Convert to each existing route with typed backend support checks: \`/api/actions/img2img\`, \`/api/actions/inpaint\`, \`/api/actions/outpaint\`. Do not proliferate route-specific one-off form models or copy all JSX for every mode.  
11\. Extend Edit's restore/recipe serialization to cover mode, resize, mask policy, original source ID and asset compatibility; private prompt text may persist \*\*only\*\* when prompt save is authorized. Imported sources explicitly start with unknown-generation metadata, not fictional prior prompts.  
12\. Browser controls must remain operable at 390px; Edit stage may scroll while the Run button remains accessible, brush remains touch/stylus usable and zoom/pan never steals unrelated shortcuts. Preserve the existing typed-input focus workaround.  
  
\*\*Likely files:\*\* \`operator-console/public/dexdiffusion/edit-ui.js\`, \`edit-core.js\`, \`a1111-edit-modes-ui.js\` (optional), \`workstation-ui.js\` for Send to Edit, \`server.js\` validation/staging/batch routes, pure resize/mask helper, \`image-store.js\` metadata, \`schemas/generation-job.schema.json\`. Add \`tests/a1111-parity-edit.test.js\`, \`tests/browser/a1111-edit.browser.js\` or extend existing \`tests/browser/edit-workbench.browser.js\`.  
  
\*\*Acceptance witness:\*\* A source PNG successfully generates image variants for all six stock modes (plus Outpaint and Enhance already present); seeded job manifest records exact source/overlay/mask/mode/resize mapping; unchanged source pixels are retained where promised; imported masks align at 0.5x, 1x, 3x viewport zoom and after window resize; wrong masks/types are rejected; batch with one failed item preserves completed siblings and non-destructive source files. Any unsupported A1111 latent-only resize stays \`BLOCKED\` until real equivalent proof.  
  
\#\#\# Phase P08 — Inpainting, outpainting, soft mask, and detailed spatial controls  
  
\*\*Dependency:\*\* P07; can overlap UI implementation with P07 but cannot use the same mask ownership twice.  
  
1\. Complete A1111 \*\*Mask blur, Mask transparency, Mask mode, Masked content\*\* (\`fill\`, \`original\`, \`latent noise\`, \`latent nothing\`), \*\*Inpaint area\*\* (\`Whole picture\`/\`Only masked\`), \`Only masked padding\`, and background/correction/overlay choices. The existing Grow, Shrink, Feather, Blur and Invert toolbar is retained; distinguish \*preprocess blur\* from \*postcomposite feather\* in help and receipts.  
2\. For masked-area-only processing, calculate an ROI bounding rectangle at source resolution, expand by user padding, clamp to canvas, resize ROI for the selected model, then composite restored pixels into the original in source coordinates. Test narrow masks crossing image edges and aspect-ratio changes. A simple full-image inpaint pass is not a substitute.  
3\. For A1111 masked-content choices, specify exact deterministic init-latent construction. Implement where the backend accepts a specific input; otherwise require compatible local inference runtime. Avoid converting \`latent noise\` into arbitrary blur and claiming equivalent conditioning.  
4\. Add \*\*mask transparency\*\*/alpha weighting and \*\*conditional mask weight\*\* only where backend accepts graded conditioning. Prove that changing the weight changes the input tensor/worker invocation and resulting masked region; never send a value that is silently dropped.  
5\. Add \*\*soft inpainting\*\* from the bundled A1111 workflow where meaningful, including transition-blend controls, preservation of unmasked pixels and explicit seed/strength. Preserve the existing outpaint composite correction (\`OUTPAINT\_COMPOSITE\_PY\`) but keep its alpha semantics separate from A1111's soft-inpainting diffusion path.  
6\. Expose current native Outpaint independently from \*Poor Man's Outpainting\* and \*Outpainting MK2\* script choices, since both stock algorithms may use distinct noise synthesis and blending. Implement their preprocessing as a selected local image transformation and feed the resulting image/mask through existing validated inpaint worker; record algorithm/parameters in provenance.  
7\. \*\*Poor Man's Outpainting:\*\* expansion amount, left/right/up/down selections, mask blur, masked-content selection, tile/overlap behavior where needed, correct new canvas and output size. Do not alias to current simple \`+25%\` presets without implementing the selected algorithm's behavior.  
8\. \*\*Outpainting MK2:\*\* follow its documented matched-noise and Fourier-based context blending when feasible; isolate computationally expensive NumPy/FFT steps, bound memory, validate inputs and report deterministic seed. If blocked by unavailable dependencies, leave a specific gate, not a decorative selector.  
9\. Store source, preprocessed image, binary/soft mask, ROI/crop and output digest in project/run lineage without persisting forbidden prompt text. Provide preview of mask geometry and a button to inspect the preprocessed control image.  
10\. Regress current automatic Detailer, Apple Vision face/hand/person ROI, \`inpaint\` and existing Outpaint scene preservation. No new mode may accidentally steal those masks or mutate the original source.  
  
\*\*Likely files:\*\* Edit UI/mask helpers, \`edit-core.js\`, \`server.js\`, dedicated pure \`image-mask-modes.js\`/\`outpaint-plugins.js\` where useful, current SDCPP inpaint worker, artifact metadata. \*\*Tests:\*\* black/white/inverted masks; fractional alpha; ROI near bounds; small/large image; deterministic/outpaint output dimensions; source composite checksum outside mask; cancellation during preprocessing; absence of secondary model; low-storage refusal.  
  
\*\*Exit:\*\* Every A1111 inpaint/outpaint option has a real image-changing path; all original and partial outputs remain recoverable; modes with fundamentally unsupported latent behavior stay open until that behavior exists.  
  
\#\#\# Phase P09 — Full Extras and postprocessing (including model-based restorers)  
  
\*\*Dependency:\*\* P07 staging and canonical artifact transaction, and proof of each installed restoration/upscale engine. \*\*Owner:\*\* existing \`Edit → Upscale / Enhance\` and Media send-to; \*\*no new top-level Extras module\*\* unless explicit UX validation shows a reason.  
  
1\. Replace the existing limited Enhance cards with a subworkspace \*\*Single / Batch uploads / Batch from approved MacBook folder\*\*, while preserving one-click Lanczos, Real-ESRGAN and existing Hires handoff. Each input is staged and validated without source overwrite.  
2\. Add A1111 \*\*Scale by\*\* (bounded decimal) and \*\*Scale to\*\* W/H, Crop to fit, Max side length, calculated output dimensions and aspect-ratio warnings. Retain deterministic no-AI resampling labels for Lanczos/Nearest.  
3\. Add \*\*Primary upscaler\*\*, \*\*Secondary upscaler\*\*, \*\*Secondary visibility blend\*\* (0–1), showing the availability of each registered local engine and the output pixel budget. When engines return mismatched color modes, normalize safely before blending; never expose a missing engine as selectable/proven.  
4\. Preserve existing Real-ESRGAN x4 and its memory-aware tiling. For other stock upscaling choices (SwinIR, ScuNET, LDSR, DAT or other upstream built-in engines) decide a per-engine adapter only after testing actual model availability, license, Mac Metal compatibility and memory constraints. Build shared upscaler registry/cards; avoid installing full A1111 for a single upscaler by default.  
5\. Add \*\*GFPGAN\*\* and \*\*CodeFormer\*\* restorative modes, with separate enable, visibility strength and CodeFormer weight sliders matching actual inference semantics; A/B original/restored preview and face identity change warning. Automatic Apple Vision Detailer is not a substitute for either restoration model.  
6\. Implement \*\*SD Upscale\*\* as tiled diffusion (tiling width/height, tile overlap, choice of upscaler, scale factor, per-tile seed tracking, reassembly), distinctly from Real-ESRGAN one-step upscale and from high-resolution second-pass native SDCPP. Use existing heavy compute arbiter for tile jobs and progress/warning boundaries.  
7\. Expose configurable Extras operation order (upscale → face restoration or reverse when valid) with before/after review and cumulative image memory/disk cost. Settings must indicate which transformations are applied in txt2img/img2img inline versus in Extras.  
8\. Batch Extras can honor the original filenames as \*\*display labels\*\* and exported manifest fields, but final durable artifacts must receive canonical collision-safe IDs. Directory inputs must be contained within authorized roots and outputs published through MacBook media store, not arbitrary model-worker paths.  
9\. Add single output image, selected-image export, group ZIP, intermediate optionally exportable images, metadata safe mode, log/manifest, and one-click Send to Edit/Generate. Any metadata-bearing export requires opt-in if prompt saving is disabled.  
10\. Provide postprocess proof: compare decoded pixel dimensions and resource model identity; for dual upscale check blend endpoints 0 and 1 against single models; verify no repeated upscaler load for each tile where persistent reuse is supported; audit peak RAM, swap and disk before starting.  
  
\*\*Likely files:\*\* \`workstation-ui.js::buildEnhanceWorkbench()\`, \`concept-a.js\` Edit tab navigation, \`media-ui.js\`, \`operator-console/image-postprocess.js\` (proposed), \`server.js\` action routes, \`media.js\`, upscaler workers, \`model-registry.js\`, \`capabilities.js\`, unit/browser tests.  
  
\*\*Exit:\*\* A1111 Extras functions and the stock postprocessing script functionality have real gated implementations, including batch, blending, face restorers and tiled diffusion. Existing Lanczos and Real-ESRGAN still pass their prior smoke journeys.  
  
\#\#\# Phase P10 — Full built-in generation scripts and Experiments Lab  
  
\*\*Dependency:\*\* P02 field-consumption builder, P05 seed behavior, P06/P08 for relevant options; current global queue must be stable. \*\*Owner:\*\* Generate → Batch / Sweep / Experiments, not a standalone tab that bypasses the dispatcher.  
  
\*\*Existing:\*\* numbered-prompt queue; Seed Lab; Prompt A/B; limited \`xyz-plot\` script. These are useful but do \*\*not\*\* establish full A1111 built-in script parity.  
  
1\. Build a declarative \*\*Script Registry\*\* with \`id\`, \`source\_ref\`, supported input modes, required backend controls, preflight estimator, result type, cancel policy, and privacy behavior. Each stock A1111 script must be represented by a discoverable Experiments mode; currently unsupported scripts must expose exact missing execution dependency without pretending to run.  
2\. \*\*X/Y/Z plot:\*\* replace hardcoded six-axis two-dimensional endpoint with a typed X/Y/Z axis registry referencing effective generation fields and \*\*all applicable upstream axes\*\*. Include: seed, variation seed/strength, steps, Hires steps/upscaler/sampler, CFG/Image CFG, prompt search-replace/order, sampler/scheduler, checkpoint, VAE, styles, sigma/eta/UniPC/beta options, refiner/switch-at, CLIP skip, denoise, size and other upstream axes where a compatible worker supports them. Retain stable field IDs and human labels.  
3\. X/Y/Z accepts value CSV, discrete option menus and validated numeric ranges. Add swap axes, auto-fill from model registry, legend/margins, vary seed along axes, include individual images/subgrids, choice of processing order and resource-aware hot-model minimization. No arbitrary user expression evaluation.  
4\. Build a \*\*pure experiment planner\*\*: normalize base request once, validate each generated cell against its target model, compute \`x \* y \* z\` counts, maximum output pixels, estimated disk use, expected model reloads and time confidence. Enforce confirmation threshold, user-configurable cap and heavy queue lease; do not force arbitrary 16-cell limit as final parity while ignoring resource safety.  
5\. Store child jobs and outputs in canonical media with full axis labels and lineage, plus grid artifact(s) with metadata; failed children create visible empty/failure cells rather than fabricated pictures, successful children remain.  
6\. \*\*Prompt Matrix:\*\* parse A1111 pipe-separated variable chunks, positive/negative mode, start/end ordering, join delimiter and same/new seed behavior; generate exact combinatorial image count and annotate each. Prevent exponential explosion via preflight/confirmation.  
7\. \*\*Prompts from File/Textbox:\*\* accept pasted text or selected local file; support per-line A1111 documented flags (prompt, negative, seed, cfg, styles, sampler, etc.) and safely reject unsafe path/command arguments. Create per-row validation report. This feature reuses but must not be confused with DexDiffusion's numbered-title batch format.  
8\. \*\*Loopback:\*\* feed each completed img2img result into the next iteration with selectable number of loops, final denoising strength, curve (Aggressive/Linear/Lazy), optionally CLIP/DeepBooru prompt interrogation if proven. Record each intermediary image and parent pointer. Cancel must end the series without destroying prior images.  
9\. \*\*SD Upscale:\*\* use P09's tiled diffusion operation exposed as stock built-in script preset; no second implementation.  
10\. \*\*Poor Man's Outpainting / Outpainting MK2:\*\* use P08's algorithms as script modes with validated options and visual previews; no duplicate code.  
11\. \*\*img2img Alternative Test:\*\* scope exact function from upstream \`scripts/img2imgalt.py\` (noise inversion / sigma-adjusted latent restoration) and determine whether current engines expose necessary gradient-free denoiser/latent operations. Implement via an isolated compatible backend only when genuinely equivalent; keep blocked if unsupported.  
12\. \*\*Custom Code:\*\* A1111's stock \`custom\_code.py\` can execute arbitrary Python when \`--allow-code\` is enabled. This is \*\*security-sensitive\*\*, not permission to run untrusted Python inside \`server.js\` or the Big Mac SSH worker. Require explicit design and owner decision for a local isolated process with hard path allowlists, no cloud/network/credential access, outputs imported through canonical staging and disabled by default; note that unrestricted Python cannot be safely exposed on a shared tailnet endpoint. If not approved, flag this as a separately blocked A1111-equivalence item, not silently exclude it.  
13\. \*\*Additional stock generation-affecting bundled extensions:\*\* source-audit A1111 \`hypertile\`, \`extra-options-section\`, \`soft-inpainting\`, LoRA, upscaler extensions and prompt-bracket-checker to decide per-control inclusion and avoid accidental omissions. Exclude postprocessing-for-training only under the accepted training exclusion.  
  
\*\*Likely files:\*\* existing \`server.js::/api/actions/xyz-plot\`, \`sdcpp-workflow/bin/sdcpp-xyz-plot.sh\` (if reusing), \`workstation-ui.js::buildBatchWorkspace()\`, proposed \`experiment-plan.js\`, \`a1111-experiments-ui.js\`, canonical index/media, unit/browser tests.  
  
\*\*Exit:\*\* All built-in stock image-generating scripts are in the inventory and have proven compatible execution where required; X/Y/Z truly has a third axis and the available upstream parameter families. Experimental modes respect memory and privacy, not only UI appearance.  
  
\#\#\# Phase P11 — Checkpoint, LoRA, Textual Inversion, Hypernetwork and generation settings parity  
  
\*\*Dependency:\*\* P02 effective-args truth, current Big Mac model availability and current operation-specific model registry. \*\*UI location:\*\* existing Generate model picker/resource tray; Model Browser; Settings → Generation / Sampling / Models; Edit's existing resources panel. \*\*No second registry.\*\*  
  
1\. \*\*Model selection:\*\* preserve \`MODEL\_CARDS\`, model target IDs, active secondary model slot and discover-assets flow. Show real checkpoint filename, family, hashes/sha when available, source location (privacy-safe), observed status, supported operations, recommended dimensions/steps/CFG and memory footprint if measured. Unproven target is selectable \*\*only\*\* with an explicit experiment warning and safety preflight; missing model cannot launch.  
2\. Restore \*\*model-specific options\*\* from actual backend capability rather than universal booleans. A checkpoint switch must serialize on the existing \`bigmac-heavy-inference\` lease, including queued Voice/Drama/Music/3D jobs. No overlapping global secondary-slot mutation.  
3\. \*\*LoRA:\*\* reuse \`extra-networks.js\` and \`edit-ui.js::buildResourcesControl\`. Add searchable cards, previews, trigger words, weights, multiple selection, order, metadata/sha and clear display of \*applied\* vs \*requested\* weights. Require a real LoRA-on/off A/B proof per backend family; currently MFLUX FLUX.2 LoRA is tagged unproven and may not be advertised as working.  
4\. \*\*Textual Inversion embeddings:\*\* add discovered SD-compatible embedding cards, prompt insert/remove, active/token counts and exact embedding-file resolution. Do not interpret a bare token in the prompt as proof its model loaded. Cross-family embeddings should be incompatible by default unless a verified loader says otherwise.  
5\. \*\*Hypernetworks:\*\* stock A1111 hypernetwork \*\*inference\*\* must be represented even though training is excluded. Implement via a compatible, separately proven local generation backend if stable-diffusion.cpp cannot load the corresponding network format. Preserve selection, strength, target-specific support and original checkpoint; do not silently conflate hypernetwork with LoRA.  
6\. \*\*Standalone VAE/UNet selection:\*\* expose only available compatible resources; report model-supplied/auto/none/explicit. Include VAE hash in reproducibility record when known. Add encode/decode method choices (full/TAESD where proven) and color/pixel corruption checks; support SDXL secondary CLIP skip only if installed engine actually implements it.  
7\. \*\*Embedding/resource gallery:\*\* reuse current Models/Resources patterns for filtering by family, kind, file status, compatibility, built-in preview and no-preview placeholder. Preserve source authenticity; don't generate synthetic LoRA previews that imply model proof.  
8\. \*\*Stock Sampling settings:\*\* expose eta/DDIM/ancestral, sigma churn/min/max/noise, schedule rho, beta schedule, UniPC variants/order, minimum unconditioned sigma, early negative-prompt skip, \`clip\_skip\`, RNG source, zero-terminal SNR, discarded penultimate sigma, original emphasis, old Karras and model-dependent sampling controls. Each field must have an \*\*effective\*\* worker pathway, defaults, valid range, applicable samplers and regression witnesses. Leave unsupported features in the parity ledger as real engineering work.  
9\. \*\*Stock Optimization/compatibility options:\*\* audit attention optimizations, cond/uncond padding/batching, token merging, conditioning cache, precision/quantization, FP8 behavior, VAE precision modes and legacy generation reproduction toggles. Implement meaningful equivalent modes only after measurement; display which toggles are inference outputs versus memory-management tuning. Never implement a GPU/RNG mode by lying about hardware semantics.  
10\. \*\*Settings UI:\*\* organize by Prompt / Sampling / Model Resources / VAE / Img2Img / Upscale / Generation Save & Metadata / Reproducibility / Advanced Compatibility. Provide search that maps exact A1111 names and aliases to a specific DexDiffusion owner and availability state. Avoid a separate mysterious settings authority; preference defaults are pure inputs to the common request normalization.  
11\. \*\*Config import/export:\*\* support machine-readable generation profile/recipe with version field and sensitive-text warning, never automatically import executable scripts, absolute paths or untrusted remote URLs. Existing favorites and localStorage migrations must continue to work; test backup/import round-trip with prompts enabled and disabled.  
12\. \*\*Truth labels:\*\* distinguish \`installed\`, \`runtime readable\`, \`backend flag accepted\`, \`live tested\`, \`user-enabled\`. \`PROVEN\` requires actual inference artifact and exact effective model/LoRA, not filename presence or a PyTorch feature advertised in upstream README.  
  
\*\*Likely files:\*\* \`model-registry.js\`, \`extra-networks.js\`, \`capabilities.js\`, \`controlled-args.js\`, controlled scripts, \`client-helpers.js\`, \`edit-ui.js\`, \`component.js\`, \`workstation-ui.js\`, \`a1111-settings-ui.js\`, \`concept-a.js\`, schema and tests. \*\*Exit:\*\* every generation-affecting A1111 settings key is either effective and verified on an approved local runtime or explicitly unresolved, and switching models never corrupts the shared heavy-compute state.  
  
\#\#\# Phase P12 — PNG Info, exact parameter restoration, gallery, batch/grid and export  
  
\*\*Dependency:\*\* P02 contract, P07 imported-image stage, P10 experiment outputs, P11 resource metadata. \*\*UI location:\*\* Media asset detail and Generate result panel; restore overlays route to existing \`reuseSettings()\` and \`openImageInEdit()\` rather than a second job builder.  
  
1\. \*\*PNG Info reader:\*\* import an arbitrary user PNG using existing \`/api/staging\` with bounded pixel/decompression size. Read PNG ancillary \`tEXt\`, \`zTXt\`, \`iTXt\` and native DexDiffusion indexed metadata; parse common A1111 infotext (\`parameters\`) including Prompt, Negative prompt, Steps, Sampler, Schedule type, CFG scale, Seed, Size, Clip skip, Model hash, VAE/LoRA, denoise, Hires, Refiner, styles and script fields when present. Support malformed entries without executing or guessing the embedded text.  
2\. \*\*Metadata authenticity:\*\* distinguish (a) metadata in the uploaded PNG bytes, (b) DexDiffusion's authoritative run record, (c) optional in-memory prompt snapshot, and (d) unknown. Never fabricate a seed, original prompt or model hash from image contents. If metadata conflicts, show both provenance sources and let the user choose a restoration source.  
3\. \*\*One-click restore with preview:\*\* show before/after field diffs and a target capability comparison. Offer \*Restore compatible parameters\*, \*Restore selected fields\*, \*Restore all to draft\* (unsupported fields become explicitly annotated, not sent to a job). Preserve selected source image and original prompt privacy setting. A restored sampler must lead to an \*\*actually applied\*\* sampler, or refusal before Generate.  
4\. \*\*Send-to actions:\*\* Generate (txt2img), Img2Img, Inpaint, Inpaint Upload, Outpaint, Enhance/Extras, comparison and optionally Puppet Master once approved. Each action passes canonical image ID, parent lineage and only operation-valid fields; never copy an inpaint mask into a prompt accidentally.  
5\. \*\*Generated PNG metadata:\*\* define an opt-in A1111-readable \`parameters\` export representation alongside existing machine-readable Dex metadata. With prompt saving off, user-triggered export must show a privacy warning and a \*\*redacted-by-default\*\* choice. No metadata text can end up in PNG files automatically contrary to the existing save policy.  
6\. \*\*Output gallery:\*\* retain dominant hero, sibling filmstrip, fullscreen, keyboard navigation, Keeper/Compare, detailer and source actions. Add selected-asset save/download, consistent ZIP bundle, batch grid, grid row/column/margin/annotation controls, postprocessing metadata and export formats only where actual encoders exist. Retain individual image identities when constructing a grid. Grid is an extra derived artifact, not a replacement for its source images.  
7\. \*\*Batch naming/path policy:\*\* map A1111 filename patterns to safe user-visible export filenames. Do not expose arbitrary filesystem writing paths from the tailnet UI; all durable objects remain under canonical MacBook storage and exports use explicit user action. Avoid overwrites, path traversal and metadata leakage in archive filenames.  
8\. \*\*PNG Info batch extraction:\*\* import many images with per-file metadata inspection; allow A1111-style selective property restoration for each item, show preflight diff before large jobs, and preserve original filenames only as origin labels.  
9\. \*\*Reproducibility:\*\* derive one versioned \`effectiveGenerationRecord\` used by result inspector, PNG Info, native manifest, A1111 export, recipe restore and X/Y/Z cells. Include backend revision/model hash if verified, prompt parser revision, exact sampler/scheduler/noise settings, reference/mask hashes, per-pass settings and family restrictions. A prompt that was never saved remains unavailable.  
10\. \*\*Tests:\*\* PNG with no metadata, A1111 positive/negative multiline content, compressed metadata, Unicode iTXt, corrupt/chunk-bomb, adversarial JSON, unsupported or renamed checkpoint, 0/1 values, duplicates, missing VAE, prompt-save OFF, ZIP extraction sanitization, multiple generated cells and multiple grid sizes. Negative cases must not publish source text in generic job events.  
  
\*\*Likely files:\*\* \`operator-console/png-info.js\` (proposed), \`image-store.js\`, \`library-index.js\`, \`image-validation.js\`, \`repro-bundle.js\`, \`media-ui.js\`, \`workstation-ui.js\`, \`edit-core.js\`, \`server.js\` and tests. \*\*Exit:\*\* imported A1111 PNG can be inspected, selectively restored and regenerated where compatible; unsupported/missing values are visible, not lost; exports respect canonical retention and privacy.  
  
\#\#\# Phase P13 — Shared job operations, truthful progress/ETA, Interrupt, Skip and live previews  
  
\*\*Dependency:\*\* P02 and the current V12 job/event ownership; implement in small cases independently of heavy new model work. \*\*UI location:\*\* global Job Center/queue dock, Generate primary action and results, Edit progress, other modules' existing job displays.  
  
1\. Preserve \`event-bus.js\` SSE monotonic/replay and \`cancellation.js\` job-identity requirements, \`operational-jobs.js\` normalized view, heavy-compute arbitration and per-job leases. Do not create another queue only for A1111.  
2\. Review \*\*Generate → Interrupt\*\* (stop current generation when safe), \*\*Stop after current\*\* (finish active image, drop pending images), \*\*Skip current image\*\* (retain later batch items), \*\*Cancel pending job\*\*, \*\*Resume interrupted queue\*\* as distinct actions. Each requires an actual worker protocol; \`AbortController\` ending browser polling does not cancel Big Mac inference.  
3\. Implement idempotent terminal transitions with process identity markers/nonces and scoped remote work directory checks. Never \`pkill python\`, \`killall node\` or stop other SSH users' model processes. Refuse cancellation with \`cancel-unsafe\` if provenance is insufficient.  
4\. Render progress as three separate metrics: stage (loading model, encoding, sampling, exporting), current image step progress (only from real backend events), overall job count. Do \*\*not\*\* display an invented 0% or progress computed solely from elapsed time; use indeterminate shimmer and stage labels when lacking samples.  
5\. ETA derives from \`timing-store.js\` buckets keyed by exact operation/model/resolution/steps/batch mode with sample count and confidence. Show unknown/insufficient evidence when too few comparable samples; especially distinguish cold model loading from warm sampling.  
6\. \*\*Live preview:\*\* A1111 can show intermediate denoising previews and preview cadence/quality settings. Add preview only if the installed runtime exposes valid interim frames/latent decoding and transfer cost is acceptable. No simulated blur sequence or final thumbnail looping as faux progress. Enable preview throttling, content/format choices where actually supported; ensure a preview is ephemeral and \*\*not\*\* automatically published as a final image. Low-memory skip is an explicit policy, not a false pass.  
7\. Global Job Center retains nonimage jobs (Voice, Drama, Music, 3D, World). UI should group by modality, share identical terminal/status rules and preserve per-modality result handling. No image-specific cancel bug should interrupt a concurrent voice render.  
8\. Browser reconnect: persist only safe identifiers; on mount, snapshot from backend followed by SSE replay/poll fallback. One listener per mounted shell. On history-miss, request a snapshot rather than invent event replay; display LOST/INTERRUPTED and recovery choices truthfully.  
9\. Preserve privacy of SSE/job logs by strict prompt/script/lyrics field denylist, including nested records, filenames and serializer aliases. Add event schema tests that intentionally submit canary text. Error messages may describe an internal gate without leaking user prompt.  
10\. Test Stop, Skip, immediate Cancel, queued Cancel, reconnection, partial output, all-fail, timeout, two simultaneous modality claims, heavy lease release after remote crash, native batch and sequential handling, and lost network while a job still runs.  
  
\*\*Likely files:\*\* \`dexdiffusion-v12.js\`, \`event-bus.js\`, \`cancellation.js\`, \`operational-jobs.js\`, \`timing-store.js\`, \`server.js\`, \`concept-a.js\`, \`workstation-ui.js\`, \`edit-ui.js\`, media producer integration and browser tests. \*\*Exit:\*\* stock A1111 generation operations have safe real equivalents, while Voice/Drama and other modalities retain correct job and artifact ownership.  
  
\#\#\# Phase P14 — ControlNet-style conditioning, Puppet Master seam and compatible inference-runtime decision  
  
\*\*Dependency:\*\* P01 explicit inventory, P02 validated params, P07 reference/masks, P11 model/resources proof and P13 cancellation. \*\*Priority:\*\* Do not block working Generate/Edit improvements awaiting uninstalled control weights.  
  
1\. \*\*Capability experiment first.\*\* Recheck exact installed \`stable-diffusion.cpp\` binary CLI for \`--control-net\`, \`--canny\` and preprocessors, input image handling and map sizes. Historical contract says Canny flag exists but SD1.5 ControlNet weights were missing. Read-only verify current weights and constraints; no automatic download or assertion of availability from generic upstream README.  
2\. Set a versioned \`ConditioningRequest\` with fields \`{sourceImageId, modelId, processor, controlImageId?, weight, startStep, endStep, width, height, pixelConvention, preprocessingVersion, metadata}\`. Only expose strength/start/end that the selected worker consumes. Reject bad or mismatched source/control images early; hash and retain map provenance.  
3\. \*\*Reference selection:\*\* reuse Media canonical image IDs or trusted staged uploads. Show before/after preprocessing previews, target dimensions, cropping, processor type (Canny/OpenPose/Depth/etc. only as genuinely available) and any composition constraints. Reject lost/corrupt maps before expensive inference.  
4\. \*\*First real control proof:\*\* choose one smallest SD1.5 Canny route if exact installed flags and compatible licensed model permit it, then run a controlled conditioned versus unconditioned A/B on the same seed. Require the actual control map to be consumed in worker arguments, output image valid and transfer complete.  
5\. \*\*Pose-specific proof:\*\* for Puppet Master use the existing integration assessment. Preserve Antigravity's spatial rig, hierarchy/camera/body plans; adopt GPT Motion Lab's keyframes/take director/inspection. Repair host name mismatch (\`window.PuppetMaster\` versus expected \`PuppetMasterApp\`), load pose handler, PNG export, versioned schemas and same-origin postMessage validation. No wildcard origins or message-source spoofing.  
6\. FLUX.2 Klein \*reference editing\* path is a separate candidate: prove MFLUX multi-reference editor command on Big Mac using its existing \*\*internal\*\* Klein hot model and an actual character + guide; do not assume text-to-image bridge already implements image editing. Pose accuracy and character identity need separate visual QA; reference guidance is \*\*not\*\* mathematically guaranteed pose control.  
7\. \*\*OpenPose humanoid:\*\* map joint JSON to the exact approved skeleton convention/colors and raster size; prove SD1.5 OpenPose ControlNet weights, worker and actual pose adherence across standing, seated and reaching variants. Do not use humanoid OpenPose as proof of tails/wings/quadrupeds, and do not claim the rig's original JSON dialects are interchangeable without explicit converters.  
8\. Defer or separately prove Depth, scribble, normal, reference/adapter or multi-ControlNet inputs rather than presenting them as supported by every model. For each algorithm prove preprocessor, map convention, model bytes, exact input arguments and output control influence. Compose a multiple-control UI only when worker architecture supports it.  
9\. Introduce Puppet Master as a dedicated Concept A subview/module \*\*only\*\* after safe iframe/asset state proof, or keep it integrated under Edit → Pose until user-approved UX. Reuse \`this.ed\`/Media, existing job submit/status/result endpoints; do not run a second generation service or preserve temp Big Mac outputs.  
10\. \*\*Hard parity conflict rule:\*\* if SDCPP and MFLUX cannot implement an essential stock A1111 latent/sampler/refiner/embedding behavior, perform a bounded design-and-proof of a narrowly selected companion local inference runtime. Preserve primary MFLUX, existing SDCPP, one MacBook API and one heavy-compute lease. Do not equate “control present in another runtime” with success until it produces a validated canonical artifact on the user's hardware. Any additional model/runtime installation needs explicit authorization and license review.  
11\. Security/performance: no network-accessible arbitrary-file loader, no public listener, no user-supplied remote shell expression, no giant control-image memory blowup, no untrusted \`postMessage\`; fail closed if model/provenance/format missing.  
  
\*\*Likely files:\*\* \`operator-console/image-conditioning.js\`, current \`server.js\`/staging, \`model-registry.js\`, \`capabilities.js\`, \`sdcpp-controlled-generate.sh\` or a dedicated proven worker wrapper, \`concept-a.js\`, \`a1111-conditioning-ui.js\`, \`media-ui.js\`, Puppet adapter/viewer files after actual artifact transfer, test evidence. \*\*Exit:\*\* at least one real SD-compatible conditioning path works, Puppet Master integration proceeds on its own proof gates, and \*\*every remaining A1111-only backend deficit\*\* has either a real compatible implementation or remains an openly blocking parity obligation.  
  
\#\#\# Phase P15 — Full parity qualification, native release, rollback and human acceptance  
  
\*\*Dependency:\*\* All relevant earlier phases for the specific release candidate. Each packet has its own regression gate; P15 is a fresh whole-workstation proof rather than accumulating old green test counts.  
  
1\. Re-run the source inventory against the pinned A1111 commit and the current implemented DexDiffusion code. Each ledger row must cite exact upstream setting and Dex ownership, UI visibility, request acceptance, worker consumption, runtime artifact receipt and regression proof. Add previously missed upstream functions; zero orphaned required controls.  
2\. \*\*100% parity gate:\*\* every in-scope mandatory requirement \`PASS\` on at least one compatible proven local runtime (or only training/merging \`EXCLUDED\`). Source-present/visual-only/no-op/blocked/missing model/unverified all fail full-parity acceptance. Distinguish feature family availability from every installed checkpoint's availability.  
3\. Verify user journeys at 1440x900, 1024x768, 768x1024, 390x844, native \`DexDiffusion.app\` WebKit and tailnet. Test fresh Generate, Edit, Extra, PNG Info restore, 3-axis experiment, script batch, ControlNet and audio/3D/World module navigation; no horizontal clipping or hidden submit.  
4\. Verify source/model compatibility matrix: MFLUX Klein txt2img unchanged; SD1.5, SDXL, Turbo exact model selection; model-dependent controls reject unsupported values; warm server and controlled CLI paths cannot disagree on advertised behavior.  
5\. Run unit and browser tests using \*\*isolated non-overwriting output directories\*\* (historically \`output/rev19\` files were overwritten by a harness; preserved golden files must not be touched). Run \`npm run check\`, targeted \`node --test\` tests, full \`npm test\`, static JS/shell checks, \`git diff --check\`, and actual native launch/direct screen QA as authorized and available.  
6\. Run bounded \*\*real inference\*\* specimens for each new backend family or solver-control family: different sampler effective args, two seed/variation cases, imported image recall, brush mask output, Hires secondary conditions, at least one LoRA effect, one face-restorer/upscaler, XYZ grid, Prompt Matrix, Loopback, ControlNet. Tests should verify backend and data provenance, not insist every stochastic image looks uniquely different.  
7\. Verify privacy in every output channel: file manifest, PNG metadata, SSE, job logs, exceptions, ZIP export, localStorage, crash reports, tutorial/help text and mixed-modality job queue. Prompt setting OFF must be honored even after converting from a stock A1111 parameter PNG unless user explicitly exports text.  
8\. Verify Big Mac media residue zero following successful transfer/cleanup; exact in-band remote failure and cleanup markers; no false PASS from SSH exit code alone; hash validation; canonical output root and original source immutability. Check staged assets TTL and disk/swap headroom.  
9\. Verify non-image regression journeys: Voice Designer loading, Voice sample bank/profile, Drama Cast/Direct/Produce/Review/Export, Music Song/Instrumental, Hunyuan Mesh/Textured/GLB viewer, WorldGen/Complete360 with luminance fallback, Media multi-type library and global Job Center. Do not demand a costly real job in every modality for a CSS-only change; final release needs appropriate representative live proof.  
10\. Document remaining limitations as a genuine \*\*BLOCKED release\*\* if any mandatory parity items have no runtime implementation. Never relabel \`BLOCKED\` to \`EXCLUDED\` for convenience; only the two accepted exclusions qualify. Human must accept visual quality and usability separately; automated checks cannot replace subjective approval.  
11\. Preserve dirty original repository work throughout. Commit only scoped authorized paths after inspecting staged diff; no \`git add .\`, \`git add -A\`, \`git clean\`, \`git reset --hard\`, stash-for-cleanliness, force push or unapproved deploy. Maintain meaningful checkpoints and exact rollback of \*new\* changes.  
12\. Append verified state and receipts to operational docs only after code and tests exist. Preserve original dated evidence (October 5–16) without rewriting historical claims into current proof. The installed Mac wrapper/Dock tile may be refreshed only when the user authorizes app installation/release and the identity is verified.  
  
\*\*Exit:\*\* \*\*COMPLETE A1111 GENERATION PARITY\*\* may be stated \*only\* when every ledger obligation passes, with a fresh inspected proof index and no regression of the multimodal workstation. Otherwise present the honest percentage and each unresolved item; never report marketing-complete.  
  
\#\# 5. Atomic implementation register — do not combine into one giant branch  
  
This register breaks the phases into independently reviewable repository changes. A slice is \*not\* authorized to mutate files simply because a plan names them. For each slice: record entry SHA and dirty-file hashes, exact touched paths, proof fixtures, risk boundaries, and a rollback patch that removes only that slice. Items that need a new backend are separated from UI because pretending they are UI-only would hide cost and incompatibility.  
  
| Slice | Phase | Smallest file-level change | Completion test and proof receipt | Cross-system guard |  
|---|---|---|---|---|  
| S00.1 | P00 | Inventory dirty state; hash specific modified and untracked source; capture branch/HEAD and existing scripts | Re-read hashes; no original changed | Voice/Drama uncommitted files retained |  
| S00.2 | P00 | Characterize live Concept A route/module navigation and load order | Browser opens each of ten modules and returns to Generate | Voice Designer and Drama Studio scripts still mounted |  
| S01.1 | P01 | Freeze 12 stock script names, 4 built-in processing scripts, bundled image extensions and \`shared\_options.py\` generation keys | Machine-readable upstream extracted list, pinned commit, no omission | No code execution of A1111 Python |  
| S01.2 | P01 | Bind every upstream source key to parity ID and Dex owner | 100% scanned identifiers assigned or accepted exclusion | Training/merger only accepted blanket exclusions |  
| S01.3 | P01 | Capture \`model-compatibility\` actual state and required code/backend status | False positive disabled if UI-only/no-op | No manufactured PROVEN records |  
| S02.1 | P02 | Add failing test demonstrating selected sampler omission | Two sampler choices currently normalize identically; test fails before repair | Existing MFLUX args unchanged |  
| S02.2 | P02 | Refactor normalization/builder and add explicit field disposition | Known control either applied or throws named 422/409 | Old flat bodies still accepted |  
| S02.3 | P02 | Wire sampler to SDCPP script and worker help map | Different supported samplers yield corresponding true effective arguments | No unrelated model/script refactor |  
| S02.4 | P02 | Reconcile command preview with actual builder | Command preview equals argument-recorded job with safe redaction | No prompt in logs when disabled |  
| S02.5 | P02 | Reject silent clip skip/tiling/face restore drop | Every accepted special field reaches real compatible handler or rejects | Protected current images unaffected |  
| S03.1 | P03 | Compose one advanced Generate form with capability-driven controls | Model switch preserves compatible settings; all fields keyboard discoverable | Concept A navigation/result stage unchanged |  
| S03.2 | P03 | Replace duplicated model selectors with single authoritative control | One visible selected target drives form and request | Existing model browser remains usable |  
| S03.3 | P03 | Effective request preview/help/unknown status | Compare form, preview, normalized API and worker args | No fake runtime state or forced new network |  
| S04.1 | P04 | Pure prompt grammar scanner, tokenize/prove backend support | Golden syntax test suite at exact parser revision | Normal prompts remain unchanged |  
| S04.2 | P04 | Versioned styling/placeholder substitution UI | Style positive and negative insertion round-trip | Prompt privacy and existing recipes retained |  
| S04.3 | P04 | Add schedule/AND/BREAK conditioning worker or proof gate | Per-step conditioning state actually changes on real backend | Never claim string substitution equals scheduling |  
| S04.4 | P04 | Searchable token count, syntax validation and contextual editing | Correct model-aware tokens or truthful unknown | No user typing/focus regression |  
| S05.1 | P05 | Seed, subseed, strength, resize fields | Zero vs positive variation and resize worker behavior proven | Seed Lab/new-seed variation untouched |  
| S05.2 | P05 | Native batch/sequential seed planner with receipt | Per-item seed deterministic and recoverable | No double-randomization on resume |  
| S05.3 | P05 | Solver/sigma/eta advanced option contract | Each option modifies true supported worker parameters | Model-specific compatibility enforced |  
| S05.4 | P05 | Noise compatibility and legacy reproduction modes | Same settings reproduce within expected backend constraints | No NVIDIA claims on Apple hardware |  
| S06.1 | P06 | Second-pass separate prompt/negative + final size UI | Second-pass actual conditioning and result dimension verified | Existing Hires path preserved |  
| S06.2 | P06 | Per-pass sampler/scheduler/checkpoint | Second pass uses selected supported settings, run receipt proves | One secondary model slot and arbiter |  
| S06.3 | P06 | In-sampling refiner transition adapter | Actual backend transition stage/step captured | No fake after-the-fact second pass labeled refiner |  
| S07.1 | P07 | Img2img resize policy and scale UI | Crop/fill/resize outputs match expected geometry | Authoritative Edit source/Run state retained |  
| S07.2 | P07 | Sketch and Inpaint Sketch pixel/overlay layers | Painted color guide drives actual worker input | Mask painter stays separate and source unmutated |  
| S07.3 | P07 | Inpaint Upload separate image + mask stage | Mask/source validation, orientation and deletion proof | Staged remote data lifecycle safe |  
| S07.4 | P07 | Uploaded/directory batch Edit | Per-input manifest, stable results and filename labels | No directory traversal or source overwrites |  
| S08.1 | P08 | A1111 mask/full vs ROI modes, padding/fill/invert | Pixel-exact mask/transparency/ROI tests and real worker | Current Detailer/outpaint masks unaffected |  
| S08.2 | P08 | Poor Man's Outpainting algorithm | Upstream-equivalent generated canvas/mask and lineage | Existing simple Outpaint remains |  
| S08.3 | P08 | Outpainting MK2 matched noise | Deterministic FFT/matched-noise fixture and real result | Memory/cost bounded |  
| S08.4 | P08 | Soft inpaint alpha and condition weights | Float mask strength genuinely reaches worker | No false conditional effect |  
| S09.1 | P09 | Extras single/batch/directory shell and scale UI | Output dimensions/limits and file paths validated | Keep current Enhance buttons |  
| S09.2 | P09 | Primary+secondary upscaler blend | 0/1 endpoints equal independent outputs; intermediate blend valid | Existing ESRGAN proof unchanged |  
| S09.3 | P09 | GFPGAN and CodeFormer adapters | Actual model loaded/restored face output and weight effect | Identity/preservation review required |  
| S09.4 | P09 | Tiled SD Upscale | Tile count/overlap/reconstruction/artifact integrity | One shared heavy lease |  
| S09.5 | P09 | Optional stock upscale family adapters | Exact model/revision/license/runtime proof, not just options | No auto downloads or memory overload |  
| S10.1 | P10 | Typed experiment planner/axis registry | Every applicable upstream axis mapped/tested | No arbitrary code eval |  
| S10.2 | P10 | Z axis + labels and recordable X/Y/Z grids | Three-axis result count, seeds and per-cell origin verified | Existing 2D plots still work |  
| S10.3 | P10 | Prompt Matrix combinations | Correct expansion order, count, positive/negative behavior | Large jobs require confirmation |  
| S10.4 | P10 | Prompts from File/Textbox | Safe row flags and independent per-row validation | Preserve numbered batch grammar |  
| S10.5 | P10 | Loopback chaining | Intermediate artifact lineage and denoise curve tested | Cancellation keeps completed iterations |  
| S10.6 | P10 | img2img Alternative Test | Exact latent inversion proof or documented backend blocker | No simulated inverse sampling |  
| S10.7 | P10 | Secure Custom Code design decision | Explicit review/approval or remains gated; never tailnet arbitrary Python | No arbitrary shell execution |  
| S11.1 | P11 | Models resource cards and verified status | File/model identity and actual capability gates match runtime | Secondary slot unaffected |  
| S11.2 | P11 | LoRA weights/trigger/order and evidence | Real enabled versus disabled effect proof | Existing prompt tag routing retained |  
| S11.3 | P11 | Embeddings, hypernetwork, VAE/UNet | Installed model-specific resource consumed or blocked | No training UI |  
| S11.4 | P11 | Full generation-affecting Settings search/category | Every settings key has one state owner and help | Existing system and privacy unchanged |  
| S11.5 | P11 | Backend solver/precision performance controls | Verified output/performance effect and bounded memory | No unproven acceleration claims |  
| S12.1 | P12 | PNG metadata importer/parse | Real A1111 PNG info and malformed/empty cases | No metadata-based code execution |  
| S12.2 | P12 | One-click selective restore and diff | Restore uses model-effective settings or blocks | No prompt saving without consent |  
| S12.3 | P12 | PNG/ZIP/Grid export with safe paths | Original images persist, grid is derived artifact | Canonical MacBook store only |  
| S12.4 | P12 | All send-to edges from Media/Generate | Source ID and provenance survive transitions | Voice/music assets not misclassified as images |  
| S13.1 | P13 | Safe cancel/skip/stop lifecycle controls | Kill exact owned job only; pending and batch behavior tested | Other modality process untouched |  
| S13.2 | P13 | True job progress and ETA confidence | Unknown stays indeterminate; stage and measured buckets shown | SSE canary privacy retained |  
| S13.3 | P13 | Live image preview engine and preferences | Preview is real intermediate artifact or unavailable | No fake percentages or duplicate final media |  
| S13.4 | P13 | Reconnect/replay and lost-job recovery | Refresh/close/reopen retains exact active job and queue | Exactly one active EventSource |  
| S14.1 | P14 | SD1.5 Canny ControlNet standalone proof | Model byte read, CLI flags, actual conditioned image | No installed asset assumed |  
| S14.2 | P14 | Conditioning request and UI map preview | Validated model+processor+image contract and lineage | No uncontrolled input path |  
| S14.3 | P14 | Puppet Master secure embed/pose import/export | Save/load, validated same-origin messages, exact export bytes | Existing ten modules remain |  
| S14.4 | P14 | MFLUX reference edit standalone proof | Klein multi-reference edit outputs real canonical image | Original internal Klein txt2img untouched |  
| S14.5 | P14 | OpenPose humanoid and nonhuman policy | Correct body type maps, actual conditioned pose adherence | No quadruped-as-humanoid flattening |  
| S14.6 | P14 | Companion backend decision for latent-only blockers | Smallest real equivalent test, licensing and memory decision | No full A1111 app or 2nd listener by default |  
| S15.1 | P15 | Exhaustive upstream scan + gap ledger reconciliation | No unmapped stock generation control | Exclusions remain exact |  
| S15.2 | P15 | Cross-modality browser/native/WebKit QA | Ten modules and new controls remain accessible | No Voice/Drama/Git worktree loss |  
| S15.3 | P15 | Model, prompt privacy, output and safe operations tests | Real samples with exact artifact hashes/receipts | Big Mac cleanup and one scheduler |  
| S15.4 | P15 | Release manifest and human acceptance | User-facing parity status truthful; no unresolved mandatory row called PASS | No unauthorized commit/push/deploy |  
  
\#\# 6. Unified interface behavior contract  
  
\#\#\# 6.1 Exact Concept A navigation changes  
  
\*\*Keep the existing ten module rail entries.\*\* Do not introduce a second navigation rail, generic Gradio layout, duplicate app header, duplicate queue or second workbench root. The A1111 workflows should be accessible by \*\*secondary tabs/accordions only in the relevant module\*\*.  
  
\*\*Workstation (\`buildConceptWorkstation\`)\*\*  
  
\- Retain Quick Start and Recent Assets. Add a \`Image Generation Lab\` shortcut that navigates to Generate → Experiments, not a second experimental console.  
\- Active Job cards should display concise modality badge, operation, stage, real progress/unknown and exact command to open Job Center. Clicking a job must never expose private prompt text in modal headers.  
\- Templates/Recipes should link to existing recipe store with a no-prompt default. A recovery card must differentiate interrupted image runs from broken/missing historical assets.  
  
\*\*Generate (\`buildConceptGenerate\`)\*\*  
  
\- Keep the result-first two-column layout. Make the left control column vertically organized with a persistent top row (prompt, model, Generate/Interrupt/Skip) and collapsible categories: \`Essentials\`, \`Seed & Variation\`, \`Sampler & Noise\`, \`Hires & Refiner\`, \`Resources\`, \`Styles\`, \`Experiments\`, \`Effective Request\`.  
\- Use \*\*one\*\* target selector and model browser; the current duplicate \`targetSelectV1\`/\`targetSelect\` composition gets reconciled. Preserve responsive mobile single-column layout with result accessible without scrolling through 200 advanced fields.  
\- \`Essentials\`: positive/negative prompt, model/checkpoint, sampling method, scheduler, steps, CFG, W/H, batch count/size, aspect presets, tiling and face restore. Show explicit backend-specific disable reason. Prompts update without destroying editor focus.  
\- \`Seed & Variation\`: seed random/reuse, variation seed random/reuse, variation strength, resize-from W/H. Show whether A1111-style latent variation is proven for selected model or awaiting compatible runtime.  
\- \`Sampler & Noise\`: detailed advanced solver subsections with hide/show by actual sampler/backend. Every visible slider includes numeric readout and value restore; default differ by installed backend.  
\- \`Hires & Refiner\`: separate cards; second-pass target size and controls, provenance preview; show refiner as distinct from two-pass after-image editing.  
\- \`Resources\`: current LoRA/VAE browser plus embeddings/hypernetwork panels; model family filter and apply state.  
\- \`Styles\`: styles editor, apply materialization, positive/negative templates, token counts and prompt compiler preview.  
\- \`Experiments\`: X/Y/Z/Prompt Matrix/Prompts from File/Loopback/SD Upscale, with planner/result matrix and resource cost confirmation; existing Batch/Seed Lab/Prompt A/B continue as useful Dex workflows.  
\- \`Effective Request\`: exact normalized params, unsupported reasons, model capability status, privacy-safe CLI summary, predicted resolved seed policy and expected output artifact format.  
\- \`Preview and result\`: retain large hero, sibling filmstrip and actions. Add \`Save\`, \`ZIP\`, \`PNG Info\`, \`Send to Extras\`, optional grid and interim preview if available. Record provenance for every result.  
  
\*\*Edit / Enhance (\`buildEditWorkbench\`, \`buildEnhanceWorkbench\`)\*\*  
  
\- Topbar edits: \`Img2Img\`, \`Sketch\`, \`Inpaint\`, \`Inpaint Sketch\`, \`Inpaint Upload\`, \`Outpaint\`, \`Batch\`. \`Enhance\` remains accessible via existing Edit top tab, not a disjoint new top module.  
\- Authoritative source pane shows native canonical source or clearly marked temporary imported source, transform/resize/ROI, selected mask/overlay, and real model supports. Brush tool works with pointer and touch. Separate sketch color from binary masks.  
\- Main settings panel exposes A1111 mask modes and masked-content options, denoising, sampler/CFG, source mode, batch masks, alpha, color correction and backend gate. Keep one Run/Cancel progress panel and outcome images with parent IDs.  
\- Enhance subview organizes \`Single\`, \`Batch\`, \`Directory\` inputs and \`Resize/Upcale\`, \`Face Restore\`, \`Tiled SD Upscale\` operations without hiding existing Lanczos/ESRGAN/High-Res Refine links.  
  
\*\*Media (\`buildLibraryWorkbench\`, \`buildMediaLibraryPanel\`)\*\*  
  
\- Existing canonical multi-type library remains central. Add PNG Info as a \*\*contextual inspector\*\* only for image assets. Audio, GLB, panorama and video cards continue to use their own metadata/action sets.  
\- Restoration preview shows \`field\`, \`recorded value\`, \`current value\`, \`proposed value\`, \`support state\`, \`effective backend value\`. Unsupported values are never silently substituted.  
\- Keep Keeper, Compare, Lineage and Media preview. Add safe selected-image save/export, ZIP/grid and all valid Send to actions.  
  
\*\*Settings/Help (\`buildConceptSettings\`)\*\*  
  
\- Preserve current general, capabilities, keyboard, help and system categories. Under Generation add searched subcategory registry rather than flattening all A1111 global settings into unrelated Workstation preferences.  
\- Show \`source in A1111\`, \`DexDiffusion implementation owner\`, \`compatible backend/model\`, \`last proof\`, \`blocker\`. Help articles link to the \*active\* form control, not a fictional module.  
\- Never promote training, checkpoint merging, arbitrary executable code or unproven backends to a default visible action.  
  
\*\*Voice / Music / 3D / World / Drama\*\*  
  
\- Existing workspaces keep independent modes and names. Do \*\*not\*\* insert A1111 sampler controls into Voice Designer or Drama just because both use GPU compute.  
\- Global Job Center, Media and Settings may gain generic image-agnostic support for richer job statuses and provenance, but every modality's public API remains backward compatible.  
\- Preserve the present \`drama-studio-ui.js\`, \`drama-direct-ui.js\` and \`voice-designer-ui.js\` load order and their prototype-method wraps. Any script insertion must be tested against their mounted instance behavior.  
  
\#\#\# 6.2 Control behavior in empty, degraded and error states  
  
| State | Required visual and interaction behavior |  
|---|---|  
| No model selected | Field-level explanatory state; Generate disabled and one navigation route to model browser |  
| Selected model unreadable | Show \`MODEL INACCESSIBLE\` with exact target; no raw filesystem secret or optimistic PROVEN |  
| Backend unreachable | Form remains editable; submissions blocked with retry probe; existing queue not discarded |  
| Known A1111 field unsupported | Visible to inspect; disabled with named backend reason; parity ledger remains OPEN |  
| Required optional asset not installed | No auto download; show license/bytes/target and request approval in implementation workflow |  
| Active image render | Can navigate Voice/Drama/Media without resetting job; Job Center owns its lifecycle |  
| Sampler unknown for model | Selected choice preserved in draft, but cannot submit until compatible replacement chosen |  
| Unverified model setting | Display \`experimental/unverified\`, never silently apply it in production mode |  
| Prompt saving off | Defaults never serialize prompt, negative, expanded wildcards or imported A1111 metadata text to persistent storage |  
| Imported PNG with unknown info | Show \`No original parameters found\`, do not fabricate defaults as restored source settings |  
| Failed/partial batch | Successful outputs visible and durable, failed cell displays reason; retry targets only failed work |  
| Cancel unsafe due to absent remote nonce | Button refused with \`cancel-unsafe\`; do not kill generic model process |  
| No sampled progress | Stage text and indeterminate bar, no fabricated percentage/ETA |  
| Low memory/disk space | Non-destructive preflight block; no partial worker load, preserve canonical file integrity |  
| Narrow window/touch | Controls accessible by keyboard/touch, inspector collapses but never hides Generate/Run |  
| New feature unavailable | Context Help explains exactly what is missing; no fake demo that looks executable |  
  
\#\#\# 6.3 Concrete request normalization and effective-parameter requirements  
  
A versioned internal model may be introduced \*\*behind\*\* current \`/api/actions/generate-controlled\`, retaining legacy request formats:  
  
\`\`\`json  
{  
 "schema": "dexdiffusion.image-generation.v2",  
 "operation": "txt2img",  
 "target": "sd15",  
 "prompt": "\[user-entered; ephemeral unless opted in\]",  
 "negative\_prompt": "\[ephemeral unless opted in\]",  
 "sampling": {  
 "steps": 30,  
 "sampler": "euler\_a",  
 "scheduler": "discrete",  
 "cfg\_scale": 7,  
 "noise": {  
 "eta": 0,  
 "sigma\_churn": 0,  
 "sigma\_noise": 1  
 }  
 },  
 "seed": {  
 "base": 5120,  
 "variation": null,  
 "strength": 0,  
 "resize\_from": null  
 },  
 "size": { "width": 512, "height": 512 },  
 "batch": { "count": 1, "size": 1 },  
 "hires": { "enabled": false },  
 "resources": { "loras": \[\], "vae": "auto" },  
 "privacy": { "save\_prompts": false }  
}  
\`\`\`  
  
\*\*Illustrative \*proposed\* internal contract, not a payload accepted by the current server.\*\*  
  
\- \`normalizeLegacyBody()\` converts existing flat \`component.js\`/\`workstation-ui.js\` payloads to v2 canonical values. Never introduce ambiguous \`sampler\` versus \`sampling.sampler\` precedence without deterministic conflict reporting.  
\- \`validateAgainstCapabilities()\` computes \`effective\`, \`defaulted\`, \`incompatible\` and \`unsupported\` decisions; \`incompatible\` and \`unsupported\` requests must fail before the worker launches unless explicitly omitted by the \*user\*.  
\- \`buildControlledArgs()\` (or a new pure worker adapter function) consumes only \`effective\`. It must never drop accepted fields silently; flag support must be based on exact runtime CLI help rather than a generic A1111 option name.  
\- \`buildGenerationPreview()\` must use the same compiled request as the executing route. Because only the executor sees the effective command, tests must assert deep-equivalent field sets and exact argument order for the same request.  
\- Job records store permitted non-sensitive effective params, verified model identity, result hashes, source IDs and proof. Prompt/sensitive strings are either omitted/redacted or stored only with explicit opt-in under the existing policy.  
  
  
\#\# 7. Cross-workstream coordination: image parity is not the only active development  
  
The A1111 parity program is a \*\*new scoped image-generation track\*\* inside DexDiffusion. It does not reset, deprecate, or take architectural ownership of the broader workstation. The attached October 9 and October 16 continuation sources establish these concurrent needs; current live proof still governs exact completion status.  
  
| Existing/ongoing track | Keep active | Conflict with parity work | Coordination rule |  
|---|---|---|---|  
| Voice Designer and approved voice banks | Real engine audition, versioned design, voice-profile lifecycle and proven speech output | Shared \`server.js\`, \`index.html\`, model inventory, Job Center, output privacy | Protect uncommitted \`voice-\*\` and \`voice-designer-ui.js\`; no cross-track reformat/refactor; audio compute jobs use same arbiter |  
| Audio Drama Studio | Golden Reel real-speech acceptance; Casting, Direct, Produce, Review, Master, Export | Shared UI prototype load order, job events, state, storage and model availability | Preserve \`drama-studio-ui.js\`, \`drama-direct-ui.js\`, \`drama-ui.js\`, source-preserving script edits and incremental render cache |  
| WorldGen and Complete360 | DAP learned depth proof; fallback luminance depth; correct panorama output | Big Mac Metal/RAM, 3D assets, model staging, shared Media | Run learned-depth experiments as independent leases; no cross-engine claims from image-side settings |  
| 3D assets and viewer | Hunyuan Mesh/Textured, GLB viewer, source-image-to-3D handoff | Image staging, library IDs and viewport resources | Keep the source-image IDs immutable; do not mount live hidden 3D viewports during image jobs |  
| Music production | ACE-Step and Magenta worker paths; playback, export and planned stems/mastering | Big Mac resource scheduling, same Media store and SSE events | Preserve worker-specific parameters; A1111 controls do not appear in Music forms |  
| Video | Current UI and future runtime gating | Media/job shared infrastructure, potential large model installation | Preserve disabled/unavailable truth, no implicit LTX install or background reservation |  
| Puppet Master | Pose-reference conversion and verified conditioning | P07 Edit source, P12 Media provenance, P14 image conditioning, Concept A navigation | No standalone generation server. Integrate into one canonical handoff with secure same-origin validation |  
| External model storage | Restored \`wc2tb\` access and bounded SDCPP/Qwen model smoke proofs | Model paths, mounts, \`server.js\` capability checks, Big Mac disk/Metal | Verification before rearrangement. Keep working MFLUX Klein model/venv on Big Mac internal SSD |  
| Historical missing-image records | Preservation and evidence-based recovery of missing references | Library reconciliation, Media rebuild, original run manifests | Never delete or synthesize records to make parity/health counters appear green |  
  
\*\*Parallelism restriction:\*\* Independent read-only source analysis or pure-unit tests may proceed simultaneously. Any changes to \`server.js\`, \`concept-a.js\`, \`index.html\`, the shared event bus, media store, heavy-compute arbiter, model activation or canonical storage must be serialized against concurrent Voice/Drama/World updates. Big Mac inference jobs require an actual lease; do not schedule ControlNet/SDXL training-sized tests while the Golden Reel or panoramic-depth inference owns memory.  
  
\*\*Contract ownership:\*\* Each modality owns its user-facing controls and its model-specific request adapter. Shared foundation owns normalized jobs, events, provenance and canonical media indexing. The existence of one shared foundation does not authorize a generic request schema that erases modality-specific parameters.  
  
\#\# 8. End-to-end acceptance journeys and proof fixtures  
  
A passing API unit test is not the equivalent of a usable workstation. Implement these \*\*visible\*\* journeys as browser tests plus selectively chosen, bounded real inference specimens. Tests should produce named evidence receipts referencing the exact module state, model identity, job ID, input parameters, output artifact, test command and date. Smoke tests without real inference may qualify as \`MOCK\_TESTED\`, never \`LIVE\_PROVEN\`.  
  
| Journey ID | UI steps and expected observable behavior | Required failure fixture |  
|---|---|---|  
| J01 — Create basic | Workstation \> Generate, select proven SD1.5, enter prompt, choose sampler/steps/size/seed, Generate, inspect result and its effective sampler | Change target to Klein; SDCPP-only controls disappear or explain why, never silently remain effective |  
| J02 — Batch | Select count/size, submit, observe exact child counts and seed assignments, select a survivor | Cancel one queued/running item; completed images remain durable, others not misreported |  
| J03 — Variation | Generate seeded image, reuse base seed, apply variation seed/strength, inspect lineage and real latent-noise semantics | Variation strength zero matches defined baseline; invalid seed resize is rejected |  
| J04 — Prompt syntax | Open Prompt tools, preview syntax tree, execute a native or compiled weighted/scheduled prompt | Unsupported stepwise conditioning fails preflight rather than becoming literal text |  
| J05 — Hires/Refiner | Enable Hires, choose different second-pass prompt/sampler/size, inspect base/final records | Missing refiner or second-pass model blocks safely, original output survives |  
| J06 — Edit source | From result choose Img2Img, change strength, run; original source and returned image have different IDs | Invalid imported source or missing model reports exact failing stage |  
| J07 — Sketch | Import image, paint color strokes, see sketch overlay, run compatible worker | A grayscale binary mask alone is rejected as a Sketch proxy when pixel semantics differ |  
| J08 — Inpaint Upload | Load source and separate mask, inspect alignment, invert/blur/crop, inpaint only masked area | Wrong dimensions/transparency or full mask invokes truthful validation/confirmation |  
| J09 — Outpaint | Expand each side and choose Poor Man's or MK2 algorithm, compare seams and source placement | Zero-side extension or giant dimensions blocked without loss of original |  
| J10 — Extras | Send result to Enhance, choose two upscalers/blend, optionally face restore, export | Uninstalled restorer shows explicit missing model, no fake result |  
| J11 — Directory batch | Stage approved set of images, run per-file img2img/Extras and inspect filenames/results | Traversal/symlink/unexpected input type rejected before worker starts |  
| J12 — XYZ | Open Experiments, choose X, Y and Z axes, inspect Cartesian cell count, submit, inspect labeled grid and each child image | Incompatible axis/model pair and oversized Cartesian product blocked at preflight |  
| J13 — Prompt Matrix | Input combinatorial prompt fragments, preview expansion count/order, run and compare labeled outputs | Empty/faulty delimiter and work explosion blocked |  
| J14 — File prompts | Import multiline script with per-line arguments, preview effective requests, submit subset, retry failed items | Forbidden worker flags and path expressions cannot escape bounded parser |  
| J15 — Loopback | Feed image through N sequential img2img passes, inspect source chain and changing denoise | Cancellation after pass 2 preserves passes 1–2 and prevents later execution |  
| J16 — PNG Info | Import native and foreign A1111 PNG, inspect exact metadata, selective restore, send to img2img | Corrupted PNG/text and unavailable model cannot silently overwrite current settings |  
| J17 — Model resources | Search LoRA/embedding/VAE, apply compatible weight, inspect effective execution proof | Missing/mismatched resource cannot be represented as applied |  
| J18 — Live jobs | Start image job, switch to Voice/Drama, reconnect browser, reopen Job Center, stop exact image job | Only owned job is cancelled; unrelated voice/3D process remains alive |  
| J19 — Conditioning | Stage source+control image, select Canny/appropriate ControlNet, preview map, run matched-seed A/B | Mismatched model or unavailable control weight blocks without launching |  
| J20 — Pose handoff | Launch approved Puppet Master host, load/edit pose, export guide, generate, inspect pose/identity | Wrong origin/request ID cannot alter host state or trigger generation |  
| J21 — Output privacy | Disable prompt saving, generate, inspect metadata/PNG/ZIP/Media/events/job logs | Zero persisted original/expanded prompt text; opt-in user export is clearly separate |  
| J22 — Multimodal regression | Navigate ten modules; inspect running drama/music/3D jobs and all existing media types | New image CSS/handler does not steal focus, hide controls, create duplicate listeners or break playback |  
  
\#\#\# Machine-checkable test groups  
  
For each relevant change set, the implementer must add or update the corresponding files under \`operator-console/tests/\` and \`operator-console/tests/browser/\`, including:  
  
\- \`request-roundtrip\`: UI state → normalized effective params → preview arguments → exact worker arguments → metadata restoration; compare \*\*values, not merely keys\*\*.  
\- \`no-silent-noops\`: for every recognized request field, either a verified consumed path or a precise \*\*reject\*\* result; regressions fail CI.  
\- \`target-gates\`: MFLUX Klein versus SD1.5 versus SDXL/Turbo, model absent, VAE missing, unsupported sampler, wrong ControlNet family.  
\- \`prompt-privacy\`: prompt OFF, saved recipe OFF, imported A1111 PNG, SSE progress payloads, partial-job logs, ZIP output, crash/error logging, staged uploads, browser persistence.  
\- \`artifact-integrity\`: hashes and dimensions of final image, original nonmutation, required parent IDs, correct keeper state, valid staged cleanup, no Big Mac durable final copy.  
\- \`job-state\`: queued/running/partial/failed/cancelled/interrupted, lease release, refresh recovery, stop-after-current, skip versus immediate cancel, exact worker ownership.  
\- \`visual-interaction\`: 1440×900, 1024×768, 768×1024, 390×844, keyboard-only, touch/pointer, native WebKit, zoom, modal focus, prompt typing and resizing.  
  
\*\*Recommended minimal live GPU proof set per incremental release:\*\* one surviving primary Klein txt2img, one native SDCPP sampler pair, one Edit mask, one importer/metadata restore, one new feature-specific worker test, and one shared-lease cross-modality check. For full final parity, add at least one specifically validated specimen for \*\*each distinct newly introduced inference algorithm\*\*; do not equate one successful SD1.5 render with proof of every sampler, refiner, face-restorer, Hires, conditioning or inversion algorithm.  
  
\#\# 9. Release train, dependency chain, and implementation stop lines  
  
\#\#\# Milestone A — Request truth and existing UI completion  
  
\*\*Phases:\*\* P00–P03. \*\*Primary proof:\*\* all existing Create/Edit/Media controls accurately reach their current backend or visibly reject unsupported settings. Remove duplicate target selection, show sampler capability, preserve ten-module navigation. A feature becoming \*\*visible\*\* is not enough: a compatible live render must demonstrate the newly wired sampler and retained output metadata.  
  
\*\*Rollback:\*\* Revert only the new packet-specific UI/normalizer/worker changes, while preserving the original uncommitted workspace and historical images. No forced checkout.  
  
\#\#\# Milestone B — Prompt, seed, solver and high-resolution fidelity  
  
\*\*Phases:\*\* P04–P06. \*\*Primary proof:\*\* full upstream prompt forms, seed/variation semantics, solver control families and Hires/refiner functions mapped to actual capable runtime(s). Model-specific inapplicability is fine; absence of \*\*any\*\* verified equivalent remains a blocked requirement.  
  
\*\*Decision point:\*\* If the pinned SDCPP and MFLUX executors do not expose stepwise conditioning or latent-noise manipulation, decide on a \*\*small compatible local inference adapter\*\*, with separately authorized installation and an explicit memory/resource proof. A UI workaround that changes prompts between independent jobs is not a replacement for one A1111 step-scheduled diffusion pass.  
  
\#\#\# Milestone C — Edit, Extras and scripts  
  
\*\*Phases:\*\* P07–P10. \*\*Primary proof:\*\* all Img2Img modes, sketch semantics, A1111 mask and outpaint modes, Extras postprocessing and built-in generation scripts. Proven conditioned pixel effects and per-item lineage are required. The previously working editor, detailer and media browser must still pass.  
  
\*\*Decision point:\*\* Bundled A1111 script \*\*Custom Code\*\* is a privileged local code-execution feature. To satisfy literal parity without exposing arbitrary Python execution to anyone with tailnet web access, implement only an explicitly user-approved, local-interactive execution surface with strong process boundary and validation, or report this item \*\*BLOCKED\*\*. Do \*\*not\*\* silently exclude it as irrelevant or misrepresent a lightweight formula language as equivalent arbitrary Python. An untrusted tailnet-accessible arbitrary code endpoint is not an acceptable default.  
  
\#\#\# Milestone D — Resource, metadata and job fidelity  
  
\*\*Phases:\*\* P11–P13. \*\*Primary proof:\*\* selected model/LoRA/embedding/VAE actually influences worker, PNG metadata permits lossless compatible restoration, long-running jobs and independent audio/3D/workstation operations survive navigation and cancellation.  
  
\*\*Decision point:\*\* A1111's user-selectable RNG/precision/kernel optimizations may be PyTorch/CUDA-specific. To claim literal equivalence, the matching numerical behavior or an actually compatible runtime must be proved. Unsupported CUDA flags on Apple Silicon cannot become decorative UI options or blanket exclusions.  
  
\#\#\# Milestone E — Conditioning and release qualification  
  
\*\*Phases:\*\* P14–P15. \*\*Primary proof:\*\* real conditioning and Puppet handoff where requested, zero unclassified source requirements, 100% verified parity, multimodal journey regression PASS, native/tailnet app proof and privacy/integrity receipts. Final parity release is \*\*BLOCKED\*\* whenever any required capability remains without a proven equivalent. Release smaller working slices as explicitly \*\*partial parity\*\* if desired, without changing the final target.  
  
\#\#\# Dependency graph  
  
\`\`\`mermaid  
flowchart TD  
 P00\[Preserve local state\] --\> P01\[Version-pinned parity inventory\]  
 P01 --\> P02\[Lossless normalized execution contract\]  
 P02 --\> P03\[Actual Concept A Generate UI\]  
 P02 --\> P04\[Prompt semantics\]  
 P02 --\> P05\[Seeds and solver\]  
 P02 --\> P07\[Edit modes\]  
 P03 --\> P06\[Hires and refiner\]  
 P05 --\> P06  
 P07 --\> P08\[Masks and outpainting\]  
 P07 --\> P09\[Extras and restorers\]  
 P04 --\> P10\[Scripts and XYZ\]  
 P05 --\> P10  
 P07 --\> P10  
 P02 --\> P11\[Resources and settings\]  
 P02 --\> P12\[PNG Info and restoration\]  
 P07 --\> P12  
 P10 --\> P13\[Global job and preview fidelity\]  
 P11 --\> P14\[ControlNet + Puppet bridge\]  
 P07 --\> P14  
 P12 --\> P14  
 P13 --\> P14  
 P06 --\> P15\[Qualification\]  
 P08 --\> P15  
 P09 --\> P15  
 P10 --\> P15  
 P11 --\> P15  
 P12 --\> P15  
 P13 --\> P15  
 P14 --\> P15  
\`\`\`  
  
\*\*Prioritization nuance:\*\* P13 includes global Job Center reliability, so bug fixes for existing cancellation and SSE should be applied early as a narrow cross-cutting patch even though full live-preview and parity finalization occurs later. The graph is an implementation dependency guide, not a demand that all features be serialized.  
  
\#\# 10. Detailed data preservation, schema migration, and safe recovery  
  
1\. \*\*Version every new state schema.\*\* A v2 generation request or recipe must be reversible to the existing flat API for old callers wherever semantic equivalence exists. For fields with no old representation, persist them in a namespaced metadata block rather than overloading \`preset\` or \`mode\` ambiguously.  
2\. \*\*Migrate, don't rewrite.\*\* Existing \`dex\_favorite\_presets\`, prompt profiles, recipe store JSON, queue snapshots, edit recall, \`image-store\` manifests, historical \`runs/\` and shared Media index must remain readable after upgrade. Migrations operate on copies, are idempotent, preserve old versions/backups, and include rollback tests.  
3\. \*\*Prompts must remain private by default.\*\* A1111 PNG Info import may contain plain prompt text. Keep it transient in browser/authorized temporary staging unless the user explicitly enables prompt retention. Restoring a setting or exporting a PNG must not independently toggle \`save\_prompts\`; exporting a copy with prompt text needs deliberate opt-in and a preview.  
4\. \*\*Staging policy:\*\* imported PNGs, mask files, pose maps, upscaler tiles and control preprocess outputs must have content-based type validation, size/pixel caps, unique temporary IDs and TTL. Staged bytes remain distinct from canonical files until a successful transaction. A failed job never overwrites a source or leaves incomplete files advertised as finished.  
5\. \*\*Output artifacts:\*\* retain original images, per-cell images, X/Y/Z composites, face-restored variants, masks, base/hires pairs and img2img loopback passes with parent-child relationships. \`Keepers\` and comparison references continue to resolve across format conversions.  
6\. \*\*External files/directories:\*\* never grant frontend raw arbitrary MacBook/Big Mac paths. Use a bounded file chooser/upload staging mechanism or existing approved directory tokens. For batch operations resolve aliases safely; reject absolute path traversal, symlink escape and unauthorized volume access.  
7\. \*\*Experimental runtime data:\*\* future compatible adapter libraries, checkpoint caches and ControlNet weights must not be placed in the MFLUX Klein hot-path directory. Big Mac external volume read tests, model-byte hashes and free-space checks are prerequisites to transfers; no model redistribution or license assumptions.  
8\. \*\*Safety and reversibility:\*\* no \`git reset --hard\`, \`git clean\`, \`git add -A\`, blanket stashing, history rewrites, destructive cleanup or auto-renaming user files. Record changed file IDs/hashes before each slice; rollback only new changes introduced by that slice.  
  
\#\# 11. Evidence register and stop conditions  
  
\*\*Upstream source pin:\*\* \`AUTOMATIC1111/stable-diffusion-webui@82a973c04367123ae98bd9abdf80d9eda9b910e2\`; enumerate native scripts, processing-script controls, \`ui.py\`, postprocessing, options and stock built-in extensions at that commit. Do not silently update the definition of parity mid-rollout; any later upstream change is a separate versioned delta.  
  
\*\*DexDiffusion source pin:\*\* GitHub \`westkitty/Image\_Gen@169ad079af02a22d738079276291c93c86bf299f\`, plus the local MacBook uncommitted overlay. \*\*The checked-in commit is a source-comparison baseline, not permission to treat local edits as disposable.\*\* Reconcile actual local files before executing P00 or applying any patch.  
  
\*\*Previously inspected source-derived contracts:\*\* Concept A ten-module shell and \`buildConceptGenerate\`; \`workstation-ui.js::\_createBody\`/\`buildCreateWorkbench\`/\`buildBatchWorkspace\`/\`buildResultStaging\`; \`edit-ui.js\` source/mask editor; \`server.js\` \`normalizeControlledGenerationBody\`/\`buildControlledArgs\`/\`xyz-plot\`; \`schemas/model-compatibility.json\`; \`schemas/generation-job.schema.json\`; \`sdcpp-controlled-generate.sh\`; \`mflux-controlled-generate.sh\`; upstream native scripts and bundled extensions. These references establish \*\*planning evidence only\*\*; all runtime claims require fresh receipts.  
  
\*\*Hard STOP before mutation:\*\* wrong repo/machine/branch; unknown dirty-file ancestry or collision; unapproved new engine/model download; stale unverified capability claim; raw prompt retention when disabled; unsafe mass job cancellation; Big Mac storage/lease conflict; code-execution endpoint visible to tailnet users; unreviewed external script; output write outside authorized canonical store; or any plan that would rewrite Voice/Drama uncommitted work.  
  
\*\*Hard STOP before claiming full parity:\*\* any open mandatory ledger requirement; invisible actual UI control; recognized request field accepted and ignored; unsupported model option apparently applied; broken re-import/restore; unverified backend effect; output provenance not inspectable; privacy leak; multimodal regression; or native release lacking a fresh QA receipt.  
  
\#\#\# Critical known uncertainties (must remain visible)  
  
\- Live MacBook dirty diffs, actual API health, source-to-app build identity and current installed backend CLI help were not fully verified for this plan.  
\- Current shared code and local updated Voice/Drama code may add additional routes or change UI startup behavior. The implementation operator must resolve those \*specific local facts\* before treating checked-in HEAD as final architecture.  
\- A1111's exact stochastic equivalence for variation-seed mixing, prompt scheduling, refiner handoff, sampler sigma controls, latent img2img inverse, clip-skip, CUDA-specific RNG and some postprocessing models has not been demonstrated on MFLUX or the pinned SDCPP build.  
\- ControlNet Canny support at the engine option level is not proof that an approved compatible ControlNet weight file is currently present or executes successfully.  
\- No new actual inference test, source mutation, deployment, download, model installation or Git commit was performed during plan authoring.  
  
\#\# 12. Handoff — first implementation run and reporting format  
  
The next developer/agent should execute \*\*P00 and P01 in read-only mode first\*\*, present the current ownership conflicts and exact first production patch; only then implement P02 as a bounded change. This avoids destroying Voice/Drama updates by writing against the older GitHub tree.  
  
\*\*Required report for each slice:\*\*  
  
\`\`\`text  
Slice ID:  
DexDiffusion repo / branch / HEAD / dirty-file manifest:  
Upstream A1111 source IDs covered:  
Original behavior characterized:  
Files deliberately changed:  
Previously modified files preserved:  
Normalized request and effective worker arguments:  
Compatible model/backend and exact proof receipt:  
Unit/browser/real-worker tests:  
Artifacts and SHA256 digests:  
Privacy, lease, remote cleanup, storage checks:  
Collateral regressions and rollback:  
New ledger states (PASS / BLOCKED / UNVERIFIED):  
Decision requests, if any:  
\`\`\`  
  
\*\*Suggested first executable instruction for a coding agent (read-only baseline, no implementation yet):\*\*  
  
\`\`\`text  
Work in /Users/andrew/Image\_Gen on the MacBook. This is a DIRTY, ACTIVE multimodal DexDiffusion repository.  
Read AGENTS.md, OPERATIONAL\_STATE.md and the attached  
DEXDIFFUSION\_COMPLETE\_UI\_IMPLEMENTATION\_PLAN.md and  
DEXDIFFUSION\_A1111\_PARITY\_LEDGER.json before proposing any source edit.  
  
Implement the PLAN's P00/P01 only as a READ-ONLY audit:  
\- Verify actual machine, Git branch/origin/HEAD, dirty worktree, installed native app build and active console.  
\- Identify files and routes whose local uncommitted work supersedes the plan's checked-in GitHub snapshot.  
\- Reconcile the 258 provisional ledger obligations against AUTOMATIC1111 source commit  
 82a973c04367123ae98bd9abdf80d9eda9b910e2 and all stock generation-affecting controls,  
 adding missed items without deleting original IDs.  
\- Map every obligation to the actual Concept A Generate/Edit/Enhance/Media/Settings surface,  
 normalized request, worker argument, model capability and required proof.  
\- Identify current silent-noop parameters, especially sampler, clip\_skip, tiling, restore\_faces;  
 validate each suspected gap against LOCAL source before declaring it.  
\- Preserve every modified/untracked file, project artifact and ongoing Voice/Drama pipeline.  
\- Do not edit repository files, run GPU inference, install/download, clean/reset/stash Git,  
 commit, push, deploy, start services or modify outputs.  
  
Return: (1) exact current-state evidence, (2) classified source-and-UI parity ledger,  
(3) changed-file collision map, (4) bounded P02 patch plan with tests and rollback,  
(5) blocker/approval list. Distinguish SOURCE\_PRESENT, UI\_EXPOSED, WIRED,  
MOCK\_TESTED, LIVE\_PROVEN, BLOCKED, EXCLUDED. Do not call 258 the final complete count.  
\`\`\`  
  
\*\*Ownership and completion statement:\*\* This blueprint and its companion JSON ledger are the \*\*plan\*\*, not an implementation, working feature set, parity certificate or release. Completeness of the plan is provisionally gated on automatic upstream source enumeration in P01; completeness of DexDiffusion itself requires P15's real end-to-end receipts. Until then, display the truthful state: \*\*planning complete for currently inventoried scope; implementation and full parity unverified\*\*.  