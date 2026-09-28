# DEXDIFFUSION WORKSTATION V12 CAMPAIGN EXECUTION PLAN & LEDGER

- **Branch**: `arena/01a0e90d-image-gen` (tied session branch)
- **Base SHA**: `2cdfe210034ef31d900bbe520ae680b1e33ee95f`
- **Target Default Branch**: `main`
- **Controlling Objective**: Transform DexDiffusion into a unified, event-driven, recoverable generative workstation with durable job projections, fast indexed Library, collections, macros, repro bundles, adaptive controls, command palette, and scoped cancellation.

---

## 15 Mandatory Features Ledger

| ID | Feature | Target Scope | Status | Verification Evidence |
|---|---|---|---|---|
| F01 | Event-driven Job Bus | Native SSE `/api/events`, monotonic IDs, bounded replay, reconnect, snapshots, privacy safe | PENDING | Baseline preflight |
| F02 | Global Job Center | Persistent cross-screen Job Center drawer/panel (Active/Queue/Recent), gates, actions | PENDING | Baseline preflight |
| F03 | Durable Image Jobs | Unified durable job store across image & media, restart reconciliation to INTERRUPTED | PENDING | Baseline preflight |
| F04 | Library Turbo | Rebuildable incremental metadata index, derived secure thumbnails, facets, fast query | PENDING | Baseline preflight |
| F05 | Collections / Boards | Persistent collections referencing artifact IDs, multi-select, filters, atomic writes | PENDING | Baseline preflight |
| F06 | Queue ETA + Resource HUD | Global Big Mac/resource HUD + median historical completed duration ETA estimation | PENDING | Baseline preflight |
| F07 | Adaptive Control Surface | Target capability-driven Basic vs Advanced UI, auto-hiding invalid knobs (SD vs Flux) | PENDING | Baseline preflight |
| F08 | Command Palette + Keyboard | Global Cmd/Ctrl+K palette, Cmd/Ctrl+Shift+J Job Center, Cmd/Ctrl+Enter generate, shortcuts | PENDING | Baseline preflight |
| F09 | Lineage Settings Diff | Delta display of settings changes child vs parent, prompt privacy preservation | PENDING | Baseline preflight |
| F10 | Synchronized Comparison | 2-image (side-by-side, Linked Pan/Zoom, A/B toggle, swipe, diff) and 2-4 synchronized grid | PENDING | Baseline preflight |
| F11 | Workflow Macros | Versioned declarative macros schema `dexdiffusion.macro.v1`, ordered steps, privacy safe | PENDING | Baseline preflight |
| F12 | Reproducibility Bundles | Versioned schema `dexdiffusion.repro.v1`, JSON export/import with capability validation | PENDING | Baseline preflight |
| F13 | Unified Recipes | Versioned schema `dexdiffusion.recipe.v1`, atomic persistence, CRUD, localStorage migration | PENDING | Baseline preflight |
| F14 | Actual Cancellation | Scoped cancellation (queued immediate, local PID-verified, remote job-scoped markers), cleanup | PENDING | Baseline preflight |
| F15 | Frontend / Backend Decomposition | Modularize `server.js` and `public/app.js` into clean, testable ESM/CJS domain modules | PENDING | Baseline preflight |

---

## Baseline Preflight (Level 1-2 Checks)
- `node --check server.js`: PASS
- `node --test tests/*.test.js`: PASS (109/109 tests passed after pillow runtime dependency check)
- Static analysis:
  - `server.js`: 3,883 lines, monolithic routing, in-memory jobs + media job store, direct filesystem scans
  - `public/app.js`: 3,243 lines, active polling interval 1.5s - 3s for running jobs, polling full logs
  - Library: scans up to 200 runs on disk per request, full resolution images loaded on cards
  - Queue/Resource: Big Mac lease capacity 1 in `media.js`, image jobs use in-memory queue with partial disk persistence
  - Cancellation: queued media jobs cancellable; active image jobs lack verified termination contract

---

## Phase Execution Checklist
- [x] Phase 0: Freeze baseline, establish ledger and campaign documentation
- [ ] Phase 1: Create architectural seams (backend modules + frontend modules)
- [ ] Phase 2: Unified Job Foundation (F01 Event Bus, F03 Durable Jobs, F06 ETA foundation, F14 cancel foundation)
- [ ] Phase 3: Live Operations UX (F02 Global Job Center, F06 Resource HUD, SSE client)
- [ ] Phase 4: Library Turbo + Collections (F04 Metadata Index & Thumbnails, F05 Collections)
- [ ] Phase 5: Lineage + Comparison + Reproducibility (F09 Diff, F10 Synchronized Compare, F12 Repro Bundles)
- [ ] Phase 6: Recipes + Workflow Macros (F13 Unified Recipes, F11 Declarative Macros)
- [ ] Phase 7: Adaptive UX + Command Palette (F07 Adaptive Controls, F08 Command Palette)
- [ ] Phase 8: Safe Cancellation Complete (F14 Scoped cancellation and cleanup)
- [ ] Phase 9: Performance Uplift Pass (Zero-polling verification, memory bounds, clean listeners)
- [ ] Phase 10: Integration, Privacy Canaries, Adversarial Validation & PR
