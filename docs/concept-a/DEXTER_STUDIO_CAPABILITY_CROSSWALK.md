# Dexter Studio capability crosswalk

Status: source-grounded mapping for the supplied 51-family scope; this is not a zero-loss certification.

## Inventory provenance

The current continuation supplies the 51-family IDs and scope names. It only
summarizes the separate 53-category audit by ranges, so that audit's exact item
wording remains unavailable. The repository's maintained
`docs/feature-function-inventory.md` and `docs/parity/EXECUTION_LEDGER.md` are
available; the former is a June 2026 operator-console inventory and the latter
is an AUTOMATIC1111 parity ledger, not either historical DexDiffusion audit.
The rows below map 53 current, source-grounded capability groups and the table
after them maps each supplied historical ID to those groups. Mapping is not a
one-to-one zero-loss certification.

Evidence labels:

- **Source + coverage** means the owner and a relevant automated suite are present; it does not assert that suite passed in this continuation.
- **Source only** means the owner was found, but no dedicated focused test was located during this pass.
- **Unavailable** means current source explicitly gates or declines the operation.
- **Unverified** means source presence does not establish runtime, worker, or human acceptance.

| # | Capability | Original entry point | Current entry point | State / API owner | Relevant automated test | Evidence status |
|---:|---|---|---|---|---|---|
| 1 | Dexter identity and original artwork | `index.html` shell branding and approved upload artwork | Concept A brand masthead and Workstation hero | `concept-a.js`, `index.html`, original upload/PWA assets | `tests/browser/concept-a-refinement.browser.js` | Source + coverage; asset hashes recorded in this turn |
| 2 | Ten-workspace navigation | Legacy shell navigation | Concept A grouped rail and module routes | `concept-a.js`; `Component.setScreen` | `tests/browser/concept-a-refinement.browser.js`, `tests/browser/interaction-matrix.browser.js` | Source + coverage |
| 3 | Search and command palette | Shared shell search / V12 palette | Concept A top bar and V12 palette | `dexdiffusion-v12.js` | `tests/browser/concept-a-refinement.browser.js` | Source + coverage |
| 4 | Global Jobs center | V12 Jobs / queue | Top bar, queue dock, Job Center | `dexdiffusion-v12.js` snapshot and job API | `tests/browser/concept-a-refinement.browser.js`, `tests/browser/interaction-matrix.browser.js` | Source + coverage |
| 5 | Help and tutorials | Existing Help module | Concept A contextual Help dialog and tutorial index | `concept-a.js`; local tutorial index | `tests/browser/concept-a-refinement.browser.js` | Source + coverage |
| 6 | Contextual inspector and transition safety | Concept A inspector; module navigation | Module-aware inspector, typed active-asset reference, and unsaved-work guard | `concept-a.js`, `component.js`, `edit-ui.js`, Drama state owner | `tests/browser/concept-a-refinement.browser.js`, `tests/browser/edit-workbench.browser.js`, `tests/browser/drama-studio.browser.js` | Browser fixtures cover Edit cancel/replacement/Back/reload, Drama Back, and Drama Save-and-Continue success/failure/delay; the app has no History API router |
| 7 | Console, worker, model, and resource truth | System and status surfaces | Top-bar event-stream state, resource HUD, System panels | `/api/version`, `/api/system-info`, `/api/resources`, V12 snapshot | `tests/browser/interaction-matrix.browser.js`, `tests/capabilities.test.js` | Source + coverage; live console is down |
| 8 | Workstation resume and start actions | Workstation home | Dexter Studio home, legitimate run continuation, task launchers | `component.js`, V12 jobs, `workstation-ui.js` | `tests/browser/concept-a-refinement.browser.js` | Source + coverage; saved-project resume not independently proven |
| 9 | Active jobs and recent canonical assets | Workstation run cards | Workstation Active Jobs and Recent Assets | V12 snapshot, run index, canonical image API | `tests/browser/concept-a-refinement.browser.js`, `tests/browser/interaction-matrix.browser.js` | Source + coverage |
| 10 | Prompt privacy and prompt persistence | Create privacy controls | Create and Workstation prompt controls | `component.js`, prompt-saving preference, canonical metadata | `tests/prompt-matrix.test.js`, `tests/browser/prompt-matrix.browser.js` | Source + coverage |
| 11 | Prompt composition and caret preservation | Create prompt fields | Prompt-first Create and Quick Prompt handoff | `component.js`, `dc-runtime.js`, `concept-a.js` | `tests/browser/concept-a-refinement.browser.js`, `tests/browser/form-stability.browser.js` | Concept A caret assertion passed; broader form-stability suite not run |
| 12 | Prompt styles, wildcards, and prompt ordering | Create prompt toolbar and wildcard APIs | Create tools and keyboard editing | `component.js`, `wildcards.js`, `prompt-styles.js` | `tests/browser/wildcard-placement.browser.js`, `tests/prompt-matrix.test.js` | Source + coverage |
| 13 | Model registry, selection, and readiness | Create / Models | Shared Create and Edit model picker; readiness truth | `/api/capabilities`, `/api/models`, `edit-ui.js`, `component.js` | `tests/browser/model-favorites.browser.js`, `tests/browser/interaction-matrix.browser.js` | Source + coverage; matrix synchronization defect repaired in test |
| 14 | Sampling, dimensions, seed, scheduler, and noise settings | Create advanced controls | Create main and Advanced/Expert controls | `component.js`, `sampling.js`, controlled argument builder | `tests/controlled-args.test.js`, `tests/browser/generate-sampling.browser.js` | Source + coverage |
| 15 | LoRA, VAE, embeddings, and supported model extras | Create / Models | Create extra-network controls and System capability ledger | `/api/assets`, `component.js`, capability gates | `tests/capabilities.test.js`, `tests/media-bridge.test.js` | Source + coverage; gated items retain unavailable states |
| 16 | Generation preview, request normalization, and replay | Create command preview / import | Advanced preview and settings import | `/api/preview/generation`, `component.js`, controlled request normalizer | `tests/controlled-args.test.js`, `tests/browser/generate-sampling.browser.js` | Source + coverage |
| 17 | Single-image generation and result recovery | Create Generate / Retry | Create result stage, Generate, active-job Cancel, retry | `/api/actions/generate-controlled`, V12 jobs | `tests/browser/interrupt.browser.js`, `tests/browser/interaction-matrix.browser.js` | Source + coverage; no live generation in this task |
| 18 | Batch generation | Batch workspace | Existing Batch workspace | `component.js`, batch job API | `tests/browser/progressive-batch.browser.js`, `tests/browser/interaction-matrix.browser.js` | Source + coverage |
| 19 | X/Y/Z sweeps and prompt matrices | Batch / Create sweep | Batch and matrix controls | `component.js`, `prompt-matrix.js`, `/api/actions/xyz-plot` | `tests/prompt-matrix.test.js`, `tests/browser/prompt-matrix.browser.js` | Source + coverage |
| 20 | Source selection, typed active-asset context, and compatible Edit handoff | Library / Edit source picker | Library selection, explicit Edit source load, viewer actions, shared inspector reference | `workstation-ui.js`, `edit-ui.js`, `component.js`, canonical image IDs | `tests/browser/edit-upload.browser.js`, `tests/browser/edit-workbench.browser.js` | Source + targeted handoff coverage; Edit suite passed in this continuation |
| 21 | Img2Img | Edit Img2Img | Specialist Edit workspace | `edit-ui.js`, `edit-core.js`, `/api/actions/img2img` | `tests/browser/edit-img2img-parity.browser.js`, `tests/browser/edit-workbench.browser.js` | Source + coverage; runtime not exercised here |
| 22 | Inpaint and mask geometry | Edit mask canvas | Specialist Edit workspace | `edit-ui.js`, `edit-core.js`, `/api/actions/inpaint` | `tests/browser/edit-inpaint-parity.browser.js`, `tests/edit-core.test.js` | Source + coverage; runtime not exercised here |
| 23 | Mask brush, zoom, pan, undo, and redo | Edit canvas controls | Source-coordinate mask editor | `edit-ui.js`, `edit-core.js` | `tests/browser/edit-workbench.browser.js`, `tests/edit-core.test.js` | Source + coverage |
| 24 | Outpaint and canvas extension | Edit outpaint controls | Edit operation selector and canvas geometry | `edit-ui.js`, edit validation and worker API | `tests/browser/edit-inpaint-parity.browser.js`, `tests/browser/edit-workbench.browser.js` | Source + coverage; capability-gated |
| 25 | Detailer | Edit Detailer | Detailer workspace controls and stages | `edit-ui.js`, detailer routes/state | `tests/detailer.test.js`, `tests/edit-core.test.js` | Source + coverage; exact detector/runtime limits remain capability-gated |
| 26 | Resize, Pillow upscale, ESRGAN, and hires workflows | Enhance / Edit | Enhance and Edit specialist actions | `workstation-ui.js`, edit/media bridges, capability registry | `tests/browser/interaction-matrix.browser.js`, `tests/capabilities.test.js` | Source + coverage; live processing not exercised here |
| 27 | Edit scripts, Puppet Master pose, and supported references | Edit scripts / pose tools | Edit Script tools and reference editing | `edit-scripts.js`, `puppet-master.js`, `/api/actions/transform` | `tests/browser/edit-scripts.browser.js`, `tests/browser/puppet-master.browser.js`, `tests/browser/ref-edit.browser.js` | Source + coverage; ControlNet remains unavailable |
| 28 | Source/result identity and derivative lineage | Library lineage / Edit result actions | Canonical parent/child relationships and compatible resume | `image-store.js`, `edit-core.js`, `workstation-ui.js` | `tests/browser/transform.browser.js`, `tests/canonical-images.test.js` | Source + coverage; original-file runtime hash not rechecked in this task |
| 29 | Image Library grid/list and density | Library gallery | Shared image Library grid/list controls | `workstation-ui.js`, `/api/library/images` | `tests/browser/library.browser.js` | Source + coverage; 40 unique first-page thumbnails in current fixture run |
| 30 | Image Library search/filter/sort | Library filters | Image filters, sort and search controls | `workstation-ui.js`, image index API | `tests/browser/library.browser.js` | Source + coverage |
| 31 | Image Library paging and thumbnail requests | Library paging | Bounded page API and thumbnail URLs | `workstation-ui.js`, `/api/library/images`, `/api/thumbnails/:id` | `tests/browser/library.browser.js` | Source + coverage; duplicate-ID guard added |
| 32 | Keepers, collections, and image metadata | Library details | Keeper, metadata, and lineage inspector | `workstation-ui.js`, image metadata API | `tests/browser/library.browser.js`, `tests/browser/png-info.browser.js` | Source + coverage |
| 33 | Fullscreen viewer, comparison, and navigation | Library viewer / compare | Viewer over active filtered collection; compare tools | `lightbox.js`, `workstation-ui.js`, compare API | `tests/browser/library.browser.js`, `tests/browser/transform.browser.js` | Source + coverage |
| 34 | Original image download and export variants | Library download/export | Canonical download plus copy/export options | Image export routes, `workstation-ui.js` | `tests/browser/library.browser.js`, `tests/export-service.test.js` | Source + coverage; byte-level live download not rechecked in this task |
| 35 | Distinct image and mixed-media indexes | Legacy image / media library | Accessible Concept A image and audio/video index tabs | `concept-a.js`, `workstation-ui.js`, `media-ui.js` | `tests/browser/concept-a-refinement.browser.js`, `tests/browser/library.browser.js` | Source + coverage; canonical stores remain separate |
| 36 | Voice profiles, samples, and approvals | Voice profiles | Voice profiles and sample lifecycle | `voice-ui.js`, `/api/voice/profiles` | `tests/voice-profiles-v2.test.js`, `tests/browser/voice-drama.browser.js` | Source + coverage |
| 37 | Voice Designer and supported voice creation | Voice Designer | Designer, preset, and supported profile workflows | `voice-designer-ui.js`, voice engine registry | `tests/voice-designer.test.js`, `tests/browser/voice-drama.browser.js` | Source + coverage; engine-dependent operations remain gated |
| 38 | Voice cloning, auditions, and evaluation | Clone / audition / evaluation surfaces | Voice profiles, audition, clone, evaluation controls | `voice-ui.js`, `voice-engines.js`, voice routes | `tests/voice-auditions.test.js`, `tests/browser/voice-clone-upload.browser.js` | Source + coverage; live model proof not performed |
| 39 | Voice long-form generation and conversion | Voice generation / OpenVoice conversion | Long-form voice and conversion panels | `media-ui.js`, `voice-ui.js`, media bridge | `tests/voice-audio.test.js`, `tests/browser/voice-drama.browser.js` | Source + coverage; worker readiness is runtime-dependent |
| 40 | Drama projects and script identity | Drama project/script entry | Drama project lifecycle, explicit save, and Studio | `drama-service.js`, `drama-ui.js`, `drama-studio-ui.js` | `tests/drama-source.test.js`, `tests/drama-migrate.test.js`, `tests/browser/drama-studio.browser.js` | Source + browser fixture verifies save readback and continuation; live acceptance remains unverified |
| 41 | Drama parsing, cast, and voice assignments | Script → Cast | Drama stages and Cast Bible | `drama-ui.js`, `drama-studio-ui.js`, drama service | `tests/drama-editor.test.js`, `tests/browser/voice-drama.browser.js` | Source + coverage |
| 42 | Drama direction, takes, and phrase controls | Direct / takes | Phrase direction, takes, accept/reject/pin/restore | `drama-direct-ui.js`, `drama-studio-ui.js`, producer | `tests/drama-producer.test.js`, `tests/browser/drama-studio.browser.js` | Source + coverage |
| 43 | Incremental Drama production and fingerprints | Produce | Stage-aware rendering and production identity | `drama-producer.js`, `drama-fingerprint.js` | `tests/drama-service-incremental.test.js`, `tests/drama-fingerprint.test.js` | Source + coverage |
| 44 | Drama QA, master, timeline, and export | Review → Master → Export | QA, mixer, master, package and export surfaces | `drama-qa.js`, `drama-master.js`, `drama-export.js` | `tests/drama-qa.test.js`, `tests/drama-master.test.js`, `tests/drama-export.test.js` | Source + coverage; exported audio not human-reviewed here |
| 45 | ACE-Step music generation | Music Song | Music specialist workspace with ACE-Step gate | `media-ui.js`, `media-bridge.js`, ACE-Step worker | `tests/browser/interaction-matrix.browser.js`, `tests/media-bridge.test.js` | Source + coverage; live audio generation not performed |
| 46 | Magenta instrumental generation | Music Instrumental | Instrumental path and worker availability | `media-ui.js`, `media-bridge.js`, Magenta worker | `tests/browser/concept-a-refinement.browser.js`, `tests/media-bridge.test.js` | Source + coverage; live audio generation not performed |
| 47 | Stems and mastering capabilities | Music advanced actions | Honest gated/unavailable states where no worker contract exists | Media capability registry | Capability and media bridge tests | Unavailable unless the runtime ledger proves otherwise; no false controls intended |
| 48 | 3D individual asset source, generation, and validation | 3D Assets | Asset source/generation, validation and export | `asset3d-bridge.js`, 3D UI owner | `tests/asset3d-bridge.test.js`, `tests/browser/interaction-matrix.browser.js` | Source + coverage; live worker acceptance not performed |
| 49 | 3D formats, viewer, and export | 3D asset viewer | Format-aware asset viewer and export actions | 3D asset API, viewer module | `tests/asset3d-bridge.test.js`, `tests/browser/interaction-matrix.browser.js` | Source + coverage; no new 3D job run |
| 50 | World projects and scene construction | World Viewer / project entry | World project, scene, placement, environment and camera controls | `world-bridge.js`, world project state | `tests/world-project.test.js`, `tests/world-tab-navigation.test.js` | Source + coverage; live rendering not performed |
| 51 | World viewer and supported rendering | World Viewer / render | Existing viewer, supported render paths and truthful gates | world project API, viewer/runtime modules | `tests/world-project.test.js`, `tests/browser/interaction-matrix.browser.js` | Source + coverage; visual scene acceptance not performed |
| 52 | System Doctor, privacy, storage, network, and preferences | System / Models / diagnostics | System panels and existing operational controls | `component.js`, `/api/system-info`, `/api/capabilities`, Doctor owner | `tests/capabilities.test.js`, `tests/browser/interaction-matrix.browser.js` | Source + coverage; live console is down |
| 53 | Video workspace boundary | Legacy `buildVideoWorkspace()` | Video destination reports generation unavailable and shows worker state; no working video generation path found in that builder | `media-ui.js`, `media-bridge.js`, `ltx-video` worker registry | `tests/browser/interaction-matrix.browser.js`, `tests/media-bridge.test.js` | Unavailable/planned; route does not establish a video-generation capability |

