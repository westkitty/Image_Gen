# DexDiffusion — Operator Guide

This is the canonical, cold-start guide to running DexDiffusion. It is written so a
person or a successor AI can operate and repair the system from the repository
alone. Current evidence and history live in [`OPERATIONAL_STATE.md`](OPERATIONAL_STATE.md);
live facts are also served by `GET /api/system-info` and `bin/dexdiffusion status`.

---

## What it is

DexDiffusion is a **MacBook-hosted local image-generation UI** that uses **Big Mac**
(Apple M4 Mac mini, 32 GB) as the MLX/MFLUX generation machine. The MacBook owns the
UI, the job API, run metadata and every final image. Big Mac only computes images
and keeps nothing afterwards.

## Architecture

```
Browser or DexDiffusion.app (MacBook)          Tailnet device (browser)
        │ http://127.0.0.1:31337                     │ https://macbook-air.tailafb7e8.ts.net:8443
        │                                            ▼
        │                               Tailscale Serve on MacBook (tailnet-only)
        ▼                                            │
operator-console  (node, bound to 127.0.0.1:31337 only) ◄──┘
        │  POST /api/actions/generate-controlled
        ▼
sdcpp-workflow/bin/mflux-controlled-generate.sh
        │  ssh westcat
        ▼
Big Mac: MFLUX 0.20.0 / MLX → FLUX.2 Klein 4B 4-bit → PNG in a private mktemp dir
         (secondary path: stable-diffusion.cpp sd-cli → SD1.5 / Real-ESRGAN, same ephemeral rules)
        │  PNG streamed back over SSH stdout; remote temp dir deleted (trap) and verified gone
        ▼
MacBook: /Users/andrew/images_made/<run-id>-s<seed>-<source>.png   (sole durable copy)
        │
        ▼
GET /api/images/<file>  →  DexDiffusion result panel
```

## Quick use

1. Click **DexDiffusion** in the Dock (or open a URL below).
2. **FLUX.2 Klein 4B (MFLUX) — Primary** is selected by default.
3. Enter a prompt; optionally pick 512×512 / 1024×1024 and a seed.
4. Click **Generate Image**. The progress bar shows a percentage.
5. The result appears in the panel. The file is in `/Users/andrew/images_made`.

Operational details (URLs, engine, storage, launcher, SDCPP status) are on the
**System** screen → *About DexDiffusion*.

## URLs

| Access | URL |
|---|---|
| Local (canonical) | http://127.0.0.1:31337/dexdiffusion/ |
| Local (alternate) | http://localhost:31337/dexdiffusion/ |
| Tailnet | https://macbook-air.tailafb7e8.ts.net:8443/dexdiffusion/ |

The frontend is **same-origin** (relative `/api/...` calls), so the same code works
from all three. Verify the tailnet hostname/port with `tailscale serve status`, which
must show `https://macbook-air.tailafb7e8.ts.net:8443 (tailnet only)` →
`proxy http://127.0.0.1:31337`.

## Mac Dock launcher

| Item | Value |
|---|---|
| App | `/Applications/DexDiffusion.app` (the only DexDiffusion launcher) |
| Bundle identifier | `local.image-gen.wrapper` (kept from the original Image_Gen wrapper for continuity) |
| Display name / executable | `DexDiffusion` / `Contents/MacOS/DexDiffusion` |
| Swift source | `native/macos/Image_Gen/ImageGenApp.swift` |
| Build/install/repair script | `scripts/install-macos-app.sh` |
| Icon source | `operator-console/public/dexdiffusion/uploads/grok_image_1775521844329.jpg` (the "Dexter" mascot used as the DexDiffusion logo) |
| Installed icon | `Contents/Resources/DexDiffusion.icns` (`CFBundleIconFile = DexDiffusion`) |
| Dock | exactly one tile, `file:///Applications/DexDiffusion.app/` |

