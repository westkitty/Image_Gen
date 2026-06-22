# Image_Gen Deep File Sweep

Date: 2026-06-22

This is the human-readable companion to `/tmp/imagegen_full_file_inventory.jsonl`.
The inventory is the authoritative machine-readable artifact; this note only records the
release-relevant takeaways.

## Scope

- Full repository file sweep.
- Tracked and untracked files.
- Package eligibility against `scripts/package-source.sh` rules.
- Deep-read of project-owned docs, shell scripts, JSON, HTML, CSS, and JavaScript.

## Release-relevant findings

- The repo root is already aligned around the proof-only SDXL base exception.
- `operator-console/README.md`, `sdcpp-workflow/README.md`, and the bridge docs now describe
  bounded proof semantics instead of implying full SDXL parity.
- The packager still uses `git archive HEAD`, so the release bundle stays source-only.
- Runtime outputs, caches, model files, screenshots, and logs remain out of scope for commits.
- The full inventory currently contains 1,317 files total: 76 tracked source files and 1,241
  ignored/untracked local artifacts.
- The dominant non-source buckets are `.playwright-mcp/`, `Potential UI/`, proof artifacts, and
  other local cache/output files.

## Current risk posture

- Low for source packaging.
- Low for the proof-only bridge path.
- Residual risk remains in the historical handoff and Bible material, which intentionally keeps
  older context for traceability.
- The source package itself is clean because only tracked files are eligible and the packager
  rejects dirty trees by default.

## Files that matter most for future passes

- `docs/deep-audits/imagegen-ai-context-lock.md`
- `Image_Gen_Bible.md`
- `scripts/package-source.sh`
- `operator-console/server.js`
- `operator-console/public/app.js`
- `sdcpp-workflow/bin/sdcpp-model-stage-check.sh`
- `sdcpp-workflow/bin/sdcpp-sdxl-smoke.sh`
