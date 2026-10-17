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

## Audio Drama Studio uplift — 2026-10-08 (uncommitted working tree)

- Scope: local-only uplift inside the single Drama module — staged SCRIPT/CAST/DIRECT/PRODUCE/REVIEW/MASTER/EXPORT workflow, Voice Designer, fingerprinted takes, one-click `PRODUCE ENTIRE DRAMA`,
  Cast Bible + Actor FX rack, Sound Director cues, multitrack timeline, optional pacing, QA, streaming mix/master/export, Production Proof and Director's Revision reports, portable voice bank and project package.
  Full design record and receipts: `operator-console/docs/audio-drama-studio-progress.md`. Chatterbox Turbo evidence: `operator-console/docs/chatterbox-turbo-compat-20261008.md` (verdict EXPERIMENT; nothing installed).
- State: **implemented and tested, NOT committed, NOT pushed.** Verification at this point: `npm run check` OK; `npm test` 601 tests / 600 pass / 0 fail / 1 skipped; browser Edit 24/24, Voice/Drama 8/8, Drama Studio 9/9, Concept A 8/8, interaction matrix 180/180.
- Measured: a synthetic 60-minute programme mixes, concatenates, masters (loudness verified) and exports MP3 + chaptered M4B in 345 s with 174 MiB peak process-tree RSS.
- Not yet proven: any real Qwen/Kokoro inference or live production on Big Mac, whisper.cpp ASR (not installed → reports UNAVAILABLE), Silero VAD (not installed → energy detector), and human listening acceptance. Nothing in this section is a human-approval claim.
- Invariants kept: no cloud/external speech APIs, no model downloads or runtime changes, Big Mac output stays ephemeral, unsaved screenplay text never enters generic jobs/SSE/logs/media metadata/receipts. Project files migrate to `dexdiffusion.drama_project.v2` with a byte-identical `*.pre-v2.bak.json` on first rewrite; historical records and approved takes are never deleted.


## External-first model storage gate — 2026-10-09

- User approved making DexDiffusion model storage external-first, with evidence-based exceptions. **Protected: FLUX.2 Klein 4-bit model and pinned MFLUX venv on Big Mac internal SSD; MacBook retains canonical generated images/audio.** No models were relocated, overwritten, deleted or downloaded in this pass.
- Fresh Big Mac audit: internal APFS Data approximately 17 GiB available; `wc2tb` 254 GiB available but **file-content access is denied (Operation not permitted)**. The intended `ssh westcat` route (tailscaled), separate authorized Apple `sshd` on port 2222, and DEX//REACH process all fail to list external model contents. Ordinary owner/mode bits, symlink targets and a mounted volume are not evidence of model readability. macOS host consent remains BLOCKED; do not bypass privacy controls.
- Internal migration candidates verified by stat: FLUX.1 Schnell FP8 17,236,328,572 bytes (full hash UNVERIFIED after bounded hash timeout; live model proof historically unresolved), Photonic Fusion 6,938,043,264 bytes (full SHA-256 `3d781844e3cb1968e1ba96e87969e8699e8a1b08e35df04ab8880b25eb816b41`). Additional MFLUX hub/cache about 4.3 GiB is not proven redundant. Voice/music model weights are already configured under `wc2tb`; their Python runtimes remain internal by design. Previously migrated SD1.5/SDXL Base/Turbo are external symlinks.
- Truthfulness fix **applied in uncommitted MacBook working tree**: `capabilities.js` now probes `wc2tbReadable` through an actual SSH directory read, and fails affected external model/worker availability while leaving internal Klein and Photonic eligible; `media.js` labels external workers `MODEL INACCESSIBLE (wc2tb)`; `server.js` doctor reports a separate read-access FAIL. Two regression tests added. Backup verified at `/Users/andrew/Image_Gen_rescue/external-access-20261009.dZHCjz/`. Unit suite passed **615/615** (zero failures, zero skipped), focused 22/22, syntax checks and git diff whitespace check clean.
- Project-owned console restarted while idle, verified pid 22962, `/api/version` current checkout HEAD 169ad07; live doctor now FAILS honestly on unreadable external storage, with internal MFLUX PASS. No stage/commit/push; unrelated uncommitted Audio Drama Studio work and media preserved.
- Exact inventory, gate and safe staged cutover/rollback procedure: [External-first storage audit](docs/operations/DEXDIFFUSION_EXTERNAL_FIRST_20261009.md). **Next required proof:** authorized worker can open actual external model bytes; only then may models be copied, hashed, repointed and generated through the actual backend before any original can be considered for removal.

