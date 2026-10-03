# Rev18 current closure report — v17, 2026-10-03

## A. Verdict

**VERIFIED WITH EXPLICIT BLOCKERS; NOT VERIFIED COMPLETE.** Six of eight original acceptance blockers are CLOSED within the scopes below. Wedged Apple Neural Engine behavior and exhaustive interaction coverage remain UNVERIFIED. No new confirmed production defect was found on these paths. Existing D-009–D-026 repairs remain uncommitted and preserved.

## B. Newly fixed defect

**D-027 — TEST/HARNESS DEFECT:** a 250 ms DOM poll could miss the transient Sampling step 3/10 label. MutationObserver captures actual rendered stages from before submission; exact stage and canonical-completion assertions are retained. Added real reference upload edge cases, both operation preset round trips, and saving-off storage inspection. Own newly added preset assertion mistakes were corrected after root-cause inspection; v14–v16 failures are retained. See BUGS.md and closure-v17-live-acceptance.md.

## C. Original blocker states

| Original blocker | Final state | Evidence / boundary |
|---|---|---|
| 1. Inpaint full live tool sequence | CLOSED | Paint/erase/undo/redo/grow/shrink/feather/blur/invert/clear, Fit/100%/zoom/pan; real four-step canonical render, recall/details and both presets. |
| 2. Detailer hand with wedged Neural Engine | UNVERIFIED | Ordinary native hand checks pass; safe controlled wedge unavailable. Historical timeout retained; no system process killed. |
| 3. Voice live invalid references | CLOSED | Real uploads: malformed/short/silent reject at their gates; clipping accepted with diagnostic warning. New real browser regression. |
| 4. Long-form tags/failure | CLOSED | Actual three-chunk tagged render; real first chunk then controlled chunk-2 failure; explicit failure, no artifact, normal retry succeeds. |
| 5. Drama remaining interactions | CLOSED | True narration, scene-only render/assembly, saved reassignment and UI reopen; failed second line resumes alone, first take preserved. |
| 6. Privacy browser storage | CLOSED | Both storage areas inspected in actual isolated browser before/after reload with saving-off canaries and positive persisted-preset control; personal profile/global privacy not certified. |
| 7. Big Mac full-server transport cleanup | CLOSED | Real remote allocation then worker transport failure; terminal failure/no artifact/lease release; six exact directories absent by in-band markers. |
| 8. Exhaustive accessibility/interaction | UNVERIFIED | Representative fresh browser/live checks pass; all modal/popover/keyboard/typography combinations across viewports/shells not exhaustively measured. |

## D. Fresh final automated gates

| Gate | Command | Final result |
|---|---|---|
| Server syntax | npm run check | PASS, exit 0 |
| Full unit | npm test | PASS 259/259, zero failures/skips, exit 0 |
| Edit browser | npm run test:browser:edit | PASS 22/22, exit 0 |
| Voice/Drama browser | npm run test:browser:voice | PASS 8/8, exit 0 |
| Chained browser | npm run test:browser | PASS 22+8, exit 0 |
| Relevant static | Seven bash -n scripts, two Python compile checks, both browser node --check | PASS; see closure-v17-final-static.json |
| Whitespace | git diff --check | PASS before final documentation; final post-documentation receipt in closure-v17-diff-check.json |

Browser suites use installed Brave via DEX_BROWSER_PATH and unique DEX_BROWSER_OUTPUT_DIR destinations. Existing prior snapshots/logs were not overwritten. Browser suites include controlled endpoints for some generation flows; they do not replace the actual Big Mac live cases. v17 browser/static/unit receipts and raw logs record commands and exit status. Earlier unsuccessful attempts have explained harness causes and remain historical evidence.

## E. Live acceptance

Full mask controls plus real four-step 640×384 Inpaint, current canonical recall/details, and Inpaint/Outpaint preset restoration succeeded. Voice malformed/short/silent gates and clipping warning contract were exercised through real endpoints and browser uploads. Actual tagged three-chunk render, second-chunk failure and retry succeeded. Drama true narration, scene-only render/assembly, saved reassignment/reopen and partial second-line retry were observed; first take preserved. Full server transport loss after real worker allocation failed explicitly with no canonical output and released its lease. Remote in-band markers prove six exact owned directories absent, four historical logs preserved. Detailed IDs, limitations and screenshots: closure-v17-live-acceptance.md and closure-v14-*.json/png.

