# Operational State: Image_Gen / DexDiffusion

<!-- operational-state:metadata
{
  "schema_version": 1,
  "project_id": "image-gen-dexdiffusion",
  "project_name": "Image_Gen / DexDiffusion",
  "project_root": "/Users/andrew/Image_Gen",
  "artifact_path": "operator-console + sdcpp-workflow",
  "state_revision": 9,
  "last_updated": "2026-09-26",
  "current_baseline": {
    "identity": "main@5287abd plus preserved local modifications",
    "state": "current-baseline",
    "last_verified": "2026-09-25"
  },
  "scope_boundaries": [
    "DexDiffusion UI/API on MacBook and image-generation execution on Big Mac via ssh westcat"
  ],
  "linked_parent_state": null
}
-->

## 0. Current Accepted Architecture (cold-start summary, revision 6)

Operator guide: `DEXDIFFUSION.md`. Live facts: `bin/dexdiffusion status`, `GET /api/system-info`.

- **Verified primary path:** DexDiffusion (MacBook, `operator-console` on 127.0.0.1:31337) → `ssh westcat` → Big Mac MFLUX 0.20.0 → FLUX.2 Klein 4B 4-bit (`mlx-community/flux2-klein-4b-4bit`, model at `$HOME/Library/Caches/DexDiffusion/mflux/flux2-klein-4b-4bit`, runtime venv `$HOME/Library/Caches/DexDiffusion/mflux/venv` on the internal SSD; the wc2tb venv is a package-identical fallback) → PNG streamed back → `/Users/andrew/images_made`.
- **Mac launcher:** `/Applications/DexDiffusion.app`, bundle id `local.image-gen.wrapper`, a native WebKit wrapper window. Icon `Contents/Resources/DexDiffusion.icns` is built from `operator-console/public/dexdiffusion/uploads/grok_image_1775521844329.jpg`. Exactly one Dock tile. Clicking it runs `bin/dexdiffusion start` (reuses or starts a detached console) and loads the local UI. Quitting the app leaves the console running. Install/repair: `scripts/install-macos-app.sh`.
- **Secondary path (restored rev 6):** stable-diffusion.cpp `7f0e728` (Metal) at `$HOME/stable-diffusion.cpp/build/bin/sd-cli`, with SD1.5 (`$HOME/sdcpp-staging/models/v1-5-pruned-emaonly.safetensors`, CreativeML OpenRAIL-M) and Real-ESRGAN x4plus (`/Volumes/wc2tb/ImageGen/upscalers/RealESRGAN_x4plus.pth`, BSD-3-Clause). SDXL/Flux-fp8/custom targets are not restored and report `model-missing`.
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
- Current HEAD before this change: `5287abd`.
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
