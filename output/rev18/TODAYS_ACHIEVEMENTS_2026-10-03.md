# DexDiffusion rev18 — exhaustive achievement record for 2026-10-03

Repository: `/Users/andrew/Image_Gen`
Branch: `rev17-verification-handoff`
Starting commit: `efd9cdc3785fc73652f7fc7d816c5b3496858db4`
Published repair/evidence commit: `a94e45feca0e10dc877db132847173b12a348f86`
Remote: `origin`, `git@github.com:westkitty/Image_Gen.git`
Publication verification: the repair commit was pushed successfully, then `git ls-remote origin refs/heads/rev17-verification-handoff` returned the same full hash. The working tree was clean immediately after that publication, before this document was created.

## 1. What was achieved, and what was not

The rev18 repair set is now committed and pushed. It contains eighteen previously established repairs D-009 through D-026, plus D-027, an additional browser-test sampling repair. The acceptance continuation closed six of eight original blockers with bounded, recorded evidence. Fresh final automated validation passed: 259 unit checks, 22 Edit browser checks, eight Voice/Drama browser checks, and a separate chained run of 22 plus eight. Current runtime, failure handling, canonical output and cleanup were observed where necessary to close the gaps.

This does **not** mean all rev18 acceptance is complete. Hand detection while the Apple Neural Engine is actually wedged remains unverified. The exhaustive interaction matrix remains unverified. No installed low-rank adaptation (LoRA) resource was available for a real resource-render check. Historical privacy exposure and unexplained disappearance of earlier canonical images remain unresolved facts.

The eighteen production repairs were already in the dirty working tree at the start of this continuation. Today's continuation preserved them and added acceptance evidence; it did not reimplement them or independently replay every earlier live result. The only code changed during the continuation was in the two existing browser suites. This distinction applies throughout this document: the full committed repair ledger is included for completeness, while the new live work is described separately.

## 2. Scope, authorization and preserved boundaries

The first request authorized continuing the existing repair/acceptance pass while leaving changes uncommitted. That instruction was followed through the acceptance handoff. The subsequent instruction explicitly authorized staging, committing and pushing, and requested this exhaustive Markdown document. Publication happened only after that authorization.

The initial verified tree had 29 tracked modified paths, three untracked test files, and the untracked `output/rev18/` evidence directory. The branch and starting commit matched the reported state. No reset, clean, discard, rebase, merge, main-branch mutation or deployment was used. No old canonical image history was reconstructed. No dependency or model was installed. No unrelated or Neural Engine process was killed. Existing failures, screenshots, receipts and exposure records were kept.

The MacBook remained the user interface (UI), control and durable storage host. Big Mac remained the compute host, accessed through `ssh westcat`. Remote success/cleanup claims used in-band markers and content checks rather than Secure Shell (SSH) exit status alone. Only owned test jobs, test fixtures, temporary wrappers and console processes were controlled. Completed generated images were retained under `/Users/andrew/images_made`; remote worker directories were checked absent.

## 3. Final original-blocker disposition

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


A CLOSED entry closes the stated missing acceptance case. It does not certify unrelated paths or erase historical limitations. The detailed scope and counterexamples follow.

## 4. Full committed defect ledger

The following ledger records the original reproduction, root cause, repair and validation scope. D-009–D-026 originated in the preceding rev18 pass. D-027 was found and repaired in this continuation. It is a test/harness defect, not a production defect.

# Defect details

Every item below was reproduced in this pass. Tests establish their stated scope, not all live behavior. Earlier failed runs remain in the evidence directory after final collection.

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

| D-027 | Medium / Edit browser progress oracle (TEST/HARNESS DEFECT) | The existing 250 ms DOM sampler missed a transient real Sampling step 3/10 label under host load. Canonical completion was still observed. | Install DOM MutationObserver before submission, collect actual rendered labels, retain Waiting/Uploading/Sampling 3/10 and canonical-result assertions. v17 individual Edit 22/22 passes; no production change. Earlier failures retained. |

## 5. Exact new live acceptance and diagnostic work

The following record is the complete per-blocker account from this continuation. It includes unsuccessful diagnostics and scope limitations rather than selecting only successful outcomes.

# Per-blocker live account

This additive record supersedes the remaining-case claims in the historical v13 report. Production repairs D-009–D-026 were preserved; this closure changed browser tests and evidence/documentation only. No commit, publication, dependency/model installation, history reconstruction or unrelated process termination occurred.

## Shared browser obstruction

The in-app browser reproduced the visible fixture click rejection after reload, including a coordinate click: shadow-root target inspection failed. The same fixture opened fullscreen in installed Brave after reload. Classified TOOLING LIMITATION; Brave supplied an independent user path without production modifications. One Brave click returned a control timeout although its resulting UI state confirmed completion. Drama speaker typing through this control surface did not persist; HTTP reassignment followed by UI reopen verified the actual saved value, while the ordinary browser suite separately exercises user speaker reassignment. No unproven source defect was inferred from these control failures.

## 1. Inpaint — CLOSED

Live 640×384 owned fixture: 100% rendered source dimensions equaled natural dimensions; Fit, zoom to 142%, and Pan visibly changed geometry. Paint 2.3%, Undo 0%, Redo, Grow 3.4%, Shrink, Feather, Blur 6.7%, Invert 99.2%, invert back, Eraser 5.5% were exercised. Final additional Invert reached 100%, Clear returned 0% and empty-mask guidance (closure-v17-mask-clear-ui.png). A real four-step sd15 Inpaint completed in 66 seconds through Big Mac; canonical file is /Users/andrew/images_made/20261003-153007-inpaint-inpaint_20261003-153007.png. Recall returned operation inpaint, parent Rev18-owned-zoom-fixture.png, seed 682053983, 640×384, steps 4, CFG 7, euler_a/discrete/auto and strength 0.75. Library Refresh exposed its canonical thumbnail/details; Details→Inpaint restored settings. Same-session prompt restoration is explicitly ephemeral. Live Inpaint preset restored 4 steps after editing to 9; live Outpaint preset restored right extension 128 after editing to 256. Browser regression separately verifies both settings-only preset round trips. Prior actual mask extraction/outside-region evidence remains historical; no redundant expensive render was needed because production paths did not change.

## 2. Detailer hand / wedged Apple Neural Engine — UNVERIFIED

Ordinary native hand regressions are included in the fresh full unit suite. Current native services were observed idle rather than demonstrably wedged. The historical timeout is retained. A safe reproducible wedge was unavailable; forcing it would require prohibited interference with unrelated system services. Ordinary success does not establish wedged-service behavior.

## 3. Voice invalid references — CLOSED

Live malformed input: staging 400 reference-invalid. Short 0.2-second input: stage succeeds, promotion rejects below 0.5-second minimum. Silent five-second input: stage succeeds, promotion rejects all-silence. Fully clipped five-second input: promotion succeeds with clipping warning and clip_ratio 1; this is the implemented warning contract, not a required rejection. A new browser test performs real uploads/staging/promotion and checks visible errors/warning plus stored diagnostics without mocked reference endpoints. Only owned fixture IDs are cleaned up.

closure-v14-voice-reference.json also contains a diagnostic labeled render-invalid-profile: the clipped reference was valid under the warning contract; deleting that owned profile before its queued render completed made job 90316e4f-f521-4264-9a15-11f5cde60ffe fail reference-invalid. This is fixture cleanup timing, not evidence that clipping is rejected or a new product defect. It produced no canonical artifact.

## 4. Long-form tags and failures — CLOSED

