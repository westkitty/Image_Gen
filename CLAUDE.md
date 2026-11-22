# Claude Code entrypoint — DexDiffusion

Read `AGENTS.md` and the current `OPERATIONAL_STATE.md` before planning, changing or declaring completion. `AGENTS.md` is the authoritative project instruction file; do not duplicate its rules here.

**Mandatory for "finish", "fix", "release", "stage/commit/push" or "cleanup" requests:** apply the "Release and cleanup closure gate" in `AGENTS.md`, including independent remote-SHA verification, real deployed-state proof when in scope, scoped worktree accounting and a truthful final verdict.

Use `python3 scripts/check_git_closure.py --repo . --branch main --inventory` after finishing the relevant Git publication to verify the Git portion. A passing Git check is not proof of CI, a live fallback drill or image publication. Preserve unrelated worktrees and the user's local files. Never substitute a plan or prompt for requested authorized execution.
