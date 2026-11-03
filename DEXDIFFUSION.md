# DexDiffusion — Operator Guide

This is the canonical, cold-start guide to running DexDiffusion. It is written so a
person or a successor AI can operate and repair the system from the repository
alone. Current evidence and history live in [`OPERATIONAL_STATE.md`](OPERATIONAL_STATE.md);
live facts are also served by `GET /api/system-info` and `bin/dexdiffusion status`.

---

## What it is

DexDiffusion is a private native-WebKit and browser creative workstation. The
MacBook is the user-facing control and canonical-image-storage machine; Big Mac
(Apple M4, 32 GiB) is the heavy-inference host.

**Current server topology (2026-11-01 code, verify against live runtime):**
bin/dexdiffusion starts the Node operator console directly on Big Mac when
invoked on hostname bigmac. On MacBook, it uses a dedicated SSH local port
forward from 127.0.0.1:31337 to Big Mac 127.0.0.1:31337, rather than starting
a second MacBook Node server. Earlier sections describing a MacBook-owned
Node/API are **historical configurations**, not necessarily the active host
assignment. The MacBook Dock app still opens
http://127.0.0.1:31337/dexdiffusion/ through that private route.

**Authority for troubleshooting:** compare /api/version process cwd, pid
and gitHead against the actual listener PID, host, repository head and the
current branch. Remote Git and an installed Dock bundle may be at different
revisions. Do not terminate a foreign port owner or relabel source/native
identity as deployed without actual device proof. The canonical final-image
storage contract remains /Users/andrew/images_made; Big Mac must not retain
duplicate completed image artifacts. No public ports or changes to DEX//REACH
:443 are permitted.

## Architecture

The following diagram documents the original MacBook-local console variant;
the current Big Mac-owned Node route and MacBook SSH forward above take precedence.

Controlled generation uses the Big Mac backend and its installed models. The
diagram below is historical: current generation does not establish the complete
cross-host publication chain described there. Current ownership, paths,
cancellation and measured limits are in the
[local-engine bridge record](docs/operations/local-engine-bridge-20261021.md).

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
        │  Legacy path: PNG streamed over SSH stdout; remote temp deleted
        ▼
MacBook: /Users/andrew/images_made/<run-id>-s<seed>-<source>.png   (canonical destination by policy; current backend path below does not publish here)
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
`http://127.0.0.1:31337/dexdiffusion/` in its window. The CLI command
`bin/dexdiffusion open` activates `/Applications/DexDiffusion.app`; it never
opens the URL in the default browser. Reopening the Dock app after closing its
window checks/starts the backend before reloading the native window. The app
never starts a second server.
Big Mac is not contacted at launch; it is only needed when you generate.
The wrapper does not offer an “Open in Browser” menu action. `bin/dexdiffusion start`
remains headless and only starts or reuses the project-owned backend.
Quitting the app **does not** stop the console, so tailnet users keep access. Use
`bin/dexdiffusion stop` for that. On startup failure the window's status line shows
the log path; *Help → Copy Error Report* and *File → Open Logs* are available.
Logs: `operator-console/server.log`, `operator-console/DexDiffusion-macos-wrapper.log`.
WebKit connection failures invoke the bounded project recovery helper automatically;
the wrapper retries twice and extends its startup watchdog only while the helper
or page is still progressing. A healthy tunnel is preserved when the remote
backend recovers behind it.

**Install / repair / reinstall** (safe to re-run, idempotent):

```bash
scripts/install-macos-app.sh
```

It compiles the Swift wrapper and builds the icon from the source artwork (needs
`swiftc` and python3 Pillow when the icon must be rebuilt). If Pillow is absent,
it reuses the installed icon only when its recorded source fingerprint matches
the current artwork. It installs `/Applications/DexDiffusion.app` (the
previous build is moved to the archive) and registers it with Launch Services. It
makes the full Git `HEAD`, Swift source fingerprint, and icon-artwork fingerprint
available in the bundle metadata. `bin/dexdiffusion status` compares full
revisions while recognizing existing short revision stamps. It
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

**Historical latency path (2026-10-16).** `mflux-controlled-generate.sh` made two ssh round trips
(one merged preflight for hostname + runtime + model with the same `route` /
`route-hostname` / `mflux-runtime` / `mflux-model` gates, then the generate call), and both
reuse one authenticated connection through a private OpenSSH control socket
(`~/.ssh/dexdiffusion-cm/`, mode 0700, `ControlPersist=120`). Set `DEX_SSH_MUX=0` to disable
reuse. Every run's `controlled-manifest.json` carries a `timings` block (preflight, ssh total,
remote generate, validation, canonicalization; no prompt data) and the log line `MFLUX_TIMING:`.
Its historical job stage read Checking Big Mac and model → Generating on Big Mac → Finalizing in
canonical storage → Complete; do not treat that UI stage as publication evidence for the current backend.

## Image storage