Current normal console PID 24747 binds only 127.0.0.1:31337. Resource owner null, waiting empty, external occupied false; generic job snapshot has no active jobs. The new canonical Inpaint exists locally (2578 bytes). Owned temporary fault wrapper removed after evidence capture; normal runtime no longer uses it.

## F. Changes in this continuation

Only operator-console/tests/browser/edit-workbench.browser.js and voice-drama.browser.js changed code in this continuation. Their prior rev18 changes were retained. Updated BUGS.md, acceptance-blockers.md, FINAL_REPORT.md and files-changed.md; appended OPERATIONAL_STATE.md. Added closure-v14–v17 receipts/screenshots, retained failed attempts, and a separate closure-v17 checksum manifest. No production source changed in this continuation; previous production repairs remain in the dirty diff.

## G. Genuine remaining risks / unknowns

Wedged-service behavior and exhaustive modal/popover/keyboard/typography matrix remain UNVERIFIED. Installed-LoRA rendering remains ENVIRONMENT BLOCKED (none installed). Original canonical disappearance remains unexplained; history was not recreated. Four historical pre-repair raw remote prompt logs remain exposed and preserved. Storage/privacy proof is scoped to actual isolated browser tests and designated fresh local files, not the personal browser profile or blanket privacy certification. Kokoro tag transport success does not prove expressive interpretation. Unsaved Drama partial-retry fixture vanished on normal restart; captured evidence remains. Browser control limitations are classified, not repaired in product code.

## H. Git

Branch rev17-verification-handoff; HEAD efd9cdc3785fc73652f7fc7d816c5b3496858db4. Working tree remains dirty: 29 tracked paths and 4 untracked status entries (three tests plus output/rev18 directory). No commit/push/merge/rebase/deploy/reset/clean or main mutation.

## I. Review / commit readiness

**READY FOR REVIEW of the bounded uncommitted repair/evidence set.** Automated gates pass. A commit may record this partial acceptance state after review; it must not claim rev18 complete. No publication performed.

---

# Preserved historical report (v13; superseded by current closure above)

# Rev 18 verification and repair handoff

## A. Verdict

**VERIFIED WITH EXPLICIT BLOCKERS**

Eighteen confirmed defects repaired in an uncommitted diff. Final mandatory automated gates pass. Expanded live acceptance remains incomplete; historical raw-log exposure is preserved.

## B. Bugs

The following ledger records reproduced evidence, root cause, repair and validation. A passing test establishes only its stated scope.

