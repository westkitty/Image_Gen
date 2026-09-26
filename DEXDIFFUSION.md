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
| MFLUX venv (Big Mac) | `/Volumes/wc2tb/dex-imagegen/mflux-venv` |
| HF cache (Big Mac) | `/Volumes/wc2tb/dex-imagegen/cache/huggingface` (also holds the unused ~15 GB full-precision model) |
| Normal settings | 4 steps, guidance 1, 512×512 (~25 s) or 1024×1024 (~60 s), seed supported |
| **Not used by MFLUX** | negative prompt, alternate VAE, SDCPP scheduler, SDCPP CFG scale. The UI still shows these generic controls, but they are **not forwarded** to MFLUX (`operator-console/controlled-args.js`). |

The exact proven invocation is in `sdcpp-workflow/bin/mflux-controlled-generate.sh`:
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
| SDCPP targets fail | Expected: SDCPP is **dormant** (see below). |

## SDCPP (legacy, dormant)

The stable-diffusion.cpp integration (targets `sd15`, `sdxl-*`, `flux-fp8`, …;
`sdcpp-workflow/bin/sdcpp-*.sh`) stays in the code, routing and tests, but it is
**dormant**. Big Mac currently has no compiled `sd` binary, `~/sdcpp-staging` is
empty, and no SD checkpoints are on wc2tb (checked 2026-09-25). Those targets show
as "— dormant" in the target list and in `/api/capabilities` (`runtime: "dormant"`).
Restoring SDCPP means building stable-diffusion.cpp on Big Mac and re-staging
checkpoints. That is a separate, explicit decision, and nothing does it automatically.

## Protected invariants (do not change)

- The node backend stays bound to **127.0.0.1:31337**. Never `0.0.0.0`, never LAN.
- Remote web access is **Tailscale Serve HTTPS :8443, tailnet-only**. **Never Funnel**
  for DexDiffusion. The separate DEX//REACH Funnel on `:443` is not ours; do not touch it.
- Big Mac is never exposed; the MacBook reaches it only via `ssh westcat`.
- Generated images live only in `/Users/andrew/images_made`; Big Mac keeps zero copies.
- MFLUX (`flux2-klein-4b`) is the primary backend; SDCPP is dormant unless explicitly restored.
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
| MFLUX bridge | `sdcpp-workflow/bin/mflux-controlled-generate.sh` |
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
