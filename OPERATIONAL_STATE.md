# Operational State: Image_Gen / DexDiffusion

Current resumption index, captured 2026-10-05. Final closeout mission validated all Workstation V12, 3D Asset, WorldGen, and Image Generation systems.

## Human-acceptance preparation — 2026-10-05

**HUMAN ACCEPTANCE STATUS: READY FOR HUMAN ACCEPTANCE.** This is an engineering readiness state, not human acceptance. Andrew has not yet performed the subjective acceptance run. The preparation started from published baseline `b493643ec937325c2d183bd72f3d53496a664eae`; the acceptance build is the current published `main` reported by `/api/version` and Settings/System.

- Fresh real generation passed through the primary Big Mac MFLUX path using `mlx-community/flux2-klein-4b-4bit`: 512×512, 4 steps, seed 51005. Run `20261005-214701-controlled-flux2-klein-4b` completed PASS with in-band remote exit and cleanup markers. Canonical asset `20261005-214701-controlled-flux2-klein-4b-s51005-controlled-flux2-klein-4b.png` is 244,827 bytes with SHA-256 `ba85e2cb11ad1d18b57cae69baa3297d30096580063dcca9246944850e888bb8` at `/Users/andrew/images_made/20261005-214701-controlled-flux2-klein-4b-s51005-controlled-flux2-klein-4b.png`.
- The fresh asset is indexed in Media with coherent model, dimensions, seed, operation, run, and privacy metadata. The installed native app directly opened its preview and completed the Generate → Media → Edit handoff without another render; Edit retained the canonical source and truthfully selected its supported edit model.
- DexDiffusion's Ollama dependency is healthy at its project endpoint `http://127.0.0.1:11436`. The prior 502 was a stale DexDiffusion-owned SSH tunnel forward using local port 11434. Only `com.bigmac.ollama-tunnel` was repaired to forward local 11436 to Big Mac loopback 11434; Big Mac's general Ollama/Hermes service was not changed. `/api/ollama/status` returns the installed `qwen3.8:27b-mlx` model.
- Canonical storage has 9 valid assets and zero current missing, broken, digest-mismatch, pending, or unknown problems. All 502 preserved missing references form a fully dated cohort ending `20261003012305`, strictly before the retained valid cohort beginning `20261003153007`; diagnostics now label them historical missing references without deleting or rewriting any record or canonical asset. Any overlap, undated record, or unavailable separation remains a current problem by default.
- The normal human path was exercised through `/Applications/DexDiffusion.app` (bundle `local.image-gen.wrapper`) and the Dock, including open, module navigation, fresh-asset preview, Send to Edit, and close/reopen handling. The final installed-wrapper stamp, current-HEAD `/api/version` match, and single-listener state are rechecked after publication.
- Andrew's direct checklist is [DexDiffusion Human Acceptance](docs/acceptance/DEXDIFFUSION_HUMAN_ACCEPTANCE.md). No Terminal or model render is required for the acceptance session.

## Current identity

- Repository `/Users/andrew/Image_Gen`, `main`. Origin matches canonical local `main`.
- Live console PID on 127.0.0.1:31337: `/api/version` reports cwd `/Users/andrew/Image_Gen/operator-console`.
- Installed `/Applications/DexDiffusion.app`, bundle `local.image-gen.wrapper`, root `/Users/andrew/Image_Gen`. Native WebKit app and Dock icon verified.
- Full unit & static check: 332 tests pass (0 failures). MFLUX primary generation live verified. Blender glTF import live verified. Big Mac project-owned residue cleaned and idle state confirmed.

## Architecture and invariants

[AGENTS.md](AGENTS.md) owns narrow onboarding and applicable gates; [DEXDIFFUSION.md](DEXDIFFUSION.md) owns operations. MacBook UI/control/storage plus `ssh westcat` Big Mac compute. Preserve protected Klein 4B primary, secondary SDCPP targets, canonical `/Users/andrew/images_made`, ephemeral remote outputs, privacy policy and truthful progress. Console stays loopback; Serve 8443 is tailnet-only; separate DEX//REACH 443 remains untouched.

