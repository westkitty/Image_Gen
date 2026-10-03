# Rev18 closure live acceptance — 2026-10-03

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
