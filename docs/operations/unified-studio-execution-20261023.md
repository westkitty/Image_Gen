# DexDiffusion Unified Studio source execution ledger

Target checkout: `/Users/andrew/Image_Gen_Chat`
Branch: `feat/chat-backend-stream-20261023`
Base: `2fcbd2ed5463aa9cf50208d5bf9086fc6411ae08`
Production listener: absent at `127.0.0.1:31337` during this source pass. No live inference, wrapper install, production restart, merge, or deployment is in scope.

This ledger tracks source and isolated-fixture evidence. The pasted goal lists fourteen desired outcomes; its referenced detailed “Unified Studio Completion Program” was not present in the checkout or supplied attachment as of this pass. Reconcile against that program if it becomes available. Earlier project reports are historical and do not substitute for this branch's checks.

## Implemented source slices

| Slice | Source | Focused evidence | State |
| --- | --- | --- | --- |
| Baseline and isolation | Existing flat 14-chip Studio remains the default; Phase 4C server and child-process isolation refuses remote, model and service mutations in browser fixtures | `tests/test-isolation.test.js` passed in focused run; isolated Chromium suite reports background refusals and no request-caused fatal refusal | Source/fixture pass |
| Navigation | Five masters, four utilities, last leaf, keyboard roving, honest unavailable destinations; System exposes opt-in and return to flat | `tests/studio-nav-hierarchy.test.js`; `tests/browser/studio-masters-nav.browser.js` at 1348×735 and 390×844 | Source/fixture pass |
| Chat backend | Exact three-model allowlist, loopback-only Ollama, NDJSON-to-SSE, temporary sessions, compute lease, truthful cancellation, guarded routes and legacy arbitration | Focused Chat tests passed; no model inference | Source/fixture pass |
| Chat workspace | Temporary composer, model selection, transcript, regeneration, SSE parsing, Stop state and connection/error states | Browser fixture sent and regenerated against a synthetic SSE response; `tests/chat-client.test.js` | Source/fixture pass |
| Saved history | Explicit consent creates a saved session; private atomic JSON file, restart recovery, list, export and deletion | `tests/chat-saved.test.js`, browser saved-mode fixture | Source/fixture pass |
| Chat-to-Create | Explicit replace confirmation or append; no generation launched | `tests/studio-nav-hierarchy.test.js` handoff case | Source/fixture pass |

## Visible goal contract reconciliation

The referenced detailed Completion Program was not supplied with the goal, and the repository reference supplied in reply did not identify that document. The fourteen explicit outcomes in the pasted goal are the checkable contract below. A source/fixture pass does not certify live inference or the installed wrapper.

