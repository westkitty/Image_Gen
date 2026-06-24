# Image_Gen Feature and Function Inventory

Generated: 2026-06-24

Scope: `/Users/andrew/Image_Gen`, focused on the maintained operator console, macOS wrapper, and `sdcpp-workflow` command bridge. Statuses are based on source inspection plus the live `/api/version` and `/api/capabilities` payload from the local operator console at `127.0.0.1:31337`.

## Runtime Truth Sources

| Source | Current result |
|---|---|
| `/api/version` | `gitHead=8681f22`, `cwd=/Users/andrew/Image_Gen/operator-console`, bind `http://127.0.0.1:31337` |
| `/api/capabilities` | Local stable-diffusion.cpp workflow bridge with model targets, samplers, schedulers, generation gates, edit gates, enhancement gates, model inventory, and asset cache |
| UI shell | `operator-console/public/index.html`, `operator-console/public/app.js`, `operator-console/public/styles.css` |
| Command bridge | `sdcpp-workflow/bin/*.sh`, called by `operator-console/server.js` |

## User-Facing Workflows

| Name | File/path | Type/category | Status | Intended behavior | UI exposure | Improved UI/UX placement | Safe to expose now | Final disposition | Backend/API/state dependency |
|---|---|---|---|---|---|---|---|---|---|
| Create txt2img controlled generation | `operator-console/public/index.html`, `operator-console/server.js` `/api/actions/generate-controlled`, `sdcpp-workflow/bin/sdcpp-controlled-generate.sh` | Primary generation workflow | wired | Generate images against allowlisted model targets with prompt, negative prompt, sampler, scheduler, size, seed, VAE, quantity, tiling, and privacy state | Create screen | Main Create command surface, with model caveat and preview/status | yes | fully usable | BigMac tunnel/server, staged model target, prompt validation, model compatibility |
| Legacy single generation | `server.js` `/api/actions/generate-single`, `sdcpp-cli-generate.sh` or `sdcpp-server-generate.sh` | Generation endpoint | wired but not primary | Generate one image through older CLI/server path | Not directly primary; used by feature gate and LoRA route label | Documented in System capability ledger as legacy/internal path | limited | internal/maintenance | Prompt validation, mode/API selection |
| Batch generation | `index.html` Batch, `app.js` `submitBatch`, `server.js` `/api/actions/generate-batch`, `sdcpp-batch-generate.sh` | Batch workflow | wired | Run multiple images from one prompt with count and seed mode | Batch screen | Batch tab with explicit count/seed language | yes | fully usable | `count`, `seedMode`, `seedStart`, generation params |
| X/Y/Z plot | `index.html` Batch tab, `app.js` `submitXyz`, `server.js` `/api/actions/xyz-plot`, `sdcpp-xyz-plot.sh` | Parameter sweep | partially wired | Generate grid for X and optional Y axes, max 16 cells | Batch screen, X/Y/Z tab | Keep as partial/proven-limited sweep tool | yes with caveat | experimental/partial | Remote server connection, allowed axes, max cell validation |
| Controlled sweep planner | `index.html` Create details, `app.js` `runControlledSweep` | Multi-job helper | wired partial | Run seed or CFG sweep from current controlled settings, max 8 jobs | Create collapsible section | Advanced Create section | yes | experimental/partial | `/api/actions/generate-controlled`, client-side job loop |
| Prompt draft reload | `app.js` `savePromptDraft`, `loadPromptDraft` | Local state helper | wired | Save prompt and negative prompt locally for reload | Create prompt toolbar | Create prompt toolbar | yes | fully usable | `localStorage` |
| Prompt style save/insert | `app.js` `loadStyles`, `saveCurrentStyle` | Local preset helper | wired | Save current prompt as a local reusable style | Create prompt toolbar and Styles select | Create prompt tools | yes | fully usable | `localStorage.styles` |
| Wildcard insertion and expansion | `operator-console/wildcards/*.txt`, `server.js` `expandWildcards`, `/api/wildcards`, `app.js` picker | Prompt composition | wired | Insert `__name__` wildcard tokens and expand server-side | Create prompt toolbar | Create prompt toolbar | yes | fully usable | wildcard files, prompt expansion |
| Ollama prompt enhancement | `server.js` `/api/ollama/status`, `/api/ollama/enhance`, `/api/ollama/chat`; `app.js` Ollama handlers | Local language model helper | wired with external dependency | Enhance prompt or chat through local Ollama model | Create compact selector; Create advanced Ollama chat | Create toolbar plus advanced chat | yes with dependency state | fully usable when Ollama responds | `OLLAMA_BASE_URL`/`OLLAMA_HOST`, model list |
| Command preview | `server.js` `/api/preview/generation`, `app.js` `previewCreateCommand`, `previewGenerationCommand` | Safety/diagnostic preview | wired | Show redacted command and normalized params without running | Create, img2img, inpaint | Advanced preview JSON section | yes | fully usable | validation and command builders |
| Import settings JSON | `index.html`, `app.js` `loadSettingsJson` | Replay helper | wired | Load previous run settings into Create after validating built-in targets | Create advanced section | Create import section | yes | fully usable | JSON parse, controlled target allowlist |
| Preview/result panel | `app.js` `trackJob`, `pollJob`, `loadRunIntoPreview` | Feedback/results | wired | Show active progress, output image, failure/retry, and run metadata | Create preview panel | Central preview panel | yes | fully usable | `/api/jobs/:jobId`, `/api/jobs/:jobId/log`, `/api/runs/:runId` |
| Retry failed job | `app.js` `pollJob` | Recovery helper | wired | Retry last controlled generation params after failure | Latest job card only after failure | Preview status area | yes | fully usable | `state.lastParams` |
| Send to img2img | `app.js` `sendToImg2img`, library actions; Create button currently calls unsupported explainer | Cross-workflow handoff | partially wired | Reuse an image run in img2img | Library detail/context; Create button still explanatory | Library detail and future Create image handoff | partial | partially usable | selected run and image, img2img gate |
| Send to upscale | `app.js` `sendToUpscale`, library actions; Create button currently calls unsupported explainer | Cross-workflow handoff | partially wired | Reuse an image run in upscale | Library detail/context; Create button still explanatory | Library detail and Enhance screen | partial | partially usable | selected run and image, upscale selectors |

