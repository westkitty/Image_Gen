# DexDiffusion A1111 parity — execution ledger

Append-only. Controlling documents (local copies, retrieved read-only from Drive 2026-10-16):
`docs/parity/DEXDIFFUSION_COMPLETE_UI_IMPLEMENTATION_PLAN.md`, `docs/parity/DEXDIFFUSION_A1111_PARITY_LEDGER.json` (258 provisional rows; schema `dexdiffusion.a1111.parity-ledger.v1`).
Upstream pin: AUTOMATIC1111 `82a973c04367123ae98bd9abdf80d9eda9b910e2`. Exclusions: training, checkpoint merging.

## Verdict so far: PARTIAL — 1 of 16 phases started (P02), 0 requirements fully LIVE_PROVEN end-to-end through the UI.

## P00 preflight (2026-10-16)
- Host MacBook-Air.local / user andrew; repo `/Users/andrew/Image_Gen`, branch `main`, origin `git@github.com:westkitty/Image_Gen.git`, HEAD `483cb5e` (above the blueprint's `169ad07` baseline).
- Working tree: 28 tracked-modified + ~90 untracked at start (Voice/Drama/Media/capabilities work, PNGs). **Protected: never `git add -A`; never overwrite.** `operator-console/server.js` mixes that work with this ledger's hunks — stage only the P02 hunks.
- Big Mac `ssh westcat` reachable; sd-cli rev 7f0e728 (`--sampling-method` list: euler, euler_a, heun, dpm2, dpm++2s_a, dpm++2m, dpm++2mv2, ipndm, ipndm_v, lcm, ddim_trailing, tcd, res_multistep, res_2s, er_sde, euler_cfg_pp, euler_a_cfg_pp).
- Known environment hazards: `wc2tb` external volume is intermittently unreadable on Big Mac (SD1.5 `model-slot` gate fails); on this MacBook `lsof` can take 40 s+, which makes `bin/dexdiffusion status`, `restart` and `tests/system-info.test.js` ("status degrades…") exceed their limits. Neither is caused by P02.

## P01 inventory (partial)
- Ledger parsed: 258 rows in 13 areas (Seed/variation 29, scripts 25, Extras 24, Prompt language 22, Img2img 21, Primary txt2img 20, Metadata 19, Hires/refiner 18, Inpaint/outpaint 17, Models/networks 17, Settings 16, Operations 15, ControlNet/Puppet 15). All still `PENDING` except the P02 rows below.
- **Not done:** programmatic enumeration of upstream `modules/ui*.py`, `shared_options.py`, `scripts/`, built-in extensions to find rows beyond 258 (needs network access to the pinned upstream source; not attempted). Per-row SOURCE_PRESENT/UI_EXPOSED/WIRED/MOCK_TESTED/LIVE_PROVEN tracking is recorded in each row's `implementation_receipt` text for now.

## P02 sampling contract — status PARTIAL
Defect confirmed: `normalizeControlledGenerationBody` accepted `sampler`, `clip_skip`, `tiling`, `restore_faces` but never copied them into the request, `buildControlledArgs` had no way to forward them, and `sdcpp-controlled-generate.sh` had no such options — all four were silent no-ops (metadata even recorded the target default instead of the chosen sampler).
Changes: `operator-console/controlled-args.js` (canonical sampler ids, `normalizeSamplingFields`, `validateSamplingFields`, forwarding), `operator-console/server.js` (normalize, validate before queueing, record `clip_skip`/`tiling`, `sdxl-base` default sampler corrected to the worker's `dpm++2m`), `operator-console/workstation.js` (metadata fields), `sdcpp-workflow/bin/sdcpp-controlled-generate.sh` (`--sampler`, `--clip-skip`, `--tiling` into every sd-cli branch, validated against `--help`, server-tunnel path bypassed when clip/tiling set), `operator-console/tests/controlled-args.test.js` (+8 tests, written failing first; JS and shell sampler tables are test-locked together).
Evidence: unit tests 629/630 (the one failure is the lsof-latency `system-info` test above); live sdxl-photonic 768², seed 7, 10 steps via `POST /api/actions/generate-controlled`: `euler_a` → sd-cli log "sampling using Euler A method", pixel sha `e4f39cbb1b714ccf`, metadata sampler `euler_a`; `dpmpp2m` → "DPM++ (2M) method", pixel sha `6a772e7800645f8e`; `lms` → HTTP 400 "not supported by the installed stable-diffusion.cpp".
Still open in P02: live runs of `clip_skip`/`tiling`; UI controls for both and the UI-driven sampler round trip (P03); audit of VAE, LoRA weights, batch controls for silent no-ops; MFLUX path unchanged and re-verification of a Klein generation from the UI after this change.
SHA-256 (first 16) after P02: controlled-args.js `3b0f5c032c974cc6`, workstation.js `ec47ab23b52500d0`, sdcpp-controlled-generate.sh `b1bce56f1e25b7bc`, tests/controlled-args.test.js `ac0c31a865caef37`.

## Incident
During P02 the console was restarted (`bin/dexdiffusion restart`) without checking `/api/jobs`; a running `controlled-generate` job (`07024a93-4782-4f3a-b7c1-7197573248bf`) was marked INTERRUPTED (`server-restart`). No remote process or image was lost. Rule going forward: query `/api/jobs` and refuse to restart if any job is running.

## Next eligible slice
1. Confirm a Klein 4B generation through the UI/API still passes (sampler `euler` accepted, others rejected).
2. P03 Generate UI: add clip-skip/tiling/sampler selector wiring with capability-driven enablement; browser tests.
3. P01 completion: obtain upstream source at the pinned commit and enumerate programmatically.
4. P04 onward per the blueprint; P05–P15 are not started.