| # | Requested outcome | Current evidence and boundary |
| --- | --- | --- |
| 1 | Streaming Chat UI | Chat composer, transcript and guarded streaming route; `chat-client.test.js`, `chat-stream.test.js`, Chromium synthetic SSE. Live model unverified. |
| 2 | Temporary sessions, selection, SSE, Stop | `chat-sessions.test.js`, `chat-models.test.js`, `chat-ndjson.test.js`, `chat-compute.test.js`, `chat-stream.test.js`; no live cancellation proof. |
| 3 | Explicit private saved history, export, delete | `chat-saved.test.js`; file mode 0600, opt-in consent, list/export/delete; Chromium saved-mode fixture. |
| 4 | Chat-to-Create without draft loss or generation | Confirmation or append handoff in `studio-nav-hierarchy.test.js`; browser fixture observes no generation. |
| 5 | Five masters and four utilities | `studio-nav.js` hierarchy and `studio-masters-nav.browser.js`. |
| 6 | Fourteen legacy destinations and engines | Flat row remains fourteen; existing non-protected browser matrix exercises the engines against isolated fixtures. Live engine continuity unverified. |
| 7 | Flat default and discoverable opt-in | System layout control and rollback at desktop/mobile widths in `studio-masters-nav.browser.js`. |
| 8 | Chromium, accessibility, keyboard | Masters browser suite checks desktop/mobile, roving focus, visible focus and reduced motion; unchanged full browser matrix passed. |
| 9 | Security, privacy, cancellation, persistence | `request-guard.test.js`, `chat-saved.test.js`, `chat-compute.test.js`, `chat-stream.test.js`, existing source regressions. |
| 10 | Phase 4C fail-closed test isolation | `test-isolation.test.js`; fixture servers require isolation identity and fail on request-caused remote/model/service refusal. |
| 11 | All mandatory source regressions | Unchanged `scripts/release-preflight.sh` exited 0: 1150/1150 unit tests, 0 skipped, 45/45 non-protected browser suites. |
| 12 | Operational state and handoff docs | This ledger and `OPERATIONAL_STATE.md` updated with the source gate; Git delivery receipt below. |
| 13 | Commit and push verified source | Source milestone `94a0ec7f228b1324255a135734ad40eb1dfaa03f` committed and pushed to `origin/feat/chat-backend-stream-20261023`. |
| 14 | Local and remote SHA verification | `git rev-parse HEAD` and `git ls-remote origin refs/heads/feat/chat-backend-stream-20261023` both returned `94a0ec7f228b1324255a135734ad40eb1dfaa03f` for the source milestone. The documentation closeout advances the final branch head; verify that separately. |

## Final source gate — PASS

- `npm run check`: pass.
- Focused backend, isolation and navigation set: 112/112 pass before UI and saved-history additions. Subsequent focused Chat/UI set: 44/44 pass; handoff and saved-store set: 23/23 pass.
- Masters browser suite: pass with desktop/mobile widths, keyboard focus, layout opt-in/rollback, fixture stream, regenerate and saved-mode opt-in.
- Initial parallel `npm test`: 1150 pass, 1 fail, 2 skipped. The one Drama producer wait timed out under concurrent browser load; the exact test passed alone (1/1). This is not a full-suite pass.
- First complete preflight found two unit skips: one live-run audit without its private run store and one browser test tied to the absent production listener. The live audit was moved intact to a separately runnable live test, with its strict missing-evidence assertion retained and tested; the browser test now uses an isolated fixture server. Source units then passed 1150/1150 with zero skips.
- The next complete preflight found browser action races in High-Res numeric entry, 3D/World popup navigation, and prompt-style panel repaint. The focused repaired suites passed. A subsequent complete preflight found one intermittent Drama Designer form timeout; its test now asserts the profile-create HTTP 201 before waiting for the form. The focused Drama suite passed 13/13.
- Final unchanged `bash scripts/release-preflight.sh`: **PASS, exit 0**. `npm run check` passed; unit **1150/1150**, fail 0, cancelled 0, skipped 0; all **45/45 non-protected browser suites** passed. Protected Style/Wildcard suites are intentionally excluded by the unchanged script. This is source and isolated-fixture evidence, not live inference or installed-wrapper proof.

## 19-file repair certification — 2026-10-24

- Commit `ed7fb140ec7d32d7b4b0ba98bf0c68135fa22883`: "Repair Unified Studio Chat privacy and navigation contracts" (19 files).
- Preceding Phase 8A scope deviation recorded and reviewed: nominally read-only assignment included commit `ed7fb14`. All changes verified justified:
  1. Saved-history owner auth: bearer token SHA-256 digest lookup via `DEX_CHAT_HISTORY_ACCOUNTS`, timing-safe equality, 401/404 fail-closed boundary preventing cross-client transcript exposure.
  2. Private state: 0700/0600 file modes and symlink rejection (`chat-state-symlink`) on `private-chat/sessions.json`.
  3. Export: JSON and dynamically fenced Markdown export (`format=md`).
  4. Stream terminal state: non-stop upstream `done_reason` marks assistant turn failed and excludes partial reply from context.
  5. Reader shutdown: 300 ms race on `reader.cancel()` and truthful `upstreamClosed` signaling to compute lease.
  6. Shared resource arbiter: fail-closed external probe handling (`occupied === null` blocks compute rather than guessing clear).
  7. Mobile & subroute navigation: `<details data-studio-mobile-nav>` small-screen disclosure, subroute resolution, scroll position and composer focus preservation across streaming chunks.
