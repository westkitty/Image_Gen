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
