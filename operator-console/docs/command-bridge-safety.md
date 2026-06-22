# Command Bridge Safety Model

The Operator Console connects to the BigMac backend using an Express.js server functioning strictly as a command bridge.

## Allowlisted Endpoints
We do not expose a generic `/api/run` endpoint. Instead, explicit routes map to precise shell scripts:
- `POST /api/actions/generate-single` -> maps to `bin/sdcpp-run-fast.sh` / `bin/sdcpp-run-quality.sh` (for standard wrapper calls) or `bin/sdcpp-cli-generate.sh` / `bin/sdcpp-server-generate.sh` (for customized runs)
- `POST /api/actions/generate-batch` -> `bin/sdcpp-batch-generate.sh`
- `POST /api/actions/server-start` -> `bin/sdcpp-server-start.sh`
- `POST /api/actions/server-stop` -> `bin/sdcpp-server-stop.sh`
- `POST /api/actions/server-status` -> `bin/sdcpp-server-status.sh`
- `POST /api/actions/verify` -> `bin/sdcpp-verify.sh`
- `POST /api/actions/seed-test` -> `bin/sdcpp-seed-test.sh`
- `POST /api/actions/clean-old-runs` -> `bin/sdcpp-clean-old-runs.sh`
- `POST /api/actions/sdxl-smoke` -> `bin/sdcpp-sdxl-smoke.sh`

## Safe Execution
- Uses Node's `child_process.spawn`.
- `shell: false` is explicitly set to prevent injection and shell interpolation.
- Parameters (like `prompt`, `seed`, `steps`, `cfg_scale`, `width`, `height`, `sampler`) are validated against strict type/length boundaries and passed safely as distinct array elements, not concatenated strings.
- The SDXL smoke route is proof-only and uses a fixed prompt/model path; it does not accept user-controlled model paths.

## Forbidden Actions Enforced
The bridge physically lacks the code paths to execute:
- `rm -rf`
- `killall / pkill`
- `--backend metal`
- Editing configurations directly.

These safety boundaries are structurally enforced by the hardcoded route-to-script mapping.

## In-Memory Log Redaction
The Express bridge enforces privacy at the log level:
- It maintains an isolated, private in-memory log store of stdout/stderr outputs.
- Sensitive prompts and negative prompts are never written to `server.log` or console streams.
- A stream-level redaction filter `redactSensitiveText(text, sensitiveValues)` runs on all data buffers as they arrive from the child process stdout/stderr, replacing raw prompt text with `[REDACTED]` in memory.
- The raw prompt is never sent to the client in the `/api/jobs/:jobId` details payload.