The first 889-character tagged render was single-chunk and is not counted as long-form proof. The subsequent 963-character tagged script split into three chunks (the UI's approximate estimate was two). Actual outbound request summaries preserve hashes/lengths and tag-presence booleans only: quietly in chunk 1, calmly in chunk 3, neither split. Job 030e096f-60d3-49d7-997c-377df1558998 completed all three and yielded 20261003-194200-kokoro-long-form.wav (58 seconds), with visible download/lineage. This proves tag transport and rendering, not expressive interpretation by Kokoro.

Controlled transport failure job 4ae2de69-58e6-4751-91fc-95a2dfe51b12 failed generation with no canonical artifacts. Job 74ea55fa-a7a3-478f-9208-05850836880a ran the real first chunk, then a narrowly injected second-item runtime exception produced explicit chunk 2/3 failure, done=1, and no final artifact. The normal retry above succeeded. Failure UI screenshots and exact job snapshots are preserved.

## 5. Drama interactions — CLOSED

Owned saved project dp-8991c8ff contains scene 1 with a true unlabelled narration paragraph and Alice line, plus scene 2 with Bob. Reassignment to REX was saved by the actual service and verified on UI reopen; browser suite covers ordinary input reassignment. NARRATOR/REX/BOB were bound in live UI. Scene-only rendering produced exactly the two scene-1 takes; scene-2 takes stayed empty. Actual scene assembly yielded a four-second, 24 kHz mono audio artifact. The saved owned evidence project remains.

Owned unsaved project dp-8117d458 exercised real partial failure: first take tk-27895ebc completed, second take tk-7400c929 failed transport. Resume queued only the failed line and succeeded as tk-965b35ad; the original first take and failed-take history were retained. closure-v14-drama-retry.json records preserved_first_take=true. The intentionally unsaved project was lost on the later normal-server restart; captured snapshots/screenshots remain. No historical project was deleted or recreated.

## 6. Privacy storage — CLOSED within measured scope

Actual isolated-browser storage inspection now checks BOTH localStorage and sessionStorage before and after reload. Saving-off Inpaint prompt/negative canaries were absent after settings-only preset save; the persisted preset name is a positive control. Fresh local scan found no designated canaries in 11 relevant newly changed textual state/run files. This does not certify every file or the user's personal browser profile; the computer-use read-only DOM scope itself still does not expose storage. Screenshots/evidence intentionally retain synthetic test content. Four historical pre-repair raw remote prompt logs remain preserved, not laundered into a clean result.

## 7. Full server transport failure / cleanup — CLOSED

A temporary owned PATH wrapper forwarded actual /usr/bin/ssh westcat commands. The server allocated a real remote directory, then the next worker command failed transport with exit 255. Actual terminal generic jobs showed explicit failure, empty artifacts and released resource lease; no completed result was invented. In-band final remote content markers confirmed all six exact allocated owned directories absent, while all four historical exposure logs remained. See closure-v14-remote-cleanup.json (6 expected, 6 verified removed, 4 historical logs preserved). An earlier probe guessed a wrong directory and is not acceptance evidence.

The chunk exception forwarded real worker execution with only an item-2 exception inserted; the Drama hook forwarded the first real render and failed the next. Wrapper source, modes/events, request hash summaries and allocated paths are retained. The fault-enabled console was stopped after the lease became idle. Normal console was restarted without the wrapper; temporary hook directory was removed only after preserving its source/evidence. MacBook retains completed image/audio storage; Big Mac remains compute-only.

## 8. Exhaustive accessibility/interaction matrix — UNVERIFIED

New live cases cover fullscreen after reload, mask controls/zoom/pan, Inpaint/Outpaint presets and provenance details/recall. Fresh browser regressions include modal focus/Escape, resource controls, responsive surfaces and truthful progress. Existing 180-cell matrix remains historical evidence with its explicit Studio/button-bound limits. Every modal/popover/selector/typography/keyboard combination across five viewports and three shells was not exhaustively measured, and no existing executable exhaustive matrix closes those dimensions. Do not extrapolate representative cases to complete coverage. Real installed-LoRA rendering remains ENVIRONMENT BLOCKED (none installed); no model was added.

## Harness fixes and failed attempts

D-027: the previous Edit test sampled DOM every 250 ms and could miss a transient Sampling step 3/10 label. A MutationObserver installed before submission records actual rendered labels, preserving the exact Waiting/Uploading/Sampling assertions and canonical completion check. Later attempts separately exposed mistakes in the newly expanded preset assertions: stored numeric parameters are strings, rendered DOM updates are asynchronous, and the Steps accessible name comes from a wrapping label rather than an aria-label attribute. These were test construction defects, not production repairs. v14–v16 raw failures and interrupted v14 chain are retained; final passes are accepted only after these causes were identified.

## 6. How the production repair set changes behavior

### Masks and edit inputs

The server now preserves alpha as grayscale rather than turning every nonzero alpha pixel into a fully opaque inpaint mask. Conversion failure is rejected instead of falling back to potentially misleading red/green/blue/alpha (RGBA) data. The UI can show actual pixels at 100% even when Fit enlarged a small source. Rejected staged requests clean up only their converted working copies, with successful-job cleanup ownership unchanged.

### Job progress and asynchronous ownership

Create, Edit, Batch and Detailer progress use reported stages, actual step counts and exact completed-item counts. Elapsed time no longer creates sampling percentages. Decoder completion remains a decoding stage until real transfer/validation advances it. Polling has bounded failure/timeout behavior. Replacement or unmounted UI state cannot be mutated by stale poll responses. Detailer preview/run requests carry ownership tokens and guard image/options/job identity so delayed work cannot attach itself to a replacement dialog.

### Detailer access and visibility

The dialog has modal semantics, focus containment, Escape dismissal and return focus. Submission keeps visible progress until the canonical result is ready; an error stays visible. This repairs ordinary interaction and lifecycle behavior. It does not establish successful hand detection when the underlying native service is wedged.

### Prompt and delivery privacy

A shared redaction helper handles quoted/multiline/Unicode-escaped text. JSON redaction preserves encoded image fields instead of corrupting binary payload strings. Saving-off remote image generation does not leave raw tokenizer logs. Voice delivery directions remain ephemeral while durable metadata records whether directions were requested/applied. Newly measured browser storage canaries stay out of both storage areas during settings-only preset save/reload. None of these changes deletes or retroactively sanitizes the four historical exposed remote logs.

### Voice and Drama

Long-form and single-shot output follow the same peak attenuation policy, preserving quieter delivery rather than normalizing it upward. Drama resolves profile bindings before render, and exact-line scope validates only the requested line. Reference upload checks distinguish malformed data, too-short samples, silence, and a clipping-warning contract. Retry evidence proves that a completed first take survives while the failed second line is rerendered.

### Browser harness reliability and fixture ownership

Cleanup targets newly created fixture IDs rather than deleting every object with a broad name prefix. Requests are bounded and teardown phases are recorded. Browser selection can use installed Brave. Newly captured output uses a unique destination so reruns do not overwrite older snapshots. D-027 records actual DOM mutations from before job submission while retaining the same stage and canonical-result checks.

## 7. Final automated validation

No production source changed after the final passing regression. The later publication/documentation work changes evidence and Markdown only; it does not invalidate generation behavior. Tests were not rerun merely to repeat expensive live work.

| Gate | Command | Verified final result |
|---|---|---|
| Server syntax | `npm run check` | Exit 0 |
| Full unit suite | `npm test` | 259 passed, 0 failed, 0 skipped; exit 0 |
| Individual Edit browser | `npm run test:browser:edit` | 22/22; exit 0 |
| Individual Voice/Drama browser | `npm run test:browser:voice` | 8/8; exit 0 |
| Chained browser | `npm run test:browser` | Edit 22/22 and Voice/Drama 8/8; exit 0 |
| Shell syntax | Seven `bash -n` checks | All exit 0 |
| Python syntax | Two `python3 -m py_compile` checks | Both exit 0 |
| Browser JavaScript syntax | `node --check` for both edited suites | Both exit 0 |
| Pre-publication tracked diff | `git diff --check` | Exit 0; did not cover then-untracked evidence |
| Publication-stage full diff | `git diff --cached --check` | Whitespace warnings in preserved raw evidence; see section 9 |
| Publication-stage authored files | Staged check excluding warning-bearing raw transcripts | Exit 0 |

Browser environment: `DEX_BROWSER_PATH=/Applications/Brave Browser.app/Contents/MacOS/Brave Browser`. Each attempt uses its own `DEX_BROWSER_OUTPUT_DIR` under `output/rev18/`. Browser suites exercise some mocked generation endpoints; their results establish UI contracts and controlled transitions. Real Big Mac compute/failure cases in section 5 establish live behavior separately.

### Complete final browser check lists

#### edit: edit-workbench-results.json

1. **PASS** — provenance: Edit carries the SELECTED image's parameters, not the Create form (4921 ms)
2. **PASS** — privacy on: stored prompt is recalled; different image → its own values (1390 ms)
3. **PASS** — img2img: real click sends the request, shows queue/wait/real step progress, resolves the canonical result (6541 ms)
4. **PASS** — failures are visible with stage + actual error; polling loss offers a safe retry (10569 ms)
5. **PASS** — Run never fails silently: blocked state explains itself and click surfaces the reason (1372 ms)
6. **PASS** — inpaint alignment (fx-square.png): full image at Fit, strokes land on intended source pixels, zoom/pan keep them, backend mask matches (2483 ms)
7. **PASS** — inpaint alignment (fx-landscape.png): full image at Fit, strokes land on intended source pixels, zoom/pan keep them, backend mask matches (2201 ms)
8. **PASS** — inpaint alignment (fx-portrait.png): full image at Fit, strokes land on intended source pixels, zoom/pan keep them, backend mask matches (1773 ms)
9. **PASS** — fullscreen: sources/results/library open the viewer; Esc closes; inpaint canvas never does (1866 ms)
10. **PASS** — Create output hero image opens fullscreen (1480 ms)
11. **PASS** — Detailer: preview/run use the selected targets, empty result is explained, stale preview is dropped, mask goes to inpaint untouched (2691 ms)
12. **PASS** — every screen renders in all three shell layouts without script errors (incl. Drama/Voice/Edit) (5365 ms)
13. **PASS** — both Edit layouts render the SAME state; preference persists (1575 ms)
14. **PASS** — resources: LoRAs visible in Create and Edit, weight changes are structured, incompatible ones excluded (1817 ms)
15. **PASS** — model picker: concise, grouped, searchable (1834 ms)
16. **PASS** — presets: per-operation, versioned, privacy-aware, legacy migrated (2272 ms)
17. **PASS** — saving off: both browser storage areas exclude current edit prompt and negative after preset save and reload (1902 ms)
18. **PASS** — Detailer dialog traps focus, closes with Escape, and restores the opener (1412 ms)
19. **PASS** — Detailer keeps truthful job progress visible until the canonical result is ready (6960 ms)
20. **PASS** — responsive @375px: no horizontal overflow on Create/Edit/Library (3236 ms)
21. **PASS** — responsive @768px: no horizontal overflow on Create/Edit/Library (1857 ms)
22. **PASS** — responsive @1280px: no horizontal overflow on Create/Edit/Library (1895 ms)

#### voice: voice-drama-results.json

1. **PASS** — Voice profiles: designed + preset voices, validation, capability truth, direction gating, long-form estimate (4558 ms)
2. **PASS** — Cloned voice: invalid until a sample WITH transcript is approved; multiple samples; active sample; remove (5934 ms)
3. **PASS** — real reference uploads: malformed, short and silent rejected; clipped sample shows warnings (6399 ms)
4. **PASS** — Voice render state belongs to the voice that started it (no progress/result/error leaks onto another voice) (13111 ms)
5. **PASS** — Drama: paste → parse → review/edit → cast → privacy banner → save/unsave → blocked render → assemble refuses without takes (2298 ms)
6. **PASS** — Drama LLM parse mode reports rejection/failure visibly (never silently falls back) (1295 ms)
7. **PASS** — responsive @375px: Voice profiles + Drama have no horizontal overflow (2709 ms)
8. **PASS** — responsive @768px: Voice profiles + Drama have no horizontal overflow (2459 ms)

#### chain: edit-workbench-results.json

1. **PASS** — provenance: Edit carries the SELECTED image's parameters, not the Create form (2382 ms)
2. **PASS** — privacy on: stored prompt is recalled; different image → its own values (2866 ms)
3. **PASS** — img2img: real click sends the request, shows queue/wait/real step progress, resolves the canonical result (6511 ms)
4. **PASS** — failures are visible with stage + actual error; polling loss offers a safe retry (9960 ms)
5. **PASS** — Run never fails silently: blocked state explains itself and click surfaces the reason (1037 ms)
6. **PASS** — inpaint alignment (fx-square.png): full image at Fit, strokes land on intended source pixels, zoom/pan keep them, backend mask matches (1270 ms)
7. **PASS** — inpaint alignment (fx-landscape.png): full image at Fit, strokes land on intended source pixels, zoom/pan keep them, backend mask matches (1199 ms)
8. **PASS** — inpaint alignment (fx-portrait.png): full image at Fit, strokes land on intended source pixels, zoom/pan keep them, backend mask matches (1324 ms)
9. **PASS** — fullscreen: sources/results/library open the viewer; Esc closes; inpaint canvas never does (1474 ms)
10. **PASS** — Create output hero image opens fullscreen (919 ms)
11. **PASS** — Detailer: preview/run use the selected targets, empty result is explained, stale preview is dropped, mask goes to inpaint untouched (4575 ms)
12. **PASS** — every screen renders in all three shell layouts without script errors (incl. Drama/Voice/Edit) (5746 ms)
13. **PASS** — both Edit layouts render the SAME state; preference persists (2131 ms)
14. **PASS** — resources: LoRAs visible in Create and Edit, weight changes are structured, incompatible ones excluded (1241 ms)
15. **PASS** — model picker: concise, grouped, searchable (1321 ms)
16. **PASS** — presets: per-operation, versioned, privacy-aware, legacy migrated (1218 ms)
17. **PASS** — saving off: both browser storage areas exclude current edit prompt and negative after preset save and reload (1090 ms)
18. **PASS** — Detailer dialog traps focus, closes with Escape, and restores the opener (2495 ms)
19. **PASS** — Detailer keeps truthful job progress visible until the canonical result is ready (5718 ms)
20. **PASS** — responsive @375px: no horizontal overflow on Create/Edit/Library (3537 ms)
21. **PASS** — responsive @768px: no horizontal overflow on Create/Edit/Library (3990 ms)
22. **PASS** — responsive @1280px: no horizontal overflow on Create/Edit/Library (1807 ms)

#### chain: voice-drama-results.json

1. **PASS** — Voice profiles: designed + preset voices, validation, capability truth, direction gating, long-form estimate (4736 ms)
2. **PASS** — Cloned voice: invalid until a sample WITH transcript is approved; multiple samples; active sample; remove (2169 ms)
3. **PASS** — real reference uploads: malformed, short and silent rejected; clipped sample shows warnings (1940 ms)
4. **PASS** — Voice render state belongs to the voice that started it (no progress/result/error leaks onto another voice) (11164 ms)
5. **PASS** — Drama: paste → parse → review/edit → cast → privacy banner → save/unsave → blocked render → assemble refuses without takes (2231 ms)
6. **PASS** — Drama LLM parse mode reports rejection/failure visibly (never silently falls back) (1266 ms)
7. **PASS** — responsive @375px: Voice profiles + Drama have no horizontal overflow (2752 ms)
8. **PASS** — responsive @768px: Voice profiles + Drama have no horizontal overflow (3439 ms)

### Exact final static commands

- `bash -n sdcpp-workflow/bin/mflux-controlled-generate.sh` — exit 0
- `bash -n sdcpp-workflow/bin/sdcpp-cli-generate.sh` — exit 0
- `bash -n sdcpp-workflow/bin/sdcpp-controlled-generate.sh` — exit 0
- `bash -n sdcpp-workflow/bin/sdcpp-img2img.sh` — exit 0
- `bash -n sdcpp-workflow/bin/sdcpp-inpaint.sh` — exit 0
- `bash -n sdcpp-workflow/bin/sdcpp-server-generate.sh` — exit 0
- `bash -n sdcpp-workflow/bin/sdcpp-xyz-plot.sh` — exit 0
- `python3 -m py_compile operator-console/bridges/dexmedia_remote.py` — exit 0
- `python3 -m py_compile sdcpp-workflow/bin/redact_stream.py` — exit 0
- `node --check operator-console/tests/browser/edit-workbench.browser.js` — exit 0
- `node --check operator-console/tests/browser/voice-drama.browser.js` — exit 0
- `git diff --check` — exit 0

## 8. Failed attempts, variability and corrections

Earlier failures were preserved. A later green result was not used to erase an unexplained failure.

- The in-app browser reproduced its shadow-root click-target failure after reload. Installed Brave completed the same fullscreen path. This was classified as tooling, and no product code was altered to accommodate it.
- The launcher reported starting a console whose detached process did not survive the tool session. A persistent owned console process supplied the live runtime. This was a session/process-lifetime limitation, not a proven launcher-source repair.
- The earlier 250 ms sampling loop missed a rendered Sampling label. D-027 observes actual mutations instead; the exact stage assertions remain.
- The new preset test first assumed a numeric type although stored parameters were strings. It then read the DOM before the scheduled render. Finally, it queried an `aria-label` attribute absent from a field named through a wrapping label. The assertions were corrected to the actual contract and rendered field, and final individual/chained checks passed. These were mistakes in new test construction, not additional product fixes.
- The v14 chain was interrupted after known failures; closed-browser messages from that interruption do not establish new product defects.
- The first tagged speech request stayed below the chunk threshold and cannot count as long-form proof. A later request actually rendered three chunks.
- An exploratory clipping-profile render failed after that owned profile was deleted before the job finished. That failure is fixture timing, not a clipping rejection or product defect.
- An initial cleanup probe guessed the wrong remote directory. Only later exact allocated paths with in-band absence markers count as cleanup evidence.
- An initial final-runtime probe used two nonexistent endpoint names and returned 404. The corrected `/api/resources` and `/api/generic-jobs` responses are recorded alongside those failed probes rather than replacing them silently.
- Computer-use speaker typing did not persist in the controlled live tab. Saved reassignment was verified through the real service plus UI reopen; the ordinary browser suite provides separate input-path evidence.

### Retained closure gate attempt receipts

#### [closure-v14-final-gates.json](closure-v14-final-gates.json)

| Gate | Command | Exit | Log |
|---|---|---|---|
| check | `npm run check` | 0 | [dex-rev18-closure-v14-check.log](gates/dex-rev18-closure-v14-check.log) |
| unit | `npm test` | 0 | [dex-rev18-closure-v14-unit.log](gates/dex-rev18-closure-v14-unit.log) |
| edit | `npm run test:browser:edit` | 1 | [dex-rev18-closure-v14-edit.log](gates/dex-rev18-closure-v14-edit.log) |
| voice | `npm run test:browser:voice` | 0 | [dex-rev18-closure-v14-voice.log](gates/dex-rev18-closure-v14-voice.log) |

#### [closure-v15-final-gates.json](closure-v15-final-gates.json)

| Gate | Command | Exit | Log |
|---|---|---|---|
| check | `npm run check` | 0 | [dex-rev18-closure-v15-check.log](gates/dex-rev18-closure-v15-check.log) |
| unit | `npm test` | 0 | [dex-rev18-closure-v15-unit.log](gates/dex-rev18-closure-v15-unit.log) |
| edit | `npm run test:browser:edit` | 1 | [dex-rev18-closure-v15-edit.log](gates/dex-rev18-closure-v15-edit.log) |
| voice | `npm run test:browser:voice` | 0 | [dex-rev18-closure-v15-voice.log](gates/dex-rev18-closure-v15-voice.log) |
| chain | `npm run test:browser` | 1 | [dex-rev18-closure-v15-chain.log](gates/dex-rev18-closure-v15-chain.log) |

#### [closure-v16-browser-gates.json](closure-v16-browser-gates.json)

| Gate | Command | Exit | Log |
|---|---|---|---|
| edit | `npm run test:browser:edit` | 1 | [dex-rev18-closure-v16-edit.log](gates/dex-rev18-closure-v16-edit.log) |
| voice | `npm run test:browser:voice` | 0 | [dex-rev18-closure-v16-voice.log](gates/dex-rev18-closure-v16-voice.log) |
| chain | `npm run test:browser` | 1 | [dex-rev18-closure-v16-chain.log](gates/dex-rev18-closure-v16-chain.log) |

#### [closure-v17-browser-gates.json](closure-v17-browser-gates.json)

| Gate | Command | Exit | Log |
|---|---|---|---|
| edit | `npm run test:browser:edit` | 0 | [dex-rev18-closure-v17-edit.log](gates/dex-rev18-closure-v17-edit.log) |
| voice | `npm run test:browser:voice` | 0 | [dex-rev18-closure-v17-voice.log](gates/dex-rev18-closure-v17-voice.log) |
| chain | `npm run test:browser` | 0 | [dex-rev18-closure-v17-chain.log](gates/dex-rev18-closure-v17-chain.log) |

#### [closure-v17-static-unit-gates.json](closure-v17-static-unit-gates.json)

| Gate | Command | Exit | Log |
|---|---|---|---|
| check | `npm run check` | 0 | [dex-rev18-closure-v17-check.log](gates/dex-rev18-closure-v17-check.log) |
| unit | `npm test` | 0 | [dex-rev18-closure-v17-unit.log](gates/dex-rev18-closure-v17-unit.log) |
| edit-syntax | `node --check operator-console/tests/browser/edit-workbench.browser.js` | 0 | [dex-rev18-closure-v17-edit-syntax.log](gates/dex-rev18-closure-v17-edit-syntax.log) |
| voice-syntax | `node --check operator-console/tests/browser/voice-drama.browser.js` | 0 | [dex-rev18-closure-v17-voice-syntax.log](gates/dex-rev18-closure-v17-voice-syntax.log) |

## 9. Commit, push and the raw-evidence whitespace distinction

The repair/evidence publication contains **322 changed files**, **16,533 inserted textual lines** and **164 removed textual lines**, including binary screenshots/masks. Commit `a94e45feca0e10dc877db132847173b12a348f86` has subject `fix: repair DexDiffusion rev18 and record acceptance evidence`. It was pushed normally to `origin/rev17-verification-handoff`; no force push was used. Remote comparison independently confirmed the exact full hash.

Staging the formerly untracked evidence exposed trailing-space and final-blank-line warnings in archived test logs and the temporary hook event transcript. Earlier `git diff --check` receipts checked tracked modifications only, so they did not cover these then-untracked artifacts. This is a real difference in check scope. The raw files were preserved byte-for-byte rather than rewritten to make the receipt green. The authored source/documentation staged check passed with the warning-bearing raw transcripts excluded. [publication-staged-whitespace.json](publication-staged-whitespace.json) retains the full staged result and exception policy.

The accepted generation/test results are unchanged by those raw transcript formatting warnings. This document is being committed separately so it can accurately name the already published repair commit. Its own commit identity is available through Git history; a document cannot embed its own final commit hash without changing that hash.

## 10. Final runtime and ownership state at acceptance capture

Normal console process identifier (PID): 24747; listener `127.0.0.1:31337`. Resource group `bigmac-heavy-inference`, capacity 1; owner null; waiting list empty; external occupancy false. The captured generic-job response showed no active jobs among the returned latest 100. Runtime checks are time-specific observations, not a promise that a later process or service remains alive indefinitely.

The controlled-fault console was stopped only after its owned resource lease became idle. The normal console was restarted without the fault wrapper. The owned temporary directory was removed after copying the wrapper source and supporting receipts into the evidence directory. No unrelated service was stopped. Saved owned scene evidence and two browser-local presets remain; the intentionally unsaved retry project was lost on restart with its snapshots retained.

## 11. Remaining genuine limitations

1. **Wedged Apple Neural Engine:** normal hand detection passes, but a safe reproducible wedged-service condition was unavailable. The historical timeout is retained. Forcing the condition through unrelated system-process interference was outside the authorized boundary.
2. **Exhaustive interactions:** the historical 180-cell responsive matrix has documented limits; representative new tests do not establish every modal/popover/selector/typography/keyboard combination across all shells and viewports.
3. **Installed LoRA compute:** no installed resource was available. Structured UI/resource tests do not prove a real resource-conditioned render.
4. **Historical canonical disappearance:** older canonical PNGs disappeared externally for an unknown reason. This pass did not delete or recreate the history. New canonical output is separately verified.
5. **Historical prompt exposure:** four pre-repair remote logs remain, alongside older evidence. Current redaction/retention fixes do not erase those files.
6. **Privacy scope:** both storage areas were inspected in an actual isolated test browser. The personal browser profile and all possible persisted files were not globally certified. Synthetic content is intentionally retained in evidence/screenshots.
7. **Speech tag interpretation:** tags reached actual chunk requests without splitting, and output rendered; Kokoro expressive interpretation was not established and its unsupported-direction capability remains explicit.
8. **Fixture lifecycle:** the unsaved Drama retry project disappeared on normal restart. The saved scene fixture survives; captured retry evidence remains.
9. **Publication versus completion:** committing and pushing records the bounded repair state. It does not convert UNVERIFIED acceptance to complete or deploy an application.

## 12. Evidence navigation and checksums

- [Current final report](FINAL_REPORT.md)
- [Current blocker record](acceptance-blockers.md)
- [Defect ledger](BUGS.md)
- [Detailed live acceptance](closure-v17-live-acceptance.md)
- [Final browser gate commands/exits](closure-v17-browser-gates.json)
- [Final syntax/unit commands/exits](closure-v17-static-unit-gates.json)
- [Final static receipt](closure-v17-final-static.json)
- [Final acceptance runtime capture](closure-v17-final-runtime.json)
- [Remote exact-directory cleanup](closure-v14-remote-cleanup.json)
- [Drama retry ownership](closure-v14-drama-retry.json)
- [Long-form job captures](closure-v14-longform-jobs.json)
- [Fresh local privacy scope](closure-v14-privacy-current.json)
- [Original checksum manifest](sha256-manifest.json)
- [Additive closure checksum manifest](closure-v17-sha256-manifest.json)
- [Publication staged whitespace receipt](publication-staged-whitespace.json)

The original and closure manifests are snapshots, not claims that later edits leave every documented hash unchanged. Git commit objects provide the published file versions. This document's inventory below gives each file's SHA-256 (Secure Hash Algorithm 256-bit) digest at the already published repair commit. Historical failure receipts are included because they explain the route to the final result.

## 13. Exhaustive published file inventory

Paths below are relative to the repository root. Each digest was calculated from `git show a94e45feca0e10dc877db132847173b12a348f86:<path>`, so it identifies published bytes, not an assumed working-file version. The separate document commit is not included in this repair-commit inventory.

| Published path | Bytes | SHA-256 |
|---|---:|---|
| `DEXDIFFUSION.md` | 34333 | `d6b9923ea9b41bf3bc043e1fb5d560eaefd4287f906167c80f3a2f7510ce91bc` |
| `OPERATIONAL_STATE.md` | 91116 | `4827953748785af2ed9d8046e699a11ebd9e6ad4d10b04c36bf00c36b712b6de` |
| `operator-console/docs/detailer-and-identity.md` | 3625 | `29f2c61b332ac2a06b770d9f5e457c66866c9d9b078d86c50cf47e319a6ba414` |
| `operator-console/docs/edit-workbench-20261002.md` | 7605 | `83d06feefd52dfe471c0bf6fe4e7a163ae026c73495ead10c935f4a6e74ba752` |
| `operator-console/docs/voice-drama-20261002.md` | 7114 | `bdde5047703206a62ca606c550eed011fe4a3bf3a5682d9134b3f9e2e41b50e4` |
| `operator-console/drama-service.js` | 15377 | `90302b27eb73a6f4382b2dab3aa59659fb8779521f8d922092f7f0019be929b4` |
| `operator-console/media-bridge.js` | 31949 | `164ffea2456afe176c87808f3a3003aab2351eed5151504e8b9c1130482b75d3` |
| `operator-console/public/dexdiffusion/a11y.js` | 2925 | `63573ffb27f682f577fbd0ebd98e95bd53623b773e35e7f84f48714f4a1ed9e5` |
| `operator-console/public/dexdiffusion/component.js` | 128320 | `ade1fb04d80ecd0a501f163353577251549932765c98f737e4abf18a70db8d93` |
| `operator-console/public/dexdiffusion/edit-core.js` | 21768 | `f776896b3740748f19e0c238dfe27980f8780da454c83abf74b0e7c797c832a8` |
| `operator-console/public/dexdiffusion/edit-ui.js` | 80139 | `4ead0434a330cf53bc12758a44cac6e3a19119df3bffffd6438422828e40bfb0` |
| `operator-console/public/dexdiffusion/workstation-ui.js` | 81465 | `581d2e0c4e873653a4021b67e70412b95e97e75de1ae4cd0c04d1e7304d3d524` |
| `operator-console/server.js` | 217486 | `37aab7a0207146837272f0c03198a38085143f0fb2a045a374bfcd39c7130465` |
| `operator-console/tests/browser/edit-workbench.browser.js` | 35056 | `929ab37e1cae0df6e7ae84aa19e87cc204f996bc6db4e05c3004a1241950acba` |
| `operator-console/tests/browser/helpers.js` | 9120 | `5979e05755e70fc0d11796cd5df5f6e3bcdf911f11eb189659d660905872e3a3` |
| `operator-console/tests/browser/voice-drama.browser.js` | 20991 | `70b448a70459fa28f78b6715eb6a0eac4e5402b0cbb8db0c4c53444b4f6c7b91` |
| `operator-console/tests/detailer-ui-state.test.js` | 1865 | `14cad31837d7f5b169bcdf66bcdbb6869a642186149d8f6eba8c19f96133b4c9` |
| `operator-console/tests/drama-service.test.js` | 11664 | `a6c57a1b61cd78638e7fac7e9b2ce7824714ce39418dcffebd2c3c8aec872156` |
| `operator-console/tests/edit-core.test.js` | 14070 | `a938db8b470dbd5a54af1be2c81f25e04f6aa60e9ed3a0a3f0e250dce875c418` |
| `operator-console/tests/job-poll-state.test.js` | 2325 | `6a234c7ed926586ae2e2ef9938b8639281dd94f7569b8e245b0029ff30733418` |
| `operator-console/tests/mask-alpha.test.js` | 2903 | `6e59e417bb5fbd803a9083fcbd5dd8f5cccf8260916604b71d2b20bfcb1441d6` |
| `operator-console/tests/redact-stream.test.js` | 3949 | `e5583afdafc2f8df92bb51d0673c57b45c8301a4b7d38d480881682f3652a7b6` |
| `operator-console/tests/voice-production.test.js` | 18147 | `5fcbb0a3de3422102e44279806bf671462c5136b77f2babe00c857d7129e6e70` |
| `operator-console/voice-service.js` | 5809 | `aa8a163e8adb2abedbe4248313058188c8a030bea7e466f82b2e41bf44d7e1e6` |
| `output/rev18/BUGS.md` | 6717 | `77e63582ad79c51705320d7efac997b728120793795c7be9a8acad17f3e87648` |
| `output/rev18/FINAL_REPORT.md` | 17396 | `9238a2536ba9aaf40f57c1cebc7d39b123f2a65baa9d9aafaf00bac889b13308` |
| `output/rev18/acceptance-blockers.md` | 3513 | `071450c83fd510a6d3f7884f9620c0f2015cedfddda273a151662019e2415a27` |
| `output/rev18/ane-limit.json` | 422 | `f9f4ea5a813240f1c2138f76b97a44c737a1a942364df69be63a6afc68f9cf99` |
| `output/rev18/audio-evidence.json` | 2443 | `525f8ee46e15fe5c72abf1c0707915e60231a1ade3ae4b646f84a5031fbc20e7` |
| `output/rev18/browser-processes-final.json` | 110 | `16353669c6ff97b2cee3b56ebfe082853e7d308d1dbee8c357bf1af482bfd2b2` |
| `output/rev18/cleanup-final-local.json` | 1086 | `e725bf6acf63ee9da903b609bf19f9d43e30b8713e2a6fcf94115b9cd5350170` |
| `output/rev18/cleanup-remote-final-current.json` | 865 | `4fb727f5ef79ac24de6d54a722fe042ed9d0f08105e625d25f52024aeece701e` |
| `output/rev18/clone-multiple.json` | 2360 | `363914dc037a5fe66b94008736441b90a8b55af757f166445092bf60ae8ddcbd` |
| `output/rev18/clone-sample-removal.json` | 1554 | `1c42899dc472d820cd49699a8d6b3eab03f9e844ed4a4eb50740127ade17b1d9` |
| `output/rev18/closure-v14-browser-chain/edit-recall-compact.png` | 130906 | `37f9bbbb9cfec5596beff9488dac9bc043c5916c153eac94c80378012f2d4d17` |
| `output/rev18/closure-v14-browser-chain/edit-workbench-results.json` | 3898 | `ac5ad963bb3335abf75da68b250843af06e2b521d2307d6d4aabab5d22202432` |
| `output/rev18/closure-v14-browser-edit/edit-1280.png` | 127836 | `208f7ba33c2813c65c7f4e3b7366be683c37106a47a61442617fce7d0866361e` |
| `output/rev18/closure-v14-browser-edit/edit-375.png` | 71799 | `93384340f59bbe39980a2bcbdc50110b0b3d9e52dbc4bea861dd94fe987a5b57` |
| `output/rev18/closure-v14-browser-edit/edit-768.png` | 93555 | `a690f2247bedb40fb4944b4ecb0e1f43e7120a5fae23ebd5f6aa93ccddc5e6ef` |
| `output/rev18/closure-v14-browser-edit/edit-recall-compact.png` | 130906 | `4ee39e1bbc09d7bd504f2aa0189e67e9a416050c050925f485c9112c1c998900` |
| `output/rev18/closure-v14-browser-edit/edit-studio.png` | 105597 | `6dd6feb26401679e1f1fc33d6dea220cba44d798f4eaa95938a2ba54c5f60e84` |
| `output/rev18/closure-v14-browser-edit/edit-workbench-results.json` | 2830 | `8527992919884c38abc266d9eeac18790a16c451fec28b3ea5c0fcb95e9cd9d0` |
| `output/rev18/closure-v14-browser-edit/inpaint-fx-landscape.png` | 78169 | `552c139ebc84651ea850a9f1488c157dcbbb4c76283ce886a0a680f5eca70594` |
| `output/rev18/closure-v14-browser-edit/inpaint-fx-portrait.png` | 76025 | `cf4c816580d1db0ca6b21e7c32f42dd7d59964ecc323da57b43367e1b6d5a84e` |
| `output/rev18/closure-v14-browser-edit/inpaint-fx-square.png` | 73227 | `8a8bb58a115f7667bf94bf3b5af59243ed197d1ce8143578408e1c01f066870d` |
| `output/rev18/closure-v14-browser-edit/model-picker.png` | 158052 | `48f0448b80c2366ec1a2fc99302999b7eb3c0c9f8291c33d649d824f834d08a3` |
| `output/rev18/closure-v14-browser-voice/drama-375.png` | 69192 | `f18aa283ace32920d9e95d46abb9ba3575b446b099235d0e9bd4949da41d21af` |
| `output/rev18/closure-v14-browser-voice/drama-768.png` | 110625 | `057fef581714f42bb43822df7ee386a3d33f4970c08d9f3e8d3ef3760d81be15` |
| `output/rev18/closure-v14-browser-voice/drama.png` | 166723 | `8672f78646fb309760967989ac3865562d6b3128a979c734a79196b2f8e74b8c` |
| `output/rev18/closure-v14-browser-voice/voice-375.png` | 60612 | `33d6c4880e589b44480e6451836471dea7e440df938589d83b3dda053a1c8d25` |
| `output/rev18/closure-v14-browser-voice/voice-768.png` | 86418 | `ae5fdc742d29b7384a0bb4666c7baace64d9cbdcc5f63b71c7aa9499bca08e96` |
| `output/rev18/closure-v14-browser-voice/voice-drama-results.json` | 1010 | `3468cadf7255f29a5c62bcd3cd1af80ee3ecc4de44e58115702acc79aa7bb098` |
| `output/rev18/closure-v14-browser-voice/voice-profiles.png` | 127022 | `834c5db69f9f75ee760dcf2ec11ab09093eda3ec22e53f91aec646979834b7ca` |
| `output/rev18/closure-v14-chunk-failure-ui.png` | 101628 | `9a1b138653af9541579fbc6c7f4a8a02b0e0a7b174935ac3a62b4f7184eb6910` |
| `output/rev18/closure-v14-drama-partial-ui.png` | 72179 | `add0cd540a11e7648ee2f6ae1f8738731e19180a326e035c9efc5ee6a345cf6a` |
| `output/rev18/closure-v14-drama-partial.json` | 4646 | `e791a474c088f3cdfb72e1151e9b21e5b4f9c8a14c0ff4f54891e4da1619ee84` |
| `output/rev18/closure-v14-drama-retry-ui.png` | 67103 | `32aa1ad7fb000da79c4bbff10972863bff276f8251cd2a2e0f31090b9686b409` |
| `output/rev18/closure-v14-drama-retry.json` | 5837 | `9d958e702f1d3653106072e789eb72108737851c0c0c239dcb33b3fa28a71e44` |
| `output/rev18/closure-v14-fault-dirs.txt` | 372 | `4e222a2f9e5a47475255e73c2836d2121e78dc627ada23ce4e5eda3aac6ae892` |
| `output/rev18/closure-v14-fault-events.txt` | 47 | `0693daf7a3fe0af259d40a7da1f063c192cd0a401c77c19be7a4b2dfa3438def` |
| `output/rev18/closure-v14-fault-hook.py` | 2120 | `7db13841d2c43bdb27cd114fd2006d73ceefcd3c7862797af678e4fc9d992137` |
| `output/rev18/closure-v14-fault-jobs.json` | 1390 | `30bfcfd416e85587c242ac206da78427b65b5e9c55506aa83f33ed92163e5aa9` |
| `output/rev18/closure-v14-fault-location.txt` | 78 | `3bd996535e9980fe84e1cb7bed6454cefdf5de08e91645a31e8450408ec6391e` |
| `output/rev18/closure-v14-fault-request-summaries.txt` | 923 | `c43053f7a7fa0f696af77310805da27995e00348f7f1a4d2b0672f1c02e19e58` |
| `output/rev18/closure-v14-final-gates.json` | 582 | `6fd14dd9ffa5358c45cf39b6138be093db9f2d3b32e10c7f6ec0526bb7c898d6` |
| `output/rev18/closure-v14-final-static.json` | 1382 | `4f630466c04049d7aba4d701e8bd458a9c58ec5b5a9bf107fa77e73fb16527d2` |
| `output/rev18/closure-v14-live-before-fault.json` | 8955 | `facbed1c786d0e1850e22b794dd56629efdab61d6d001e876525cdb409681531` |
| `output/rev18/closure-v14-longform-complete-ui.png` | 103639 | `050accec27e85ea39138842b3bc19f783969a32f6d9e8a2feba64e1fd2567f0d` |
| `output/rev18/closure-v14-longform-jobs.json` | 917 | `3b71c2fba05e9a8535c159d8f1d28a88fc9f05104e2852e45197ee5beea12eb8` |
| `output/rev18/closure-v14-presets-ui.png` | 69714 | `7175d99a063e860dcbb0751b0d1dfe7e668a834545f0f1cea91c4e30e9c69d39` |
| `output/rev18/closure-v14-privacy-current.json` | 189 | `fee6807938937a3b1c285a6e7f19ab692ddaca8fec8d4bb00d7bb99996803a00` |
| `output/rev18/closure-v14-remote-cleanup.json` | 823 | `9b8d909c9e1865ebf87b40e81e99e27c27f8c05d4aadd6b567d86e900764453c` |
| `output/rev18/closure-v14-transport-ui.png` | 98365 | `9a0b23150f656ab53a680eb8302e8d9a5b8a2395ac74b829696113337868b4fb` |
| `output/rev18/closure-v14-transport.json` | 387 | `88dfd2c2d4905aa71c72f0ee85f3afc2a4c6e753ec58f8d6bc3f18ef90a73c5b` |
| `output/rev18/closure-v14-voice-reference.json` | 1570 | `e9a3997acebdd2a7641b7dcb87287381244296776244e4eb21043e5ace4fd8e9` |
| `output/rev18/closure-v15-browser-chain/edit-1280.png` | 127720 | `85c6bb2a5ad92e93d7ed486f20a4ca5337ec215d55b9ce615d54f7bf4d5e4b44` |
| `output/rev18/closure-v15-browser-chain/edit-375.png` | 71813 | `9b305060f59b44b55c32028c9bdbbc5bf0efdffbe81609d91e686c8981c8c9dc` |
| `output/rev18/closure-v15-browser-chain/edit-768.png` | 93551 | `ea70d5e181aeeddbad08c4b4de924d9be258474c405fc258eb3579c59b71c11a` |
| `output/rev18/closure-v15-browser-chain/edit-recall-compact.png` | 130906 | `37f9bbbb9cfec5596beff9488dac9bc043c5916c153eac94c80378012f2d4d17` |
| `output/rev18/closure-v15-browser-chain/edit-studio.png` | 106050 | `fdb4f97678644f267a425399b2528b94c86d3ce5cc94ce71040ba46159ee9758` |
| `output/rev18/closure-v15-browser-chain/edit-workbench-results.json` | 2602 | `f3fdbe55084a5342184652112172074255b72909e138897d80d3e6d412e5de7b` |
| `output/rev18/closure-v15-browser-chain/inpaint-fx-landscape.png` | 78085 | `c2d813e562b8a59c9b61a538e6c2168f2b1eaaa9eed3e35a50ca969ffa8d5984` |
| `output/rev18/closure-v15-browser-chain/inpaint-fx-portrait.png` | 76003 | `3333a5cbe23de5bd8bab159f7528232d8ce106010fe6cb3d3da93f276bac83ef` |
| `output/rev18/closure-v15-browser-chain/inpaint-fx-square.png` | 76765 | `ff722d11ac9dc88685f72c50dd83d1c1f6fbbd9cf9b55f81a8c82dc28106c371` |
| `output/rev18/closure-v15-browser-chain/model-picker.png` | 158052 | `48f0448b80c2366ec1a2fc99302999b7eb3c0c9f8291c33d649d824f834d08a3` |
| `output/rev18/closure-v15-browser-edit/edit-1280.png` | 127720 | `85c6bb2a5ad92e93d7ed486f20a4ca5337ec215d55b9ce615d54f7bf4d5e4b44` |
| `output/rev18/closure-v15-browser-edit/edit-375.png` | 71799 | `93384340f59bbe39980a2bcbdc50110b0b3d9e52dbc4bea861dd94fe987a5b57` |
| `output/rev18/closure-v15-browser-edit/edit-768.png` | 94108 | `5c69b67e5c32ef31a10392b642b67c5fb4ef81d2e8cd2ede2ac3387b77c94568` |
| `output/rev18/closure-v15-browser-edit/edit-recall-compact.png` | 130906 | `37f9bbbb9cfec5596beff9488dac9bc043c5916c153eac94c80378012f2d4d17` |
| `output/rev18/closure-v15-browser-edit/edit-studio.png` | 105591 | `2ae75c367a5a919ec30f21e2f188e104d144cd8ae8ecf26bae6b2999efefa7c1` |
| `output/rev18/closure-v15-browser-edit/edit-workbench-results.json` | 2603 | `9d4c108e96680f5283674c302e61e3ce0eee51310368d80361f3a912235439e0` |
| `output/rev18/closure-v15-browser-edit/inpaint-fx-landscape.png` | 78592 | `e40eb2ee4bd893516d7f2b6a9dd3296fe4938b485c80e3b4fbbf9c07e9da6871` |
| `output/rev18/closure-v15-browser-edit/inpaint-fx-portrait.png` | 76003 | `3333a5cbe23de5bd8bab159f7528232d8ce106010fe6cb3d3da93f276bac83ef` |
| `output/rev18/closure-v15-browser-edit/inpaint-fx-square.png` | 76765 | `ff722d11ac9dc88685f72c50dd83d1c1f6fbbd9cf9b55f81a8c82dc28106c371` |
| `output/rev18/closure-v15-browser-edit/model-picker.png` | 158190 | `b05d7981d08bc189ad4b5a202e13a66a3dcf869ab0c54669fe4248d1418b222f` |
| `output/rev18/closure-v15-browser-voice/drama-375.png` | 69192 | `f18aa283ace32920d9e95d46abb9ba3575b446b099235d0e9bd4949da41d21af` |
| `output/rev18/closure-v15-browser-voice/drama-768.png` | 110625 | `057fef581714f42bb43822df7ee386a3d33f4970c08d9f3e8d3ef3760d81be15` |
| `output/rev18/closure-v15-browser-voice/drama.png` | 166724 | `18fae3efa11969930c8a15362a354e8a80ba97129790e43ee813822004e6d1dc` |
| `output/rev18/closure-v15-browser-voice/voice-375.png` | 60612 | `33d6c4880e589b44480e6451836471dea7e440df938589d83b3dda053a1c8d25` |
| `output/rev18/closure-v15-browser-voice/voice-768.png` | 86418 | `ae5fdc742d29b7384a0bb4666c7baace64d9cbdcc5f63b71c7aa9499bca08e96` |
| `output/rev18/closure-v15-browser-voice/voice-drama-results.json` | 1010 | `666d0e86216c989474dc69fd00b2d6b759cded21d03dd9a8cba213e8a8a6240b` |
| `output/rev18/closure-v15-browser-voice/voice-profiles.png` | 127022 | `6f74960c603ab76432dbdc16eda5c47db6fe71163d97f63c58f6210a27993d8f` |
| `output/rev18/closure-v15-final-gates.json` | 730 | `e3a2ca5121aa5704b97401612b0b1de3e380d75b56d6baf176dcf420a5f80c34` |
| `output/rev18/closure-v16-browser-chain/edit-1280.png` | 127836 | `208f7ba33c2813c65c7f4e3b7366be683c37106a47a61442617fce7d0866361e` |
| `output/rev18/closure-v16-browser-chain/edit-375.png` | 71733 | `6d6b2038899935d603de102a5c68a7c6a8541b50381ad39f16ca03283fc28123` |
| `output/rev18/closure-v16-browser-chain/edit-768.png` | 93555 | `a690f2247bedb40fb4944b4ecb0e1f43e7120a5fae23ebd5f6aa93ccddc5e6ef` |
| `output/rev18/closure-v16-browser-chain/edit-recall-compact.png` | 130906 | `37f9bbbb9cfec5596beff9488dac9bc043c5916c153eac94c80378012f2d4d17` |
| `output/rev18/closure-v16-browser-chain/edit-studio.png` | 106050 | `fdb4f97678644f267a425399b2528b94c86d3ce5cc94ce71040ba46159ee9758` |
| `output/rev18/closure-v16-browser-chain/edit-workbench-results.json` | 3020 | `4dae38015aa72805b0e065fdb7bd7304b73b45fd0653cbeea3bd2122778647fb` |
| `output/rev18/closure-v16-browser-chain/inpaint-fx-landscape.png` | 78114 | `ebe082398178f6f2652d7548bfdedde92d40b47e3eff331a8de37140eeb95a6f` |
| `output/rev18/closure-v16-browser-chain/inpaint-fx-portrait.png` | 76044 | `bd6c241d40dc798a8e733396541e58a996abdac6acf625ea461d500e8dfae3ce` |
| `output/rev18/closure-v16-browser-chain/inpaint-fx-square.png` | 76765 | `ff722d11ac9dc88685f72c50dd83d1c1f6fbbd9cf9b55f81a8c82dc28106c371` |
| `output/rev18/closure-v16-browser-chain/model-picker.png` | 158052 | `48f0448b80c2366ec1a2fc99302999b7eb3c0c9f8291c33d649d824f834d08a3` |
| `output/rev18/closure-v16-browser-edit/edit-1280.png` | 127891 | `4745705ec06822a59812bcc9cd69b2e0b6faea16c035f324bf1217e16dad4c11` |
| `output/rev18/closure-v16-browser-edit/edit-375.png` | 71813 | `9b305060f59b44b55c32028c9bdbbc5bf0efdffbe81609d91e686c8981c8c9dc` |
| `output/rev18/closure-v16-browser-edit/edit-768.png` | 94112 | `880a4601d1f41b4d0e1f1514f0374571751332aa237da7915c0f1f832112b4dc` |
| `output/rev18/closure-v16-browser-edit/edit-recall-compact.png` | 130906 | `4ee39e1bbc09d7bd504f2aa0189e67e9a416050c050925f485c9112c1c998900` |
| `output/rev18/closure-v16-browser-edit/edit-studio.png` | 105597 | `6dd6feb26401679e1f1fc33d6dea220cba44d798f4eaa95938a2ba54c5f60e84` |
| `output/rev18/closure-v16-browser-edit/edit-workbench-results.json` | 3020 | `b207cf5047dd3102e7399998a65cec880251b7afe1fc0ab6e437763d7125b38b` |
| `output/rev18/closure-v16-browser-edit/inpaint-fx-landscape.png` | 74838 | `008ea13107bb9c2098c47ef17eebf6c6dff05e418eb75eb639e9a0fc647ad0b8` |
| `output/rev18/closure-v16-browser-edit/inpaint-fx-portrait.png` | 76003 | `e6ea1f4f723e90cb50e9306795ce1e67040994e35bc7dcd6fefcca709e097429` |
| `output/rev18/closure-v16-browser-edit/inpaint-fx-square.png` | 76765 | `ff722d11ac9dc88685f72c50dd83d1c1f6fbbd9cf9b55f81a8c82dc28106c371` |
| `output/rev18/closure-v16-browser-edit/model-picker.png` | 158052 | `48f0448b80c2366ec1a2fc99302999b7eb3c0c9f8291c33d649d824f834d08a3` |
| `output/rev18/closure-v16-browser-gates.json` | 455 | `b171d3fb2f90b09d1367085b5f2b1237b401d967eb7db3fea51bef69151cb6c1` |
| `output/rev18/closure-v16-browser-voice/drama-375.png` | 69227 | `6b5b3aec40d0c1e124edb78793ff4ae9c91c7da23e01aca7aa28462f82daeef4` |
| `output/rev18/closure-v16-browser-voice/drama-768.png` | 105437 | `2645fb87ac2258d84d72c131a803b330262121c01a4a008d437f02ea9c47d349` |
| `output/rev18/closure-v16-browser-voice/drama.png` | 166895 | `022faaad27d32c892da3029096b08dfd8e9c53f14d22aeff155f971380c38edd` |
| `output/rev18/closure-v16-browser-voice/voice-375.png` | 60897 | `249d9c96b8889c4e7226abd4617b4060633af3ac65d068a2ba332cf8a7ab2fec` |
| `output/rev18/closure-v16-browser-voice/voice-768.png` | 86428 | `fe918284894611f5a9941bb509f842963180fb4449864f5da7d9277fe594cb55` |
| `output/rev18/closure-v16-browser-voice/voice-drama-results.json` | 1010 | `b051534d98ff4cb167c3d9d35a224af69e701c65208a987936c87254021e13d6` |
| `output/rev18/closure-v16-browser-voice/voice-profiles.png` | 127019 | `1a2958455ef1d275cdbb80ecc150a80fd0405dae7479acca374cb21bad403e23` |
| `output/rev18/closure-v17-blocker-table.md` | 1633 | `9117101594780b2c77b69559932060be6c8d14574086975886511b0eb9e9ca29` |
| `output/rev18/closure-v17-browser-chain/drama-375.png` | 69192 | `f18aa283ace32920d9e95d46abb9ba3575b446b099235d0e9bd4949da41d21af` |
| `output/rev18/closure-v17-browser-chain/drama-768.png` | 110731 | `8fb790df94589c7cb79d5c5fef267bbb70654ca5db5e78d53e24530687584ab3` |
| `output/rev18/closure-v17-browser-chain/drama.png` | 166804 | `1a34f36c857b1f4a882e8637ba1446e7fde0c985693ed32d46cd0c2c73cc96c7` |
| `output/rev18/closure-v17-browser-chain/edit-1280.png` | 127720 | `85c6bb2a5ad92e93d7ed486f20a4ca5337ec215d55b9ce615d54f7bf4d5e4b44` |
| `output/rev18/closure-v17-browser-chain/edit-375.png` | 71799 | `93384340f59bbe39980a2bcbdc50110b0b3d9e52dbc4bea861dd94fe987a5b57` |
| `output/rev18/closure-v17-browser-chain/edit-768.png` | 94108 | `5c69b67e5c32ef31a10392b642b67c5fb4ef81d2e8cd2ede2ac3387b77c94568` |
| `output/rev18/closure-v17-browser-chain/edit-recall-compact.png` | 130906 | `4ee39e1bbc09d7bd504f2aa0189e67e9a416050c050925f485c9112c1c998900` |
| `output/rev18/closure-v17-browser-chain/edit-studio.png` | 106050 | `fdb4f97678644f267a425399b2528b94c86d3ce5cc94ce71040ba46159ee9758` |
| `output/rev18/closure-v17-browser-chain/edit-workbench-results.json` | 2566 | `f7ae5447f3e6f6a23f9a2892af87453475593b241a1a2463c41a1da3ee1d4d5b` |
| `output/rev18/closure-v17-browser-chain/inpaint-fx-landscape.png` | 78114 | `ebe082398178f6f2652d7548bfdedde92d40b47e3eff331a8de37140eeb95a6f` |
| `output/rev18/closure-v17-browser-chain/inpaint-fx-portrait.png` | 75974 | `3a42e7454d140cb254a8a8f283776c3149ed13883e0a285356c87067e321dc10` |
| `output/rev18/closure-v17-browser-chain/inpaint-fx-square.png` | 76765 | `ff722d11ac9dc88685f72c50dd83d1c1f6fbbd9cf9b55f81a8c82dc28106c371` |
| `output/rev18/closure-v17-browser-chain/model-picker.png` | 158130 | `60df71612245887f3fcdf7bf68967908e12556e60192697b6b907c6c05206d5f` |
| `output/rev18/closure-v17-browser-chain/voice-375.png` | 60612 | `33d6c4880e589b44480e6451836471dea7e440df938589d83b3dda053a1c8d25` |
| `output/rev18/closure-v17-browser-chain/voice-768.png` | 86297 | `a9263b089cca5b497633834d681989add73f0724c0531e233edd61f995845299` |
| `output/rev18/closure-v17-browser-chain/voice-drama-results.json` | 1010 | `b1fd8280cdb4292ef361eef76a48d9fb6f9b2a9bd55117a4ff5a919590cace08` |
| `output/rev18/closure-v17-browser-chain/voice-profiles.png` | 127022 | `6f74960c603ab76432dbdc16eda5c47db6fe71163d97f63c58f6210a27993d8f` |
| `output/rev18/closure-v17-browser-edit/edit-1280.png` | 127720 | `85c6bb2a5ad92e93d7ed486f20a4ca5337ec215d55b9ce615d54f7bf4d5e4b44` |
| `output/rev18/closure-v17-browser-edit/edit-375.png` | 71799 | `93384340f59bbe39980a2bcbdc50110b0b3d9e52dbc4bea861dd94fe987a5b57` |
| `output/rev18/closure-v17-browser-edit/edit-768.png` | 94108 | `5c69b67e5c32ef31a10392b642b67c5fb4ef81d2e8cd2ede2ac3387b77c94568` |
| `output/rev18/closure-v17-browser-edit/edit-recall-compact.png` | 130906 | `4ee39e1bbc09d7bd504f2aa0189e67e9a416050c050925f485c9112c1c998900` |
| `output/rev18/closure-v17-browser-edit/edit-studio.png` | 105641 | `45b2f0edbd0a4fde31e0f067a0fee1b23dac442df127514891dc45cc457792a4` |
| `output/rev18/closure-v17-browser-edit/edit-workbench-results.json` | 2568 | `58947f68b96e5385976eb959d2df683209d6b0742553fe51eb9e217a2e4890dd` |
| `output/rev18/closure-v17-browser-edit/inpaint-fx-landscape.png` | 78114 | `ebe082398178f6f2652d7548bfdedde92d40b47e3eff331a8de37140eeb95a6f` |
| `output/rev18/closure-v17-browser-edit/inpaint-fx-portrait.png` | 75974 | `3a42e7454d140cb254a8a8f283776c3149ed13883e0a285356c87067e321dc10` |
| `output/rev18/closure-v17-browser-edit/inpaint-fx-square.png` | 76765 | `ff722d11ac9dc88685f72c50dd83d1c1f6fbbd9cf9b55f81a8c82dc28106c371` |
| `output/rev18/closure-v17-browser-edit/model-picker.png` | 158190 | `b05d7981d08bc189ad4b5a202e13a66a3dcf869ab0c54669fe4248d1418b222f` |
| `output/rev18/closure-v17-browser-gates.json` | 455 | `78c6b294fef199d2db6459164d28dcdf12085359fee47489d429f74242a595e6` |
| `output/rev18/closure-v17-browser-voice/drama-375.png` | 69192 | `f18aa283ace32920d9e95d46abb9ba3575b446b099235d0e9bd4949da41d21af` |
| `output/rev18/closure-v17-browser-voice/drama-768.png` | 110731 | `8fb790df94589c7cb79d5c5fef267bbb70654ca5db5e78d53e24530687584ab3` |
| `output/rev18/closure-v17-browser-voice/drama.png` | 167386 | `0f745366a6ddda96150b2fd369384f2e16964c44216a24ffafa428de4c16506a` |
| `output/rev18/closure-v17-browser-voice/voice-375.png` | 60612 | `33d6c4880e589b44480e6451836471dea7e440df938589d83b3dda053a1c8d25` |
| `output/rev18/closure-v17-browser-voice/voice-768.png` | 86297 | `a9263b089cca5b497633834d681989add73f0724c0531e233edd61f995845299` |
| `output/rev18/closure-v17-browser-voice/voice-drama-results.json` | 1010 | `50af789541e1db5dcdcb7a357ab3e09fcf1a556630003c6211457f4b0913a501` |
| `output/rev18/closure-v17-browser-voice/voice-profiles.png` | 127022 | `6f74960c603ab76432dbdc16eda5c47db6fe71163d97f63c58f6210a27993d8f` |
| `output/rev18/closure-v17-diff-check.json` | 64 | `049e2534c5c2546a175ffc900e5286a8ef2506b02b0fc3a23cedf0f44d8d4700` |
| `output/rev18/closure-v17-final-runtime.json` | 2539 | `c752f0053b494ced5ee68c09d022f24261d8efb890aa3b0f6e26eb927f360854` |
| `output/rev18/closure-v17-final-static.json` | 1334 | `54401e5c138f5d8c71bd45e16b0fbe542e0304414ebb74999d04e7160b1a2b25` |
| `output/rev18/closure-v17-live-acceptance.md` | 9373 | `1d4ddb1b2a424331e291af972cf1559321cad7ce49a2c885d1bd9617255b1c39` |
| `output/rev18/closure-v17-mask-clear-ui.png` | 52233 | `b96fd5dffadee995c04a2a8a6aa252adac592122cb810efad1c2d2b5a4b02981` |
| `output/rev18/closure-v17-sha256-manifest.json` | 24239 | `d4055c00df1dc667004ee4ec3b566bfe8307573f3fe81ec03ddadc97786d2bd3` |
| `output/rev18/closure-v17-static-unit-gates.json` | 694 | `102bb9643d19b0a83f3b30bfe8712b6d2e3347d95395ce8eea0005cd11d5d4a8` |
| `output/rev18/create-final-evidence.json` | 5277 | `4c0265dbfa4391051aff9731b711a1d95d0d3aa483ae425576496d6a3cf448cc` |
| `output/rev18/detailer/edge-face-mask.png` | 22656 | `3b7c85169859d7c8c089276140b0394405af7c846795c032466bc510c794c8ef` |
| `output/rev18/detailer/edge-hand-mask.png` | 23794 | `c4348882191fde665902a571697a6b8f2759da2df9c3187a065f3270c889a37c` |
| `output/rev18/detailer/edge-person-mask.png` | 50544 | `fb05fbcb91c131960eb90b0bdbb3aa8e7b850c1d7f309af32fb2ccb3d1f808bb` |
| `output/rev18/detailer/edge.png` | 564601 | `fee2cf345faf2e482f3f56289449c7c3372949c386079a45774b9dbdec1a0017` |
| `output/rev18/detailer/face-runtime-reconstruction-0.png` | 33774 | `59c2145fa0821f4281806393bf25e694c3c52967732b6a9ee4359a4df1ed05f2` |
| `output/rev18/detailer/face-runtime-reconstruction-1.png` | 33774 | `59c2145fa0821f4281806393bf25e694c3c52967732b6a9ee4359a4df1ed05f2` |
| `output/rev18/detailer/hand-runtime-reconstruction-0.png` | 31053 | `91d4b19d2ca4b63f6abc5645f53ec3867d621c9f48d7464d2f685259c7fb656e` |
| `output/rev18/detailer/hand-runtime-reconstruction-1.png` | 31053 | `91d4b19d2ca4b63f6abc5645f53ec3867d621c9f48d7464d2f685259c7fb656e` |
| `output/rev18/detailer/matrix.json` | 22317 | `bd2dba0e62b4c8a64ae8fb8a5288640f48f22d033bc3bb2828ebafe1e80cadc9` |
| `output/rev18/detailer/multiple-landscape-face-mask.png` | 39517 | `2cd0454903462fb59460d209269f88e17052c05d395b80b86833b94487135c95` |
| `output/rev18/detailer/multiple-landscape-hand-mask.png` | 44570 | `3251672f4d1503039e52b5c257df785e39f33c109b0855ba76e311119cfbc63f` |
| `output/rev18/detailer/multiple-landscape-person-mask.png` | 91409 | `0f2dec63916d3cd93a73c4110619937d49b5e30515add1e116d35b4ea2763829` |
| `output/rev18/detailer/multiple-landscape.png` | 340647 | `30058411b0faf92d1edae71a08d0762a29007c79dde2658ba2dd71ef94e32266` |
| `output/rev18/detailer/none-face-mask.png` | 4450 | `591975e97ba24ef8b6b40c403001cd9426c75bbae56afb7d7357240b232a86f1` |
| `output/rev18/detailer/none-hand-mask.png` | 4450 | `591975e97ba24ef8b6b40c403001cd9426c75bbae56afb7d7357240b232a86f1` |
| `output/rev18/detailer/none-person-mask.png` | 4450 | `591975e97ba24ef8b6b40c403001cd9426c75bbae56afb7d7357240b232a86f1` |
| `output/rev18/detailer/none.png` | 1576 | `ac3b08592975e04573b3177a7ee9032586405b4da02f8eeeacba22f54676cbff` |
| `output/rev18/detailer/outside-evidence.json` | 661 | `36f2280d25981f57c4fabdeb3c90094cd7c33ab9b7d375e8ad4dbb8b56c5db55` |
| `output/rev18/detailer/person-runtime-reconstruction-0.png` | 81173 | `02640804d1904751c51711cc01f69c4e40a2a2aab9821bb721689403401d33ab` |
| `output/rev18/detailer/person-runtime-reconstruction-1.png` | 81173 | `02640804d1904751c51711cc01f69c4e40a2a2aab9821bb721689403401d33ab` |
| `output/rev18/detailer/portrait-face-mask.png` | 41044 | `d51454dd46d95070890a782e6121af32c5f4d80d680d159e937807aaff794543` |
| `output/rev18/detailer/portrait-hand-mask.png` | 47825 | `4400dfd1124ed3c9d7041675e66fabc18d39ef0a02e19a6f01236f52614edf73` |
| `output/rev18/detailer/portrait-person-mask.png` | 109259 | `6d0e02ea4bf6e153b8f3f76d3470626972cb30d5ca967fd0c2c60165f7524df5` |
| `output/rev18/detailer/portrait.png` | 1115407 | `9de7bfe6765a8ca40c09e4ee843674f94c80d2554d11c81cfb36fe8b9d54e47c` |
| `output/rev18/detailer/small-face-mask.png` | 7022 | `4e2cebed154c54bf1a9d743c5a2d826963ec02aa75538581e44a54fe1b38fa3b` |
| `output/rev18/detailer/small-hand-mask.png` | 7022 | `4e2cebed154c54bf1a9d743c5a2d826963ec02aa75538581e44a54fe1b38fa3b` |
| `output/rev18/detailer/small-person-mask.png` | 20011 | `71b982d0a5540e3a5e78cdb8b3aed8cfa5533292e1ed9ee2f92501279b876711` |
| `output/rev18/detailer/small.png` | 29883 | `df66ddf25dd115be53b6ecaec5e47a580f344a4e3c5c4b4124308e7d6d55a6d4` |
| `output/rev18/detailer/square-face-mask.png` | 32912 | `73907ea4cee94a932d7cd0b82ab5db1485a6f35c683e49c246225752c8fbc4b0` |
| `output/rev18/detailer/square-hand-mask.png` | 38714 | `0fa24c86d762b0914ca46405819b2d9b2039e8ba40b69245151308b80fe171d9` |
| `output/rev18/detailer/square-person-mask.png` | 84747 | `ae76aacd94cc0e9241ce87bab13554590f97f42311f8950ab0c0e3dd0c98c41a` |
| `output/rev18/detailer/square.png` | 682259 | `7020c5758943ba7cfeecc848e5850046020ca935c8f7d0769816c1d5fd137a67` |
| `output/rev18/drama-after-restart.json` | 16103 | `c872498047a24ad7a308fedabf9c54e43c04d035301f4cc07297a05a171414d6` |
| `output/rev18/drama-evidence-final.json` | 16103 | `4119badc700ee80478f080d9395916025174dc175b1267b40195a7480a1dcdbf` |
| `output/rev18/drama-evidence.json` | 11725 | `314a8a643bf14208b36499413b30eb513102d4e7bfa455ec243664c340aecea7` |
| `output/rev18/drama-final-reload.json` | 16103 | `c872498047a24ad7a308fedabf9c54e43c04d035301f4cc07297a05a171414d6` |
| `output/rev18/drama-invalid-profile.json` | 16250 | `73f5c12f9434378d12cd08f5a5864ba38b0a31a9373cb60c0f3d4adb9f51b0fd` |
| `output/rev18/failure-job.json` | 70 | `f8dca066f242386cc1f05f540696966f5f561cbbfe9d88ba67402b532b163986` |
| `output/rev18/files-changed.md` | 22046 | `5e95e73c76f127b45371c9110873ea1287bbf270f81dfab74f9b24ee8cd581f5` |
| `output/rev18/final-gates.json` | 684 | `794806be194619d0160ec4c77727fb45f871c265c05099e7aa7ce79fca7930b2` |
| `output/rev18/final-static.json` | 1119 | `b516bb8527bc5c6d90c2963b097e4833aebaed91aaf01cbc9e031f506aca3ecc` |
| `output/rev18/gates/dex-rev18-closure-v14-chain.log` | 6860 | `cc4fef379a87061c09e0aac505d33a48e0df0c0a9f1ee4c032eabcf655861eb8` |
| `output/rev18/gates/dex-rev18-closure-v14-check.log` | 58 | `bcabb0f3851f0c38c59f41b8d969594206a0829c68ebefcadba3e34726d70324` |
| `output/rev18/gates/dex-rev18-closure-v14-edit.log` | 5764 | `9a1084986b4ccf45a24c7433bc066b4b4c6627d0136d834963b645473fd9a691` |
| `output/rev18/gates/dex-rev18-closure-v14-unit.log` | 23458 | `9ef0bbdecc2ce0e5d5f0d0cd17989e55832a21271dbff3e7f63775cee8ac8eb1` |
| `output/rev18/gates/dex-rev18-closure-v14-voice.log` | 2366 | `f107c6021e5a438302dc0d2178ec85a95b0c12fd97222e8374ea3bc13100ba47` |
| `output/rev18/gates/dex-rev18-closure-v15-chain.log` | 5570 | `bd0ad42719e4ebc9e8253ae197b2abf84fcf8c5554cddd0de5c46617ec0567ad` |
| `output/rev18/gates/dex-rev18-closure-v15-check.log` | 58 | `bcabb0f3851f0c38c59f41b8d969594206a0829c68ebefcadba3e34726d70324` |
| `output/rev18/gates/dex-rev18-closure-v15-edit.log` | 5531 | `c64b05fdbe8ecf93c19fed7d52abd111e97139b153c6d91249eb95072fb80ac1` |
| `output/rev18/gates/dex-rev18-closure-v15-unit.log` | 23441 | `edb65a1d1abc1334f8b62f85c3b7d0b1dc866e9dd052f110d57ab37ef07a0640` |
| `output/rev18/gates/dex-rev18-closure-v15-voice.log` | 2368 | `a3dbb91462e61139d2f9a28bb4bdb291b6e5009d7bb72c5fd11f4ed0575babe3` |
| `output/rev18/gates/dex-rev18-closure-v16-chain.log` | 5886 | `b43871e8e043921d9f33ac824414244bbdb487a6b200cbe1ed07c654bf4a7bb3` |
| `output/rev18/gates/dex-rev18-closure-v16-edit.log` | 5846 | `9e603b109d6fea5c57466cd227bf0be05ea0704441c751546920724f6514001c` |
| `output/rev18/gates/dex-rev18-closure-v16-voice.log` | 2366 | `d8f6345a79f45e898aeee06c818de9d0de4bb7174c0cea0dc41b84e947d5ea19` |
| `output/rev18/gates/dex-rev18-closure-v17-chain.log` | 7801 | `fdc3721fcba468338cf89b414ff4169c1f6666c0ea3bc0ea8a14bd09cc30a4d4` |
| `output/rev18/gates/dex-rev18-closure-v17-check.log` | 58 | `bcabb0f3851f0c38c59f41b8d969594206a0829c68ebefcadba3e34726d70324` |
| `output/rev18/gates/dex-rev18-closure-v17-edit-syntax.log` | 0 | `e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855` |
| `output/rev18/gates/dex-rev18-closure-v17-edit.log` | 5491 | `1b407e4c137e698b10a0e2a745703e67e717476e31b3c16224a14d0397961d77` |
| `output/rev18/gates/dex-rev18-closure-v17-unit.log` | 23435 | `2d40f482f01a3b9e59bf59efb977c8aaa2994cd073e161fe32bcea9fbc7c839d` |
| `output/rev18/gates/dex-rev18-closure-v17-voice-syntax.log` | 0 | `e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855` |
| `output/rev18/gates/dex-rev18-closure-v17-voice.log` | 2366 | `be3addf341e4f4d5259bfc4be9ab3cfefaf98fa8670359c21fb82dbb5fd9e5c8` |
| `output/rev18/gates/dex-rev18-final-v10-chain.log` | 7406 | `78ce84b627189cd5d9693d98f6241a4b36dcaac403b82eb5456100545d8ead11` |
| `output/rev18/gates/dex-rev18-final-v10-check.log` | 58 | `bcabb0f3851f0c38c59f41b8d969594206a0829c68ebefcadba3e34726d70324` |
| `output/rev18/gates/dex-rev18-final-v10-edit.log` | 5126 | `a385bdc0a1eaabd7ccefabec8d00881d7f0d2f9feae74dfb6fe19de99a51cb5b` |
| `output/rev18/gates/dex-rev18-final-v10-unit.log` | 23367 | `a751aefe92b356900bf46d56eb25648c1d52b54f11a58dd779760b3ed9221369` |
| `output/rev18/gates/dex-rev18-final-v10-voice.log` | 2735 | `e3206e483622f64af015edcafcf7ab14ed40fc9bc19a20d6035cb1a7a95fc2cd` |
| `output/rev18/gates/dex-rev18-final-v11-chain.log` | 7284 | `f1d79957639f9f95e7c88eccbb861be92175fe0a4ed77c7d9dbfdf1b4ddcc4d3` |
| `output/rev18/gates/dex-rev18-final-v11-check.log` | 58 | `bcabb0f3851f0c38c59f41b8d969594206a0829c68ebefcadba3e34726d70324` |
| `output/rev18/gates/dex-rev18-final-v11-edit.log` | 5110 | `dabf206c91475ed9fe47aa10c1ceec7e2516b9022977a9220de387c3e8d6cb8d` |
| `output/rev18/gates/dex-rev18-final-v11-unit.log` | 23319 | `c3955783f6218315fb026d286b2568056bb08731c92b4106e647c7926f12ad22` |
| `output/rev18/gates/dex-rev18-final-v11-voice.log` | 2032 | `0df1e377df17554ec509ff275e548394259bb0a5b9dca1b987eef1c24c873ebf` |
| `output/rev18/gates/dex-rev18-final-v12-check.log` | 58 | `bcabb0f3851f0c38c59f41b8d969594206a0829c68ebefcadba3e34726d70324` |
| `output/rev18/gates/dex-rev18-final-v12-unit.log` | 24029 | `1c4e206237426ce5ca5d69d383391210887c5b884102e888988980e7e808b908` |
| `output/rev18/gates/dex-rev18-final-v13-chain.log` | 7271 | `73627705d3f581b372ad024d948ba6e7f65fa74a5fb2f13f2ecbb32991f7b200` |
| `output/rev18/gates/dex-rev18-final-v13-check.log` | 58 | `bcabb0f3851f0c38c59f41b8d969594206a0829c68ebefcadba3e34726d70324` |
| `output/rev18/gates/dex-rev18-final-v13-edit.log` | 5107 | `7588ae6e5be02268aee4f875197adb525677790a788dd8d65dc1993a0ff460e8` |
| `output/rev18/gates/dex-rev18-final-v13-unit.log` | 23443 | `0658fc83143c598eecdc7a1bc541a2ffab9e0f50857872a31aa9e17ab9ac8818` |
| `output/rev18/gates/dex-rev18-final-v13-voice.log` | 2029 | `a94eb3387cf31ecd57d41ccf2beb1084482be7dfae71f0e8e963a05d6af630e0` |
| `output/rev18/gates/dex-rev18-final-v3-chain.log` | 7265 | `a2d394d1083c506c229aabf5b7c7f7d947cb218ab1bdab9184f961a9c0fef62e` |
| `output/rev18/gates/dex-rev18-final-v3-check.log` | 58 | `bcabb0f3851f0c38c59f41b8d969594206a0829c68ebefcadba3e34726d70324` |
| `output/rev18/gates/dex-rev18-final-v3-edit.log` | 5106 | `360544d583357a9cd9125aeebb50f3b49b19ca9d5e4b5db9de8b99a5b71ada03` |
| `output/rev18/gates/dex-rev18-final-v3-unit.log` | 23063 | `416b3402876705e68441b8825e9a31d0aa0b6d73f9a74c9b14b75ed9e03ed29c` |
| `output/rev18/gates/dex-rev18-final-v3-voice.log` | 2027 | `79448a4e6cf66a687a031a2757f715e55cd32d912661be061fc754fdcae22f4d` |
| `output/rev18/gates/dex-rev18-final-v4-check.log` | 58 | `bcabb0f3851f0c38c59f41b8d969594206a0829c68ebefcadba3e34726d70324` |
| `output/rev18/gates/dex-rev18-final-v4-unit.log` | 24096 | `263f14eff07142135e10d1cc048416d5a259febc63682f15da2a22b5936231fe` |
| `output/rev18/gates/dex-rev18-final-v5-chain.log` | 7424 | `0c178d2771c7052577c22fc102a2965fcdb73d6b8c1a61cacd74af78fb12f9f4` |
| `output/rev18/gates/dex-rev18-final-v5-check.log` | 58 | `bcabb0f3851f0c38c59f41b8d969594206a0829c68ebefcadba3e34726d70324` |
| `output/rev18/gates/dex-rev18-final-v5-edit.log` | 5107 | `b545fd63cc90c684e48b0579c17c728fe28da5f9aa513dd94bb670a62eb1529b` |
| `output/rev18/gates/dex-rev18-final-v5-unit.log` | 23169 | `dd8b6fda5c2c7af306e94f4410283926b342746166ddcc6badfad9b7fd27255d` |
| `output/rev18/gates/dex-rev18-final-v5-voice.log` | 2027 | `448b8f4a3321f27938919cc0120d56539ee404b687112af407efb1e6d1c748e9` |
| `output/rev18/gates/dex-rev18-final-v6-chain.log` | 7262 | `678a38c4ee6b457029ab447fb8c3e1fd1b3fb024cbb74e6613654b1b985d6553` |
| `output/rev18/gates/dex-rev18-final-v6-check.log` | 58 | `bcabb0f3851f0c38c59f41b8d969594206a0829c68ebefcadba3e34726d70324` |
| `output/rev18/gates/dex-rev18-final-v6-edit.log` | 5106 | `c96077717d623ec77aa65de584b12233b43ad2bd7e19a334cf106b730607e382` |
| `output/rev18/gates/dex-rev18-final-v6-unit.log` | 23135 | `95ff3f1ddaa55bc188744460ccafc3ddcfc34347aff9f70d4c14c5e599411e9c` |
| `output/rev18/gates/dex-rev18-final-v6-voice.log` | 2026 | `ca748584bcb5aea3c8b3d57e0f7339961f945a3937b272c8f4bbd207a60a9fbe` |
| `output/rev18/gates/dex-rev18-final-v7-chain.log` | 7263 | `115a357967f198db8383449c39cd1c919f2a62208d9ef11df13dd36a8b82e800` |
| `output/rev18/gates/dex-rev18-final-v7-check.log` | 58 | `bcabb0f3851f0c38c59f41b8d969594206a0829c68ebefcadba3e34726d70324` |
| `output/rev18/gates/dex-rev18-final-v7-edit.log` | 5106 | `19f63e0e8022a7c607cacd2bd249d386f40188d07b9e6a9cc6c48cf4f0cd3857` |
| `output/rev18/gates/dex-rev18-final-v7-unit.log` | 23214 | `bbfaf0a2009204bb09886679618f9f01f3c99758636aa93d98653351560f8d44` |
| `output/rev18/gates/dex-rev18-final-v7-voice.log` | 2026 | `09abd0cf83094a311523544db9c4c89a857e3fe8123dd7f703f01ae8ba4239b1` |
| `output/rev18/gates/dex-rev18-final-v8-check.log` | 58 | `bcabb0f3851f0c38c59f41b8d969594206a0829c68ebefcadba3e34726d70324` |
| `output/rev18/gates/dex-rev18-final-v8-edit.log` | 1431 | `998382f8db3f79ea6dfd1b10695a5a470f1e48a37343f5a2b8a5bf7201dfa482` |
| `output/rev18/gates/dex-rev18-final-v8-unit.log` | 23381 | `9f27995a77a455195b74770bbf4d36c9d8a1b51f21c69d770580050a3a17fa25` |
| `output/rev18/gates/dex-rev18-final-v9-check.log` | 58 | `bcabb0f3851f0c38c59f41b8d969594206a0829c68ebefcadba3e34726d70324` |
| `output/rev18/gates/dex-rev18-final-v9-edit.log` | 1471 | `fe26a81632a0bfaac91ad74012760ea13edd1ec121b3688c83c6930ab011f119` |
| `output/rev18/gates/dex-rev18-final-v9-unit.log` | 23513 | `bf9e9eb22394f3dc2d4756905ba891df3035d30e43e545655d624d7b9fb682bf` |
| `output/rev18/inpaint-evidence.json` | 325 | `7865d8774d493a5771b7f0ab96c5cc1c9be31ca588dee781271f6ebca09a20f7` |
| `output/rev18/interrupted-evidence.json` | 636 | `ad2684d3172c694f86acf21471d00cf07b36300969b75df9b3192d8452219ff3` |
| `output/rev18/interrupted-job.json` | 70 | `da0293ef825f9e49dd9489d5bf25daae8df8cd492c6a0590ad7fda71a3c029f7` |
| `output/rev18/longform-final-evidence.json` | 2767 | `13bda0960ee072a433effb6677890b74bf0dade979858eb3af2ad036b200c42c` |
| `output/rev18/mask-1782218701338.png` | 68 | `86686d9eb005257d237bb3b85b31348df465768c082b5d210d22bf99ab7e5bfb` |
| `output/rev18/mask-1782218779419.png` | 71 | `30c3ada9f109a9efd758a008caf4a44ad7c7d8d81c66ff9f2c25bb893c854f84` |
| `output/rev18/mask-1782218989669.png` | 71 | `30c3ada9f109a9efd758a008caf4a44ad7c7d8d81c66ff9f2c25bb893c854f84` |
| `output/rev18/mask-1782219007533.png` | 72 | `19c4517270b460feb120f774d80d149d9bb2d53a2071c51a72249293dbe22d7b` |
| `output/rev18/mask-1782220165488.png` | 72 | `19c4517270b460feb120f774d80d149d9bb2d53a2071c51a72249293dbe22d7b` |
| `output/rev18/mask-1783494704512.png` | 1422 | `08012ae167ebb59415d47e2fccef3710be77cdb66a9d9a7331e9c19c69fe0a0f` |
| `output/rev18/mask-1784054846975.png` | 1129 | `4f2f0daf04517603c186a25c6c498bd36d71e0d3d862299ce3ac075ad237d419` |
| `output/rev18/mask-1784055197007.png` | 1220 | `ca2ac60c91dc8cae583ae3ffc71696bd31204264944e4c25dd0b778898e89efd` |
| `output/rev18/mask-1784060391321.png` | 1125 | `796eb4d67097708f0fa41824c76295b44c326933deff9b4e59bd2d201c8a05fd` |
| `output/rev18/mask-1790393602993.png` | 1301 | `d8acccafa1fdcf03f3bb9112f5f2f30ad1558e446d5c12ec5644fc0d53c1e58b` |
| `output/rev18/mask-1790393711707.png` | 690 | `39d09e034a5425c9f920af78c7e9a32c844ded652079d38968d249bdff9097a8` |
| `output/rev18/mask-1790996101523.png` | 2180 | `7a4a8c500f30b74075653c257bd539774a91600eef335cab76478c9d057a2263` |
| `output/rev18/outpaint-evidence.json` | 167 | `973f1088e137c4b0b4ce11367fc3462f83772bb349edbd1d4a1c96a5608047da` |
| `output/rev18/privacy-cleanup-final-remote.json` | 2630 | `60ea1a02d46cfc458824756708786104d868132fbce51e1aec09de16160925ad` |
| `output/rev18/privacy-final-local.json` | 1187 | `8416fe99c62666d48e72ef4e6d9f343e0b9eb78e18079d8ed3501fd2aa1535e1` |
| `output/rev18/privacy-local-final-current.json` | 607 | `0242ba2ddf88bc7ad2c261ec63e57e53389f709b6e6eff86abb1377195d23c23` |
| `output/rev18/privacy-local.json` | 142 | `85f5d2805005333773d421623ce9e8b7d854818563149da6b00896a5236db563` |
| `output/rev18/publication-staged-whitespace.json` | 9356 | `3554b5362453b4f86617ccf7369cda20010ca4b7151ce780770a9e1fb441e137` |
| `output/rev18/resources-current.json` | 211 | `ec57eac3526c5d62272815ff7bf0f3b421fd3b3069fd4ffe95353226751e9043` |
| `output/rev18/resweep-final.md` | 525 | `ffa7c9538ce2cfb64bca338a2035c34ca93baf39d709df3f6663ff142c72a131` |
| `output/rev18/retry-evidence.json` | 3001 | `1dfc86bea85e287ccf0fe896bc89f0bfeb935bb5a8e4c525eaa21c1fc86ea4fa` |
| `output/rev18/retry-job.json` | 70 | `4cbe773d16995e65f2837ece6125a54f6d9ccca74fbbbd2d664692aea229eb44` |
| `output/rev18/runtime-final-current.json` | 17677 | `ea9bc2532fa19ae19e64e37c5186dc8216d3c3648317c04864a60e9db4897ebe` |
| `output/rev18/sha256-manifest.json` | 18464 | `dca5c32919e33baaa149627a3d69f0457c8a59d29bec62f37e00c2472e161209` |
| `output/rev18/staged-rejection-fixed.json` | 451 | `b336d759d7789186a839f2c80726d595762578df944767fc3f63a6425977b370` |
| `output/rev18/staged-rejection-repro.json` | 239 | `03a278071f4ba541fe2d6e30904975c3f804c038696b5b971ebbf388aab91151` |
| `output/rev18/ui-matrix-summary.json` | 1113 | `7081e07f9b5dbb0a4bbf513dcedc30e291b6fcba896ef1aa88d67adfb693fcf9` |
| `output/rev18/voice-jobs-current.json` | 40310 | `a87b72ed7e02550f8a51da7d16bf94cca83639582fcdf422c517acece14bdc9a` |
| `output/rev18/voice-library-current.json` | 25096 | `c762f160f8c1ba9bbad8e6ce9e103724a90072100b7c48960d3c244644d3d96a` |
| `sdcpp-workflow/bin/mflux-controlled-generate.sh` | 12482 | `baa9b36559bd6a4ef9dbef4ab162d8a62219f324c6ff311b05febf17f523bcbc` |
| `sdcpp-workflow/bin/redact_stream.py` | 3771 | `663c9c45dda3a8771d2a662d0e3dc263dbd1b7c76e1ea898672cd9acbd50f02e` |
| `sdcpp-workflow/bin/sdcpp-cli-generate.sh` | 11341 | `a0d5ad9f66d5836cec81e56943007f2024c705df1f476398c95e154a4edb1060` |
| `sdcpp-workflow/bin/sdcpp-controlled-generate.sh` | 47614 | `5e5160488dd335fe0ac1c28ec3529f8e70c1307e3b5c2652e7d64eacc777b84a` |
| `sdcpp-workflow/bin/sdcpp-img2img.sh` | 12230 | `cdb807235014d4c7bf43a54c17f52fc72d9835957a681b845aec7f7cacda0224` |
| `sdcpp-workflow/bin/sdcpp-inpaint.sh` | 13580 | `d38a212425b1653f890e723b61430b840d654d1a8fd93211ad53ef05b539aa65` |
| `sdcpp-workflow/bin/sdcpp-server-generate.sh` | 14998 | `b23589cd2491b506a0871a797859b4eacda64614afad9b5da026df1451299103` |
| `sdcpp-workflow/bin/sdcpp-xyz-plot.sh` | 14013 | `c0358b8d3e7d0f3ed16485980106bb5691a1e91d8c98e31eeb18adaefb0c90ad` |

## Appendix A. Preserved pre-closure acceptance report

This appendix is historical v13 material. It documents the broader earlier production/live work and its limitations. Statements such as “uncommitted,” storage/tooling blocked, and missing continuation cases describe that older checkpoint; current blocker status and publication are in sections 1–3 and 9 above. Earlier live observations are not represented as freshly rerun in the continuation.



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
