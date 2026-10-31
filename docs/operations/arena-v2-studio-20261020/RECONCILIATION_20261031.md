# Legacy Arena branch reconciliation — 2026-10-31

## Scope and authority

Repository: `westkitty/Image_Gen`. User explicitly requested that all outstanding project branches be integrated into `main` and that changes be staged, committed and pushed.

The verified branch inventory contained 17 names including `main`. Thirteen historical branches were already ancestors of `main` and therefore required **no new merge**. Two earlier Arena branches diverged; the only contemporary open PR was #14. PR #14 was merged into `main` first, at `28e48460f80e72dba9b6048e498db7bff4b4504f`.

## Old branch reconciliation

- `arena/15da1a13-image-gen` — closed, unmerged draft PR #3, tip `8437920cfad73c4a59e48b338053a8cd591dc7ae`; 2 branch-only commits / 104 commits behind the prior current main.
- `arena/ba1fe323-image-gen` — closed, unmerged draft PR #5, tip `b56230fb76d35eaf60f03460cf5109332f83bc3a`; 6 branch-only commits / 104 behind.

Both branch tips contain useful historical acceptance records but also an outdated launcher, Studio navigation, cancellation and worker implementation. The modern `main` already includes later reviewed fixes for the same areas, including the 2026-10-31 native WebKit launcher, canonical image import, verified progress, and Big Mac local execution.

**Conflict-resolution policy:** preserve these branch commits as real second-parent ancestors of explicit reconciliation merge commits; retain the current main implementation as authoritative for executable files; do not copy obsolete runtime JavaScript, Swift, server, cancellation, or tests across unverified. No `git merge -X theirs`, forced overwrite, history rewriting, or silent feature replacement.

## Preserved material

- Archived original PR #3 operator help in `docs/operations/arena-v2-studio-20261020/HELP_V2_STUDIO.md`, prefixed with a clear historical-context warning.
- Archived original PR #5 execution and acceptance ledger in `docs/acceptance/DEXDIFFUSION_V2_STUDIO_EXECUTION_LEDGER.md`, prefixed with the same warning.
- All original source changes, tests, documents and commits remain inspectable in their respective full Git branch histories and in the new main merge ancestry. They have **not** been represented as active tested runtime code.

## Existing latest feature release

PR #14 `fix/gaussian-world-voice-trim-20261031` was integrated at `28e48460`. It includes Gaussian SH color extraction and original per-view splat inspection; Big Mac local-media routing; and uploadable 0.5–30-second voice excerpt selection. Previously recorded checks included 26 focused media/unit passes, 2 synthetic color tests, a synthetic 45s-to-25s sample workflow, and original first-view Spark rendering. The real new Qwen render and million-splat view switching remain **unverified**, and this release must not be claimed end-to-end proven.

## Release and deployment state

GitHub merge ancestry and document preservation require separate final GitHub readback. The Big Mac native remote shell executor had timed out on new commands in this session, so GitHub commits must **not** be treated as proof of deployment, restart, MacBook installation, or complete voice/3D execution. Production data and existing macOS app backups remain untouched by GitHub reconciliation. The user will receive a guarded terminal command to synchronize Big Mac and MacBook and install the native app only when necessary.

