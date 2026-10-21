# DexDiffusion Human Acceptance

## Before you begin

- [ ] Click **DexDiffusion** in the Dock. No Terminal should be required.
- [ ] Confirm the **Workstation** opens with the Dexter logo, the module rail, the canvas, and the Inspector.
- [ ] In **Settings → System**, confirm the running build is the current published `main`. This acceptance build was prepared from baseline `b493643ec937325c2d183bd72f3d53496a664eae`.
- [ ] If useful, find the fresh acceptance image in Media: `20261005-214701-controlled-flux2-klein-4b-s51005-controlled-flux2-klein-4b.png`.

## 1. Workstation

Judge the whole first impression.

- Does this feel like one coherent app?
- Is the Dexter branding right?
- Can you immediately understand where things are?
- Does anything feel visually chaotic?

- [ ] PASS
- [ ] ISSUE: 

## 2. Generate

- [ ] Open **Generate** and inspect the canvas-first layout.
- [ ] Enter a prompt if desired; a new render is optional.
- [ ] Inspect the model/settings, Help, and contextual Inspector.
- [ ] Open or inspect the fresh red-rocket acceptance result.

Judge whether the main action is obvious, the result has enough visual priority, settings are understandable, and anything important feels buried.

- [ ] PASS
- [ ] ISSUE: 

## 3. Edit

- [ ] Send or open an image in **Edit**.
- [ ] Inspect the controls, zoom/pan behavior, contextual Inspector, and source/result distinction.
- [ ] Confirm the source and lineage context are clear.

An Edit render is optional.

- [ ] PASS
- [ ] ISSUE: 

## 4. Media

- [ ] Open **Media** and find the fresh red-rocket asset.
- [ ] Select it and inspect its metadata, lineage, Collections, and available actions.

Does Media feel like the canonical asset home? Can you tell where the asset came from and what can happen next?

- [ ] PASS
- [ ] ISSUE: 

## 5. Voice

- [ ] Inspect **Voices & Long-form**, **Quick**, profile presentation, and capability clarity.

Synthesis is optional.

- [ ] PASS
- [ ] ISSUE: 

## 6. Music

- [ ] Inspect the creative-direction area, result area, worker/capability area, ACE-Step and Magenta status, and clearly marked Planned states.

Does it feel powerful without pretending to be a digital audio workstation it is not?

- [ ] PASS
- [ ] ISSUE: 

## 7. 3D Assets

- [ ] Inspect the layout and capability truth.

Generation is optional.

- [ ] PASS
- [ ] ISSUE: 

## 8. World Viewer

- [ ] Inspect the viewport, layout, and navigation.

Generation is optional.

- [ ] PASS
- [ ] ISSUE: 

## 9. Drama

- [ ] Inspect the real script/audio workflow and the treatment of Planned features.

- [ ] PASS
- [ ] ISSUE: 

## 10. Settings / Help

- [ ] Inspect capability truth, Help Center, tutorials, keyboard shortcuts, and storage/system state.
- [ ] Confirm storage distinguishes current problems from preserved historical missing references.

- [ ] PASS
- [ ] ISSUE: 

## 11. Global systems

- [ ] Open the command palette.
- [ ] Open Help.
- [ ] Expand and collapse the Queue dock.
- [ ] Open the full Job Center.
- [ ] Switch among several modules.

Does the shell remain understandable throughout?

- [ ] PASS
- [ ] ISSUE: 

## 12. Narrow layout

- [ ] If practical, resize the window narrower.
- [ ] Note anything irritating, clipped, or unreadable.

- [ ] PASS
- [ ] ISSUE: 

## Final acceptance

Choose exactly one:

- [ ] ACCEPT
- [ ] ACCEPT WITH ISSUES
- [ ] BLOCKED

What annoyed me?


What confused me?


What felt especially good?


What should be fixed before we call DexDiffusion finished?


---

# Studio first-run acceptance (2026-10-20) — supersedes the Workstation script above as the default path

> The Workstation script above is retained as history. Normal users now open **Studio → Create**; Workstation is developer-only.
> **HUMAN ACCEPTANCE NOT RUN** — this section is the script to run, not a result.

## Facilitator script (read exactly this)

> "This is DexDiffusion Studio. Use it to make or work with something. Please say aloud what you expect each button to do. I cannot teach you the interface during this test."

Answer questions only after recording that the participant could not proceed; count any answer as assistance.

## Tasks

| # | Task | First correct action (s) | Completed | Help needed |
|---|---|---|---|---|
| 1 | Find **Create** (the app should already be there) | | YES / NO | NO / YES |
| 2 | Identify the prompt field and the model | | YES / NO | NO / YES |
| 3 | Generate one image (only when a real worker is authorized) | | YES / NO | NO / YES |
| 4 | Say where the image was saved / find it in Library | | YES / NO | NO / YES |
| 5 | Open the result in **Edit** | | YES / NO | NO / YES |
| 6 | Find **Enhance** | | YES / NO | NO / YES |
| 7 | Locate **Jobs** and explain what **Cancel job** really means | | YES / NO | NO / YES |
| 8 | Find **Swap** and say whether it works right now | | YES / NO | NO / YES |
| 9 | Return to Create without losing the draft | | YES / NO | NO / YES |
| 10 | Recover from a visible error (e.g. unplug the service) | | YES / NO | NO / YES |

## Specifically watch for

- Does a first-run profile ever show a version picker, Workstation, or a project-setup step? (It must not.)
- Are all 14 chips visible and in order: Create · Batch · Swap · Voice · Drama · Music · Video · World · 3D · Library · Edit · Enhance · Models · System?
- Clicking **Generate image** twice must never start a second job or hide the first.
- **Swap** must say it is not enabled and must issue no network request.
- A cancelled job must not be described as stopped unless the worker confirmed it.
- Any button that looks clickable but does nothing is a release blocker; record its label.
- Scroll position, text caret and the focused field must survive a job-status update.

## Record

Participant code: ______  Date/time: ______  App stamp (HEAD): ______  Profile: fresh / existing
Input: mouse / trackpad / keyboard  Local service: ______  Big Mac: ______
Outcome: PASS / FAIL / BLOCKED — blocking defects: ______________________