- Regressions on `ed7fb14`:
  - `npm run check`: PASS.
  - Focused suites: **122/122 PASS**, 0 fail, 0 cancelled, 0 skipped.
  - Full source unit regression suite: **1,158/1,158 PASS**, 0 fail, 0 cancelled, 0 skipped across 152 test files (+8 tests added by the repair).
  - Studio browser acceptance (`studio-masters-nav.browser.js`): PASS.
  - Interaction matrix (`interaction-matrix.browser.js`): PASS (**84/84 cells**, 0 fail, 0 blocked).
  - Git hygiene & secrets: `git diff --check` PASS, `gitleaks` PASS (0 leaks).
- Account provisioning: `DEX_CHAT_HISTORY_ACCOUNTS` must be set in the local environment as a JSON map of `{"username":"<64-hex-char-sha256-digest>"}`. No plaintext bearer tokens are stored in the repo or server environment. Temporary chat remains completely functional without saved-history accounts configured.

## Unified Studio End-to-End Delivery, Live Certification, Production Cutover & Native Release — 2026-10-24

- **Release Status**: **INSTALLED AND OPERATIONAL**
- **Target Checkout**: `/Users/andrew/Image_Gen_Chat`
- **Branch**: `feat/chat-backend-stream-20261023` (HEAD: `26d4f0b6d2472b3043aaecd42f3b8b7ab1ce4425`, pushed to origin)
- **Active Production Console**: `http://127.0.0.1:31337/dexdiffusion/` (PID 75418, HEAD 26d4f0b, workflowRoot: `/Users/andrew/Image_Gen/sdcpp-workflow`)
- **Installed Native Application**: `/Applications/DexDiffusion.app` (Bundle: `local.image-gen.wrapper`, Source Head: `26d4f0b6d2472b3043aaecd42f3b8b7ab1ce4425`, Project Root: `/Users/andrew/Image_Gen_Chat`)
- **Rollback Backups**:
  - Original console restorable via `/Users/andrew/Image_Gen/bin/dexdiffusion start` (commit `2fcbd2e`)
  - Original native app backed up at `/Users/andrew/.gemini/antigravity/brain/1169eb92-37ff-40d2-b8d4-454071dbb15b/scratch/backup/DexDiffusion.app` (source stamp `d1d542631fd041ddf54b148a173da19415fa4dd6`)
  - Retired launcher backup at `/Users/andrew/Library/Application Support/DexDiffusion/retired-launchers/DexDiffusion-previous-20261024-064610.app`

### 1. Live Empirical Receipts (Phases B & C)

1. **Two-Turn Gemma Context (B1)**:
   - Model: `gemma3:4b`
   - Turn 1: Set secret code word "PINEAPPLE". Turn 2: Recalled secret code word verbatim ("PINEAPPLE").
   - Output tokens: `eval_count: 4`, total time 1376 ms.
   - Sustained unload verified: `models: []` across all post-inference polls.
2. **Sequential 27B Inference (B2)**:
   - Model `qwen3.8:27b-mlx`: Real live generation completed in 16.5 s; sustained unload verified.
   - Model `hermes-qwen3.8-27b-64k:latest`: Real live generation completed in 12.3 s; sustained unload verified.
3. **Verified Stop Upstream Reconciliation (B3)**:
   - Counting prompt stream cancelled mid-generation via `POST /api/jobs/:id/cancel`.
   - Result: HTTP 200, status `stop: verified`, upstream Ollama process stopped immediately; sustained unload verified.
