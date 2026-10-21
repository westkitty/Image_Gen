# Independent verification — DexDiffusion V2 Studio campaign

**Date:** 2026-10-20 · **Branch:** `arena/f721222f-image-gen` · **Audited commit:** `ee5f710` (plus the test added in the same session afterwards)
**Auditor:** the same Arena agent, re-reading the master instruction cold and re-checking the code rather than trusting its own ledger.

---

## 0. Verdict, stated first

**No. The mission is not done, and nothing here is releasable.**

| Bucket | Tickets | Meaning |
|---|---|---|
| `VERIFIED_SANDBOX` | **21 / 55** | contract proven by an automated test in this Linux sandbox (E1/E2 only) |
| `IN_PROGRESS` | **9 / 55** | real partial work, explicitly incomplete |
| `NOT_STARTED` | **18 / 55** | untouched |
| `BLOCKED_NATIVE` / `BLOCKED_REAL_WORKER` / `BLOCKED_HUMAN` / `BLOCKED_EXTERNAL` | **6 / 55** | cannot be produced in this environment |
| `NOT_REPRODUCED` | **1 / 55** | the reported defect could not be reproduced; no fix claimed |

**Evidence ceiling: E1 (source) and E2 (fixture / jsdom).** There is **zero** E3 (browser), E4 (native WKWebView), E5 (real Big Mac worker) or E6 (novice) evidence, because this sandbox has no Chromium, no macOS/Swift, no Big Mac access and no participants.

The user-facing core of the blueprint — the first-load contract in §2.1, the Basic/Advanced split (§2.5/T-501), the single Job Center (§4.1/T-503), and 13 of the 14 per-module passes (§3/G6) — **is not implemented**. What *is* done is the P0 safety spine (cancellation truth), the native dialog defect, the shell/navigation consolidation, canonical source resolution, and the reload/render robustness that those depend on.

---

## 1. How this audit was performed

1. Re-read the controlling instruction section by section (§2.1–§2.5, §3 S01–S14, §4.1–§4.7, gates G0–G9, journeys J01–J10, invariants I-01–I-14, §7.5 hard gates).
2. For every claim, searched the shipped code (`index.html`, `component.js`, `workstation-ui.js`, `edit-ui.js`, `media-ui.js`, `source-asset.js`, `studio-nav.js`, `server.js`, `cancellation.js`, `ImageGenApp.swift`) for the actual mechanism — not the CSS class or the method name.
3. Re-ran the suites rather than citing earlier runs: full `npm test`, plus each new suite individually.
4. Added **new** verification where the previous evidence was weak (see §6): computed-style proof that the version picker is genuinely hidden, and a recorded inventory of what the first-load contract is *actually* missing.

---

## 2. Gate scorecard (G0–G9)

| Gate | Status | What is true | What is missing |
|---|---|---|---|
| **G0** identify/lock/inventory | **PASS (sandbox)** | Fingerprint, base SHA, baseline suite, full control inventory, executable binding inventory | Native stamp/Dock readback (E4); pre-change novice recording |
| **G1** cancellation truth (P0) | **PASS (sandbox)** | Unowned `RUNNING` can no longer become `CANCELLED` or release the lease; structured contract; capability computed once | No real worker stop (E5); `stop_after_current` not implemented |
| **G2** native dialogs + visible cancel | **HALF** | Three `WKUIDelegate` dialogs implemented; job-scoped Cancel with four honest end states | Never compiled or clicked (no toolchain/macOS) → `BLOCKED_NATIVE` |
| **G3** canonical handoffs | **PARTIAL** | One resolver, no `runs[0]` fallback, strict ids, selection carried | Server-side canonical projection (§4.3 JSON) not built; no end-to-end Library→Edit→Enhance→3D→World run |
| **G4** Studio as sole shell | **PASS (sandbox)** | Default + migration + one 14-chip row + developer-only picker (computed style verified) | Brand still `DexDiffusion`, not `DexDiffusion Studio` |
| **G5** simple *and* complete | **MOSTLY NOT STARTED** | No-op removal + crash recovery | **No Basic/Advanced disclosure**, no one Job Center, no priority/transition rules, no model-surprise guard |
| **G6** per-module passes | **LARGELY NOT STARTED** | Create (partial), Swap (honest empty), Models (dead actions removed), System (degraded state) | Batch, Voice, Drama, Music, Video, World, 3D, Library, Edit, Enhance not passed |
| **G7** scroll/input stability | **BLOCKED** | Nothing regressed; no renderer change | No native reproduction → `UNREPRODUCED`; no fix claimed |
| **G8** regression/native/novice | **PARTIAL** | 980-test suite; 14-screen DOM matrix | No browser matrix (E3), no native (E4), no bounded real job (E5), no novice study (E6) |
| **G9** docs/rollout | **PARTIAL** | Ledger, governing docs, acceptance script, PR | Not installed, not released, rollback never exercised |