**What clicking it does:** the app is a native WebKit **wrapper window** (not a
browser tab). On launch it runs `bin/dexdiffusion start`, which reuses a healthy
project-owned console or starts one detached, then loads
`http://127.0.0.1:31337/dexdiffusion/` in its window. It never starts a second
server. Big Mac is not contacted at launch; it is only needed when you generate.
Quitting the app **does not** stop the console, so tailnet users keep access. Use
`bin/dexdiffusion stop` for that. On startup failure the window's status line shows
the log path; *Help → Copy Error Report* and *File → Open Logs* are available.
Logs: `operator-console/server.log`, `operator-console/DexDiffusion-macos-wrapper.log`.

**Install / repair / reinstall** (safe to re-run, idempotent):

```bash
scripts/install-macos-app.sh
```

It compiles the Swift wrapper and builds the icon from the source artwork (needs
`swiftc` and python3 Pillow). It installs `/Applications/DexDiffusion.app` (the
previous build is moved to the archive) and registers it with Launch Services. It
makes sure the Dock has **exactly one** DexDiffusion tile: legacy Image_Gen tiles are
rewritten in place with stale bookmark data dropped, otherwise one tile is appended.
It backs up Dock prefs first to
`~/Library/Application Support/DexDiffusion/dock-backup-<stamp>.plist`, never
touches other Dock items, then does a narrow `killall Dock`. Legacy launchers
(`Image_Gen.app`, `Image_Gen Launcher.app`, `Image Gen Operator Console.app`) are
**moved, not deleted**, to
`~/Library/Application Support/DexDiffusion/retired-launchers/` and unregistered.

**Verify the Dock item points at the canonical app:**

```bash
bin/dexdiffusion status          # Launcher: app PRESENT, icon OK (DexDiffusion.icns), dock INSTALLED (1 entry)
osascript -e 'POSIX path of (path to application id "local.image-gen.wrapper")'   # → /Applications/DexDiffusion.app/
defaults read com.apple.dock persistent-apps | grep -c 'file:///Applications/DexDiffusion.app/'   # → 1
```

## Primary model and engine

| Item | Value |
|---|---|
| Target id / label | `flux2-klein-4b` / FLUX.2 Klein 4B (MFLUX), status `proofed`, `primary: true` |
| Model | `mlx-community/flux2-klein-4b-4bit` (base `black-forest-labs/FLUX.2-klein-4B`, Apache-2.0, 4-bit) |
| Runtime | MFLUX 0.20.0, Python 3.13.13, MLX/Metal on Big Mac |
| Model path (Big Mac, internal SSD) | `$HOME/Library/Caches/DexDiffusion/mflux/flux2-klein-4b-4bit` |
| MFLUX venv (Big Mac, internal SSD) | `$HOME/Library/Caches/DexDiffusion/mflux/venv` — pinned, package-identical copy (`uv pip freeze` diff = none) of `/Volumes/wc2tb/dex-imagegen/mflux-venv`, which is kept as a fallback but is **not** on the hot path (see incident below) |
| MFLUX cache (Big Mac) | `$HOME/Library/Caches/DexDiffusion/mflux/cache` (offline; model is loaded from the local dir) |
| Legacy HF cache (Big Mac) | `/Volumes/wc2tb/dex-imagegen/cache/huggingface` (holds the unused ~15 GB full-precision model; not used at runtime) |
| Normal settings | 4 steps, guidance 1, 512×512 (~25 s) or 1024×1024 (~60 s), seed supported |
| **Not used by MFLUX** | negative prompt, alternate VAE, SDCPP scheduler, SDCPP CFG scale. The UI still shows these generic controls, but they are **not forwarded** to MFLUX (`operator-console/controlled-args.js`). |

A UI seed of `-1` means **random**: the bridge resolves it to a recorded
non-negative seed (label `<n>(random)`), because MLX only accepts seeds ≥ 0.

The exact proven invocation is in `sdcpp-workflow/bin/mflux-remote-generate.sh`
(the Big Mac half, sent over ssh) driven by `mflux-controlled-generate.sh`:
`mflux-generate-flux2 --model <model path> --base-model flux2-klein-4b --prompt … --steps 4 --seed … --width … --height … --output <remote tmp>`.
It runs with `HF_HUB_OFFLINE=1`.