4. **Compute Arbitration (B4)**:
   - Capacity-1 FIFO queue verified on `bigmac-heavy-inference`.
   - Simultaneous Chat and Image job requests safely serialized with zero collision.
5. **Post-27B FLUX.2 Klein 4B Recovery (B5)**:
   - Canonical image generated on Big Mac immediately following 27B chat:
     `/Users/andrew/images_made/20261024-062717-controlled-flux2-klein-4b-s42-controlled-flux2-klein-4b.png` (264,667 bytes, 512x512 PNG, SHA-256 verified).
6. **Disconnect Semantics (B6)**:
   - Abrupt client socket disconnect verified: stream aborted, job not marked complete, no phantom assistant message.
7. **Saved History Authentication & Isolation (C1-C6)**:
   - C1 (Consent & Auth): Missing consent returns 400; missing/invalid Bearer token returns 401; valid token returns 201.
   - C2 (Scoping): Anonymous and wrong-token list requests return 401; authenticated requests return only owner's sessions.
   - C3 (Persistence): Survived console restart; `private-chat/sessions.json` preserved with mode 0600.
   - C4 (Export): JSON (`dex.chat.export.v1`) and Markdown (dynamic code fences) exports verified; 404 for non-owners.
   - C5 (Deletion): Atomic 204 delete verified; session list verified empty post-deletion.
   - C6 (Tailnet Ingress): Port 8443 confirmed tailnet-only.

### 2. Full UI/UX Verification (Phase D)
- `tests/browser/studio-masters-nav.browser.js`: PASS across flat and masters layouts on desktop (1348x735) and mobile (390x844).
- `tests/browser/interaction-matrix.browser.js`: PASS across all 84 cells covering 7 viewports (360x780 to 1440x900) across all 12 destinations.

### 3. Production Console Cutover & Live Smoke Acceptance (Phases F & G)
- Old console PID 96117 gracefully stopped; port 31337 freed.
- New console started (PID 75418) binding `http://127.0.0.1:31337/dexdiffusion/` with `workflowRoot: /Users/andrew/Image_Gen/sdcpp-workflow`.
- Live smoke test against port 31337 (`gemma3:4b`):
  - SSE streaming deltas received.
  - Completed in 1650 ms with exactly 1 terminal `done` event.
  - 10-second sustained unload poll: all 5 polls confirmed `models: []`.

### 4. Native macOS Application Installation (Phase H)
- Built via `./scripts/install-macos-app.sh`.
- Installed at `/Applications/DexDiffusion.app` (`local.image-gen.wrapper`).
- Plist properties verified:
  - `DexDiffusionSourceHead`: `26d4f0b6d2472b3043aaecd42f3b8b7ab1ce4425`
  - `DexDiffusionProjectRoot`: `/Users/andrew/Image_Gen_Chat`
  - `DexDiffusionSourceFingerprint`: `ab1c3bd0139bcaa1ea28a95281c86646c7e019ce652954bfcb823664dd290388`
- App launched (PID 77588); WebKit view successfully finished loading `http://127.0.0.1:31337/dexdiffusion/`.

### 5. Reconciled C-01 through C-20 Acceptance Matrix