## Latest reported product closeout and open gaps

[Rev19 report](output/rev19/FINAL_REPORT.md) reports 295/295 unit, 37/37 focused, Edit 24/24, Voice 8/8, chain 24+8, matrix 180/180 and one validated live Klein 4B publication. [Command receipts](output/rev19/final-gates.json) and [runtime receipt](output/rev19/final-runtime-closeout.json) are historical direct evidence, not newly rerun checks. Earlier [Rev18 report](output/rev18/FINAL_REPORT.md) remains retained.

- Physically wedged Apple Neural Engine behavior remains unverified; installed-LoRA render unavailable in the reported environment.
- Rev19 storage inventory reports 502 historical missing identities, cause unknown; four historical remote exposure logs remain preserved.
- Legacy image progress/list migration and broader temporary-resource ownership are partial. Power-loss durability, automatic crash-journal recovery, production bootstrap latency under host pressure and general human acceptance remain uncertified.
- FLUX.1 Schnell FP8 remains failed/unresolved in revision 15's exact-model proof. Do not promote it from family history or a solid-white frame.
- Next work must bind a specific gap, its owner and acceptance witness. No broad repair or historical-data deletion is authorized by this index.

## History and preservation

The complete original 541-line state is byte-identical in [immutable history](docs/history/OPERATIONAL_STATE-through-rev19-20261004.md). SHA-256 `435eff15248666f0b57db7cc9a44a61d54186295dd28e17fd5a9fd3fd5b7017d`. [Preservation mapping](docs/history/PRESERVATION.md) describes section/identifier coverage and the original root for historical relative references. Nothing was removed from history; contradictions, superseded claims and failed runs remain historical rather than silently becoming current facts.


## Storage migration — 2026-10-04

- Big Mac model storage migration completed for exactly three SDCPP checkpoints:
  - SD1.5: `/Volumes/wc2tb/ImageGen/checkpoints/sd15/v1-5-pruned-emaonly.safetensors` (4,265,146,304 bytes)
  - SDXL Base: `/Volumes/wc2tb/ImageGen/checkpoints/sdxl/sd_xl_base_1.0.safetensors` (6,938,078,334 bytes)
  - SDXL Turbo: `/Volumes/wc2tb/ImageGen/checkpoints/sdxl-turbo/sd_xl_turbo_1.0_fp16.safetensors` (6,938,081,905 bytes)
- The old `/Users/bigmac/sdcpp-staging/models/` names are now symlinks only; the model bytes live on `wc2tb`. Photonic Fusion and FLUX.1 Schnell were not moved.
- Migration integrity: source/destination exact byte sizes matched. Start/middle/end 4 MiB SHA-256 samples matched for all three model pairs. Full-file hashing of the external SSD exceeded the DEX 60-second command window and is not claimed.
- Big Mac internal Data volume immediately free changed from 7,330,316 KiB (~6.99 GiB) before migration to 25,049,660 KiB (~23.89 GiB) after migration, a measured gain of 17,719,344 KiB (~16.90 GiB). The ~20 GiB target is satisfied.
- Active runtime/config path references were migrated to the canonical external locations. Historical reports/receipts were intentionally left unchanged.
- Focused validation: `node --test operator-console/tests/capabilities.test.js operator-console/tests/system-info.test.js` passed 15/15; `git diff --check` passed; active runtime/config stale-path scan returned no references to the three old internal model files.
- Direct Big Mac verification after deletion: all three legacy symlinks resolve and `test -s` passes for every target. A separate `bin/dexdiffusion status` launch was blocked by the platform execution gate before execution, so no status-command result is claimed.

## Individual 3D asset capability — 2026-10-04

