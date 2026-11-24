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
| Create | Existing target and settings, shared compute lease, SDCPP or MFLUX engine, canonical publication | Simulated worker through real Create, job ledger, publication, Library and UI passed. Corrupt output and failed ledger writes exercised. A dropped HTTP response replayed the same durable job without a second run. Big Mac submission was accepted; installed-worker health timed out before inference. No real artifact was produced. |
| Batch and plot | Numbered prompts and parameter sweeps using the image dispatcher and owned artifacts | Existing paths carried forward. Synthetic Chat modes and shared compute checks passed. Live Ollama and prompt enhancement pending. |
| Edit and Enhance | Reuse canonical source and lineage for image-to-image, masks, outpaint, transform, upscale and refinement | Synthetic Edit request validation and Library source handoff passed across Create, Enhance, 3D, and World. Real image-edit inference pending. |
| Library | Canonical image and media browsing, selection, downloads, collections and handoffs | Create-to-Library and canonical bytes passed in a synthetic workflow. Other Library flows pending. |
| Resources | Recipes, styles, macros, wildcard banks, and prompt reuse | Existing paths carried forward. Collections, recipes, macros, styles and wildcard writes now preserve prior data on a failed write. Focused synthetic checks passed. Domain verification pending. |
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

The installed Big Mac worker timed out at its Unix socket from both the
isolated candidate and a direct client. Process sampling showed a request
blocked in file open while other handlers and the supervisor waited. The
attempted image job failed before it owned a remote run. The candidate moves
health reads outside the lifecycle lock and limits them to one concurrent probe.
Image generation queries lifecycle readiness without opening every model.
The worker, supervisor and retention suites passed 51 local synthetic tests,
and the stalled-read regression passed under the installed Big Mac Python
with synthetic input. Production worker recovery and live inference remain open.

## Native staging and rollback

From a clean reconstruction checkout, set `DEXDIFFUSION_STAGE_ARCHIVE` to an
unused absolute zip path and run `scripts/install-macos-app.sh`. The installer
compiles, stamps, signs and verifies the same bundle it would install, then
writes the zip before touching Applications, Dock or Launch Services. Extract
to an isolated directory to check its signature and stamped SHA. This stage mode
leaves the installed app alone.

Revision `dcab33a` bootstrapped Studio in real WebKit using an isolated console,
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