## Edit and Enhancement Features

| Name | File/path | Type/category | Status | Intended behavior | UI exposure | Improved UI/UX placement | Safe to expose now | Final disposition | Backend/API/state dependency |
|---|---|---|---|---|---|---|---|---|---|
| img2img | `index.html` Edit, `app.js` `submitImg2img`, `server.js` `/api/actions/img2img`, `sdcpp-img2img.sh` | Image editing | wired | Regenerate from source image with denoising strength and core generation params | Edit screen | Edit screen with live gate card | yes | fully usable | source run/image, prompt, strength, backend support |
| Inpaint | `index.html` Edit, `app.js` mask canvas, `server.js` `/api/actions/inpaint`, `/api/validate/inpaint`, `sdcpp-inpaint.sh` | Image editing | wired | Paint mask and generate masked edit | Edit screen | Edit screen with mask tools and gate card | yes | fully usable | source run/image, mask data URL, Python mask validation |
| Outpaint | `/api/capabilities` `featureGates.outpaint` | Planned edit feature | unwired | Extend canvas and inpaint new regions | Edit gate card only | Edit gate card as blocked/planned | no | unavailable | canvas-extend preprocessing absent |
| Pillow upscale | `server.js` `/api/actions/upscale`, `sdcpp-upscale.sh`, Enhance UI | Enhancement | wired | Local 2x/3x/4x resize with Lanczos/Bicubic/Bilinear/Nearest | Enhance screen | Enhance screen | yes | fully usable | source run/image, Pillow dependency in script |
| Real-ESRGAN upscale | `server.js` `/api/actions/upscale-esrgan`, `sdcpp-esrgan-upscale.sh` | AI upscale | wired with BigMac dependency | 4x RealESRGAN_x4plus per repeat on BigMac | Enhance screen | Enhance screen with dependency note | yes with caveat | fully usable when BigMac server is reachable | source image, BigMac M4 Metal server |
| Hires Fix | `server.js` `/api/actions/hires-fix`, `/api/validate/hires-fix`, `sdcpp-hires-fix.sh` | Enhancement | wired partial | Two-pass txt2img draft then Pillow upscale | Enhance screen and Create disabled checkbox note | Enhance screen; Create note remains honest | yes | partial, not A1111 latent Hires Fix | prompt, preset, seed, upscale filter |
| Face Restore | `/api/capabilities` `featureGates.faceRestore` | Enhancement | unwired | GFPGAN/CodeFormer face restoration | Enhance gate card | Enhance "Other features" and System ledger | no | unavailable | GFPGAN or CodeFormer absent, script missing |
| PNG Info | `/api/runs/:runId/metadata`, `readPngTextChunks` | Metadata | partially wired | Read run-image PNG text chunks and manifests | Enhance gate card; Library detail metadata | Library detail/System ledger | yes with caveat | partial | only run images; arbitrary PNG upload absent |

