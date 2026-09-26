# Operational State: Image_Gen / DexDiffusion

<!-- operational-state:metadata
{
  "schema_version": 1,
  "project_id": "image-gen-dexdiffusion",
  "project_name": "Image_Gen / DexDiffusion",
  "project_root": "/Users/andrew/Image_Gen",
  "artifact_path": "operator-console + sdcpp-workflow",
  "state_revision": 4,
  "last_updated": "2026-09-25",
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
- **VER-014:** Image route security (live): traversal, encoded traversal, absolute path, NUL, `.incoming-*`, symlink and unknown names all return 404.

## 6. Known Not Working

- **BRK-001 (resolved by VER-004..006):** No MFLUX generation path was installed or proven at the start of this change.
- **BRK-003 (history, kept):** Full-precision `black-forest-labs/FLUX.2-klein-4B` loaded from wc2tb HF cache hit `[METAL] Command buffer execution failed: GPU Timeout Error (kIOGPUCommandBufferCallbackErrorTimeout)` at step 0 (~56 s), and again during a `mx.eval(model.parameters())` prefault experiment (RSS climbed to ~10.6 GB). Prefault approach closed; worker script removed. The ~15 GB model remains cached on wc2tb, unused.
- **BRK-004 (resolved by VER-010):** UI progress label showed `NaN%`: the server sends `job.progress` as an object. Fixed via `DexClient.jobProgressPercent`.
- **BRK-002:** Prior local image-generation attempts in other runtimes did not establish a reliable working image path.

## 7. Implemented but Unverified

- **IMP-001 (R13: UNVERIFIED — RUNTIME ASSET ABSENT, rechecked 2026-09-25):** On Big Mac, `~/sdcpp-staging` is empty, there is no compiled `sd`/`sd-server` binary under `~/stable-diffusion.cpp`, `/Volumes/wc2tb/ImageGen` does not exist, and a bounded wc2tb search finds no SD1.5/SDXL checkpoints. The June asset cache points at those missing paths. No model or binary was acquired. SDCPP remote-image cleanup (`register_remote_ephemeral`) and server-side adoption of SDCPP run images are covered by static checks and unit tests but have not been exercised by a live SDCPP generation. `~/sdcpp-staging` on Big Mac is currently empty, so SDCPP targets could not be run.
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
| TEST | Routing + canonical storage + traversal + same-origin + progress + ephemerality + direct-script finalize | verified | `npm test` 37/37 | `tests/controlled-args.test.js`, `tests/canonical-images.test.js` | 2026-09-25 |
| VER-008 | Tailnet-only Serve | verified | serve status, curl over tailnet | `tailscale serve status --json` | 2026-09-25 |
| VER-010 | One durable image, none on Big Mac | verified | SHA search | bounded find + shasum | 2026-09-25 |

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
