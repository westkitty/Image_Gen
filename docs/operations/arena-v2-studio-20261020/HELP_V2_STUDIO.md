> **HISTORICAL ARENA RECORD — October 21, 2026.** Reconciled into main on October 31, 2026. The operational instructions, shell navigation and environment claims below describe the older Arena branch, **not** the current DexDiffusion production behavior. The current `main` source, `OPERATIONAL_STATE.md`, and installed Big Mac worker state take precedence. See `docs/operations/arena-v2-studio-20261020/RECONCILIATION_20261031.md`.

---

# DexDiffusion V2 Studio — Operator Help (Arena)

**Single shell:** V2 Studio at `/dexdiffusion/` (`operator-console/public/dexdiffusion/index.html`) is the sole product shell. V1 header_tabs and Concept A app-rail remain in code for migration but are hidden when `dex_version=2` (default).

**14 Categories (exact order):** Create · Batch · Swap · Voice · Drama · Music · Video · World · 3D · Library · Edit · Enhance · Models · System

- **Swap / Video:** Honest unavailable. No runtime evidence on this 32 GiB MacBook without dedicated asset. Gate `not_proven`, reason from `GET /api/capabilities` + `GET /api/system-info`. Do not invent.

**Cancellation Safety (F14):**
- Generate starts a controlled job (`POST /api/actions/generate-controlled` → `job_id` → poll `GET /api/jobs/:id`).
- Pressing Generate again while generating now calls `POST /api/jobs/:id/cancel` with verified Big Mac stop (`sdcpp-remote-cancel.sh --run-id`). Response is `remote_stop: verified | completed_naturally | unverified | not_started`.
- Unverified → local CANCELLED but `quarantine: true`, lease held, heavy work paused. Reconcile via `POST /api/remote-workers/reconcile` or operator release `POST /api/remote-workers/:id/release {acknowledge:"unverified"}` (labelled).
- Never `pkill`, `killall`, or local-only clearInterval.

**Capability Truth:**
- Models screen lists only `modelTargets` from `GET /api/capabilities` + `modelCards` from `GET /api/models` filtered by provenance (`EXACT MODEL` vs `FAMILY SAMPLE` vs `PLACEHOLDER`). No hardcoded primary list.
- Secondary SDCPP targets require `POST /api/models/secondary/activate` (dormant at startup). Primary MFLUX needs no activation.

**Source Handoff:**
- Every Edit/Enhance/3D/World job carries `sourceArtifactId` (canonical `runId/imageId` from Library `imageStore`). No absolute paths.

**Job Center:**
- Single source `GET /api/operations/snapshot` + `GET /api/jobs/:id`. No per-workspace duplicates. Truth panels show gate + evidence.

**Native macOS:**
- WKWebView dialogs (alert/confirm/prompt) and file picker now use sheets so JS does not hang.

**Keyboard:**
- Cmd+Enter Generate, / focus prompt, P toggle prompt, S settings, L library, Esc close dialogs.

**Blocked in Arena:**
- Big Mac SSH, Tailscale serve, Xcode build, human UAT, Playwright — labelled BLOCKED_EXTERNAL, code logic proven via review.
