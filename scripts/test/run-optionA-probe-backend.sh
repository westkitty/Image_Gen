#!/bin/bash
# Gate E only. Production storage, worker client owners and publication stay distinct.
set -euo pipefail
[[ "$(id -un)" == bigmac && "$(hostname -s)" == bigmac && "${OPERATOR_CONSOLE_PORT:-}" == 31347 ]]
: "${DEX_BACKEND_CONTROL:?Missing worker-supervisor control directory}"
internal=/Users/bigmac/DexDiffusion-OptionA-Test-internal
external=/Volumes/wc2tb/DexDiffusion-OptionA-Test
for dir in "$internal" "$external" "$external/state" "$external/runs"; do
  [[ -d "$dir" && ! -L "$dir" && "$(stat -f %u "$dir")" == "$(id -u)" ]] || exit 72
done
[[ "$(stat -f %d "$internal")" == "$(stat -f %d /Users/bigmac)" &&
   "$(stat -f %d "$external")" == "$(stat -f %d /Volumes/wc2tb)" ]] || exit 72
export HOME="$internal" TMPDIR="$internal/tmp"
export DEX_DATA_ROOT="$external" DEX_DATA_ROOT_MOUNT=/Volumes/wc2tb
export DEX_IMAGES_ROOT_OVERRIDE="$internal/images" DEX_STORAGE_MODE=external
export DEX_MACBOOK_IMAGES_URL=http://127.0.0.1:31348
export DEX_LOCAL_ENGINE_BRIDGE=1 DEX_LOCAL_ENGINE_DIRECT=1 DEX_OPTION_A_TEST=1
export DEX_CHAT_ENABLED=0
mkdir -p "$TMPDIR" "$DEX_IMAGES_ROOT_OVERRIDE"
cd "$(dirname "$0")/../../operator-console"
exec "$DEX_SUPERVISED_NODE" --require ../scripts/test/option-a-external-probe.js server.js