## Permission architecture decision — 2026-10-09

**User requirement:** Grant external-volume access to a dedicated DexDiffusion application identity on Big Mac, **not** broad Full Disk Access to `tailscaled`, general SSH servers, or DEX//REACH. Preserve Tailscale for network transport only. Prefer a macOS Files & Folders **Removable Volumes** grant before considering broader Full Disk Access.

Observed: Big Mac currently has no `/Applications/DexDiffusion.app` or `DexDiffusion Worker.app`; MacBook is the sole DexDiffusion GUI/control owner. Tailscale-SSH, native sshd (port 2222), and DEX//REACH read attempts on Big Mac all failed for `/Volumes/wc2tb` with `Operation not permitted`. Granting permissions to the existing MacBook app will not authorize Big Mac model processes.

**Revised authorized design target (NOT YET IMPLEMENTED):** Big Mac dedicated, stable-identity, user-owned `DexDiffusion Worker.app` launches/owns model-reading processes. The worker must request the normal macOS removable-volume permission through an honest app-level prompt, then prove it can read model bytes; no TCC database edits, privilege escalation, host-permission bypass, or raw arbitrary command service. Communicate with MacBook through an authenticated, narrowly allowlisted local IPC endpoint transported over existing tailnet/SSH, with no public listener or new cloud dependency. Before integration, prove child model processes retain effective authorized access. Protect the internal FLUX.2 Klein runtime, existing canonical MacBook media and old SSH workflow until all real image and voice gates pass. No custom worker was built, installed, authorized, or enabled by this entry. Owner interaction with macOS may still be required to grant privacy consent.

## Performance optimization pass — 2026-10-16 (uncommitted working tree)

**Scope:** end-to-end Generate latency for the primary MFLUX FLUX.2 Klein 4B 4-bit path. Same model, same internal-SSD runtime, no new frameworks, no model/precision/step changes. Not committed, not pushed.

**Conditions.** MacBook Air → Big Mac (M4, 32 GB) over `ssh westcat` / Tailscale (direct IPv6 path, 73–99 ms RTT, ~10 % ICMP loss observed during part of the session). Prompt "a red fox sitting in a snowy forest, golden hour, detailed fur", seed 12345, 4 steps, guidance 1, quantity 1. Runs were interleaved A/B (HEAD scripts vs working tree, via scratch copies with `DEX_IMAGES_ROOT_OVERRIDE`, so benchmark images are not in `/Users/andrew/images_made`), each gated on Big Mac having no other heavy job. Two baseline 1024 runs taken earlier while a user SDXL job was running (159 s, 194 s) are contaminated and excluded.

**Measured baseline (where the time goes, 512² / 1024², idle Big Mac, good network):**

| Stage | 512² | 1024² |
|---|---|---|
| Denoising incl. lazy weight use + text encode (GPU-bound, MFLUX CLI) | ~14.5–17 s (≈75–80 %) | ~50–54 s (≈90 %) |
| VAE decode + PNG save | ~0.8–1.3 s | ~6–7 s |
| Python imports + model load (in-process) | ~1.5 s (0.9 + 0.6) | ~1.5 s |
| Pre-generation ssh handshakes (3 calls: hostname, runtime, model) | 3.1–4.6 s (median ~3.7) | same |
| ssh setup of the generate call | ~1 s | ~1 s |
| PNG transfer (0.43 MB / 1.75 MB) | 0.5 s when network is healthy; 5–30 s when the Tailscale path is lossy | same |
| Local sha/strip/verify/canonicalize | ~0.4–0.5 s | ~0.5 s |

Peak MLX memory 4.83 GB (512²) / 12.37 GB (1024²); no Metal errors; swap in use on Big Mac ~4.9 GB before any of my runs.

**Candidates rejected on evidence.**
- *Persistent warm-model Big Mac worker* (built as a prototype: private unix socket, flock single-instance, idle exit, SHA-pinned source, one-shot fallback): the model load it removes is only ~0.6 s + ~0.9 s imports. A/B in-process (fresh process each, 512²) measured total 17.0–17.2 s with the text encoder evicted (CLI behaviour) and kept (worker behaviour); the warm worker's requests took 19.9–20.4 s end to end vs 19.0–21.3 s one-shot, i.e. **no measurable gain**, with +2.3 GB resident (peak 7.16 vs 4.83 GB at 512²) and a daemon to supervise. Not shipped; prototype source not retained in the repo.
- *Text-encoder eviction tuning, Metal/MLX flags, `mx.set_wired_limit`, dequantized weights*: no safe measured benefit, risk of Metal watchdog timeouts; not attempted.
- *Lossless PNG recompression to cut transfer bytes*: would alter bytes/SHA contract; not done.

