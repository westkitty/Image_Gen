# DexDiffusion A1111 parity — final report (2026-10-17)

**VERDICT: PARTIAL** — the gate is green and everything feasible without new weights or engine changes was implemented and proven; mandatory rows remain open (below).

- Repository: `/Users/andrew/Image_Gen` (github westkitty/Image_Gen), branch `main`, HEAD `9de6f546c1455b0616744c332291b441d9c5975a` (= entry HEAD; **all work is uncommitted**, nothing pushed).
- Running console: pid 79466, 127.0.0.1:31337, cwd `operator-console`, gitHead `9de6f54`, version `image-gen-console-2026-06-22-render-wrapper`.
- Native app: `/Applications/DexDiffusion.app`, bundle `local.image-gen.wrapper`, CFBundleShortVersionString 2.0, stamp `DexDiffusionSourceHead 2272fae` (not rebuilt; UI is served live). Launch rendered the live console (`output/release-gate/20261017-native-wrapper.jpg`).

## Requirements (schema v2, `docs/parity/DEXDIFFUSION_A1111_PARITY_LEDGER.json`)
Total 266 · COMPLETE 75 (LIVE_PROVEN 62, other verified 13) · PARTIAL 62 · PENDING 38 · BLOCKED 89 · EXCLUDED 2 (PR-16, PR-19: not stock).
Upstream inventory: 612 items at 82a973c0, 0 unmapped (`docs/parity/A1111_UPSTREAM_INVENTORY.json`).

Still open — PARTIAL: PR-02 06 07 08 09 10 14 17 18 · GN-02 03 11 · SD-11 12 13 · HR-05 · ED-01 · IP-07 · EX-08 09 11 15 22 · SC-01..06 08 10..14 16..19 25 · RS-02 03 05 13 · MT-05 09 10 11 12 18 19 · JO-02 04 10 14 15 · ST-01 05 16 · CN-10 11 12.
PENDING: PR-03 15 20 · GN-09 10 15 18 20 · SD-03 · ED-02 04..09 20 22 · IP-05 11 · EX-02 03 21 24 25 · SC-07 26 · RS-06 11 15 · MT-20 · JO-03 05 08 09 · ST-14 15 · CN-15.
BLOCKED (engine or weights): PR-04 05 11 12 13 21 22 · GN-06 12 14 16 17 · SD-04..10 16..29 · HR-08..12 14..18 · ED-13 18 · IP-10 13 · EX-12 16..20 23 · SC-09 22 23 24(policy) · RS-04 07 08 09 10 16 17 · ST-03 04 06..13 17 18 19 · CN-01..09 13 14.

## Tests (actual)
`npm run test:release` → **PASS 23/23** (`output/release-gate/20261017-final-3/release-gate.json`): syntax OK; unit **806/806**; browser suites all PASS incl. interaction matrix 180/180, edit-workbench 24/24, edit-scripts 5/5, puppet-master 6/6, voice-drama 8/8, drama-studio 9/9. Earlier runs in this session failed on intermittent pre-existing races (concept-a startup read, drama-studio "Direct:", inpaint fill); each was reproduced with the pre-session code too and is documented in EXECUTION_LEDGER (two hardened, one product fix).

## Real inference receipts (Big Mac, SD1.5)
Loopback `20261016-212926-loopback`; SD upscale `20261016-213425-sd-upscale`; Poor man's `20261016-213554-outpaint-poor`; mk2 `20261016-213646-outpaint-mk2` (+ pass runs listed in EXECUTION_LEDGER). Earlier-session receipts verified present on disk (all cited run ids resolve).

## Privacy
Prompts off: no prompt text in `server.log`, `sdcpp-workflow/state/`, the nine live run folders, published PNG text chunks, or exported ZIP/JPEG/sidecars. Browser suites run on isolated state; live jobs/queues/media files byte-identical after runs.

## User approvals needed
1. Model weights: `docs/parity/APPROVAL_PACKET_MODELS.md` (ControlNet SD1.5 canny + openpose fp16, TAESD, VAE, a LoRA/embedding, optional InstructPix2Pix).
2. Engine work (stable-diffusion.cpp changes): `docs/parity/OPUS_TASK_PACKETS.md`.
3. Whether to commit/push this working tree, and whether to relabel the nine mislabelled 2026-10-16 edit records.

## Resume point
Next slices without approval: JO-08 live preview (`--preview proj`), Real-ESRGAN inside Extras/SD upscale, batch/directory img2img + Extras (ED-06..09, EX-02/03), uploaded mask / save mask (ED-05, IP-11), live receipts for the new X/Y/Z axes and Prompt Matrix, OP-7 cancel for shared sd-server paths, inpaint blur-order parity.
