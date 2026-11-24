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
| Create | Existing target and settings, shared compute lease, SDCPP or MFLUX engine, canonical publication | Simulated worker through real Create, job ledger, publication, Library and UI passed. Corrupt output and failed ledger writes exercised. A dropped HTTP response replayed the same durable job without a second run. Live FLUX.2 Klein passed through the isolated candidate console and worker on Big Mac: ledger, canonical bytes, Library readback, admission replay and verified remote cancellation. Through the installed EngineHost worker: FLUX.2 Klein, SD 1.5 and SDXL base text-to-image passed with canonical bytes and Library readback. |
| Batch and plot | Numbered prompts and parameter sweeps using the image dispatcher and owned artifacts | Existing paths carried forward. Synthetic Chat modes and shared compute checks passed. Live Ollama and prompt enhancement pending. |
| Edit and Enhance | Reuse canonical source and lineage for image-to-image, masks, outpaint, transform, upscale and refinement | Synthetic Edit request validation and Library source handoff passed across Create, Enhance, 3D, and World. Live FLUX.2 Klein image-to-image from a published Library image passed on the isolated candidate worker. Klein image-to-image also passed on the installed worker. SD 1.5 edit failed from a MacBook-hosted console, whose edit scripts run the engine over SSH without volume access. The same scripts run on-host through `bin/on-host/ssh` when the backend runs on Big Mac, which is unverified until that backend starts. |
| Library | Canonical image and media browsing, selection, downloads, collections and handoffs | Create-to-Library and canonical bytes passed in a synthetic workflow. Full browser suite also exercises Library browsing, collection workflows and handoffs. |
| Resources | Recipes, styles, macros, wildcard banks, and prompt reuse | Existing paths carried forward. Collections, recipes, macros, styles and wildcard writes now preserve prior data on a failed write. Focused and full portable checks exercise the corresponding stores. |
| Voice and Drama | Voice profiles and engines, script production, edit, render and export | Existing paths carried forward. Synthetic production and safe cancellation passed. Simulated unavailable Kokoro blocked a cast Drama project while Create, Library and shared compute admission remained usable. Installed engine verification pending. |
| Chat and prompt intelligence | Ollama-backed Chat and prompt review through the shared compute admission path | Existing paths carried forward. Synthetic Chat modes and shared compute checks passed. Live Ollama and prompt enhancement pending. |
| Music and video | Music and video workflows with worker-backed availability | Existing adapters carried forward. Dormant or unavailable workers need to be identified in current runtime evidence. |
| 3D and Worlds | Library source handoff, worker capabilities, project storage and preview | Synthetic Library handoff and world workflow passed. SHARP, Hunyuan3D and panorama inference pending. |
| Studio shell, themes and Mac app | Existing desktop/mobile layouts, workspace navigation and native WebKit launch | Source carried forward. Synthetic Create and Library references captured. Native Swift type-check passed. Staged build, native launch and mobile acceptance are separate gates. |

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

Open gates, in order:

1. Owner decision: release the stuck fallback. Either set the one stale record aside and
   restore it afterwards, so the backend seals and the worker drains itself, or reboot
   Big Mac. Do not kill the backend: without a seal its same-boot owner record blocks.
2. Start external mode on `915495a` once certified. Run the fallback drill again.
3. Ollama restart with the owner at the Big Mac screen. Pid 782 runs the deleted 0.40.17
   binary; models are at `/Volumes/wc2tb/DexDiffusion/models/ollama`, `OLLAMA_NOPRUNE=1`.
   Attribution is likely, not proven. An unanswered prompt would stall EngineHost.
4. SD 1.5 and SDXL edits, Chat, Voice, Drama, Music, Video, 3D and Worlds.
5. MacBook app replacement (separate decision). Staged at `915495a`.

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

1. Owner: answer the `tailscaled` removable-volume dialog on the Big Mac screen.
   Don't Allow is recommended.
2. Then, read-only: confirm the installed worker answers `backend-status` and
   `health`, and that Ollama and Jellyfin respond.
3. Remaining live acceptance needs the external volume: SDXL and SD 1.5 Create and
   Edit, Ollama Chat and prompt enhancement, voice, music, video, 3D and Worlds.
4. Owner approval for cutover: deploy `engine-worker.py` and the checkout containing
   `backend-supervisor.py` together, restart EngineHost's worker, confirm the prior
   owner record is archived and 31337 is served, then run a new fallback drill
   because the rollback proof is revision-bound.

Big Mac still holds `~/.dex-accept-bc56755` (isolated acceptance root, worker stopped,
no images retained). It can be deleted.