**Implemented (3 files + 1 UI constant + tests):**
1. `sdcpp-workflow/bin/mflux-controlled-generate.sh`: the three preflight ssh calls (`verify_route`, two `remote_test`) are merged into one call with identical failure gates; the preflight and generate calls share one private OpenSSH ControlMaster connection (`~/.ssh/dexdiffusion-cm/%C`, dir 0700, `ControlPersist=120`, opt-out `DEX_SSH_MUX=0`; same host, keys and Tailscale SSH auth, no new listener); stage banners `=== Pre-flight verification ===`, `=== Generating … on BigMac …`, `=== Finalizing canonical image ===`; per-stage `timings` written to the manifest and `MFLUX_TIMING:` log line (numbers only, no prompt data).
2. `sdcpp-workflow/bin/mflux-remote-generate.sh`: `MFLUX_REMOTE_T: <stage> <epoch>` stderr stamps (script-start, generate-start/-end, stream-start/-end). Generation command, markers, cleanup and exit contract unchanged.
3. `sdcpp-workflow/bin/sdcpp-lib.sh`: `ssh_remote` honours an optional `SDCPP_SSH_EXTRA_OPTS` (empty by default; SDCPP scripts behave as before).
4. `operator-console/public/dexdiffusion/edit-core.js`: new `finalizing` job-stage label.
5. `operator-console/tests/mflux-bridge.test.js`: 7 new tests (single-ssh preflight per gate, private 0700 mux dir and opt-out, ordered stage stamps off the PNG stream, manifest timings, stage ladder).

**Before / after (median wall clock, script start → canonical image, interleaved A/B, same prompt/seed):**

| Backend / model | Res | Cold / first run (before → after) | Median warm (before → after) | Model load | Transfer + finalize | Peak mem | Improvement | Validation |
|---|---|---|---|---|---|---|---|---|
| MFLUX FLUX.2 Klein 4B 4-bit | 512² | 36.1 → 26.6 s (first of series; network-degraded window) | 23.13 → 19.29 s (n=7 pairs) | n/a (in-process ~1.5 s, unchanged) | 0.4 s local finalize; ssh transfer network-bound | 4.83 GB | −16.6 % | pixel hash identical `ca58eda05947f901` in all 22 benchmark runs + API run |
| MFLUX FLUX.2 Klein 4B 4-bit | 1024² | 61.0 → 55.3 s | 60.28 → 55.79 s (n=3 pairs) | n/a | 0.8 s ssh tail + 0.5 s local | 12.37 GB | −7.4 % | pixel hash identical `54a66402bab56ec0` in all 6 runs + API run |

The saving is the removed handshakes (microbenchmark, 6 reps: old 3 calls 3.1–4.6 s; merged 0.9–1.9 s; merged on a live control connection ~0.3 s). Remote generation time is unchanged (512² 17.1 s, 1024² 53–54 s in `timings.remote_generate_s`), as expected. In degraded-network windows the ssh data path dominated (13–32 s of ssh connect/teardown in both old and new scripts, 65–80 KB/s); those pairs are in the raw record but are noise for comparing code paths. A second mux benefit (not separately benchmarked): a second image within 120 s starts with ~0.6 s of handshake instead of ~4.5 s.

**Verification.** `npm test` 622/622 pass (615 before + 7 new), `npm run check`, `bash -n` on the three scripts, `node --check` on changed JS, `git diff --check` clean. Console restarted through `bin/dexdiffusion restart` (single listener 127.0.0.1:31337, pid 13179, cwd this checkout). Real generations through `POST /api/actions/generate-controlled` passed at 512² (35.5 s, network-degraded) and 1024² (58.7 s): canonical files `20261016-011820-…-s12345-….png` and `20261016-011936-…-s12345-….png` in `/Users/andrew/images_made`, pixel hashes equal to the benchmark hashes, `prompt-in-exif` false with `save_prompts=false`, `/api/images/<id>` HTTP 200, job stages Checking Big Mac and model → Generating on Big Mac → (Finalizing in canonical storage) → Complete. No `dexdiffusion-mflux.*` temp dir left on Big Mac; no new PNG in `~/sdcpp-staging/outputs` (one pre-existing Oct 15 11:18 file untouched). Mux masters expire after 120 s idle (0 remaining). Tailscale Serve, Funnel, DEX//REACH untouched.