## Image storage

`/Users/andrew/images_made` is **the sole durable generated-image authority**.

- Every successful generation from any entrypoint (UI, API or a hand-run script) ends
  with exactly one file there, named `<run-id>-s<seed>-<source>.png`, and never
  overwrites an existing file.
- Run directories (`sdcpp-workflow/runs/<run-id>/`) keep manifests, reports, logs and
  `canonical-images.json` (run file → image id/path/URL), **never image bytes**.
- Images are served only by `GET /api/images/<file>`, which accepts plain filenames
  inside that folder. Traversal, absolute paths, symlinks and `.incoming-*` all
  return 404.
- Implementation: `operator-console/image-store.js`; the shell entrypoint is
  `operator-console/bin/canonicalize-image.js`, called by `sdcpp-lib.sh`.
- Latest image: `ls -t /Users/andrew/images_made | head -1`, also printed by
  `bin/dexdiffusion status`.

## Big Mac

- Route: `ssh westcat`. Expected identity is user `bigmac`, host `bigmac`
  (`ssh westcat 'whoami; hostname'`).
- Big Mac is a remote execution machine only. No HTTP service, no public/LAN ports.
- **Retention:** Big Mac does not retain generated images. MFLUX output goes to a
  private `mktemp -d` directory that a trap deletes on any exit, and the bridge
  verifies it is gone. SDCPP scripts register remote image paths for deletion on exit.
  Models, venv and caches stay by design.

## Starting, stopping, status

Use `bin/dexdiffusion`. It only ever signals the process whose `/api/version`
reports this checkout's `operator-console` directory and owns port 31337.

```bash
bin/dexdiffusion start     # start if not already healthy; prints local + tailnet URLs
bin/dexdiffusion stop      # stop ONLY the project-owned console (never pkill/killall node)
bin/dexdiffusion restart
bin/dexdiffusion status    # read-only report: web, launcher, Dock, Big Mac, MFLUX, model, storage, SDCPP
bin/dexdiffusion doctor    # read-only PASS/WARN/FAIL health check (same as System → DexDiffusion Doctor); never generates
bin/dexdiffusion open      # start if needed, open the local URL in the default browser
```

The console is detached (`nohup node server.js`, log `operator-console/server.log`,
pid in `operator-console/dexdiffusion.pid`). It survives terminal and app quit. It
does **not** start at login; the Dock app or `start` brings it up. `stop` never
touches Tailscale or its Serve configuration. First-time setup only:
`(cd operator-console && npm install)`.

## Health checks

```bash
bin/dexdiffusion status
curl -fsS http://127.0.0.1:31337/api/capabilities >/dev/null && echo UP
curl -fsS http://127.0.0.1:31337/api/system-info | python3 -m json.tool
lsof -nP -iTCP:31337 -sTCP:LISTEN          # must show 127.0.0.1:31337 only
tailscale serve status                     # :8443 (tailnet only) → http://127.0.0.1:31337
ssh westcat 'whoami; hostname'             # bigmac / bigmac
ssh westcat 'test -x /Volumes/wc2tb/dex-imagegen/mflux-venv/bin/mflux-generate-flux2 && echo MFLUX OK'
(cd operator-console && npm test)          # regression suite
```

**Generation test** from the UI (512×512, 4 steps, any fixed seed), or:

```bash
curl -s -X POST http://127.0.0.1:31337/api/actions/generate-controlled -H 'content-type: application/json' \
  -d '{"target":"flux2-klein-4b","prompt":"a green apple on a white table","width":512,"height":512,"steps":4,"seed":7,"quantity":1,"save_prompts":false}'
# then poll GET /api/jobs/<job_id> until status PASS; controlledOutputImageUrl is the /api/images URL
```

## Troubleshooting

