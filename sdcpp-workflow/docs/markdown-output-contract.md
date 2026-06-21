# Markdown Output Contract

The workflow emits Markdown files that a UI can parse as a stable handoff API.
**Treat Markdown + JSON as the contract; do not scrape terminal text** unless
nothing else is available.

## Common rules for UI-facing Markdown
Every UI-facing Markdown file begins with YAML front matter and uses stable headings.
- Front matter is delimited by `---` lines at the very top.
- Values are double-quoted strings or bare numbers/booleans/`null`.
- All file references inside a run dir are **relative to that run dir**.
- Every run-level file carries `status` (`PASS` | `PARTIAL` | `FAIL`).
- Failures carry `first_failed_gate` (string) — `null` when none.
- Anything that touched the server carries `cleanup_state`
  (`not_applicable` | `stopped` | `server_left_running`).

## Front matter schemas
- `schema: sdcpp.run.v1` — run-level (cli/server/batch/seed-test) cards & reports.
- `schema: sdcpp.image.v1` — per-image records.

Run-level front matter (superset; single-image runs omit batch-only keys):
```yaml
---
schema: sdcpp.run.v1
run_id: "20260620-191500-batch"
run_type: "batch"            # cli | server-openai | server-sdapi | server-native | batch | seed-test
status: "PASS"               # PASS | PARTIAL | FAIL
created_at: "2026-06-20T19:15:00-0400"
mode: "cli"
preset: "fast"
prompt: "..."
negative_prompt: "..."
count: 3                     # batch only
verified_png_count: 3        # batch only
seed_mode: "increment"       # batch only
seed_start: 42               # batch only
manifest_json: "batch-manifest.json"
manifest_tsv: "batch-manifest.tsv"
primary_image: "images/image-001.png"
cleanup_state: "not_applicable"
first_failed_gate: null
---
```

## Files emitted

### 1. `batch-report.md`  (per batch run)
- Front matter: `sdcpp.run.v1`, `run_type: batch`.
- Headings: `## Status`, `## Settings`, `## Images`, `## Failures` (if any), `## Outputs`, `## Next action`.
- `## Images` is a Markdown table with relative PNG links.
- Authoritative machine data: `batch-manifest.json` (+ `.tsv`).

### 2. `ui-run-card.md`  (every run dir: cli, server, batch)
- Minimal UI summary card. Front matter: `sdcpp.run.v1`.
- Headings: `## Status`, `## Primary Image` (relative `![]()`), `## Prompt`, `## Settings`, `## Files`.
- `primary_image` front-matter key points to the image a UI should show first.

### 3. `records/image-###.md`  (per image in a batch)
- Front matter: `sdcpp.image.v1` (index, seed, status, settings, png_path, bytes, sha256).
- Headings: image embed, `## Prompt`, `## Settings`, `## Seed`, `## Verification`, `## Paths`, `## Notes`.
- Image link is relative to the record file (`../images/image-###.png`).

### 4. `benchmark-summary.md`  (from sdcpp-summarize-benchmarks.sh)
- Not a per-run card; an analysis doc. Headings: fastest verified, average elapsed table, ranked PASS cells, failures, recommendation. (No YAML front matter — it is a report, not a run card.)

### 5. `cli-run-report.md`  (per CLI generation)
- Detailed human report (remote/local verification, checksums, timing).
- The UI-facing summary for CLI runs is `ui-run-card.md`; this file is the deep detail.

### 6. `server-generate-report.md`  (per server generation)
- Per-API sections (OpenAI/SDAPI/Native) with request/decode seconds and verification.
- UI-facing summary is `ui-run-card.md`.

## JSON/TSV companions
- `batch-manifest.json` — `sdcpp.run.v1` with an `images[]` array (`sdcpp.image.v1`-shaped objects). **Primary machine source for batches.**
- `batch-manifest.tsv` — same rows, tab-separated, for quick parsing.
- `run-metadata.json` — per single CLI run.
- `metrics.tsv` — per run dir (canonical metrics columns; see performance-notes.md).

## Status semantics
- `PASS` — all requested images verified.
- `PARTIAL` — some verified, some failed (batch). `first_failed_gate` set.
- `FAIL` — zero verified.

## What "verified" means
A PNG is verified only after `file` reports `PNG image data` and size > 0 on the
MacBook. The UI should trust `status`/`sha256`/`bytes` from the manifest, which are
only written after that check.
