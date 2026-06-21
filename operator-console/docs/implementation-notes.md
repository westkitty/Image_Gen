# Implementation Notes

## Architecture
- **No Build Step**: The frontend is strictly Vanilla JS to guarantee fast inspection and long-term durability. No Vite, Webpack, or React overhead.
- **Node API**: Small Express server required to securely bridge HTTP requests to local Bash executions.

## Data Parsing
The UI treats the `runs/` directory as its primary database.
- `/api/runs` scans `runs/` and sorts directories chronologically.
- It parses the YAML front matter inside `ui-run-card.md` using a lightweight regex (`/^---\n([\s\S]*?)\n---/`) to extract keys like `status`, `prompt`, and `primary_image`.
- This ensures the UI remains stateless, with the filesystem acting as the source of truth.

## Asynchronous Job Model
- To prevent browser timeouts during generation (which takes 15-30 seconds), commands are spawned as background jobs in Express.
- The UI immediately receives a `{ job_id }` and polls `/api/jobs/:jobId/log` to stream stdout/stderr.
- Once complete, `loadLatestRun()` triggers to parse the resulting Markdown artifacts.

## Prompt Privacy and Markdown/JSON Run Records

The backend owns run records. It emits Markdown and JSON files after generation so the UI can display verified outputs. By default, the Operator Console runs generation with prompt redaction enabled. Run records preserve status, image paths, seeds, presets, dimensions, timings, checksums, and verification data, but do not store full prompt text unless the user explicitly enables prompt saving. The UI does not use Markdown as frontend state, and UI preferences live in localStorage. Prompt text is not stored in localStorage.

## Source-Level Redaction
To prevent sensitive prompt text from ever leaking onto disk, the privacy model uses source-level redaction at write-time, rather than destructive post-generation scrubbing:
- When "Save prompts in run records" is OFF (default), Express sets environment variable `SDCPP_REDACT_PROMPTS=1` before spawning the generation jobs.
- The backend scripts (`sdcpp-cli-generate.sh`, `sdcpp-server-generate.sh`, `sdcpp-batch-generate.sh`) compute safe `REPORT_PROMPT` and `REPORT_NEGATIVE_PROMPT` variables set to `[REDACTED]`.
- All report generators, manifests, metrices, and image cards utilize these safe variables.
- On-the-fly stream filtering is applied via Python stream filters to scrub any output printed by third-party remote/server APIs before the stdout logs or JSON files are written to disk.

### Tokenizer token-array redaction (2026-06-20)
`sd-cli` run with `-v` (verbose) emits BPE tokenizer debug lines of the form
`split prompt "…" to tokens ["a</w>", "dog</w>", …]`. The token array fully
reconstructs the prompt even after the literal prompt string has been replaced with
`[REDACTED]`. A privacy canary (`PRIVACY_CANARY_DO_NOT_STORE_742913 a dog`) proved
this leak: the literal string was redacted, but the word-piece tokens persisted to
`runs/<id>/remote-stdout.log`. The in-stream Python filter in
`sdcpp-cli-generate.sh` was extended to also rewrite any `to tokens [...]` array to
`to tokens [REDACTED]` while redaction is active — at the stream, before the line is
written to disk (still source-level, not a post-run recursive scrub). A re-test with
`PRIVACY_CANARY_DO_NOT_STORE_842914 a dog` produced zero literal and zero token
fragments on disk. This path is reached by both `sdcpp-run-fast.sh` /
`sdcpp-run-quality.sh` (CLI mode) and direct `sdcpp-cli-generate.sh` calls. The
server-generate path captures only API JSON responses locally (no verbose tokenizer
output) and is unaffected.

## Gallery vs Run History
- **Gallery**: An image-first card-based grid showcasing only successful generation runs (`cli-generate`, `server-generate`, `batch-generate`). It maps thumbnails and display details clearly. Redacted prompts show "Prompt redacted".
- **Run History**: A technical table showing all runs (including backend verification, status logs, start/stop diagnostics, and seed tests) without fake thumbnails. It completely omits the prompt display if the run is redacted.

## Post-Generation Behavior
- By default, completing a generation job does not auto-shunt the viewport away to the details page. Instead, it updates the right preview pane with the generated image and metadata inline.
- An option "Auto-open Run Detail after generation" in Settings can be toggled on if the user prefers immediate navigation.
