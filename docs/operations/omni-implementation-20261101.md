# DexDiffusion OMNI uplift — implementation ledger

**Date:** 2026-11-01
**Project:** westkitty/Image_Gen
**Source baseline:** a1cefd1cc4c571797870104648f93e8c9a7ad2ef
**Worktree:** /Users/bigmac/Image_Gen-omni-20261101 (started detached; now isolated feature branch)
**Authority:** User adopted all eight product directions, authorized BUG-001 through BUG-010 repairs, HI-02 through HI-10, all performance proposals, explicit Temporary/Saved Chat, all UX uplift. Full GLB scene support (HI-01) was already approved. **No commit, push, merge, native replacement, service restart, model download or deployment was authorized by this working stage.**

This is **an implementation ledger, not a finished-product certificate**. A source edit, isolated unit pass and real native acceptance are three different evidence states. Preserve the native launcher, all saved work, single canonical MacBook image authority, private networking, model/LoRA selection, shared heavy-compute lease ownership, and truthful ability states.

## Defects

| Audit | Current worktree state | Proof needed / qualification |
|---|---|---|
| BUG-001 | Three.js glTFLoader local bundle replaces first-primitive-only renderer; full authored GLB scene, node transforms, materials and animations | Multi-node/translated/material fixture passed in headless Brave; authored real GLB corpus and WKWebView acceptance remain |
| BUG-002 | Focusable canvas with arrow-key orbit, zoom, reset and fullscreen | Keyboard orbit browser fixture passed; native keyboard acceptance remains |
| BUG-003 | pointercancel, lostpointercapture and blur clear drag state | Cancelled-gesture browser fixture passed |
| BUG-004 | Release meshes/materials/textures/ImageBitmaps/RAF on pagehide; on-demand static render | Implemented; repeated memory and GPU long-session measurement remains |
| BUG-005 | Canonical source image browser with search, 100-item page requests, later-page loading, exact IDs | Browser selected fixture image #510; full 10k-item performance still unmeasured |
| BUG-006 | Responsive 3D panels and buttons; no fixed minimum 454px grid | Headless 390px overflow check passed; 375px / actual phone remains |
| BUG-007 | Worker status errors do not suppress saved World listing | Outage fixture passed; further timing decoupling is an optimization follow-up |
| BUG-008 | 3D job disconnect no longer silently vanishes; explicit reconnect, exponential failure backoff | Browser reconnect to same job after failure passed; adaptive success-state polling is a further optimization |
| BUG-009 | Image import 201 receipt distinguishes recorded vs degraded metadata; client warns on partial success | Needs durable retry/remediation for failed provenance sidecar |
| BUG-010 | DEXDIFFUSION.md distinguishes Big Mac-owned Node API, private SSH forward and old MacBook architecture | Actual process/installed app cross-host fingerprint pending |

## High-impact improvements

| Audit | State |
|---|---|
| HI-01 | Source implementation and fixture proof; native acceptance pending |
| HI-02 | Source Observatory implemented; older image selection verified |
| HI-03 | World saved-data/worker errors separated; timing independence still pending |
| HI-04 | 3D reconnection verified in browser; World reconnect added, browser proof pending |
| HI-05 | Truthful partial-success import receipt implemented; repairable metadata retry pending |
| HI-06 | Corrected topology documentation and read-only release fingerprint script; actual MacBook acceptance pending |
| HI-07 | Read-only release preflight script; **not satisfied** until installed Dock click, bundled source identity and native WebKit visual/functional proof |
| HI-08 | Spatial-quality gate is being developed; **no navigable World proven** |
| HI-09 | Canonical artifact/source ZIP export with allowed lineage fields and SHA-256; package fixture tests passed |
| HI-10 | Isolated Python 3.11 + pinned test-dependency inventory; broader test gate needs NumPy and complete clean run |

## Performance proposals

| Audit | State |
|---|---|
| PERF-01 | Static GLB render only on input/resize; animations schedule frames only when playing |
| PERF-02 | Pagehide GPU cleanup and image resource disposal coded; profiling unverified |
| PERF-03 | Hidden document defers GLB fetch/parse; 96 MiB binary requires deliberate confirmation |
| PERF-04 | Browser source uses bounded server query + pagination; full endpoint back-end scan cost still needs measurement/optimization |
| PERF-05 | Worker failures decoupled from list results; independently timed UI update pending |
| PERF-06 | 3D error backoff and reconnect; World success-state adaptive 4–7 sec; 3D successful polling still needs adaptive cadence |
| PERF-07 | Whole-Studio render avoidance not yet independently profiled |
| PERF-08 | Viewer pixel ratio bounded on small screens and large vertex counts; geometry and texture fidelity preserved; target device profiling needed |
| PERF-09 | Worker-based GLB parsing **not implemented without evidence of a measurable main-thread bottleneck**; conditional proposal |
| PERF-10 | Worker lease wait, generation, transfer and output-validation span fields added for future Hunyuan3D jobs; no new live inference measurements |

