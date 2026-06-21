#!/usr/bin/env bash
# sdcpp-run-quality.sh — one-command QUALITY generation (preset: quality, 20 steps).
# Default --mode both: CLI quality + warm server OpenAI quality for comparison.
set -euo pipefail

HERE="$(cd "$(dirname "$0")" && pwd)"
# shellcheck source=./sdcpp-lib.sh
. "$HERE/sdcpp-lib.sh"

load_config

MODE="both"
ARG_PROMPT="$PROMPT"
ARG_NEG="$NEGATIVE_PROMPT"
ARG_SEED=""
OPEN=0
KEEP=0

usage() {
  cat <<EOF
Usage: $(basename "$0") [options]
  --mode cli|server|both   (default both)
  --prompt "..."           prompt
  --negative "..."         negative
  --seed N|random|fixed    seed control (passed through)
  --open                   open a resulting PNG (macOS)
  --keep-server-running    leave server up after (server/both modes)
  -h, --help
EOF
}

while [ "$#" -gt 0 ]; do
  case "$1" in
    --mode) MODE="${2:?}"; shift 2 ;;
    --prompt) ARG_PROMPT="${2:?}"; shift 2 ;;
    --negative) ARG_NEG="${2:?}"; shift 2 ;;
    --seed) ARG_SEED="${2:?}"; shift 2 ;;
    --open) OPEN=1; shift ;;
    --keep-server-running) KEEP=1; shift ;;
    -h|--help) usage; exit 0 ;;
    *) fail "args" "Unknown argument: $1 (see --help)" ;;
  esac
done
case "$MODE" in cli|server|both) : ;; *) fail "args" "--mode must be cli|server|both" ;; esac
SEED_ARGS=""; [ -n "$ARG_SEED" ] && SEED_ARGS="--seed $ARG_SEED"

CLI_PNG=""; SRV_PNG=""

run_cli() {
  local out
  out="$("$HERE/sdcpp-cli-generate.sh" --preset quality --prompt "$ARG_PROMPT" --negative "$ARG_NEG" $SEED_ARGS)" \
    || fail "quality-cli" "quality CLI generation failed."
  printf '%s\n' "$out"
  CLI_PNG="$(printf '%s\n' "$out" | sed -n 's/^Local PNG: //p' | head -1)"
}

run_server() {
  local LPORT="$LOCAL_TUNNEL_PORT" WE_STARTED=0 out rd
  [ -f "$SDCPP_STATE_DIR/current-ports.env" ] && { . "$SDCPP_STATE_DIR/current-ports.env"; LPORT="${LOCAL_TUNNEL_PORT:-$LPORT}"; }
  if ! lsof -nP -iTCP:"$LPORT" -sTCP:LISTEN >/dev/null 2>&1; then
    log "No tunnel on $LPORT; starting server..."
    "$HERE/sdcpp-server-start.sh" >/dev/null || fail "quality-server-start" "server start failed."
    WE_STARTED=1
  else
    log "Reusing existing tunnel on $LPORT."
  fi
  cleanup() { if [ "$WE_STARTED" -eq 1 ] && [ "$KEEP" -ne 1 ]; then "$HERE/sdcpp-server-stop.sh" >/dev/null 2>&1 || true; fi; }
  trap 'cleanup' EXIT INT TERM
  out="$("$HERE/sdcpp-server-generate.sh" --preset quality --api openai --warm-state warm --prompt "$ARG_PROMPT" --negative "$ARG_NEG" $SEED_ARGS)" \
    || { cleanup; trap - EXIT INT TERM; fail "quality-server-gen" "quality server generation failed."; }
  printf '%s\n' "$out"
  rd="$(printf '%s\n' "$out" | sed -n 's/^Run dir: //p' | head -1)"
  SRV_PNG="$rd/openai.png"
  cleanup; trap - EXIT INT TERM
  if [ "$KEEP" -eq 1 ] && [ "$WE_STARTED" -eq 1 ]; then
    echo "NOTE: server left running (--keep-server-running). Stop with: bin/sdcpp-server-stop.sh"
  fi
}

case "$MODE" in
  cli) run_cli ;;
  server) run_server ;;
  both) run_cli; run_server ;;
esac

echo
echo "==== QUALITY RESULTS ===="
[ -n "$CLI_PNG" ] && echo "CLI quality PNG:    $CLI_PNG"
[ -n "$SRV_PNG" ] && echo "Server quality PNG: $SRV_PNG"

OPEN_TARGET="${SRV_PNG:-$CLI_PNG}"
[ -n "$OPEN_TARGET" ] && [ -f "$OPEN_TARGET" ] || fail "quality-png" "No verified quality PNG produced."
if [ "$OPEN" -eq 1 ] && command -v open >/dev/null 2>&1; then open "$OPEN_TARGET" || true; fi
exit 0
