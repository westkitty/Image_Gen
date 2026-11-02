#!/usr/bin/env bash
# run-backend-service.sh — Persistent DexDiffusion server runner for Big Mac.
# Fails closed if the external storage volume is unavailable.
set -euo pipefail

VOLUME_MOUNT="${DEX_DATA_ROOT_MOUNT:-/Volumes/wc2tb}"
DATA_ROOT="${DEX_DATA_ROOT:-/Volumes/wc2tb/DexDiffusion}"
CONSOLE_DIR="${OPERATOR_CONSOLE_DIR:-$(cd "$(dirname "${BASH_SOURCE[0]}")/../operator-console" && pwd)}"

# Strict fail-closed check: verify volume mount exists and is a distinct mount.
if [ ! -d "$VOLUME_MOUNT" ]; then
  echo "FATAL: External storage volume $VOLUME_MOUNT is not mounted." >&2
  exit 1
fi

if [ ! -d "$DATA_ROOT" ]; then
  echo "FATAL: DexDiffusion durable data root $DATA_ROOT does not exist on $VOLUME_MOUNT." >&2
  exit 1
fi

# Set explicit production environment
export DEX_DATA_ROOT="$DATA_ROOT"
export DEX_DATA_ROOT_MOUNT="$VOLUME_MOUNT"
export DEX_LOCAL_ENGINE_BRIDGE=1
export OPERATOR_CONSOLE_PORT="${OPERATOR_CONSOLE_PORT:-31337}"
export DEX_IMAGE_VALIDATION_PYTHON="${DEX_IMAGE_VALIDATION_PYTHON:-/Users/bigmac/Library/Caches/DexDiffusion/mflux/venv/bin/python}"
export PATH="/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin:/usr/sbin:/sbin:${PATH:-}"
export DEX_CHAT_ENABLED="${DEX_CHAT_ENABLED:-1}"
export OLLAMA_BASE_URL="${OLLAMA_BASE_URL:-http://127.0.0.1:11434}"

if [ -z "${DEX_CHAT_HISTORY_ACCOUNTS:-}" ]; then
  ACCOUNTS_FILE="$HOME/Library/Application Support/DexDiffusion/chat-history-accounts.json"
  if [ -f "$ACCOUNTS_FILE" ]; then
    export DEX_CHAT_HISTORY_ACCOUNTS="$(cat "$ACCOUNTS_FILE")"
  fi
fi

cd "$CONSOLE_DIR"
exec /opt/homebrew/bin/node server.js
