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
| Create | Existing target and settings, shared compute lease, SDCPP or MFLUX engine, canonical publication | Simulated worker through real Create, job ledger, publication, Library and UI passed. Corrupt output and failed admission exercised. Big Mac submission was accepted; installed-worker health timed out before inference. No real artifact was produced. |
| Batch and plot | Numbered prompts and parameter sweeps using the image dispatcher and owned artifacts | Existing paths carried forward. Domain verification pending. |
| Edit and Enhance | Reuse canonical source and lineage for image-to-image, masks, outpaint, transform, upscale and refinement | Existing paths and preserved repairs carried forward. Domain verification pending. |
| Library | Canonical image and media browsing, selection, downloads, collections and handoffs | Create-to-Library and canonical bytes passed in a synthetic workflow. Other Library flows pending. |
| Resources | Recipes, styles, macros, wildcard banks, and prompt reuse | Existing paths carried forward. Collections, recipes, macros, styles and wildcard writes now preserve prior data on a failed write. Focused synthetic checks passed. Domain verification pending. |
| Voice and Drama | Voice profiles and engines, script production, edit, render and export | Existing paths carried forward. Explicit Drama fault isolation and engine verification pending. |
| Chat and prompt intelligence | Ollama-backed Chat and prompt review through the shared compute admission path | Existing paths carried forward. Domain verification pending. |
| Music and video | Music and video workflows with worker-backed availability | Existing adapters carried forward. Dormant or unavailable workers need to be identified in current runtime evidence. |
| 3D and Worlds | Library source handoff, worker capabilities, project storage and preview | Existing paths carried forward. Domain and installed worker verification pending. |
| Studio shell, themes and Mac app | Existing desktop/mobile layouts, workspace navigation and native WebKit launch | Source carried forward. Synthetic Create and Library references captured. Native and mobile acceptance pending. |

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

Active work is diagnosis of the Big Mac worker timeout, affected verification, and the Drama isolation experiment. The first affected workflow run stopped at prerequisite setup; the next revision provisions missing Ubuntu tools. The previous interrupted aggregate run does not qualify the present
candidate. No production runtime is certified by this document.
