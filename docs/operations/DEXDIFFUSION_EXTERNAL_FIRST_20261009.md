# DexDiffusion external-first storage audit — 2026-10-09

**Execution state: BLOCKED at macOS volume privacy.** This is a fresh, direct Big Mac / MacBook read-only storage inventory plus a bounded MacBook health-reporting code change. No model weights were moved, downloaded, deleted, or switched. No model generation was attempted.

## Governing storage contract

- MacBook remains operator/UI, project state, and durable generated-media owner (`/Users/andrew/images_made` and `/Users/andrew/audio_made/`).
- Big Mac is compute only; `wc2tb` is the preferred home of bulky model weights and cold caches.
- **Protected internal exception:** `$HOME/Library/Caches/DexDiffusion/mflux/flux2-klein-4b-4bit` and `.../mflux/venv`. Previously observed Metal watchdog failures from external full-precision FLUX.2 and external venv I/O make this the proven internal hot path. Do not move it to satisfy external-first policy.
- Never declare a model PROVEN from path existence or a historical pass while the current execution path cannot read its weights. Do not touch other services, Tailscale Funnel, or canonical media.

## Fresh Big Mac filesystem evidence

- Target fingerprint: `bigmac@bigmac`, Apple Silicon, /Users/bigmac.
- APFS Data volume available: approximately **17 GiB**. External `/Volumes/wc2tb`: mounted and approximately **254 GiB available** (from live df, before any migration).
- **Access gate:** listing `/Volumes/wc2tb` and child model directories fails with `Operation not permitted` from DEX//REACH, normal `ssh westcat` (tailscaled), and the already-running Apple `sshd` service on port 2222. The latter was authenticated from MacBook after its host-key fingerprint matched Big Mac's public host key; it is not a working bypass.
- Mounted path, Unix mode bits, file size via stat, and symlink existence are **not evidence of file-content read access**.

| Asset | Observed Big Mac location | Exact bytes or size | Current action |
|---|---|---|---|
| FLUX.1 Schnell FP8 checkpoint | `/Users/bigmac/sdcpp-staging/models/flux1-schnell-fp8.safetensors` | 17,236,328,572 bytes | External migration candidate after access restored; full SHA and compatible live generation still pending |
| Photonic Fusion SDXL | `/Users/bigmac/sdcpp-staging/models/photonic_fusion_sdxl_finale_v1.safetensors` | 6,938,043,264 bytes | External migration candidate; source full SHA-256 below |
| FLUX.2 Klein 4-bit hot model | `/Users/bigmac/Library/Caches/DexDiffusion/mflux/flux2-klein-4b-4bit` | about 4.3 GiB (du) | **Keep internal** |
| MFLUX Python environment | `.../mflux/venv` | about 1.1 GiB | **Keep internal** |
| MFLUX hub/cache | `.../mflux/hub` | about 4.3 GiB | Investigate genuine file identity and loading dependency; no assumed redundancy |
| Voice Python environment | `.../voice/venv` | about 1.2 GiB | Keep internal for now; external model weights already configured |
| Music environments | `.../music/` | about 2.2 GiB total | Keep internal for now; external model weights already configured |
| stable-diffusion.cpp source/build | `/Users/bigmac/stable-diffusion.cpp` | about 840 MiB, build about 245 MiB | Low-priority separate migration candidate; preserve functional build |

**Photonic Fusion original full SHA-256:** `3d781844e3cb1968e1ba96e87969e8699e8a1b08e35df04ab8880b25eb816b41`.

Existing migrated checkpoints SD1.5, SDXL Base, SDXL Turbo resolve from internal symlink names to `/Volumes/wc2tb/ImageGen/checkpoints/`. The active secondary model LUSTIFY APEX V8 points to `/Volumes/wc2tb/dex-imagegen/models/checkpoints/lustifyNSFWCheckpoint_apexV8.safetensors`. External weights for Kokoro/Qwen, ACE-Step, Magenta, and Hunyuan3D are configured under `/Volumes/wc2tb/generative-models/`; their current content cannot be inspected through remote workers. Do not mistake this for absence.

## Applied safety correction in MacBook working tree

The previous `/api/doctor` returned `wc2tb mounted = PASS`, SD1.5 = PASS, Kokoro/Qwen workers = PROVEN while a real Qwen audition failed with `PermissionError`. We amended:

