# DexDiffusion reconstruction

> **Historical record. The current state is [RELEASE_1.0.0.md](RELEASE_1.0.0.md)** (production and Mac app `6c89afb`, November 25).
> "Production is", "not deployed", "not run" and "Open items" below were true when written. Every deployment step here
> has been carried out or superseded; do not run one from this file.

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
| Music and video | Music and video workflows with worker-backed availability | Live on production: Magenta RealTime clip. ACE-Step admission is disabled in production (`6d48433`, see below). Video has no installed generator and Studio says so. |
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

1. ACE-Step stays disabled until its memory use on a 32 GiB host is understood. Re-enabling is one entry in `media.js`.
2. Not run live: matrix and XYZ plot, textured mesh, Qwen voices, OpenVoice. Video runtime is not installed.
3. Chat and prompt enhancement need an empty Ollama; otherwise `compute_unavailable` after 30 s.
4. Storage integrity reports 1071 missing and 463 valid image records. Every missing record is
   dated November 6 or earlier, plus one old fixture. The owner's `images_made_nah` folder is in
   a Google Drive archive. That they are the same files is suspected, not confirmed. No record was deleted.
5. Opening the Library in the Mac app loads about 100 full-size images (`_libThumb` uses `url`,
   not the existing `thumbnailUrl`). For about 90 s the health probe waits behind them and Studio shows
   "Connection lost". It clears by itself; the backend and tunnel stay healthy. Corrected in a candidate, not deployed (below).
6. Rollback is checked READY and has not been executed. Its target `3d8b885` accepts ACE-Step.

### ACE-Step containment

No configuration or capability switch existed. `6d48433` adds `DISABLED_WORKERS` in `media.js`: the
media bridge refuses `ace-step` (`worker-disabled`, 409) before any job, lease or remote call, the probe
reports TEMPORARILY DISABLED with the reason, and Studio disables Generate. Runtime, models and bridge
are untouched; removing the entry re-enables it. Magenta is unchanged. The internal fallback refuses
ACE-Step already, because it probes no music runtime. `engine-worker.py` and the supervisor are unchanged.

### Production is `6d48433`, November 24

Deployed through runbook section J with no override and no EngineHost restart (pid 75667 throughout, worker
`7d2ffcb18f59` unchanged). The release gate passed 20/20 for `6d48433` from a separate worktree while `915495a`
was still running and matched its files.

| Handoff | Revision | Result |
|---|---|---|
| Crossing `32e70c`, 19:31:45 to 19:32:02 MST | left `915495a`, arrived `6d48433` | seq 25 to 32 |
| Proof drill `90f81f`, 19:32:16 to 19:32:25 MST | `6d48433` both ways | seq 33 to 40 |

- Backend 55192, external storage. Release doctor PASS 19/19, including `rollback_activation_proof` for `6d48433`.
- `/api/workers`: ACE-Step TEMPORARILY DISABLED, generate false. The deployed `media-bridge.js` refuses it in
  `start` and `startBatch`, the only two entries to the bridge, before any job or lease. Magenta PROVEN, generate true.
  ACE-Step was not executed and no request was submitted; refusal rests on that code and the certified tests.
- Fallback records and the 617 MacBook publication receipts are byte-identical; staging empty.
- **Rollback re-enables ACE-Step** unless the target contains `6d48433`: see the end of runbook section J.
- Rollback: `kit/rollback.py` READY (to `3d8b885`, which accepts ACE-Step). The nearer target is `915495a` by
  section J, branch `release/reconstruction-20261124`. Neither was executed.
- MacBook app: installed `915495a`. `native/`, `bin/` and `scripts/` do not differ from `6d48433`, so it was not
  reinstalled; `bin/dexdiffusion status` reports the source fingerprint MATCHES and labels the stamp OUTDATED.
  It was launched against `6d48433`: six live connections through the tunnel, signature valid, one Dock entry.

### Earlier refused attempt, November 24

The owner approved a gated backend restart, with a logged override for the rollback proof only. The deployed
worktree was staged on a new branch, `release/reconstruction-20261124-6d48433`. The doctor then reported
`backend_revision` BLOCKED (the running `915495a` does not match the staged tree) as well as the three
expected UNVERIFIED items. BLOCKED cannot be overridden, so nothing was restarted and no override was logged.
The worktree was returned to `release/reconstruction-20261124` at `915495a`. The doctor passes all 19 checks,
the backend (78176) and EngineHost (75667) are the same processes, and the idle seal is fresh.