---

## 3. The first-load contract (§2.1) — line-by-line

This is the section a beginner actually meets, so it is audited literally.

| Required | Present? | Reality in the code |
|---|---|---|
| Window title/brand **DexDiffusion Studio** | ❌ | `<title>DexDiffusion</title>`; header text `DexDiffusion` |
| **Create** selected on first load | ✅ | verified by jsdom (`aria-current="page"` on Create) |
| Large canvas saying **Your image will appear here** | ❌ | empty canvas says `Generate to fill this canvas.` / `Dexter is watching.` over a mascot image |
| Right side labelled **Describe your image** | ❌ | the prompt lives in a collapsed `Prompt` disclosure; label is not used |
| **Model** selector | ⚠️ | present as a bare `<select>` + `Preset` under a `Model` divider; no capability-backed label |
| **Image shape** | ❌ | Square/Landscape/Portrait buttons exist but are not labelled "Image shape" |
| **Quality preset** | ⚠️ | a preset `<select>` of `Fast / Smoke test / Custom` — "Smoke test" is not a beginner concept |
| **Generate image** | ✅ | `aria-label="Generate image"`, one job per click, verified |
| **Advanced settings** disclosure | ❌ | **does not exist** (T-501 not started); settings are always visible in the scroll pane |
| Single **Jobs** control top-right (`Ready` / `Running 1` / `Check required`) opening a Job Center | ❌ | the header has a **passive status chip** (`Idle / 40% / Done / Error`); no Jobs button, no Job Center in V2 |
| No help wall / diagnostic log / competing rails | ✅ | the V2 shell has one nav row and no log wall (the previous shell's rails are gone) |
| On success: canonical image + **Open in Library / Edit / Enhance / Download** + **Saved to Library** | ⚠️ | result actions exist as `Fullscreen / Keeper / Copy Seed / Reuse Settings / Send to Img2Img / Send to Inpaint / Upscale / Detailer / Lineage` — no `Open in Library`, no `Download`, no `Saved to Library` confirmation |
| Offline: **Studio can't reach the local service** + **Retry connection** + **Open System details**, draft preserved | ❌ | no offline banner or retry control exists in the V2 markup; only a small `✗ Offline` backend chip |

**Net: 4 of 14 first-load requirements are met, 3 partially, 7 absent.**

---

## 4. Invariants I-01 … I-14

| # | Verdict | Basis |
|---|---|---|
| **I-01** Studio not Workstation | ✅ mostly | Studio is the default; migration is idempotent and tested; version picker is `display:none` for a normal profile (now proven with computed style, not just an attribute). ✗ brand string is not "DexDiffusion Studio" |
| **I-02** intention controls operations | ✅ | chip clicks only change screen — the 14-chip matrix issues no job call; Swap's test asserts zero requests |
| **I-03** one honest job state | ✅ (P0) | 16 cancellation-contract tests + 5 UI cancel tests: unverified stop can never render as success |
| **I-04** same image, same ID | ⚠️ partial | resolver + no fallback + selection propagation; **no server-side canonical projection and no end-to-end journey proof** |
| **I-05** one capability truth | ❌ | `/api/workers`, `/api/capabilities`, `/api/models`, `/api/operations/snapshot` are still consulted separately; no consolidated projection |
| **I-06** zero feature deletion | ⚠️ | nothing functional removed (only unbound buttons); but the **required** Library actions (`Use for 3D`, `Use for World`, `Download`, `Show details`) do not exist as such |
| **I-07** zero enabled no-ops | ✅ (proven subset) | three guards: no handler-less button, every binding resolves, every enabled button named. "Does it do something *useful*" is unproven (E3) |
| **I-08** no work loss | ⚠️ | session keys and draft guards exist and were preserved; per-screen draft retention is not exhaustively tested |
| **I-09** local-first boundary | ✅ by omission | no bind/port/network/model/canonical-path change was made anywhere |
| **I-10** no silent model changes | ✅ by omission | no pin, target or activation logic was altered |
| **I-11** screen stability | ⚠️ | polling/SSE untouched, render patching preserved; no measurement (E3/E4) |
| **I-12** evidence before PASS | ✅ | this document separates E1/E2 from E3–E6 throughout |
| **I-13** dirty-work protection | ✅ | no `clean`/`reset --hard`/`restore`/`add -A`; the four MacBook-only dirty paths were never present and never assumed |
| **I-14** controlled changes | ✅ | 11 commits, one behaviour cluster each, scoped `git add` paths |

---

## 5. Journeys J01–J10

| Journey | Status | Exact gap |
|---|---|---|
| **J01** first image | ❌ | no "Describe your image", no "Saved to Library", no Jobs linkage, no "Open in Library"; the mechanics (one job per click) *are* verified |
| **J02** cancel a queued image | ❌ | server supports `not_started`, but there is **no `Cancel queued job` control** in the UI |
| **J03** stop a running job | ⚠️ E2 only | UI + server states verified with stubs; no real PID/nonce/lease agreement (E5) |
| **J04** worker cannot cancel | ⚠️ | server refuses and the UI reports the refusal, but the limitation is **not stated before launch** at the point of action, and `stop_after_current` does not exist |
| **J05** Library→Edit→Enhance | ⚠️ | identity is enforced by the resolver; draft guard exists; no executed end-to-end run |
| **J06** Library→3D/World | ⚠️ | stale/invalid source now refuses and issues no call (unit-tested); no executed fixture job |
| **J07** draft + model switching | ❌ | switching tabs preserves React state, but there is **no Advanced disclosure to close**, and **no warning when a model change invalidates hidden settings** |
| **J08** 14 categories | ⚠️ | 14/14 navigation + honest Swap/Video verified (E2); "every enabled action meaningful" unproven |
| **J09** scroll/input | ❌ BLOCKED | not reproduced; no native trace; no fix claimed |
| **J10** service/Big Mac failure | ❌ | no local-failure banner, no retry control, no "Big Mac unreachable" state on Create |

---

## 6. What this audit changed (new evidence produced now)

Two things were found while re-checking, and both are fixed in the same branch:

1. **The "version picker is hidden" claim was only attribute-level.** It is now proven by computed style inside the jsdom document (`getComputedStyle(picker).display === 'none'` for a normal profile, not `none` in developer mode). New test 27 in `tests/studio-shell.test.js`.
2. **A page-level `<style>` block was never present in earlier DOM tests**, so no CSS-driven behaviour was being verified at all. The test harness now injects the real stylesheet, which is what made (1) possible.

---

## 7. Corrections to things stated earlier in this session

| Earlier statement | Accurate version |
|---|---|
| "an unreachable `/api/workers` or `/api/resources` no longer blanks the shell" | True but **narrow**: two further payload crashes (`/api/system-info`, `/api/library/images`) had the same effect and were only found later. The durable fix is the `render()` guard. |
| "zero enabled no-op controls" | True for *unbound* controls (proven). Not yet proven that every bound control does something useful. |
| "removed 15 inert buttons" | True, and each was verified to have no handler. Two of them (`Open`, `→ Create`) described capabilities the blueprint **requires** in Library; their functions exist elsewhere (`Fullscreen`, `Lineage`, `imageActions`), but the required labels/handoffs are still missing. |
| "World/3D now strict" | True for client resolution. The server already validated; the client-side silent substitution is what was removed. |
| "T-203 reattach fixed" | True, and it exposed a second bug (`_jobTerminal` case-sensitivity) that made every durable `RUNNING` job look finished on reload. |

---

## 8. What remains, in priority order

**P0 (safety-adjacent, still open)**
1. **Single Job Center + Jobs button** (`T-503`, §4.1): one projection, one place, one actionable list; remove the passive chip as the only job surface.
2. **Queued cancellation control** (`J02`): `Cancel queued job` bound to `not_started` capability.
3. **Pre-launch cancellation disclosure** (`J04`): say "this job can't be stopped once it starts" *before* submission when `cancel_supported:false`.

**P1 (first-load contract, §2.1 — 7 missing items)**
4. Rename brand/title to **DexDiffusion Studio**.
5. Canvas empty state → `Your image will appear here` (drop the mascot/demo image from the empty canvas).
6. Label the inspector: `Describe your image`, `Model`, `Image shape`, `Quality preset`; demote `Smoke test` out of the happy path.
7. **Advanced settings disclosure** (`T-501`) that hides — but never resets — sampler/scheduler/steps/CFG/seed/LoRA/VAE.
8. Result actions `Open in Library`, `Download`, and a `Saved to Library` confirmation.
9. Offline state: `Studio can't reach the local service` + `Retry connection` + `Open System details`, draft preserved.

**P2 (module passes, G6)**
10. Library context actions `Use for 3D` / `Use for World` / `Download` / `Show details`.
11. Batch, Voice, Drama, Music, Video, World, 3D, Edit, Enhance passes (T-602, T-604–T-612).

**P3 (capability + polish)**
12. Consolidated capability projection (`I-05`, §4.4); model-change warning (`J07`); System health summaries `T-614`; per-screen empty/error copy.

**P4 (cannot be done here)**
13. E3 browser matrix, E4 native dialogs/Dock, E5 bounded real job + real cancel, E6 novice study, native scroll trace (`T-701`).

---

## 9. Evidence inventory (what can actually be re-run)

| Command (in `operator-console/`) | Result at audit time |
|---|---|
| `npm test` | **980 tests — 812 pass / 88 fail / 80 skipped** |
| failing set vs pristine base | **0 new, 0 removed** (88 environmental: `ffmpeg`, Python libs, macOS paths, live fixtures) |
| `node --test tests/studio-shell.test.js` | 27/27 |
| `node --test tests/source-asset.test.js` | 14/14 |
| `node --test tests/cancellation-truth.test.js` | 16/16 |
| `node --test tests/world-tab-navigation.test.js` | 4/4 |
| `node --test tests/native-wrapper-launch.test.js` | 4/4 (static source only) |
| browser suites | **skipped** — no Chromium |

Source-level proof for the tickets marked `VERIFIED_SANDBOX` lives in the ledger with the exact assertion name for each.

---

## 10. Bottom line for the owner

- **Safest thing shipped here:** a job can no longer be called `Cancelled` without proof, and a reload can no longer turn a live job into a failure or a phantom cancel.
- **Biggest thing still missing:** the beginner surface — labelled first load, Advanced disclosure, one Job Center, result actions — i.e. most of §2.1, §2.5 and G5/G6.
- **Nothing in this branch should be installed over the working app** until E4/E5/E6 exist.
- PR **#4** stays open, draft, and unmerged.