- The actual Big Mac proof target is Hunyuan3D-Swift commit `292331f4d26ddb80b9dcea6bcb5629ff82f12b82`, built with the installed Metal toolchain. Shape-small and RGB paint-small are installed under `/Volumes/wc2tb/generative-models/3d/hunyuan3d-swift/`; the capability receipt is [3d-capability-evidence.json](sdcpp-workflow/state/3d-capability-evidence.json).
- Mesh GLB passed a direct Big Mac run and local validation: 6,324,096 bytes, SHA-256 `620cd66d2b7849e92ec924f6d5d957e5bf2e991c6ebabd1850a9755bd05570bc`, 175,654 position vertices, finite non-degenerate bounds, and Blender 5.2.2 import. Shape-large also passed characterization at 7,128,528 bytes with 197,982 position vertices.
- Textured GLB passed a direct Big Mac run and local validation: 14,202,932 bytes, SHA-256 `91c739c94dfbafd3d17031e5d7d8605cfbaa0f61a6ca6f72ff4c9edcfafb15ea`, 235,283 position vertices, one embedded PNG texture, and Blender 5.2.2 import. Peak footprint was approximately 25.1 GB; swap increased during this run, so PBR remains disabled.
- The implementation uses the generic job store, shared heavy-compute lease, staging, canonical media store, checksum-verified SSH byte streaming, and exact remote cleanup. `scp` is not used for large result retrieval because an observed large transfer was incomplete despite a zero exit status.
- The new top-level `3D` tab owns individual image-to-asset jobs. `World` remains the environment/360 workspace; existing SHARP Quick3D remains available as the PLY comparison path. Integrated API/runtime acceptance is recorded only after the live console is restarted and `/api/3d/jobs` completes.


## Workstation V12 Live Operations

- Executed coordinated campaign for DexDiffusion Workstation V12.
- **F01 (Event-driven Job Bus)**: Same-origin SSE control plane at `/api/events` with native Server-Sent Events, monotonic IDs, bounded replay ring, client disconnection cleanup, snapshot transmission, and privacy-safe allowlisted payloads.
- **F02 (Global Job Center)**: Persistent cross-screen drawer with Active, Queue, and Recent jobs, elapsed timing, status badges, progress updates, and inline cancellation actions.
- **F03 (Durable Image Jobs)**: Unified image and media job models across the durable job store (`jobs.json`) with safe restart reconciliation to INTERRUPTED.
- **F04 (Library Turbo)**: Rebuildable incremental metadata index (`library-index.js`), server-side query/filter/sort, pagination, derived thumbnail generation service via `sips`/`convert` with path traversal protections (`/api/thumbnails/:id`).
- **F05 (Collections / Boards)**: Persistent collections store (`collections.json`) supporting creation, tagging, reordering, and multi-select addition/removal of canonical artifact IDs without byte duplication.
- **F06 (Queue ETA & Resource HUD)**: Real-time global HUD displaying Big Mac lease arbitration status (`BIG MAC · FREE` / owner) and robust median completion duration ETA estimation based on minimum 3 completed samples.
- **F07 (Adaptive Control Surface)**: Capability-driven controls dynamically showing Basic vs Advanced options and auto-hiding SD-specific settings (negative prompt, CFG, VAE) when MFLUX targets are selected.
- **F08 (Command Palette & Global Keyboard)**: `Cmd/Ctrl + K` global command palette, `Cmd/Ctrl + Shift + J` Job Center drawer toggle, `Cmd/Ctrl + Enter` primary generation trigger, and Escape stack management.
- **F09 (Lineage Settings Diff)**: Ancestry settings delta comparison endpoint (`/api/lineage/:id/diff`) highlighting changed operation/dimensions/seed/guidance while strictly enforcing privacy contracts (`PRIVATE / NOT SAVED` for unsaved prompts).
- **F10 (Synchronized Image Comparison)**: Synchronized 2-image comparison modes (Side by Side, Linked Pan/Zoom, A/B flicker, Swipe divider) and 2–4 image synchronized grid comparison.
- **F11 (Workflow Macros)**: Declarative, versioned macro schema `dexdiffusion.macro.v1` (`macros.json`) supporting safe execution chains, pause on `WAITING_INPUT`, and strict disallowance of arbitrary shell strings or execution commands.
- **F12 (Reproducibility Bundles)**: Versioned JSON schema `dexdiffusion.repro.v1` (`/api/repro/export`, `/api/repro/validate`) with runtime capability compatibility checks; configuration restoration without auto-execution.
- **F13 (Unified Recipes)**: Versioned schema `dexdiffusion.recipe.v1` (`recipes.json`) with atomic persistence, CRUD, default settings-only privacy protection, and migration path from browser-local styles.
- **F14 (Scoped Cancellation)**: Immediate queued job cancellation, local PID-verified graceful termination (`SIGTERM` -> `SIGKILL`), and remote job-scoped identity marker verification failing closed against killing unrelated processes.
- **F15 (Decomposition)**: Modularized backend services (`event-bus.js`, `operational-jobs.js`, `timing-store.js`, `library-index.js`, `collections-store.js`, `recipes-store.js`, `macro-store.js`, `repro-bundle.js`, `thumbnail-service.js`, `cancellation.js`) and unified frontend live engine (`public/dexdiffusion-v12.js`).
- Test suite expanded from 109 to 128 tests (100% pass, zero regressions, full privacy canary verification).