## Library, History, and Metadata

| Name | File/path | Type/category | Status | Intended behavior | UI exposure | Improved UI/UX placement | Safe to expose now | Final disposition | Backend/API/state dependency |
|---|---|---|---|---|---|---|---|---|---|
| Run gallery | `server.js` `/api/run-index`, `/api/runs`, `app.js` `loadGallery` | Library/history | wired | Browse run cards with filters and pagination | Library screen | Library screen | yes | fully usable | `sdcpp-workflow/runs` |
| Run detail overlay | `server.js` `/api/runs/:runId`, `/api/runs/:runId/files`, `/api/runs/:runId/metadata`, `app.js` `showRunDetail` | Library/history | wired | Inspect run images, metadata, manifest, replay object, privacy state | Library overlay | Library overlay | yes | fully usable | run files/manifests |
| Controlled run comparison | `app.js` `showRunComparison`, `compareLatestSweep` | Comparison | wired display-only | Compare 2-4 controlled runs or latest sweep without regeneration | Library overlay | Library compare bar | yes | fully usable, display-only | run metadata and images |
| Reuse in Create | `app.js` `replayInCreate`, `reuseRun`, `loadSettingsJson` | Replay | wired with privacy caveat | Copy run params back into Create if present/not redacted | Library detail | Library detail and Create import | yes | fully usable when params exist | metadata/replay object |
| Copy settings JSON | `app.js` detail actions | Replay/export | wired | Copy generation settings for later import | Library detail | Library detail | yes | fully usable | Clipboard API |
| Image viewer/context menu | `app.js` `openImageViewer`, context menu handlers, `/api/run-file` | Asset viewing | wired | Zoom, download, copy URL/path, send to inpaint/upscale | Preview and Library images | Preview/Library | yes | fully usable | run-file path validation |
| Run file serving | `server.js` `/api/run-file` | File API | wired | Serve files under runs directory safely | Internal API used by UI | Internal API | yes | internal/user-visible through UI | path containment checks |

## Models, Assets, and Capability Gates