Cause: `--restart` runs the gate and restarts in one step, and the gate requires the running backend to equal
the worktree. It can restart the current revision but cannot activate a new one, so runbook section G's
"cutover" wording does not hold. Earlier cutovers used the section I worker kickstart, which also replaces
EngineHost. The owner handoff (external to fallback to external) would start the staged revision without
replacing EngineHost. Neither was inside this approval.

### MacBook app install, November 24

The staged archive (`0ea71e9a...`) was verified and installed with the installer's own swap, rollback and
Dock steps; it was not rebuilt. One Dock tile, same order; one Launch Services registration. The previous
app (`18245241`) is kept as `retired-launchers/DexDiffusion-previous-20261124-200313.app.retired` and as a
zip that was extracted and passed signature verification. The app runs `bin/dexdiffusion` from this
worktree (`~/Image_Gen-reconstruction-20261124`), so keep the worktree. The generation check planned inside
the app was not run; no job was submitted from it.

### Audio waveform and text flicker (`90a2d0b`, superseded, never release)

The first version redrew a full-screen path and repainted page text every frame, decoded the whole file (about 530 MB
for a moment on a 240 s WAV), was on by default, and had no off switch. Its measurements (9% to 93% of a core on a
loaded MacBook) are in git history. It is still in `reconstruction/stable-foundation`; **do not release that branch
head**. The replacement is the waveform candidate below.

## Optimization candidates, November 25 (both now in `6c89afb`)

Production stays Big Mac `6d48433` and MacBook app `915495a`. Two independent branches, each in its own worktree.
Everything used synthetic images and audio; the real Library was not opened. Harnesses and raw results:
receipts folder `optimization-20261125/`.

### Library thumbnails: `reconstruction/library-thumbnails`, `aab8701` (on `6d48433`), superseded by `e4cf195`

Cause, reproduced: the mixed-media grid (`_libThumb`, up to 120 images) used each full-resolution `url`, and
`/api/library` gave it no thumbnail. The originals took all six connections to the backend, so `/api/version` waited,
two probes hit their 12 s limit, and Studio said "Connection lost" with a healthy backend.

Change (two lines): `/api/library` image items carry `thumbnailUrl` as the other two lists do; the grid uses it and
passes the original in `data-fullscreen-src`, so the viewer and its edit actions still get full resolution.

120 synthetic 2.8 MB PNGs, MacBook image service, both links limited to 4 MB/s, 1280x800:

| | Image requests, traffic | Health probes answered | Median, worst | "Connection lost" |
|---|---|---|---|---|
| WebKit before (75 s) | 115 full, 313.7 MB, 110 of 120 loaded | 0 of 13 | none answered | at 40.7 s |
| WebKit after (60 s) | 120 thumbnails, 2.8 MB, all loaded | 57 of 57 | 4 ms, 3.0 s (cold thumbnails) | never |
| Chrome before (60 s) | 115 full, 290.7 MB | 12 of 12, late | 22.4 s, 52.3 s | at 41.2 s |
| Chrome after (60 s) | 120 thumbnails, 2.8 MB | 58 of 58 | 4 ms, 1.6 s | never |

Returning to the Library requested nothing again. A second idea was tried and rejected: setting `loading="lazy"`
before `src` makes WebKit honour lazy loading, but Studio rebuilds that DOM often, so the same 104 thumbnails were
requested 923 times and never stayed loaded. The grid stays eager at 23 KB an image, capped at 120.

Focused checks for `aab8701`: CI affected verification 45552672300 passed. `edit-upload`, `folder-first-library`/
`library-organize` and the last `macbook-images` test fail locally in the same way without the change (the MacBook has
no Pillow for the last three); CI ran what it covers.

### Library release candidate: `e4cf195` (on `aab8701`)

`aab8701` had a regression: dragging a grid image handed over the thumbnail. Measured in WebKit by intercepting the drag
before it reaches the system and reading the promised file: `6d48433` gave the original (1024x1024 PNG, 2,784,732
bytes); `aab8701` gave a 384x384, 23,384-byte JPEG named `....png.jpeg`, without the metadata.

Download links are not a substitute in the Mac app. With its navigation policy (only `/api/media/<id>/download` becomes a
download) an image Download link replaces Studio with the raw image. This was seen in a WebKit replica of that policy, not
in the installed app; it is the same at `6d48433` and is not corrected here. So the drag itself is preserved.

`lightbox.js`: while the mouse rests on a grid thumbnail for 150 ms, or presses it, the original lies over it and is what
a drag, "Save image" or "Copy image" takes. One original at a time, low priority, dropped or cancelled when the pointer
moves on. A drag begun before it has arrived is refused with a message; it never hands over the thumbnail.

