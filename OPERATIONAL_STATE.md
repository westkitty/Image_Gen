# Operational State: Image_Gen / DexDiffusion

<!-- operational-state:metadata
{
  "schema_version": 1,
  "project_id": "image-gen-dexdiffusion",
  "project_name": "Image_Gen / DexDiffusion",
  "project_root": "/Users/andrew/Image_Gen",
  "artifact_path": "operator-console + sdcpp-workflow",
  "state_revision": 17,
  "last_updated": "2026-10-02",
  "current_baseline": {
    "identity": "main@d713080 plus rev 16/17 Edit/Voice/Drama/Detailer work (committed in the rev-17 handoff commit)",
    "state": "current-baseline",
    "last_verified": "2026-10-02"
  },
  "scope_boundaries": [
    "DexDiffusion UI/API on MacBook and image-generation execution on Big Mac via ssh westcat"
  ],
  "linked_parent_state": null
}
-->

## 0. Historical Accepted Architecture (revision 12; current verification in revision 15)

Operator guide: `DEXDIFFUSION.md`. Live facts: `bin/dexdiffusion status`, `GET /api/system-info`.

- **Verified primary path:** DexDiffusion (MacBook, `operator-console` on 127.0.0.1:31337) → `ssh westcat` → Big Mac MFLUX 0.20.0 → FLUX.2 Klein 4B 4-bit (`mlx-community/flux2-klein-4b-4bit`, model at `$HOME/Library/Caches/DexDiffusion/mflux/flux2-klein-4b-4bit`, runtime venv `$HOME/Library/Caches/DexDiffusion/mflux/venv` on the internal SSD; the wc2tb venv is a package-identical fallback) → PNG streamed back → `/Users/andrew/images_made`.
- **Mac launcher:** `/Applications/DexDiffusion.app`, bundle id `local.image-gen.wrapper`, a native WebKit wrapper window. Icon `Contents/Resources/DexDiffusion.icns` is built from `operator-console/public/dexdiffusion/uploads/grok_image_1775521844329.jpg`. Exactly one Dock tile. Clicking it runs `bin/dexdiffusion start` (reuses or starts a detached console) and loads the local UI. Quitting the app leaves the console running. Install/repair: `scripts/install-macos-app.sh`.
- **Secondary path (restored rev 6, managed slot added 2026-09-29):** stable-diffusion.cpp `7f0e728` (Metal) at `$HOME/stable-diffusion.cpp/build/bin/sd-cli`, with available SD1.5, Photonic Fusion SDXL, SDXL base 1.0 and SDXL Turbo source checkpoints. One atomic managed slot at `$HOME/Library/Caches/DexDiffusion/secondary-model/current/model.safetensors` selects at most one secondary checkpoint; FLUX remains protected and primary. Real-ESRGAN x4plus remains at `/Volumes/wc2tb/ImageGen/upscalers/RealESRGAN_x4plus.pth` (BSD-3-Clause).
- **Capability truth:** derived by `operator-console/capabilities.js` from real job evidence (`sdcpp-workflow/state/capability-evidence.json`) plus a Big Mac asset probe. It is shown in System → Truth status, `/api/system-info` and `bin/dexdiffusion status`.
- **Remote exit codes:** Big Mac's Tailscale SSH always returns exit status 0, so remote results are read from output or in-band markers only.
- **Web access:** local loopback only; Tailscale Serve HTTPS :8443 **tailnet-only** → http://127.0.0.1:31337. There is no Funnel for DexDiffusion (the DEX//REACH :443 Funnel is separate and untouched).
- **Storage:** canonical image root `/Users/andrew/images_made` (sole durable copy).
- **Retention:** Big Mac generated images are ephemeral only.
- **Lifecycle:** `bin/dexdiffusion start|stop|restart|status|open`.

## 1. Project Identity and Scope

- **Project ID:** `image-gen-dexdiffusion`
- **Purpose:** Provide Andrew a usable MacBook-hosted DexDiffusion interface that delegates heavy local image generation to Big Mac.
- **Project type:** Local web UI + Node operator console + remote generation workflow.
- **Primary root:** `/Users/andrew/Image_Gen`
- **Target environment:** MacBook Air UI/control machine; Big Mac generation machine over `ssh westcat`.
- **Canonical authority:** Current repository plus newest explicit user instructions and runtime evidence.
- **Governed scope:** DexDiffusion controlled generation and its remote execution path.
- **Explicitly not governed:** Ollama/Hermes architecture except that this change must not disturb it.

## 2. Current Baseline

- Repository branch: `main`.
- Current HEAD before this change: `2cdfe21`.
- Working tree already contains user/project modifications; they must be preserved.
- Existing controlled targets execute through `stable-diffusion.cpp` scripts.
- Big Mac identity was verified as `bigmac@bigmac`; `/Volumes/wc2tb` is mounted.
- MFLUX was not installed on Big Mac at the start of this change (now installed: `/Volumes/wc2tb/dex-imagegen/mflux-venv`, mflux 0.20.0, Python 3.13.13).

## 3. Artifact Contract

DexDiffusion remains the everyday UI/API. Add FLUX.2 Klein 4B as an additional controlled generation target. Big Mac work initiated from MacBook must contain the SSH hop internally. Existing SDCPP targets and user-facing behavior outside this target remain intact.

## 4. Active Invariants