`/Users/andrew/images_made` on the MacBook is **the canonical original destination by policy**. The current Big Mac backend writes generation artifacts under `/Volumes/wc2tb/DexDiffusion/images`; until a cross-host publication transport completes and acknowledges a verified MacBook write, those files are working/staging/pending artifacts, not canonically published originals.

- A Big Mac render completing or appearing in its local image store does not prove
  canonical publication. Source now implements an opt-in `macbook-pull-v1` outbox,
  authenticated through the existing loopback tunnel, plus a MacBook worker that
  verifies digest, commits by no-clobber link, fsyncs a receipt, then acknowledges.
  This source is not deployed; production publication remains unverified until the
  separately approved Stage 2 deployment and real artifact acceptance.
- When a canonical write is implemented, it must target exactly
  `/Users/andrew/images_made`, reject collisions, verify content identity, durably
  acknowledge success, and retain the Big Mac source until policy permits removal.
- Run directories (`sdcpp-workflow/runs/<run-id>/`) keep manifests, reports, logs and
  `canonical-images.json` (run file → image id/path/URL), **never image bytes**.
- The current Big Mac API serves files from its configured working image root.
  This serving path is not evidence that the MacBook canonical destination was written.
- Implementation: `operator-console/image-store.js`; the shell entrypoint is
  `operator-console/bin/canonicalize-image.js`, called by `sdcpp-lib.sh`.
- Cross-host source implementation: `operator-console/publication-outbox.js`,
  `operator-console/bin/canonical-publication-worker.js`, and the constrained
  `/api/publications/*` routes in `operator-console/server.js`. On MacBook, the
  native wrapper requests `bin/dexdiffusion publication-sync`; `lockf` prevents
  duplicate workers and the UI applies three bounded retries with backoff.
  Historical images/indexes/journals have no opt-in marker and are not relabeled.
- Latest image: `ls -t /Users/andrew/images_made | head -1`, also printed by
  `bin/dexdiffusion status`.

### Stage 2 deployment gate (not authorized in the source-closure task)

1. Reconcile the dirty Big Mac checkout against its own HEAD and remote; preserve
   every existing diff and untracked file. Andrew approval required; recover from
   the private source snapshots and do not overwrite remote-only work.
2. Save checksummed backups of the active runner, plist, and service state before
   deployment. Approval required; restore those exact owned files on rollback.
3. Deploy only reviewed backend source on Big Mac and restart only the verified
   DexDiffusion service while idle. Separate runtime approval required; restore
   the saved backend checkout/service definition if health checks fail.
4. Install the MacBook worker/source and rebuild/install the native wrapper.
   Separate install approval required; restore the prior app bundle and source
   checkout snapshot on failure.
5. Verify MacBook canonical-root ownership, permissions, free space, and no
   symlink path components. Approval required before any permission change; stop
   without changing permissions if the root is not safely writable.
6. Publish one explicitly authorized test artifact, compare Big Mac and MacBook
   SHA-256 plus durable receipt and outbox acknowledgment. Approval required for
   the artifact write; preserve both copies throughout validation.
7. Exercise interrupted transfer and lost-ack retries with an owned test artifact.
   Approval required; retain the source and receipt, and remove nothing during
   rollback.
8. Validate Chat/FLUX compute coexistence and performance under an approved idle
   window. Approval required; stop the test job through its owned cancellation
   path and preserve its records.
9. If acceptance fails, unload/restore only the verified DexDiffusion service,
   restore the saved source/app, and leave images, journals, models, and unrelated
   workloads unchanged. Approval required for rollback activation.

## Big Mac

> **Superseded 2026-11-03 for topology:** the Node backend now runs persistently on Big Mac (`gui/503/local.dexdiffusion.server`) and keeps working images on `/Volumes/wc2tb/DexDiffusion` until the MacBook acknowledges a verified canonical copy. See *Current topology and persistent recovery* below. The bullets that follow are historical.

- Route: `ssh westcat`. Expected identity is user `bigmac`, host `bigmac`
  (`ssh westcat 'whoami; hostname'`).
- Big Mac runs the loopback-only Node backend and compute workloads. Port 31337
  remains bound to `127.0.0.1`; no public/LAN service exposure is allowed.
- **Image retention:** `/Volumes/wc2tb/DexDiffusion/images` is Big Mac working,
  staging, or pending-publication storage. Existing Big Mac files are preserved;
  this policy does not retroactively classify or remove historical artifacts.
  Models, venv and caches stay by design.

## Starting, stopping, status

> **2026-11-03:** on the MacBook, `start`, `open`, `restart` and the Dock app all go through the single recovery controller; the paragraph below about a MacBook-local console is historical. See *Current topology and persistent recovery*.

Use `bin/dexdiffusion`. It only ever signals the process whose `/api/version`
reports this checkout's `operator-console` directory and owns port 31337.

