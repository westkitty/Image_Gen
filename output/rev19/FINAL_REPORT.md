# Rev19 reliability consolidation — 2026-10-04 (started 2026-10-03)

Final scoped closeout. Baseline: clean `rev17-verification-handoff` at `8f6d711f7d2e9ed0e76c08cffacafe73679efcac`. This report covers the new consolidation pass. Earlier rev18 acceptance evidence remains preserved.

## A. Verdict

**READY FOR REVIEW: YES.** Required automated gates and the bounded live publication proof pass. This consolidation pass is complete within its specified feasible scope; it is not blanket VERIFIED COMPLETE certification. Physically wedged Apple Neural Engine behavior remains unverified, and improvements07/10 remain partial migrations.

## B. New defects

Twelve product defects and one test/harness defect were reproduced. Reproduction/cause/repair/regression details are in [BUGS.md](../rev18/BUGS.md) and [interaction-defects.md](interaction-defects.md).

| ID | Type | Cause | Repair |
|---|---|---|---|
| D-028 | PRODUCT | Detector ignores cancellation. | Propagate abort, reap owned child, isolate partial mask, reject stale result. |
| D-029 | PRODUCT | Escape handled only in picker search. | Panel-wide Escape and option navigation/focus. |
| D-030 | PRODUCT | Inline outline:none hides keyboard focus. | Shared focus-visible rule overrides inline suppression. |
| D-031 | PRODUCT | Fullscreen image opener cannot receive focus. | Named keyboard opener; save/return actual opener focus. |
| D-032 | PRODUCT | PNG signature accepted without decoding. | Bounded full decode and format validation. |
| D-033 | PRODUCT | Publication metadata failure orphans exposed output. | Owned staging/journal, atomic index, collision safety, rollback; fail caller success. |
| D-034 | PRODUCT | Cleanup exception strands compute lease. | Persist cleanup failure; release lease unconditionally. |
| D-035 | PRODUCT | Age/prefix sweep deletes untracked directory. | Reconcile exact durable terminal ownership only. |
| D-037 | PRODUCT | Visually disabled model fields remain keyboard enabled. | Native disabled synchronization with owned reversal. |
| D-038 | PRODUCT | V2 mobile nav flex-shrink clips labels. | Nonshrinking intrinsic-width navigation buttons. |
| D-039 | PRODUCT | Studio sticky Run button overlaps settings. | Normal right-rail flow, preserved visual styling. |
| D-040 | TEST/HARNESS | Existing-workbench wait can reach prior-operation input handlers before queued DOM commit. | Await rendered source/operation; retain exact23 state/save/round-trip assertions. |
| D-041 | PRODUCT (integration regression) | Receipt collector omitted legacy final-output fields. | Collect all reported canonical fields and owned run outputs, then validate each. |

D-036 was not issued. Harness corrections (fixture routing, rendered-update waits, launch/readiness, retired-source assertion) are distinguished from product defects; initial failures remain.

## C. Remaining original blockers

- Detector/Apple Neural Engine: safe owned timeout/cancellation/reap/retry contract VERIFIED. Physically wedged Neural Engine remains UNVERIFIED; no system service intervention.
- Accessibility/interaction: CLOSED for executable specification version1: 180/180 cells PASS; 1,027 contract checks PASS and 268 non-applicable checks N/A; no required FAIL/BLOCKED. 75 dialog exercises and 6,859 keyboard controls reached.
- Six previously CLOSED rev18 acceptance cases retain their earlier scoped closure. No expensive repeat of those cases was performed.

## D. Reliability improvements

