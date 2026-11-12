#!/usr/bin/env bash
# Big Mac DexDiffusion backend: select ONE durable data root before Node starts.
# A mounted but unreadable wc2tb is just as unavailable as a missing volume.
set -euo pipefail

[ "$(/usr/bin/id -un)" = bigmac ] && [ "$(/bin/hostname -s)" = bigmac ] || {
  echo "FATAL: this service belongs to the Big Mac account on Big Mac only." >&2; exit 2;
}
VOLUME_MOUNT="${DEX_DATA_ROOT_MOUNT:-/Volumes/wc2tb}"
DATA_ROOT="${DEX_DATA_ROOT:-/Volumes/wc2tb/DexDiffusion}"
FALLBACK_ROOT="/Users/bigmac/DexDiffusion-InternalFallback"
CONSOLE_DIR="${OPERATOR_CONSOLE_DIR:-$(cd "$(dirname "${BASH_SOURCE[0]}")/../operator-console" && pwd)}"
if [[ "$VOLUME_MOUNT" != /Volumes/wc2tb || "$DATA_ROOT" != /Volumes/wc2tb/DexDiffusion ]]; then
  echo "FATAL: noncanonical storage override requires explicit operator configuration; not auto-failing-over." >&2
  exit 3
fi
if [[ ! -x /opt/homebrew/bin/gtimeout ]]; then
  echo "FATAL: bounded volume-read probe unavailable. Refusing unbounded disk access." >&2
  exit 4
fi

# The mount table alone is NOT evidence that APFS data is accessible. Never
# rely on unbounded stat/open/read on a potentially wedged USB device.
if /sbin/mount | /usr/bin/grep -F " on $VOLUME_MOUNT (" >/dev/null &&
   /opt/homebrew/bin/gtimeout -k 1s 3s /bin/ls -a "$DATA_ROOT/state" >/dev/null 2>&1 &&
   /opt/homebrew/bin/gtimeout -k 1s 3s /bin/ls -a "$DATA_ROOT/runs" >/dev/null 2>&1 &&
   /opt/homebrew/bin/gtimeout -k 1s 3s /bin/sh -c '[ ! -e "$1" ] || /usr/bin/head -c 1 "$1" >/dev/null' sh "$DATA_ROOT/state/jobs.json" >/dev/null 2>&1; then
  # The external SSD supplies models and durable job state, NEVER the final
  # image library. Generated images are short-lived Big Mac internal staging
  # files until the checksum-verified MacBook pull acknowledges them.
  IMAGE_STAGING="/Users/bigmac/DexDiffusion-PublicationStaging"
  [[ ! -L "$IMAGE_STAGING" ]] || { echo "FATAL: publication staging is a symlink" >&2; exit 8; }
  /bin/mkdir -p "$IMAGE_STAGING"
  [[ "$(/usr/bin/stat -f %d "$IMAGE_STAGING")" == "$(/usr/bin/stat -f %d /Users/bigmac)" ]] ||
    { echo "FATAL: publication staging is not on Big Mac internal storage" >&2; exit 9; }
  /bin/chmod 700 "$IMAGE_STAGING"
  export DEX_IMAGES_ROOT_OVERRIDE="$IMAGE_STAGING"
  export DEX_DATA_ROOT="$DATA_ROOT"
  export DEX_DATA_ROOT_MOUNT="$VOLUME_MOUNT"
  export DEX_STORAGE_MODE=external
  export DEX_STORAGE_REASON=external-readable
else
  # An isolated, named internal-root is not a silent fallback to /Volumes/*.
  # Never touch, migrate, purge or co-mingle external durable data on failover.
  [[ ! -L "$FALLBACK_ROOT" ]] || { echo "FATAL: internal fallback root is a symlink" >&2; exit 5; }
  /bin/mkdir -p "$FALLBACK_ROOT"
  [[ "$(/usr/bin/stat -f %d "$FALLBACK_ROOT")" == "$(/usr/bin/stat -f %d /Users/bigmac)" ]] ||
    { echo "FATAL: internal fallback root is not on Big Mac internal storage" >&2; exit 6; }
  for folder in state runs images scratch logs video output/audio/voice output/audio/music output/worlds; do
    candidate="$FALLBACK_ROOT/$folder"
    [[ ! -L "$candidate" ]] || { echo "FATAL: fallback subdirectory is a symlink: $folder" >&2; exit 7; }
    /bin/mkdir -p "$candidate"
  done
  /bin/chmod 700 "$FALLBACK_ROOT"
  # Ignore inherited per-writer overrides so no child silently writes to wc2tb.
  unset DEX_DATA_ROOT_MOUNT DEX_RUNS_DIR DEX_STATE_DIR DEX_IMAGES_ROOT_OVERRIDE
  unset DEX_MEDIA_ROOT_OVERRIDE DEX_SCRATCH_ROOT DEX_MASK_UPLOADS_DIR DEX_LOGS_DIR
  export DEX_DATA_ROOT="$FALLBACK_ROOT"
  export DEX_STORAGE_MODE=internal-fallback
  export DEX_STORAGE_REASON=external-unavailable-or-unreadable
  # The GUI engine worker owns an external-model registry. Use the existing
  # direct MFLUX/SDCPP routes until external storage is restored and restarted.
  export DEX_LOCAL_ENGINE_BRIDGE=0
  export DEX_CHAT_ENABLED=0
  unset DEX_MACBOOK_IMAGES_URL
  echo "DEXDIFFUSION_FALLBACK: wc2tb inaccessible; isolated Big Mac internal storage active" >&2
fi

export DEX_LOCAL_ENGINE_BRIDGE="${DEX_LOCAL_ENGINE_BRIDGE:-1}"
export OPERATOR_CONSOLE_PORT="${OPERATOR_CONSOLE_PORT:-31337}"
export DEX_IMAGE_VALIDATION_PYTHON="${DEX_IMAGE_VALIDATION_PYTHON:-/Users/bigmac/Library/Caches/DexDiffusion/mflux/venv/bin/python}"
export PATH="/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin:/usr/sbin:/sbin:${PATH:-}"
export DEX_CHAT_ENABLED="${DEX_CHAT_ENABLED:-1}"
export OLLAMA_BASE_URL="${OLLAMA_BASE_URL:-http://127.0.0.1:11434}"
if [[ -z "${DEX_CHAT_HISTORY_ACCOUNTS:-}" && "$DEX_STORAGE_MODE" == external ]]; then
  ACCOUNTS_FILE="$HOME/Library/Application Support/DexDiffusion/chat-history-accounts.json"
  if [[ -f "$ACCOUNTS_FILE" ]]; then export DEX_CHAT_HISTORY_ACCOUNTS="$(/bin/cat "$ACCOUNTS_FILE")"; fi
fi
cd "$CONSOLE_DIR"
exec /opt/homebrew/bin/node server.js