| Name | File/path | Type/category | Status | Intended behavior | UI exposure | Improved UI/UX placement | Safe to expose now | Final disposition | Backend/API/state dependency |
|---|---|---|---|---|---|---|---|---|---|
| Model target registry | `server.js` `CONTROLLED_TARGETS`, `buildDiscoveredTargets` | Model selection | wired | Provide built-in and auto-discovered generation targets with caveats/defaults | Create model select, Models screen | Create model select plus System ledger | yes | fully usable/experimental per target | asset cache, staged paths |
| SD1.5 target | `CONTROLLED_TARGETS sd15` | Model target | wired | Standard Stable Diffusion 1.5 controlled generation | Create | Create | yes | fully usable | configured/staged model |
| SDXL base target | `CONTROLLED_TARGETS sdxl-base` | Model target | proofed | Controlled SDXL base generation with limited default bounds | Create | Create | yes | proofed | SDXL smoke proof |
| SDXL Turbo target | `CONTROLLED_TARGETS sdxl-turbo` | Model target | proofed | Fast controlled SDXL Turbo generation | Create | Create | yes | proofed | SDXL Turbo smoke proof |
| Flux fp8 target | `CONTROLLED_TARGETS flux-fp8` | Model target | proofed | Controlled Flux generation through runtime-proven fp8 file | Create | Create | yes | proofed | Flux smoke proof |
| Migrated photoreal SDXL targets | `CONTROLLED_TARGETS sdxl-photonic`, `sdxl-homochi`, `sdxl-pony`, `sdxl-juggernaut`, `sdxl-realvisxl`, `sdxl-cyberrealistic`, `sdxl-epicrealism`, `sdxl-biglust`, `sdxl-lustify`, `sdxl-biglove` | Model targets | staged | Select migrated checkpoints with honest non-parity caveats | Create | Create and Models | yes with caveat | staged/selectable | staged files; not all individually smoke-proofed |
| HomoFidelis SD1.5 target | `CONTROLLED_TARGETS sd15-homofidelis` | Model target | staged | Select migrated SD1.5 checkpoint | Create | Create and Models | yes with caveat | staged/selectable | staged file |
| Auto-discovered checkpoints | `buildDiscoveredTargets`, `/api/capabilities` | Model targets | experimental | Generate with previously unknown `.safetensors` under model root | Create | Create with caveat | yes with caveat | experimental | asset cache and controlled target validation |
| Asset discovery | `server.js` `/api/actions/discover-assets`, `/api/assets`, `sdcpp-discover-assets.sh` | Asset management | wired | Refresh checkpoints, VAE, LoRA, embedding, hypernetwork cache | Models and System | Models/System | yes | fully usable | remote model root and cache write |
| Model inventory | `server.js` `/api/model-inventory`, `/api/actions/inventory-models`, `sdcpp-model-inventory-wc2tb.sh` | Asset management | wired | Scan wc2tb model candidates and report staging plan | Models | Models/System ledger | yes | fully usable | external volume, inventory cache |
| Model staging check | `server.js` `/api/model-stage`, `/api/actions/check-model-stage`, `sdcpp-model-stage-check.sh` | Readiness check | wired | Check BigMac staging root, volume state, proof caches | Models | Models/System ledger | yes | fully usable | `ssh westcat`, wc2tb volume |
| SDXL / Turbo / Flux smoke actions | `/api/actions/sdxl-smoke`, `/api/actions/sdxl-turbo-smoke`, `/api/actions/flux-smoke` | Proof actions | wired | Run bounded smoke proof for staged models | Models | Models | yes | fully usable | BigMac server, model files |
| LoRA insertion | `validatePromptLoras`, `lora-select`, `btn-insert-lora` | Extra network | wired with allowlist | Insert `<lora:name:weight>` token from discovered assets | Create model/network section | Create | yes | fully usable when assets exist | asset cache allowlist |
| Textual inversion | `/api/capabilities` `textualInversion` | Extra network | unwired | Use embeddings | System/Models via gates | System ledger | no | unavailable | discovery/injection bridge missing |
| Hypernetworks | `/api/capabilities` `hypernetworks` | Extra network | unwired | Use hypernetworks | System/Models via gates | System ledger | no | unavailable | support absent |
| VAE switching | `validateVae`, `resolveVaePath`, VAE selects | Generation parameter | wired | Select Auto/None/discovered VAE | Create/Edit controls | Create/Edit | yes | fully usable | asset cache, script flag support |
| Scheduler selection | allowed schedulers and scheduler selects | Generation parameter | wired | Choose discrete/karras/exponential/ays/sgm_uniform/simple | Create/Edit controls | Create/Edit | yes | fully usable | backend support |
| Sampler selection | allowed samplers and sampler selects | Generation parameter | wired | Choose supported sampler | Create/Edit controls | Create/Edit | yes | fully usable | validation allowlist |
| CLIP skip | `clip_skip` input, capability docs | Generation parameter | visible but unwired | Future A1111 compatibility | Create backend routing | Advanced Create, clearly not supported | no | planned/unavailable | script/backend support missing |
| Variation seed | `variation_seed`, `variation_strength` readonly fields | Generation parameter | visible but unwired | Future A1111 compatibility | Create Seed & variation | Keep disabled with gate note | no | planned/unavailable | backend support missing |
| Face restore checkbox | `restore_faces` disabled | Generation parameter | visible but unwired | Future face restoration toggle | Create Hires/faces/tiling | Keep disabled with Enhance explanation | no | unavailable | GFPGAN/CodeFormer absent |
| Tiling | `tiling` input, `getCoreParams` | Generation option | wired | Generate tileable output when backend supports flag | Create advanced | Create advanced | yes | fully usable | controlled generation body/script |

## System, Diagnostics, and Maintenance

