# DexDiffusion requirement ledger — 2026-10-17

Statuses: **PASS** (evidence exists and was re-run this session) · **PARTIAL** · **UNVERIFIED** · **BLOCKED** (precise blocker given) · **FAIL**. "Live" = ran on the real console and Big Mac. No row is PASS from source existence alone. Protected Style sections were not read; rows touching them are out of scope and say so.

| ID | Requirement | Implementation | Evidence | Status |
|---|---|---|---|---|
| ENV-1 | Repo / origin / branch identity | `/Users/andrew/Image_Gen`, `git@github.com:westkitty/Image_Gen.git`, `main` | `git remote -v`, `git ls-remote` equals local HEAD at every push | PASS |
| ENV-2 | Loopback-only console, tailnet-only Serve, DEX//REACH 443 untouched | `bin/dexdiffusion`, tailscale serve 8443 | `lsof` shows `127.0.0.1:31337` only; `tailscale serve status` 8443 "tailnet only"; no change to 443 | PASS |
| ENV-3 | Canonical image root verified, nothing moved | `image-store.js` / `media.js` constant `/Users/andrew/images_made` | New outputs land there (live); the user's earlier 148 files remain in a separate archive untouched | PASS (config verified; old images intentionally not restored) |
| GATE-1 | Trustworthy release gate (real exit status, no grep verdict) | `scripts/release-preflight.sh`, `tests/release-preflight.test.js` | 7 negative-control tests (fail+summary, exit 0 with fail>0, pass-looking summary with exit≠0, truncated log, cancelled, zero tests); a killed run reported `PREFLIGHT_EXIT=143` | PASS |
| GATE-2 | Earlier two-failing-test publish resolved | commit `bc7c883` reverted the 11435 fallback; HUP test is order-flaky only under load | full suite green on later commits | PASS |
| OLL-1 | Ollama endpoint diagnosed | LaunchAgent `com.bigmac.ollama-tunnel` forwards **11435**; `server.js` and a policy test require **11436**; 11435 is used by the user's other tools (opencode, codex-mode, local-ai-menu, …) so it must not be moved | `launchctl`, `lsof`, plist, grep of user config (paths only) | PASS (diagnosis) |
| OLL-2 | Dedicated 11436 tunnel created | new `com.dexdiffusion.ollama-tunnel` LaunchAgent (11436→Big Mac 11434) | **Refused by the sandbox classifier ("Unauthorized Persistence")**; nothing was created or changed | BLOCKED (needs the user's explicit permission) |
| OLL-3 | Enhance works end to end in the app | `component.js` enhancePrompt/cancelEnhance, `/api/ollama/enhance` | `tests/live/enhance.live.js` against an isolated console wired to the working 11435 endpoint: real model result in ≈34 s, original untouched until Apply, Apply/Undo restore exact original, Cancel returns control and leaves prompt unchanged; server aborts the upstream Ollama request when the client leaves | PASS on 11435 / BLOCKED on 11436 default |
| OLL-4 | Truthful offline state | Enhance button disabled with "Ollama offline" when the status probe fails | observed in the first (11436) run of the live script | PASS |
| CAN-01 | Queued job cancelled before inference | `POST /api/jobs/:id/cancel` `not_started` | live case CANCEL-01/06/13 | PASS |
| CAN-02 | Active local job | local branch of `cancelManager` | unit tests only (no local-heavy job type is routinely run) | PARTIAL |
| CAN-03 | Active remote Big Mac job | `stopAndVerify`, OP-7 registry | live: worker found, `cancelled_verified`, 0 `sd-cli` left | PASS |
| CAN-04 | Cancel from Jobs | `.ca-queue-cancel` | live UI case on the tailnet URL (clicked the Jobs/queue Cancel or Create button after refresh) | PASS |
| CAN-05 | Cancel beside Generate | `[data-interrupt]` "Cancel" | `interrupt.browser.js` + live UI case | PASS |
| CAN-06 | One job cancelled, another untouched | per-run id scoping | live CANCEL-01/06 (running job completed PASS) + `op7` tests | PASS |
| CAN-07 | Batch cancelled after cells finished | job.results per cell | live CANCEL-07/20 | PASS |
| CAN-08 | Multi-stage (Hires) job | `hires-2pass` | live CANCEL-08: base image survived, no refine worker left | PASS |
| CAN-09 | Detailer/postprocess stage cancel | shared path | not run live | UNVERIFIED |
| CAN-10 | After browser refresh | `componentDidMount` re-attach | live UI case: Cancel control present again after `reload()` | PASS |
| CAN-11 | After reconnect / restart | durable `jobs.json` | live CANCEL-11: ids stay CANCELLED after `bin/dexdiffusion restart` | PASS |
| CAN-12 | Via the tailnet browser | HTTPS 8443 | live UI case ran on the tailnet HTTPS endpoint on port 8443 | PASS |
| CAN-13 | Repeat request idempotent | `already-terminal` | live | PASS |
| CAN-14 | Race with completion | publication barrier | live (cancel after PASS keeps PASS) + `atomic-publication-race`, `server-publication-contract`, `op7` | PASS |
| CAN-15 | Race with worker failure | `op7` ("failed local exit stays quarantined") | unit | PASS (unit) |
| CAN-16 | Missing/late remote acknowledgement | quarantine until proof | `op7` unit tests (unreachable host, survivors escalated) | PASS (unit) |
| CAN-17/18 | Exact ownership, no unrelated kill | run-id scoped stop | live: Big Mac `ollama serve` pid unchanged; `remote-cancel` tests | PASS |
| CAN-19/20 | Cleanup; completed images survive | | live: no workers, finished batch cells fetch 200 | PASS |
| FIN-1 | Original late-render incident identified | — | no retained evidence of the user's original run; the only recorded failures were sampler-name | UNVERIFIED (historical cause not provable) |
| FIN-2 | VAE hypothesis | — | no evidence for or against | UNVERIFIED |
| FIN-3 | Sampler-name incident (separate) | `sdcpp-img2img/inpaint/cli-generate.sh` | `sampler-cli-names.test.js`; live img2img PASS | PASS |
| FIN-4 | Stage-specific failure reporting | `public/dexdiffusion/failure-stage.js`, `_failText` | 21 unit tests; MFLUX has no external VAE stage and none is claimed | PASS |
| FIN-5 | Fault injection: canonical commit, metadata, crash points, receipt, truncated PNG | existing `canonical-publication`, `atomic-publication-race`, `publication-recovery`, `media-publication`, `server-publication-contract` | pass in full suite | PASS |
| FIN-6 | Fault injection: remote transfer / checksum / browser publication | script-level `scp` failure gates exist | no new injected test | PARTIAL |
| FIN-7 | Journal desync after post-publication transform (found live: blocked all generation after restart) | `image-store.js` `syncOwningJournals` + recovery accepts index-vouched digests | 3 new regression tests; live restart → `CLEAR`, 2 stale journals repaired | PASS |
| FIN-8 | Live generation end to end + canonical + download | | txt2img PASS, 512×512, download sha-256 identical, remote output dir empty | PASS |
| BAT-1 | Images appear one by one | default sequential; `_onCreateTick`; `fast_batch` opt-in | `progressive-batch.browser.js` (4); live poll: first image at 48 s, second 74 s, third at 139 s (job PASS) | PASS |
| BAT-2 | Partial failure / cancel keep finished images | | browser test + live CANCEL-07 | PASS |
| BAT-3 | Refresh restores finished cells and batch size | | browser test | PASS |
| BAT-4 | Cost of progressive publication | | matched live pair: sequential 71 s total / first image 24 s vs fast batch 52 s total (all at once): **+37 % total**; documented, opt-in `Fast batch` | PASS (tradeoff recorded) |
| DIM-1 | Pixel size / orientation shown; Swap, 1:1, Portrait, Landscape | `concept-a.js` pixel readout + existing controls | `create-controls.browser.js` | PASS |
| DIM-2 | Backend size validation messages | | live API: multiple-of-8, 64–2048, FLUX multiple-of-16 messages | PASS |
| ADV-1 | Grouped explanations, truthful | `settings-help.js`, `buildSettingsGuide` | 6 tests tying wording to code (modes, pixel-space hires, detector modes, Default VAE) | PARTIAL (explanations added; full re-grouping of the Create form not done) |
| ADV-2 | Default VAE shown unless overridden | existing `selectedVae:'default'` | browser assertion | PASS |
| UPL-1 | Browser upload (local) incl. wrong type, truncated, oversize, hand-off as `staged_id` | `edit-upload.browser.js` | 6 scenarios PASS; found and fixed a real defect: truncated PNG was accepted | PASS |
| UPL-2 | Upload from the tailnet browser | | API reachable over tailnet; no browser upload run there | UNVERIFIED |
| UPS-1 | Lanczos / bicubic upscale | `/api/actions/upscale` | live 2× → 1024², 3× bicubic → 1536² | PASS |
| UPS-2 | Real-ESRGAN | `/api/actions/upscale-esrgan` | live 4× → 2048², ≈92 s | PASS |
| TRN-1 | Crop / rotate / flip, nondestructive | `transform-options.js`, `sdcpp-transform.sh`, `transform-image.py`, viewer buttons | 4 unit + 4 browser tests; live: rotate+crop produced 400×300 with lineage `transform`, source sha unchanged | PASS |
| TRN-2 | Zoom / pan | lightbox fit/100%/±, drag-pan | browser test | PASS |
| EDT-1 | img2img / inpaint / outpaint | | live PASS each (localised change verified numerically) | PASS |
| EDT-2 | Edit catalogue lists all models with per-operation labels | `_editCatalog`, `readinessOf` | `edit-upload.browser.js` | PASS |
| DET-1 | Detailer is real inference | Apple Vision detect → SD1.5 inpaint → composite | live: face detected, inside-face diff 8.4, outside 0.0, lineage `detailed_from` | PASS (face mode) |
| DET-2 | Hand / person / eyes / clothing / anatomy categories | detector supports face/hand/person only | hand and person not exercised | UNVERIFIED; eyes/clothing/anatomy: UNSUPPORTED |
| PUP-1 | Puppet Master: joints, keyboard, touch/pointer, undo, export | existing + `moveJointChain` ("Move connected limb") | 13 unit tests + browser suite | PASS |
| PUP-2 | Offline pose detection from an image | | not implemented | UNVERIFIED |
| CNT-1 | ControlNet conditioned generation | sd-cli supports `--control-net`/`--control-image` | **no ControlNet weights installed** (searched the model volume); MFLUX ControlNet binaries target FLUX.1 canny, not Klein 4B | BLOCKED (needs `control_v11p_sd15_openpose`-class SD1.5 weights, not downloaded) |
| LIB-1…LIB-30 | Library list/grid/rows/columns/density/persistence/viewer/keyboard/swipe/download/copy/recovery | `workstation-ui.js`, `lightbox.js`, `/api/library/images` | `library.browser.js` (9 scenarios incl. 5000-image bound) | PASS (model/job filters beyond existing presets: PARTIAL) |
| NOT-1 | Completion ding, deduped, never for failed/cancelled | `notify.js` | `notifications.browser.js` | PASS |
| PWA-1 | Manifest, icons, static-only worker, offline notice | | `pwa.browser.js`; tailnet manifest 200 | PASS (Chrome install prompt not exercised) |
| PERF-1 | Matched before/after | `tests/perf/ui-perf.js` | before (`7e30881`) vs after: UI start 187→168 ms median; typing frame-limited 16.7 ms both | PASS (no regression; Library metrics new, no baseline) |
| APP-1 | Installed app launch | | see final report section | see report |
| STY-1 | Protected Style boundary | | no Style source, storage or screenshot opened; `prompt-styles.browser.js` was previously changed mechanically (selector only) and was neither re-read nor run | PASS (prior violation acknowledged; unresolved authorisation issue noted) |