| ID | Severity / feature | Reproduction and root cause | Repair / validation |
|---|---|---|---|
| D-009 | High / mask feather | Extracted backend MASK_PY converted alpha `[0,1,64,128,255]` to `[0,255,255,255,255]`. Any nonzero alpha was binarized. | Preserve alpha as L grayscale, count nonzero coverage, reject conversion failure. Executed actual MASK_PY regression; captured live inpaint mask contains all 256 levels. |
| D-010 | High / redaction | Quoted multiline Unicode canaries escaped inside JSON survived line filters; three paths had competing sanitizer copies. | Shared helper handles ASCII/Unicode JSON escaping; server, XYZ, MFLUX migrated. Escaped-canary regressions pass. |
| D-011 | Medium / Edit progress | `decode_first_stage completed` changed Decoding back to Generating because decoded was not handled by deriveStage. | Retain Decoding until actual transfer/validation. Stage regression passes. |
| D-012 | Medium / Drama profiles | Removing or invalidating a bound profile retained an actor reference and failed too late. | Resolve profile IDs on every view/render. Service tests and saved live project invalidation: persistent BOB warning and HTTP 400 before job creation. |
| D-013 | Medium / Create and Batch progress | Percentages came from elapsed time; poll errors disappeared indefinitely. Real Create sampling log was not read. | Backend stages/counts only, sequential bounded polling, controlled-generation real log tail. Live Create job 1f8a0461… reported 2/4 = 50%, then UI Decoding; completed both exact siblings. Log-reader and poll tests pass. |
| D-014 | Medium / browser lifecycle and fixture ownership | Baseline Voice suite reached 7 checks but remained alive 5 minutes; old cleanup deleted every matching ZZ profile/project; later chained fixture creation timed out. | Bounded cleanup requests, phase trace, only new fixture IDs, locator instead of stale handle, wait for rendered preset form and confirmed name state. Natural fresh individual/chained exits; initial hang root cause remains UNKNOWN. Optional DEX_BROWSER_PATH permits isolated installed Brave when Chrome stalls under host pressure. |
| D-015 | Medium / touch controls | Enabled Create/Models/Library controls measured below 24px. | Minimum 32px desktop, 44px phone/coarse, checkbox/radio label area. Main surface matrix remeasured. Edit Studio cells measured overflow only. |
| D-016 | Medium / speech loudness | Single shot retained roughly -9 to -11dBFS peaks while stitched long form boosted quiet speech to -1dBFS. | Both preserve delivery levels and only attenuate peaks above -1dBFS. Unit policy tests; live single peak -8.79/RMS -26.63 vs long -8.12/-26.16dBFS. |
| D-017 | Medium / JSON image corruption | Prompt `cat` or `dog` changed matching bytes in encoded image strings. | Parse JSON and redact textual fields while preserving images/b64_json. Binary-preservation regression passes. |
| D-018 | High / remote prompt retention | Fresh saving-off Create, img2img, Inpaint and Outpaint left raw remote tokenizer logs. Local redaction did not control remote files. | Saving-off remote generation logging goes to /dev/null; streamed local logs still use shared redaction. Fresh later image/edit/detailer canaries absent. Four pre-repair remote exposures preserved and classified; no historical logs deleted. |
| D-019 | High / delivery privacy | VoiceDesign direction persisted verbatim in durable media `meta.delivery.requested` despite saving off. | Persist requested/applied booleans; full direction stays in ephemeral response. Actual bridge-store privacy regression and live Qwen direction canary scan pass. |
| D-020 | Medium / Detailer accessibility | Dialog lacked modal role, focus containment, Escape close and return focus. | Dialog semantics, initial focus, Tab wrapping, Escape close and opener restoration. Browser checks and representative live modal verification pass. |
| D-021 | Medium / Detailer progress | Submitting closed the modal, removing all visible operation progress. | Keep modal until completion with actual backend stages, persistent failure, bounded independent poll; abort on unmount. Live hand Encoding and completion observed; browser stage flow passes. |
| D-022 | High / Detailer async ownership | Delayed face preview attached to changed hand settings; delayed inpaint submission attached old job to a replacement dialog. | Request tokens plus image/options/job guards for preview, submit, tick, completion and errors. Two regressions fail before and pass after; stale server job remains canonical and cannot change replacement UI. |
| D-023 | Medium / exact Drama line validation | One missing profile override for Alice blocked a different valid Alice line, although only that line was requested. | Validate exact line ID for line scope. Reproduced failing regression now passes with Drama tests. |
| D-024 | Medium / Create poll ownership | Old poll response updated replacement state, completed old callback and could clear new interval. | Increment generation on replacement/unmount and reject old responses/errors. Executed actual-method race regression passes. |
| D-025 | Medium / mask 100% zoom | Live 512x384 source stayed at scale 1.3125 after 100% because zoom was clamped at Fit. | Permit actual pixels below Fit for small sources; expose negative relative slider range. New regression fails before, passes after; complete unit/browser gates rerun. Post-repair live pixel check limited by browser-control timeouts and missing original canonical images. |

| D-026 | Medium / rejected staged edit cleanup | A live invalid Inpaint mask returned HTTP 400 but left import-1791051677515-5a3d2510.png in mask-uploads. Source conversion preceded request validation without rejection ownership. | Response-finish cleanup removes only staged working copies on HTTP errors in img2img/Inpaint/Outpaint; successful jobs retain normal cleanup ownership. Actual helper regression passes; three live rejected routes leave no new working copies. Reproduction fixture alone removed. |

