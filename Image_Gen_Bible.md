# Image Gen Project Bible

## Bootstrap Prompt for Successor AI

Read `Image_Gen_Bible.md` first. Treat it as the authoritative append-only project state for the local `Image_Gen` repository unless direct repository inspection proves drift. Inspect the repository against this bible before substantive work. If anything has drifted, append a reconciliation note instead of rewriting prior entries. Continue work from the current state, append all future work additively, avoid rewriting prior entries, and use this bible plus the repository contents as the complete handoff source.

## Project Goal

Provide a local-only macOS/BigMac SDCPP image-generation workbench with an Automatic1111-style user experience while preserving the safety posture of the existing allowlisted command bridge.

## Scope

In scope:
- `operator-console/` Express localhost bridge and vanilla frontend.
- `sdcpp-workflow/` shell-script integration points.
- A1111-style Create, Batch/Sweep, Edit, Enhance, Library, Models, and System user flows.
- Honest feature gates for UI workflows that require backend scripts not currently present.

Out of scope for the 2026-06-21 UI pass:
- Adding actual SDCPP img2img, inpaint, outpaint, Hires Fix, upscaling, face restoration, LoRA scanning, VAE switching, hypernetwork browsing, or full PNG-info parsing unless new backend scripts/API support are implemented later.
- Exposing arbitrary shell execution.
- Public network binding.

## Constraints

- Keep Express bound to `127.0.0.1`.
- Use allowlisted backend endpoints only.
- Preserve prompt redaction default through `SDCPP_REDACT_PROMPTS=1` unless the user opts into prompt saving.
- Do not pretend unsupported A1111 features work; surface them as gated/blocked until backend support exists.
- Preserve existing SDCPP workflow scripts rather than deleting or rewriting them without need.

## Assumptions

- The source archive `/mnt/data/Image_Gen 3.zip` represents the current MacBook-local build at the time of this session.
- The current SDCPP backend can generate txt2img through existing scripts but lacks wrapper scripts for img2img/inpaint/outpaint/upscale/Hires Fix/model ecosystem management.
- A1111 parity should be approached as a product architecture plus staged backend enablement, not as fake UI toggles.

## Architecture / Design

- Frontend: vanilla HTML/CSS/JavaScript under `operator-console/public/`.
- Backend bridge: Node/Express in `operator-console/server.js`.
- Workflow scripts: `sdcpp-workflow/bin/*.sh`.
- Capabilities are centralized through `GET /api/capabilities`.
- Unsupported workflows are represented through `featureGates` and `POST /api/actions/unsupported`.
- Navigation is task-centered: Create, Batch / Sweep, Edit, Enhance, Library, Models, System.

## File Map

- `operator-console/server.js` — Localhost Express bridge, validation, capabilities, job execution, run discovery, safe file serving.
- `operator-console/public/index.html` — A1111-style workbench shell and screen markup.
- `operator-console/public/app.js` — Frontend state, capability hydration, form submission, gallery, feature gates, job polling.
- `operator-console/public/styles.css` — Dark workbench UI styling, responsive layout, accessible focus states.
- `operator-console/docs/a1111-workbench-implementation.md` — Implementation notes, supported vs gated feature list, validation notes, next backend work.
- `operator-console/README.md` — Updated launch, architecture, privacy, supported/gated feature summary.
- `Image_Gen_Bible.md` — This append-only ledger.

## Current State Summary

As of 2026-06-21, the operator console has been reframed as an A1111-style workbench. Existing txt2img, batch, server, verification, seed-test, job polling, run discovery, and safe file-serving workflows are wired to the existing SDCPP scripts. Missing A1111-class workflows are visible but capability-gated.

Validation performed:
- `node --check server.js` passed.
- `node --check public/app.js` passed.
- Local server smoke test for `GET /api/capabilities` passed after correcting the smoke-test expectation from `features` to the implemented key `featureGates`.

## Open Questions

- Which SDCPP build/API features are actually available on BigMac for img2img, inpaint, outpaint, upscaling, and advanced model overrides?
- Should parameter metadata be persisted even when prompt text is redacted, possibly with safe hashes/labels?
- Should the frontend remain vanilla or be migrated to a component framework once backend feature count grows?
- What local model/LoRA/VAE directory layout should the model discovery scripts scan?

## Chronological Ledger

### Entry 1 - A1111 Workbench UI/UX Upgrade

Summary:
- Rebuilt the uploaded Image_Gen operator console into an Automatic1111-style workbench UI with explicit capability gates for unsupported backend features.

Reason / Intent:
- The user requested implementation of the previously identified A1111-style UI/UX improvements: Create/Edit/Enhance/Library/Models/System IA, richer exposed generation controls, action-oriented library, model/network visibility, seed and batch controls, and visible surfaces for img2img/inpaint/outpaint/upscale/Hires Fix/X-Y-Z workflows.

Files Changed:
- `operator-console/server.js`
- `operator-console/public/index.html`
- `operator-console/public/app.js`
- `operator-console/public/styles.css`
- `operator-console/README.md`
- `operator-console/docs/a1111-workbench-implementation.md`
- `Image_Gen_Bible.md`

Commands Run:

```sh
rm -rf /tmp/imagegen_a1111 /mnt/data/image_gen_a1111_work
mkdir -p /tmp/imagegen_a1111
unzip -q '/mnt/data/Image_Gen 3.zip' -d /tmp/imagegen_a1111
cp -a /tmp/imagegen_a1111/Image_Gen /mnt/data/image_gen_a1111_work
```

```sh
cd /mnt/data/image_gen_a1111_work/operator-console
node --check server.js
node --check public/app.js
```

```sh
cd /mnt/data/image_gen_a1111_work/operator-console
( node server.js > /tmp/imagegen_a1111_server3.log 2>&1 & echo $! > /tmp/imagegen_a1111_server3.pid )
sleep 1
curl -fsS http://127.0.0.1:31337/api/capabilities > /tmp/imagegen_a1111_capabilities.json
python3 - <<'PY'
import json
p='/tmp/imagegen_a1111_capabilities.json'
with open(p) as f: data=json.load(f)
required=['app','backend','models','featureGates','samplers','schedulers']
missing=[k for k in required if k not in data]
assert not missing, missing
assert data['featureGates']['txt2img']['supported'] is True
assert data['featureGates']['img2img']['supported'] is False
print('capability smoke ok')
PY
kill $(cat /tmp/imagegen_a1111_server3.pid) >/dev/null 2>&1 || true
cat /tmp/imagegen_a1111_server3.log
```

Command Intent:
- Extracted the uploaded archive into a working directory.
- Validated JavaScript syntax for the rewritten bridge and frontend controller.
- Started the local server briefly and verified the capabilities endpoint returns expected workbench/capability-gate data.

Outputs Generated:
- `operator-console/docs/a1111-workbench-implementation.md`
- `Image_Gen_Bible.md`
- Planned package output: `/mnt/data/Image_Gen_A1111_Workbench_Upgrade.zip`

Decisions:
- Keep unsupported A1111 workflows visible but gated rather than hiding them or pretending they work.
- Use `featureGates` as the capability contract between backend and frontend.
- Preserve prompt redaction defaults and make prompt-saving opt-in.
- Expand dimension validation to multiples of 8 between 64 and 2048 instead of only 384/512.
- Keep the frontend vanilla for this pass to minimize dependency churn.

Bugs / Blockers:
- Initial capability smoke assertion expected key `features`; actual implemented key is `featureGates`. Corrected the test expectation and reran successfully.
- Full A1111 execution parity is blocked by missing SDCPP workflow scripts/API wrappers for img2img, inpaint, outpaint, Hires Fix, upscale, face restore, LoRA discovery, VAE switching, and X/Y/Z plot execution.

Correction:
- None to prior bible entries; this is the first entry.

State After Completion:
- Workbench UI and capability-gated backend bridge are implemented in the working copy.
- Syntax validation passed for `server.js` and `public/app.js`.
- `/api/capabilities` smoke test passed.
- Unsupported advanced workflows are explicitly marked as backend-missing in the UI.

Next Step / Handoff:
- Package the working copy into `/mnt/data/Image_Gen_A1111_Workbench_Upgrade.zip`.
- Next implementation phase should add real backend scripts for model discovery, img2img/inpaint/outpaint, Hires Fix/upscale, PNG-info recovery, and X/Y/Z plot orchestration.

---

### Entry 2 - A1111 Workbench Install to MacBook (2026-06-21)

Summary:
- Installed the A1111-style workbench from `Image_Gen_A1111_Workbench_Upgrade.zip` into the live `/Users/andrew/Image_Gen` project. Replaced the Dexter Walk UI/UX redesign (committed at 71bf480) with the capability-gated A1111 workbench architecture from the zip. Validated all acceptance criteria.

Reason / Intent:
- The upgrade zip was the output of Entry 1 (designed and smoke-tested in a ChatGPT/cloud session). The current repo's 71bf480 "Dexter Walk" commit had more elaborate UI but lacked the `/api/capabilities` / `featureGates` architecture. The upgrade restores the capability-gate contract so the frontend can honestly surface gated workflows.

Backup Created:
- `/Users/andrew/Image_Gen.backup-before-a1111-workbench-20260621-015246`

Files Copied from Zip (`/tmp/image_gen_a1111_upgrade/Image_Gen/`):
- `operator-console/server.js` — adds `/api/capabilities`, `featureGates`, `/api/actions/unsupported`
- `operator-console/public/index.html` — A1111-style nav: Create/Batch/Edit/Enhance/Library/Models/System
- `operator-console/public/app.js` — capability-hydrating frontend controller
- `operator-console/public/styles.css` — dark workbench CSS (minified)
- `operator-console/README.md` — updated architecture and feature summary
- `operator-console/docs/a1111-workbench-implementation.md` — new doc, was missing from current project
- `Image_Gen_Bible.md` — this file, created fresh from zip (Entry 1 was preserved, this appended)

Files Explicitly NOT Overwritten:
- `sdcpp-workflow/runs/` — preserved (contains live run data)
- `sdcpp-workflow/logs/` — preserved
- `sdcpp-workflow/state/` — preserved (contains `current-ports.env`)
- `sdcpp-proof-20260620-172600/` — preserved
- `operator-console/node_modules/` — preserved (npm install confirmed up-to-date)
- All `.env` files — none found in zip or project

Commands Run:

```sh
# Backup
cd /Users/andrew
ts=20260621-015246
cp -a Image_Gen "Image_Gen.backup-before-a1111-workbench-$ts"

# Unpack
rm -rf /tmp/image_gen_a1111_upgrade
unzip -q Image_Gen/Image_Gen_A1111_Workbench_Upgrade.zip -d /tmp/image_gen_a1111_upgrade

# File copy (selective — no runs/logs/state/node_modules)
cp "$S/operator-console/server.js" "$T/operator-console/server.js"
cp "$S/operator-console/public/index.html" "$T/operator-console/public/index.html"
cp "$S/operator-console/public/app.js" "$T/operator-console/public/app.js"
cp "$S/operator-console/public/styles.css" "$T/operator-console/public/styles.css"
cp "$S/operator-console/README.md" "$T/operator-console/README.md"
cp "$S/operator-console/docs/a1111-workbench-implementation.md" "$T/operator-console/docs/"
cp "$S/Image_Gen_Bible.md" "$T/Image_Gen_Bible.md"

# Dependency check
cd /Users/andrew/Image_Gen/operator-console
npm install   # result: up to date, 0 vulnerabilities

# Syntax checks
npm run check         # node --check server.js — PASS
node --check public/app.js  # PASS

# Server start + validation
node server.js &
curl -fsS http://127.0.0.1:31337/api/capabilities | python3 -c "..."
# capabilities smoke PASSED
curl -fsS http://127.0.0.1:31337/ | head -20
# HTML loads: title=SDCPP Workbench
```

