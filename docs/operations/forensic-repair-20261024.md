# Forensic repair sweep — 2026-10-24

Starting source: `ccadcb43da5f035a5c0807880a571c340fa5a56f`, freshly fetched
`origin/main`, on MacBook-Air as `andrew`. Repairs are isolated on
`codex/forensic-repair-20261024`; original untracked files and stash are preserved.

At fingerprint time the production listener was PID 16587, bound to
127.0.0.1:31337, serving `/Users/andrew/Image_Gen/operator-console` at `ccadcb4`.
The installed native wrapper's full source stamp also matched starting HEAD.
Big Mac answered as `bigmac@bigmac`. There were no active jobs or heavy leases.
Doctor failed the SDCPP worker check: the bridge was reachable but its SD1.5
model probe was false. A legacy SSH file-existence check passed independently;
these are different access paths, not proof that the bridge can load the model.

## Coverage matrix

Inspection is sampled unless explicitly stated. Tests below use controlled
fixtures unless a real process or HTTP check is explicitly identified.

| Subsystem | Inspection / execution | Classification and limits |
|---|---|---|
| Core API, jobs, capabilities | Request normalization, queue dispatch, worker probes, operational projection and cancellation completion; existing unit coverage | Inspected/tested; malformed adapter validation and worker status defects confirmed |
| Generation, LoRA, edits, publication | Controlled arguments, runtime policy, routing/client and image validation modules; sampled image store, media bridge, queue/XYZ and transport | Inspected/tested; queued SDCPP adapter serialization defect confirmed; no new live inference proof |
| Chat / Ollama | Streaming, context/session/history/auth, compute admission and legacy adapters | Independent inspection and existing fixture tests; false completion on malformed upstream tail confirmed |
| Unified Studio | Active component, workstation state, navigation, runtime/focus and helpers; desktop/390 px fixtures | Inspected/tested; negative enhancement ownership race confirmed; legacy routes retained |
| Audio / Drama | Producer/editor, media UI, voice profiles/conversion, reference staging | Inspected/tested; cross-project edits/responses and failed conversion scratch retention confirmed; no listening acceptance |
| World / video / swap | World state/invalidation, stage receipts and active viewer sampled | Inspected and existing tests; missing video/swap engines remain unavailable by design; no fresh 3D generation |
| Security / lifecycle | Run attachment filesystem boundary, private temporary ownership, request/history isolation and cancellation contracts sampled | Inspected/tested; symlink escape confirmed; no destructive/private-data probes |
| Performance / resources | Streaming/render ownership, timers, duplicate state and lease paths sampled | Inspection only; no quantified performance claim or soak certification |

## Confirmed defect ledger

| ID | Severity | Evidence / root cause | Correction and regression protection |
|---|---|---|---|
| BUG-01 | HIGH | Queue callback sent structured SDCPP LoRAs without backend prompt tags; captured dispatched prompt lacked the adapter | Queue resolves resources like direct Create; `queued-lora-contract.test.js` checks SDCPP and MFLUX dispatch and duplicate precedence was independently reviewed |
| BUG-02 | MEDIUM | Shared validator threw on `[null]` and accepted malformed structured adapter containers/weights | Validate shape before runtime policy for every shared call site and before queue resource resolution; malformed cases fail without dispatch |
| BUG-03 | MEDIUM | Cancel request A/start B; late A catch/finally cleared B's busy state/snapshot, or late success overwrote its result | Controller ownership guards response/error/finally; cancel and model switch invalidate ownership; six negative enhancement regressions |
| BUG-04 | HIGH | Pending `ln-001` edit for A was PATCHed to project B; delayed run/line/bind/take responses also overwrote B | Project/epoch-bound edit queue, failed-flush gating, request ownership and retired run polling; twelve Drama ownership regressions, including second-sweep findings |
| BUG-05 | HIGH | Run-file route checked only lexical containment; synthetic symlink outside runs was offered to sendFile | Validate query type and resolved containment; root-relative serving retains valid files in hidden worktrees; traversal/file/directory symlink tests and real isolated HTTP 403/200 checks |
| BUG-06 | MEDIUM | Failed/partial/thrown reference conversion returned no path and abandoned private PCM scratch | `finally` reclaims only its exact owned directory unless ownership transfers to caller; five cleanup scenarios plus real local FFmpeg failure with no new scratch |
| BUG-07 | MEDIUM | Live SDCPP worker said READY/enabled with `model_available:false` | Model availability controls enabled and explanatory state; bridge readiness is separate and never promotes proof |
| BUG-08 | MEDIUM | Plain npm test launched competing real FFmpeg fixture files and timed out three producer waits; all passed in the focused run and the preflight already serializes files for this reason | Align npm test with preflight test-file serialization; retain every test and its existing deadlines/assertions |
| BUG-09 | MEDIUM | A Chat done marker preceded malformed NDJSON in one chunk; the runner returned done and persisted complete before checking the parser error | Reject complete/unterminated malformed tails before terminal success, retain preceding deltas, and test whitespace success; Chat stream/compute/session/history group 61/61 passed |