| Symptom | Check / fix |
|---|---|
| Dock icon missing | `scripts/install-macos-app.sh` (adds exactly one tile). |
| Dock icon stale (old "IG" icon) or opens the wrong app | Run `bin/dexdiffusion status` and look for `dock: … STALE` / `DUPLICATE`, then re-run `scripts/install-macos-app.sh`. It rewrites the tile and drops stale bookmark data. Verify with the `osascript` / `defaults` commands above. |
| Wrapper says port is occupied by a different console | Something else holds 31337. `lsof -nP -iTCP:31337 -sTCP:LISTEN` identifies it; stop that process yourself. |
| UI unavailable locally | `bin/dexdiffusion status` → if DOWN: `bin/dexdiffusion start`; read `operator-console/server.log`. |
| Tailnet URL unavailable | `tailscale status` (MacBook online and logged in?), `tailscale serve status` (route present?). Restore the route with `tailscale serve --bg --https=8443 http://127.0.0.1:31337`. **Never** use Funnel. The local UI keeps working without Tailscale. |
| Generation fails, Big Mac unreachable | `ssh westcat 'hostname'`. The UI still opens; only generation needs Big Mac. Job logs: `sdcpp-workflow/runs/<run>/remote-command.log`, `mflux-controlled-generate.log`. |
| MFLUX/model missing | `bin/dexdiffusion status` shows MFLUX env / model PRESENT/MISSING. See OPERATIONAL_STATE.md for the verified install (do not reinstall blindly). |
| Metal GPU timeout | Known history: full-precision weights from wc2tb timed out. The 4-bit model on internal storage is the fix. Do not switch back. |
| Generation passed but image missing | `ls -t /Users/andrew/images_made \| head`; `cat sdcpp-workflow/runs/<run>/canonical-images.json`. |
| `generator-exit` / `output-*` gate | Read `sdcpp-workflow/runs/<run>/remote-command.log` (prompt-redacted); the job error names the remote exception. |
| Generation very slow to start | Check Big Mac disk contention; the MFLUX runtime must be the internal venv (`bin/dexdiffusion status` → MFLUX env). |
| SDXL/Flux-fp8 target "— model missing" | Expected: only SD1.5 is restored. Staging another checkpoint is an explicit decision. |
| Capability shows BROKEN | The latest real run failed at a runtime gate; fix the cause and re-run once to return to PROVEN. |

## SDCPP (restored, secondary)

MFLUX stays **primary**. stable-diffusion.cpp is a restored **secondary** backend
used for SD1.5 txt2img, img2img, inpaint, hires-fix, batch and Real-ESRGAN.

| Item | Value |
|---|---|
| Upstream / revision | https://github.com/leejet/stable-diffusion.cpp @ `7f0e728` (`master-709`), Metal |
| Checkout | `$HOME/stable-diffusion.cpp` (pinned, clean) |
| Build | `cd ~/stable-diffusion.cpp && uvx --from cmake cmake -S . -B build -DSD_METAL=ON -DCMAKE_BUILD_TYPE=Release && uvx --from cmake cmake --build build --config Release -j 8` (cmake 4.4.3 via uv, no system install) |
| Binaries | `$HOME/stable-diffusion.cpp/build/bin/{sd-cli,sd-server}` — pointer in `~/sdcpp-staging/build_dir.txt` |
| SD1.5 model | `$HOME/sdcpp-staging/models/v1-5-pruned-emaonly.safetensors` — https://huggingface.co/stable-diffusion-v1-5/stable-diffusion-v1-5 · **CreativeML OpenRAIL-M** · 4,265,146,304 B · sha256 `6ce0161689b3853acaa03779ec93eafe75a02f4ced659bee03f50797806fa2fa` |
| Real-ESRGAN | `/Volumes/wc2tb/ImageGen/upscalers/RealESRGAN_x4plus.pth` — https://github.com/xinntao/Real-ESRGAN/releases/tag/v0.1.0 · **BSD-3-Clause** · 67,040,989 B · sha256 `4fa0d38905f75ac06eb49a7951b426670021be3018265fd191d2125df9d682f1` |
| Not restored | SDXL, SDXL-Turbo, Flux-fp8 and custom checkpoints — those targets show **"— model missing"** and are never offered as ready |