**Matched single-sample startup/typing evidence:** Baseline clean detached worktree, Node v26.13, headless Brave, 1280×900: startup 740 ms; OMNI worktree startup 636 ms. Typing p50 199.9 ms both. **One run each is not statistical evidence of improvement**; the Library benchmark's baseline fixture lacks the expected grid and is blocked pending harness repair. No claim of GPU or model inference speedup.

## UX and interaction

| Audit | State |
|---|---|
| UX-01 | Source Observatory browser/pagination and exact selection implemented |
| UX-02 | Canonical source + model-readiness preflight visible in 3D and World |
| UX-03 | 3D evidence timeline, stage information, copy-safe job receipt; World reconnect/status controls |
| UX-04 | GLB scene hierarchy, bounds/material selection, Shaded/Wireframe/Normals modes, animation clip selection |
| UX-05 | Mouse, keyboard and touch camera parity; prefers-reduced-motion initial animation pause; real device acceptance needed |
| UX-06 | Single-column responsive 3D options and source; 390px browser check passed |
| UX-07 | World distinguishes rotational panorama from unverified spatial geometry; no false 6DoF |
| UX-08 | Five masters are the default; explicit legacy flat fallback retained; migration regression tests need reconciliation |
| UX-09 | 3D/World source → job → result ribbons, with truthful unavailable identifiers |
| UX-10 | 3D/World Capability Passports present; broader contextual feature coverage remains open |

**Temporary/Saved Chat** is now visibly selectable using the existing credential-gated opt-in persistence implementation; do not add a second chat store.

## Evidence and open gates

- Headless browser: dedicated 3D multi-node, keyboard, cancelled touch, Source Observatory historical image, saved Worlds when workers fail, reconnect and narrow 390px tests reported PASS.
- Unit: asset-package tests 2/2; targeted Image/3D/Chat/canonical tests 101/101 passed with an isolated Python test interpreter.
- A second focused unit group completed with 118 pass, 7 fail, 1 skip: five old 14-chip-default assertions and two NumPy-missing World compiler tests. **Not a green suite**. New default is five masters; preserve flat test coverage by explicitly requesting that rollback state, not by undoing the approved default.
- A separate full test process is running against this worktree; do not confuse its intermediate output with final status.
- Isolated test environment was created under the Big Mac user cache. The reproducible runner script is scripts/omni-test-environment.sh and the pinned dependency manifest is scripts/omni-test-requirements.txt; no global Python was modified.
- Real MacBook Dock launch, WebKit GLB rendering, continuous GPU cleanup after many opens, complete release regression, authority of server/dock source stamp, model execution, and 6DoF correctness remain unverified.
- A second contributor/tool process has modified new World spatial-gate files within the isolated worktree; reconcile its completed diffs and tests before finalizing. Never overwrite work outside this task.

**Release verdict: BLOCKED / implementation in progress.** A source-only fixture pass must not be called a deployed release.


## 2026-11-01 verification amendment

**Identity and authority:** detached worktree /Users/bigmac/Image_Gen-omni-20261101,
origin westkitty/Image_Gen, HEAD a1cefd1cc4c571797870104648f93e8c9a7ad2ef.
SOURCE ONLY; no stage, commit, push, merge, deployment, native-app replacement,
service restart, model downloads or actual new inference in this pass.

**Scope:** BUG-001..010, HI-01..10, PERF-01..10, explicit Temporary/Saved Chat
and UX-01..10, with five-master default. The tables above describe code
changes but must not be read as complete runtime certification.

**Corrected later in this pass:** BUG-007 / HI-03 / PERF-05 now truly settle
saved-World records before a deliberately delayed (3.5 seconds) worker probe.
BUG-005 source browser pagination now uses the server offset cursor even when
items are hidden or deduplicated. BUG-009 / HI-05 added verified byte/run-index
provenance repair, truthful partial-success import receipts, and tamper refusal.
BUG-001..004 GLB inspection now includes self-contained glTF 2.0 multi-node
rendering, local Meshopt and Draco decoder bundles, material/normal/wireframe
controls, animation selection, keyboard/pointer support, reduced motion and
resource cleanup. A positive Draco-compressed GLB test and native WKWebView
acceptance are still UNVERIFIED.

