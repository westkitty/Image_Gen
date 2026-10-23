# Pre-redesign repository readiness — 2026-10-23

Status: **READY WITH DECLARED LIMITATIONS** (source integration validated; named live/human items unverified; none blocks starting an isolated design branch).
This is a dated record. It does not rewrite earlier handoffs; where it differs from an older one, this one is the later evidence.

## 1. Authoritative state

| Item | Value |
|---|---|
| Repository | `westkitty/Image_Gen`, MacBook checkout `/Users/andrew/Image_Gen` |
| Verified source baseline | `126a9b9a9be68905b0dc990b85279c3d6c498a13`. This is the commit the release-preflight evidence below was gathered on and that was promoted to `main` (read back with `git ls-remote`). |
| Pre-promotion `main` | `cab2a6ee9181c3ec1be153c7c0177e13153e869f` (fast-forwarded, no force) |
| This document's commit | A docs-only commit whose parent is `126a9b9`, adding only this file and the matching entries in `OPERATIONAL_STATE.md` and `Image_Gen_Bible.md`. Once published, `main` and `feat/v2-functional-parity-20261022` point at that docs commit (find it with `git log -1 --format=%H -- docs/operations/pre-redesign-readiness-20261023.md`). Application code, tests and scripts are byte-identical to `126a9b9`; the preflight was not re-run for the docs commit. |

### Three different identities — do not conflate them

| What | Revision | Meaning |
|---|---|---|
| Published source | `126a9b9` (plus the docs-only commit above) | What is on `main`. |
| Running console (pid 4170, 127.0.0.1:31337) | `/api/version` `gitHead 04486d9`, cwd `/Users/andrew/Image_Gen/operator-console` | A process started before the two correction commits. It was NOT restarted, so its loaded server code predates them until it is restarted. |
| Installed native app `/Applications/DexDiffusion.app` | `DexDiffusionSourceHead d1d5426` | Built from older source; `bin/dexdiffusion status` reports it OUTDATED against the repo. Not rebuilt or reinstalled. Its Swift source fingerprint matches the installed build. |

### Promoted range (`cab2a6e..126a9b9`, 10 commits, 120 files, +13,651/−379, no file deletions)
`d1d5426` Omni recovery diagnostic · `8b0df46` close V2 Studio gaps · `98f06e9` Help/Context drawer, Job Center details · `6116707` prompt-asset/3D/World suites, World WASD fix · `ea56786` music/3D/World acceptance · `d2543ef` V2-entry contract exemption · `9527b3b` Escape closes drawer · `04486d9` 53-row parity ledger · `3827472` drawer focus guard + Row 6 diagnostics · `126a9b9` bounded `status` probes.
Diff review: no binaries, weights, secrets, local-path leaks outside docs, runtime-state files, or new listeners. `media.js` untouched. Included by ancestry: `docs/dexdiffusion-omni-recovery-20261021`.

## 2. Branch and PR disposition (no branch deleted, no PR closed)