SD1.5 uses a warm `sd-server` only when its tunnel is already running; otherwise it
runs on-demand `sd-cli` per job (no standing service on Big Mac). All SDCPP remote
images are registered with `register_remote_ephemeral` and deleted on exit.

**Rebuild from scratch:** clone upstream to `~/stable-diffusion.cpp`, `git checkout 7f0e728`,
`git submodule update --init --recursive`, run the build above, write the build dir to
`~/sdcpp-staging/build_dir.txt`, download the two models above to the listed paths and
verify their sha256.

## Capability truth

Status is **derived**, never hand-written (`operator-console/capabilities.js`):
real job results are recorded in `sdcpp-workflow/state/capability-evidence.json`
(machine-local) and combined with a read-only Big Mac asset probe.

| Status | Meaning |
|---|---|
| PROVEN | a real job of this capability passed here (date shown) |
| AVAILABLE · unproven | implementation + assets present, no real pass recorded |
| DORMANT | a required runtime/model asset is missing |
| BROKEN | the latest real run failed at a runtime gate (after any pass) |
| UNAVAILABLE | not provided by the architecture |

Shown in **System → Truth status**, `GET /api/system-info` (`capabilities`), and
`bin/dexdiffusion status`. Unit tests cannot make anything PROVEN.

## Incident 2026-09-25: `Job FAIL · gate: remote-png (exit 1)`

- **Symptom:** MFLUX renders from the UI failed with `remote-png`.
- **Root cause 1:** the UI default seed `-1` (SDCPP "random") was forwarded to MFLUX;
  `mx.random.key(-1)` raised `TypeError` before any image was written
  (run `20260925-224619-controlled-flux2-klein-4b`). Every earlier success used an explicit seed.
- **Root cause 2 (masking):** Big Mac's ssh is **Tailscale SSH**, which runs commands via
  `/usr/bin/login -f … zsh -c` and always returns exit-status **0**, so the bridge's
  `ssh` exit check could not see the crash and reported the generic `remote-png` gate.
- **Contributing:** the MFLUX venv on the external USB drive (`wc2tb`, busy with other
  I/O) stalled Python imports for 10+ minutes.
- **Fix:** negative seeds → recorded random seed; the remote half
  (`mflux-remote-generate.sh`) reports `MFLUX_REMOTE_EXIT` / `MFLUX_REMOTE_FAIL` in-band;
  failures now name the gate (`generator-exit`, `output-missing`, `output-empty`,
  `output-invalid`, `transfer-failed`, `sha-mismatch`, `canonicalization-failed`,
  `cleanup-failed`) with the remote error line and log path; the hot-path runtime moved
  to Big Mac's internal SSD. Regression tests: `operator-console/tests/mflux-bridge.test.js`.
- **Rule for all remote code:** never trust `ssh westcat` exit codes; check output
  (`remote_test` in `sdcpp-lib.sh`) or in-band markers.

## Workstation workflow (rev 7)