**Other important gates:** HI-07 native Dock acceptance BLOCKED while the
MacBook execution scheduler was saturated. HI-08 implements a falsifiable
World spatial-readiness gate; it does NOT create valid navigable 6DoF Worlds.
HI-10 provides a reproducible Python 3.12.13 test interpreter with
Pillow 11.3.0 and NumPy 2.3.4, but no clean *new full* release test suite.
PERF-09 off-thread GLB parsing is deferred until a real interaction-thread
bottleneck is measured. Full 10k-item Library, long-session GPU and network
performance benchmarks remain to be run. No performance speedup is claimed.

**Tests and reproducibility (Big Mac isolated test fixtures):**
- First completed broad npm test: 1289 total, 1279 passed, 10 failed,
  including missing NumPy/old shell assumptions and unrelated Drama timeouts.
  Do not call that release gate green.
- After repairs: focused core unit tests 9/9 PASS with actual exit 0;
  105/105 consolidated unit tests appeared as PASSED in the output log,
  but the enclosing remote call timed out before a clean exit receipt.
- Browser individual runs with actual exit 0: omni-outage-sources,
  omni-viewer-inspector, 3d-source-import and omni-import-recovery.
  Studio masters browser (390px and desktop) logged PASS; old 3D/World
  parity log recorded each listed scenario PASS but outer runner exit
  was not captured.
- Isolated targeted retests: LoRA unification 13/13 pass; test isolation
  12/12 pass; prompt intelligence 9/9 pass; missing-NumPy World cases
  pass with the pinned complete interpreter.
- Three Drama producer timeout tests persist outside the OMNI diff;
  one identical 20s timeout was independently reproduced on the untouched
  Big Mac baseline checkout. Do not treat this as an introduced OMNI bug.
- npm run check, changed JS and ESM syntax, shell syntax, git diff --check
  passed. No real inference, compression corpus or native WKWebView proof.

**Matched performance smoke probe** (n=3 per source, same Big Mac/Brave,
Library portion intentionally skipped):
baseline startup median 609ms, typing p50 185.2ms, p95 210.8ms;
OMNI startup median 628ms, typing p50 199.9ms, p95 208.5ms.
Insufficient samples and mixed deltas: NO MEASURED IMPROVEMENT.

**Remaining release gates:** clean complete release suite including pre-existing
Drama repair or explicit baseline exception, physical MacBook Dock launch and
source-stamp verification, actual GLB/Draco/WebKit and native ZIP download,
repeated GPU-cleanup measurement, 10k Library benchmark, and independent
multi-view spatial/occlusion/collision evidence for true 6DoF.

**Release verdict: BLOCKED, NOT DEPLOYED.** Previously verified production
releases do not certify this uncommitted worktree.

## 2026-11-01 continuation: closing evidence, not deployment