Validation Results:
- `npm run check` (node --check server.js): PASS
- `node --check public/app.js`: PASS
- Server started: `SDCPP Workbench listening on http://127.0.0.1:31337`
- `/api/capabilities` returned valid JSON with all required keys: app, backend, models, featureGates, samplers, schedulers
- `featureGates.txt2img.supported = true` ✓
- `featureGates.img2img.supported = false` (correctly gated) ✓
- All 10 unsupported workflows correctly gated: xyzPlot, img2img, inpaint, outpaint, upscale, hiresFix, faceRestore, lora, textualInversion, hypernetworks
- HTML loads correctly, title "SDCPP Workbench"
- Backend status pill shows "Ready" (capabilities hydrated)
- Browser validation: Create/Batch/Edit/Enhance/Library/Models/System navigation confirmed
- Edit screen: img2img, Inpaint, Outpaint shown with "Backend missing" badges ✓
- Enhance screen: Hires Fix, Upscale/Extras, Face Restore, PNG Info shown with "Backend missing" badges ✓
- Privacy toggle (prompt redaction) visible in sidebar ✓
- Favicon 404 warning: benign — new HTML does not embed inline favicon (not a regression)
- Existing run/log/state data: confirmed intact

Unsupported / Backend-Gated Workflows:
- **img2img**: No workflow script or server bridge. Show: Edit → Image to Image → "Backend missing"
- **Inpaint**: No mask upload/editor endpoint. Show: Edit → Inpaint → "Backend missing"
- **Outpaint**: No canvas-extend script. Show: Edit → Outpaint → "Backend missing"
- **Hires Fix**: No second-pass generation bridge. Show: Enhance → Hires Fix → "Backend missing"
- **Upscale/Extras**: No upscale workflow script. Show: Enhance → Upscale/Extras → "Backend missing"
- **Face Restore**: No GFPGAN/CodeFormer equivalent. Show: Enhance → Face Restore → "Backend missing"
- **PNG Info**: Run manifests exist; PNG chunk recovery not implemented. Show: Enhance → PNG Info → "Backend missing"
- **X/Y/Z Plot**: No sweep script. Show: Batch/Sweep → X/Y/Z Plot → disabled, "Backend missing"
- **LoRA**: No LoRA discovery/injection bridge. (Gated via featureGates)
- **Textual Inversion / Hypernetworks**: No scanner. (Gated via featureGates)

Known Next Backend Work:
- `sdcpp-workflow/bin/sdcpp-img2img.sh` and `/api/actions/img2img` endpoint
- `sdcpp-workflow/bin/sdcpp-inpaint.sh` and mask upload endpoint
- `sdcpp-workflow/bin/sdcpp-upscale.sh` (Real-ESRGAN or equivalent)
- `sdcpp-workflow/bin/sdcpp-hires-fix.sh` (txt2img → upscale pipeline)
- `sdcpp-workflow/bin/sdcpp-xyz-plot.sh` and `/api/actions/xyz-plot`
- Model/LoRA/VAE directory scanner feeding `/api/capabilities` `models` and `networks` arrays
- PNG metadata chunk reader for PNG-info recovery

Decisions:
- Dexter Walk (71bf480) public files were replaced by the zip's A1111 workbench files because the Dexter Walk frontend had no capability hydration and the zip is the designated upgrade package.
- node_modules from zip were NOT copied; existing modules are identical (`up to date, 0 vulnerabilities`).
- `server-generate` route from Dexter Walk is not in upgrade server.js; generate-single/generate-batch handle all generation modes via the `mode` param.

State After Completion:
- Server at `http://127.0.0.1:31337` serves A1111-style workbench with capability gates.
- txt2img generation routes through existing SDCPP bridge scripts.
- All unsupported A1111 workflows visible and honestly gated.
- Backup at `/Users/andrew/Image_Gen.backup-before-a1111-workbench-20260621-015246`.

---

### Entry 3 - Backend Phase Unlock: Discovery, Metadata, XYZ Plot, Capability Probes (2026-06-21)

Summary:
- Implemented Phases 1–5 of the backend unlock plan. Added five new workflow scripts and five new server endpoints. Updated /api/capabilities to read from cached probe results.

Files Added:
- `sdcpp-workflow/bin/sdcpp-discover-assets.sh` — SSH probe of BigMac staging dirs, writes `state/assets-cache.json`
- `sdcpp-workflow/bin/sdcpp-read-run-metadata.sh` — CLI tool: reads local run directory, outputs JSON (run card, manifest, PNG chunks, metrics)
- `sdcpp-workflow/bin/sdcpp-xyz-plot.sh` — Orchestrates X/Y sweep (max 16 cells) calling SDCPP server directly via curl; writes `xyz-manifest.json`
- `sdcpp-workflow/bin/sdcpp-image-edit-capabilities.sh` — SSH probe of sd binary `--help` for img2img/inpaint flags, writes `state/image-edit-capabilities.json`
- `sdcpp-workflow/bin/sdcpp-upscale-capabilities.sh` — Local + remote probe for Real-ESRGAN, Pillow, GFPGAN, CodeFormer; writes `state/upscale-capabilities.json`

Files Modified:
- `operator-console/server.js` — Added: `ASSETS_CACHE`, `IMAGE_EDIT_CACHE`, `UPSCALE_CACHE` constants; `readJsonCache()`, `readPngTextChunks()` helpers; `GET /api/assets`, `POST /api/actions/discover-assets`, `GET /api/runs/:runId/metadata`, `POST /api/actions/xyz-plot`, `POST /api/actions/probe-image-edit`, `POST /api/actions/probe-upscale`; updated `GET /api/capabilities` to hydrate models/VAEs/networks/featureGates from JSON caches

New Endpoints:
- `POST /api/actions/discover-assets` — runs sdcpp-discover-assets.sh, populates assets-cache.json
- `GET /api/assets` — returns cached asset list (stale:true if cache missing)
- `GET /api/runs/:runId/metadata` — rich local metadata: run card, manifest, PNG tEXt/iTXt chunks, metrics.tsv rows, file list
- `POST /api/actions/xyz-plot` — validates params (max 16 cells, allowed axis types), spawns sdcpp-xyz-plot.sh
- `POST /api/actions/probe-image-edit` — spawns sdcpp-image-edit-capabilities.sh (SSH probe)
- `POST /api/actions/probe-upscale` — spawns sdcpp-upscale-capabilities.sh (local + SSH probe)

Updated featureGates (now supported=true without running probes):
- `xyzPlot` → supported, route `/api/actions/xyz-plot`
- `metadataReuse` → supported, route `/api/runs/:runId/metadata`
- `pngInfo` → supported, route `/api/runs/:runId/metadata`
- `discoverAssets` → supported, route `/api/actions/discover-assets`
- `probeImageEdit` → supported, route `/api/actions/probe-image-edit`
- `probeUpscale` → supported, route `/api/actions/probe-upscale`

Updated featureGates (conditional on running probes):
- `img2img` → reads from `state/image-edit-capabilities.json`; false until probe runs
- `inpaint` → reads from same; false until probe runs
- `upscale` → reads from `state/upscale-capabilities.json`; false until probe runs
- `hiresFix` → same cache
- `faceRestore` → same cache
- `lora` → reads lora count from assets cache; still false but count shown in reason

Design Decisions:
- `SDCPP_RUN_DIR_OVERRIDE` already existed in sdcpp-lib.sh (for benchmark scripts); XYZ plot does not need to use it — it makes its own curl calls per cell rather than invoking sub-scripts.
- XYZ plot calls SDCPP server API directly (curl, same logic as sdcpp-server-generate.sh) to avoid cross-script run-dir conflicts.
- Capability caches are JSON files in `state/` — plain read, no shell execution, no SSH for each page load.
- readPngTextChunks() in server.js is pure Node.js Buffer operations (no child_process), handles both tEXt and iTXt PNG chunks.
- Probe scripts print `==== PASS ====` even when remote tools are absent; PASS means "probe completed" not "tools found."
- SSH heredocs use single-quoted `<<'REMOTE'` throughout so `$HOME` expands on BigMac.
- Bash 3.2 compatibility maintained: no mapfile, no associative arrays, CSV parsing via `IFS=',' set --`.

Validation Performed:
- `node --check server.js` → PASS
- `node --check public/app.js` → PASS
- `bash -n` on all five new scripts → all PASS
- Server smoke: `GET /api/capabilities` — all required keys present, all newly-unlocked gates show supported=true
- `GET /api/assets` pre-discovery → stale=true, empty lists (correct)
- `GET /api/runs/:runId/metadata` on existing run → files/images/run_card populated, png_info={} (verify run has no images)
- `POST /api/actions/xyz-plot` 5×4=20 cells → 400 "Total cells (20) exceeds limit of 16" ✓
- `POST /api/actions/xyz-plot` invalid x_type → 400 "Invalid x_type" ✓
- `POST /api/actions/xyz-plot` valid 2-cell job → 200 job_id returned ✓
- `POST /api/actions/discover-assets` → job_id returned ✓
- Existing routes unbroken: generate-single, /api/runs, /api/actions/unsupported ✓

Still Gated (not unblocked this session):
- img2img/inpaint: probe script exists; actual workflow script (`sdcpp-img2img.sh`) not written — needs img2img confirmed on BigMac first
- outpaint: blocked upstream (no SDCPP CLI support)
- upscale/hiresFix/faceRestore: probe script exists; actual scripts not written — needs tools confirmed on BigMac first
- lora/textualInversion/hypernetworks: asset counts now discoverable; injection bridge not implemented

Next Steps:
- Run `POST /api/actions/discover-assets` with BigMac tunnel up to populate asset cache
- Run `POST /api/actions/probe-image-edit` and `POST /api/actions/probe-upscale` to populate capability caches
- If img2img probe shows supported=true: write `sdcpp-workflow/bin/sdcpp-img2img.sh` and `/api/actions/img2img` endpoint
- If upscale probe shows supported=true: write `sdcpp-workflow/bin/sdcpp-upscale.sh` and `/api/actions/upscale` endpoint
- Hook up XYZ plot UI in app.js (Batch/Sweep screen) and wire discover-assets + probe buttons in System/Models screen

---

## Entry 4 — Backend Unlock Audit and Hardening (2026-06-21)

**Session type:** Security/correctness audit — no new features added.
**Constraint:** All 10 hard constraints from prior sessions remain in effect.

### Bugs Found and Fixed

**1. Privacy leak — `requestParams` exposed raw prompts**
`GET /api/jobs/:jobId` returned the raw `prompt` and `negative_prompt` in `requestParams` even when `save_prompts: false`. Confirmed with canary `PRIVACY_CANARY_XYZ_DO_NOT_STORE_926431` — it appeared verbatim in the API response. Fixed by adding `sanitizeRequestParams(params, savePrompts)` helper in `server.js` and applying it at all three `createJob()` call sites (generate-single, generate-batch, xyz-plot). Post-fix canary test: `CANARY LEAKED: False`. Canary not found in runs/, state/, or operator-console/.

**2. Feature gate overclaiming — img2img/inpaint/upscale/hiresFix/faceRestore**
Injecting a fake probe cache with `supported: true` caused `/api/capabilities` to report `img2img.supported=true` with a route that does not exist. Fixed: all five probe-conditional gates are capped at `supported: false`. Probe cache results now only inform the `reason` string, never elevate `supported`. This is a hard invariant: `supported` can only be `true` when a workflow script AND an endpoint both exist and have been validated.