- **Create:** set Quantity (1–100). SDCPP targets run 2–16 images as one native `sd-cli --batch-count` job (seeds S…S+N-1); MFLUX runs sequentially with independent seeds. Every image appears in **Results** with seed, model, size and status, plus actions: Open, Variation, Explore Seeds (Seed Lab), Img2Img, Inpaint, Outpaint, Enhance, Compare, Reuse Seed/Settings, Keeper, Lineage, Copy path. Actions appear only when their capability gate is open.
- **High-Res Refine** (SDCPP only) is sd-cli's native diffusion second pass. It is not Lanczos resizing and not Real-ESRGAN.
- **Batch:** paste a numbered collection (`1. Title`, blank line, prompt…). Only a line starting `<n>. Title` after a blank line starts an entry. Preview, preflight, then a backend queue with Stop After Current / Retry Failed / remove / reorder. Queues survive a console restart (`sdcpp-workflow/state/queues.json`): a running item becomes INTERRUPTED and can be retried. When prompt saving is off, prompts are not stored, so paste the same numbered text again to resume.
- **Edit:** any image becomes the source (shown first; legacy run/file pickers are under *Advanced Source Selection*). Inpaint and Outpaint restore the original pixels outside the mask; for Outpaint, describe what the new area should contain. It offers img2img strength presets, source prep (temporary copy), a mask editor (brush, eraser, undo/redo, grow/shrink/feather/blur/invert; a full mask needs confirmation) and Outpaint (canvas extension through the SD1.5 inpaint path).
- **Library:** image grid with filters (Keepers, model, operation), parent/children lineage, and 2–4 image compare. Lineage and Keepers are metadata in `sdcpp-workflow/state/image-meta.json`, and images are never copied.
- **Recipes** store settings only unless prompt saving is on.
- **ControlNet:** the engine supports it, but no SD1.5 ControlNet model is installed, so the UI does not offer it.

## Media workstation (rev 9)

- **Screens:** Create (images), Voice, Music, Video, Library, Batch, Edit, Enhance, Models, System.
- **Workers** (`GET /api/workers`): MFLUX, SDCPP, Kokoro (speech), Qwen3-TTS Base (voice clone from a staged reference), Qwen3-TTS VoiceDesign, ACE-Step 1.5 (full song; Turbo + 0.6B LM) and Magenta RealTime 2 small (instrumental, 2–60 s) are all **proven through DexDiffusion**. LTX (video) is not installed. Nothing is downloaded from the UI.
- **Voice/music execution:** `media-bridge.js` runs `bridges/dexmedia_remote.py` on Big Mac over `ssh westcat` (no server on Big Mac). Private text travels in a 0600 request file the driver deletes on read. Output flow: remote temp → validated WAV → scp → sha256 → `audio_made/{voice,music}` → Library → remote temp removed. Failures name their gate (e.g. `reference-invalid`, `output-invalid`, `checksum`). Jobs cannot be cancelled mid-run. ACE-Step takes ~6–7 min for 30 s. Poll `GET /api/generic-jobs/<id>`.
- **Reinstall/verify the stack:** `scripts/install-bigmac-media-model-stack.sh` (`--verify` is read-only).
- **Model stack paths** (single source: `operator-console/media.js` `WORKER_PATHS`): models under `/Volumes/wc2tb/generative-models/{voice,music}`; runtimes under `~/Library/Caches/DexDiffusion/{voice/venv, music/ACE-Step-1.5/.venv, music/magenta-rt-venv}` on Big Mac.
- **Big Mac heavy compute** is one lease (`GET /api/resources`). A second heavy job waits ("Waiting for Big Mac — …"), and a large Ollama model loaded on Big Mac also blocks it (read-only check).
- **Jobs** are durable (`sdcpp-workflow/state/jobs.json`). After a console restart, finished jobs keep their results. In-flight jobs show INTERRUPTED and are not re-run; re-enter the text to retry when prompt saving was off.
- **Imports:** Edit and Voice/Music references accept file, drag/drop or paste. They are staged for 24 h in `sdcpp-workflow/state/staging/` and never become canonical media.
- **Canonical roots:** images `/Users/andrew/images_made`, voice `/Users/andrew/audio_made/voice`, music `/Users/andrew/audio_made/music`, video `/Users/andrew/video_made`. Served only by id: `/api/images/:id`, `/api/media/:id`.
- **Activating a future worker (e.g. LTX):** install the runtime and model at the paths shown under *Activation path*, add its execution bridge, prove one real generation, then enable it.

## Protected invariants (do not change)

- The node backend stays bound to **127.0.0.1:31337**. Never `0.0.0.0`, never LAN.
- Remote web access is **Tailscale Serve HTTPS :8443, tailnet-only**. **Never Funnel**
  for DexDiffusion. The separate DEX//REACH Funnel on `:443` is not ours; do not touch it.
