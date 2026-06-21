# Command Bridge Safety Model

The Operator Console connects to the BigMac backend using an Express.js server functioning strictly as a command bridge.

## Allowlisted Endpoints
We do not expose a generic `/api/run` endpoint. Instead, explicit routes map to precise shell scripts:
- `POST /api/actions/generate-fast` -> `bin/sdcpp-run-fast.sh`
- `POST /api/actions/generate-batch` -> `bin/sdcpp-batch-generate.sh`
- `POST /api/actions/server-start` -> `bin/sdcpp-server-start.sh`

## Safe Execution
- Uses Node's `child_process.spawn`.
- `shell: false` is explicitly set to prevent injection and shell interpolation.
- Parameters (like `prompt`, `seed`) are passed safely as distinct array elements, not concatenated strings.

## Forbidden Actions Enforced
The bridge physically lacks the code paths to execute:
- `rm -rf`
- `killall / pkill`
- `--backend metal`
- Editing configurations directly.

These safety boundaries are structurally enforced by the hardcoded route-to-script mapping.