- **BUG-009 / HI-05 recovered:** Added `import-provenance-repair.js` and `POST /api/library/images/:id/repair-provenance`. Metadata-cache invalidation after failed disk writes is now explicit. The verified immutable import run index plus current SHA-256 and decoded dimensions is the only authority. A recovered record explicitly cannot restore the exact unsaved original filename. The UI offers recovery without re-importing image bytes. Unit 2/2 PASS; isolated API/browser fixture `OMNI_IMPORT_RECOVERY_PASS` includes refusal of path/name injection and tampered canonical files. The last remote wrapper timed out after a PASS log, so a separate clean exit receipt was not available.
- **PERF-04:** Canonical Library filtering now uses a low-cost SHA-trusted metadata snapshot and avoids computing every archive item’s image dimensions and full lineage. The full `imageView` is retained for page results, preserving the public payload shape. Real isolated 3D/World source import fixture passed after this change. Absolute speedups remain **unmeasured**; the 1,500+ item benchmark remains an open proof gate.
- **PERF-05:** Dedicated worker-delay browser fixture (2.5-second delayed probe) demonstrates saved Worlds are refreshed and rendered independently; request generations discard stale responses. The complete `loadWorldProjects()` request is not blocked by worker status.
- **HI-01 / UX-04:** An embedded PNG material texture is now included in the real browser GLB regression; `OMNI_VIEWER_INSPECTOR_PASS` with no outside resource request. The GLB validator and renderer coverage is not yet a native WebKit or real Hunyuan-generated-file corpus certification. Bundled Three.js, meshoptimizer and Draco license notices accompany local decoder assets.
- **Current focused tests:** `node --test --test-concurrency=1` on import-repair, portable package, World spatial gate, five-master navigation and source resolver reported **46 pass / 0 fail / 0 skip**. Studio legacy flat rollback **30/30**, local test-isolation **12/12**, Chat prompt/mobile **9/9**, LoRA **13/13** (test-owned state), World sharp-color/spatial gate **6/6**, and saved-World/source browser fixtures PASS. These are test-specific rather than release-level receipts.
- **Unresolved baseline fault:** A Drama producer chunk-resumption fixture times out after 20 seconds **on both the candidate and the unchanged baseline revision**. It is a pre-existing full-suite blocker, not a new OMNI regression; do not paper over it by increasing timeouts. An earlier full test pass was **1279 pass / 10 fail** (changing worktree, interpreter without NumPy); it is not a clean gate. Stop classification at factual evidence; other stale/isolated failures passed reruns, but one fresh complete test run after freezing source is still required.
- **Release STOP:** No complete 6DoF World reconstruction proven; no native MacBook Dock-click / WKWebView acceptance for the new GLB viewer; no current 1k/10k Library benchmark, long-session GPU leak test, or final native release receipt. No commit, push, merge, installation, service restart, GPU model generation, public port, or canonical-output change executed. Keep `westkitty/Image_Gen` protected; do not silently ship this candidate.


### Accessible retention and source-browser state: final isolated browser proof

- Browser omni-chat-modes.browser.js PASS (exit 0) in headless Brave at
  390px and 1080px: Temporary is selected by default; Saved requires an
  unlocked-history state; opting into Saved is explicit; New temporary chat
  resets consent; existing saved sessions cannot silently change mode;
  no viewport overflow was observed. The test simulates successful prior
  authorization and does not prove the credential exchange or actual Ollama
  inference.
- Browser omni-outage-sources.browser.js rerun PASS (exit 0) after verifying
  Source Observatory aria-expanded transitions from exact string false to
  exact string true. Chat aria-pressed likewise now emits true/false strings.
  The previous empty ARIA value was a real accessibility defect caught by
  browser regression, not a cosmetic issue.
- This is incremental source and browser evidence only. Native WKWebView,
  release suite and production install gates remain BLOCKED/UNVERIFIED.

## 2026-11-01 post-merge verification / fixture amendment

**Source merge receipt:** PR #20 merged to westkitty/Image_Gen main; merge SHA a702dfeace5051bc0effc42c1ce3f1d2fe741f5f. Original isolated 45-file commit 4397c3c84a33609f67b069ef358f8c262b748670 has the same tree as the GitHub transport commit. Big Mac active 127.0.0.1:31337 still returns a1cefd1 at /api/version (pid 97432, cwd production checkout), not the OMNI code. This is *not* a live deployment.

**Expanded source QA:** Real Khronos KHR_draco_mesh_compression GLB fixture built from Box.gltf + Box.bin (Cesium 2017, CC BY 4.0, full attribution adjacent to file), verified SHA-256 ec8fa491d8030fca097c1df0bf63d6741958b8db28fecfbda9ef6ba283a84d8e. Viewer positively decoded 24 vertices / 12 triangles using same-origin decoder WASM in headless WebKit 26.5 (and Chromium), no page errors/external origin. Complete viewer suites passed with independent exit 0 in both engines. Source test now permits an explicit WebKit engine and counts same-origin blob: object URLs as local rather than external traffic.

**Drama test gap:** Three genuine previous timeouts were not stuck generation: synthetic long-form default mastering takes over 20 seconds (measured ~6.75s per loudnorm pass plus MP3/M4B encoding). Their *recovery/tamper/privacy* assertions are now scoped to the existing archive/WAV-only path for the successful second pass. The production mastering implementation and loudness/codec-specific tests were not modified. Three targeted tests passed 3/3 with exit 0.

**Remaining hard gates:** Entire fresh release suite, MacBook physical Dock/WKWebView, in-use GPU lifecycle, Big Mac production checkout/tunnel and live listener upgrade, and real 6DoF evidence. MacBook DEX scheduler remained saturated, and no installed app, production listener or private data was modified. Source delivery status of the new regression changes must be verified separately.