| Ref | Disposition |
|---|---|
| `feat/v2-functional-parity-20261022` | Promoted; equals `main`. |
| `docs/dexdiffusion-omni-recovery-20261021` | Ancestor of the promoted work. |
| `acceptance/human-acceptance-prep-20261005`, `arena/f721222f` (PR #4), `fix/studio-v2-*` (PRs #6–#9) | Already ancestors of the prior `main`. |
| `arena/ba1fe323-image-gen` (PR #5, open draft, DO NOT MERGE) | Historical only. Based on `4324dec`, 58 behind. Its dialog delegates, `cancel-unsafe` handling and studio-nav registry are already present in `main`. Left open. |
| `arena/15da1a13-image-gen` (PR #3, open draft) | Historical only. Cancellation/shell work superseded by PR #6. Two artifacts are NOT in `main` and were not evaluated: `public/dexdiffusion/source-resolver.js`, `tests/scroll-stability.test.js`. |
| `rollback/dexdiffusion-pre-v2-20261021` (`4324dec`) | Preserved rollback ref. |
| `worktree-agent-*` (5, `9de6f54`) | Stale local branches under `.claude/worktrees/`; untouched. |
| Local worktrees `DexDiffusion_V2_Release`, `DexDiffusion_V2_Repair` | Not ours; `V2_Repair` has uncommitted edits. Untouched. |

Preserved on the MacBook: the five untracked paths (the Arena master prompt and four `output/*20261022*` directories), `stash@{0}` ("pre-V2 original tracked recovery work, duplicated in PR6"), and all worktrees.

## 3. Test and browser evidence

Gate: `scripts/release-preflight.sh` (unchanged requirements). Style and wildcard suites are excluded by design and were not run.

| Run | Outcome |
|---|---|
| 1 | Unit 1021/1021, one browser suite, then stopped on a transient disk-reserve dip (5.58 GiB vs 6 GiB). Free space recovered; not a code failure. |
| 2 | 44/44 browser suites; unit 1020/1021: `system-info.test.js` "bin/dexdiffusion status…" timed out at 30 s. |
| 3 | Unit 1021/1021; 43/44 browser: `v2-parity-assistance` Row 6 failed. |
| 4 (after corrections `3827472`, `126a9b9`) | **PASS, exit 0: unit 1027/1027 (0 failed/cancelled/skipped), 44 `PASS browser` lines.** Free disk minimum ≈ 11.7 GiB. |

The 1027/1027 and 44/44 result is a single complete pass after two earlier failed runs; it is not a stability proof for the items in section 5.

Focused evidence: new drawer-focus regression fails on the old code and passes on the new; the original Row 6b sequence passed 40/40 and the suite 5/5; the new `status` bound tests (6) pass and a mutant with the alarm disabled fails; `v2-parity-music` 11/11, `concept-a-refinement` 14/14.

## 4. Preserved capabilities and proof level

Proof levels: **gate** = covered by the passing release preflight (fixtures, no live inference); **runtime** = also exercised against real artifacts per `docs/operations/v2-runtime-evidence-20261022.json`; **unverified** = not exercised this pass.

| Capability | Level |
|---|---|
| Image generation routes, primary FLUX.2 Klein 4B (MFLUX) selection and routing | gate (no new live generation this pass; `status` shows primary `proven`) |
| Edit / Enhance, Library, Models, System, Jobs | gate |
| Voice, Drama, Music, World, 3D | gate; music, 3D/World viewers also runtime (short real music generation per engine, read-only artifact viewers) per the 2026-10-22 evidence |
| Cancellation and heavy-compute lease truth | gate; real SD1.5 remote cancel was verified earlier (PR #6) and not re-run |
| Prompt-privacy rules | gate (unchanged code paths; canary tests in the unit suite) |
| Canonical image output `/Users/andrew/images_made` | gate; `status` reads it |
| Network exposure | `status` shows bind `127.0.0.1:31337`, Tailscale Serve tailnet-only; no Funnel on this route. No new listeners in the diff. |
| Video, Swap, stems/mastering | **unavailable by design**; honestly gated, not implemented |
| Native app on the new source | **unverified**: installed app is stale (see section 5) |

Parity record: `docs/operations/v2-functional-parity-20261022.md`: 53 rows, 51 verified_pass, 2 unavailable; certification state PARTIAL_NOT_CERTIFIED.

## 5. Known failures, blocked functions, open concerns

1. **Open diagnostic concern — Row 6a.** `v2-parity-assistance` Row 6 ("Context follows the real Create state…", wait for `Fixed (flow-match Euler)` in the Context drawer, 15 s) failed in one full preflight run and 2 of 3 direct reruns. It did not reproduce in 9 instrumented full-file runs or a 6/6 reduced reproduction, and static analysis found no application defect (label derived fresh; no overwrite path). Candidates remain UNVERIFIED: a swallowed render error (the runtime catches post-first-render throws and keeps the last view), animation-frame throttling, stranded pages. The test now attaches target, sampler, render-error, visibility, rAF and console state on this timeout (`ROW6-CONTEXT-EVIDENCE`). **Not resolved; do not describe as fixed.** If it recurs, read that evidence line first.
2. **`status` hang cause not proven.** The one 30 s timeout of `bin/dexdiffusion status` is unreproduced. SSH/DNS/ControlMaster were ruled out as a deterministic cause; an unbounded call (probably `tailscale serve status`) is the likeliest. `status` now bounds those calls and reports UNKNOWN instead of DOWN/absent; the underlying stall, if it recurs, is not diagnosed.
3. **Row 6b focus race — fixed** (drawer's delayed focus now skipped when focus is already inside; test waits for the real focus event).
4. **Preflight harness gaps (not changed, not approved):** the unit step has no overall timeout; the disk reserve is checked only between browser suites. The 2→1 unit concurrency and stricter matrix regex were reviewed and judged correct and fail-closed.
5. **Native app mismatch:** installed app `d1d5426` vs source `126a9b9`. A rebuild uses `scripts/install-macos-app.sh` (rollback-preserving) and is a separate guarded operation with its own approval and acceptance.
6. **Not performed:** live generation, Big Mac heavy jobs, model downloads, service restarts, native install, unaided novice study (E6). Historical full-suite baseline failures from the Big Mac environment (e.g. PR #6/#9 records) were not reproduced here and this MacBook run did not re-establish them.
7. **PR #3 leftovers:** `source-resolver.js` and `scroll-stability.test.js` unreviewed for value.

## 6. Source, backend and UI entrypoints for the redesign

- Server: `operator-console/server.js` (≈5,970 lines; all HTTP routes, `/api/version`, `/api/capabilities`, `/api/system-info`, `/api/operations/snapshot`, `/api/jobs/:id/cancel`); domain modules alongside it (`media.js`, `drama*.js`, `long-form.js`, `local-engine-*.js`, `model-registry.js`, `lora-runtime-policy.js`, `cancellation.js`, `operational-jobs.js`, `event-bus.js`, `library-index.js`, `capabilities.js`).
- UI shell: `operator-console/public/dexdiffusion/index.html` (845 lines), `component.js` (≈2,560; app state, `setScreen`, `onSelectTarget`, `setState`), `concept-a.js` (≈800; V2 shell builders, Help/Context drawer `v2OpenDrawer`/`buildV2Drawer`, `_ctxModel`), `studio-nav.js` (single registry for the 14 destinations: Create, Batch, Swap, Voice, Drama, Music, Video, World, 3D, Library, Edit, Enhance, Models, System), `dc-runtime.js` (rAF-batched render; swallows post-first-render render errors), `workstation-ui.js`, `client-helpers.js`.
- Feature UIs: `edit-ui.js`/`edit-core.js`, `voice-ui.js`/`voice-designer-ui.js`, `drama-*-ui.js`, `media-ui.js`, `world-viewer.js`/`.html`, `asset3d-viewer.js`/`.html`.
- Tests: 141 unit files (`operator-console/tests/*.test.js`) and 46 browser files (`tests/browser/`; 44 run by the preflight, `prompt-styles` and `wildcard-placement` excluded by design); release gate `scripts/release-preflight.sh`; helpers `tests/browser/helpers.js`.
- Redesign extension points that exist today: the nav registry (`studio-nav.js`), the screen/module registry in `concept-a.js`, the Help/Context drawer slot, the Job Center drawer, and `capabilities` gating that already renders honest "not enabled" states (Swap, Video). A Chat tab, Projects, regrouped navigation and remembered workspaces do **not** exist and were not started.

## 7. Recommended next branch and worktree strategy

- Branch: `feat/ui-architecture-v3-20261023` (or `feat/ui-master-tabs-<date>`), created from `origin/main` after this document is published (the docs-only commit on top of verified source `126a9b9`).
- Create it in a **new** git worktree outside the primary checkout, e.g. `git worktree add ../Image_Gen_UI -b feat/ui-architecture-v3-20261023 origin/main`, so the live console checkout stays at a known commit. Keep 6 GiB free before running the preflight there; its own `node_modules` may be needed.
- First actions on that branch: read `AGENTS.md` and this file; run the preflight once for a baseline; do not touch V1/V3/V4 legacy shells, native wrapper, canonical images, models, LoRAs, voice profiles or Drama projects.

## 8. Rollback and recovery

- `main` was `cab2a6ee9181c3ec1be153c7c0177e13153e869f` before promotion. Preferred rollback is additive: on a new branch run `git revert --no-commit cab2a6e..126a9b9`, review, test, and merge the result, so no history is rewritten.
- A hard restore of `main` to `cab2a6e` requires a non-fast-forward push and explicit owner authorization at that time (`git push --force-with-lease=main:126a9b9 origin cab2a6e:main`).
- Earlier-state refs preserved: `rollback/dexdiffusion-pre-v2-20261021` (`4324dec`), and the pre-correction feature tip `04486d9` (the two correction commits `3827472` and `126a9b9` sit on top of it and can be reverted independently).
- Native app rollback is by the installer's own rollback backup; not touched here.
- No data, models, images, or services were modified during this preparation.