## C. Gate matrix

| Gate | Result | Evidence / limit |
|---|---|---|
| Syntax | PASS | npm run check; seven bash -n checks; both requested Python compilations; exit 0 |
| Unit | PASS | 259/259, zero skips, exit 0 |
| Edit browser | PASS | 21/21, natural exit 0 |
| Voice/Drama browser | PASS | 7/7, natural exit 0 |
| Chained browser | PASS | 21+7, natural exit 0; no test-owned process candidates |
| Create | PASS | Real quantity-two run, exact siblings, actual 2/4 sampling and Decoding |
| img2img | PASS | Real Library/Edit run, canonical result and exact fullscreen output |
| Inpaint | BLOCKED | Real render, source-sized gradient and outside preservation observed; full live tool sequence incomplete |
| Outpaint | PASS | +128 right, 640x384 output; unchanged interior excluding 48px blend band |
| Detailer face | PASS | Live run and native fixtures; preservation uses reconstructed masks and margin |
| Detailer person | PASS | Same evidence boundary as face |
| Detailer hand | BLOCKED | Ordinary live run passed; wedged-ANE behavior UNKNOWN |
| Voice | BLOCKED | Three profile engines rendered; live bad-reference edge cases incomplete |
| Long-form | BLOCKED | 2960 chars/four chunks/212.873s/playback/download/Library; live tags/failure not exercised |
| Drama | BLOCKED | Live multi-scene render/takes/ambience/stereo/restart and invalid-profile checks; scene/failure/narration/reassignment gaps |
| Privacy | BLOCKED | Scanned new canaries clean except intended saved script/transcript; browser storage unavailable; four pre-repair raw remote exposures preserved |
| Big Mac cleanup | BLOCKED | Interruption/retry and final clean namespaces observed; full live server transport failure not exercised |
| Responsive UI | PASS | 180 document-overflow cells; 165 additionally measured button/pane bounds; main surfaces |
| Accessibility/interaction | BLOCKED | Representative focus/Escape and browser checks pass; exhaustive requested interaction matrix incomplete |

Final v13 browser runs used installed Brave via DEX_BROWSER_PATH. Default Chrome is retained. Raw failures from prior attempts remain in gates/. Earlier native timeout is not silently removed because the final native tests passed.

## D. UI matrix

Create, Library, Batch, Edit Compact, Edit Studio, Enhance, Voice, Drama, Music, Video, Models, System x 375x812, 390x844, 768x1024, 1280x800, 1440x900 x V1/V2/V3 = 180 live cells. Document overflow: zero. Button/pane measurements: 165 non-Studio cells; Studio 15 cells cover document overflow only. Before repair, undersized controls counted Create 11, Models 16, V2 Library 164. After repair measured minimums are 32px desktop/44px phone. V3 Models phone pane's 8px gutter did not clip its child. All-modal/popover, typography and overlap certification is not established.

## E. Files changed

[Complete source, test, documentation and added-evidence manifest](files-changed.md). Includes only this pass's repository changes. Five documentation files updated after validation. Owned external geometry fixture is explicitly identified there. SHA256 manifest preserves evidence identity.

## F. Remaining risks/blockers

[Exact unresolved acceptance gaps](acceptance-blockers.md). Original canonical PNGs disappeared externally for UNKNOWN reason; earlier image evidence is time-specific and final replay is unavailable. Browser control rejects visible fixture clicks after reload. No LoRA is installed; browser storage inspection unavailable; wedged-ANE hand path unsafe to force. Remaining live bad-reference, tag/failure, Drama scene/narration/reassignment and server transport-failure cases are tests-only. Four pre-repair remote prompt logs remain preserved historical exposure. No new confirmed defect in final inspected resweep scope.

## G. Git state

Branch rev17-verification-handoff; HEAD efd9cdc3785fc73652f7fc7d816c5b3496858db4. Working tree dirty with uncommitted repairs and evidence. Remote checkpoint still matches HEAD. Local and remote main remain d713080bf7a220e15aa29d2d38979ce4acfaf959. No commit, push, merge, rebase, deploy or main mutation occurred.