**Limitations / honest notes.**
- Gains are latency-handshake gains (~4–5 s), not GPU gains: denoising is ~75–90 % of wall clock and cannot be cut without changing steps/precision/resolution, which this pass forbids.
- Network variance (loss on the Tailscale direct path) swamped some pairs; only paired medians are quoted. Transfer time is not improved.
- SD1.5 (SDCPP) baseline: one run through the HEAD script PASSED in 259 s, but that includes the managed secondary-slot activation (it left the secondary slot pointing at SD1.5 instead of Photonic; the slot re-activates on demand) and external-drive reads, so it is not a warm baseline. The matching run with the working tree failed at gate `model-slot` ("source checkpoint is missing, unsafe, or not a .safetensors file") — the wc2tb external volume is intermittently unreadable on Big Mac (see the 2026-10-09 entry); the SDCPP code path is unchanged by this pass and the failure was not reproduced as a code regression.
- Warm-worker idea was measured and rejected; do not revisit without a different bottleneck.

**Rollback.** Uncommitted: `git checkout -- sdcpp-workflow/bin/mflux-controlled-generate.sh sdcpp-workflow/bin/mflux-remote-generate.sh sdcpp-workflow/bin/sdcpp-lib.sh operator-console/public/dexdiffusion/edit-core.js` and drop the 7 `perf:` tests from `operator-console/tests/mflux-bridge.test.js`. Soft rollback without editing: `DEX_SSH_MUX=0` in the console's environment disables connection reuse. `rm -rf ~/.ssh/dexdiffusion-cm` removes the control socket directory.

**Best next optimization (only if justified later):** none is worth doing for the GPU stage at fixed quality; the next real lever is diagnosing the lossy Tailscale path (direct IPv6, 10 % ICMP loss, 65–80 KB/s ssh throughput in bad windows), which dominated the worst runs.

## A1111 parity session 2 — 2026-10-16/17 (uncommitted working tree)

- Entry HEAD `9de6f546` (= origin/main). **Nothing committed or pushed.** Untracked user PNGs and `output/*` evidence preserved.
- **Ledger:** P01 upstream enumeration done (612 items from the pinned A1111 source, 0 unmapped), ledger schema v2 with structured proof states; **266 rows — 75 COMPLETE (62 live-proven), 62 PARTIAL, 38 PENDING, 89 BLOCKED, 2 EXCLUDED. Verdict PARTIAL.** Details, receipts and corrections: [EXECUTION_LEDGER](docs/parity/EXECUTION_LEDGER.md) "Session 2"; invariants in `operator-console/tests/parity-ledger.test.js`.
- **Release gate:** `cd operator-console && npm run test:release` (syntax + all unit + every browser suite, isolated `DEX_STATE_DIR`; receipt under `output/release-gate/`). Browser suites no longer touch the live console's jobs/queues/media records.
- **Fixed:** client-controlled `__initPath` source-path injection; edit lineage recorded the secondary slot instead of the SD1.5 model the edit worker actually loads (nine 2026-10-16 edit records remain mislabelled `sdxl-photonic`, intentionally not rewritten); several A1111 port discrepancies (Extras sizing, Prompt Matrix orientation, Prompts-from-file insertion/seeds, infotext defaults/format, X/Y/Z parsing).
- **Added and live-proven on Big Mac:** SD upscale, Loopback, Poor man's outpainting, Outpainting mk2 (Edit → Script); multi-format export (PNG/JPEG/WebP, filename patterns, sidecar, ZIP). Added (tests, no live inference needed or pending): Puppet Master pose authoring (no ControlNet claim), new X/Y/Z axes, keyboard attention editing, Extras max side length.
- **Blocked on approvals / engine:** see [model approval packet](docs/parity/APPROVAL_PACKET_MODELS.md) (ControlNet canny/openpose, TAESD, VAE, LoRA/embedding, InstructPix2Pix — nothing downloaded) and [engine task packets](docs/parity/OPUS_TASK_PACKETS.md).
- Stray artifact from a failed first chain attempt: `/Users/andrew/images_made/20261016-212334-img2img-loop-0.png` (kept).