**3. Feature gate overclaiming — pngInfo and xyzPlot**
Both were set to `supported: true` but neither has full end-to-end validation. Fixed: `pngInfo → 'partial'` (only run images can be queried, not arbitrary uploads); `xyzPlot → 'partial'` (infrastructure exists but requires BigMac tunnel and hasn't been validated with real images).

**4. PNG readFileSync unbounded**
`readPngTextChunks()` called `fs.readFileSync()` with no size limit. Fixed: added `PNG_CHUNK_READ_LIMIT = 20 * 1024 * 1024` constant and `fs.statSync` pre-check.

**5. PNG path traversal via `primary_image`**
`primary_image` field from run card YAML frontmatter was trusted directly when building a file path for PNG chunk reading. A crafted run card could escape the run directory. Fixed: `path.resolve(runPath, primaryRaw)` + `path.relative(runPath, resolved)` containment check — rejects any path where `relative` starts with `..` or is absolute.

**6. XYZ plot COL tracking bug (2D grids)**
For a 2×2 grid (x="1,2", y="7,8"), `COL = CELL_INDEX % x_count + 1` produced `COL=1` for both x-values on the second x-iteration because `CELL_INDEX=2` at that point and `2 % 2 = 0`. All four cells received duplicate labels (`r1c1`, `r2c1` twice), causing output PNGs to overwrite each other. Fixed: introduced independent `X_INDEX` counter that increments once per x-value, decoupled from CELL_INDEX.

**7. y_count double-counting (cleanup)**
`sdcpp-xyz-plot.sh` computed y_count by first counting from 1, then resetting and recounting from 0 — two loops for no reason. Simplified to a single loop from 0. No behavioral change.

### Validation Results

| Check | Result |
|---|---|
| `bash -n` on all 5 new scripts | PASS |
| `node --check server.js` | PASS |
| `node --check public/app.js` | PASS |
| `/api/capabilities` gate values | PASS — img2img/inpaint/upscale/hiresFix/faceRestore all false; xyzPlot/pngInfo partial |
| `/api/assets` (no cache) | PASS — returns stale=true, empty arrays |
| Privacy canary (save_prompts=false) | PASS — requestParams shows [REDACTED], canary not in filesystem |
| BigMac identity (`ssh westcat whoami && hostname`) | PASS — bigmac/bigmac confirmed |
| `POST /api/actions/discover-assets` | PASS — 1 checkpoint found, 0 VAEs/LoRAs |
| `POST /api/actions/probe-image-edit` | PASS — img2img: false (SD binary not found on remote) |
| `POST /api/actions/probe-upscale` | PASS — upscale: true (Pillow locally); realesrgan: false; faceRestore: false |

### Probe Findings

**discover-assets (BigMac):** 1 checkpoint (`v1-5-pruned-emaonly.safetensors`, 4.0 GB, active). No VAEs, LoRAs, embeddings, or hypernetworks in staging dirs.

**probe-image-edit:** SD binary not found at expected paths (`$BUILD_DIR/bin/sd`, `$BUILD_DIR/sd`). Therefore `--init-img`/`--strength`/`--control-image` flags not detected. `img2img.supported = false` confirmed. **Implication:** `sdcpp-img2img.sh` cannot be implemented via CLI flags path until SD binary is locatable. May need server-mode img2img via OpenAI API endpoint if SDCPP server exposes it.

**probe-upscale (local + remote):** Local: python3 ✓, Pillow ✓, convert ✓, ffmpeg ✓. Remote: python3 ✓, realesrgan ✗, gfpgan ✗, codeformer ✗, upscale_api ✓ (SDCPP server likely has `/sdapi/v1/extra-single-image`). A basic Pillow-based 2x Lanczos upscale script is feasible. `hiresFix` two-pass pipeline is also feasible. `faceRestore` is not feasible without GFPGAN/CodeFormer.

### Current Feature Gate Summary (post-audit)

| Feature | supported | Notes |
|---|---|---|
| txt2img | true | Working, validated |
| batch | true | Working, validated |
| xyzPlot | partial | Script+endpoint exist; not end-to-end validated with real images |
| pngInfo | partial | Run-image chunks only; no arbitrary upload |
| img2img | false | SD binary not found on remote; server-mode path unclear |
| inpaint | false | Same blocker as img2img |
| upscale | false | Pillow tools exist but sdcpp-upscale.sh not written yet |
| hiresFix | false | Feasible (txt2img → Pillow upscale); script not written |
| faceRestore | false | No GFPGAN/CodeFormer on remote |
| assetBrowser | partial | Cache populated; UI browser not wired |

### Next Safe Feature to Implement

**Option A (recommended): Pillow upscale script** — `sdcpp-workflow/bin/sdcpp-upscale.sh` using local Pillow for 2x Lanczos, plus `/api/actions/upscale` endpoint. Clear prerequisites met, no SD binary dependency, useful immediately with existing run images.

**Option B: XYZ plot end-to-end validation** — Run a real 2-cell XYZ sweep with BigMac tunnel up, validate output images and manifest, then promote gate from `partial` to `true`.

**Option C: Fix SD binary discovery** — Update `sdcpp-image-edit-capabilities.sh` to also search `$HOME/sdcpp-staging/build/` and `$HOME/sdcpp-staging/` subdirs, or add a `sd_bin_path.txt` sentinel file to BigMac staging.

---

## Entry 5 — Local Pillow Upscale Implementation (2026-06-21)

**Session type:** Feature implementation. Option A from Entry 4's next-steps was implemented in full.

### Summary

Implemented a complete local Pillow-based upscale workflow:
- New shell script: `sdcpp-workflow/bin/sdcpp-upscale.sh`
- New Express endpoint: `POST /api/actions/upscale`
- New capabilities: `pillowUpscale: true`, `upscale: 'partial'`
- New Enhance UI: real working Pillow Upscale panel + "Send to Upscale" on gallery cards

This feature is described correctly as "local Pillow resize upscale". It is NOT Real-ESRGAN, GFPGAN, CodeFormer, face restoration, or A1111 Extras parity.

### Files Changed

- `sdcpp-workflow/bin/sdcpp-upscale.sh` — NEW script
- `operator-console/server.js` — new `/api/actions/upscale` endpoint, capabilities update, job field additions
- `operator-console/public/app.js` — Pillow Upscale form, `sendToUpscale()`, gallery "Upscale" buttons
- `operator-console/public/index.html` — Enhance screen Pillow Upscale panel
- `Image_Gen_Bible.md` — this entry

### Script Specification

`sdcpp-workflow/bin/sdcpp-upscale.sh`:
- Runs locally on MacBook. No SSH. No inference. No prompt fields.
- Accepts `--path <run-id>/<image>` or `--run-id <run-id> --image <relative>`
- Gate: reject absolute paths → gate `path-absolute`
- Gate: reject `..` traversal → gate `path-traversal` / `image-traversal`
- Gate: reject non-PNG → gate `input-extension`
- Gate: reject source > 30 MB → gate `input-size`
- Gate: scale must be 2, 3, or 4 → gate `scale`
- Gate: resample must be nearest/bilinear/bicubic/lanczos → gate `resample`
- Gate: source dimensions max 4096 → gate `source-dimensions`
- Gate: output dimensions max 4096 → gate `output-dimensions`
- Gate: no overwrite without `--overwrite` → gate `overwrite`
- Gate: Pillow must be importable → gate `pillow`
- Output: `<run-dir>/upscaled/<base>-upscale-<N>x-<resample>.png`
- Writes: `upscaled/upscale-manifest.json` (schema v1), `upscaled/upscale-report.md`
- Prints: `UPSCALED_IMAGE: <run-id>/upscaled/<file>.png`
- Prints: `UPSCALE_MANIFEST: <run-id>/upscaled/upscale-manifest.json`
- Manifest fields: schema, source_run_id, source_image, output_image, scale, resample, source_width, source_height, output_width, output_height, output_bytes, status, created_at, first_failed_gate
- NO prompt or negative_prompt fields in manifest
- `bash -n` passes. No mapfile, no declare -A. bash 3.2 compatible.

### Endpoint Specification

`POST /api/actions/upscale`:
- Accept `{ path: "run-id/image.png" }` or `{ runId, image }`
- Validate: no absolute paths, no traversal, no non-alphanumeric/dash/slash/dot
- Containment check: `path.resolve(RUNS_DIR, upscalePath)` vs `RUNS_DIR`
- Allowlist scale: 2, 3, 4
- Allowlist resample: nearest, bilinear, bicubic, lanczos
- Spawn via argument array (`shell: false`)
- `requestParams` stored: `{ path, scale, resample }` — no prompt fields
- Job response includes: `upscaledImage`, `upscaleManifest` parsed from stdout

### Capabilities

```
pillowUpscale: { supported: true, route: '/api/actions/upscale', reason: 'Local Pillow resize upscale...' }
upscale:       { supported: 'partial', route: '/api/actions/upscale', reason: 'Local Pillow resize available... Real-ESRGAN not implemented.' }
hiresFix:      { supported: false }
faceRestore:   { supported: false }
img2img:       { supported: false }
inpaint:       { supported: false }
```

### Validation Commands and Results

```
# Script syntax check
bash -n sdcpp-workflow/bin/sdcpp-upscale.sh  → OK

# Node syntax checks
node --check operator-console/server.js  → OK
node --check operator-console/public/app.js  → OK

# Direct script test
cd sdcpp-workflow
bin/sdcpp-upscale.sh --path "20260620-232537-cli/sd15_cli_20260620-232537.png" --scale 2 --resample lanczos
→ PASS
→ UPSCALED_IMAGE: 20260620-232537-cli/upscaled/sd15_cli_20260620-232537-upscale-2x-lanczos.png
→ SOURCE_SIZE: 512x512
→ OUTPUT_SIZE: 1024x1024
→ OUTPUT_BYTES: 948566

# File verify
file runs/20260620-232537-cli/upscaled/sd15_cli_20260620-232537-upscale-2x-lanczos.png
→ PNG image data, 1024 x 1024, 8-bit/color RGB, non-interlaced
ls -lh → 926K

# Endpoint test
POST /api/actions/upscale {"runId":"20260620-182521-server-gen","image":"openai.png","scale":2,"resample":"lanczos"}
→ job_id: 7e84ca3c-c591-4b92-a0a7-8418d7d79530
→ status: PASS
→ upscaledImage: 20260620-182521-server-gen/upscaled/openai-upscale-2x-lanczos.png
→ upscaleManifest: 20260620-182521-server-gen/upscaled/upscale-manifest.json

# Output verify
file openai-upscale-2x-lanczos.png → PNG image data, 1024 x 1024, 8-bit/color RGB, non-interlaced
ls -lh → 967K
```

### Security Test Results

| Test | Expected | Result |
|---|---|---|
| `--path /tmp/evil.png` (absolute) | FAIL path-absolute | PASS (FAIL path-absolute) |
| `--path ../secret.png` (traversal) | FAIL path-traversal | PASS (FAIL path-traversal) |
| `--run-id x --image ../../state/y` (image traversal) | FAIL image-traversal | PASS (FAIL image-traversal) |
| `--scale 99` | FAIL scale | PASS (FAIL scale) |
| `--resample evil` | FAIL resample | PASS (FAIL resample) |
| `--path run/ui-run-card.md` (non-PNG) | FAIL input-extension | PASS (FAIL input-extension) |
| POST with `/tmp/evil.png` | 400 | 400 "Absolute paths are not accepted" |
| POST with `../secret.png` | 400 | 400 "Path traversal is not allowed" |
| POST with scale 99 | 400 | 400 "scale must be 2, 3, or 4" |
| POST with resample evil | 400 | 400 "resample must be: nearest, bilinear, bicubic, lanczos" |

### Privacy Canary

Canary: `PRIVACY_CANARY_UPSCALE_DO_NOT_STORE_384219`
Upscale involves no prompts; canary would only appear if somehow injected.
```
grep -R "PRIVACY_CANARY_UPSCALE_DO_NOT_STORE_384219" runs/ state/ operator-console/ → no matches
```
CLEAN. Manifest does not contain prompt or negative_prompt fields.

### Still Gated

- img2img: false (SD binary not found on remote)
- inpaint: false (same)
- outpaint: false (no SDCPP upstream support)
- hiresFix: false (Pillow upscale exists now; two-pass script not yet written)
- faceRestore: false (no GFPGAN/CodeFormer on remote)
- Real-ESRGAN / A1111 Extras parity: not implemented
- LoRA injection: not implemented

### Gates Unlocked This Session

- `pillowUpscale: true` — full local Pillow resize upscale, validated end-to-end
- `upscale: 'partial'` — represents Pillow partial support; AI parity gated

### Next Recommended Steps

1. **Run index endpoint** (`GET /api/run-index`) — fast paginated run history with upscale status
2. **Surface upscaled outputs in Library** — show derived outputs, "Upscaled" badge, per-run upscale section
3. **Asset discovery UI** — show checkpoint/LoRA/VAE counts, "Run discovery" button on Models screen
4. **XYZ plot UI hardening** — client-side validation, cell count limit display, honest partial labeling
5. **HiresFix script** — use Pillow upscale as the upscale step in a two-pass txt2img → upscale pipeline
6. **Capability status panel** — System screen shows gates grouped by status with action buttons

---

## Entry 6 — Backlog A–E: Run Index, Upscaled Library, Asset Discovery UI, XYZ Plot UI, System Gates (2026-06-21)

**Session type:** Feature expansion (backlog items A–E). All committed as one unit after shared validation pass.

### Summary

Five backlog items implemented as clean additions on top of the Pillow Upscale commit (Entry 5).

### Files Changed

- `operator-console/server.js` — added `GET /api/run-index` endpoint with 8s in-memory cache
- `operator-console/public/app.js` — run-index integration in gallery, `viewUpscaledOutputs()`, `runDiscoverAssets()`, `renderSystemGates()`, XYZ form wiring, Pillow Upscale form wiring, `derived-badge` on gallery cards
- `operator-console/public/index.html` — Models screen asset discovery UI, real XYZ Plot form (Batch/Sweep panel), System screen capability gates list, Enhance screen Pillow Upscale panel
- `operator-console/public/styles.css` — `.derived-badge` CSS class
- `Image_Gen_Bible.md` — this entry

### Backlog A — Run Index Endpoint (`GET /api/run-index`)

- Scans `sdcpp-workflow/runs/` safely (no shell, no unbounded reads)
- Returns per-run: id, type, status, title, primaryImage, imageCount, hasUpscaled, hasManifest, hasMetadata, createdAt
- Sorted newest first; max 500 runs (configurable via `limit` query param, default 100)
- In-memory cache with 8s TTL; cache always built to `RUN_INDEX_MAX` so slice works correctly
- Does not read prompt text from run cards; no raw prompts exposed
- Tolerates malformed run dirs via per-entry try/catch
- Validated: `total: 85`, 2 upscaled runs correctly flagged `hasUpscaled: true`

### Backlog B — Upscaled Outputs in Library

- Gallery now loads `/api/run-index` alongside `/api/runs` for `hasUpscaled` flag
- Run cards show green `Upscaled ✓` derived badge when upscaled outputs exist
- "View upscaled" button on tagged cards: opens first upscaled PNG in preview, logs all upscaled paths
- "Upscale" button on all image cards sends run+image to Enhance → Pillow Upscale form
- Upscaled images (under `upscaled/`) excluded from source-image selectors

### Backlog C — Asset Discovery UI (Models screen)

- Asset cache status line shows: missing / age in minutes / discovered-at date
- Checkpoint count, VAE count rendered from capabilities
- LoRA / Embedding / Hypernetwork counts shown from asset cache; labeled "visibility only"
- "Discover assets" button wired to `POST /api/actions/discover-assets`; polls job, refreshes capabilities on PASS
- Injection bridge intentionally gated

### Backlog D — XYZ Plot UI Hardening (Batch/Sweep screen)

- Old disabled placeholder XYZ panel replaced with real form
- Axis dropdowns: steps, cfg, sampler, seed, width, height
- Live cell-count display: "Cells: N / 16"
- Client-side validation: empty X values, Y values without Y type, total cells > 16 all caught before submission
- Server-side validation still enforces same limits (defense in depth)
- Feature labeled "Partial" in the UI; caveat text honest about BigMac tunnel requirement
- Form wired to `POST /api/actions/xyz-plot`; uses existing job polling

### Backlog E — Capability Status Panel (System screen)

- System screen now shows capability gates grouped: ✓ Supported / ⚡ Partial / ✗ Gated
- Each gate shows label, route (if any), reason/caveat text
- System screen action grid expanded with: Probe img2img, Probe upscale, Discover assets buttons
- `renderSystemGates()` called on every `loadCapabilities()` refresh

### Validation

| Test | Result |
|---|---|
| `GET /api/run-index?limit=200` — total 85, 2 upscaled | PASS |
| `GET /api/run-index?limit=5` — returns 5, total still 85 | PASS |
| XYZ endpoint with 5×4=20 cells | REJECTED: "Total cells (20) exceeds limit of 16" |
| `POST /api/actions/upscale` 3×bicubic via runId form | PASS — 1152×1536 PNG |
| node --check server.js | OK |
| node --check public/app.js | OK |

### Still Gated (unchanged from Entry 5)

img2img, inpaint, outpaint, hiresFix, faceRestore, Real-ESRGAN, LoRA injection, VAE switching.

### Next Recommended Steps

1. **Hires Fix script** — two-pass: txt2img at draft size → Pillow upscale → second txt2img pass. Pillow upscale now exists as a local tool.
2. **XYZ end-to-end validation** — run a real 2-cell sweep with BigMac tunnel, verify output PNGs, promote gate from `partial` to `true`.
3. **Fix SD binary discovery** — update `sdcpp-image-edit-capabilities.sh` to search more paths; required before img2img can be implemented.
4. **Run detail view** — dedicated panel showing run metadata, images, upscaled outputs, and manifest in one place.

---

## Entry 7 — Hardening pass: injection fix, firstFailedGate, gitignore, docs, packaging

**Date:** 2026-06-21
**Session type:** Autonomous hardening (Dexter Walk)

### Summary

QA found a direct-script Python injection bug in `sdcpp-upscale.sh`, incorrect `firstFailedGate` parsing in `server.js`, broken `.gitignore` quotes, a tracked proof symlink, and stale docs claiming upscale was gated. All issues fixed, validated, and pushed.

### Fixed: Python injection in sdcpp-upscale.sh

**Root cause:** The path containment check and file-size checks used `python3 -c "... '$RUN_ID' ... '$IMAGE_REL' ..."` — shell expansion of user-controlled values into Python source code.

**Fix applied:**
1. Tightened `RUN_ID` validation to allowlist `A-Za-z0-9_-` only (using `tr -d` for bash 3.2 compatibility).
2. Tightened `IMAGE_REL` validation to allowlist `A-Za-z0-9._/-` only.
3. Replaced `python3 -c` containment check with heredoc passing `$RUN_ID` and `$IMAGE_REL` via `sys.argv` — no shell interpolation into Python source.
4. Replaced `python3 -c "import os; print(os.path.getsize('$INPUT_FULL'))"` with `wc -c < "$INPUT_FULL"`.
5. Same replacement for `$OUT_FULL`.

**Malicious regression test:**
```sh
bin/sdcpp-upscale.sh --run-id "x'));open('PWNED','w').write('1');#" --image "image.png" --scale 2 --resample lanczos
# Result: First failed gate: run-id
# PWNED file: NOT created
find /Users/andrew/Image_Gen -name PWNED -print → (empty)
```

**All other security gates:**
- Absolute path `/etc/passwd` → `path-absolute` FAIL
- Traversal `../../etc/passwd` → `path-traversal` FAIL
- Invalid scale `99` → `scale` FAIL
- Invalid resample `evil` → `resample` FAIL
- Image with bad chars `a;echo PWNED.png` → `image-chars` FAIL

### Fixed: firstFailedGate parsing in server.js

**Root cause:** `runAction` close handler only searched `job.stdout` for `FAIL:`. The `fail()` function in `sdcpp-lib.sh` writes `First failed gate: <gate>` to **stderr**. The pattern `/FAIL:\s*/` also would not match `==== FAIL ====`.

**Fix:** Extended the close handler to search `combined = job.stdout + job.stderr` for `/First failed gate:\s*(.+)/` with priority over the old `FAIL:` fallback. Also check combined for `==== FAIL ====` when setting job status.

**Proof:**
```sh
POST /api/actions/upscale { "path": "nonexistent-run-abc123/image.png", ... }
# Job result: "firstFailedGate": "run-dir"   ← was null before
```

### Fixed: .gitignore

- Removed broken quoted entry `"Potential UI/"` — the quotes made it ineffective.
- Added unquoted: `Potential UI/`
- Added: `oc-a1111-*.png`, `latest-sdcpp-proof-env`, `sdcpp-proof-*/.proof-env`, `Image_Gen_*.zip`, `__MACOSX/`
- Removed tracked symlink: `git rm latest-sdcpp-proof-env`

**Verify:**
```
.gitignore:59  Potential UI/ matches "Potential UI/ChatGPT Image Jun 20, 2026, 07_42_34 PM (1).png"
.gitignore:56  oc-a1111-*.png matches oc-a1111-edit-screen.png
.gitignore:63  sdcpp-proof-*/.proof-env matches sdcpp-proof-20260620-172600/.proof-env
.gitignore:62  latest-sdcpp-proof-env matches itself
.gitignore:66  Image_Gen_*.zip matches Image_Gen_A1111_Workbench_Upgrade.zip
```

### Docs updated

- `operator-console/README.md` — rewrote to reflect supported/partial/gated reality including Pillow upscale, run-index, and asset discovery.
- `operator-console/docs/a1111-workbench-implementation.md` — full rewrite to match current state including security posture, upscale details, and firstFailedGate note.
- `sdcpp-workflow/docs/command-reference.md` — appended entries for all new scripts: `sdcpp-upscale.sh`, `sdcpp-discover-assets.sh`, `sdcpp-image-edit-capabilities.sh`, `sdcpp-upscale-capabilities.sh`, `sdcpp-read-run-metadata.sh`, `sdcpp-xyz-plot.sh`.
- `sdcpp-workflow/QUICKSTART.md` — appended sections 8 (Operator Console) and 9 (Pillow upscale).

### Added: scripts/package-source.sh

Clean source packaging using `git archive HEAD` — produces `/tmp/Image_Gen_source_<ts>.zip` containing only tracked source files. Validation:
```
bash scripts/package-source.sh
# clean package ok (no forbidden paths)
# Size: 210K  SHA256: e505695...
```

### Added: operator-console/scripts/smoke-check.sh

12-test regression script requiring no images, no BigMac, no model files:
```
PASS  node --check server.js
PASS  node --check public/app.js
PASS  bash -n sdcpp-upscale.sh
PASS  bash -n sdcpp-discover-assets.sh
PASS  bash -n sdcpp-xyz-plot.sh
PASS  GET /api/capabilities responds
PASS  GET /api/run-index?limit=5 responds
PASS  Upscale rejects absolute path (HTTP 400)
PASS  Upscale rejects traversal path (HTTP 400)
PASS  Upscale rejects invalid scale (HTTP 400)
PASS  XYZ plot rejects >16 cells (HTTP 400)
PASS  GET /api/run-index?limit=99999 capped and returns runs array
12/12 PASS
```

### Code slop check

The QA report mentioned duplicate `--preset` push in xyz-plot and duplicate `model:` key in app.js. Grep confirms neither exists in current code — they were cleaned in the prior session.

### Direct script upscale proof

```sh
bin/sdcpp-upscale.sh --path "20260620-232537-cli/sd15_cli_20260620-232537.png" --scale 2 --resample lanczos --overwrite
# SOURCE_SIZE: 512x512 → OUTPUT_SIZE: 1024x1024 → OUTPUT_BYTES: 948566
# file output: PNG image data, 1024 x 1024, 8-bit/color RGB
# ==== PASS ====
```

### Endpoint upscale proof

```sh
POST /api/actions/upscale {"path":"20260620-232537-cli/sd15_cli_20260620-232537.png","scale":2,"resample":"lanczos","overwrite":true}
# job status: PASS
# upscaledImage: "20260620-232537-cli/upscaled/sd15_cli_20260620-232537-upscale-2x-lanczos.png"
# upscaleManifest: "20260620-232537-cli/upscaled/upscale-manifest.json"
```

### Privacy proof

Canary: `PRIVACY_CANARY_HARDENING_DO_NOT_STORE_762118`
```
grep -R "PRIVACY_CANARY_HARDENING_DO_NOT_STORE_762118" sdcpp-workflow/runs sdcpp-workflow/state operator-console
→ no matches
```
Upscale `requestParams` contains only `{ path, scale, resample }` — no prompt or negative_prompt fields.

### Console state

- PID: 57121
- URL: http://127.0.0.1:31337
- Log: /tmp/operator-console.log

### Files changed

- `sdcpp-workflow/bin/sdcpp-upscale.sh` — injection fix, strict validation
- `operator-console/server.js` — firstFailedGate parsing fix
- `.gitignore` — fixed quoted entry, added missing patterns, removed tracked symlink
- `operator-console/README.md` — full rewrite reflecting current state
- `operator-console/docs/a1111-workbench-implementation.md` — full rewrite
- `sdcpp-workflow/docs/command-reference.md` — appended new script entries
- `sdcpp-workflow/QUICKSTART.md` — appended Operator Console and upscale sections
- `scripts/package-source.sh` — new clean packaging script
- `operator-console/scripts/smoke-check.sh` — new regression smoke check

### Still gated

- img2img, inpaint, outpaint
- Hires Fix (two-pass script not yet written)
- Face Restore (GFPGAN/CodeFormer not installed on BigMac)
- Real-ESRGAN / A1111 Extras parity
- LoRA injection, VAE switching
- Textual inversion execution, hypernetwork execution

### Next recommended step

Write `sdcpp-workflow/bin/sdcpp-hires-fix.sh` — a two-pass txt2img → Pillow upscale workflow. All prerequisites exist (txt2img works, Pillow upscale validated). Unlocks `hiresFix: true`.

---

## Entry 8 — Backlog validation and post-hardening state

**Date:** 2026-06-21
**Session type:** Autonomous Dexter Walk (continued)

### Summary

Post-hardening validation of Backlog items A-E. All items either confirmed correct from previous session or validated as part of hardening unit.

### Backlog A — Regression smoke check: DONE

`operator-console/scripts/smoke-check.sh` added in Entry 7. 12 tests all PASS:
```
node --check server.js/app.js, bash -n on all 3 scripts, all 5 endpoint rejection tests,
limit=99999 cap test — 12/12 PASS
```

### Backlog B — Package source validation: DONE

`scripts/package-source.sh` added in Entry 7. Uses `git archive HEAD`, verifies no forbidden paths.
```
bash scripts/package-source.sh
# clean package ok (no forbidden paths)
# Size: 210K  SHA256: e505695902b7549e74309fe042606532784bfea76a2c43a63512a2b6871ee5f6
```

### Backlog C — Run-index bounds: ALREADY CORRECT

Current implementation:
- `Number(req.query.limit) || 100` — NaN from non-numeric defaults to 100
- `Math.min(N, RUN_INDEX_MAX)` — caps at 500
- Tests: limit=99999 returned 85 (capped), limit=bad returned 85 (defaulted), no-limit returned 85

No changes needed.

### Backlog D — System diagnostics: ALREADY CORRECT

`renderSystemGates()` in app.js groups capability gates from `/api/capabilities/featureGates` into:
- ✓ Supported: txt2img, batch, server, gallery, metadataReuse, discoverAssets, probeImageEdit, probeUpscale, **pillowUpscale**
- ⚡ Partial: xyzPlot, pngInfo, upscale (AI/Extras)
- ✗ Gated: img2img, inpaint, outpaint, hiresFix, faceRestore, lora, textualInversion, hypernetworks

Was implemented in Entry 6. No changes needed.

### Backlog E — Documentation final sweep: DONE in Entry 7

README, implementation doc, command-reference, QUICKSTART all updated in Entry 7. Memory file updated with commit hashes, startup command, full feature table, and security constraints.

### Console state

- PID: 57121 (restarted from 49245 to pick up server.js changes)
- URL: http://127.0.0.1:31337
- Log: /tmp/operator-console.log

### Next best step

Write `sdcpp-workflow/bin/sdcpp-hires-fix.sh`:
- Pass 1: txt2img at target-size / 2 (e.g. 256×256 or 512×512 for a 1024 target)
- Pass 2: `sdcpp-upscale.sh --path <run-id>/<image.png> --scale 2 --resample lanczos`
- Unlocks `hiresFix: true` in featureGates
- All prerequisites exist: txt2img validated, Pillow upscale validated and hardened

---

## Entry 9 — Hires Fix: two-pass txt2img → Pillow upscale

**Date:** 2026-06-21
**Session type:** Autonomous Dexter Walk (continued from Entry 8)

### Summary

Implemented the real Hires Fix two-pass workflow: txt2img via SSH to BigMac → local Pillow upscale. Not full A1111 latent Hires Fix (no denoising second pass), but a validated end-to-end workflow producing a resolution-doubled PNG.

### What was built

**Script:** `sdcpp-workflow/bin/sdcpp-hires-fix.sh`
- Pass 1: `sdcpp-cli-generate.sh` with `SDCPP_RUN_DIR_OVERRIDE` → writes `base/base.png`
- Pass 2: `sdcpp-upscale.sh --run-id <id> --image base/base.png --scale N --resample R`
- Outputs: `hires-fix-manifest.json`, `hires-fix-report.md`, `ui-run-card.md` in run dir
- Security: no shell interpolation of user values, bash 3.2 compatible, strict arg validation
- Privacy: `SDCPP_REDACT_PROMPTS` honored via write_ui_run_card; prompt never in manifest
- **Bug fixed:** bash 3.2 printf rejects format strings starting with `-`; use `printf '%s\n' "- text: ..."` instead

**Backend:** `operator-console/server.js`
- `POST /api/actions/hires-fix` endpoint added (validates prompt, preset, scale, resample)
- Parses `HIRES_RUN_ID:`, `HIRES_BASE_IMAGE:`, `HIRES_FINAL_IMAGE:`, `HIRES_MANIFEST:` from stdout
- `hiresGate` updated: `supported: true`, route: `/api/actions/hires-fix`
- `inferRunType` updated: `-hires-fix` suffix → `['hires-fix', 'Hires Fix']`

**UI:** `operator-console/public/index.html` + `app.js`
- Hires Fix form panel added to Enhance screen (right column)
- Fields: prompt, preset, seed, scale factor, resample filter
- `hiresFix` removed from `enhanceFeatures` gate cards (has its own panel now)
- Poll tracks `job.hiresFinalImage`, renders preview on PASS

**Smoke check:** Updated to include `bash -n sdcpp-hires-fix.sh` and two Hires Fix rejection tests (missing prompt → 400, invalid scale → 400). Now 15/15 PASS.

### End-to-end proof

```
Run ID: 20260621-113847-hires-fix
Preset: smoke  Seed: 424242
Pass 1: 512×512 PNG (sha256 local=remote) ← BigMac SSH
Pass 2: 1024×1024 PNG (Pillow lanczos)
Privacy canary: NOT stored in any run artifact
==== PASS ====
```

Proof artifacts:
- `runs/20260621-113847-hires-fix/base/base.png` — 512×512
- `runs/20260621-113847-hires-fix/upscaled/base-upscale-2x-lanczos.png` — 1024×1024
- `runs/20260621-113847-hires-fix/hires-fix-manifest.json`
- `runs/20260621-113847-hires-fix/ui-run-card.md` (`run_type: "hires-fix"`, `status: "PASS"`)
- `sdcpp-proof-20260621-113846/.proof-env`

### Smoke check (post-update)

```
bash operator-console/scripts/smoke-check.sh
# 15/15 PASS
```

### Capabilities

Hires Fix promoted from `supported: false` → `supported: true`:
```json
"hiresFix": {
  "supported": true,
  "route": "/api/actions/hires-fix",
  "reason": "Two-pass txt2img → local Pillow upscale. NOT full A1111 latent Hires Fix — no denoising second pass."
}
```

### Out-of-scope blockers confirmed

All advanced paths remain blocked (no new model files staged):
- SDXL Turbo: no checkpoint on BigMac
- Flux: no ae.safetensors / CLIP-L / T5XXL staged
- img2img: SD binary not found
- Real-ESRGAN / face restore: not on BigMac

Next: document blocker decision memo (`operator-console/docs/advanced-feature-decision.md`), then final sweep.

---

## Entry 10 — Gate card UI improvement + decision memo

**Date:** 2026-06-21
**Session type:** Autonomous Dexter Walk — Unit 9G/10

### Summary

Two small but impactful improvements after Hires Fix (Entry 9):

**Gate card UI (Unit 9G):**
- Feature gate badges now colored: green (supported), yellow (partial), red (blocked)
- Blocked features show "To unlock:" section with specific BigMac requirements
- `unlock_requires` field added to server.js featureGates for: img2img, inpaint, faceRestore, lora
- `featureCard()` in app.js updated to render `unlock_requires` if present

**Advanced feature decision memo (Unit 8):**
- `operator-console/docs/advanced-feature-decision.md` written with evidence-based blocker analysis
- All advanced paths (SDXL Turbo, Flux, img2img, Real-ESRGAN, face restore) confirmed blocked
- Priority order documented: SDXL Turbo first once checkpoint staged, then img2img, Flux, Real-ESRGAN

### Commits

- `9b33aba` — feat: Hires Fix two-pass workflow
- `677e885` — docs: evidence-based advanced feature decision memo
- `b5bfa40` — feat: improve feature gate cards

### Console state

- URL: http://127.0.0.1:31337
- Log: /tmp/operator-console.log
- Smoke check: 15/15 PASS

---

## Entry 11 — Hires Fix hardening pass (2026-06-21)

### What changed

**UNIT 1 — Tighten `POST /api/actions/hires-fix` validation (server.js)**

All optional parameters now run through existing validators before use:
- `mode`: defaults to `cli`; any other value → HTTP 400.
- `api` param: rejected with HTTP 400 if present and non-empty (CLI mode only).
- `steps`: `validateIntRange(steps, 1, 150)`.
- `cfg_scale` / `cfg`: `validateFloatRange(val, 1, 30)`.
- `width` / `height`: `validateSize(val)`.
- `sampler`: `validateSampler(val)`.
- `seed`: `validateSeed(val)` then passed as `String(body.seed)` — preserves `"random"` and `"fixed"` strings instead of the previous `String(Number(body.seed))` which silently turned `"random"` → `"NaN"`.

`/api/jobs/:jobId` response now includes `hiresRunId`, `hiresBaseImage`, `hiresFinalImage`, `hiresManifest` fields (were missing despite the parse logic already setting them on the job object).

**UNIT 2 — Manifest schema upgrade (sdcpp-hires-fix.sh)**

`hires-fix-manifest.json` now follows `sdcpp.hires_fix.v1`:
- `schema: "sdcpp.hires_fix.v1"`, `status`, `mode`, `api: null`, `preset`, `seed`.
- `base_width`, `base_height`, `final_width`, `final_height` (numeric, parsed from `WxH` strings).
- `elapsed_seconds` (float, computed from `START_EPOCH` captured at script start via `now_epoch()`).
- `cleanup_state: "none"`, `first_failed_gate: null`.

`START_EPOCH="$(now_epoch)"` added immediately after `load_config`.
`ELAPSED_SECONDS=$(elapsed_seconds "$START_EPOCH" "$(now_epoch)")` computed just before manifest write.
Python manifest uses `sys.argv` exclusively — no shell interpolation into Python source.

**UNIT 3 — Run index + metadata fix (server.js)**

`buildRunIndex()`:
- `hasManifest` check now includes `hires-fix-manifest.json` alongside `batch-manifest.json`, `xyz-manifest.json`, `upscale-manifest.json`.
- `imageCount` now counts PNGs in `base/` and `upscaled/` subdirs one level deep (hires-fix runs have no top-level PNGs).

`/api/runs/:runId/metadata` manifest candidates list extended with `upscale-manifest.json` and `hires-fix-manifest.json`.

**UNIT 4 — Stale Generate-page copy (index.html)**

Line 85 fineprint updated: no longer says "Hires Fix … requires new backend scripts." Now correctly notes that latent Hires Fix (A1111-style, single-pass) is not yet on the Generate screen, and points to the Enhance screen for two-pass Hires Fix.

**UNIT 5 — Decision memo priority order (advanced-feature-decision.md)**

Priority rewritten to: 1. SDXL Turbo, 2. Flux Schnell, 3. SDXL base, 4. img2img, 5. LoRA/VAE, 6. Real-ESRGAN/Face Restore, 7. Inpaint/Outpaint.

### Validation

- `bash -n sdcpp-hires-fix.sh` → OK
- `node --check server.js`, `node --check app.js` → OK
- Smoke check: **15/15 PASS** (including `==== PASS ====`)
- Endpoint rejection tests: **11/11 PASS**
  - mode=api, mode=server, api param, steps=9999, cfg=999, width=13, sampler=evil, seed="injection; rm -rf" → all HTTP 400
  - seed=random, seed=fixed, seed=42 → HTTP 200
- Privacy canary: clean (no `PRIVACY_CANARY_HIRES_POLISH_DO_NOT_STORE_530921` in runs/state/operator-console)
- Package: clean (no forbidden paths)

### Commits

See commit following this entry.

---

## Entry 12 — SDXL Turbo / Flux model staging foundation (2026-06-21)

### What changed

**Hires Fix validation-only endpoint**
- Extracted Hires Fix request normalization into `normalizeHiresFixBody(body)` in `operator-console/server.js`.
- `POST /api/actions/hires-fix` now reuses that helper and preserves current generation semantics.
- Added `POST /api/validate/hires-fix` for dry-run validation without creating a job or spawning generation.
- Validation response returns normalized safe fields and redacts `prompt` / `negative_prompt` unless `save_prompts` is true.

**Model staging**
- Added `operator-console/docs/model-staging-sdxl-turbo-flux.md`.
- Added `sdcpp-workflow/bin/sdcpp-model-stage-check.sh`.
- Added `GET /api/model-stage`.
- Added `POST /api/actions/check-model-stage`.
- Added `modelStage` and `featureGates.sdxlTurbo`, `featureGates.flux`, `featureGates.sdxl` to `/api/capabilities`.
- Updated the Models screen with `Check BigMac model stage`, external root status, SDXL Turbo target, Flux component targets, and docs pointer.

**Packaging / executable guardrails**
- `operator-console/scripts/smoke-check.sh` now checks executable bits for key scripts and warns if missing.
- `scripts/package-source.sh` now refuses a dirty worktree by default because it packages `HEAD` only, supports `--allow-dirty`, and supports `--output /path/file.zip`.

**Docs**
- Updated `operator-console/README.md`.
- Updated `operator-console/docs/a1111-workbench-implementation.md`.
- Updated `operator-console/docs/advanced-feature-decision.md`.
- Updated `sdcpp-workflow/docs/command-reference.md`.
- Updated `sdcpp-workflow/QUICKSTART.md`.
- Updated `sdcpp-workflow/docs/next-escalation-plan.md`.
- Updated `sdcpp-workflow/docs/ui-integration-contract.md`.

### Model staging targets

External root:

```text
/Volumes/wc1tb/Ai/Image_Gen/sdcpp-models
```

First SDXL Turbo target:

```text
/Volumes/wc1tb/Ai/Image_Gen/sdcpp-models/checkpoints/sdxl-turbo/sd_xl_turbo_1.0_fp16.safetensors
```

Flux official targets:

```text
/Volumes/wc1tb/Ai/Image_Gen/sdcpp-models/flux/flux1-schnell/flux1-schnell.safetensors
/Volumes/wc1tb/Ai/Image_Gen/sdcpp-models/flux/shared/ae.safetensors
```

Flux also accepts staged stable-diffusion.cpp-compatible GGUF or quantized candidates if the BigMac binary proves the flags.

### Validation so far

- `node --check operator-console/server.js` — PASS
- `node --check operator-console/public/app.js` — PASS
- `npm run check` — PASS
- `bash -n operator-console/scripts/smoke-check.sh` — PASS
- `bash -n sdcpp-workflow/bin/sdcpp-model-stage-check.sh` — PASS
- `bash -n scripts/package-source.sh` — PASS
- `operator-console/scripts/smoke-check.sh` — 32 PASS / 0 FAIL
- `GET /api/capabilities` — PASS, includes `modelStage` and SDXL Turbo / Flux gates.
- `GET /api/model-stage` — PASS, reads cache.
- `POST /api/validate/hires-fix` — PASS for seed `random`; prompt redacted.
- Privacy canary `PRIVACY_CANARY_MODEL_STAGE_DO_NOT_STORE_883140` — no matches in `sdcpp-workflow/runs`, `sdcpp-workflow/state`, or `operator-console`.

### BigMac result

Route gate:

```text
bigmac
bigmac
/Users/bigmac
ProductName: macOS
ProductVersion: 26.5.1
BuildVersion: 25F80
```

`bin/sdcpp-model-stage-check.sh` result:
- FAIL at `external-root`.
- Cache written to `sdcpp-workflow/state/model-stage-cache.json` (ignored runtime state).
- `route_ok: true`
- `wc1tb_mounted: false`
- `root_exists: false`
- `write_test: fail`
- SDXL Turbo candidates: none
- Flux candidates: none
- stable-diffusion.cpp help summary found local BigMac binary and observed `metal: true`, `flux: true`; `safetensors: false`, `gguf: false` from current help grep.

This is not a code failure. It means `/Volumes/wc1tb` is not mounted or unavailable to the BigMac SSH context, so model staging cannot be proven yet.

### Server state

- URL: `http://127.0.0.1:31337`
- Active validation server was started from `/Users/andrew/Image_Gen/operator-console` with `node server.js`.
- PID at validation time: see final report; re-check with `lsof -nP -iTCP:31337 -sTCP:LISTEN`.

### Staged / unstaged state

Before commit, changed source files are the implementation, docs, smoke check, package script, new staging guide, new staging script, and this Bible entry. Runtime cache under `sdcpp-workflow/state/` remains ignored and must not be committed.

### Next command for successor

After Andrew mounts or makes `/Volumes/wc1tb` available on BigMac:

```sh
cd /Users/andrew/Image_Gen/sdcpp-workflow
bin/sdcpp-model-stage-check.sh
```

If SDXL Turbo or Flux files are then present, inspect BigMac `sd-cli --help` before writing any smoke script. Do not download models automatically.

## 2026-06-21 wc2tb canonical root migration

Canonical model home moved to:

```text
/Volumes/wc2tb/ImageGen
```

Route and volume checks on BigMac passed before the move:

```text
bigmac
bigmac
/Users/bigmac
ProductName: macOS
ProductVersion: 26.5.1
BuildVersion: 25F80
```

Current audit artifacts:

```text
/Volumes/wc2tb/ImageGen/manifests/model-move-result-final.md
/Volumes/wc2tb/ImageGen/manifests/model-inventory-20260621-132829.json
/Volumes/wc2tb/ImageGen/manifests/model-move-plan-20260621-132829.md
```

Final move audit summary:

- 41 model files now live under `/Volumes/wc2tb/ImageGen`
- Families staged there: `controlnet`, `checkpoints/sd15`, `checkpoints/sdxl`, `checkpoints/sdxl-turbo`, `flux/flux1-schnell`, `flux/shared`, `loras`, `upscalers`, `vaes`
- Current inventory snapshot after the move: 204 candidates, 19 high-confidence, 18 medium-confidence, 167 low-confidence, 1 skipped
- The inventory is conservative. Remaining high-confidence items still exist outside the new root and should be handled separately, not auto-consumed

Validation run after the migration:

- `bash -n sdcpp-workflow/bin/sdcpp-model-inventory-wc2tb.sh` - PASS
- `bash -n sdcpp-workflow/bin/sdcpp-model-stage-check.sh` - PASS
- `node --check operator-console/server.js` - PASS
- `node --check operator-console/public/app.js` - PASS
- `bash -n scripts/package-source.sh` - PASS

The operator console now points at `/Volumes/wc2tb/ImageGen`, exposes the inventory action, and reads the refreshed inventory cache. Runtime caches under `sdcpp-workflow/state/` are still ignored, which is correct.

---

## Entry 9 — wc2tb inventory reconciliation and packaging hardening

**Date:** 2026-06-21
**Session type:** Workflow hardening and inventory reconciliation

### Summary

Cleaned up the wc2tb model-home migration after `66560f3`:

- `scripts/package-source.sh` no longer trips `141` from the `unzip -l | head` pipe under `pipefail`.
- `sdcpp-workflow/bin/sdcpp-model-stage-check.sh` now reports non-ready model-root states as `PARTIAL` instead of `FAIL`.
- `sdcpp-workflow/bin/sdcpp-model-inventory-wc2tb.sh` and the operator console now surface the remaining high-confidence review set and the recommended next step.

### Validation

- `bash /Users/andrew/Image_Gen/scripts/package-source.sh --allow-dirty` → PASS
  - Output: `/tmp/Image_Gen_source_20260621-140913.zip`
  - SHA256: `c723fe37e30b3a4624607b2cd96058085cacdfbe8c67601a290b9510368d075f`
  - Forbidden-path scan: clean
- `bash /Users/andrew/Image_Gen/sdcpp-workflow/bin/sdcpp-model-stage-check.sh` → `PARTIAL`
  - Message: `Model root is usable, but required SDXL Turbo / Flux files are missing.`
- `bash /Users/andrew/Image_Gen/sdcpp-workflow/bin/sdcpp-model-inventory-wc2tb.sh --apply` → PASS
  - Candidates: `198`
  - High confidence: `13`
  - Moved: `0`
  - Live outcome: `2` duplicate skips, `12` missing-source skips
- `node --check /Users/andrew/Image_Gen/operator-console/server.js` → PASS
- `node --check /Users/andrew/Image_Gen/operator-console/public/app.js` → PASS
- `bash -n` on the edited shell scripts → PASS

### Inventory Notes

- The current high-confidence review set is still visible in the console.
- The remaining paths are all model assets outside the new root, but the apply pass did not move anything in this session because the live source paths were already missing or already staged as duplicates.
- Current canonical model home remains `/Volumes/wc2tb/ImageGen`.

---

## Entry 10 — Stage cache size fix, inventory refresh, and live priority shift

**Date:** 2026-06-21
**Session type:** Live inventory/staging repair

### Summary

Fixed the stage-check size detection so mounted BigMac model files no longer get serialized as zero-byte placeholders. The stage cache now reports the actual mounted-file sizes from the local MacBook side, and the capability summary reflects the live priority shift:

- SDXL base is staged and nonzero.
- SDXL Turbo is still blocked on the missing fp16 file; the 0B q6p/q8p placeholder is not a valid target.
- Flux is partial: model and VAE are staged, but CLIP-L and T5XXL are still missing unless the BigMac binary proves an embedded path.

The inventory cache was also refreshed so the remaining high-confidence review set is now empty after applying the already-existing moves and duplicate/missing-source skips.

### Validation

- `bash /Users/andrew/Image_Gen/sdcpp-workflow/bin/sdcpp-model-stage-check.sh` → `PARTIAL`
  - Message: `SDXL base is staged, but runtime smoke proof is still missing.`
- `bash /Users/andrew/Image_Gen/sdcpp-workflow/bin/sdcpp-model-inventory-wc2tb.sh --apply` → PASS
  - `remaining_high_confidence_outside_root`: `0`
  - `still_actionable_high_confidence_count`: `0`
  - `duplicate_skip_count`: `2`
  - `missing_source_skip_count`: `11`
- `GET /api/model-inventory` now returns the live cache again from the restarted Node server.
- `GET /api/capabilities` now reports `sdxlStagedState=true`, `sdxlTurboStagedState=missing`, `fluxStagedState=partial`.

### State After Completion

- SDXL base is the next best runtime proof target.
- SDXL Turbo remains blocked until the fp16 file is staged.
- Flux remains partial until CLIP-L/T5XXL are staged or the binary proves an embedded component path.
- The stage checker now rejects zero-byte and tiny placeholder files.

## Entry 15 — SDXL base smoke proof and gate promotion (2026-06-21)

This pass added the bounded SDXL base proof path and verified it on BigMac:

- `sdcpp-workflow/bin/sdcpp-sdxl-smoke.sh` — route-gated BigMac smoke that checks the staged SDXL base checkpoint is nonzero and larger than 1 GiB, probes the discovered `sd-cli` binary for required flags, runs a 512x512 / 4-step render, and writes `runs/<timestamp>-sdxl-smoke/{sdxl-smoke.png,sdxl-smoke-report.md,sdxl-smoke-manifest.json}` plus `state/sdxl-smoke-cache.json`.
- `sdcpp-workflow/bin/sdcpp-model-stage-check.sh` — now preserves the SDXL smoke proof when the dedicated proof cache exists, instead of losing it on the next stage scan.
- `operator-console/server.js` — `/api/capabilities` and `/api/model-stage` now read the smoke cache, and `featureGates.sdxl.supported` flips to `true` only after the bounded proof passes.
- `operator-console/public/index.html` / `operator-console/public/app.js` — added a `Run SDXL base smoke` action on the Models screen.
- `sdcpp-workflow/docs/command-reference.md`, `sdcpp-workflow/QUICKSTART.md`, `operator-console/docs/a1111-workbench-implementation.md`, `operator-console/docs/advanced-feature-decision.md` — updated to describe the dedicated SDXL proof path.

Validation:

- `bash /Users/andrew/Image_Gen/sdcpp-workflow/bin/sdcpp-sdxl-smoke.sh` → PASS
  - `sdxl-smoke.png` verified as a 512x512 PNG.
  - `state/sdxl-smoke-cache.json` written with `runtime_smoke_proven=true`, `png_valid=true`, and `prompt_redacted=true`.
- `curl -s http://127.0.0.1:31337/api/capabilities` → `modelStage.supportProven=true`, `featureGates.sdxl.supported=true`
- `featureGates.sdxlTurbo.supported=false` and `featureGates.flux.supported=false` remain unchanged.

## Entry 16 — Release-candidate wording hardening after SDXL smoke proof (2026-06-21)

This pass did not add new capabilities. It tightened the post-proof wording so the UI and release package continue to tell the truth about what `featureGates.sdxl.supported=true` means:

- `operator-console/public/app.js` — the Models screen now says `SDXL` is `staged; bounded smoke proof passed` when the proof cache exists, instead of leaving the stale `smoke proof required` wording on screen after the proof has already passed.

Verification:

- `node --check /Users/andrew/Image_Gen/operator-console/public/app.js` → PASS
- `node --check /Users/andrew/Image_Gen/operator-console/server.js` → PASS
- `bash -n /Users/andrew/Image_Gen/sdcpp-workflow/bin/sdcpp-sdxl-smoke.sh` → PASS
- `bash -n /Users/andrew/Image_Gen/sdcpp-workflow/bin/sdcpp-model-stage-check.sh` → PASS
- `git diff --check` → PASS

Residual scope:

- Turbo, Flux, img2img, inpaint, outpaint, LoRA injection, VAE switching, Real-ESRGAN, Face Restore, ControlNet, textual inversion, and hypernetworks remain blocked as before.

## Entry 17 — Release-candidate bug sweep and stale-claim cleanup (2026-06-21)

This pass did not add capabilities. It cleaned stale release-facing wording and bridge docs after the SDXL smoke proof landed:

- `operator-console/README.md` — added the explicit `POST /api/actions/sdxl-smoke` proof row and changed the SDXL language to say the bounded proof is separate from full A1111 parity.
- `sdcpp-workflow/README.md` — removed the blanket “not SDXL” claim and clarified that the bounded SDXL base proof is the only explicit exception to the routine inference rule.
- `operator-console/docs/model-staging-sdxl-turbo-flux.md` — updated the live-state section so SDXL base is described as proof-only and SDXL Turbo / Flux remain the next bounded targets.
- `operator-console/docs/a1111-workbench-implementation.md` — removed the stale “best next runtime proof target” wording for SDXL base and kept the proof-only limitation explicit.
- `operator-console/docs/command-bridge-safety.md` — documented the `POST /api/actions/sdxl-smoke` bridge route and its fixed proof-only prompt/model behavior.
- `sdcpp-workflow/docs/command-reference.md` — recorded that `bin/sdcpp-model-stage-check.sh` now preserves the SDXL smoke proof cache.

Verification:

- `find`/`grep` audits for stale paths and overclaims were rerun.
- `bash -n` passed for all shell scripts in the tree.
- `node --check` passed for `operator-console/server.js` and `operator-console/public/app.js`.
- `git diff --check` passed.

Residual scope:

- Historical handoff/proof Markdown intentionally still contains legacy or superseded context.
- No runtime outputs, caches, or release artifacts were committed.

## Entry 18 — Deep file sweep, audit lock, and release packaging pass (2026-06-22)

This pass is the current release-candidate sweep for the repo root at `/Users/andrew/Image_Gen`.
It adds the durable audit lock and the deep-sweep summary location so the next model has a
single, current source of truth instead of rediscovering the same boundaries:

- `docs/deep-audits/imagegen-ai-context-lock.md` — current operating constraints, package rules,
  model-path boundaries, and proof-only exceptions.
- `docs/deep-audits/imagegen-deep-file-sweep-20260622.md` — human-readable summary of the full file
  sweep and the release-risk notes that matter.
- `/tmp/imagegen_full_file_inventory.jsonl` — full file inventory emitted for every file in the
  tree, including tracked/untracked classification and package eligibility. Current counts:
  1,317 files total, 76 tracked, 1,241 ignored/untracked, 76 package-eligible.

Verification:

- Deep text audit rerun against project-owned docs, shell, JS, HTML, JSON, CSS, and ignore files.
- `bash -n` / `node --check` sanity checks remained clean for the maintained scripts and console code.
- Source packaging remains bounded by `scripts/package-source.sh` and its dirty-tree refusal by default.

Residual scope:

- Runtime outputs, caches, model files, screenshots, packaging archives, and server logs remain
  excluded from commits.
- Only the proof-only SDXL base smoke path is supported beyond the normal blocked-feature set.

## Entry 19 — Model acquisition blocked on Hugging Face authentication (2026-06-22)

This pass stopped before any model download because the local `hf` CLI is installed but not
authenticated, and no `HF_TOKEN` / `HUGGING_FACE_HUB_TOKEN` is present in the environment.

Observed gate:

- `hf version` → `1.4.1`
- `hf auth whoami` → `Not logged in`

Current status:

- `/Volumes/wc2tb/ImageGen` exists and BigMac identity is correct.
- `sd_xl_turbo_1.0_fp16.safetensors` is still missing.
- `flux1-schnell.safetensors`, `clip_l.safetensors`, and `t5xxl_fp16.safetensors` are still missing.
- The existing `flux1-schnell-fp8.safetensors` and `ae.safetensors` remain staged on BigMac.

Next action required:

- Authenticate Hugging Face locally with `hf auth login` or provide `HF_TOKEN`, then rerun the
  acquisition pass.

Residual scope:

- No model files were downloaded.
- No smoke scripts were created or run.
- No runtime caches or package artifacts were committed.

## Entry 20 — SDXL Turbo and Flux acquisition plus bounded smoke proofs (2026-06-22)

This pass completed the acquisition/proof loop for the next model gates. The user-facing
contract now matches the actual runtime behavior instead of the earlier staged-only state.

Acquired on `/Volumes/wc2tb/ImageGen`:

- `checkpoints/sdxl-turbo/sd_xl_turbo_1.0_fp16.safetensors`
- `flux/flux1-schnell/flux1-schnell.safetensors`
- `flux/shared/clip_l.safetensors`
- `flux/shared/t5xxl_fp16.safetensors`

Proof results:

- `bin/sdcpp-sdxl-turbo-smoke.sh` passed and wrote `state/sdxl-turbo-smoke-cache.json`
- `bin/sdcpp-flux-smoke.sh` passed and wrote `state/flux-smoke-cache.json`
- `bin/sdcpp-model-stage-check.sh` was updated to preserve the SDXL base, SDXL Turbo, and Flux proof caches
- `operator-console/server.js` now exposes `POST /api/actions/sdxl-turbo-smoke` and `POST /api/actions/flux-smoke`

Important runtime note:

- The current Flux proof uses `flux1-schnell-fp8.safetensors` because that is what the local
  stable-diffusion.cpp build accepts on BigMac. The full `flux1-schnell.safetensors` file was
  acquired, but it is not the file used for the successful smoke proof.

Verification:

- `bash -n` passed for the new smoke scripts.
- `bin/sdcpp-sdxl-turbo-smoke.sh` produced a verified 512x512 PNG.
- `bin/sdcpp-flux-smoke.sh` produced a verified 512x512 PNG.
- The console UI and API were updated to surface the new proof states.

Residual scope:

- Runtime caches and model files remain outside git, as required.
- The console still documents the Flux proof file choice explicitly so the full safetensors file is
  not overstated as runtime-proven.

## Entry 21 — Context lock corrected after Turbo and Flux proof (2026-06-22)

Entry 20 already recorded the Turbo / Flux acquisition and bounded smoke proof results, but
`docs/deep-audits/imagegen-ai-context-lock.md` still lagged behind that state. This correction
brings the durable lock back in line with the actual repository truth.

Updated context lock now states:

- SDXL base, SDXL Turbo, and Flux are all bounded proof-only paths
- `POST /api/actions/sdxl-smoke`, `POST /api/actions/sdxl-turbo-smoke`, and `POST /api/actions/flux-smoke` are proof-only
- Full Automatic1111 parity is not claimed for any of those paths
- The Flux runtime-proven file is the fp8 candidate, not the full `flux1-schnell.safetensors`
- Model files, runtime runs, smoke caches, logs, screenshots, zips, and generated artifacts remain outside git
- Clean packages still come only from `scripts/package-source.sh`

Verification:

- Updated the context lock and Bible correction note only; no model downloads or new smoke proofs were run.
- The repository remained on commit `fe4c4d5` at the start of this correction.

Residual scope:

- The durable lock now matches the proven runtime state.
- No feature surface changed.

## Entry 22 — Controlled generation allowlist for proofed targets (2026-06-22)

Summary:
- Added a closed controlled-generation path for SD1.5 standard, SDXL base, SDXL Turbo, and Flux fp8 so the Create screen can pick only the proofed targets without exposing arbitrary model paths.

Reason / Intent:
- The repo had proofed smoke paths, but the user wanted those proofed targets promoted into an explicit UI/API flow instead of leaving them implicit behind the smoke-only actions.

Files Changed:
- `operator-console/server.js`
- `operator-console/public/app.js`
- `operator-console/public/index.html`
- `sdcpp-workflow/bin/sdcpp-controlled-generate.sh`
- `docs/deep-audits/imagegen-ai-context-lock.md`
- `Image_Gen_Bible.md`

Verification:
- `node --check operator-console/server.js`
- `node --check operator-console/public/app.js`
- `bash -n sdcpp-workflow/bin/sdcpp-controlled-generate.sh`
- `git diff --check`

State After Completion:
- The Create flow now points at a closed allowlist and the durable docs call out that proof-only support still does not mean full Automatic1111 parity.

## Entry 23 — Controlled generation validation hardened (2026-06-22)

Summary:
- Tightened the controlled-generation API and shell driver so proofed targets stay bounded instead of accepting arbitrary model-path overrides or absurd `cfg` values.

Reason / Intent:
- The new controlled path had the right allowlist shape, but validation was still too permissive. That left a security-shaped hole and made the direct script unusable outside server-populated config state.

Files Changed:
- `operator-console/server.js`
- `sdcpp-workflow/bin/sdcpp-controlled-generate.sh`
- `sdcpp-workflow/bin/sdcpp-lib.sh`
- `docs/deep-audits/imagegen-ai-context-lock.md`
- `Image_Gen_Bible.md`

Verification:
- `node --check operator-console/server.js`
- `bash -n sdcpp-workflow/bin/sdcpp-lib.sh`
- `bash -n sdcpp-workflow/bin/sdcpp-controlled-generate.sh`
- Rejected `modelPath` injection and absurd `cfgScale` values with HTTP 400.
- Direct controlled generation passed for `sdxl-base`, `sdxl-turbo`, and `flux-fp8`.
- Privacy canary string did not persist in the controlled Turbo run tree.

State After Completion:
- Controlled generation remains proof-only, but the runtime now enforces the closed boundary instead of merely advertising it.

## Entry 24 — Controlled generation API/UI runtime proof and privacy fix (2026-06-22)

Summary:
- Proved the controlled-generation API and Create-screen selector end to end, then fixed prompt privacy so `save_prompts=false` no longer leaves prompt text in PNG metadata.

Reason / Intent:
- The bridge was wired, but it still needed live proof through `POST /api/actions/generate-controlled` and the Create screen. During that proof we also found that PNG metadata still carried prompts, so the privacy boundary had to be tightened.

Files Changed:
- `operator-console/server.js`
- `operator-console/public/app.js`
- `operator-console/public/index.html`
- `sdcpp-workflow/bin/sdcpp-controlled-generate.sh`
- `sdcpp-workflow/bin/sdcpp-lib.sh`
- `docs/deep-audits/imagegen-ai-context-lock.md`
- `Image_Gen_Bible.md`

Verification:
- Baseline commit: `e6a5929`
- API PASS:
  - `sdxl-base` job `7ec46a43-72bb-4f1a-ac38-a981f3e53787`, run `20260622-135959-controlled-sdxl-base`, PNG [`controlled-sdxl-base.png`](/Users/andrew/Image_Gen/sdcpp-workflow/runs/20260622-135959-controlled-sdxl-base/controlled-sdxl-base.png), manifest [`controlled-manifest.json`](/Users/andrew/Image_Gen/sdcpp-workflow/runs/20260622-135959-controlled-sdxl-base/controlled-manifest.json)
  - `sdxl-turbo` job `356b126a-7d65-44fc-922b-866ebf7a1a83`, run `20260622-140544-controlled-sdxl-turbo`, PNG [`controlled-sdxl-turbo.png`](/Users/andrew/Image_Gen/sdcpp-workflow/runs/20260622-140544-controlled-sdxl-turbo/controlled-sdxl-turbo.png), manifest [`controlled-manifest.json`](/Users/andrew/Image_Gen/sdcpp-workflow/runs/20260622-140544-controlled-sdxl-turbo/controlled-manifest.json)
  - `sd15` job `d8a812ea-10f1-4ef7-9c76-785f9b95222b`, run `20260622-142210-controlled-sd15`, PNG [`controlled-sd15.png`](/Users/andrew/Image_Gen/sdcpp-workflow/runs/20260622-142210-controlled-sd15/controlled-sd15.png), manifest [`controlled-manifest.json`](/Users/andrew/Image_Gen/sdcpp-workflow/runs/20260622-142210-controlled-sd15/controlled-manifest.json)
  - `flux-fp8` 512x512 job `03185841-93ab-4e76-858a-7c4b709b6d1b` failed with `remote-png` after BigMac Metal OOM
  - `flux-fp8` bounded proof retry job `d484c7d0-b548-478a-8166-9c083374b9c6`, run `20260622-142332-controlled-flux-fp8`, PNG [`controlled-flux-fp8.png`](/Users/andrew/Image_Gen/sdcpp-workflow/runs/20260622-142332-controlled-flux-fp8/controlled-flux-fp8.png), manifest [`controlled-manifest.json`](/Users/andrew/Image_Gen/sdcpp-workflow/runs/20260622-142332-controlled-flux-fp8/controlled-manifest.json)
- Privacy canary:
  - job `b9608ef4-fea6-44f4-82b6-b4d34b15ef2b`, run `20260622-144331-controlled-sdxl-turbo`
  - post-fix grep over `sdcpp-workflow/runs`, `sdcpp-workflow/state`, and `operator-console` found no `PRIVACY_CANARY_CONTROLLED_API_DO_NOT_STORE_195724` matches
  - existing runtime PNGs were normalized to strip metadata when prompt saving is off
- UI sanity:
  - Create screen selector exists
  - options include SD1.5, SDXL base, SDXL Turbo, and Flux fp8
  - no editable model path field is exposed
  - submit path is `/api/actions/generate-controlled`
  - controlled output fields are rendered in the latest-job card
- Rejection regression:
  - unknown target → 400
  - `modelPath` → 400
  - bad width → 400
  - bad steps → 400
  - bad cfg → 400
- Packaging:
  - final package path and SHA256 to be recorded after the last commit in this proof pass
- Final verdict:
  - partial API/UI proof achieved; the controlled bridge is real, but Flux 512x512 still hits Metal out-of-memory on this hardware, so Flux proof remains bounded to accepted smaller sizes.

State After Completion:
- The Create screen now drives the closed controlled-generation endpoint, and prompt privacy holds for newly produced redacted runs.

## Entry 25 — Library run detail and controlled-output polish (2026-06-22)

Summary:
- Added a run detail panel to the Library screen, filter bar, and hardened the `/api/runs/:runId/metadata` endpoint to load controlled-generation manifests and smoke manifests.

Reason / Intent:
- Post-proof cleanup: the controlled generation path was proven end-to-end, but the Library only showed run cards with image thumbnails and no way to inspect the generation parameters or manifest from within the UI.

Baseline commit: `c99e18c`

Files Changed:
- `operator-console/server.js` — `inferRunType` now covers controlled and smoke types; `/api/runs/:runId/metadata` loads all manifest types (controlled, hires_fix, upscale, batch, xyz, smoke variants); `buildRunIndex` now returns `filterCategory` and `controlledTargetLabel`; simpler `/api/runs/:runId` also loads all manifest types.
- `operator-console/public/app.js` — Added `state.libraryIndex`, `state.libraryFilter`; replaced `loadGallery`/`runCard` with `loadGallery`/`renderGallery`/`runIndexCard`; added `runTypeFilterMatch`, `showRunDetail`, `closeRunDetail`, `metaItem`; filter button event handling; detail overlay background click to close; `data-detail-run` click handler.
- `operator-console/public/index.html` — Library section expanded to include a filter bar (All / Controlled / SD1.5 / SDXL base / SDXL Turbo / Flux fp8 / Hires Fix / Upscale / Smoke proofs / Failed) and a `#run-detail-overlay` panel with back button, action row (copy ID, copy path, send to upscale, view manifest JSON), and `#run-detail-content` container.
- `operator-console/public/styles.css` — Added filter bar, filter-btn, run-type badges, run detail overlay/panel, meta grid, thumbnail strip, caveat box, failed gate notice, privacy badge styles.
- `Image_Gen_Bible.md` — this entry.

Endpoint changes:
- `GET /api/runs/:runId/metadata` now returns: `run_type`, `status`, `created_at`, `manifests` (all types keyed by type), `manifest` (primary for compat), `primary_image`, `first_failed_gate`, `filter_category`, `controlled_target_label`, `controlled_target_caveat`, `prompt_private`.
- `GET /api/run-index` now returns `filterCategory` and `controlledTargetLabel` per run entry.
- `GET /api/runs/:runId` (simple endpoint) now also loads controlled and smoke manifests.

Filters added:
- All, Controlled, SD1.5, SDXL base, SDXL Turbo, Flux fp8, Hires Fix, Upscale, Smoke proofs, Failed

Run detail panel features:
- Run type badge (colored by category)
- Status, created time, controlled target label, steps, CFG/guidance, seed, dimensions, elapsed time
- Primary image preview with thumbnail strip for multi-image runs
- Controlled generation caveat (including Flux fp8-specific wording)
- Smoke proof label for proof-only runs
- firstFailedGate notice for failed runs
- Prompt privacy state badge
- Manifest JSON expandable section
- Actions: Copy run ID, Copy image path, Send to Upscale, View manifest JSON (→ Job Log), Back to Library

Privacy audit:
- All recent controlled generation manifests show `prompt: "[REDACTED]"`.
- Canary phrase `PRIVACY_CANARY_LIBRARY_DETAIL_DO_NOT_STORE_804221` was not written to disk during this pass (not needed; no new generation was performed).
- `prompt_private` field correctly returns `true` for all redacted runs.
- `showRunDetail` never exposes raw prompt text from redacted runs (manifest shows `[REDACTED]`, prompt_private badge states redaction).
- Older pre-fix runtime artifacts (e.g. `20260620-211126-cli/run-metadata.json` with `"prompt": "dog"`) predate the privacy fix and are not committed.

Traversal rejection:
- `GET /api/runs/..%2F..%2Fetc%2Fpasswd/metadata` → 400 (safeRunId validation)

Validation commands:
- `node --check operator-console/server.js`
- `node --check operator-console/public/app.js`
- `bash -n` all shell scripts → all pass
- `bin/sdcpp-model-stage-check.sh` → PASS
- `bin/sdcpp-model-inventory-wc2tb.sh` → complete, 13 high-confidence candidates
- `operator-console/scripts/smoke-check.sh` → 32 PASS, 0 FAIL
- `curl /api/run-index?limit=10` → returns `filterCategory` and `controlledTargetLabel` per entry
- Traversal rejection → 400
- Metadata for SDXL Turbo, Flux fp8, SDXL base, SD1.5 controlled runs → all PASS, manifests loaded

Package:
- Pre-commit package: `/tmp/Image_Gen_library_detail_precommit.zip` (SHA256 matches baseline c99e18c since uncommitted)
- Final package after commit: `/tmp/Image_Gen_library_detail_final.zip` — to be recorded

Remaining limitations:
- Library currently loads from run-index only (no full `/api/runs` hydration), so runs without a `ui-run-card.md` have `primaryImage: null` in the grid.
- Flux smoke runs that lack a ui-run-card.md (e.g. early `flux-smoke` runs) show no image in the card.
- Full Automatic1111 parity is not claimed.
- Flux controlled generation is bounded by hardware (Metal OOM at 512×512 on some configs).

State After Completion:
- Library now has a filter bar and a full detail panel for all run types, with proper caveats for controlled/proof paths.

## Entry 26 — Library pagination and full-size image viewer (2026-06-22)

What changed:
- `GET /api/run-index` now accepts `limit` (default 50, max 200), `offset` (default 0), and `filter` parameters. Returns `{ items, total, limit, offset, nextOffset, hasMore, cachedAt }`. Unknown filter → 400. Server-side filtering replaces the client-side `runTypeFilterMatch` function.
- Library UI now loads 50 runs at a time. A "Load More" button appears when `hasMore=true` and fetches the next page via `loadGallery(false)` (appends). Filter changes call `loadGallery(true)` which resets `libraryOffset=0` and clears the grid before fetching page 1.
- Full-size image viewer/lightbox (`#image-viewer-overlay`) added. Clicking the primary image in the run detail panel, or any thumbnail, opens the viewer at full size. The viewer shows the run ID, filename, a "Copy path" button, a "Send to Upscale" button, and a Close button. Escape closes the viewer (then the detail panel if viewer was already closed). Clicking the backdrop also closes. The image URL always uses `/api/run-file?path=...` — no raw path is exposed as editable input.
- `state.libraryLoading` guard prevents concurrent fetches.
- `state.libraryIndex` is retained in state but no longer populated (server-side filter made it redundant).
- All `loadGallery()` call sites updated to `loadGallery(true)` (reset) except the new Load More button which calls `loadGallery(false)`.

Files changed:
- `operator-console/server.js`: `GET /api/run-index` route — added `limit`/`offset` params, server-side filter, paginated response shape.
- `operator-console/public/app.js`: replaced `runTypeFilterMatch`/`loadGallery`/`renderGallery` with paginated `loadGallery(reset)` + `updateLoadMoreBtn` + `openImageViewer` + `closeImageViewer`. Updated `showRunDetail` thumbnail/primary click handlers. Added Load More, Escape, and viewer backdrop event bindings.
- `operator-console/public/index.html`: added `#library-load-more-row` with `#btn-load-more` and `#library-count-info`; added `#image-viewer-overlay` with `#image-viewer-panel`, `#image-viewer-stage img#image-viewer-img`, copy-path, send-to-upscale, and close buttons.
- `operator-console/public/styles.css`: added `.library-load-more-row`, `.image-viewer-overlay`, `.image-viewer-panel`, `.image-viewer-header`, `.image-viewer-info`, `.image-viewer-stage` styles.

Privacy boundary preserved:
- `/api/run-index` items contain no prompt or negative_prompt fields.
- Image viewer sets `img.src` via `/api/run-file?path=...` and shows only runId + filename in the info line — no raw prompt text.
- Copy path copies the encoded path string, not any prompt text.

Validation:
- `node --check` passes on both server.js and app.js
- `/api/run-index?limit=5&offset=0&filter=all` → `{ items: [...], total: 109, hasMore: true, nextOffset: 5 }`
- `/api/run-index?filter=bogus` → HTTP 400
- `/api/run-index?filter=controlled` → items only of filterCategory=controlled, hasMore=false (10 total)
- Second page `/api/run-index?limit=50&offset=50&filter=all` → 50 items, nextOffset=100, hasMore=true

State After Completion:
- Library has server-side pagination (50/page), Load More button, count display, and a full-size image viewer/lightbox for all output images.