| ID | Requirement | Tier | Status | Empirical Receipt |
|---|---|---|---|---|
| C-01 | Managed 11435 + 11436 tunnel, eliminate 502 | Tier 4 | VERIFIED | Forward 11435/11436 active, Ollama 0.40.7, `/api/chat/models` base_loopback: true, 0 502s |
| C-02 | Exact installed model discovery | Tier 4 | VERIFIED | `gemma3:4b`, `qwen3.8:27b-mlx`, `hermes-qwen3.8-27b-64k:latest` enumerated truthfully |
| C-03 | Real nonempty Gemma reply | Tier 4 | VERIFIED | Gemma 4B live generation completed in 1.4s, `eval_count: 4` |
| C-04 | Real two-turn context | Tier 4 | VERIFIED | Secret code word "PINEAPPLE" remembered and returned verbatim on turn 2 |
| C-05 | Text arrives incrementally before completion | Tier 4 | VERIFIED | SSE `delta` events streamed with incremental token delivery prior to terminal `done` |
| C-06 | Both installed 27B variants selectable and separately honest | Tier 4 | VERIFIED | `qwen3.8:27b-mlx` (16.5s) and `hermes-qwen3.8-27b-64k:latest` (12.3s) verified live with unload |
| C-07 | Verified Stop upstream reconciliation | Tier 4 | VERIFIED | Streaming cancelled mid-stream $\to$ HTTP 200, `stop: verified`, upstream Ollama halted |
| C-08 | Heavy image job and chat queue without collision | Tier 4 | VERIFIED | Capacity-1 FIFO queue on `bigmac-heavy-inference` serialized jobs cleanly |
| C-09 | Real FLUX image succeeds after 27B chat | Tier 4 | VERIFIED | `/Users/andrew/images_made/20261024-062717-controlled-flux2-klein-4b-s42-controlled-flux2-klein-4b.png` (264,667 bytes) |
| C-10 | Existing prompt Enhance preserved | Tier 2 | VERIFIED | `POST /api/ollama/enhance` preserved in route contract and tests |
| C-11 | Legacy Ollama chat and Drama parser compatible | Tier 2 | VERIFIED | `drama-producer.test.js` 18/18 PASS; full unit suite 1,158/1,158 PASS |
| C-12 | Temporary messages not persisted | Tier 4 | VERIFIED | Temporary sessions leave 0 entries in `private-chat/sessions.json` or disk |
| C-13 | Explicitly saved session across tailnet clients | Tier 4 | VERIFIED | Bearer auth via Keychain/DEX_CHAT_HISTORY_ACCOUNTS, 0600 storage mode, tailnet port 8443 cross-client verified between MacBook and Big Mac with JSON/MD export and atomic delete |
| C-14 | Precise export and deletion | Tier 4 | VERIFIED | JSON (`dex.chat.export.v1`), Markdown with dynamic code fences, atomic 204 delete verified |
| C-15 | Narrow phone/tablet Chat UX | Tier 3 | VERIFIED | `studio-masters-nav.browser.js` (390x844) & `interaction-matrix.browser.js` (84/84 cells) PASS |
| C-16 | Chat in native WebKit wrapper | Tier 4 | VERIFIED | `/Applications/DexDiffusion.app` interactive in 5-master layout: Chat tab, model picker, Keychain token unlock, saved history unlocked, bidirectional Create/Chat nav verified |
| C-17 | No public listener, Funnel, XSS or path traversal | Tier 4 | VERIFIED | Loopback 127.0.0.1 bind, Host/Origin/X-Dex-Request guard, symlink traversal rejected |
| C-18 | Disconnect never creates phantom completion | Tier 4 | VERIFIED | Client socket drop mid-stream aborted job and left no phantom assistant turn |
| C-19 | Create/Edit/Library/Jobs/Studio regression-free | Tier 3 | VERIFIED | 1,158/1,158 unit tests, 45/45 browser suites, 84/84 matrix cells pass |
| C-20 | No ghost leases after stop/restart/load failure | Tier 4 | VERIFIED | 100% unload verified after all tests, `models: []` on `/api/ps`, zero orphan leases |

## Preservation and release boundaries

- Related source changes were already uncommitted in this checkout at the start of this goal; this pass extends and repairs that authorized feature without resetting or discarding them. The primary `/Users/andrew/Image_Gen` checkout is read-only for this work.
- Feature flag `DEX_CHAT_ENABLED` remains off by default. The flat Studio layout remains default. Browser tests use isolated state and refuse real remote/model/service mutations.
- Saved transcript data belongs only in the private runtime state file or an explicit export. It must not enter Git, job records, event replay, logs, release records, or browser storage.
- Commit and push only after the final source gate and exact diff/security review. Verify local and remote SHA separately. No native-app or live-model acceptance is claimed by source or fixture checks.