```bash
bin/dexdiffusion start     # start if not already healthy; prints local + tailnet URLs
bin/dexdiffusion stop      # stop ONLY the project-owned console (never pkill/killall node)
bin/dexdiffusion restart
bin/dexdiffusion status    # read-only report: web, launcher, Dock, Big Mac, MFLUX, model, storage, SDCPP
bin/dexdiffusion doctor    # read-only PASS/WARN/FAIL health check (same as System → DexDiffusion Doctor); never generates
bin/dexdiffusion open      # start if needed, activate the native wrapper
```

The console is detached by `scripts/detach-process.py` (log
`operator-console/server.log`, pid in `operator-console/dexdiffusion.pid`). It
survives terminal and app quit. It
does **not** start at login; the Dock app or `start` brings it up. `stop` never
touches Tailscale or its Serve configuration. First-time setup only:
`(cd operator-console && npm install)`.

### Big Mac backend service

The preferred service is a LaunchAgent in Big Mac's active Aqua login session.
It lets macOS apply the user's Removable Volumes permission to Node. It starts
at login and is restarted by launchd after ordinary process crashes. It cannot
run before that user logs in. From the MacBook, `bin/dexdiffusion start`
checks SSH separately from backend readiness and invokes the installer when
the service is missing or the API is down. With Big Mac's GUI session active,
the idempotent repair command is:

```bash
ssh westcat 'bash /Users/bigmac/Image_Gen/scripts/install-backend-service.sh --user-session'
```

The LaunchAgent runs as `bigmac`, binds the backend to loopback, and has no
access to change unrelated services. Launchd `KeepAlive` is gated on the
durable data path; the runner confirms `/Volumes/wc2tb` is actually mounted
before starting Node. The installer refuses a different service definition,
loaded system service, or port owner, and verifies API identity, listener
ownership, process user, and Studio HTTP readiness. Recovery probes are bounded;
a TCC denial unloads and disables the job instead of retrying forever. It records
that installer-owned disablement so a later app/helper recovery can retry once;
if TCC still refuses access, the installer disables it again. Manual disables
without that marker are left alone.

A system LaunchDaemon installation was tested on Nov 2, but macOS refused the
Node removable-volume request in its background session and launchd retried
the job. The system daemon is therefore disabled. Do not use it for the current
volume-backed backend. Without a logged-in Big Mac user, backend availability
is not established; unattended pre-login service operation would require a
different approved storage/TCC design. Reboot and logout persistence have not
been tested. If this installer disables the user agent after a TCC denial, it
records that state and a later app/helper recovery makes one bounded retry. If
macOS still denies access, the installer disables the job again. A manual
override is available only after the permission has been corrected:

```bash
ssh westcat 'bash /Users/bigmac/Image_Gen/scripts/install-backend-service.sh --user-session-enable-after-tcc'
```

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
| Secondary target "— model missing" | The configured source checkpoint is absent. Restore that exact checkpoint before selecting it; the managed slot never substitutes another model. |
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
| SD1.5 model | `/Volumes/wc2tb/ImageGen/checkpoints/sd15/v1-5-pruned-emaonly.safetensors` — https://huggingface.co/stable-diffusion-v1-5/stable-diffusion-v1-5 · **CreativeML OpenRAIL-M** · 4,265,146,304 B · sha256 `6ce0161689b3853acaa03779ec93eafe75a02f4ced659bee03f50797806fa2fa` |
| Real-ESRGAN | `/Volumes/wc2tb/ImageGen/upscalers/RealESRGAN_x4plus.pth` — https://github.com/xinntao/Real-ESRGAN/releases/tag/v0.1.0 · **BSD-3-Clause** · 67,040,989 B · sha256 `4fa0d38905f75ac06eb49a7951b426670021be3018265fd191d2125df9d682f1` |
| Managed secondary sources | SD1.5, Photonic Fusion SDXL, SDXL base 1.0 and SDXL Turbo are currently available. Selection atomically points `$HOME/Library/Caches/DexDiffusion/secondary-model/current/model.safetensors` at exactly one validated source checkpoint. Missing sources remain unavailable. FLUX cannot enter this slot. |

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

## Individual 3D assets

The top-level `3D` workspace converts a canonical image into an individual GLB
asset on the Big Mac. `Mesh` uses the proven Hunyuan3D-Swift shape-small path;
`Textured Asset` adds the proven RGB paint-small path. Both modes require a
recorded real-job proof before their controls are enabled. `PBR` is explicitly
disabled because the textured proof used substantial memory and increased swap.

