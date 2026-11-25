# DexDiffusion reconstruction

## Baseline and preservation

The verified local bundle is under the MacBook Codex archives directory at
`dexdiffusion-pre-reconstruction-20261124/Image_Gen.bundle`. Its adjacent
`MANIFEST.md` records restoration, included refs, the exclusions and verification.
The main archive is `6538577953e6a9b211f1d96a0439d3c6bcd286ef`. The
reconstruction worktree uses `reconstruction/stable-foundation`, beginning with
preserved repair commit `8f0a80f`. The archive and original worktrees are separate.

## Capabilities

| Entry point | Intended behavior and dependencies | Restoration and verification |
|---|---|---|
| Create | Existing target and settings, shared compute lease, SDCPP or MFLUX engine, canonical publication | Synthetic path passed (ledger, corrupt output, failed writes, replay). Live on production `915495a` through Studio: FLUX.2 Klein, delivered to the MacBook Library. SD 1.5 and SDXL base text-to-image passed earlier through the installed worker. |
| Batch and plot | Numbered prompts and parameter sweeps using the image dispatcher and owned artifacts | Prompts-from-list passed live on production through Studio (two jobs, both delivered). Matrix and XYZ plot were not run live; synthetic checks passed. |
| Edit and Enhance | Reuse canonical source and lineage for image-to-image, masks, outpaint, transform, upscale and refinement | Live on production through Studio: SD 1.5 edit, SDXL edit, FLUX reference edit, Real-ESRGAN 4x, all delivered to the MacBook with matching readback. SD 1.5 outpaint and inpaint also passed, with every pixel outside the mask or new area (and its blend) unchanged. At 8 steps the inpaint did not follow the colour asked for and the outpaint shows a seam; output quality is not certified. From a MacBook-hosted console the SD 1.5 and SDXL edit scripts still fail (`img2img-remote-png`); production runs them on-host, so no routing change was made. |
| Library | Canonical image and media browsing, selection, downloads, collections and handoffs | Create-to-Library and canonical bytes passed in a synthetic workflow. Full browser suite also exercises Library browsing, collection workflows and handoffs. |
| Resources | Recipes, styles, macros, wildcard banks, and prompt reuse | Existing paths carried forward. Collections, recipes, macros, styles and wildcard writes now preserve prior data on a failed write. Focused and full portable checks exercise the corresponding stores. |
| Voice and Drama | Voice profiles and engines, script production, edit, render and export | Live on production through Studio: Kokoro speech; a two-line Drama cast with VoxCPM2 and Kokoro, produced, mastered, proofed and saved. Drama speech recognition QA is unavailable (reported by the app). Qwen voices and OpenVoice were not re-run. |
| Chat and prompt intelligence | Ollama-backed Chat and prompt review through the shared compute admission path | Live on production through Studio after the Ollama restart: one Chat reply (gemma3:4b) and one prompt enhancement applied in Create. Both wait for an empty Ollama: a model another client left loaded fails them after 30 s as `compute_unavailable`, and Chat shows only that code. |
| Music and video | Music and video workflows with worker-backed availability | Live on production: Magenta RealTime clip. ACE-Step admission is disabled in source at `6d48433`, not yet deployed (see below). Video has no installed generator and Studio says so. |
| 3D and Worlds | Library source handoff, worker capabilities, project storage and preview | Live on production through Studio: SHARP quick geometry, 360 world (normal PARTIAL label, viewer opened), Hunyuan3D mesh (preview opened). Textured mesh was not re-run. |
| Studio shell, themes and Mac app | Existing desktop/mobile layouts, workspace navigation and native WebKit launch | Mac app `915495a` installed on the MacBook November 24 and launched: Studio bootstrap verified, saved settings intact. Create, System, Audio, 3D, Models and Library opened natively. Mobile acceptance was not run. |

## Verification

Run focused checks for ordinary changes. Run `node operator-console/tests/affected-verification.js <last-green-ref> HEAD --list`
to inspect cumulative domain selection. The affected workflow chooses the last
successful ancestor on the reconstruction branch or falls back to the branch's
merge base with main. Unknown source impact selects shared dependents. Release
certification has separate console unit, browser and worker partitions. Candidate
certification requires all partitions against the same SHA, plus hardware and
native acceptance.