## Supplied historical 51-family mapping

The IDs and scope names below are reproduced from the current continuation
brief. “Current group(s)” refers to the numbered source-grounded rows above.
Several historical families intentionally map to multiple current groups, and
multiple historical families may share one current group. Test and evidence
details are recorded in the referenced current rows.

| Historical ID | Supplied historical scope | Current group(s) | Mapping note |
|---|---|---:|---|
| G01 | Ten-module shell and navigation | 1, 2 | Brand and navigation surfaces |
| G02 | Command palette and shortcuts | 3 | Palette and search route |
| G03 | Jobs, queue, history and cancellation | 4, 9, 17 | Global job center, active jobs, job-bound cancellation |
| G04 | SSE, reconnection, leases and ETA | 7, 17 | Runtime truth and generation/job progress |
| G05 | Help, tutorials and preferences | 5, 52 | Contextual Help and System preferences |
| G06 | Accessibility and model-aware controls | 6, 13, 14 | Inspector/navigation accessibility and capability-aware controls |
| G07 | Recipes, macros and reproducibility | 10, 16, 19 | Privacy-aware recipes, request replay, reproducibility matrices |
| G08 | Notifications, PWA and offline behavior | 4, 7 | Job notifications and runtime/offline status; see notification and PWA suites |
| C01 | Prompts, styles, wildcards and LoRA syntax | 12, 15 | Prompt tools and compatible resources |
| C02 | Model selection, favorites and compatibility | 13, 15 | Shared model picker and compatible extras |
| C03 | Dimensions, seeds, sampling and parameters | 14 | Target-aware sampling controls |
| C04 | Request preview and local enhancement | 16, 17 | Exact preview/replay and prompt/result enhancement routes |
| C05 | Generation, progress and cancellation | 17 | Controlled generation and shared job contract |
| C06 | Results, variations, Seed Lab and A/B | 17, 19, 33 | Result recovery, variation/matrix controls, comparison |
| C07 | Batch, sweeps, X/Y/Z, Matrix and file prompts | 18, 19 | Batch and sweep workspaces |
| C08 | Hires, detailer and compatible refinement | 25, 26 | Detailer and supported resize/refinement paths |
| E01 | Source import and exact-asset handoff | 20, 28 | Source identity and lineage-aware handoff |
| E02 | Img2Img, Inpaint and Outpaint | 21, 22, 24 | Three distinct supported edit operations |
| E03 | Mask editing, zoom/pan and undo/redo | 23 | Source-coordinate mask editor |
| E04 | Loopback, scripts, transforms and Puppet Master | 27 | Existing scripts and pose workflow |
| E05 | Compatible resources, presets and layouts | 20, 21, 27 | Edit settings stay attached to the Edit state and supported tools |
| E06 | Lanczos, ESRGAN and reference operations | 26, 27 | Enhancement and reference-transform paths |
| E07 | Edit jobs, errors, retry and chaining | 17, 20, 21, 28 | Shared job recovery, source handoff and lineage |
| L01 | Canonical image index and pagination | 29, 31 | Image index and bounded paging |
| L02 | Search, filter, sort, Grid/List and density | 29, 30 | Library layout and query controls |
| L03 | Fullscreen viewer, navigation and recovery | 33 | Viewer, active collection navigation and error recovery |
| L04 | Metadata, lineage, keepers and collections | 28, 32 | Canonical lineage and metadata actions |
| L05 | Multi-image comparison and inspection modes | 6, 33 | Context inspector and comparison surface |
| L06 | Downloads, formats, sidecars and ZIP exports | 34 | Original download and derivative export operations |
| V01 | Voice profiles, samples and cloning | 36, 38 | Profile identity and sample/clone lifecycle |
| V02 | Voice Designer, auditions and approvals | 37, 38 | Designer and audition/evaluation review |
| V03 | Speech generation and long-form output | 39 | Long-form and conversion workspace |
| V04 | Performance direction and engine restrictions | 37, 39 | Supported voice direction and engine capability gates |
| V05 | Synthetic clone evaluation and review | 38 | Clone evaluation and review controls |
| V06 | Existing-audio/conversion paths | 35, 39 | Separate mixed-media index and conversion handoff |
| D01 | Script import, edit, parse and save | 40, 41 | Drama project and script stages |
| D02 | Casting, voice bindings and pronunciation | 41 | Cast Bible, profile binding and pronunciation |
| D03 | Phrase/line direction and audition | 42 | Direct stage and phrase auditions |
| D04 | Takes, alternates, selection and undo | 42 | Take lifecycle and reversible decisions |
| D05 | Timeline, tracks, cues, music and FX | 44 | Timeline and mix/export state |
| D06 | Incremental line/scene/project production | 43 | Fingerprinted incremental producer |
| D07 | Review, QA, Master, Export and recovery | 44 | Review and deliverable pipeline |
| M01 | Song/Instrumental generation | 45, 46 | Separate ACE-Step and Magenta paths |
| M02 | Preview, transfer and planned-feature gates | 35, 47 | Media preview/handoff and truthful unavailable gates |
| T01 | Image-sourced supported 3D generation | 48 | Existing image-to-asset path and worker gates |
| T02 | GLB validation, preview, export and handoff | 49 | Canonical 3D artifact validation and delivery |
| W01 | World projects, placement and environment | 50 | World project/scene owner |
| W02 | Camera, lighting, scene rendering and export | 51 | Existing viewer and supported render routes |
| S01 | Doctor, model truth, capabilities and verification | 7, 52 | Operational state and capability ledger |
| S02 | Storage, privacy, network and diagnostics | 7, 10, 52 | Runtime controls and prompt/privacy boundaries |
| X01 | Legacy Video interface and actual reachability | 53 | Reachable legacy workspace; generation remains unavailable |

## Continuation findings

- The current Concept A shell maps the existing workspace routes and reuses
  current state owners. The image and mixed-media indexes remain separate.
- The older `docs/feature-function-inventory.md` is a source reference, not a
  current proof receipt. Current capability status is owned by the runtime
  capability API and the focused module tests.
- `buildVideoWorkspace()` is reachable through the legacy Video destination.
  Its Generate button is gated by the `ltx-video` worker record; the builder
  itself explicitly says generation is not implemented and does not create a
  video job. The route should be treated as a planned/unavailable surface.
- The supplied 51 IDs and scope names are mapped above. The exact wording of the
  separate historical 53-category audit remains **UNVERIFIED**; only its
  approximate ranges were supplied. No A1111 parity backlog is implied by this
  document.