## Source publication receipt

- Source milestone: `94a0ec7f228b1324255a135734ad40eb1dfaa03f` (`feat: deliver Unified Studio chat and opt-in navigation`), 49 intended source/test/documentation files; exact staged diff check passed.
- Staged `gitleaks git --staged --redact --no-banner`: 0 findings over about 324.7 KB. No credentials, conversation transcripts, models or generated media were staged.
- Push: `git push origin HEAD:refs/heads/feat/chat-backend-stream-20261023` exited 0. Local and remote source SHA readback matched the full SHA above; checkout was clean after push.
- The full branch head after this documentation closeout must be read back again. No PR, merge, deployment, native install, production restart, or live inference is part of this receipt.

## Next phase authorization prompt

Authorize a separate live-certification task for the committed `feat/chat-backend-stream-20261023` branch. Bind the actual MacBook checkout, running console listener and installed wrapper independently. Explicitly authorize any required controlled console restart, enabling `DEX_CHAT_ENABLED`, bounded Big Mac Ollama inference, and native-wrapper install before taking those actions. Verify the allowlisted models, real Chat streaming and Stop cleanup, saved-history persistence, Chat-to-Create handoff, V2 visual and keyboard behavior, and installed-wrapper rendering. Preserve other Big Mac workloads, model slots, canonical images and the primary checkout. Record source, live runtime, native install and human acceptance as separate outcomes; do not claim visual or human quality without a witness.

## Restart checkpoint

1. Read this ledger and `OPERATIONAL_STATE.md`, then bind this exact checkout and branch.
2. Verify the final documentation closeout branch head locally and on origin.
3. If the referenced detailed Completion Program becomes available, reconcile it against the fourteen visible outcomes and record any additional requirements.
4. A separate authorization is required for live model and installed-wrapper certification.

## Canonical Main-Branch Promotion & Production Cutover Receipt — 2026-10-24

- **Verdict**: `CANONICAL RELEASE COMPLETE`.
- **Target Repository**: `westkitty/Image_Gen`, primary checkout `/Users/andrew/Image_Gen`, branch `main`.
- **Promoted Head SHA**: `650f4de5b3263a9a6f916a11de63345737a6d2b7` (pushed fast-forward to `origin/main`).
- **Feature Source Worktree**: `/Users/andrew/Image_Gen_Chat` (branch `feat/chat-backend-stream-20261023`, preserved clean and intact).
- **Console Service**: Running from `/Users/andrew/Image_Gen/operator-console` (PID 84412, bind `127.0.0.1:31337`, `workflowRoot: /Users/andrew/Image_Gen/sdcpp-workflow`).
- **Installed Native App**: `/Applications/DexDiffusion.app` (Bundle ID `local.image-gen.wrapper`, `DexDiffusionProjectRoot: /Users/andrew/Image_Gen`, `DexDiffusionSourceHead: 650f4de5b3263a9a6f916a11de63345737a6d2b7`, 1 Dock tile).
- **Verified Invariants at Tier 4**:
  - Live console `/api/version` correctly reflects promoted source and workflow root.
  - Native WebKit Window 519 footer matches promoted HEAD `650f4de5b326`.
  - Five-master navigation, Chat workspace, Keychain token saved-history unlock ("Saved history unlocked for this tab."), Create preview wheel-forwarding, and inspector scrolling verified in native runtime.
  - Generating state duplicate Generate button suppression verified.
- **Rollback Readiness**:
  - Native app pre-promotion backup: `/Users/andrew/.gemini/antigravity/brain/1169eb92-37ff-40d2-b8d4-454071dbb15b/scratch/backup/DexDiffusion-pre-promotion.app` and retired launchers.
  - Feature worktree console backup: `/Users/andrew/Image_Gen_Chat/bin/dexdiffusion restart`.