| WebKit, synthetic | Result |
|---|---|
| Drag after resting | the original, 2,784,732 bytes, two images of two; one request each, 120 thumbnails otherwise |
| Immediate press, original delayed 600 ms | no drag, message shown |
| Real Chrome drag to a drop target (browser test) | refused, then the original address once loaded |

Behaviour differences from `6d48433`:

1. A drag needs the original to have arrived. A quick grab on a slow link is refused once, with a message.
2. "Copy image" from the context menu before the original arrives is not guaranteed to be the original. "Save image" and
   "Copy image address" are, because they use the address.
3. Touch: long-press on a grid image gives the thumbnail. Open the viewer for the original.
4. The other Library grid (Images) already used thumbnails for browsing and dragging in `6d48433`; unchanged.
5. Resting the pointer on an image downloads that one original.

Focused checks for `e4cf195`: `library` 13/13 (new test: nothing fetched while browsing or passing over, one original
for the image in hand, refused and accepted drags, context menu, no second request after a re-render, viewer and focus),
`v2-parity-library-flow` 8/8, `studio-source-handoff` 1/1, `source-hover` 10/10, `transform` 4/4,
`studio-connectivity-recovery` and `omni-viewer-inspector` exit 0. The benchmark above is reused: the load path is
unchanged since `aab8701`.

**Certified November 25:** commit `e4cf1956074be57b3ad439602605974143200125`, tag
`reconstruction-candidate-20261125-e4cf195`, release certification 45569881630 passed on the first attempt: unit gate
2 of 2 steps, browser gate 62 of 62 (library 13/13, v2-parity-library-flow 8/8, v2-parity-music 12/12), worker 97 and 21
tests. Affected verification 45569877955 passed on the same commit. Nothing was rerun.

The checkpoint branch's own CI failed once (45565845321, `drama-studio`: a production row did not appear within 5 s). That
commit changes two documents only, and the suite passed in the certification above. The cause was not investigated.

### Waveform: `reconstruction/waveform-economy`, `ff4daf5` (on `d882883`)

Measured cost of the old version by leaving parts out, in points of one core over audio alone: the per-frame path fill
about 8, its outline about 11, text repainting about 26, the loop 1. Canvas resolution made no difference.

Now: each four-second strip is drawn once (1280x512) and slid under the playhead at 15 to 22 Hz. Byte spans of four
seconds around the playhead are read one at a time with low priority, and only when playback has run half a second
undisturbed with six seconds buffered; a seek or a low buffer drops the read. At most six strips of data are kept.
Files that are not WAV are decoded only up to 6 MB and 10 minutes, at 8 kHz. Text flicker is a separate switch, on
visible text only, at most three changes a second and without the glow. Both are off until chosen in System > Audio
visuals or the command palette, persist, stop at once, and never run in a hidden window or with Reduce Motion.

Visible WebKit, isolated Studio, the same synthetic 240 s stereo WAV, off and on alternated four times, medians
(`ab-1.txt` to `ab-4.txt`; `med.py` reproduces them). Points of one core added over audio alone with the feature off.
Compositor is all of WindowServer, so other apps disturb it. 0 media events (waiting, stalled, seeking), drift within
4 ms everywhere:

| Run | WebKit | Compositor | Sum | fps, off to on |
|---|---|---|---|---|
| Old, round 1 | +42.7 | +11.9 | +54.6 | 28.5 to 26.6 |
| Old, round 2 | +54.0 | +13.8 | +67.8 | 29.1 to 27.6 |
| Old, round 3 | +32.1 | +19.7 | +51.8 | 28.8 to 29.2 |
| New waveform, round 1 (earlier draft) | +2.4 | +7.6 | +10.0 | 29.2 to 28.6 |
| New waveform and text, round 1 (earlier draft) | +3.9 | +9.2 | +13.1 | 29.2 to 29.2 |
| New waveform, round 2 (noisy: compositor 32 with it off) | +1.1 | +21.3 | +22.4 | 28.5 to 27.6 |
| New waveform and text, round 2 (noisy) | +5.7 | +8.1 | +13.8 | 28.5 to 27.6 |
| New waveform, round 3 (earlier draft) | +1.6 | +11.2 | +12.8 | 29.1 to 29.1 |
| New waveform and text, round 3 (earlier draft) | +6.0 | +11.5 | **+17.5** | 29.1 to 28.9 |
| **As committed**, waveform, round 4 | +1.6 | +6.1 | +7.7 | 29.1 to 29.6 |
| **As committed**, waveform and text, round 4 | +2.6 | +7.7 | +10.3 | 29.1 to 29.1 |

The drafts differ from the commit mainly in when they read spans. The commit itself was measured in one round of four, with a
compositor baseline of 10, so its smaller compositor figure may be flattered.