All nine have failing-before evidence; application repairs have focused regression checks.
Second independent sweep reviewed resulting code and neighboring call sites;
its confirmed Drama action/response/poll ownership findings were included in
BUG-04's bounded corrective pass. No claim of exhaustive absence of defects.

## Validation and release state

- Initial `npm run check`: exit 0.
- Initial plain `npm test`: exit 1; 1,176/1,179 passed, three Drama producer waits timed out.
- Isolated `node --test tests/drama-producer.test.js`: exit 0, 18/18 passed, including all three failed baseline cases. No timeout increased or assertion removed.
- Focused new ownership tests: 18/18 passed; generation/boundary/worker tests: 6/6 passed; media/cleanup neighbors: 20/20 passed; existing generation/publication group: 32/32 passed.
- Studio first-screen interactions passed at 1348x735 and 390x844; master navigation passed in flat/masters layouts at both sizes.
- Actual isolated Node HTTP: outside synthetic symlink 403; owned text file 200 with correct bytes. Actual local FFmpeg invalid-input conversion: null result, no new `dexref-*` directory.
- Three later full release-preflight attempts all exited 1; see Closure pass.
- Actual isolated Chromium plus local backend: queue an A-only edit, confirm discard/open B, wait past debounce and flush; both synthetic project line readbacks remained unchanged and current project stayed B.
- Additional real loopback HTTP/SSE with fake Ollama emitted `started`, `delta`, then exactly one `error` with `parse_error`. Closure was unverified, so the isolated compute owner retained its lease (`stop_unverified`); no release or real-model proof is claimed. An initial diagnostic incorrectly waited for FAILED and timed out; the readback established the retained ownership state.
- Earlier serialized `npm test` (before the closure pass): exit 0, 1,211/1,211 (includes style/wildcard files that the release preflight excludes). Superseded by the closure results below.

Live patched model-backed Chat streaming is unverified; malformed protocol behavior is proven with controlled upstream fixtures.

No production restart, native rebuild/install, model download, public routing
change, heavyweight generation or human acceptance was performed. Changed SDCPP
queue inference remains live-unverified while its worker reports unavailable
model access. Existing images, user data and historical evidence are preserved.
No speedup or memory-stability claim is made. Unconfirmed leads (overlapping
profile/media polls, uncaught UI request failures and legacy viewer format edges)
remain risks, not established defects.

## Closure pass — 2026-10-25

Additional corrections: LoRA shape validation no longer re-judges prompt-tag weights after merging (`loraShapeChecked`); Drama ownership guards extended to re-parse, direction/phrase, tracks, QA, trim/split/remove, scene preview, cues and history; run-file allowlist now also judges the resolved target; `.gitignore` matches the `operator-console/node_modules` symlink; test fixes for golden-reel (fake audio collision), studio-scroll-preservation (wait for startup Ollama status) and ollama-legacy-contract (tolerates a leading `queued`).

Release gate: unmodified `scripts/release-preflight.sh`, final attempt exit 1. Unit suite 1217/1217 passed; every browser suite passed except `drama-studio` (one scenario). That suite is intermittently flaky on untouched `ccadcb4` as well (main: 1 failing run in 15, both Direct and Voice Designer; repaired tree: 0 in 15 in the same loop). Cause diagnosed and repaired in the later closure section; see below. The gate did not pass; publication was directed by the owner. Not done: live inference, native rebuild, service restart.

## Closure of the drama-studio flake — 2026-10-25

See the 2026-10-25 entry in `OPERATIONAL_STATE.md` for root causes, fixes and evidence. In short: the intermittent failures were real races between background re-renders and uncontrolled UI state or stale responses (Direct timeline, Voice Designer name, Cast Bible pronunciation panel, leaked test contexts), plus unrelated Library focus/layout and Reference-Edit number-input races exposed by the full gate. All are repaired and stable in strict repeated runs (drama-studio 20/20, library 20/20, ref-edit 25/25). The final full release preflight did not exit 0 (attempt 2: only `browser:ref-edit`, since repaired), so the corrective commit is preserved on `fix/drama-studio-stability-20261025` and has not been published to `main`.
