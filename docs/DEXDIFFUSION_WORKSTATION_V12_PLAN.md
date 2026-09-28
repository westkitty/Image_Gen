# DEXDIFFUSION WORKSTATION V12 CAMPAIGN EXECUTION PLAN & LEDGER

- **Branch**: `arena/01a0e90d-image-gen` (tied session branch)
- **Base SHA**: `2cdfe210034ef31d900bbe520ae680b1e33ee95f`
- **Target Default Branch**: `main`
- **Controlling Objective**: Transform DexDiffusion into a unified, event-driven, recoverable generative workstation with durable job projections, fast indexed Library, collections, macros, repro bundles, adaptive controls, command palette, and scoped cancellation.

---

## 15 Mandatory Features Ledger

| ID | Feature | Target Scope | Status | Verification Evidence |
|---|---|---|---|---|
| F01 | Event-driven Job Bus | Native SSE `/api/events`, monotonic IDs, bounded replay, reconnect, snapshots, privacy safe | PASS | `event-bus.js`, unit tests `workstation-v12-foundations.test.js`, endpoint `/api/events` |
| F02 | Global Job Center | Persistent cross-screen Job Center drawer/panel (Active/Queue/Recent), gates, actions | PASS | `public/dexdiffusion-v12.js`, `/api/operations/snapshot`, responsive tested |
| F03 | Durable Image Jobs | Unified durable job store across image & media, restart reconciliation to INTERRUPTED | PASS | `operational-jobs.js`, server integration, `media.js` jobStore |
| F04 | Library Turbo | Rebuildable incremental metadata index, derived secure thumbnails, facets, fast query | PASS | `library-index.js`, `thumbnail-service.js`, `/api/library/v2/items`, `/api/thumbnails/:id` |
| F05 | Collections / Boards | Persistent collections referencing artifact IDs, multi-select, filters, atomic writes | PASS | `collections-store.js`, `/api/collections` endpoints, unit + int tests |
| F06 | Queue ETA + Resource HUD | Global Big Mac/resource HUD + median historical completed duration ETA estimation | PASS | `timing-store.js`, bottom HUD bar in `public/dexdiffusion-v12.js` |
| F07 | Adaptive Control Surface | Target capability-driven Basic vs Advanced UI, auto-hiding invalid knobs (SD vs Flux) | PASS | `model-presets.js`, `v12-adaptive-palette.test.js` |
| F08 | Command Palette + Keyboard | Global Cmd/Ctrl+K palette, Cmd/Ctrl+Shift+J Job Center, Cmd/Ctrl+Enter generate, shortcuts | PASS | `public/dexdiffusion-v12.js`, keyboard handler, accessible modals |
| F09 | Lineage Settings Diff | Delta display of settings changes child vs parent, prompt privacy preservation | PASS | `/api/lineage/:id/diff`, `v12-lineage-compare-repro.test.js` |
| F10 | Synchronized Comparison | 2-image (side-by-side, Linked Pan/Zoom, A/B toggle, swipe, diff) and 2-4 synchronized grid | PASS | `v12-lineage-compare-repro.test.js`, comparison modal in `dexdiffusion-v12.js` |
| F11 | Workflow Macros | Versioned declarative macros schema `dexdiffusion.macro.v1`, ordered steps, privacy safe | PASS | `macro-store.js`, `/api/macros` endpoints, `v12-recipes-macros.test.js` |
| F12 | Reproducibility Bundles | Versioned schema `dexdiffusion.repro.v1`, JSON export/import with capability validation | PASS | `repro-bundle.js`, `/api/repro/export`, `/api/repro/validate` |
| F13 | Unified Recipes | Versioned schema `dexdiffusion.recipe.v1`, atomic persistence, CRUD, localStorage migration | PASS | `recipes-store.js`, `/api/recipes` endpoints, `v12-recipes-macros.test.js` |
| F14 | Actual Cancellation | Scoped cancellation (queued immediate, local PID-verified, remote job-scoped markers), cleanup | PASS | `cancellation.js`, `/api/jobs/:id/cancel`, `v12-cancellation-safety.test.js` |
| F15 | Frontend / Backend Decomposition | Modularize `server.js` and `public/app.js` into clean, testable ESM/CJS domain modules | PASS | Extracted 10 dedicated modules + frontend v12 client engine |

---

## Phase Execution Checklist
- [x] Phase 0: Freeze baseline, establish ledger and campaign documentation
- [x] Phase 1: Create architectural seams (backend modules + frontend modules)
- [x] Phase 2: Unified Job Foundation (F01 Event Bus, F03 Durable Jobs, F06 ETA foundation, F14 cancel foundation)
- [x] Phase 3: Live Operations UX (F02 Global Job Center, F06 Resource HUD, SSE client)
- [x] Phase 4: Library Turbo + Collections (F04 Metadata Index & Thumbnails, F05 Collections)
- [x] Phase 5: Lineage + Comparison + Reproducibility (F09 Diff, F10 Synchronized Compare, F12 Repro Bundles)
- [x] Phase 6: Recipes + Workflow Macros (F13 Unified Recipes, F11 Declarative Macros)
- [x] Phase 7: Adaptive UX + Command Palette (F07 Adaptive Controls, F08 Command Palette)
- [x] Phase 8: Safe Cancellation Complete (F14 Scoped cancellation and cleanup)
- [x] Phase 9: Performance Uplift Pass (Zero-polling verification, memory bounds, clean listeners)
- [x] Phase 10: Integration, Privacy Canaries, Adversarial Validation & PR