| | Result |
|---|---|
| Memory | medians +33 to +36 MB for the waveform and +40 to +47 MB with text (+70 and +100 in the noisy round); about the same for 240 s and 3600 s files; 243 to 265 MB with no trend over 3.5 minutes; back to within about 15 MB of the start when off. Seek-heavy runs reached 300 to 355 MB, one sample 538 MB, then fell |
| Reads | largest 768 KB; the whole file is never read or held (`blob:` included) |
| Slow link, 600 kB/s, 3600 s file | steady playback drift 0 with it on. After bursts of seeks playback re-buffers with it off too (up to 0.6 s lost) and on (up to 1.4 s); four of eight phases each |
| Off switch, pause, hidden, Reduce Motion | overlay, animation and data gone at once; the sound continues |

Against the targets: no drift and no stalls in normal playback, memory bounded by construction, immediate release.
CPU: under 15 points in every round counting WebKit alone. Counting the compositor, the waveform is under in every
quiet round and as committed; waveform and text reached 17.5 in round 3, so that target is **met only in part**. What
is left is WindowServer compositing a translucent full-screen layer, which scales with the frame rate, and the text
repaint. Not demonstrated: the native app itself, a 60 Hz
display, real audio through the tunnel, VoiceOver, the macOS Reduce Motion switch (the query was overridden), and any
photosensitivity assessment beyond the rate limit. So it stays off by default.

Focused checks: `audio-wave` unit 7/7 and browser 7/7; CI affected verification 45564004341 passed. The ablation, memory, read and slow-link figures were read from
console output; the receipts keep their scenarios and harness, not every raw row.

### Deploying the Library candidate (done November 25, superseded by `6c89afb`)

`OLD` = `6d48433c4393162e207e352cda96271c50cd340f` (production, certified 45524196726, branch
`release/reconstruction-20261124-6d48433` on Big Mac). `NEW` = `e4cf1956074be57b3ad439602605974143200125`, tag
`reconstruction-candidate-20261125-e4cf195`. `W` = `~/Image_Gen-wc2tb-20261120`, untouched so far.

Five files differ from `OLD`: `server.js` and `workstation-ui.js` (one line each), `lightbox.js`, two tests. Identical:
all of `sdcpp-workflow/` (worker `7d2ffcb1...`, supervisor `f04a921b...`), `native/`, `bin/`, `scripts/`, `package.json`,
the lockfile, `media.js` and `media-bridge.js` (ACE-Step containment). No waveform file or reference; neither `90a2d0b`
nor `ff4daf5` is an ancestor. So section J applies, no EngineHost restart and no Mac app build is needed.

Section J step 1 is done, read-only, against a separate clone (`~/dex-cutover-20261125-library/target` on Big Mac, not
a worktree of production): PASS in all 20 checks. It must be repeated at the time of deployment.

1. Owner approves. Studio and the Mac app closed, no job running, no music submitted during the fallback legs.
2. Repeat the gate: `bash $W/scripts/release-gate.sh --expect-revision NEW --target-worktree ~/dex-cutover-20261125-library/target`.
   Then `git -C $W fetch origin tag reconstruction-candidate-20261125-e4cf195` (objects only; no checkout).
3. Seal: `kit/wait_idle.py`. `request-worker-backend.sh --handoff-fallback --expect-revision OLD --reason "library release"`.
4. While the fallback runs: `git -C $W switch -c release/library-20261125-e4cf195 NEW`. Check HEAD, clean, worker digest.
5. `--return-external --expect-revision NEW`.
6. One round trip with `--expect-revision NEW` both ways. Doctor PASS in every check.
7. Check `/api/version` is `e4cf195` and `/api/workers` shows ACE-Step not enabled, Magenta enabled. Reopen the app (its
   pages come from the backend). Library check by request counts only, no images captured.

**Rollback target: `6d48433`** by the same steps exchanged (`git -C $W switch release/reconstruction-20261124-6d48433`
during a fallback leg). It contains the ACE-Step containment, so this rollback keeps ACE-Step disabled. Do not use
`kit/rollback.py` (its target `3d8b885` accepts ACE-Step) or any bare older revision. The fallback package itself has no
refusal, so nothing is submitted while it runs.

The waveform candidate is not part of this. It stays at `ff4daf5`, undeployed, with its figures and limits above.

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

Closed on November 25. `e4cf195` and then `6c89afb` were deployed, the waveform was included off by default, native
downloads were corrected and the Mac app was installed from `~/Image_Gen-release`. See [RELEASE_1.0.0.md](RELEASE_1.0.0.md).
Still true: never release `reconstruction/stable-foundation`; ACE-Step stays disabled.