- `operator-console/capabilities.js`: in-band **actual directory listing** probe, `wc2tbReadable`. External target/worker assets cannot be promoted solely from stat/existence when this probe fails. Internal Klein and Photonic paths remain individually eligible.
- `operator-console/media.js`: external-dependent voice/music workers are disabled and identify `MODEL INACCESSIBLE (wc2tb)`, without erasing historical proof evidence.
- `operator-console/server.js`: doctor exposes a separate `wc2tb readable by SSH worker` gate.
- `operator-console/tests/capabilities.test.js`, `.../tests/media.test.js`: denial regression checks.

Verified: fresh `probeAssets` yielded mounted true, readable false, Klein model true, external SD1.5 false, Qwen VoiceDesign false, internal Photonic true. Focused tests 22/22; full `npm test` 615/615, zero skipped; syntax checks and `git diff --check` clean. Original source snapshots and hashes before these edits: `/Users/andrew/Image_Gen_rescue/external-access-20261009.dZHCjz/`. Only the project-owned, idle DexDiffusion console was restarted; `/api/version` checked its root/HEAD and `/api/doctor` now returns overall FAIL with the correct volume block. No commit or push.

## Migration when host access legitimately becomes available

1. Confirm normal DexDiffusion worker `ssh westcat` can **read model file content** (not only stat/ls), with the MacBook-bound existing heavy-compute lease idle. This requires the macOS privacy grant for the intended worker; **do not disable TCC, alter its database, change mount identity, or substitute a process's unintended privileges**.
2. Recheck both disks, free headroom, running model processes, symlink ownership and exact target paths. Refuse if the external volume is not readable **and writable** through the intended authorized worker.
3. **Photonic first:** copy to a new, collision-free `wc2tb` checkpoint destination. Compare full source/destination SHA-256 to `3d7818...` and exact byte count. Preserve internal original intact.
4. Repoint only the intended Photonic model reference/symlink through the existing model/source contract. Perform a real Photonic SDCPP image generation with valid canonical MacBook output and remote cleanup. If it fails, restore the prior reference (the original is retained).
5. **FLUX.1 Schnell FP8 second:** compute full source hash (remote hash attempt timed out; NOT verified), copy/checksum, update only its mapped target, prove exact model loading and a real correctly formatted nonblank generated image. Historical FLUX.1 proof was unresolved; **do not claim a pass merely from a successful copy**.
6. Evaluate MFLUX hub/cache with exact hashes, dependency and offline-resume tests before considering any relocation. Retain known-good internal primary 4-bit model and runtime.
7. Optionally evaluate voice/music runtime relocation only as a separate compatibility experiment. Model weights already have external-first configured paths.
8. Remove old originals **only after** full checksum parity, actual runtime proof, rollback path and a fresh deletion/mutation evidence gate. Until then they stay.

**Blocked requirement:** The app's own external model reader is denied by the OS; no validated external copy, cutover or reclaimed-space claim is possible yet. Human Big Mac privacy approval remains the legitimate boundary. The user has expressly declined screen sharing, and this project must not work around OS privacy consent.

## Permission architecture decision — 2026-10-09

**User requirement:** Grant external-volume access to a dedicated DexDiffusion application identity on Big Mac, **not** broad Full Disk Access to `tailscaled`, general SSH servers, or DEX//REACH. Preserve Tailscale for network transport only. Prefer a macOS Files & Folders **Removable Volumes** grant before considering broader Full Disk Access.

Observed: Big Mac currently has no `/Applications/DexDiffusion.app` or `DexDiffusion Worker.app`; MacBook is the sole DexDiffusion GUI/control owner. Tailscale-SSH, native sshd (port 2222), and DEX//REACH read attempts on Big Mac all failed for `/Volumes/wc2tb` with `Operation not permitted`. Granting permissions to the existing MacBook app will not authorize Big Mac model processes.

**Revised authorized design target (NOT YET IMPLEMENTED):** Big Mac dedicated, stable-identity, user-owned `DexDiffusion Worker.app` launches/owns model-reading processes. The worker must request the normal macOS removable-volume permission through an honest app-level prompt, then prove it can read model bytes; no TCC database edits, privilege escalation, host-permission bypass, or raw arbitrary command service. Communicate with MacBook through an authenticated, narrowly allowlisted local IPC endpoint transported over existing tailnet/SSH, with no public listener or new cloud dependency. Before integration, prove child model processes retain effective authorized access. Protect the internal FLUX.2 Klein runtime, existing canonical MacBook media and old SSH workflow until all real image and voice gates pass. No custom worker was built, installed, authorized, or enabled by this entry. Owner interaction with macOS may still be required to grant privacy consent.