- Big Mac is never exposed; the MacBook reaches it only via `ssh westcat`.
- Generated images live only in `/Users/andrew/images_made`; Big Mac keeps zero copies.
- MFLUX (`flux2-klein-4b`) is the primary backend; SDCPP (restored) is secondary/optional.
- Never trust ssh exit codes to Big Mac (Tailscale SSH returns 0); use output or in-band markers.
- The Dock launcher is `/Applications/DexDiffusion.app` only.

**Never delete:** `/Users/andrew/images_made`, Big Mac's model dir, the MFLUX venv,
the HF cache on wc2tb, `OPERATIONAL_STATE.md`, run metadata.
**Safe to repair/re-run:** `scripts/install-macos-app.sh`,
`bin/dexdiffusion start|stop|restart`, re-adding the Serve route above.

## Canonical files

| Purpose | Path |
|---|---|
| Operator guide (this file) | `DEXDIFFUSION.md` |
| Evidence and history | `OPERATIONAL_STATE.md` |
| Server / API | `operator-console/server.js` |
| Operational metadata | `operator-console/system-info.js` → `GET /api/system-info` |
| Image store | `operator-console/image-store.js`, `operator-console/bin/canonicalize-image.js` |
| Backend routing | `operator-console/controlled-args.js` |
| UI | `operator-console/public/dexdiffusion/{index.html,component.js,client-helpers.js}` |
| MFLUX bridge | `sdcpp-workflow/bin/mflux-controlled-generate.sh` + `mflux-remote-generate.sh` |
| Capability truth | `operator-console/capabilities.js` (+ `sdcpp-workflow/state/capability-evidence.json`, local) |
| Shared shell lib | `sdcpp-workflow/bin/sdcpp-lib.sh` |
| Lifecycle / status | `bin/dexdiffusion` |
| Mac app | `native/macos/Image_Gen/ImageGenApp.swift`, `scripts/install-macos-app.sh` |
| Tests | `operator-console/tests/*.test.js` (`npm test`) |

## Recovering state (for a successor AI)

1. Read `OPERATIONAL_STATE.md` (evidence, failures, current baseline) and this file.
2. `git status` / `git log -5` (uncommitted `.resurrection/*` and `output/playwright/`
   are intentionally local-only).
3. `bin/dexdiffusion status`.
4. `curl -s http://127.0.0.1:31337/api/system-info` and `/api/capabilities`.
5. Trust live evidence over prose. Record drift in `OPERATIONAL_STATE.md` rather
   than rewriting its history.

## Workstation V12 Live Operations

DexDiffusion V12 operates with a unified real-time architecture:
- **Live Event Stream**: Native Server-Sent Events (`GET /api/events`) eliminate aggressive HTTP polling and keep browser state in continuous sync with the backend.
- **Global Job Center**: Press `Cmd/Ctrl + Shift + J` or click **Jobs** in the bottom HUD to open the persistent drawer showing Active, Queue, and Recent jobs with cancellation actions.
- **Resource HUD**: Persistent bar at the bottom displaying real-time Big Mac lease status and conservative queue wait estimations derived from historical completed runs.
- **Command Palette**: Press `Cmd/Ctrl + K` to access global actions, screen navigation, workflows, and diagnostic tools.
- **Indexed Library & Thumbnails**: Incremental indexed querying with filters, collections (`/api/collections`), and fast lightweight thumbnails (`/api/thumbnails/:id`).
- **Synchronized Image Comparison**: Compare 2–4 images side-by-side or with swipe/flicker modes without generating redundant disk artifacts.
- **Reproducibility & Workflows**: Export and import settings bundles (`dexdiffusion.repro.v1`), reusable recipes (`dexdiffusion.recipe.v1`), and declarative workflow macros (`dexdiffusion.macro.v1`).
- **Scoped Cancellation**: Safe cancellation of queued and active jobs with PID and nonce verification that strictly prevents killing unrelated processes.