| Improvement | Status | Evidence / implemented scope |
|---|---|---|
| 01 Detector recovery | DONE | Owned real stalled-child timeout/reap, cancellation/no retry, partial-mask nonpublication, healthy retry and actual browser error lifecycle. |
| 02 Executable matrix | DONE | Version1: 180/180 cells PASS; 1,027 contract checks PASS, 268 N/A; no FAIL/BLOCKED. [Matrix](matrix-final-v2/interaction-matrix-summary.md). |
| 03 Storage reconciliation | DONE | Read-only decode/digest/reference/pending inventory; live Doctor/API reports 502 historical missing identities without repair. |
| 04 Atomic publication | DONE | 16 publication regressions, including real child death and metadata failure; one live Klein4B canonical transaction. |
| 05 Privacy persistence | DONE | OFF/ON synthetic-canary contract, browser storage/presets, durable metadata, saved projects and actual redaction functions. Remote media worker log function is simulated locally, not a fresh remote render. |
| 06 Historical-log policy | DONE | Four exact logs documented and live presence verified without reading contents; no destructive action. |
| 07 Shared job state | PARTIAL | Generic store plus image/media terminal boundaries enforce stage/terminal/percentage/receipt invariants. Legacy image list/progress views remain with their existing owner; historical terminal records are not retroactively certified. |
| 10 Cleanup ownership | PARTIAL | Durable media directories have exact ownership, receipts and terminal-only retry. Publication journals are inspected; MFLUX inline cleanup retains its existing in-band contract. Full temporary-resource migration is deferred. |

Read-only endpoints: `GET /api/storage/integrity`, `GET /api/cleanup/ownership`; Doctor shows both. Retry: `POST /api/cleanup/reconcile` accepts only `job_id` and `resource_id`, never an arbitrary caller path.

Storage inventory before generation (runs-only references): 1 valid, 502 missing, 1 orphan. Live API additionally reads image-meta references; after the one new generation: 3 valid, 502 missing, 0 orphan, no broken/digest-mismatch/duplicate/pending/unknown identities. Reference-scope differences explain the existing owned geometry fixture's classification; no historical reconstruction occurred.

Publication transaction: preserve source, copy to owned staging, fully decode/validate/digest, persist exact pending ownership, publish without overwrite, atomically commit index, then clean owned staging/source/journal. Failed precommit work rolls back only its own files. Postcommit failure keeps valid bytes and an explicit hidden pending journal. No automatic crash repair or power-loss guarantee is claimed. Outpaint transforms use an owned staged copy and restore the prior output on metadata failure. WAV finalization fully parses before publication and commits registry before exposing a record.

Live proof: job `13e2fdf3-521f-4e63-8aeb-fb1badfdcfb5`, Klein4B, 512×512, 4 steps, seed946273, one image, save-prompts OFF. Decoded canonical PNG and index share SHA256 `0dcb69a08c44cc0a730e968e70500e0810410a170c413b0ade402db2203dd5b3`; generic job is COMPLETE with validation receipt. Remote cleanup has an in-band marker plus fresh exact-path absence proof. Transfer digest is checked before PNG metadata stripping; canonical digest is recomputed afterward. Lease is idle. See [integration receipt](integration-receipt.json).

## E. Final gates

| Gate | Result | Exit |
|---|---|---|
| `npm run check` | PASS | 0 |
| `npm test` | 295/295; zero failures/skips | 0 |
| Focused reliability regressions | 37/37 | 0 |
| `npm run test:browser:edit` | 24/24 | 0 |
| `npm run test:browser:voice` | 8/8 | 0 |
| `npm run test:browser` | Edit24/24 + Voice8/8 | 0 |
| Version1 interaction matrix | 180/180 cells; 1,027 PASS checks, 268 N/A | 0 |
| Static verification | 31 JavaScript files; shell syntax; diff whitespace | 0 |
| Minimal live primary generation | 1 validated canonical PNG, durable COMPLETE, exact remote cleanup | PASS |

Exact commands, counts and exits: [final-gates.json](final-gates.json). Final suites use installed Brave and snapshots of actual current read-only capabilities/model GET responses. Their checks certify rendered UI behavior, not network bootstrap latency under host pressure. Earlier failing runs remain preserved.

Final runtime: normal owned console PID33767 on127.0.0.1:31337; idle compute lease, no waiting jobs, no owned cleanup resources/pending publication journals, durable live job COMPLETE. Matrix listener31999 is stopped. See [runtime receipt](final-runtime-closeout.json).

## F. Files changed

Maintained source/tests/configuration:

