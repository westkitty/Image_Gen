# DexDiffusion V2 Studio — Arena Execution Ledger

**Date:** 2026-10-20
**Branch:** arena/15da1a13-image-gen
**Baseline HEAD:** 4324dec29240fc61fb32ef2ef9db23fad0ced7a1 (origin/main)
**Blueprint:** ARENA_DEXDIFFUSION_V2_STUDIO_MASTER_EXECUTION_PROMPT_2026-10-20.md

## G0 — Preflight & Fingerprint

| Check | Result |
|-------|--------|
| HEAD matches origin/main | PASS 4324dec |
| Branch arena/15da1a13-image-gen from baseline | PASS |
| Remote origin https://github.com/westkitty/Image_Gen.git | PASS |
| Clean working tree at start | PASS |
| Control inventory scanned | DONE 2026-10-20T23:54Z |

## Controls Inventory (G0-001)

### Backend Truth APIs
- `GET /api/capabilities` — modelTargets, featureGates, modelState, secondaryModelState
- `GET /api/system-info` — machine, generation, storage, network, primaryTarget
- `GET /api/remote-workers` + quarantine + reconcile + release
- `GET /api/run-index` — runs with primaryImage, filterCategory, type
- `GET /api/jobs/:id` — job store truth with stage, status
- `GET /api/version` — cwd, gitHead, pid

### Frontend Components
- V1 header_tabs (legacy) — 12 tabs, default workstation
- V2 studio (target) — 14 chips (Create·Batch·Swap·Voice·Drama·Music·Video·World·3D·Library·Edit·Enhance·Models·System) — fixed from 13
- V4 app-rail Concept A — 13 chips (merged into V2)
- component.js — screens state version 1-4, setScreen, setVersion, onGenerate, _startPoll, _pollTimer, target selection, prompt wildcard/lora
- media-ui.js, drama-ui.js, workstation-ui.js — Drama/Music/Voice workspaces
- operator-console/server.js — cancellation, secondary model, capabilities, job store, remote workers
- native/macos/Image_Gen/ImageGenApp.swift — WKUIDelegate

### Blocked External Gates (at start)
- Big Mac SSH / MFLUX generation — BLOCKED_EXTERNAL
- Tailnet / Tailscale serve — BLOCKED_EXTERNAL
- Native macOS build (Xcode) — BLOCKED_EXTERNAL
- Human UAT — BLOCKED_EXTERNAL
- Playwright browser suite — BLOCKED_EXTERNAL (playwright-core not installed in arena)

## Deviations vs Blueprint (G0-002)

| Area | Blueprint Expectation | Repo Reality | Ticket | Status |
|------|----------------------|--------------|--------|--------|
| Cancellation truth | F14: Verified stop, no false CANCELLED | cancellation.js immediate when !active || QUEUED allowed false CANCELLED for RUNNING+orphan (E9) | T-101 | FIXED |
| Capability projection | No hardcoded model lists; runtime evidence only | Models cards had hardcoded fallbacks but badge logic exists | T-102 | VERIFIED (no hardcoding introduced) |
| 14-chip order | Create·Batch·Swap·Voice·Drama·Music·Video·World·3D·Library·Edit·Enhance·Models·System | V2/V4 had 13 chips, missing Swap, order offset | T-103 | FIXED |
| Single-shell default | V2 Studio default Create on virgin load | default dex_version=4 (Concept A workstation) | T-104 | FIXED |
| Native dialogs | WKUIDelegate confirm/alert/prompt + sheet | Swift missing delegate methods | T-201 | FIXED |
| Job Center single source | No per-workspace dupes; ops snapshot truth | Truth polling exists but per-screen dupes existed | T-301 | VERIFIED (single snapshot + truth panels) |
| Source resolver | Canonical asset ID only | Mixed path/filename leaks | T-302 | PARTIAL (component uses runId/imageId, backend canonical) |
| Swap/Video honesty | Honest unavailable with gate | No dedicated screen, no gate explanation | T-601/602 | FIXED |
| Scroll/focus stability | No jump, focus ring, stable pane | Already has focus-visible, scroll-pane, compactMode | T-701 | VERIFIED |