## Approved UX direction — Concept A — 2026-10-05

- User approved **Concept A — Single-Canvas Workstation** as the governing UI/UX direction for the next DexDiffusion uplift.
- This is a **planned design/implementation direction, not implemented or runtime-verified behavior**. Existing verified V12, generation, 3D, World, storage, privacy, and operational behavior remains the protected baseline until each migration slice is implemented and revalidated.
- Governing planning artifacts:
  - [Concept A PRD](docs/concept-a/DEXDIFFUSION_CONCEPT_A_PRD.md)
  - [Concept A UX specification](docs/concept-a/DEXDIFFUSION_CONCEPT_A_UX_SPEC.md)
  - [Concept A implementation checklist](docs/concept-a/DEXDIFFUSION_CONCEPT_A_IMPLEMENTATION_CHECKLIST.md)
  - [Concept A agent handoff](docs/concept-a/DEXDIFFUSION_CONCEPT_A_AGENT_HANDOFF.md)
- The approved UX principles are: one shared application shell; persistent global navigation; distinct but restrained color identity per module; contextual right inspector; global Queue/History; progressive disclosure; and one reusable contextual Help/Tutorial modal with Quick Start, What It Does, Steps, Tips, and FAQ.
- The first recommended implementation slice is **shared foundation + Workstation + Generate migration**, preserving current capability-driven controls and V12 job/event infrastructure. Music and Drama mockups are target UX structures only; no planned control becomes enabled without a real backend contract and validation.
- Future implementation must preserve unrelated dirty/untracked files and must not interpret this planning approval as authorization to delete history, alter model storage, replace backends, or weaken privacy/capability gates.

### Implementation state — 2026-10-05

- Concept A shared shell, Workstation, Generate, Edit, Media, Voice, Music, 3D, World, Drama, and Settings/Help surfaces are implemented in the current working tree through `operator-console/public/dexdiffusion/concept-a.js`, composing the existing capability-backed workspaces rather than replacing them.
- Final validation is complete: Edit 24/24, interaction matrix 180/180, Voice/Drama 8/8, Detailer 11/11, `npm run check` passed, and `npm test` passed 332/332 with zero failures and zero skips.
- Live route evidence on `127.0.0.1:31337/dexdiffusion/` confirms Concept A navigation, Generate, contextual Help with Escape close, command palette, and the V12 global Job Center. The active runtime is this checkout and was restarted through the project lifecycle owner for final revision identity verification.
- Concept A is publication-complete for this repository slice. The validated source and directly necessary browser-harness fixes are committed and pushed; the exact commit and local/remote parity are recorded in the closure receipt.

### Concept A refinement 1 / A.1 — 2026-10-05