- `operator-console/bin/canonicalize-image.js`
- `operator-console/cleanup-owner.js`
- `operator-console/detailer.js`
- `operator-console/docs/historical-log-policy.md`
- `operator-console/image-store.js`
- `operator-console/image-validation.js`
- `operator-console/job-contract.js`
- `operator-console/media-bridge.js`
- `operator-console/media.js`
- `operator-console/package.json`
- `operator-console/public/dexdiffusion/a11y.js`
- `operator-console/public/dexdiffusion/component.js`
- `operator-console/public/dexdiffusion/edit-ui.js`
- `operator-console/public/dexdiffusion/index.html`
- `operator-console/public/dexdiffusion/lightbox.js`
- `operator-console/public/dexdiffusion/workstation-ui.js`
- `operator-console/server.js`
- `operator-console/tests/browser/edit-workbench.browser.js`
- `operator-console/tests/browser/helpers.js`
- `operator-console/tests/browser/interaction-matrix.browser.js`
- `operator-console/tests/browser/interaction-matrix.spec.json`
- `operator-console/tests/browser/voice-drama.browser.js`
- `operator-console/tests/canonical-images.test.js`
- `operator-console/tests/canonical-publication.test.js`
- `operator-console/tests/cleanup-owner.test.js`
- `operator-console/tests/detailer-ui-state.test.js`
- `operator-console/tests/detector-recovery.test.js`
- `operator-console/tests/job-contract.test.js`
- `operator-console/tests/media-bridge.test.js`
- `operator-console/tests/media-publication.test.js`
- `operator-console/tests/media.test.js`
- `operator-console/tests/mflux-bridge.test.js`
- `operator-console/tests/native-batch.test.js`
- `operator-console/tests/privacy-persistence.test.js`
- `operator-console/tests/server-publication-contract.test.js`
- `sdcpp-workflow/bin/mflux-controlled-generate.sh`

Documentation/evidence: `OPERATIONAL_STATE.md`, `output/rev18/BUGS.md`, `output/rev18/FINAL_REPORT.md`, `output/rev18/acceptance-blockers.md`, and additive `output/rev19/` receipts, matrix and logs. Historical failures are retained; no checksum inventory is duplicated.

## G. Remaining genuine unknowns

Physically wedged Neural Engine behavior; cause of 502 historical missing images; installed-LoRA rendering (none installed); full power-loss/filesystem durability; automatic crash-journal reconciliation; complete legacy job-list/progress and temporary-resource ownership migration. The matrix covers its defined rendered baseline and fixtures, not every possible user data/state combination. Remote media privacy uses actual functions in owned fixtures, not a new full remote worker run. Browser suites use current read-only model-catalogue snapshots; production bootstrap latency under heavy host pressure is not certified.

Migration follow-ups are bounded: migrate remaining legacy image progress to the shared stage/sampling schema without changing truthful backend progress; add explicit journal recovery using recorded inode/path identities with terminal ownership and receipts; bind remaining generator cleanup resources into the durable ownership store. Do not infer missing-image causes or auto-delete unknown directories.

## H. Git and readiness at the implementation closeout

Branch `rev17-verification-handoff`; HEAD `8f6d711f7d2e9ed0e76c08cffacafe73679efcac`; dirty task changes, nothing staged or committed in this new pass, following the pasted request’s default. READY FOR REVIEW: YES.

Evidence strength: current deterministic regressions, final browser acceptance and one bounded live generation. Confidence is bounded by the explicit unknowns above. Architecture remains MacBook control/storage and ssh westcat compute, primary MFLUX Klein4B with secondary SDCPP unchanged. Node binds loopback. Retired duplicate paths: manual MFLUX publication and untracked age-based media sweep; shared state constants now have one owner. Server additions are wiring, with validation/state/cleanup owners in focused modules. Historical evidence and unknowns remain explicit.

## Publication gate — 2026-10-04

Separate user authorization permits one cohesive commit and normal push of this feature branch. Fresh review found no unexpected paths or publication-blocking defects. Unit295/295, focused37/37, Edit24/24, Voice8/8, chain24+8 and matrix180/180 (1,027 PASS,268 N/A) pass with exit0. Maintained JavaScript/shell syntax checks pass. Existing live generation proof is preserved; its publication sources were unchanged. [Publication gate receipt](publication-gate.json) records scope and commands. Immutable raw-log whitespace exceptions are preserved and documented separately; authored files pass. The preceding Git section records the pre-publication implementation snapshot. Git is authoritative for the eventual commit identity.