- **INV-001:** MacBook remains the control/UI machine.
- **INV-002:** Every Big Mac action launched by the project must use `ssh westcat` internally.
- **INV-003:** Do not expose the Big Mac generation service publicly.
- **INV-004:** Preserve existing SDCPP targets; MFLUX is additive.
- **INV-005:** Large model/cache data belongs on Big Mac, not the MacBook. Exception by evidence: the 4-bit MFLUX checkpoint (~4.3 GB) lives on Big Mac INTERNAL storage because file-backed weights on wc2tb hit Metal watchdog timeouts.
- **INV-006:** Do not claim image generation works until a real PNG is generated, copied to the MacBook, and validated.
- **INV-007:** The operator console binds 127.0.0.1:31337 only. The only remote web ingress is Tailscale Serve (tailnet-only) on `https://macbook-air.tailafb7e8.ts.net:8443/`. Never Funnel for DexDiffusion. (Note: `:443` on the same host is a pre-existing DEX//REACH gateway with Funnel ON; it is not DexDiffusion and was not changed.)
- **INV-008:** Every final DexDiffusion image lives exactly once under `/Users/andrew/images_made`. Run dirs hold metadata plus `canonical-images.json` (run_file → image_id/image_path/image_url); no image bytes. Images are served only via `GET /api/images/:id` (plain filenames inside the fixed root).
- **INV-009:** Big Mac holds generated image bytes only transiently. MFLUX: private `mktemp -d` dir removed by trap, PNG streamed over SSH stdout, removal verified. SDCPP scripts: `register_remote_ephemeral` + EXIT/INT/TERM trap in `sdcpp-lib.sh`.
- **INV-010:** The frontend is same-origin (relative `/api/...`). A stored loopback backend URL is ignored.

## 5. Verified Working Behavior

- **VER-001:** `ssh westcat` currently reaches user `bigmac` on host `bigmac`.
- **VER-002:** `/Volumes/wc2tb` is mounted on Big Mac with about 636 GiB free at the pre-change check.
- **VER-003:** DexDiffusion exposes controlled-generation job and run APIs in `operator-console/server.js`.
- **VER-004:** Direct Big Mac generation with `mlx-community/flux2-klein-4b-4bit` (Apache-2.0, base `black-forest-labs/FLUX.2-klein-4B`) staged at `$HOME/Library/Caches/DexDiffusion/mflux/flux2-klein-4b-4bit` on Big Mac internal APFS. Invocation: `mflux-generate-flux2 --model <dir> --base-model flux2-klein-4b --steps 4 --seed 424242`.
  - 512x512: exit 0, 22 s wall, 3.5 s/step, peak MLX 4.83 GB, PNG 226060 B, sha256 `071b7f24…0dffc8`.
  - 1024x1024: exit 0, 57 s wall, 11.2 s/step, peak MLX 12.37 GB, PNG 1061462 B, PIL-decoded, sha256 `9d967e03…c68fbe`.
- **VER-005:** DexDiffusion API: `POST /api/actions/generate-controlled` target `flux2-klein-4b` 1024x1024/4 steps/seed 424242 → job `3002f96e-940b-4674-97a5-3f7426d8a1a1` status PASS, firstFailedGate null; local PNG `sdcpp-workflow/runs/20260925-213019-controlled-flux2-klein-4b/controlled-flux2-klein-4b.png` 1024x1024, sha256 `a37a9ea5…36ac3b3` (metadata-stripped since save_prompts=false).
- **VER-006:** Visible DexDiffusion UI at `http://127.0.0.1:31337/dexdiffusion/` lists and selects "FLUX.2 Klein 4B (MFLUX)", applies 4-step/1024 defaults, Generate ran run `20260925-213236-controlled-flux2-klein-4b` (64 s) and displayed the image in the normal result panel; PNG byte-identical to VER-005.
- **VER-007:** `flux2-klein-4b` promoted to `status: proofed`, `proofDerived: true` after VER-005/006.
- **VER-008:** Tailscale 1.102.4 (daemon 1.102.2). `tailscale serve --bg --https=8443 http://127.0.0.1:31337` → status "https://macbook-air.tailafb7e8.ts.net:8443 (tailnet only)". `AllowFunnel` lists only `:443` (pre-existing DEX//REACH). Over the tailnet (100.120.7.127) the page, scripts and `/api/capabilities` return 200.
- **VER-009:** Browser: `http://localhost:31337/dexdiffusion/` and `http://127.0.0.1:31337/dexdiffusion/` make only same-origin `/api/*` calls, all 200 (the `ollama/status` 502 was already happening).
- **VER-010:** Fresh visible-UI generation (FLUX.2 Klein, 1024², 4 steps, seed 424242), run `20260925-215834-controlled-flux2-klein-4b`. PASS; progress showed "Generating… 9%" (no NaN). Result panel src `/api/images/20260925-215834-controlled-flux2-klein-4b-s424242-controlled-flux2-klein-4b.png`. File in `/Users/andrew/images_made/`: 1,058,308 B, PNG 1024x1024, IDAT inflates to the expected 3,146,752 B, sha256 `a37a9ea5ee8f19f446c7061a9b4279b4e6ab62e51e1dc350f1dcf723036ac3b3`. Exactly 1 copy across images_made, sdcpp-workflow, operator-console, output and TMPDIR. 0 copies on Big Mac.
- **VER-011:** Real API generation POSTed through the tailnet URL (seed 7, 512²), job `3784785b-…` PASS, image fetched over the tailnet via `/api/images/…` (200 image/png).
- **VER-012:** Consolidation: 141 legacy run-dir images → 126 moved and 15 byte-identical duplicates replaced by references; 0 image files left in `sdcpp-workflow/runs`. All 143 run image references resolve via `/api/run-file` → 302 → `/api/images/*`. Andrew's 6 existing files in `images_made` were not touched.
- **VER-013:** Big Mac cleanup: 6 generated PNGs (wc2tb proof/, q4-test/, runs/) were first saved to `images_made` as `bigmac-legacy-*.png` (SHA-verified), then deleted. A bounded find across wc2tb/dex-imagegen, ~/sdcpp-staging and TMPDIR finds 0 generated images. Model (4.3G internal), HF cache (16G) and venv (1.1G) are intact.
- **VER-015:** Tailscale HTTPS UI in a real browser: Google Chrome 153 (Playwright `channel: chrome`) on the MacBook loaded `https://macbook-air.tailafb7e8.ts.net:8443/dexdiffusion/`. HTML and all JS returned 200, and `/api/capabilities` returned 200. The only API origin was the ts.net origin, with 0 loopback calls. The script selected FLUX.2 Klein 4B, entered prompt and seed 271828 at 512², and clicked Generate. Progress climbed 0→6→…%, never NaN. Run `20260925-221607-controlled-flux2-klein-4b` finished Done, and the image rendered from `/api/images/20260925-221607-controlled-flux2-klein-4b-s271828-controlled-flux2-klein-4b.png` (200 image/png). File: 512x512 PNG, 253,073 B, decoded IDAT matches the expected size, sha256 `40b12965afcecfe902ea6f33e070803beccd8509c00b5ef697c463a62c88ed4d`. 1 copy on the MacBook, 0 in the run dir, 0 on Big Mac, 0 generated images of any kind in the bounded Big Mac roots, 0 remote temp dirs. The job ID was not captured (the UI does not display it and the server does not log it). A second tailnet device was not verified (none online).
- **VER-016:** Direct (hand-run) scripts obey the canonical invariant. `sdcpp-lib.sh` records every run dir from `make_run_dir`, and the top-level script's `pass_banner`/`fail` calls `operator-console/bin/canonicalize-image.js`, which uses the same `image-store.js` `finalizeRun()` as the server. Nested scripts (batch, hires-fix, xyz) defer to their parent so their intermediate inputs survive. Proven by the tests `direct (hand-run) SDCPP completion…` (fixture PNG, isolated root, collision → `-2`, metadata points to the canonical file) and `nested scripts defer…`.
- **VER-017 (revision 5, 2026-09-25):** Operationalization.
  - `GET /api/system-info` (from `system-info.js`) returns the primary target, MFLUX facts, canonical storage, a live Tailscale Serve probe (`tailnet-only`, funnel false) and a launcher/Dock probe, plus SDCPP dormant. A test asserts it contains no secret-like values.
  - `/api/capabilities` targets now carry `primary` and `runtime` (SDCPP targets `dormant`).
  - UI: the target list marks "FLUX.2 Klein 4B (MFLUX) — Primary" and SDCPP targets "— dormant". With no saved preference the primary proofed target is selected; a valid saved `dex_target` wins. The System screen has an "About DexDiffusion" panel (verified rendered in the wrapper).
  - `bin/dexdiffusion` start/stop/status verified: idempotent start (reused pid 76898); degraded status with the server down and Big Mac unreachable exits 0.
- **VER-018:** Dock launcher.
  - `/Applications/DexDiffusion.app` (Info.plist lint OK; CFBundleExecutable `DexDiffusion` is executable; CFBundleIconFile `DexDiffusion` → `DexDiffusion.icns`, verified by extracting it to show the Dexter artwork). Launch Services resolves `local.image-gen.wrapper` only to this path.
  - Dock: 34 tiles before and after, and the DexDiffusion tile sits at the old Image_Gen position. A screenshot shows the Dexter icon labelled "DexDiffusion".
  - First attempt showed the stale "IG" icon because the rewritten tile kept the old bookmark (`book`) pointing at Image_Gen.app. Fixed by dropping `book`/mod-date keys (the installer now does this).
  - Clicking the Dock icon opened the native wrapper window with the UI loaded and reused the running console (1 node process). Quit left the console up (HTTP 200). After `killall Dock` the icon was still correct, and clicking relaunched the wrapper with still one node process.
  - Legacy launchers archived (not deleted) to `~/Library/Application Support/DexDiffusion/retired-launchers/`: Image_Gen.app ×2, Image_Gen Launcher.app ×2, Image Gen Operator Console.app ×2. Dock prefs backups are in the same folder.
- **VER-019:** Fresh generation from inside the Dock-launched wrapper: FLUX.2 Klein 4B, 512×512, 4 steps, seed 8675309, prompt "a green apple on a white table". Run `20260925-223804-controlled-flux2-klein-4b` finished Done; progress read 6% (no NaN). File `/Users/andrew/images_made/20260925-223804-controlled-flux2-klein-4b-s8675309-controlled-flux2-klein-4b.png`: PNG 512x512, 265,122 B, sha256 `205fc2fd986362be5e758f056ec840309d11bc0c30611963393e621c29fe06f0`; `/api/images` returns 200 image/png. Copies: 1 on the MacBook, 0 in the run dir, 0 on Big Mac, 0 remote temp dirs.
- **VER-020 (rev 6) — remote-png incident.**
  - UI job `remote-png (exit 1)` = run `20260925-224619-controlled-flux2-klein-4b` (MFLUX, prompt "dude" (typed by Andrew), seed -1, 1024²). remote-command.log shows `TypeError: key(): incompatible function arguments` in `mx.random.key(seed)`: seed -1 was forwarded to MLX, which only takes seeds ≥ 0.
  - Masked because Tailscale SSH on Big Mac returns exit-status 0 for every command (`ssh westcat 'exit 7'` → 0), so the bridge fell through to the generic `remote-png` gate.
  - Reproduced outside the UI with `--seed -1` (identical TypeError).
  - Contributing: a MFLUX Python process sat in uninterruptible I/O for 10+ min on the external USB `wc2tb` (other I/O on that disk, e.g. Transmission).
  - Fix: negative seed → recorded random seed; the remote half is split into `mflux-remote-generate.sh` with in-band `MFLUX_REMOTE_EXIT`/`MFLUX_REMOTE_FAIL`; specific gates; runtime moved to an internal pinned venv (`uv pip freeze` identical: mflux 0.20.0, mlx 0.32.2, 56 packages).
  - Post-fix direct run: seed -1 + hostile prompt (quotes, `;`, `&`, `$5`, backticks, Unicode) PASS in 27 s, seed recorded `1920181967(random)`.
- **VER-021:** P0 UI acceptance in the Dock wrapper: MFLUX 1024², 4 steps, seed 20260925, prompt `a dog's red wagon (vintage) & a "lighthouse" at dusk; film grain`. Run `20260925-231619-controlled-flux2-klein-4b` PASS in 68 s; image visible; progress 14% (no NaN). `/Users/andrew/images_made/20260925-231619-controlled-flux2-klein-4b-s20260925-controlled-flux2-klein-4b.png`, 1024², 1,968,796 B, sha256 `eee8f76776df7679af2f9de2aee3c187845e35fe24e808d169dd4a9de61b7150`. 1 MacBook copy, 0 Big Mac copies.
- **VER-022:** SDCPP restored. Built `7f0e728` with Metal (Metal.framework linked; version `master-709`) via `uvx --from cmake`. SD1.5 downloaded, sha256 equals the upstream etag. ESRGAN x4plus downloaded; size equals the release asset and the sha256 matches the published value.
- **VER-023:** Live SDCPP proofs (all via the DexDiffusion API; 0 generated images on Big Mac after each):
  - **txt2img** sd15: job `b6eb9998`, run `20260925-233017-controlled-sd15`, 512², seed 4242, sha `e4a040ab…`. Lighthouse oil painting, correct content.
  - **img2img**: job `79dd849b`, run `20260925-233206-img2img`, strength 0.6, seed 5151, sha `9af823c0…`. Composition preserved and re-rendered; "night" weakly applied.
  - **inpaint**: job `5952b255`, run `20260925-233512-inpaint`, RGBA box mask, seed 6161, sha `d933dcfb…`. Moon inside the mask; mean change 23.8 inside vs 5.8 outside (4.1×). An earlier run with an opaque RGB mask regenerated everything; that was a fixture error, since the UI contract is alpha-painted masks.
  - **upscale-resample**: job `d464e910`, 512→1024.
  - **upscale-esrgan**: job `7261a7b2`, run `20260925-233715-esrgan-upscale`, 512→2048, sha `5bfbd239…`.
  - **hires-fix**: job `0cf96c2a`, run `20260925-234021-hires-fix`, base 512 → final 1024.
  - Fixes found by these proofs:
    - img2img/inpaint/esrgan rejected canonical-store inputs → now accept `runs/` or `images_made/` only.
    - sd15 required a pre-started sd-server tunnel (`tunnel-down`) → now falls back to on-demand sd-cli.
    - Nested run cells were recorded as runs (`base-base.png`) → `record_run_dir` maps them to the top-level run (earlier run renamed/re-indexed).
    - `hiresFinalImageUrl` was missing for runs-relative paths.
- **VER-024:** Final regression.
  - Console stopped → Dock icon click started it via the helper (1 node process, no lingering helper). This exposed and fixed a `bin/dexdiffusion start` bug where a `cd && node &` subshell held the caller's stdout, which would have hung the wrapper.
  - Wrapper MFLUX 1024², seed 8080808: job `a000f3ef-25af-413b-adf1-72d60e068bb9`, run `20260925-235025-controlled-flux2-klein-4b`, 72 s, sha256 `c8722e02a8a63199e122256813cf76be2d25695c5287944b5b47ba47328c94f6`. 1 MacBook copy, 0 Big Mac. The evidence recorder logged it automatically.
  - System → Truth status renders the derived capabilities.
- **VER-025 (rev 7, 2026-09-26) — Workstation upgrade.** All proofs ran through DexDiffusion (console 127.0.0.1:31337), and afterwards Big Mac held 0 generated images (a bounded find over sdcpp-staging, wc2tb/dex-imagegen, wc2tb/ImageGen and TMPDIR, 2 h window). Every output is one canonical file in `images_made`.
  - **Native SDCPP quantity:** `sd-cli -b 3 -s 1000` (direct) logged seeds 1000/1001/1002 and wrote 3 PNGs. Batch image 2 was byte-identical to a single run at seed 1001 (`8ff39ae2…`). Through DexDiffusion, job `6405c062` (sd15, qty 3, seed 5000) used one sd-cli invocation (3 "generating image", 1 process) and produced 3 canonical files `…110647-controlled-sd15-s500{0,1,2}-controlled-sd15-b0{0,1,2}.png` (sha `e54296ab…`, `38b91f58…`, `078e2616…`). The run dir holds no image bytes, and `controlled-extras.json` records the per-output seeds. A sequential DexDiffusion run at seed 5001 (job `4a5c8b94`) was byte-identical to b01. **Verdict: PROVEN NATIVE BATCH** for SDCPP quantity 2–16. Larger quantities, MFLUX, and native-command build failures fall back to sequential.
  - **MFLUX quantity 3 (UI):** job `0a7f395c`, 512², sequential, 3 independent random non-negative seeds (38720525, 1247961809, 1894433810), 3 canonical files. The result strip showed all 3 with seed/model/size/status.
  - **Reload recovery:** mid-job reload reattached to the same backend job (`/api/jobs` showed 1 active job, no duplicate). A mid-queue reload reattached to the same queue.
  - **Lineage chain (UI):** FLUX txt2img `…111730-…s1247961809…` → img2img 0.35 (`…112016-img2img…`, mean Δ 9.4) → Use as New Source → img2img 0.75 (`…112120-img2img…`, mean Δ 34.3) → inpaint (`…112249-inpaint…`, masked bbox Δ 37.8 vs outside 2.5 = 15.1×) → Real-ESRGAN 512→2048 (`…112420-esrgan…`) and Lanczos 512→1024. Parent, children and ancestors resolve via `/api/images/:id/meta`. Keeper toggled on `…111730…` as metadata only.
  - **Mask safety (UI):** a blank mask is refused client-side with a toast (the server's `mask-empty` 400 remains). A full mask (Invert on empty = coverage 1.0) triggers the "entire image is masked" confirm. The server returns 409 `mask-full` without `confirm_full_mask`. Grow/Shrink/Feather/Blur/Invert/Undo/Redo were exercised; the mask stays 512×512 (source resolution).
  - **Outpaint:** job on `…112249-inpaint…`, right +128 → `…112626-inpaint…` 640×512. The source region was kept (mean Δ 2.6), and the new strip continues the desk and wall with a visible soft seam. **Verdict: LIVE PASS (seam visible).**
  - **High-Res Refine:** sd15 512², seed 777, `--hires --hires-scale 1.5 --hires-steps 8 --hires-denoising-strength 0.45 --hires-upscaler Latent` → `…112753-controlled-sd15-s777…` 768×768. The remote log shows "hires Latent upscale 64x64 -> 96x96" and "hires sampling 1/1 completed", so this is sd-cli's diffusion second pass, not the Pillow hires-fix route. **PROVEN.**
  - **Seed Lab:** seeds 775–779 around 777 in one native batch (job `7272abc7`). Target, size, steps, CFG and scheduler were identical and the prompt was redacted in the stored params.
  - **Prompt A/B:** two sd15 runs at seed 777 with identical stored params. Only the prompt differed, and no prompt text was stored (save_prompts off).
  - **Numbered Batch queue (UI):** 3 prompts, #2 containing an unknown LoRA → `1 DONE, 2 FAILED (validation), 3 DONE`. Retry Failed re-ran only #2 (attempts 2; #1/#3 attempts 1). Stop After Current, remove and reorder are unit-tested only. The 10-entry fixture parses to exactly 10 entries via `/api/batch/parse` (no warnings).
  - **Source prep:** img2img with `crop-landscape` on a 512² FLUX image → 512×384. The temporary copy was removed and the canonical source was untouched.
  - **Doctor:** `bin/dexdiffusion doctor` / `GET /api/doctor` → 13 PASS, 1 WARN (14 configured SDXL/Flux model files absent), with Serve tailnet-only and Funnel absent. It generates nothing.
  - **Privacy:** after all runs, grepping the prompt words across `state/`, today's run dirs and `mask-uploads/` finds nothing. The old Favorite Presets persisted prompt text regardless of `save_prompts`. They are now Recipes, stored via `sanitizeRecipe`, and existing presets are scrubbed on load when prompt saving is off.
- **VER-026 (rev 7) — Model inventory (bounded search of wc2tb minus media/backups, sdcpp-staging, DexDiffusion cache, ~/models, ~/ai, ~/Downloads):** SD1.5 `v1-5-pruned-emaonly` (BASE, LIVE PASS), RealESRGAN_x4plus (UPSCALER, LIVE PASS), FLUX.2 Klein 4B 4-bit (BASE, LIVE PASS, internal cache, not moved), Wan2.1-T2V-1.3B on `/Volumes/wc2tb/wan models/` (video model + T5/VAE components; FOUND — UNSUPPORTED for image generation). There is **no ControlNet, no LoRA and no standalone VAE** anywhere searched. `/Volumes/wc2tb/ImageGen/loras` does not exist. No model was moved, because no useful unmoved image model exists.
- **VER-027 (rev 8, 2026-09-26) — Closure corrections, live on the final working tree.**
  - **Outpaint seam:** new regions start from an 8 px edge-band extension (the old whole-source blurred stretch copied the teapot handle into the new strip). The mask ramps 0→255 over a 48 px overlap inside the source. After generation the source is composited back over the canonical output, exact in the interior and graded across the band. Default strength is 0.85. Same source, +128 right, seed 31337 → `…121817-inpaint…` 640×512, interior change **0.00** (the old pipeline gave 2.50). The old hard vertical line at the boundary is gone. Naming the main subject in the prompt can still make SD1.5 draw a duplicate (seen with a "teapot" prompt), so the UI now advises describing the new area.
  - **Inpaint** uses the same composite (mask softened 4 px). Box mask → masked change 10.7 vs unmasked **0.00** (`…121934-inpaint…`). Before this, textured unmasked areas drifted about 10 from sd-cli's full-image re-encode.
  - A regression caught during this pass (the outpaint source was stretched when left=top=0) was fixed with an explicit inpaint-only `fit` flag. Its one bad output (`…121654-inpaint…`) remains in images_made; it was left in place, not deleted.
  - **375px:** single-column grid panes are `minmax(0,1fr)`, and the mobile media query collapses to `minmax(0,1fr)` (was `1fr`, whose min-content let the long values in System and the names in Models force 476–622 px panels). Doctor rows stack their detail under the check name. At 375 and 768, all 7 screens report 0 elements past the viewport and document scrollWidth equals the viewport.
  - **Edit:** a Source Image card comes first. The legacy run/file pickers moved into a collapsed "▸ Advanced Source Selection". Library → Img2Img, Library → Inpaint, result → Img2Img and result → Inpaint all set the source without touching them.
  - **Durable queues:** `sdcpp-workflow/state/queues.json` (gitignored), written atomically (tmp + fsync + rename). Prompts and the negative prompt are written only when save_prompts=true. On load, RUNNING becomes INTERRUPTED (gate `server-restart`, retryable); DONE, FAILED, SKIPPED and QUEUED are kept. A restored queue without saved prompts resumes only after the same numbered text is re-pasted (numbers and titles must match; otherwise 409).
  - **Live queue controls (queue `b5c1f9a8`, 4 SD1.5 items, prompt saving off, canary prompts):** while #1 ran, reordering RUNNING returned 409, #4 moved up (order 1,2,4,3), #2 was removed (SKIPPED), and Stop After Current was set. #1 finished and nothing else started (STOPPED, 0 active jobs 6 s later). A controlled `bin/dexdiffusion restart` then showed restored=true with DONE/SKIPPED/QUEUED intact. Resume without text returned 409, wrong text returned 409, and the correct text started Resume Remaining with #4 RUNNING. A second restart mid-item left #4 INTERRUPTED, and the child ended with the console (no image, no Big Mac process). The UI banner read "Restarted queue detected. 1 completed · 1 queued · 1 interrupted". Retry Interrupted/Failed from the UI with the pasted text ran #4 (attempt 2) then #3. #1 was never re-run (attempts 1). Final: DONE, SKIPPED, DONE, DONE.
  - **Failure isolation (queue, canary prompts):** 1 DONE, 2 FAILED (unknown LoRA), 3 DONE. Retry Failed re-ran only #2 (attempts 2).
  - **Re-verified live:** FLUX qty 3 from the UI (3 cards, seeds 1169503531/884147437/885660009). SD1.5 native qty 3 (6000–6002) and Seed Lab (5999–6003, one native batch). High-Res Refine 512→768. Prompt A/B at seed 777 (the negative-prompt text is no longer echoed in the "held constant" line). Img2Img subtle 0.35 (Δ 7.6) vs strong 0.75 (Δ 12.3) from the same source, and Use as New Source. Lanczos 512→1024 and Real-ESRGAN 512→2048. Keeper on/off and the Keeper filter. Recipe save/apply/rename/delete, settings only. Lineage txt2img → img2img → inpaint → ESRGAN/Lanczos. Result selection keeps the pane scroll (408.5 → 408.5). Frontend reload reattached the running job (1 backend job, no duplicate).
  - **Privacy canary `DEXPRIVACY-CANARY-926`** was used in Create, Recipe, Batch/queue (including restarts), A/B, Img2Img, Inpaint and negative prompts. grep over `sdcpp-workflow/state/`, `operator-console/server.log`, today's run dirs, `mask-uploads/` and the UI session in localStorage found **no matches**.
  - **Storage/network:** 0 image files in today's run dirs. Big Mac has 0 PNG/JPG/WebP in 4 h under sdcpp-staging, wc2tb/ImageGen and TMPDIR, and no sd-cli process. Only one listener, on 127.0.0.1:31337. Serve :8443 → 127.0.0.1:31337 with no Funnel; AllowFunnel lists only :443 (DEX//REACH → :8787, untouched). Doctor: 13 PASS, 1 WARN (configured SDXL/Flux files absent).
  - **Not built (non-blocking):** hard cancel (there is still no proof that a targeted kill stops the Big Mac process and cleans up) and upload/paste source import (security surface). ControlNet remains ENGINE SUPPORTED — MODEL ASSET MISSING. LoRA/alternate VAE: TEST WITHHELD (no assets).
  - Tests 86 → 90.
- **VER-028 (rev 9, 2026-09-26) — Media-neutral workstation (published in the commit that contains this revision).**
  - **Generic jobs** (`operator-console/media.js` `createJobStore`, state `sdcpp-workflow/state/jobs.json`, atomic). Every image job gets a generic record through `createJob` (media_kind image, worker mflux/sdcpp/local, resource class). Lifecycle QUEUED→RUNNING→(TRANSFERRING)→COMPLETE, plus FAILED/INTERRUPTED/CANCELLED; illegal transitions are rejected. Private text keys (prompt, negative, extension prompt, speech text, lyrics, descriptions, transcripts) are written as `[REDACTED]` unless prompt saving is on. On load, anything non-terminal becomes INTERRUPTED (`server-restart`, lease cleared, `retry_requires_input` when text was not saved); nothing is re-run. `/api/jobs/:id` falls back to the durable record after a restart.
  - **Live restart proof:** FLUX job `c494925d` (512², seed 2468) was COMPLETE before `bin/dexdiffusion restart` and still COMPLETE after it, with artifact `…125324-controlled-flux2-klein-4b-s2468…`. SD1.5 job `bf8a3c04` was RUNNING at the restart and came back INTERRUPTED (`server-restart`, retry_requires_input true). No lease was stranded. A numbered queue restarted mid-item came back STOPPED with #1 INTERRUPTED and #2 QUEUED.
  - **Resource arbiter** (`createResourceArbiter`, group `bigmac-heavy-inference`, capacity 1, server-enforced in `runAction`/`runControlledSequential` via `withLease`). Heavy actions are controlled-generate, img2img, inpaint, outpaint, esrgan, hires-fix, xyz, batch, cli/server-generate and seed-test; Lanczos is light. Live: two SD1.5 jobs posted together. J2 stayed `queued` at waiting position 1 with blocked_reason "Waiting for Big Mac — sd15 controlled-generate currently owns heavy compute". J2 started 1 ms after J1 completed, and the final state had no owner and no waiters. The lease is released on any terminal state, plus a 5 s sweep for failure paths. **External load:** a read-only `ollama ps` over `ssh westcat` every 60 s treats a loaded Ollama model ≥ 8 GB as occupying heavy compute; it never unloads or kills anything. None was loaded during this pass.
  - **Worker registry** (`createWorkerRegistry`, `GET /api/workers`): the mflux and sdcpp adapters report PROVEN. qwen3-tts (voice), ace-step (music) and ltx-video (video) are real dormant workers with probe/capabilities/prepare/execute/status/cancel/cleanup. They report architecture_available true and runtime, model, enabled and proven all false (RUNTIME MISSING, from a read-only existence probe of their expected install paths). `POST /api/media/generate` fails them with gate `runtime-missing` before any lease is taken, and nothing is installed.
  - **Media store** (`createMediaStore`, registry `state/media-artifacts.json`): roots are images `/Users/andrew/images_made` (unchanged; still image-store.js), voice `/Users/andrew/audio_made/voice`, music `/Users/andrew/audio_made/music`, video `/Users/andrew/video_made` (empty directories created). Finalization is atomic (`.incoming-*` then link, never overwrite) and records sha256, bytes and MIME after a content-signature check. No audio exists yet, and none was faked. `GET /api/media/:id` serves by artifact id only; traversal, encoded traversal, absolute paths, NUL, `.incoming-*`, unknown ids and staging paths all return 404 live.
  - **Secure staging** (`createStaging`, `sdcpp-workflow/state/staging/`, 24 h expiry and a 30 min sweep; `POST /api/staging` raw body, `GET`/`DELETE /api/staging/:id`). Type comes from magic bytes only (PNG, JPEG, WebP, WAV, MP3, M4A, FLAC). Limits: 25 MB for images, 40 MB and 10 min for audio, 4096 px and 16 MP for images. Ids are random `stg-…`, symlinks are rejected, and nothing is ever placed in canonical roots. Live: a JPEG uploaded under the hostile name `../../etc/passwd.png` was staged as `stg-f4a3…jpg`, and Img2Img from it (0.5, seed 99) gave canonical `…125430-img2img…` 512². The temporary PNG working copy was removed, and images_made has no import. Bad magic was rejected with `reference-invalid`, and a 50 MB upload returned 413. A 2 s WAV reference was staged in Voice Clone and Music, and it played from a real click (currentTime 0.97 s).
  - **Outpaint Extension Prompt** (`extension_prompt`): used instead of the main prompt when given, and treated as sensitive. The rev 8 seam/overlap/composite pipeline is unchanged.
  - **Test artifact:** `…121654-inpaint…` is flagged `test_artifact` with a note (metadata only; the file is untouched) and hidden from default Library views; "Show test artifacts" shows it.
  - **UI:** new top-level Voice, Music and Video screens in all three layouts. Voice has Speech, Voice Clone and Voice Design; Music has capability controls and a reference with an influence slider; Video is the dormant LTX slot. Generate is disabled with the message "Runtime/model not installed". Persistent `<audio>` players keep position across re-renders. The Media Library panel (`GET /api/library?kind=all|image|voice|music|video|keepers`) mixes images from the canonical store without duplicates. Workers & resources appear on Models and System. The Create button shows "Waiting for Big Mac — …". Edit imports by file, drop or paste. All 10 screens show 0 overflow at 375 and 768; desktop is fine.
  - **Doctor** adds a PASS row for the job store, media roots, staging, lease and library, and a WARN row "NOT INSTALLED is expected" for each dormant worker.
  - **Hard cancel:** still unsupported (`cancel_supported: false` with a reason on the mflux/sdcpp adapters). Termination through Tailscale SSH to the remote process is not proven.
  - **Image regression (live):** MFLUX, SD1.5 txt2img ×2 (under the lease), import → Img2Img, and the Library (223 canonical images) all pass. Big Mac has 0 generated files in 2 h and no sd-cli/mflux process. The only listener is 127.0.0.1:31337; :8443 → 31337 without Funnel; :443 DEX//REACH is untouched. Canary `DEXPRIVACY-CANARY-927` was not found in state (jobs, queues, staging, media), the server log, run dirs or temp areas.
  - Tests 90 → 97. Nothing was downloaded or installed (no Qwen3-TTS, ACE-Step, LTX, ControlNet, LoRA or VAE).
- **VER-029 (rev 10, 2026-09-26) — Big Mac voice/music model stack installed (see `MODEL_STACK.md` / `MODEL_STACK.json`).**
  - **Installer.** The installer is `/tmp/dex-model-stack-install.sh` (not in Git). It was run from the MacBook, and the remote half runs over `ssh westcat`. Success is gated on the in-band marker `REMOTE MODEL STACK INSTALLATION: PASS`; it was observed, and manifests were fetched only after that.
  - **Repairs this pass:**
    - Broken arithmetic for MISSING_ESTIMATE/REQUIRED_NOW was replaced with `(( ))`/`$(( ))`.
    - Kokoro needed `misaki[en]` and `en_core_web_sm`.
    - The Magenta venv pins `mlx==0.31.1`: the published `mrt2_small.mlxfn` was exported with MLX 0.31.1, and MLX 0.32.2 raised "[import_function] Invalid string size".
    - The ACE cleanliness check now ignores its own `checkpoints` symlink.
    - The script's own git publication was removed, so publishing happens here in one commit.
  - The earlier failed attempts had published an empty `MODEL_STACK.md`/`MODEL_STACK.json` in 7cebf9a; these are now superseded.
  - **Installed** under `/Volumes/wc2tb/generative-models` (16 GiB total, 17,565,040,568 bytes):
    - voice/kokoro/Kokoro-82M-bf16 (a71e4d38): short WAV PASS.
    - voice/qwen3-tts-base/Qwen3-TTS-12Hz-1.7B-Base-bf16 (a6eb4f68): reference voice-clone WAV PASS.
    - voice/qwen3-tts-voice-design/Qwen3-TTS-12Hz-1.7B-VoiceDesign-8bit (f90d6177): VoiceDesign WAV PASS.
    - music/ace-step/checkpoints: Ace-Step1.5@19671f40 (VAE, Qwen3-Embedding-0.6B, acestep-v15-turbo) + acestep-5Hz-lm-0.6B@148d8ea0. Runtime imports, safetensors headers and the official 0.6B MLX LM loader PASS. **No full song generation was run.**
    - music/magenta-realtime/magenta-rt-v2 (010aa0dc, resources + mrt2_small only): a 4.0 s MLX generation produced a 48 kHz stereo WAV (PASS).
  - **Runtimes:**
    - voice: `~/Library/Caches/DexDiffusion/voice/venv` (mlx-audio 0.5.6).
    - ACE-Step: `~/Library/Caches/DexDiffusion/music/ACE-Step-1.5` at git ca1e85fe with a project `.venv` (checkpoints symlinked).
    - Magenta: `~/Library/Caches/DexDiffusion/music/magenta-rt-venv` (magenta-rt 2.0.3, MLX 0.31.1).
  - **DexDiffusion probe reconciliation:** `media.js` `WORKER_PATHS` is now the single source of truth, and `capabilities.js` probes exactly those paths. Qwen reports the Base and VoiceDesign variants separately; ACE reports turbo/vae/embedding/lm-0.6b; a `magenta-rt` music worker was added. The old placeholder paths are gone (enforced by a test).
    - Live `/api/workers`: qwen3-tts, ace-step and magenta-rt are `INSTALLED — execution bridge disabled/unproven` (runtime ✓, model ✓, enabled ✗, proven ✗); ltx-video is RUNTIME MISSING; mflux and sdcpp remain PROVEN.
    - `/api/media/generate` for an installed worker returns gate `worker-unavailable` ("Installed but execution bridge not enabled/proven"); LTX still returns `runtime-missing`.
    - Doctor shows `AVAILABLE / INSTALLED — execution bridge disabled/unproven` for these workers.
  - **Preserved:**
    - Big Mac identity bigmac@bigmac. wc2tb has 52 GiB free (reserve 15 GiB) and internal storage 58 GiB (reserve 10 GiB).
    - The MFLUX model/venv, `/Volumes/wc2tb/ImageGen` and `/Users/bigmac/.ollama/models` are intact, with 0 files added.
    - The Google Drive rclone migration was RUNNING throughout and was never touched.
    - No video/LTX was installed.
  - **Not yet done:** DexDiffusion voice/music execution bridges. No voice or music has been generated *through DexDiffusion*.
- **VER-030 (rev 11, 2026-09-26) — Voice/music execution bridges live through DexDiffusion.**
  - **Bridge:** `operator-console/media-bridge.js` sends `operator-console/bridges/dexmedia_remote.py` over `ssh westcat bash -s` (Big Mac stays compute only, no server). The request travels as a 0600 `request.json` that the driver deletes on read, so private text never reaches argv. Results are read from in-band `DEXMEDIA_*` markers. Flow: remote job dir `~/Library/Caches/DexDiffusion/tmp/dexmedia.*` → validated WAV → scp → sha256 → `mediaStore.finalize` → `/Users/andrew/audio_made/{voice,music}` → Library → remote dir removed. Gates: worker-unavailable, runtime-missing, model-missing, resource, reference-invalid, generation, output-missing, output-invalid, transfer, checksum, canonicalization, cleanup, interrupted. Orphan sweep runs at startup and hourly.
  - **Live proofs (all through DexDiffusion, prompt saving off):**
    - Kokoro speech: 6.25 s.
    - Qwen3-TTS Base clone from a staged reference: 3.68 s.
    - VoiceDesign: 4.8 s.
    - Magenta mrt2_small: 8 s, 48 kHz stereo.
    - ACE-Step turbo + 0.6B LM: 30 s, 48 kHz stereo, ~6.6 min.
    - All five files have non-zero RMS. All five workers are PROVEN in `/api/workers` and Doctor (evidence in `sdcpp-workflow/state/media-evidence.json`).
    - UI: a Voice-screen Kokoro render played in the Current Job panel, and the ACE song played from Library.
  - **Arbitration:** Magenta waited at position 1 behind VoiceDesign and started after release. The lease ended free.
  - **Restart:** a RUNNING Magenta job became INTERRUPTED with no lease left. COMPLETE jobs stayed COMPLETE and their media was served. The orphaned remote dir was swept, leaving Big Mac tmp empty.
  - **Privacy:** canary `DEXVOICE-CANARY-778` is absent from state, staging, server.log, localStorage and the diff. It was stored only as `[REDACTED]`.
  - **Regression:** MFLUX 512², seed 9261, PASS into `/Users/andrew/images_made`; lease free.
  - **Layout and tests:** 375/768/desktop show 0 overflow and no JS exceptions. npm test 0 failures.
  - **Installer:** persisted as `scripts/install-bigmac-media-model-stack.sh` (`--verify` read-only mode → VERIFY PASS).
- **VER-031 (2026-09-29) — download, dimension and managed-secondary repair.**
  - **Audio downloads:** Current Job and Library use a distinct same-origin `GET /api/media/:id/download` route with attachment headers. Local, repeated and tailnet requests returned the original WAV bytes; missing and traversal requests returned non-audio 404 responses. The native WebKit wrapper used `WKDownload` and saved a validated 30 s, 48 kHz stereo WAV to Downloads without navigating away.
  - **Independent dimensions:** backend policies are explicit: MFLUX 256–2048 in multiples of 16; SDCPP 64 through each target's maximum in multiples of 8. Model changes preserve each valid axis independently. Real MFLUX jobs produced and recorded 768x512 (seed 290901) and 512x768 (seed 290902) PNGs at those exact measured dimensions.
  - **Secondary slot:** FLUX was checksum-identical before and after. The Big Mac switched SD1.5 → SDXL Turbo through one atomic managed slot; API, System UI and filesystem agreed on SDXL Turbo with exactly one retained slot version. A competing switch during generation returned 409 and retained the active model. A real SDXL Turbo job (seed 290903) produced a measured 512x512 PNG. SDCPP remains per-job `sd-cli`; slot `active` means authoritative selection, not resident model memory.
  - **Regression:** `npm test` passed 123/123; Node syntax, all workflow shell syntax, native Swift type-check and `git diff --check` passed.
- **VER-014:** Image route security (live): traversal, encoded traversal, absolute path, NUL, `.incoming-*`, symlink and unknown names all return 404.

## 6. Known Not Working

- **BRK-001 (resolved by VER-004..006):** No MFLUX generation path was installed or proven at the start of this change.
- **BRK-005 (resolved rev 6):** `remote-png (exit 1)` on UI renders with seed -1. See VER-020.
- **BRK-003 (history, kept):** Full-precision `black-forest-labs/FLUX.2-klein-4B` loaded from wc2tb HF cache hit `[METAL] Command buffer execution failed: GPU Timeout Error (kIOGPUCommandBufferCallbackErrorTimeout)` at step 0 (~56 s), and again during a `mx.eval(model.parameters())` prefault experiment (RSS climbed to ~10.6 GB). Prefault approach closed; worker script removed. The ~15 GB model remains cached on wc2tb, unused.
- **BRK-004 (resolved by VER-010):** UI progress label showed `NaN%`: the server sends `job.progress` as an object. Fixed via `DexClient.jobProgressPercent`.
- **BRK-002:** Prior local image-generation attempts in other runtimes did not establish a reliable working image path.

- **LIM-007 (rev 7):** ControlNet — **ENGINE SUPPORTED — MODEL ASSET MISSING.** sd-cli 7f0e728 exposes `--control-net`, `--control-image`, `--control-strength` and `--canny`, but no SD1.5 ControlNet model exists on Big Mac. Minimum for a future proof: one SD1.5 Canny ControlNet (`control_v11p_sd15_canny`, ~1.4 GB fp16 safetensors). The UI never offers Control.
- **LIM-008 (rev 7):** LoRA and alternate-VAE generation are TEST WITHHELD: no LoRA or standalone VAE files exist. The UI passes `--vae` only for SDCPP targets and marks it as ignored for MFLUX.
- **LIM-009 (rev 7, updated rev 8):** Queues persist across console restarts (items that were running become INTERRUPTED and retryable). Individual Create/edit jobs are still in memory.
- **LIM-011 (rev 11):** Voice/music jobs cannot be cancelled mid-run (`cancel_supported: false`); a restart marks them INTERRUPTED and the sweep removes the remote dir once the generator exits. ACE-Step takes ~6–7 min per 30 s song. LTX video is not installed.
- **LIM-010 (rev 7):** Hard cancel of a running remote generation is not implemented (Stop After Current only). Temporary source import (upload/paste) is deferred.

## 7. Implemented but Unverified

- **IMP-001 (resolved by VER-022/023; history kept) (R13: UNVERIFIED — RUNTIME ASSET ABSENT, rechecked 2026-09-25):** On Big Mac, `~/sdcpp-staging` is empty, there is no compiled `sd`/`sd-server` binary under `~/stable-diffusion.cpp`, `/Volumes/wc2tb/ImageGen` does not exist, and a bounded wc2tb search finds no SD1.5/SDXL checkpoints. The June asset cache points at those missing paths. No model or binary was acquired. SDCPP remote-image cleanup (`register_remote_ephemeral`) and server-side adoption of SDCPP run images are covered by static checks and unit tests but have not been exercised by a live SDCPP generation. `~/sdcpp-staging` on Big Mac is currently empty, so SDCPP targets could not be run.
- **IMP-002 (resolved by VER-015 for the MacBook browser):** Visible-UI click-through over the Tailscale HTTPS origin: the in-app browser pane blocks subresources from `*.ts.net` (ERR_BLOCKED_BY_CLIENT, client-side policy). The server path was proven by VER-008/011. Browser use from a second tailnet device is not verified; only the MacBook is online among Andrew's devices.
- **IMP-003 (resolved by VER-016):** Hand-run scripts previously left images in their run dir until the console processed the run.

## 8. Unknown or Evidence-Stale State

- **UNK-001:** Exact first-run download time and macOS 27 runtime behavior for MFLUX on this Big Mac are unverified until the smoke run.
- **UNK-002:** FLUX.2 Klein quality for Andrew's normal prompts is unverified until user evaluation.

## 9. Pending Work

- None for the MFLUX integration. Optional: BRK-004 fix; decide separately whether to reclaim the unused ~15 GB full-precision cache on wc2tb.

## 10. Active Decisions, Defaults, and Prohibitions

- **DEC-001:** First proof target is `flux2-klein-4b`, distilled, 4 steps, 1024x1024 default, guidance 1.0.
- **DEC-002:** Negative prompt, alternate scheduler, CFG semantics, and VAE switching are not claimed for this target.
- **DEC-003:** Do not replace DexDiffusion with ComfyUI for this integration.
- **DEC-004:** Use a direct SSH-backed worker instead of adding a second network service on Big Mac.

## 11. Validation and Evidence Matrix

| ID | Claim or behavior | State | Evidence | Validation method | Last checked |
|---|---|---|---|---|---|
| VER-001 | MacBook reaches correct Big Mac identity | verified | direct SSH output | `ssh westcat 'whoami; hostname'` | 2026-09-25 |
| VER-002 | wc2tb available | verified | direct `df` output | remote `df -h /Volumes/wc2tb` | 2026-09-25 |
| VER-004 | Direct 4-bit MFLUX 512/1024 generation on Big Mac | verified | exit 0, PNG, dims, sha256 | ssh westcat → mflux-generate-flux2 | 2026-09-25 |
| VER-005 | DexDiffusion API MFLUX generation works | verified | job PASS, local PNG validated | API request -> job PASS -> valid local PNG | 2026-09-25 |
| VER-006 | Visible UI selects target and shows result | verified | browser run + screenshot | in-app browser on 127.0.0.1:31337 | 2026-09-25 |
| TEST | … + remote-png gates, in-band exit, cleanup ordering, prompt safety, capability derivation, evidence recording, model-missing targets, lifecycle detach | verified | `npm test` 57/57 | `tests/controlled-args.test.js`, `tests/canonical-images.test.js` | 2026-09-25 |
| VER-008 | Tailnet-only Serve | verified | serve status, curl over tailnet | `tailscale serve status --json` | 2026-09-25 |
| VER-010 | One durable image, none on Big Mac | verified | SHA search | bounded find + shasum | 2026-09-25 |

| VER-025 | Workstation upgrade (quantity, native batch, staging, edit chain, outpaint, High-Res Refine, Seed Lab, A/B, queue, Doctor) | verified | job ids + sha/size in VER-025 | live API/UI + `npm test` 86/86 | 2026-09-26 |

## 12. Current Change Scope and Impact Radius

- **Allowed to change:** controlled-target registry, controlled-generation script selection, additive MFLUX worker script, tests, operational state.
- **Must remain unchanged:** existing SDCPP targets and unrelated UI behavior.
- **Potentially affected behavior:** controlled target selection, job execution, run-card parsing.
- **Mandatory checks:** JS syntax/tests, Bash syntax, target visible in capabilities, remote MFLUX CLI available, real generation returns valid PNG.
- **Repair class:** bounded additive backend integration.

## 13. Compact Revision Log

### Revision 1 — 2026-09-25

- Initialized operational state before the MFLUX integration.
- Preserved pre-existing dirty working-tree changes.

### Revision 2 — 2026-09-25

- Staged 4-bit `mlx-community/flux2-klein-4b-4bit` on Big Mac internal storage; proved 512 and 1024 direct generation.
- `mflux-controlled-generate.sh` now runs the exact proven CLI invocation via `ssh westcat`, verifies the internal model, validates remote + local PNG.
- Removed failed-experiment `mflux-remote-worker.py`.
- Extracted routing/args into `operator-console/controlled-args.js` with regression tests.
- API + UI proof passed; target promoted to proofed.

### Revision 3 — 2026-09-25

- Tailscale Serve (tailnet-only) on :8443 → 127.0.0.1:31337. Funnel is not used for DexDiffusion.
- Same-origin frontend (`client-helpers.js`), fixed the NaN% progress label.
- Canonical image store `operator-console/image-store.js` and `/api/images/:id`. Run dirs are metadata-only.
- MFLUX bridge streams the PNG over SSH stdout into `images_made/.incoming-*` with an ephemeral remote mktemp dir. SDCPP scripts clean up remote images on exit.
- Consolidated 141 legacy run images and 6 Big Mac images. Tests 26 → 35.
- Prior Metal-timeout history (BRK-003) retained.

### Revision 4 — 2026-09-25

- Real-Chrome UI proof over the Tailscale HTTPS origin (VER-015).
- Direct-script canonicalization through the shared `canonicalize-image.js` / `image-store.finalizeRun` (VER-016). Tests 35 → 37.
- Live SDCPP proof: UNVERIFIED — RUNTIME ASSET ABSENT (IMP-001).
- :8443 still tailnet-only; the :443 DEX//REACH Funnel was not touched; Node still bound to 127.0.0.1.
- Published to `westkitty/Image_Gen` `main` in the commit containing this revision (see `git log`).

### Revision 5 — 2026-09-25

- Operationalized DexDiffusion: `DEXDIFFUSION.md` operator guide, root `README.md`, `bin/dexdiffusion`, `/api/system-info`, System/About panel, primary-target default, dormant SDCPP labelling.
- The Mac launcher is now `/Applications/DexDiffusion.app` with the Dexter icon and a single Dock tile. Legacy launchers are archived.
- Fresh wrapper generation proof (VER-019). Tests 37 → 43.
- GitHub baseline: this revision is published in the commit whose subject is "Operationalize DexDiffusion workflow, docs, and Mac launcher" (SHA recorded in the follow-up note below after push).
- Published: `336707b628f2d15b82815c62239e6e1435ce5f63` on `westkitty/Image_Gen` `main` (remote SHA verified equal to local HEAD, 2026-09-25).

### Revision 6 — 2026-09-25

- Fixed the remote-png incident (seed -1 + Tailscale SSH exit status 0 + USB-disk stall). In-band remote status and specific failure gates. Internal MFLUX runtime.
- Restored SDCPP `7f0e728` + SD1.5 + Real-ESRGAN. txt2img/img2img/inpaint/resample/ESRGAN/hires-fix proven live; batch AVAILABLE (unproven).
- Capability truth is derived from evidence and assets; the hardcoded Truth Status/gate lists were removed.
- Fixed the lifecycle helper detach bug, canonical-store inputs for edit scripts, and nested run naming.
- Tests 43 → 57. Preserved: Dock launcher, Tailscale :8443 tailnet-only, :443 DEX//REACH untouched, canonical storage, zero Big Mac retention.

### Revision 7 — 2026-09-26

- Workstation upgrade (VER-025/026). Quantity UI and structured `job.results`. Native SDCPP `--batch-count` (PROVEN) with sequential fallback. Result staging with image actions. Seed Lab. Prompt A/B. Recipes (privacy fix). Model-aware controls (per-target `capabilities`).
- Numbered Batch parser and backend queue (`/api/batch/parse`, `/api/queues*`) with preflight, Retry Failed, Stop After Current, remove/reorder.
- Image-first Edit: img2img by canonical image id, strength presets, source prep, mask editor with brush/eraser/undo/redo/grow/shrink/feather/blur/invert, full-mask guard, and Outpaint (LIVE PASS).
- Enhance workspace (Lanczos vs Real-ESRGAN vs High-Res Refine, clearly separated). Native High-Res Refine is PROVEN.
- Lineage and Keepers in `sdcpp-workflow/state/image-meta.json` (metadata only). Library image grid, filters, lineage navigation, and a 2–4 image compare workspace with metadata diff.
- Doctor (`/api/doctor`, `bin/dexdiffusion doctor`). Reload recovery for jobs and queues.
- ControlNet: ENGINE SUPPORTED — MODEL ASSET MISSING. No model moves. Tests 57 → 86.

### Revision 8 — 2026-09-26

- Closure pass (VER-027). Outpaint seam fix (edge-band fill, 48 px graded overlap, source composite). Inpaint keeps unmasked pixels exact. 375px layout fixes (System, Models, Doctor). Edit is image-first with legacy pickers collapsed. Durable, privacy-aware queue state with restart reconciliation, live-proven with reorder/remove/Stop After Current/Resume/Retry. Canary privacy audit clean. Tests 90/90.

### Revision 9 — 2026-09-26

- Media-neutral workstation (VER-028): generic durable jobs with truthful restart reconciliation, a server-side Big Mac heavy-compute lease, a worker registry with dormant Qwen3-TTS/ACE-Step/LTX, a generic media store with audio/video roots, secure reference staging, a mixed Media Library, Voice/Music/Video workspaces, Outpaint Extension Prompt, a test-artifact flag, and Doctor/System worker+resource status.
- Closure re-verification on the final tree (canary `DEX-CLOSURE-PRIVACY-926-X7`, prompt saving off):
  - FLUX `9b8a9751` (512², seed 3141) and SD1.5 were posted together. SD1.5 waited behind FLUX and started at the exact millisecond FLUX completed, and the lease ended free.
  - Import (JPEG) → Img2Img PASS. Outpaint with an Extension Prompt: 384 → 512 wide, lineage parent recorded.
  - Restart: COMPLETE stayed COMPLETE; RUNNING became INTERRUPTED; the queue restored as STOPPED (#1 INTERRUPTED, #2 QUEUED).
  - Dormant voice/music generate returned `runtime-missing`. A WAV reference played to the end in Voice Clone.
  - The canary is absent from state, logs, run dirs, temp areas, the Doctor output and localStorage.
  - 375/768: all 10 screens show 0 overflow; no JS exceptions. Big Mac: 0 outputs and 0 generation processes. npm test 97/97.
- Future activation (no redesign): install the runtime and model at the worker's `runtimePath`/`modelPath` on Big Mac → the probe flips runtime/model to available → add the worker's execution bridge (script that uses the lease and `mediaStore.finalize`) → one real proof → set enabled/proven.

### Revision 10 — 2026-09-26

- Voice/music model stack installed and validated on Big Mac (VER-029). DexDiffusion worker probes now point at the real install paths. Qwen3-TTS/ACE-Step/Magenta report INSTALLED with execution bridges disabled/unproven. The bogus MODEL_STACK files from 7cebf9a are superseded. LTX is still not installed.

### Revision 11 — 2026-09-26

- DexDiffusion voice/music execution bridges (VER-030). Kokoro, Qwen3-TTS Base clone, Qwen3-TTS VoiceDesign, ACE-Step and Magenta RT run end-to-end through the job store, lease, staging and media store. They were promoted to PROVEN only from real DexDiffusion evidence. Working Voice/Music screens, installer persisted, Doctor updated.

### Revision 13 — 2026-09-29

- **Gate 0 MFLUX Zero-Retention Repair**: Eliminated redundant secondary SSH round trips that caused post-generation stalls. Big Mac cleanup is executed within the primary SSH session, strictly validated against `${TMPDIR:-/tmp}/dexdiffusion-mflux.[A-Za-z0-9]*`, and emits `MFLUX_REMOTE_CLEANUP: OK` before exit `0`. MacBook fails closed if cleanup marker is missing. Live proofed via job `6f6e80a3-4a34-4ade-bb8b-cae4d0babb5f` (FLUX.2 Klein 4B, quantity: 2, 0 Big Mac residue).
- **Model-Aware Prompt Intelligence**: Ollama `qwen3.8:27b-mlx` on Big Mac via the managed SSH tunnel `127.0.0.1:11436` (console endpoint override: `OLLAMA_BASE_URL` or `OLLAMA_HOST`). Profiles for FLUX, SDXL, Pony, SD1.5, Audio, Music, Video, and Detailer. Protected literals extraction (<lora:...>, __wildcard__, quotes, Pony scores, embeddings). Non-destructive review panel with diff and setting suggestion chips. Enforced `keep_alive: 0` to preserve unified memory.
- **15 He-Maker Wildcard Banks**: Vendored from `westkitty/He-Maker` with full provenance in `HE_MAKER_PROVENANCE.json` (SHA-256 hashes recorded). Case-insensitive `__bank__` expansion at generation-time with recursion guards and UI autocomplete.
- **Extra Networks & Active Resource Chips**: LoRA catalog with family compatibility badges, weight sliders, and trigger words. Honest empty state for embeddings. Active resource chips in Create with weight steppers and remove buttons.
- **Visual Model Browser**: 9 comprehensive model cards answering 5 questions, honest provenance badges (`exact-model` vs `placeholder`), and live switch check warnings (`/api/models/check-switch`) flagging negative prompt and LoRA incompatibilities.
- **Multi-Output Hero Workspace**: Dominant hero display with vertical filmstrip rail (desktop/tablet), horizontal rail (mobile), sibling promotion, and keyboard navigation. Live multi-output proofed via job `66d288bc-3cc7-4dcb-a6b4-eda8e0c463fe` (SD1.5, quantity: 3, seeds 1001-1003).
- **Native Apple Vision Detailer**: MacBook-native Swift binary (`vision-detailer`) for face, person, and derived hands detection with Gaussian feathering and mask preview (`/api/detailer/mask-preview`). Inpainting pipeline tracks `detailed_from` in canonical image metadata. **CORRECTION (rev 17):** the earlier 'live proof' of this feature was wrong — the old mask used the opaque-gray convention while the inpaint backend reads the ALPHA channel, so the whole image was regenerated (98.6% of outside pixels changed). Rewritten in rev 17; see Revision 17.
- **Capability Truth**: Face swap kept explicitly `UNAVAILABLE` due to licensing and safety constraints.
- **Test Suite**: 152/152 passing unit tests in `operator-console`. Zero Big Mac retention verified across all runs.

### Revision 14 — 2026-09-29 (Completion Gaps Fully Closed)

- **Gap A (Dynamic Model Card Completeness)**: Replaced static 9-card list with dynamic 1:1 coverage of all 17 live selectable targets returned by `/api/capabilities` (`getModelCards({}, allControlledTargets())`). Curated card definitions for 16 primary targets and dynamic honest fallback generation (`createFallbackCard`) for auto-discovered checkpoints (`sd15-auto-v1-5-pruned-emaonly`). Set difference `targets - cards` is strictly `[]`.
- **Gap B (Settings Preservation on Model Switch)**: Model selection preserves user's current generation parameters (`steps`, `cfg`, `width`, `height`) by default. Bounds normalization applies only when out of bounds. The system offers an explicit `⚡ Use model defaults` banner in the Create workbench and on active model cards to allow 1-click application of model recommendations without destroying active configurations.
- **Gap C (Structured Switch Warnings Schema)**: Structured warning objects conforming to `{ code, message, severity, resource_id }` with LoRA family compatibility checks. Fixed string/object warning rendering in UI (`• undefined` eliminated).
- **Gap D & Sec 4 (Browser Visual QA Pass)**: Full visual validation using Playwright Chromium across desktop (1440×900) and mobile (390×844) viewports. Visual proof captures saved to `output/playwright/`:
  - `browser-qa-desktop-1440.png`: Desktop layout with Output panel and `⚡ Use model defaults` banner.
  - `browser-qa-mobile-390.png`: Mobile responsive layout, zero horizontal overflow.
  - `browser-qa-models-tab.png`: Models tab showing 17 visual model cards, search input, filter pills, provenance badges, and Extra Networks catalog.
  - `browser-qa-hero-workspace-siblings.png`: Dominant Hero image with filmstrip rail (`SIBLINGS (2)`).
  - `browser-qa-detailer-face.png`: Native Apple Vision Detailer modal with live face detection and Gaussian-feathered mask preview.
- **Gap 5 (Fresh Traceable MFLUX Quantity-2 Proof)**: Live generation via `POST /api/actions/generate-controlled`:
  - Job ID: `0620d5d8-f6bf-4d07-9195-5fdcf3e05bb8` (status: `PASS`, exit code: 0).
  - Target: `flux2-klein-4b`, 1024×1024, 4 steps, quantity: 2.
  - Sibling 1: Seed `1374894029`, Run `20260929-141936-controlled-flux2-klein-4b`, File `20260929-141936-controlled-flux2-klein-4b-s1374894029-controlled-flux2-klein-4b.png` (1,590,794 bytes, SHA-256: `079420b41ea5655fd388c49485a29795b82e787cd08f528f19d92e47c60677ff`).
  - Sibling 2: Seed `26719822`, Run `20260929-142044-controlled-flux2-klein-4b`, File `20260929-142044-controlled-flux2-klein-4b-s26719822-controlled-flux2-klein-4b.png` (1,471,988 bytes, SHA-256: `583180c57a4748a6f2f95ab0e11e6c9b69d9f768e4957cf2841467404200e745`).
  - Zero Big Mac retention: `ssh westcat 'find /tmp -maxdepth 1 -type d -name "dexdiffusion-mflux.*"'` confirmed strictly 0 directories.
- **Regression Test Suite**: Expanded from 152 to 154 tests; all 154 passing (0 failures).

### Revision 15 — 2026-10-02 (Exhaustive model-path live verification)

- 19 intended/selectable generation targets reconciled: 5 initially working, 13 repaired and verified, 1 failed unresolved. This revision supersedes earlier unsupported model-readiness claims; old evidence remains historical.
- Metadata previously remained at revision 12 while the history included revision 14; metadata and this new revision now agree.
- Every passing target has a new quantity-1 normal-API generation, decoded non-solid image, matching canonical route bytes, exact managed-slot source and invocation evidence, and verified remote output absence.
- The protected MFLUX 0.20.0 / MLX FLUX.2 Klein 4B 4-bit internal-SSD primary is unchanged. Secondary backend remains stable-diffusion.cpp 7f0e728 on Big Mac via ssh westcat.
- Missing/stale checkpoint paths now point to exact installed files. Big Love Photo1, Photo4.5 and Photo6 have distinct explicit labels/targets. The SD1.5 alias shares the same canonical checkpoint without a weight copy.
- SSH activation requires an in-band successful state for the requested target. Capability proof is individual to each target; family history and PARTIAL results cannot promote another model. Remote cleanup failures override an early PASS banner.
- FLUX.1 Schnell FP8 remains BROKEN / FAILED_UNRESOLVED. Its exact verified full checkpoint loads and executes four steps, but produces a solid-white frame. CPU VAE and attention-off tests reproduced the invalid frame. A generated-frame decoder/content guard now rejects this failure. The exact numerical stage remains unisolated; this model is not certified as working.
- FLUX source was staged on Big Mac internal SSD to remove proven external cold-loading timeouts. Original external 17,236,328,572-byte checkpoint retained; both SHA-256 ead426278b49030e9da5df862994f25ce94ab2ee4df38b556ddddb3db093bf72. No weight downloads, deletion, or substitution.
- RealVisXL initially hit the 720-second external-load timeout with competing checksum reads; retry passed with competing reads paused.
- Current regression proof: primary/SDCPP txt2img, img2img, inpaint, Lanczos, Real-ESRGAN and hires-fix PASS. Hires Custom preserves explicit arguments with a shell-compatible profile. Batch/sweep has no new live acceptance claim.
- Console unit tests: 161/161, zero failures or skips. Node/shell syntax and git diff --check PASS.
- Node 127.0.0.1:31337, Tailscale Serve :8443 tailnet-only, separate :443 service/Funnel unchanged. Canonical images only /Users/andrew/images_made; Big Mac completed image outputs absent.

| Target | Final verdict | Job | Run | Canonical output |
| --- | --- | --- | --- | --- |
| sd15 | VERIFIED_WORKING | 2a3d17c4-b342-4b91-b3ab-670693858bf8 | 20261001-211553-controlled-sd15 | /Users/andrew/images_made/20261001-211553-controlled-sd15-s20261001-controlled-sd15.png |
| sdxl-base | VERIFIED_WORKING | ff5845bf-2f7e-4f51-97d1-e6e282f942bc | 20261001-211723-controlled-sdxl-base | /Users/andrew/images_made/20261001-211723-controlled-sdxl-base-s20261001-controlled-sdxl-base.png |
| sdxl-turbo | VERIFIED_WORKING | 8bda9f5a-4c9d-4a88-b291-aef9a8784896 | 20261001-211853-controlled-sdxl-turbo | /Users/andrew/images_made/20261001-211853-controlled-sdxl-turbo-s20261001-controlled-sdxl-turbo.png |
| flux-fp8 | FAILED_UNRESOLVED | 227ac79d-bdcd-4c7f-8836-3cf230675dc2 | 20261002-040459-controlled-flux-fp8 | Rejected solid-white diagnostic; retained as evidence |
| flux2-klein-4b | VERIFIED_WORKING | 524a7381-dfbf-405a-9c98-1fce010f7768 | 20261001-212403-controlled-flux2-klein-4b | /Users/andrew/images_made/20261001-212403-controlled-flux2-klein-4b-s20261001-controlled-flux2-klein-4b.png |
| sdxl-photonic | VERIFIED_WORKING | 3fb5ba52-6657-44b5-8ae9-5fc9867075ba | 20261001-212432-controlled-sdxl-photonic | /Users/andrew/images_made/20261001-212432-controlled-sdxl-photonic-s20261001-controlled-sdxl-photonic.png |
| sdxl-homochi | REPAIRED_AND_VERIFIED | 0f9b6b79-2105-4d92-8ea0-a6ae4c054a3e | 20261001-215657-controlled-sdxl-homochi | /Users/andrew/images_made/20261001-215657-controlled-sdxl-homochi-s20261001-controlled-sdxl-homochi.png |
| sdxl-pony | REPAIRED_AND_VERIFIED | 87696110-e208-46b0-a4bc-7d3033d20516 | 20261001-220743-controlled-sdxl-pony | /Users/andrew/images_made/20261001-220743-controlled-sdxl-pony-s20261001-controlled-sdxl-pony.png |
| sd15-homofidelis | REPAIRED_AND_VERIFIED | fea751be-e888-435b-9248-37561258093c | 20261001-221410-controlled-sd15-homofidelis | /Users/andrew/images_made/20261001-221410-controlled-sd15-homofidelis-s20261001-controlled-sd15-homofidelis.png |
| sdxl-juggernaut | REPAIRED_AND_VERIFIED | b2b03c83-28b3-48ad-9a2c-61d49e2a3d7c | 20261001-221710-controlled-sdxl-juggernaut | /Users/andrew/images_made/20261001-221710-controlled-sdxl-juggernaut-s20261001-controlled-sdxl-juggernaut.png |
| sdxl-realvisxl | REPAIRED_AND_VERIFIED | 6db769ed-ac11-41a4-a345-7d1191ed7e6e | 20261002-042311-controlled-sdxl-realvisxl | /Users/andrew/images_made/20261002-042311-controlled-sdxl-realvisxl-s20261001-controlled-sdxl-realvisxl.png |
| sdxl-cyberrealistic | REPAIRED_AND_VERIFIED | d28eacd6-c2a1-4bef-ad8b-46507188b9ec | 20261002-041937-controlled-sdxl-cyberrealistic | /Users/andrew/images_made/20261002-041937-controlled-sdxl-cyberrealistic-s20261001-controlled-sdxl-cyberrealistic.png |
| sdxl-epicrealism | REPAIRED_AND_VERIFIED | 31e0412b-613b-40a5-a5e6-d0b1fe22dfbd | 20261002-042830-controlled-sdxl-epicrealism | /Users/andrew/images_made/20261002-042830-controlled-sdxl-epicrealism-s20261001-controlled-sdxl-epicrealism.png |
| sdxl-biglust | REPAIRED_AND_VERIFIED | ec1fd5b5-069e-4a29-9229-d8f3c4f1b12c | 20261002-043423-controlled-sdxl-biglust | /Users/andrew/images_made/20261002-043423-controlled-sdxl-biglust-s20261001-controlled-sdxl-biglust.png |
| sdxl-lustify | REPAIRED_AND_VERIFIED | cafafab1-9324-4ac7-b53a-74692a3e11db | 20261002-044035-controlled-sdxl-lustify | /Users/andrew/images_made/20261002-044035-controlled-sdxl-lustify-s20261001-controlled-sdxl-lustify.png |
| sdxl-biglove | REPAIRED_AND_VERIFIED | ad8e9ccf-e2db-4af9-af72-b7fc5c773cac | 20261002-044624-controlled-sdxl-biglove | /Users/andrew/images_made/20261002-044624-controlled-sdxl-biglove-s20261001-controlled-sdxl-biglove.png |
| sdxl-biglove-photo1 | REPAIRED_AND_VERIFIED | 84622692-b0d6-47cc-8ba3-22e60f93c110 | 20261002-045254-controlled-sdxl-biglove-photo1 | /Users/andrew/images_made/20261002-045254-controlled-sdxl-biglove-photo1-s20261001-controlled-sdxl-biglove-photo1.png |
| sdxl-biglove-photo45 | REPAIRED_AND_VERIFIED | 242d99fa-0a99-424d-aaf8-7f3a3291fbe3 | 20261002-045824-controlled-sdxl-biglove-photo45 | /Users/andrew/images_made/20261002-045824-controlled-sdxl-biglove-photo45-s20261001-controlled-sdxl-biglove-photo45.png |
| sd15-auto-v1-5-pruned-emaonly | REPAIRED_AND_VERIFIED | 4afba9cc-b456-45a2-b33c-1d94324dec8d | 20261002-050354-controlled-sd15-auto-v1-5-pruned-emaonly | /Users/andrew/images_made/20261002-050354-controlled-sd15-auto-v1-5-pruned-emaonly-s20261001-controlled-sd15-auto-v1-5-pruned-emaonly.png |

- Full matrix/report: /Users/andrew/Documents/Codex/2026-10-01/files-pasted-by-the-user-you/outputs/verification-report.md
- Repository remains uncommitted; no push.

### Revision 16 — 2026-10-02 (Edit workbench repair, exact image recall, voice profiles, long-form, Drama)

Verified on the working tree (uncommitted, no push). Detail: `operator-console/docs/edit-workbench-20261002.md`, `operator-console/docs/voice-drama-20261002.md`.

**Image workflow**
- **Reproduced before editing:** a Library image sent to Edit carried Create-form/default values (steps 20, cfg 7, empty prompt) and **Run with no prompt sent nothing** (only a 3 s toast); with a typed prompt a real click did submit (job `6b9d4ee5…`, flagged test artifact). Old mask canvas fixed at 384×384 existed only as dead code behind the workstation override and has been removed.
- **Exact recall:** every canonical output now records an effective generation record (sampler, vae, preset, structured loras, edit_target, prompt only when prompt saving was on). Proof image `20261002-180047-controlled-sd15-s7777-controlled-sd15.png` (job `8c96755c-a816-4da3-b55c-679654e97bb6`: sd15, seed 7777, 512×384, 13 steps, cfg 5.5, karras, preset fast). With Create changed to steps 99 / cfg 21 / seed 424242 / other prompt, `openImageInEdit` loaded seed 7777 / 13 / 5.5 / karras / 512×384 and "Source prompt unavailable — prompt saving was off". Privacy ON (`20261002-184656-…-s4321…`, job `d189a68d…`): prompt recalled. Edit results record their true model (`edit_target`), not the old hard-coded `sd15`.
- **Real img2img through the UI path** (typed prompt, real mouse click on Run): request left the UI, job `43b868c2-33a2-4b23-abeb-c416912d1a29`, stages visible (Checking Big Mac → Uploading → Generating → Encoding → Decoding), canonical output `20261002-180240-img2img-img2img_20261002-180240.png`, lineage parent recorded.
- **Real inpaint on a non-square (512×384) source:** mask painted with real mouse drags (corner, and after 4× zoom + pan; stroke bbox matched the predicted image coordinates), job `78f48021-3888-41dd-949a-a6efca2db8d8` → `20261002-180437-inpaint-…`; changed pixels lay inside the mask bbox (+4 px soften), mean diff outside 0.0056.
- **Real outpaint (+128 right, 512→640):** job `748de17f-7d41-442c-b4bf-c9e9a7ed3bcf` → `20261002-184536-inpaint-…`; interior mean diff 0.00, 48 px overlap band blended.
- **Progress:** `GET /api/jobs/:id` exposes `stage`; percent only from real sd-cli `N/M - s/it` sampling lines. Live runs showed real stages; the sampling window of these short runs was shorter than the 900 ms poll, so a live "Sampling step N/M" display was **not captured on a real job** — it is proven by the unit tests on real sd-cli log text and by the browser test with a mocked job.
- **Fullscreen viewer, Resources, model picker, presets v2, two Edit layouts, accordions:** implemented and browser-tested (`npm run test:browser`, 18 + 6 checks, real Chrome) at 375 / 768 / 1280 px with no horizontal overflow; all 11 screens in all 3 shell layouts render without script errors.
- **Not proven live:** a real LoRA render (no LoRA files exist on Big Mac; LIM-008 unchanged). Structured LoRA serialization and the new `--lora-model-dir` handling in the edit scripts are covered by tests only.

**Voice / long-form / Drama (real Big Mac proofs through DexDiffusion, prompt saving off)**
- Kokoro preset profile render via the new multi-item driver: job `5a9202e0-70bd-47bd-90a8-cba028c87f96` → `20261002-222256-kokoro-speech.wav` (6.58 s).
- Cloned profile from a **synthetic** reference (the Kokoro output + its transcript; no real person) saved as a persistent profile (sample 6.58 s, RMS −26.2 dB, validation valid); Qwen3 Base clone line: job `8adf6604-a46f-4c98-a176-df511af03296` → `20261002-222545-qwen3-tts-base-speech.wav` (4.96 s, RMS 0.048). The requested direction "whispering" was reported **not applied** (Base cannot honor it).
- Long-form: Qwen clone 5 chunks / 1,908 chars (job `2df946a7-db08-4a95-b91f-545df58c6276`, 111.67 s stitched, `…223011-qwen3-tts-base-long-form.wav`); **>2,000 chars:** Kokoro 2,290 chars / 3 chunks (job `fe0e4d4d-4d34-4578-868e-22a82416df9c`, 135.37 s, `…223144-kokoro-long-form.wav`), per-chunk lineage (duration/sha256/boundary) recorded; one Big Mac invocation per render.
- VoiceDesign delivery A/B, same text/seed: plain job `8208101d-bf1a-41e0-9668-d2fa3d2a1f03` RMS −20.7 dBFS, 2.96 s; "whispering very quietly, almost out of breath" job `61c773cf-0113-49ee-87f7-0f7b0f86d4f2` RMS −25.4 dBFS, 4.56 s — an audible/measurable change; this does not prove a true whisper timbre.
- **Mini drama (dp-3fde1dfb, driven through the UI):** 3 speakers / 4 lines, two distinct Kokoro voices + narrator, all lines generated, line 2 re-rendered as **Take 2** (Take 1 kept), Take 2 selected, project assembled: `20261002-223526-drama-int-harbor-night.wav` (11.1 s, mono 24 kHz, RMS −22.0 dBFS, peak −1.0, per-line RMS −20…−25 dB, silent gaps). Saving the project, restarting the console and reloading preserved all takes, the active take and the export history.
- **Residue / lease / privacy:** after every proof Big Mac `~/Library/Caches/DexDiffusion/tmp` was empty and the heavy-compute lease free. A sweep of `sdcpp-workflow/state`, `server.log` and `runs/` for the spoken/dialogue/image-prompt text of the privacy-off runs found no matches (reference transcripts exist only inside the profile the user created). Prompt caching is **not implemented**: the installed runtime has no precomputed-prompt API (probe, 2026-10-02).
- **Bug found by the real run and fixed:** profile samples were first written as JSON-serialized Buffers; caught by the clone render (`reference-invalid`), fixed with a byte-exact regression assertion.
- **Pre-existing issue found, not changed:** `sdcpp-workflow/runs/<id>/remote-stdout.log` contains prompt fragments from sd-cli tokenizer debug lines even when prompt saving is off (e.g. `split prompt "…"`). The redaction filter only masks the exact prompt string. Out of scope for this pass; flagged for a separate fix.

**Tests:** `npm run check` PASS; `npm test` 236/236 (was 161); `npm run test:browser` 18/18 + 6/6; shell `bash -n` on all workflow scripts; `git diff --check` clean. New modules: `edit-core.js`, `edit-ui.js`, `lightbox.js`, `voice-ui.js`, `drama-ui.js`, `voice-audio.js`, `long-form.js`, `voice-engines.js`, `voice-profiles.js`, `voice-service.js`, `drama.js`, `drama-service.js`, `voice-routes.js`.
Proof artifacts (images flagged `test_artifact`, hidden from default Library views; audio proofs remain in the Library): see the identifiers above. Proof voices/project were removed afterwards.

### Revision 17 — 2026-10-02 (adversarial verification pass; Detailer rewrite, browser lifecycle, privacy fix) — IN PROGRESS, handed off

Evidence states: VERIFIED = observed in this pass with command/UI output; UNKNOWN = not tested.

**Defects found and fixed (all VERIFIED by tests and/or live runs):**
- **D-001 critical — Detailer repainted the whole image.** Root cause: mask PNG was opaque grayscale; `handleInpaint` converts via alpha, so alpha>0 everywhere. Fix: `bin/vision-detailer.swift` now writes white+alpha masks (alpha = painted), `confirm_full_mask:true` removed from `/api/detailer/run`. Live UI runs (face/hand/person, real Big Mac): 0 pixels changed >8 beyond 8 px of the mask; face/hand ≤0.52% of outside pixels differ (VAE latent bleed ≤6 px), person 6.5% all within the 8 px band.
- **D-002 — Detailer/Vision stalls (the "hand test" 30 s failure).** Root cause (OBSERVED via `sample` of the hung process): Vision's first use of a network on the Apple Neural Engine blocks in `_ANEClient doLoadModel` (sync XPC to `aned`) while a runaway `ANECompilerService` (≈100% CPU for >1 h) wedges it. Fix: Vision pinned to CPU by default (`--compute cpu|gpu|auto`), per-attempt 20 s timeout + 1 retry in `detailer.js`, `DEXDETAIL_STAGE=` stage markers, timings in JSON, and a timeout message that names a hot ANECompilerService. Face/person verified CPU-pinned while the ANE was wedged; **hand under a wedged ANE is UNKNOWN** (one 37 s hand run occurred during the wedge, so the pin may not cover the hand-pose request). Cold/warm timings 0.2–0.5 s.
- **D-003 — browser suite hang/orphan.** The suite was not stuck; it takes ~55 s and a killed run left its `node server.js` child. Fix: `tests/browser/server-supervisor.js` (child dies when the parent does, even on SIGKILL), signal/exception cleanup, per-test (120 s) and global (300 s) watchdogs, phase trace. Verified SIGKILL, SIGTERM and watchdog paths leave no server/Chrome; chained `npm run test:browser` = 19 + 7 checks, no orphans.
- **D-004/D-005 — Detailer modal:** stale mask preview after option change; empty detection gave a generic toast. Now preview is dropped on any option change and an explanatory note is shown; 422 `no_targets` from `/api/detailer/run`.
- **D-006 — Voice render state leaked across profiles** (a finished/running render of voice A showed on voice B; observed live). Render state now carries `profile_id`; other voices show "Waiting: <name> is rendering".
- **D-008 — privacy: multi-line prompts leaked into `remote-command.log`/`remote-stdout.log`** (params dump, `parse '…'`, `split prompt "…"`). Cause: line-based whole-string redaction can never match a prompt containing newlines. Fix: shared `sdcpp-workflow/bin/redact_stream.py` (whitespace-insensitive, per-line pieces, token array) wired into controlled/img2img/inpaint/cli-generate scripts. Verified with fresh live canaries (Create + img2img, multi-line, prompt saving off): no canary token anywhere on the MacBook or Big Mac. Historical logs from 2026-07-07/08 (5 runs) still contain unredacted prompts — left untouched (user data). Not yet migrated to the helper: `sdcpp-server-generate.sh`, `sdcpp-xyz-plot.sh`, `mflux-controlled-generate.sh` (same bug class). A separate follow-up session (task_84f411c2) was started by the user for this and may overlap.
- Accessibility: `public/dexdiffusion/a11y.js` names sibling-labelled form controls (23 unlabeled controls in Create/Batch/Enhance before; 0 after). Tap targets of 23 px height on dense legacy controls remain.

**Verified journeys (real UI, real Big Mac):** provenance recall; img2img (768×1024, mean abs diff 40); non-square inpaint (changes confined to stroke ±30 px); outpaint (+128 right → 896×1024, 97% of the original region unchanged); Detailer face/hand/person; voice clone from a user-approved sample + cloned render (17 s); 2,024-char long-form with Qwen3 clone (4 chunks, 1:45 audio, truthful per-chunk progress, 297 s incl. cold model load); Drama (5 lines, mixed Kokoro + clone, second take, ambience track, 14.9 s stereo export, project not on disk unsaved). Privacy scans of state/runs/logs/Big Mac found no dialogue; exported file names/registry contain the scene title (now disclosed in the Drama banner).

**Responsive/a11y matrix:** 5 viewports × 3 shell layouts × 11 screens = 165 cells, no horizontal overflow/clipping/script errors.

**Gates at handoff:** `npm run check` OK; `npm test` 246/246; `git diff --check` clean; `bash -n` on the four edited scripts OK; Python `py_compile` OK; browser suites 19/19 + 7/7.

**NOT done / UNKNOWN:** second independent bug sweep; Library/Enhance/Batch/Create cross-surface audit beyond the matrix; fullscreen on every surface re-verified live (covered only by the hermetic suite); state-contamination tests beyond voice render (e.g. deleting a voice referenced by a saved Drama project); Big Mac failure-path lifecycle (kill mid-render, lease timeout); ASR check that cloned speech says the requested words (local `whisper` is broken: numba/numpy mismatch); loudness inconsistency (long-form peak-normalised to −1 dBFS, single-chunk raw); Detailer `feather` is binarised by the inpaint backend's alpha>0 conversion (acts as growth, not a soft edge); hand-pose under wedged ANE.

### Revision 18 — 2026-10-03 (second adversarial verification and repair; uncommitted)

**Acceptance: VERIFIED WITH EXPLICIT BLOCKERS.** This is an evidence handoff, not a release approval. Branch `rev17-verification-handoff`, HEAD `efd9cdc3785fc73652f7fc7d816c5b3496858db4`; main and remote checkpoint unchanged. No commit/push/merge/rebase/deploy or user/historical-artifact deletion.

**Baseline independently reproduced:** initial syntax/unit gates and Edit browser 19/19; initial unit 246/246. Initial Voice browser reached seven checks but failed to exit naturally in five minutes and was terminated; that is FAILED, not a reproduced baseline success. Later fresh individual and chained runs exit naturally. No work associated with `task_84f411c2` was found in the inspected tree/branches/history. Rev 17 reports above remain historical reports.

**Confirmed repairs:** D-009 through D-026, eighteen defects. Full reproduction, severity, root cause, repair and validation: `output/rev18/BUGS.md`. They cover alpha feather preservation; escaped JSON redaction and encoded-image integrity; decoded stage ordering; missing/invalid Drama profiles and exact-line scope; truthful Create/Batch progress and poll ownership; browser fixture/lifecycle ownership and DOM timing; touch targets; coherent speech attenuation; remote raw-log retention; delivery-direction privacy; Detailer modal focus/progress/async ownership; actual-pixel zoom below Fit; rejected staged-source cleanup. D-026 was discovered in the final resweep: invalid imported Inpaint left a PNG working copy. Rejected img2img/Inpaint/Outpaint now remove their working copies; successful jobs retain normal ownership. Three live rejected requests and the actual helper regression establish this repair.

**Fresh final gates (v13, after D-026):** `npm run check` exit 0; `npm test` **259/259**, zero skips, exit 0; individual Edit **21/21**, Voice/Drama **7/7**; chained **21/21 + 7/7**, all natural exit 0. Final browser runs used existing installed Brave through `DEX_BROWSER_PATH=/Applications/Brave Browser.app/Contents/MacOS/Brave Browser`; default Chrome remains unchanged. Chrome v8/v9 watchdog failures, v10 fixture-timing failures and v12 native Vision timeout are preserved under `output/rev18/gates/`. The v12 detector timed out twice at `vision-begin` while ANECompilerService was busy; v13 native empty-target test passed without killing that service. This does not establish hand detection under a wedged Apple Neural Engine. Seven edited shell scripts passed `bash -n`; both requested Python compilations and `git diff --check` passed. `final-gates.json`, `final-static.json` and raw logs record actual exits.

**Runtime OBSERVED in this pass (not inferred from unit tests):**
- Create SD1.5 quantity 2: exact siblings, backend sampling 2/4 = 50% and subsequent UI Decoding. Saved source settings recalled into Edit while Create held different settings. Library, Edit, fullscreen and Enhance/Compare routes exercised on exact artifacts; exhaustive repeated entry-point provenance is still UNKNOWN.
- Real img2img canonical outputs `20261002-224850-img2img-img2img_20261002-224850.png` and post-repair `20261003-000619-img2img-img2img_20261003-000619.png`; latter fullscreen caption matched exact result. Non-square inpaint captured source-sized 512x384 mask with all 256 grayscale levels; outside a 17px boundary margin 188,518 pixels had zero changes. Outpaint +128 right produced 640x384 with no change in interior x=0..463 (48px overlap excluded).
- Detailer face/person/hand real UI runs completed on a portrait. Native detector matrix: 18 cases across three modes and portrait/multiple-landscape/none/square/edge/small; in-bounds source-sized masks and deterministic repeats. Outside-region evidence uses reconstructed deterministic masks, **not captured submitted masks**, with 17px margin; therefore exact submitted-mask preservation is not fully established. CPU default was exercised. All geometry/morphology controls are tested; full live post-repair 100%/pan/eraser/grow/shrink/blur/invert sequence remains BLOCKED by browser control.
- Kokoro preset, Qwen designed and synthetic-reference cloned profiles rendered actual audio. Multiple samples, active sample and removal exercised. Supported Qwen direction and honestly disabled Kokoro direction observed. Single-shot peak/RMS -8.79/-26.63 dBFS vs long-form -8.12/-26.16 dBFS after attenuation-only policy.
- 2,960-character Kokoro long-form: four chunks, actual chunk 3/4 progress, transfer/stitching, canonical `20261003-040341-kokoro-long-form.wav`, 212.873 seconds; lineage, playback, download and Library observed. Tag preservation/source boundaries/chunk failure attribution are test evidence; tag-bearing and forced-failure live renders remain UNKNOWN.
- Drama `dp-ac1d5a10`: two scenes, three speaker labels, four lines; parsing/editing/binding, line render, project resume, second take and active-take selection, pause, ambience, mono/stereo assembly, playback/download/Library. Stereo `20261003-033801-drama-rev18-runtime-evidence.wav`, 13.25 seconds, 48kHz. Saved state survived restart via API. Bound profile invalidation gave persistent BOB warning and HTTP 400 before creating a job. Scene-only render, live partial-failure/retry, true narration paragraph and line-speaker reassignment remain UNKNOWN.

**Responsive/interaction:** 12 screens x five requested viewports x V1/V2/V3 = **180** live matrix cells, no document horizontal overflow. Enabled button bounds and pane measurements covered **165** non-Studio cells; Studio's 15 cells cover document overflow only. Before D-015: Create 11, Models 16 and V2 Library 164 enabled buttons below 24px. After repair: measured minimum 32px desktop/44px phone. Main surfaces are covered, not every modal/popover at every viewport. Representative fullscreen Escape/focus and Detailer focus containment/return, and browser keyboard checks passed. Exhaustive overlap, selectors, typography and all modal keyboard combinations remain UNKNOWN. See `ui-matrix-summary.json` for limitations.

**Privacy:** final local scan 2,413 state/run/log files matched only explicitly saved Drama script and approved clone transcript. Remote scan 146 logs matched **four pre-repair** raw logs from this pass (Create/img2img/Inpaint/Outpaint); preserved as historical exposure, alongside untouched July evidence. Later saving-off generation uses no raw remote log and fresh canaries were absent from scanned artifacts. Thirteen canonical PNG metadata scans earlier had no canaries; those canonical PNGs later disappeared externally for UNKNOWN reason. No deletion was performed by this pass. Browser localStorage/sessionStorage inspection is BLOCKED by available read-only API. This is scoped evidence, not blanket privacy certification.

**Cleanup:** safely interrupted one owned generator; job failed validation, produced no canonical output, released lease and removed remote/staged inputs. Four-step retry succeeded once. Isolated SSH wrapper exit 255 established shell failure; fake-SSH tests cover bridge cleanup, but full live server transport-failure lifecycle remains UNKNOWN. Final remote probe: no matching owned generator, no DexDiffusion media temp, no recent staged PNG outputs. Final local lease owner null, waiting empty, no active jobs/staged working copies. No test-owned browser/supervisor process candidates. Normal server PID 19407 binds 127.0.0.1:31337 and is not an orphan.

**Remaining BLOCKED/UNKNOWN acceptance:** wedged-ANE hand detection (unsafe to force; observed transient native timeout retained); real LoRA resource rendering (no installed LoRA); browser storage; remaining exhaustive interaction/resource/preset/provenance and Drama/long-form failure cases listed above. The original canonical image set is currently absent (only the clearly named owned geometry fixture remains), preventing current image replay. Browser control repeatedly rejected visible fixture clicks after reload with a shadow-root check failure; post-repair actual-pixel zoom is verified by unit and browser suites, not final live UI. Create/img2img recipes were saved live; Inpaint/Outpaint preset round trips are test evidence only. Do not claim VERIFIED COMPLETE.

**Final resweep:** after D-026 and fresh gates, inspected changed production paths plus adjacent async/state/privacy/error/cleanup ownership. No additional confirmed defect in that inspected scope. Speculative risks and unexercised journeys are not promoted to defects. Evidence directory is additive; earlier failure logs retained.


## 2026-10-03 — Rev18 closure v17 (additive continuation)

Current branch rev17-verification-handoff, unchanged HEAD efd9cdc3785fc73652f7fc7d816c5b3496858db4; dirty repairs preserved, nothing committed or published. Six original acceptance blockers CLOSED with measured scope: full live Inpaint controls/current canonical/presets; real invalid-reference cases; tagged long-form success/chunk failure/retry; Drama scene/narration/reassignment/partial retry; actual isolated browser storage inspection; full server transport failure/remote cleanup. Hand behavior under a wedged Apple Neural Engine and exhaustive interaction matrix remain UNVERIFIED. No installed LoRA; real resource render remains environment blocked. Historical image disappearance/exposure logs retained.

D-027 is a browser progress-test sampling defect, repaired with a DOM MutationObserver without weakening stages or completion checks. No production source changed in this continuation. Final fresh gates: unit 259/259, Edit 22/22, Voice/Drama 8/8, chain 22+8; syntax/static checks pass. Earlier v14–v16 failures retained and explained in output/rev18/closure-v17-live-acceptance.md. Final diff-check receipt and hashes are additive.

Actual server fault hook forwarded ssh westcat, failing after real owned directory allocation. Terminal jobs produced no canonical failure artifacts, lease released; exact in-band markers prove six worker directories removed, four historical logs preserved. Normal console restored (PID 24747, loopback 31337), idle lease/no active jobs. Hook source/evidence retained; temporary hook removed. Current canonical Inpaint stored under /Users/andrew/images_made. Saved owned scene evidence project and two browser-local presets retained; unsaved retry project lost on restart with captured evidence preserved.

Current handoff: output/rev18/FINAL_REPORT.md, acceptance-blockers.md, closure-v17-live-acceptance.md, closure-v17-* receipts and checksum manifest. READY FOR REVIEW, not VERIFIED COMPLETE.