| Name | File/path | Type/category | Status | Intended behavior | UI exposure | Improved UI/UX placement | Safe to expose now | Final disposition | Backend/API/state dependency |
|---|---|---|---|---|---|---|---|---|---|
| Verify backend | `/api/actions/verify`, `sdcpp-verify.sh` | Diagnostic | wired | Verify remote/backend readiness | System | System | yes | fully usable | BigMac tunnel/server |
| Server status | `/api/actions/server-status`, `/api/server-status`, `sdcpp-server-status.sh` | Diagnostic | wired | Show remote server status | System | System | yes | fully usable | workflow state |
| Start server | `/api/actions/server-start`, `sdcpp-server-start.sh` | Server lifecycle | wired, stateful | Start remote/local server | System | System with action grouping | yes with caution | fully usable | remote host and port |
| Stop server | `/api/actions/server-stop`, `sdcpp-server-stop.sh` | Server lifecycle | wired, stateful | Stop server | System | System with action grouping | yes with caution | fully usable | remote host and port |
| Seed test | `/api/actions/seed-test`, `sdcpp-seed-test.sh` | Diagnostic | wired | Verify seed behavior | System | System | yes | fully usable | backend |
| Probe image edit | `/api/actions/probe-image-edit`, `sdcpp-image-edit-capabilities.sh` | Diagnostic | wired | Detect img2img/inpaint capability | System | System | yes | fully usable | remote CLI |
| Probe upscale | `/api/actions/probe-upscale`, `sdcpp-upscale-capabilities.sh` | Diagnostic | wired | Detect upscale/face restore capability | System | System | yes | fully usable | remote tools |
| Clean old runs | `/api/actions/clean-old-runs`, `sdcpp-clean-old-runs.sh` | Maintenance command | hidden from UI | Clean old run artifacts | Not exposed | Keep documented; exclude from primary UI unless confirmation is added | no | hidden/destructive | needs age/confirmation guard |
| Open latest | `sdcpp-open-latest.sh` | Convenience command | hidden from UI | Open newest output locally | Not exposed | Exclude; OS/browser-specific helper | limited | internal/convenience | local filesystem |
| Export latest markdown | `sdcpp-export-latest-markdown.sh` | Reporting command | hidden from UI | Export latest run as Markdown | Not exposed | System ledger as internal command | yes | internal/advanced | run records |
| Benchmark scripts | `sdcpp-benchmark.sh`, `sdcpp-benchmark-server-warm.sh`, `sdcpp-summarize-benchmarks.sh` | Benchmarking | hidden/internal | Measure backend performance | Not exposed | Documented internal; no UI control | no | internal/developer | runtime cost and external host |
| Package source | `scripts/package-source.sh` | Release tooling | hidden/internal | Create clean source archive | Not exposed | Internal documentation only | yes | internal/release | clean git tree unless `--allow-dirty` |
| Install macOS app | `scripts/install-macos-app.sh`, `native/macos/Image_Gen/ImageGenApp.swift` | macOS wrapper | wired outside web UI | Install/reinstall `/Applications/Image_Gen.app` launcher | Not in web UI | Internal/native install docs; not web UI | yes | external wrapper | app bundle, codesign, Node path |
| Section visibility toggles | `SECTION_TOGGLES`, `renderSectionToggles` | UI customization | wired | Hide/show advanced Create sections | System screen | System, made clearer by redesigned CSS | yes | fully usable | `localStorage.hiddenCreateSections` |
| Job log | `job-log`, `/api/jobs/:jobId/log` | Diagnostic feedback | wired | Show stdout/stderr for actions | System and status updates | System | yes | fully usable | job in-memory state |
| Capability gates | `/api/capabilities`, `renderSystemGates` | Truth surface | wired | Report supported/partial/gated feature status | System | System live capability ledger | yes | fully usable | capabilities payload |

## Routes and Endpoints