Outputs are checksum-verified over an SSH byte stream, validated as GLB, then
finalized once in the MacBook world media store. The remote job directory and
local temporary directory are cleaned in the job's `finally` path. `World`
remains the environment and 360 workspace, and `Quick Geometry` remains its
existing SHARP PLY comparison route. See
[OPERATIONAL_STATE.md](OPERATIONAL_STATE.md#individual-3d-asset-capability--2026-10-04)
for the dated live proof.

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
- **Canonical roots:** images `/Users/andrew/images_made`, voice `/Users/andrew/audio_made/voice`, music `/Users/andrew/audio_made/music`, video `/Users/andrew/video_made`. Served only by id: `/api/images/:id`, `/api/media/:id`. Audio playback uses `/api/media/:id`; downloads use the same-origin attachment route `/api/media/:id/download` (MIME, filename, `nosniff`). The native WebKit wrapper handles that route with `WKDownload` and saves a collision-safe filename in `~/Downloads` instead of navigating to the audio player.
- **Custom dimensions:** Width and Height remain independent numeric request fields. MFLUX accepts 256–2048 per axis in multiples of 16 (its installed code rounds to 16, so DexDiffusion rejects misalignment explicitly); SDCPP accepts 64–the selected target's `maxWidth`/`maxHeight` in multiples of 8 (the VAE scale factor). Presets are shortcuts only. A model change preserves each valid axis and replaces only an axis that the new target cannot accept.
- **Secondary hot slot:** FLUX.2 Klein remains the protected MFLUX primary at `$HOME/Library/Caches/DexDiffusion/mflux/flux2-klein-4b-4bit`. SDCPP source checkpoints remain in their existing libraries. Exactly one active secondary is represented by `$HOME/Library/Caches/DexDiffusion/secondary-model/current`, an atomic symlink to one version under `secondary-model/versions/`; `current/state.json` is the authority exposed by `GET /api/models/secondary`, `/api/capabilities`, and `/api/system-info`. Switching uses the existing capacity-1 Big Mac lease, rejects a switch while generation is active, validates the replacement before swapping, and stops only the project-owned warm SDCPP server if one exists. Normal controlled SDCPP generation remains per-job `sd-cli` and consumes `current/model.safetensors`.
- **Activating a future worker (e.g. LTX):** install the runtime and model at the paths shown under *Activation path*, add its execution bridge, prove one real generation, then enable it.

## Generative Workbench Capabilities (rev 14)

- **Dynamic Visual Model Browser**: Dynamic 1:1 coverage of all selectable capability targets (17 live targets: `flux2-klein-4b`, `flux-fp8`, `sd15`, `sdxl-base`, `sdxl-turbo`, `sdxl-photonic`, `sdxl-homochi`, `sdxl-pony`, `sd15-homofidelis`, `sdxl-juggernaut`, `sdxl-realvisxl`, `sdxl-cyberrealistic`, `sdxl-epicrealism`, `sdxl-biglust`, `sdxl-lustify`, `sdxl-biglove`, `sd15-auto-v1-5-pruned-emaonly`). Curated cards for known targets; auto-fallback cards for discovered checkpoints answering all 5 core questions (description, why use, best for, avoid for, caveats) with honest provenance (`exact-model`, `family-sample`, `placeholder`). Target set minus model cards is strictly `[]`.
- **Non-Destructive Model Selection**: Selecting a model preserves the user's active settings (steps, CFG, dimensions) by default, safely clamping only when bounds require it (e.g. target min/max steps or fixed CFG). Displays an explicit `⚡ Use model defaults` banner in the Create workbench and on active model cards, allowing the user to optionally apply recommended defaults with a single click.
- **Structured Model Switch Warnings**: `/api/models/check-switch` evaluates target compatibility and active resources (negative prompt, structured LoRAs with family resolution) returning structured `{ code, message, severity, resource_id }` records, preventing UI undefined rendering.
- **Model-Aware Prompt Intelligence**: Accessible via the `✨ Enhance` button in Create. Leverages Ollama (`qwen3.8:27b-mlx`) on Big Mac over the managed SSH tunnel at `127.0.0.1:11436`. `OLLAMA_BASE_URL` or `OLLAMA_HOST` can override the endpoint when starting the console. Parses prompt structure, enforces target grammar (FLUX prose vs SDXL vs Pony tags vs SD1.5), protects literal syntax (`<lora:...>`, `__wildcards__`, quotes, ratings), suggests non-destructive parameter adjustments, and provides a review diff panel with Apply, Append, Suggestion Chips, and Undo. Uses `keep_alive: 0` to immediately free unified memory.
- **Wildcard Banks**: 15 banks vendored from `westkitty/He-Maker` with SHA-256 provenance in `HE_MAKER_PROVENANCE.json` plus 6 native banks (21 total). Supports `__bank__` syntax with generation-time expansion, recursion limits, and live prompt autocomplete.
- **Extra Networks & Active Resource Chips**: Tabbed browser for LoRAs with family compatibility badges, trigger words, and weight sliders. Honest empty state for embeddings without local weights. Interactive Active Resource Chips beneath the prompt input show token counts, weight adjustments, and one-click removal.
- **Multi-Output Hero Workspace**: Dominant hero display paired with a vertical filmstrip rail on desktop/tablet (horizontal on mobile), keyboard arrow navigation, and sibling promotion. Fully verified with SD1.5 quantity 3 and fresh MFLUX quantity 2 generations.
- **Native Apple Vision Detailer**: MacBook-native Swift binary (`vision-detailer`) detects face, person, or hand landmark regions locally using macOS Vision. Inpaint runs on Big Mac with ephemeral input/output cleanup and saving-off raw generation logging disabled, while `image-meta.json` records `detailed_from` and `operation: detailer` in canonical lineage.
- **Browser Visual Verification**: Real Chromium verification captures stored in `output/playwright/`: desktop 1440×900 (`browser-qa-desktop-1440.png`), mobile 390×844 (`browser-qa-mobile-390.png`), models tab (`browser-qa-models-tab.png`), hero workspace with siblings (`browser-qa-hero-workspace-siblings.png`), and live vision face mask preview (`browser-qa-detailer-face.png`).


## Edit workbench (rev 16)

- **Send to Edit** (from Create results, the Library, the fullscreen viewer, Enhance) always goes through `openImageInEdit(imageId, mode)`: it loads that image's own recorded generation record (`/api/images/:id/meta` → `recall`) and fills Edit from it — never from the Create form. A banner shows what was restored; with prompt saving off the prompt reads "Source prompt unavailable — prompt saving was off" and you type the one you want.
- **One Run control** for img2img / Inpaint / Outpaint with live stage + progress (waiting for Big Mac, upload, sampling step N/M only when sd-cli really reports it, transfer, failure stage + message, safe retry). A blocked Run explains why.
- **Inpaint** edits in source-image coordinates: Fit by default (whole image), 100%, zoom to 16×, pan (tool / Space / pinch), brush ring, undo/redo, grow/shrink/feather/blur/invert. The mask sent to the backend has the source's pixel size.
- **Fullscreen**: click any primary input/output image (Create hero, Edit source/result, Library thumbnails, compare, Enhance); selector strips select first and open fullscreen on the active thumbnail. Never inside the inpaint canvas. The viewer has "→ img2img / Inpaint / Outpaint" for that exact image.
- **Resources** (LoRA weights, trigger words, compatibility, VAE) are visible in Create and Edit; LoRAs are structured state serialized to `<lora:…>` by the server. The model picker is a searchable, family-grouped popover; the card browser is unchanged.
- **Layouts**: `A · Compact` / `B · Studio` over the same state (persisted in `localStorage.dex_edit_layout`). **Presets** are per operation, versioned (`v: 2`) and never store a source image; prompt text only when prompt saving is on.
- Per-image records live in `sdcpp-workflow/state/image-meta.json`. Details: `operator-console/docs/edit-workbench-20261002.md`.

## Voice profiles, long-form speech and Drama (rev 16)

- **Voice → Voices & long-form**: persistent profiles (cloned with several reference samples + transcripts, designed from a description, or a Kokoro preset), sample diagnostics, per-engine validation, an honest capability matrix, a per-render performance direction (only where the engine can honor it: VoiceDesign yes, Kokoro/Qwen Base no), and long-form text with no 2,000-character limit (paragraph/sentence/clause chunking, tags kept whole, crossfade + boundary pauses, one stitched canonical WAV with chunk lineage, failures read "failed at chunk 7/14: …").
- **Drama** (new nav item): paste a script → deterministic parse (or optional local-model parse that cannot rewrite dialogue) → review/correct lines → bind speakers to saved voices → render line / scene / project (every re-render is a new Take; you choose the active one) → assemble a scene or the whole drama into one WAV (optional music/ambience/SFX tracks). An **unsaved** script lives only in server memory; **Save project** is the explicit act that writes it to disk. Dialogue is never copied into job logs.
- **Where things live:** voice profiles `sdcpp-workflow/state/voice-profiles/<vp-id>/profile.json`, samples `…/samples/<sm-id>.wav` (MacBook only); Drama projects `sdcpp-workflow/state/drama/<dp-id>.json` (only when saved); generated speech and drama exports `/Users/andrew/audio_made/voice/` (id-served via `/api/media/:id`).
- Big Mac hosts compute and the loopback backend; every render is a normal job under the heavy-compute lease. Prompt/voice-prompt caching is not implemented (the installed Qwen runtime has no such API). Details: `operator-console/docs/voice-drama-20261002.md`.
- Tests: `cd operator-console && npm test` (unit/server), `npm run test:browser` (real Chrome, hermetic fixtures; the voice/drama suite uses your running state directory and cleans up after itself).

## Protected invariants (do not change)

- The node backend stays bound to **127.0.0.1:31337**. Never `0.0.0.0`, never LAN.
- Remote web access is **Tailscale Serve HTTPS :8443, tailnet-only**. **Never Funnel**
  for DexDiffusion. The separate DEX//REACH Funnel on `:443` is not ours; do not touch it.
- Big Mac is never exposed; the MacBook reaches it only via `ssh westcat`.
- Canonical originals belong on MacBook at `/Users/andrew/images_made`; Big Mac image files remain working/staging/pending artifacts until an individually verified publication record proves a MacBook write. Existing files are not retroactively relabeled.
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
| Edit workbench | `operator-console/public/dexdiffusion/{edit-core.js,edit-ui.js,lightbox.js}` |
| Voice / Drama | `operator-console/{voice-engines,voice-profiles,voice-service,voice-audio,long-form,drama,drama-service,voice-routes}.js`, `public/dexdiffusion/{voice-ui.js,drama-ui.js}` |
| Tests | `operator-console/tests/*.test.js` (`npm test`), `operator-console/tests/browser/` (`npm run test:browser`) |

## Recovering state (for a successor AI)

1. Read `OPERATIONAL_STATE.md` (evidence, failures, current baseline) and this file.
2. `git status` / `git log -5` (uncommitted `.resurrection/*` and `output/playwright/`
   are intentionally local-only).
3. `bin/dexdiffusion status`.
4. `curl -s http://127.0.0.1:31337/api/system-info` and `/api/capabilities`.
5. Trust live evidence over prose. Record drift in `OPERATIONAL_STATE.md` rather
   than rewriting its history.

## Revision 18 verification handoff

Current uncommitted repairs preserve feather alpha, show only backend progress, guard async image/job ownership, reject stale Drama profiles, remove rejected staged-image working copies, and apply attenuation-only speech levels consistently. The Detailer modal keeps progress/errors visible and contains keyboard focus. Final gates: 259/259 unit, Edit 21/21, Voice/Drama 7/7, chained 21+7; installed Brave override, natural exits, no test-owned process candidates. Acceptance remains VERIFIED WITH EXPLICIT BLOCKERS. See OPERATIONAL_STATE Revision 18 and output/rev18/BUGS.md for current evidence, preserved failures/exposures and unexercised live paths.

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

## Current product direction — V2 Studio is the only normal shell (2026-10-20, Arena branch)

**This supersedes the Workstation-first direction below/above only as the *current default*. Workstation/Concept A, V1 and V3 remain in the codebase as developer-only shells with their tests intact.** History is preserved; nothing was deleted.

- **Default landing:** DexDiffusion **Studio → Create**, for new and migrated profiles. `dex_version` is migrated once (marker `dex_studio_nav_migrated`); the previous version is recorded in `dex_legacy_version`. The version picker is hidden unless developer mode (`localStorage.dex_developer = '1'` or `?dev=1`).
- **Navigation:** exactly one chip row with 14 destinations in fixed order — **Create · Batch · Swap · Voice · Drama · Music · Video · World · 3D · Library · Edit · Enhance · Models · System** — defined once in `operator-console/public/dexdiffusion/studio-nav.js` and rendered into the shell. Group tints distinguish image / sound / motion / library-operations; they never imply that a mode works.
- **Honest unavailability:** **Swap** is a real destination with no approved backend, model or licence — it explains what is missing and starts nothing. **Video** remains non-executable until a verified generator exists. Neither may be represented as working.
- **Cancellation truth:** a job becomes `CANCELLED` only when it provably never started, or its exact registered worker was verified stopped. An unowned `RUNNING`/`TRANSFERRING` durable job is refused (`cancel-unsafe`), keeps its state and keeps its heavy-compute lease. `POST /api/jobs/:id/cancel` reports `accepted`, `neverStarted`, `terminationVerified`, `cancelState` and `remote_stop` separately.
- **Create actions:** `Generate image` starts exactly one job; a second click cannot restart or hide it. A separate `Cancel job` control is bound to the job id and shows `Stopping — checking the worker…` → verified / unverified / refused, never a green false success.
- **Source of truth for this work:** `docs/operations/arena-v2-studio-20261020/EXECUTION_LEDGER.md` (ticket status, gates, blockers) and the copied master instruction beside it.
- **Still open:** canonical source resolver and Library→Edit→Enhance→3D/World handoffs, Create layout/Advanced disclosure, the remaining control sweep, native V2 scroll evidence, and every native/worker/novice acceptance gate. None of these is claimed complete.

## Runtime recovery contract (2026-11-02 source checkpoint)

`bin/dexdiffusion start` separates SSH reachability from backend readiness. It accepts recovery only after an in-band marker follows the expected Big Mac API identity/cwd and Studio checks. The service installer must confirm launchd registration, API/Studio responses, and the listener process identity; a registered but unhealthy service is left untouched. The CLI uses exact ownership checks before signalling an SSH forward, one shared `lockf` recovery lock, a propagated 40-second recovery deadline, and bounded stage errors. The logged-in Aqua LaunchAgent remains the only live-supported service domain; reboot/logout and pre-login availability are not proven.

The native wrapper retries recoverable navigation failures at most twice per sequence. While a page is open, two failed frontend health probes show **Degraded** and request one bounded native-helper recovery; ordinary browser clients only see status and do not receive shell execution. WebKit success requires the Studio interface to initialize and render. These source changes are not live until separately deployed/installed and verified.

Native helper commands now run through `scripts/bounded-command.py`, which caps
captured output, enforces a timeout, and terminates/reaps only its owned process
group. The startup watchdog's two progress deferrals and stale-navigation guard
are executable Swift policy fixtures. These source-level tests do not prove the
installed app's runtime behavior.

**Storage contract:** the user-selected canonical original destination is `/Users/andrew/images_made` on MacBook. Big Mac `/Volumes/wc2tb/DexDiffusion/images` is working/staging/pending-publication storage. Source now includes a bounded cross-host outbox/worker flow, but it is not deployed; render completion alone is not canonical publication. Historical files and journals remain untouched. See the source-closure entry in `OPERATIONAL_STATE.md`.

## Persistent MacBook recovery controller — 2026-11-03

`local.dexdiffusion.recovery` is the single per-user MacBook recovery LaunchAgent.
It runs one bounded controller tick at login and every 60 seconds; it remains
active when the Studio window closes and runs again after the next login. The
Big Mac's existing `local.dexdiffusion.server` LaunchAgent remains the backend
process owner. The MacBook controller does not create another backend service
or replace that agent.

The controller records state in the user's DexDiffusion Application Support
directory with mode `0600`, rotates its structured JSON-lines log at 128 KiB,
and shares a kernel lock with simultaneous controller ticks. Only
`bin/dexdiffusion start` executes repairs, under its existing cross-process
`lockf` lock and ownership checks. JavaScript requests a controller tick after
two failed health probes; Swift forwards that request and displays the result.
Application launch still performs its explicit bounded startup check.

Policy defaults: two independently completed failures before an automatic
repair; at least 60 seconds between episodes, exponential cooldown up to 300
seconds plus 0–10 seconds of jitter; at most three automatic episodes in a
rolling 15 minutes; 105 seconds for the shell repair command (`__controller-start`)
and 180 seconds for the complete remote-diagnosis/repair/verification episode; circuit reset after
five minutes of continuously verified health or an explicit `recovery-retry`.
The healthy path requires the expected backend identity and a complete Studio
HTML body. A partial HTTP 200 is failure. The shell's Studio probe allows 15
seconds.

Before asking the shell helper to repair a tunnel, the controller checks SSH
authentication, remote API identity, a complete remote Studio transfer, the
resource arbiter, and active jobs. Unknown backend identity, foreign port
ownership, or missing SSH authentication is `BLOCKED`; a busy lease/job or
temporarily unavailable backend is `BACKOFF`. It never restarts a Big Mac
backend that it cannot verify healthy, never edits code/configuration or
permissions, and never changes credentials. The Big Mac launchd service owns
recovery from its own process exit. Canonical publication status is measured
and reported separately and never triggers connectivity repair. After a verified
healthy probe with pending items, the controller runs `publication-sync` (own lock,
90-second cap, 60–900-second backoff).

| Evidence | Classification | Automatic action | Maximum / verification |
| --- | --- | --- | --- |
| API identity passes; Studio body is slow, incomplete, or truncated | `STUDIO_TRANSFER_INCOMPLETE` | No backend restart; after two failures, ask the locked helper to verify/repair only the owned tunnel | 3 episodes/15 min; verify the full 200 response |
| Local port has no listener; remote backend and resource admission verify | `SSH_TUNNEL_ABSENT` | Create the exact project SSH forward with keepalives | 3 episodes/15 min; recheck listener, identity, full Studio |
| Exact owned tunnel fails while remote backend passes | `BACKEND_OR_TUNNEL_UNAVAILABLE` | Shell helper rechecks PID, full command, port ownership, then replaces only that tunnel | 3 episodes/15 min; PID/argv recheck and full Studio |
| Big Mac API/service is unavailable | `BACKEND_OR_TUNNEL_UNAVAILABLE` | Controller enters `BACKOFF`; Big Mac's registered KeepAlive LaunchAgent owns service restart | No MacBook service restart unless remote identity/Studio/resource checks pass |
| Foreign port owner or ambiguous backend identity | `FOREIGN_PORT_OWNER` / `AMBIGUOUS_BACKEND_IDENTITY` | `BLOCKED`; preserve listener and evidence | No automatic retry mutation; operator resolves ownership |
| SSH/Tailscale route or authentication unavailable | `SSH_AUTHENTICATION_UNAVAILABLE` | `BLOCKED`; no key, Tailscale, or security changes | Retry after connectivity/authentication is restored |
| Active resource lease, queued work, or active image job | `DEX_RESOURCE_OR_ACTIVE_JOB_BUSY` | `BACKOFF`; do not dispatch service/tunnel repair | Recheck on the next tick |
| Canonical publication pending/failed/blocked | Publication status, separate from recovery | Preserve outbox/journals; use the publication workflow only | Verify canonical identity independently |
| Missing dependency or filesystem permission failure | Backend/service unavailable until separately diagnosed | No package install or permission change | Use `bin/dexdiffusion doctor` and owner-specific logs |

Read-only diagnostics and explicit retry:

```sh
bin/dexdiffusion recovery-status
bin/dexdiffusion recovery-retry
scripts/install-recovery-agent.sh install
scripts/install-recovery-agent.sh uninstall
```

`recovery-status` reports the current probe, last verified time, failure class,
backend identity, tunnel ownership, full-transfer result, lock/episode state,
attempt count/circuit, native Swift source fingerprint, resource lease,
publication status, and any blocking reason. It does not repair or persist a
probe result. `recovery-retry` explicitly clears the automatic circuit and
still requires safe ownership, SSH, backend, transfer, and resource evidence.

The LaunchAgent is per-user and therefore has no pre-login guarantee. Source
policy and fixture tests cover sleep/network transitions through repeated
bounded ticks; this release does not claim a physical sleep/wake soak.

## November 2026 — MacBook Studio connection recovery diagnostics

If Big Mac `/api/version` and `/dexdiffusion/` both return HTTP 200 but MacBook Studio stalls, distinguish short API connectivity from complete Studio transfer. The source recovery launcher checks the full Studio response body, verifies the exact project-owned SSH port listener before any signalling, uses bounded SSH/backend readiness verification and keepalives, and serializes recovery callers through a kernel lock. The native wrapper must not interrupt a verified Studio bootstrap merely because a helper finishes late. Browser health changes to `degraded` only after two completed failed checks and requests native recovery with a cooldown. Historical `server-error.log` contents alone are not evidence of a current backend crash. Preserve all uncommitted work, pending publication journals, and media.

The November 3 source candidate's Brave/unit checks passed, but native MacBook Dock installation and long-run stability remain unverified until an explicitly fingerprinted production rollout. GitHub source publication does not itself update the installed `/Applications/DexDiffusion.app` or an unconfigured GitHub Pages website.

## Current topology and persistent recovery (2026-11-03)

```
MacBook (andrew)                                   Big Mac (bigmac, Aqua session)
/Applications/DexDiffusion.app (WKWebView)         gui/503/local.dexdiffusion.server
  -> bin/dexdiffusion (thin adapter)                 Node backend on 127.0.0.1:31337
  -> scripts/dexdiffusion-recovery-controller.py     MFLUX/SDCPP, resource arbiter
     (launchd gui/501/local.dexdiffusion.recovery,   working images + publication outbox
      every 60 s; the only recovery decision-maker)  on /Volumes/wc2tb/DexDiffusion
  -> owned ssh -L 31337:127.0.0.1:31337 westcat  <------------------------------+
  -> publication-sync -> /Users/andrew/images_made  (pull, verify, receipt, ACK)
```

**Storage contract.** `/Users/andrew/images_made` holds the canonical originals. A
successful Big Mac generation writes its working copy and a durable outbox record
(`PUBLICATION_PENDING`). The MacBook pulls it, checks size and SHA-256, links it into
place without overwriting anything, writes a receipt under
`~/Library/Application Support/DexDiffusion/publication-receipts/`, and POSTs an ACK.
Only then is the record `CANONICAL_VERIFIED`. Big Mac keeps its working copy; no
garbage collection is authorized.

**Recovery controller.** One launchd tick every 60 s (and every `start`/`open`/native
Retry) runs `scripts/dexdiffusion-recovery-controller.py` under one lock:

- Healthy means a verified backend identity plus a complete Studio transfer. When
  healthy, it changes nothing and, if anything is pending, runs `publication-sync`
  (own lock, 90 s cap, 60–900 s backoff). Publication failures never trigger repair.
- Repair needs two completed failed probes, an SSH-verified healthy and idle Big Mac,
  at least 60 s cooldown and at most 3 episodes per 15 min. It replaces only the
  project-owned tunnel, or repairs the Big Mac user service, and never touches a
  foreign listener or active inference.
- States are persisted in `~/Library/Application Support/DexDiffusion/recovery/state.json`
  (log `controller.jsonl`). A corrupt file fails closed (BLOCKED); an interrupted
  in-flight state becomes `INTERRUPTED_RECOVERY` and needs a fresh probe.

```bash
bin/dexdiffusion recovery-status          # read-only live diagnostic (JSON)
bin/dexdiffusion recovery-retry           # explicit manual retry; resets the circuit, keeps safety checks
bin/dexdiffusion publication-sync         # one-shot pull of pending images
scripts/install-recovery-agent.sh install    # idempotent; refuses to overwrite a different plist
scripts/install-recovery-agent.sh uninstall  # boots out and keeps the plist as .disabled-<stamp>
launchctl print gui/$(id -u)/local.dexdiffusion.recovery | egrep 'state =|runs =|last exit'
curl -fsS http://127.0.0.1:31337/api/publications/status
```

**Triage.** Status `BLOCKED` with `SSH_AUTHENTICATION_UNAVAILABLE`: fix SSH yourself;
nothing retries keys. `FOREIGN_PORT_OWNER`: something else holds port 31337, so
nothing is signalled. `CIRCUIT_OPEN`: three episodes failed; read `controller.jsonl`,
then use `recovery-retry`. Publication `RETRY_BACKOFF` or a `PUBLICATION_BLOCKED`
count: inspect the outbox record; a filename collision is never overwritten.

**Limits.** Big Mac's backend needs an Aqua login, because removable-volume access
fails from a system daemon (that daemon stays disabled). Physical reboot and logout
persistence are configured (RunAtLoad on both agents) but not yet exercised.
