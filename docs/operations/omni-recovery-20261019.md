# DexDiffusion rapid recovery — 2026-10-19

> **Historical snapshot (2026-10-19).** This report records the evidence and unresolved checks available on that date. References below to "current" work, running jobs, or live proof are historical, not claims about the installed application today. For later Studio release verification see [the 2026-10-21 release evidence](arena-v2-studio-20261020/RELEASE_EVIDENCE_2026-10-21.md) and current source/tests.

This is a bounded result ledger keyed to the [53-group capability crosswalk](../concept-a/DEXTER_STUDIO_CAPABILITY_CROSSWALK.md). `L` = new live output/API check; `M` = 252-cell isolated interaction matrix; `A` = Concept A browser suite; `E` = 29 Edit browser checks; `V` = 8 Voice/Drama browser checks; `D` = Drama Studio browser suite (12/13); `S` = source/route inspection. A fixture result does not prove Big Mac inference. `PARTIAL LIVE` means only the named subpath was proven.

The full `npm test` run exited 1 while browser and live jobs ran concurrently; two visible failing cases passed focused reruns. The full unit gate remains red. The Drama Studio Voice Designer fixture failed twice (4 candidate nodes versus 2 expected); a visibility-selector attempt did not resolve its flow and was reverted.

| # | Feature | Exposed | Functional check | Result | Blocker / unverified part |
|---:|---|---|---|---|---|
| 1 | Dexter identity and original artwork | UI mapped | A/M | FUNCTIONAL IN FIXTURE | live subpath not checked |
| 2 | Ten-workspace navigation | UI mapped | A/M | FUNCTIONAL IN FIXTURE | live subpath not checked |
| 3 | Search and command palette | UI mapped | A/M | FUNCTIONAL IN FIXTURE | live subpath not checked |
| 4 | Global Jobs center | UI mapped | A/M | FUNCTIONAL IN FIXTURE | live subpath not checked |
| 5 | Help and tutorials | UI mapped | A | FUNCTIONAL IN FIXTURE | live subpath not checked |
| 6 | Contextual inspector and transition safety | UI mapped | A/E/D | FUNCTIONAL IN FIXTURE | live subpath not checked |
| 7 | Console, worker, model, and resource truth | UI mapped | L/M | PARTIAL LIVE | all worker paths not run |
| 8 | Workstation resume and start actions | UI mapped | A | FUNCTIONAL IN FIXTURE | live subpath not checked |
| 9 | Active jobs and recent canonical assets | UI mapped | L/A | PARTIAL LIVE | historical assets absent |
| 10 | Prompt privacy and prompt persistence | UI mapped | M/S | FUNCTIONAL IN FIXTURE | live subpath not checked |
| 11 | Prompt composition and caret preservation | UI mapped | A/M | FUNCTIONAL IN FIXTURE | live subpath not checked |
| 12 | Prompt styles, wildcards, and prompt ordering | UI mapped | M/S | FUNCTIONAL IN FIXTURE | live subpath not checked |
| 13 | Model registry, selection, and readiness | UI mapped | L/M | PARTIAL LIVE | other supported models not regenerated |
| 14 | Sampling, dimensions, seed, scheduler, and noise settings | UI mapped | L/M | PARTIAL LIVE | advanced combinations not run |
| 15 | LoRA, VAE, embeddings, and supported model extras | UI mapped | M/S | FUNCTIONAL IN FIXTURE | live subpath not checked |
| 16 | Generation preview, request normalization, and replay | UI mapped | M/S | FUNCTIONAL IN FIXTURE | live subpath not checked |
| 17 | Single-image generation and result recovery | UI mapped | L/M | PARTIAL LIVE | other model targets untested |
| 18 | Batch generation | UI mapped | M/S | FUNCTIONAL IN FIXTURE | live subpath not checked |
| 19 | X/Y/Z sweeps and prompt matrices | UI mapped | M/S | FUNCTIONAL IN FIXTURE | live subpath not checked |
| 20 | Source selection, typed active-asset context, and compatible Edit handoff | UI mapped | L/E | PARTIAL LIVE | all handoffs not run live |
| 21 | Img2Img | UI mapped | L/E | PARTIAL LIVE | other edit models unsupported |
| 22 | Inpaint and mask geometry | UI mapped | E/S | FUNCTIONAL IN FIXTURE | live subpath not checked |
| 23 | Mask brush, zoom, pan, undo, and redo | UI mapped | E | FUNCTIONAL IN FIXTURE | live subpath not checked |
| 24 | Outpaint and canvas extension | UI mapped | E/S | FUNCTIONAL IN FIXTURE | live subpath not checked |
| 25 | Detailer | UI mapped | E/S | FUNCTIONAL IN FIXTURE | live subpath not checked |
| 26 | Resize, Pillow upscale, ESRGAN, and hires workflows | UI mapped | M/S | FUNCTIONAL IN FIXTURE | live subpath not checked |
| 27 | Edit scripts, Puppet Master pose, and supported references | UI mapped | E/S | FUNCTIONAL IN FIXTURE | live subpath not checked |
| 28 | Source/result identity and derivative lineage | UI mapped | L/E | PARTIAL LIVE | all derivatives not sampled |
| 29 | Image Library grid/list and density | UI mapped | L/M | PARTIAL LIVE | all library modes not checked live |
| 30 | Image Library search/filter/sort | UI mapped | M/S | FUNCTIONAL IN FIXTURE | live subpath not checked |
| 31 | Image Library paging and thumbnail requests | UI mapped | M/S | FUNCTIONAL IN FIXTURE | live subpath not checked |
| 32 | Keepers, collections, and image metadata | UI mapped | M/S | FUNCTIONAL IN FIXTURE | live subpath not checked |
| 33 | Fullscreen viewer, comparison, and navigation | UI mapped | L/M | PARTIAL LIVE | comparison not checked live |
| 34 | Original image download and export variants | UI mapped | L/M | PARTIAL LIVE | export variants not checked live |
| 35 | Distinct image and mixed-media indexes | UI mapped | A/M | FUNCTIONAL IN FIXTURE | live subpath not checked |
| 36 | Voice profiles, samples, and approvals | UI mapped | L/V | PARTIAL LIVE | profile lifecycle not human accepted |
| 37 | Voice Designer and supported voice creation | UI mapped | D (FAIL) | BROKEN CHECK | Voice Designer fixture has 4 candidate nodes vs expected 2; cause unisolated |
| 38 | Voice cloning, auditions, and evaluation | UI mapped | L/V | PARTIAL LIVE | audition/evaluation not live |
| 39 | Voice long-form generation and conversion | UI mapped | L/V | PARTIAL LIVE | long form and OpenVoice pending |
| 40 | Drama projects and script identity | UI mapped | L/D | PARTIAL LIVE | other script shapes not live |
| 41 | Drama parsing, cast, and voice assignments | UI mapped | L/D | PARTIAL LIVE | multi-actor cast not live |
| 42 | Drama direction, takes, and phrase controls | UI mapped | L/D | PARTIAL LIVE | directed takes not live |
| 43 | Incremental Drama production and fingerprints | UI mapped | L/D | PARTIAL LIVE | incremental reuse not live |
| 44 | Drama QA, master, timeline, and export | UI mapped | L/D | PARTIAL LIVE | human audio review absent |
| 45 | ACE-Step music generation | UI mapped | L/M | PROVEN LIVE | none for named backend |
| 46 | Magenta instrumental generation | UI mapped | L/M | PROVEN LIVE | none for named backend |
| 47 | Stems and mastering capabilities | gated UI | S | BLOCKED | no worker contract for standalone stems/mastering |
| 48 | 3D individual asset source, generation, and validation | UI mapped | L/M | PARTIAL LIVE | textured job not rerun |
| 49 | 3D formats, viewer, and export | UI mapped | L/M | PARTIAL LIVE | textured viewer not rerun |
| 50 | World projects and scene construction | UI mapped | L/M | PARTIAL LIVE | Complete 360 not rerun |
| 51 | World viewer and supported rendering | UI mapped | L/M | PARTIAL LIVE | Complete 360 visual acceptance absent |
| 52 | System Doctor, privacy, storage, network, and preferences | UI mapped | L/M | PARTIAL LIVE | external system paths not all exercised |
| 53 | Video workspace boundary | gated UI | M/S | BLOCKED | LTX runtime and model absent; generation bridge unavailable |

## Current live proof

Pending final job reconciliation and source publication. Freshly verified: FLUX.2, SD1.5, img2img, Kokoro, Qwen3 Voice Design, Qwen3 Base synthetic clone, ACE-Step, Magenta RealTime, Hunyuan3D Mesh, SHARP Quick 3D, and synthetic Drama production. Exact IDs and hashes are recorded in the final completion receipt.

## Explicit limits

OpenVoice conversion is running; VoxCPM2, inpaint/outpaint, textured Hunyuan3D, Complete 360, advanced batch/sweep, and Video have no fresh output proof in this pass. Historical missing files and interrupted jobs remain preserved. No human audio or 3D visual acceptance is claimed.