| Endpoint | Status | UI exposure | Notes |
|---|---|---|---|
| `GET /api/capabilities` | wired | used at startup/System | Canonical UI truth source for gates, targets, models, presets |
| `POST /api/actions/verify` | wired | System | Runs backend verification |
| `POST /api/actions/server-status` / `GET /api/server-status` | wired | System | Server status |
| `POST /api/actions/server-start` | wired | System | Starts backend |
| `POST /api/actions/server-stop` | wired | System | Stops backend |
| `GET /api/generation-schema` | wired | System ledger | Schema endpoint, not currently visualized as a schema viewer |
| `GET /api/model-compatibility` | wired | System ledger | Compatibility registry endpoint |
| `GET /api/wildcards` | wired | Create toolbar | Lists wildcard token files |
| `GET /api/ollama/status` | wired | Create/Ollama chat | Lists Ollama models and endpoint state |
| `POST /api/ollama/enhance` | wired | Create toolbar | Prompt rewrite |
| `POST /api/ollama/chat` | wired | Create advanced | Local chat |
| `POST /api/preview/generation` | wired | Create/Edit | Dry-run command preview |
| `POST /api/actions/generate-single` | wired | legacy/internal | Older non-controlled generation endpoint |
| `POST /api/actions/generate-batch` | wired | Batch | Batch generation |
| `POST /api/actions/generate-controlled` | wired | Create, sweep, retry | Primary generation endpoint |
| `POST /api/actions/unsupported` | wired | Explainers | Returns honest unsupported feature text |
| `POST /api/actions/seed-test` | wired | System | Seed diagnostic |
| `POST /api/actions/clean-old-runs` | hidden | not exposed | Destructive maintenance; should require confirmation before UI exposure |
| `POST /api/actions/discover-assets` / `GET /api/assets` | wired | Models/System | Refresh/read asset cache |
| `GET /api/model-stage` / `POST /api/actions/check-model-stage` | wired | Models | Staging readiness |
| `POST /api/actions/sdxl-smoke`, `sdxl-turbo-smoke`, `flux-smoke` | wired | Models | Proof actions |
| `GET /api/model-inventory` / `POST /api/actions/inventory-models` | wired | Models | wc2tb inventory |
| `POST /api/actions/probe-image-edit`, `probe-upscale` | wired | System | Capability probes |
| `POST /api/actions/upscale` | wired | Enhance | Pillow upscale |
| `POST /api/actions/hires-fix` / `POST /api/validate/hires-fix` | wired | Enhance | Partial A1111 Hires Fix equivalent |
| `POST /api/validate/inpaint` | wired | Edit internal | Mask validation |
| `POST /api/actions/img2img` | wired | Edit | Image-to-image |
| `POST /api/actions/inpaint` | wired | Edit | Inpainting |
| `POST /api/actions/upscale-esrgan` | wired | Enhance | Real-ESRGAN upscale |
| `POST /api/actions/xyz-plot` | wired | Batch X/Y/Z | Partial sweep/grid |
| `GET /api/jobs/:jobId`, `/log` | wired | status/log | In-memory job state |
| `GET /api/version` | wired | wrapper proof/manual | Strong local checkout proof |
| `GET /api/runs`, `/api/runs/:runId`, `/files`, `/metadata` | wired | Library/Edit/Enhance | Run browsing/reuse |
| `GET /api/run-index` | wired | Library | Paginated/indexed gallery source |
| `GET /api/run-file` | wired | Preview/Library | Safe run-file serving |

## UI Components and State Fields

| Component/state | File/path | Status | UI exposure | Notes |
|---|---|---|---|---|
| Sidebar navigation | `index.html`, `showScreen` | wired | all screens | Workflows, Assets, System |
| Status pills | `setPill` | wired | topbar | Backend, Server, Job, Latest |
| Create form state | `getCoreParams` | wired | Create | Includes prompt, negative prompt, preset, target, model, VAE, sampler, scheduler, size, seed, mode, API, CLIP skip, tiling, prompt privacy, quantity |
| Edit generation state | `getEditGenerationParams` | wired | img2img/inpaint | steps, CFG, sampler, scheduler, size, seed, VAE |
| Global client state | `state` object in `app.js` | wired | internal | capabilities, runs, lastJob, lastParams, lastSeed, activeImage, poller, modelInventory, controlled target maps, library filters, comparison rows, hidden sections |
| Inpaint canvas state | `inpaintState` | wired | Edit | context, painting, brush mode, brush size |
| Library compare state | `libraryCompareIds`, `lastComparisonRows` | wired | Library | 2-4 selected controlled runs |
| Hidden sections state | `hiddenSections`, `HIDDEN_SECTIONS_KEY` | wired | System | Advanced section visibility |
| Prompt draft state | `PROMPT_DRAFT_KEY` | wired | Create | Local-only prompt reload |
| Ollama model state | `OLLAMA_MODEL_KEY` | wired | Create/Ollama chat | Local selected model |

## Exclusions From UI Exposure

| Item | Reason |
|---|---|
| `sdcpp-clean-old-runs.sh` | Destructive maintenance action; keep out of primary UI until age preview and confirmation are implemented. |
| Benchmark scripts | Expensive/noisy developer instrumentation, not normal user workflow. |
| `sdcpp-lib.sh` | Shared shell library, internal only. |
| `scripts/package-source.sh` and `scripts/install-macos-app.sh` | Release/install tooling outside the web workbench. |
| Raw generated run directories | User output data; should be browsed through Library APIs, not edited or deleted by UI redesign. |

## Alignment Decision

The final UI must preserve the current serious-workbench surface, not replace it with a fake landing page. The highest-risk gaps are discoverability and honesty: advanced capabilities exist but are scattered, blocked features are mixed with working features, and System needs a clearer live ledger. The implementation therefore keeps all existing working controls, tightens the visual system, and adds an explicit capability matrix instead of inventing new backend promises.