The repository is public. Workflows use standard Ubuntu runners. Receipts stay
in job logs and summaries without a persistent artifact or remote cache budget.
Production cutover requires separate approval.

The first affected workflow stopped at prerequisite setup. The revised workflow
passed setup. It reported 382/383 Node tests and 21/25 browser suites,
including 84/84 interaction-matrix cases. Follow-up fixes make model and LoRA
source cards work without the optional archive, invalidate the Library cache
after publication, and await the actual clipboard and Keeper UI results.
The follow-up Ubuntu run passed its worker and Node partitions and 24 of 25
selected browser suites. The clipboard test now synchronizes with the app's
completed-write notification and verifies the copied text and rejection fallback.
[Follow-up Ubuntu run](https://github.com/westkitty/Image_Gen/actions/runs/45478410938).

Revision `74336a0` passed Ubuntu affected verification (401 Node, 90 worker,
25 browser suites) plus all 62 full browser suites and 111 release-worker
and operations tests. Its full unit partition failed. The unit-only diagnostic
identified the test-owned transfer worker's hardcoded Mac Python path and a
terminal-write fixture failing at admission. The candidate fixes both fixtures
and records macOS-only Apple Vision coverage separately. Final cloud evidence
must match the new candidate tag.

[Affected run](https://github.com/westkitty/Image_Gen/actions/runs/45480996277) ·
[First certification](https://github.com/westkitty/Image_Gen/actions/runs/45481064947) ·
[Unit diagnostic](https://github.com/westkitty/Image_Gen/actions/runs/45483231724)

[First run](https://github.com/westkitty/Image_Gen/actions/runs/45474094350)
and [revised run](https://github.com/westkitty/Image_Gen/actions/runs/45475013685).

### Big Mac worker stall: cause and correction

The stalled file open was a macOS consent wait. At 12:49:42 MST on November 24 an
isolated MacBook console ran the SSH asset probe, whose `ls /Volumes/wc2tb` made
`tccd` prompt for Removable Volumes access on behalf of `tailscaled`
(`AUTHREQ_PROMPTING`, request 181.1697, never answered). Every later Removable
Volumes decision queued behind it. The worker's `open`, Ollama and Jellyfin hung.
EngineHost's own grant is intact: it was allowed at 12:48 and 12:49:03. The
orphaned probe processes were ended after identity checks. The owner answered
Don't Allow at about 15:26 MST. The stall cleared: worker health answers at once and
Jellyfin returned 200.

The installed worker made the stall total by probing under its lifecycle lock
(corrected in `d15e21a`). The SSH probe no longer opens the volume (`bc56755`).
Other user-triggered SSH tools (model header inspection, asset discovery and
inventory, legacy generation) still can. The recorded denial makes them fail
promptly instead of prompting again. SD 1.5 and SDXL edit scripts from a MacBook-hosted
console are in the same group; they report gate `img2img-remote-png` and the engine
log's "unknown format" hides the denied read.

`RECOVERY_BLOCKED` was separate. Big Mac panicked (kernel watchdog timeout) at
12:09 MST on November 23 and left a `backend-instance` record from the previous
boot. Owner records now carry the boot session. A record proven to predate the
current boot is archived as `backend-instance.ended-*` and the backend starts.
Same-boot, unprovable, symlinked, busy-worker and held-port cases stay blocked.
A read-only run of the new check on Big Mac recognises the real record as ended.
It was deployed with `fc6db5f` on November 24 and archived the real record byte-identical.

### Live acceptance after the prompt was answered

Isolated MacBook console at `fc6db5f`, installed worker, seed 424242: Klein 17 s,
SD 1.5 23 s and 19 s (identical bytes), SDXL base 376 s, Klein edit 15 s. The first
SD 1.5 attempt exceeded a 180 s harness limit and was cancelled cleanly. Earlier
jobs show 228 s followed minutes later by 18 s, so a cold external-volume load is
the likely cause, not proven.

### Cutover of November 24 (owner approved, `fc6db5f`)

Deployed per runbook section I: worktree on `release/reconstruction-20261124`, installed
worker equal to the commit blob, EngineHost unchanged. Restore point: Big Mac
`~/dex-cutover-20261124/` with `rollback.sh` (3d8b885; refuses if an engine is running).

- The first start selected **internal fallback**. TCC allowed EngineHost in 10 ms; the
  drive had been asleep (disksleep 10) and its first read outlasted the runner's 3 s limit.
- The fallback never seals idle. Its outbox holds one suspended publication from
  November 11 (`20261111-204034-...-s12347`), and the idle check counted it. The image is
  intact on Big Mac and byte-identical on the MacBook; only the acknowledgement is missing.
- Operator error: a second kickstart was issued before an idle seal was confirmed. The
  worker correctly refused to stop the backend, but launchd killed EngineHost after 20 s.
  The worker (pid 55563) is draining without that parent and still serves; EngineHost
  relaunches exit harmlessly on the worker lock.
- `915495a` corrects both defects: the first bounded read is 20 s, and a suspended
  publication does not hold an isolated fallback open. Every record is still validated.

### Recovery and production state, November 24

Production is `915495a` on external storage, started by EngineHost. The drill external
to fallback to external passed and the release doctor passes every check, including
`rollback_activation_proof`. It passed again after the live workflows.

- The suspended Nov 11 (UTC Nov 12 03:40) record was set aside, the fallback owner wrote
  `idle` then `drained`, and the worker stopped it. The record was restored byte-identical
  to its original path. No signal was sent to the backend.
- The idle seal is cleared by any HTTP request, so an open Studio tab keeps the backend
  busy. Close Studio before a handoff. With it closed, `kit/rollback.py` reports READY.
- Rollback is checked read-only and not executed. Its target `3d8b885` still has the 3 s
  probe and the undrainable fallback.
- `REMOTE_ESRGAN_MODEL` was set only in the MacBook's untracked `sdcpp.env`, so Real-ESRGAN
  failed at gate `config` on Big Mac. The line was added to the Big Mac `sdcpp.env` (backup
  `sdcpp.env.before-esrgan`) and to the tracked example. No code or restart was needed.

| Workflow | Job | Seconds | Result |
|---|---|---|---|
| Klein create | `222c529b` | 22 | `20261124-232138-...` |
| SD 1.5 edit | `3447f334` | 187 | sha `d39a48c2` |
| SDXL edit | `aab1b2db` | 299 | sha `bef3a260` |
| Reference edit | `2a39464e` | 28 | sha `4871d354` |
| Real-ESRGAN | `e9ee8dc0` | 62 | 2048 px, sha `da413d39` |
| Kokoro | `d336eaa3` | 13 | 2.1 s, sha `6b93408d` |
| Magenta | `f18ae5a1` | 29 | 4 s, sha `c13fd006` |
| Drama | `7ef3aac8` | 191 | 3.9 s master, sha `d2c2d521` |
| Quick 3D | `3279b81a` | 105 | 66 MB PLY, sha `1ec18562` |
| 360 world | `aea068eb` | 247 | 21 artifacts; memory stayed at or above 45% free, no swap |
| Mesh | `5000e739` | 175 | 6.8 MB GLB, sha `df2abc20` |
| Chat | `12816087` | 5 | gemma3:4b, temporary mode |
| Prompt enhancement | `6e4aef65` | 12 | applied in Create |
| Batch from list | `cf2af2c3`, `43a6b397` | 18 each | `20261125-001351-...`, `20261125-001410-...` |
| SD 1.5 outpaint | `1199c12e` | 190 | 640x512, sha `15ad5e11` |
| SD 1.5 inpaint | `2c909229` | 16 | 512x512, sha `e487f288` |

### Ollama restart, November 24

With the owner at the screen, one graceful SIGTERM through launchd at 17:08:25 MST replaced
pid 782 (deleted 0.40.17 binary) with pid 26076 (0.40.18). One Removable Volumes prompt for
`ollama` appeared and the owner chose Allow. The six documented models are listed,
`OLLAMA_NOPRUNE=1` and the model path are unchanged, and the launch agent file is
byte-identical. Nothing was downloaded or pruned. The grant names the 0.40.18 Cellar path,
so a Homebrew upgrade of Ollama will probably prompt again; do it at the screen. After the
last workflow the release doctor passed all 19 checks and the rollback check was READY.

### ACE-Step and the November 23 panic

The panic at 12:09 MST came 6.5 minutes into a 30 s ACE-Step song (job `e5ea1a1b`). The
panic report shows a Python process holding 37.8 GB on this 32 GiB host, 11 swap files and
low swap. The link is strong but the process was not identified by name. ACE-Step was not
run, because an unplanned reboot takes down the other sites on this host. Studio still
offers it as PROVEN. The song's record was closed as interrupted on the first external
start; no backend was running when the cutover began.

Open items:

1. Deploy `6d48433` so ACE-Step is refused (owner approval for one restart). Until then
   production `915495a` still lists ACE-Step as PROVEN and would accept a song job: do not start one.
2. Not run live: matrix and XYZ plot, textured mesh, Qwen voices, OpenVoice. Video runtime is not installed.
3. Chat and prompt enhancement need an empty Ollama; otherwise `compute_unavailable` after 30 s.
4. Storage integrity reports 1071 missing and 463 valid image records. Every missing record is
   dated November 6 or earlier, plus one old fixture. The owner's `images_made_nah` folder is in
   a Google Drive archive. That they are the same files is suspected, not confirmed. No record was deleted.
5. Opening the Library in the Mac app loads about 100 full-size images (`_libThumb` uses `url`,
   not the existing `thumbnailUrl`). For about 90 s the health probe waits behind them and Studio shows
   "Connection lost". It clears by itself; the backend and tunnel stay healthy.
6. Rollback is checked READY and has not been executed. Its target `3d8b885` accepts ACE-Step.

### ACE-Step containment

No configuration or capability switch existed. `6d48433` adds `DISABLED_WORKERS` in `media.js`: the
media bridge refuses `ace-step` (`worker-disabled`, 409) before any job, lease or remote call, the probe
reports TEMPORARILY DISABLED with the reason, and Studio disables Generate. Runtime, models and bridge
are untouched; removing the entry re-enables it. Magenta is unchanged. The internal fallback refuses
ACE-Step already, because it probes no music runtime. `engine-worker.py` and the supervisor are unchanged.

### MacBook app install, November 24

The staged archive (`0ea71e9a...`) was verified and installed with the installer's own swap, rollback and
Dock steps; it was not rebuilt. One Dock tile, same order; one Launch Services registration. The previous
app (`18245241`) is kept as `retired-launchers/DexDiffusion-previous-20261124-200313.app.retired` and as a
zip that was extracted and passed signature verification. The app runs `bin/dexdiffusion` from this
worktree (`~/Image_Gen-reconstruction-20261124`), so keep the worktree. The generation check planned inside
the app was not run; no job was submitted from it.

## Native staging and rollback

From a clean reconstruction checkout, set `DEXDIFFUSION_STAGE_ARCHIVE` to an
unused absolute zip path and run `scripts/install-macos-app.sh`. The installer
compiles, stamps, signs and verifies the same bundle it would install, then
writes the zip before touching Applications, Dock or Launch Services. Extract
to an isolated directory to check its signature and stamped SHA. This stage mode
leaves the installed app alone.

Revisions `dcab33a` and `4c40a28` bootstrapped Studio in real WebKit using an isolated console,
test bundle identifier and loopback-only launcher helper. The same revision
published three synthetic images, replayed admissions without duplicate work
and recovered an accepted pre-dispatch job as interrupted across restart.
Dock launch and the installed production entry point remain separate checks.

For an approved cutover, preserve the installed bundle, its checkout identity
and Dock preferences first. Use the existing installer from the verified
checkout. It preserves the prior bundle under the retired-launchers directory
and neutralises archived bundle registration. Rollback restores the prior
bundle, including renaming `Contents/Info.plist.retired` to `Info.plist` if
present, re-registers that bundle and verifies the prior console identity with
`bin/dexdiffusion status` and `GET /api/version`. Keep the candidate and prior
working trees intact. A zip build and verification do not exercise Dock launch
or live hardware.

The installer's automatic rollback (failure injected after the bundle swap) and the
documented manual rollback were rehearsed in an isolated Applications, home and
Dock-preference fixture. Both restored the prior bundle's bytes and signature.
Launch Services, the real Dock and the production entry point were not exercised.

## Continuation

The open items above are the whole list. Big Mac still holds `~/.dex-accept-bc56755`
(isolated acceptance root, worker stopped, no images retained). It can be deleted.
