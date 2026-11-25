# DexDiffusion 1.0.0

The current release. Where an older document disagrees, this one is right. Recovery: `docs/WC2TB_RECOVERY_RUNBOOK.md`.

| | |
|---|---|
| Release commit, tag | `6c89afb5cee30a27c68e6847db934284c8a37296`, `v1.0.0` (also `reconstruction-candidate-20261125-6c89afb`) |
| Big Mac production | `6c89afb`, external storage, `~/Image_Gen-wc2tb-20261120` on `release/dexdiffusion-1.0.0-6c89afb`, since November 25, 05:18 MST |
| MacBook app | `/Applications/DexDiffusion.app` at `6c89afb`, root `~/Image_Gen-release` (detached at the release; keep it, the app runs its `bin/dexdiffusion`) |
| Rollback target | `e4cf195`, branch `release/library-20261125-e4cf195` on Big Mac, by runbook section J |
| Authoritative branch | `main`. Later commits than the tag change documents only |

## Evidence

- Certification 45609593028 on the exact commit, first attempt: unit, browser and worker partitions passed. Affected
  verification 45609589072 passed. Nothing was rerun.
- Deployment by section J: gate PASS for `6c89afb` with no override, crossing, then proof drill `e2b24ecca459` on
  `6c89afb` both ways. Release doctor PASS 19/19. Worker and supervisor unchanged, EngineHost (75667) not restarted.
  `e4cf195` was deployed the same way earlier that morning (drill `01543ff8301d`, doctor PASS 19/19).
- Rollback: the release gate also passes for `e4cf195` from a separate clone while `6c89afb` runs, and `e4cf195` holds
  the ACE-Step containment. The way back was not executed; it is the same procedure that ran twice that day.
- Live on `e4cf195` through headless Studio, synthetic prompts (the engine code is the same in `6c89afb`): XYZ plot 2
  cells and grid, prompt matrix 2 cells and grid, Qwen voice design (80 s), Qwen voice clone (116 s), OpenVoice
  conversion (15 s), Kokoro (13 s), textured mesh (594 s, 16.5 MB GLB with a material and a texture, free memory never
  under 69%; 1.8 GB of swap was in use right after). Every artifact's bytes matched its recorded SHA-256. Sound and
  picture quality were not judged.
- Live on `6c89afb`: FLUX.2 Klein image, delivered to the MacBook byte-identical; waveform present and off; ACE-Step
  not enabled, Magenta enabled, every other worker as listed below.
- Library, live: 120 thumbnails, 7.4 MB, 11.4 s cold to the first screen, 16 of 16 health probes answered, never "Connection
  lost"; the original is laid over a resting thumbnail; export bytes equal the canonical file; Edit handoff opens the image.
- Phone and tablet layout (390x844, 768x1024): 13 screens on production, no horizontal overflow, no render error.
  Emulated in headless Chrome, not a device.

## Inventory (frozen)

A: operational and verified. D: deliberately unavailable. E: outside this release.

| Capability | | Disposition |
|---|---|---|
| Create, Batch, prompts from list, Matrix, XYZ | A | live |
| Edit: image-to-image, inpaint, outpaint, reference edit, upscale | A | live earlier; inpaint and outpaint quality not certified |
| Library, viewer, downloads, drag, handoff to Edit | A | live; drag needs the original to have arrived |
| Resources (recipes, styles, macros, wildcards) | A | certified browser suites |
| Voice: Kokoro, Qwen clone, Qwen design, VoxCPM2, OpenVoice | A | live |
| Drama | A | live earlier; speech recognition QA is unavailable and says so |
| Music: Magenta RealTime | A | live earlier |
| Music: ACE-Step | D | disabled in source after the November 23 panic; runtime and models kept |
| Video | D | no runtime installed; Studio says so and Generate is disabled |
| Chat, prompt enhancement | A | live earlier. A refusal now names the cause and the way out |
| 3D: quick geometry, mesh, textured mesh, 360 world | A | live |
| Audio waveform, text flicker | A | included, both off by default, Reduce Motion wins. No photosensitivity claim is made |
| Mac app: startup, navigation, downloads | A | see below |
| Phone and tablet layout | A | emulated |
| Full A1111 parity | E | 266-row ledger: 80 complete. The rest is recorded there and is not release scope |
| 1,071 image records with no file | E | historical, dated November 6 or earlier. Kept, not repaired; the originals are in the owner's archive (suspected) |

## What changed since `e4cf195`

1. **Mac app downloads.** Only `/api/media/<id>/download` became a download; every image, export and blob link replaced
   Studio with the raw file (reproduced in the shipped delegate, off screen). Links with a `download` attribute and
   attachments from Studio are now saved; an error response is refused, not saved under the image's name; an interrupted or cancelled
   download leaves no partial file; File > Cancel Downloads in Progress; a download that ends after the window closed no
   longer touches a missing label. Test: `native-download.test.js` (macOS only; CI skips it).
2. **Chat and enhancement.** "compute_unavailable" became the condition and the recovery step. Admission, arbitration
   and unloading are unchanged: a model another app loaded is never unloaded. No external model was loaded to show it live.
3. **Waveform** from `ff4daf5`, only its own files.

Native evidence for `6c89afb`: 13 scenarios in the off-screen harness (twice); the same source against production saved a
synthetic image twice, byte-identical, with Studio kept, then loaded the Library (120 thumbnails). The bundle's
signature, source fingerprint, root, single Dock tile and single registration are verified. **Not done:** the
installed bundle was not launched, because the owner was using the desktop. Its first launch is the owner's.

## Never release or go back to

`reconstruction/stable-foundation` (`d882883`, old waveform on by default) · `915495a`, `3d8b885`, `774815d` or the v2
fallback package as a working state (they accept ACE-Step) · `kit/rollback.py` (its target is `3d8b885`). Frozen recovery
branches are untouched. `reconstruction/*` branches and worktrees are preserved evidence.

## Verifying without disturbing anyone

- Browser behaviour: headless Chrome through `tests/browser/helpers.js`. Read counts and timings from the real Library,
  never its images. Use synthetic prompts; delete temporary voice profiles.
- Native behaviour: compile `ImageGenApp.swift` minus its main block with `tests/fixtures/native-download-harness.swift`;
  `CFFIXED_USER_HOME` moves Downloads to scratch. Never call `ensureServicesThenLoad` or `showMainWindow` from a harness:
  they build and show the app's window.
- `bin/dexdiffusion status` reads the installed identity. Doctor and gate are read-only. An open Studio clears the idle seal.
- Never open `/Volumes/wc2tb` over SSH (it raises a consent prompt on Big Mac). Never submit an ACE-Step job to test its refusal.

## Known limitations

- Chat and enhancement need an empty Ollama; they wait 30 s, then explain and stop.
- A Homebrew upgrade of Ollama will probably ask for Removable Volumes access again; do it at the screen.
- The MacBook image and recovery services run from `~/Image_Gen` (the owner's checkout, with uncommitted work), not from
  the release folder. Unchanged by this release.
- `drama-studio` failed once in CI (45565845321) on a documents-only commit and passed in both certifications.
- Touch long-press on a grid image gives the thumbnail; open the viewer for the original.
