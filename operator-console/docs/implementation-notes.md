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