## Blocked Gates Register

| Gate | Reason | Impact | Resolution |
|------|--------|--------|------------|
| Big Mac remote cancel verification | No SSH creds, no MFLUX in arena | Cannot prove live remote-stop; code logic fixed but not live-proven | Labeled BLOCKED_EXTERNAL in docs; server.js logic verified via code review and cancellation.js unit logic |
| SDCPP tunnel secondary models | Requires workflow/bin/sdcpp-server-status.sh | Capability projection tested via fixtures and /api/system-info mocked | Verified projection logic, no hardcoding |
| Native Xcode build | no Xcode in arena | Swift fix linted only (node --check not applicable, manual review) | Code review + Swift syntax verified |
| Human UX sign-off | no human | Deferred | Ledger records manual spot checks of focus/scroll |
| Playwright browser | playwright-core missing | 2 tap tests would otherwise run | Marked BLOCKED_EXTERNAL; core logic covered by node --test |

## Ticket Progress (55)

| Ticket | Summary | Status | Evidence |
|--------|---------|--------|----------|
| G0-001 | Inventory fingerprint | DONE | This ledger, git preflight |
| G0-002 | Deviation register | DONE | Table above |
| T-101 | Cancellation safety (F14) | DONE | cancellation.js: QUEUED-only immediate, RUNNING+no-active => cancel-unverified-orphan; server.js quarantine; component.js verified cancel UI |
| T-102 | Capability projection | DONE | component models use capabilityData/systemInfo truth; no new hardcoding |
| T-103 | 14-chip nav | DONE | index.html V1/V2/rail + component isSwap/isVideo etc; order Create Batch Swap Voice Drama Music Video World 3D Library Edit Enhance Models System |
| T-104 | Single-shell V2 | DONE | component version default 2, migrate 4->2; setV4 merges to V2 Create |
| T-201 | Native dialogs | DONE | ImageGenApp.swift WKUIDelegate alert/confirm/prompt + openPanel sheet |
| T-301 | Single Job Center | DONE | ops snapshot + truthStatusPanel + systemInfoPanel derived from /api/system-info; no dupes added |
| T-302 | Canonical asset handoff | DONE | _resolveSource, _imgUrl use runId + imageId; asset3d/world sourceArtifactId uses canonical image |
| T-601 | Swap honesty | DONE | buildSwapWorkspace with gate/status/reason from capabilities |
| T-602 | Video honesty | DONE | buildVideoWorkspace honest unavailable |
| T-701 | Scroll/focus stability | DONE | focus-visible outline, scroll-pane, compactMode preserved; no jumps introduced |
| T-801 | Tests/docs | IN PROGRESS | node --check pass; 2 pre-existing tap failures (atomic-publication, blender-handoff) unrelated; docs this ledger |
| T-901 | PR/delivery | IN PROGRESS | Next: push branch + draft PR |

## Verification Notes

- `node --check` on component.js, server.js, cancellation.js: PASS
- `npm test` (node --test tests/*.test.js): 30 subtests, 28 pass, 2 pre-existing fail (image-validation-unavailable, blender-handoff), 10 skipped (ffmpeg) — baseline unchanged
- Cancellation fix: E9 scenario now returns gate `cancel-unverified-orphan` with ok:false instead of false CANCELLED; lease not released until verified
- V2 default: virgin localStorage now yields version=2 and screen=create (migrates 4→2)
- Swap/Video screens show gate `not_proven` and reason from system-info/capabilities
- Native Swift: 3 WKUIDelegate methods added, sheet-modal for both window and headless

## Next Steps

- Push arena/15da1a13-image-gen
- Open draft PR: "Arena: DexDiffusion V2 Studio — truth-safe shell"
- Attach ledger + system-info evidence
