#!/bin/bash
# wc2tb-emergency-internal-fallback-rollback-v1: start the corrected baseline
# (c7708e4) in isolated internal-fallback mode with the pinned Node runtime.
# Defaults are the production rollback; ROLLBACK_DATA_ROOT/ROLLBACK_PORT exist
# only for disposable proof runs. Never stops or adopts any other process.
set -euo pipefail
[[ "$(/usr/bin/id -un)" == bigmac && "$(/bin/hostname -s)" == bigmac ]] || { echo "FATAL: Big Mac bigmac only" >&2; exit 2; }
PKG="/Users/bigmac/Library/Application Support/DexDiffusion/wc2tb-fallback-rollback-v1"
NODE="/Users/bigmac/Library/Application Support/DexDiffusion/wc2tb-recovery-runtime/node/bin/node"
SRC="$PKG/source"
ROOT="${ROLLBACK_DATA_ROOT:-/Users/bigmac/DexDiffusion-InternalFallback}"
PORT="${ROLLBACK_PORT:-31337}"
NODE_SHA=266dec4dce3a6cdcf5cdc38722a00cf5ae6a12cc51068d2a227655bbb75751ec
UI_SHA=44e7e73974642c1c71b57592c61a078b40415f0a931ab90bce1c0798030577e8
[[ "$(/usr/bin/shasum -a 256 "$NODE" | /usr/bin/cut -d' ' -f1)" == "$NODE_SHA" ]] || { echo "FATAL: pinned Node hash mismatch" >&2; exit 10; }
[[ "$(/bin/cat "$PKG/SOURCE_COMMIT")" == c7708e4a40edff156cbaaccda7f6299088c0f306 ]] || { echo "FATAL: source commit marker" >&2; exit 11; }
[[ "$(/usr/bin/shasum -a 256 "$SRC/operator-console/public/dexdiffusion/edit-ui.js" | /usr/bin/cut -d' ' -f1)" == "$UI_SHA" ]] || { echo "FATAL: edit-ui hash" >&2; exit 11; }
for dep in express three @sparkjsdev/spark; do [[ -f "$SRC/operator-console/node_modules/$dep/package.json" ]] || { echo "FATAL: dependency $dep missing" >&2; exit 12; }; done
if /usr/sbin/lsof -nP -iTCP:"$PORT" -sTCP:LISTEN >/dev/null 2>&1; then echo "FATAL: port $PORT already has a listener; stop it through its owner first" >&2; exit 13; fi
[[ ! -L "$ROOT" ]] || { echo "FATAL: fallback root is a symlink" >&2; exit 5; }
/bin/mkdir -p "$ROOT"
[[ "$(/usr/bin/stat -f %d "$ROOT")" == "$(/usr/bin/stat -f %d /Users/bigmac)" ]] || { echo "FATAL: fallback root not on Big Mac internal storage" >&2; exit 6; }
for folder in state runs images scratch logs video output/audio/voice output/audio/music output/worlds; do
  [[ ! -L "$ROOT/$folder" ]] || { echo "FATAL: fallback subdirectory is a symlink: $folder" >&2; exit 7; }
  /bin/mkdir -p "$ROOT/$folder"
done
/bin/chmod 700 "$ROOT"
/bin/mkdir -p "$PKG/logs"
LOG="$PKG/logs/backend-$(/bin/date +%Y%m%dT%H%M%S)-$PORT.log"
/usr/bin/env -i HOME=/Users/bigmac PATH=/usr/bin:/bin:/usr/sbin:/sbin \
  DEX_DATA_ROOT="$ROOT" DEX_STORAGE_MODE=internal-fallback DEX_STORAGE_REASON=emergency-rollback-v1 \
  DEX_LOCAL_ENGINE_BRIDGE=0 DEX_CHAT_ENABLED=0 OPERATOR_CONSOLE_PORT="$PORT" \
  DEX_AUTHORIZED_TAILSCALE_USERS=westkitty,bcroc \
  DEX_IMAGE_VALIDATION_PYTHON=/Users/bigmac/Library/Caches/DexDiffusion/mflux/venv/bin/python \
  /usr/bin/python3 "$SRC/scripts/detach-process.py" "$SRC/operator-console" "$LOG" "$NODE" server.js
for _ in $(/usr/bin/seq 1 40); do
  if out="$(/usr/bin/curl -fsS --max-time 2 "http://127.0.0.1:$PORT/api/version" 2>/dev/null)"; then
    echo "ROLLBACK_READY port=$PORT log=$LOG version=$out"; exit 0
  fi
  /bin/sleep 0.5
done
echo "FATAL: rollback backend did not answer within 20s; log=$LOG" >&2
exit 14