- The shared shell now has coherent inline SVG module icons, per-module accent-driven primary actions, stronger selected mode tabs, and responsive narrow geometry while retaining the Dexter asset and DexDiffusion brand.
- The right inspector reads current Generate, Edit, Media, Voice, Music, 3D, World, Drama, Workstation, and Settings state. Media actions continue through the existing canonical asset and lineage handlers; no duplicate collection, job, or event store was added.
- Queue / History has a compact expandable dock backed only by `window.__DEX_V12.snapshot`; Active, Queue, and Recent counts, reported progress, cancellation eligibility, and truthful empty states are preserved. The full V12 Job Center remains the detailed surface.
- Help now provides numbered Quick Start cards, input/function/output/connected-module explanation, Steps, Tips, accessible FAQ disclosures, Escape/focus restoration, and a searchable local tutorial index with full-tutorial routing. No remote or fabricated help records are introduced.
- Generate gives the result staging region visual priority. Music and Drama planned controls remain disabled and visibly marked until executable contracts exist. Project creation remains deferred where the backend contract is absent.
- Focused Concept A.1 browser coverage passed 5/5. Required serial browser coverage passed Edit 24/24, Voice/Drama 8/8, and the interaction matrix 180/180. `npm run check`, `npm test` (332/332), `node --check` for changed JavaScript, and `git diff --check` passed.
- Live acceptance against the project-owned loopback listener passed at 1440×900, 1024×768, 768×1024, and 390×844: ten modules and SVG icons rendered, Help and Queue interacted, no page errors were observed, and document width stayed equal to the viewport. `/api/version` bound to this checkout and `/api/system-info` returned the existing capability ledger and canonical image root.
- No model, wrapper, backend, listener topology, privacy, storage, V12 ownership, or unrelated untracked image files were changed. Big Mac reachability remains an operational state reported by the existing status surface, not a new A.1 claim.

## Post-A.1 forensic bug-sweep closure — 2026-10-05

- Scope: current Concept A/A.1 shell and ten modules; V12 queue, Job Center, command palette, comparison and Server-Sent Events lifecycle; Generate/Edit/Media/Voice/Music/3D/World/Drama/Settings contracts; API, storage/privacy, launcher, responsive/accessibility and browser-harness infrastructure. This was a repair pass, not a redesign or Concept B implementation.
- Eight confirmed defects were fixed: the local launcher could report success before its shared process group was reaped; compact/full queue views disagreed with the normalized progress contract and could imply 0%; the Concept Help delegate survived teardown; Music's enabled Instrumental tab was inert; command-palette navigation targeted an obsolete shell API and omitted current modules; shared overlays lost focus restoration across live-state remounts; a legacy responsive rule hid the entire Concept A module rail at 390 px; and one browser assertion still targeted a legacy shell instead of Concept A.
- The launcher now uses a double-forked session helper, records only the verified listener owner, and survived a separate post-launch process check with parent PID 1. Queue surfaces consume measured `totalPercent` / `currentRunPercent` / legacy `percent` and show indeterminate state when no percentage exists. Shared dialogs now provide dialog semantics, focus entry/trapping/Escape/restoration, including restoration after a snapshot-triggered shell remount.
- Validation: `npm run check` passed; unit suite 333/333; Concept A focused browser suite 8/8; Edit 24/24; Voice/Drama 8/8; interaction matrix 180/180; Detailer 11/11; all 42 shell files passed `bash -n`; every changed JavaScript file passed `node --check`; the new Python helper compiled; and `git diff --check` passed.
- Fresh live QA passed on the project-owned loopback route at 1440×900, 1024×768, 768×1024 and 390×844. Each viewport directly opened all ten modules, exercised Help/search, palette, Queue and Job Center through four representative cycles, retained exactly one active EventSource, reported zero page errors and no horizontal overflow. The separate Ollama status request remained a truthful 502 and was not altered.
- Big Mac was reachable as `bigmac@bigmac`; `bin/dexdiffusion doctor` verified the mounted model volume, configured SDCPP targets, primary MFLUX runtime/model, idle heavy-compute lease, canonical media roots and tailnet-only Serve route. No expensive model render was run for these local shell/lifecycle repairs. Doctor retained the historical canonical-storage warning: 8 valid and 502 missing records; no repair or deletion was attempted.
- Final Git commit: the closure commit containing this record; its exact hash is recorded in Git and the completion receipt after commit. Publication state: authorized push to `origin/main`, with local main, remote-tracking main and `ls-remote` parity verified after publication. Unrelated untracked PNG files remain preserved and unstaged.
