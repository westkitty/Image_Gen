#!/usr/bin/env bash
# sdcpp-run-fast.sh — one-command FAST generation for daily use (preset: fast).
# CLI by default; --mode server starts/uses a warm server and stops it after
# (unless --keep-server-running). Verifies the PNG; --open shows it.
set -euo pipefail

HERE="$(cd "$(dirname "$0")" && pwd)"
# shellcheck source=./sdcpp-lib.sh
. "$HERE/sdcpp-lib.sh"

load_config

MODE="cli"
ARG_PROMPT="$PROMPT"
ARG_NEG="$NEGATIVE_PROMPT"
ARG_SEED=""
OPEN=0
KEEP=0

usage() {
  cat <<EOF
Usage: $(basename "$0") [options]
  --mode cli|server     (default cli)
  --prompt "..."        prompt
  --negative "..."      negative
  --seed N|random|fixed seed control (passed through)
  --open                open the PNG when done (macOS)
  --keep-server-running (server mode) leave server up after
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
case "$MODE" in cli|server) : ;; *) fail "args" "--mode must be cli|server" ;; esac
SEED_ARGS=""; [ -n "$ARG_SEED" ] && SEED_ARGS="--seed $ARG_SEED"

PNG=""
if [ "$MODE" = "cli" ]; then
  OUT="$("$HERE/sdcpp-cli-generate.sh" --preset fast --prompt "$ARG_PROMPT" --negative "$ARG_NEG" $SEED_ARGS)" || fail "fast-cli" "fast CLI generation failed."
  printf '%s\n' "$OUT"
  PNG="$(printf '%s\n' "$OUT" | sed -n 's/^Local PNG: //p' | head -1)"
else
  LPORT="$LOCAL_TUNNEL_PORT"
  [ -f "$SDCPP_STATE_DIR/current-ports.env" ] && { . "$SDCPP_STATE_DIR/current-ports.env"; LPORT="${LOCAL_TUNNEL_PORT:-$LPORT}"; }
  WE_STARTED=0
  if ! lsof -nP -iTCP:"$LPORT" -sTCP:LISTEN >/dev/null 2>&1; then
    log "No tunnel on $LPORT; starting server..."
    "$HERE/sdcpp-server-start.sh" >/dev/null || fail "fast-server-start" "server start failed."
    WE_STARTED=1
  else
    log "Reusing existing tunnel on $LPORT."
  fi
  cleanup() { if [ "$WE_STARTED" -eq 1 ] && [ "$KEEP" -ne 1 ]; then "$HERE/sdcpp-server-stop.sh" >/dev/null 2>&1 || true; fi; }
  trap 'cleanup' EXIT INT TERM
  OUT="$("$HERE/sdcpp-server-generate.sh" --preset fast --api openai --warm-state warm --prompt "$ARG_PROMPT" --negative "$ARG_NEG" $SEED_ARGS)" \
    || { cleanup; trap - EXIT INT TERM; fail "fast-server-gen" "fast server generation failed."; }
  printf '%s\n' "$OUT"
  RD="$(printf '%s\n' "$OUT" | sed -n 's/^Run dir: //p' | head -1)"
  PNG="$RD/openai.png"
  cleanup; trap - EXIT INT TERM
  if [ "$KEEP" -eq 1 ] && [ "$WE_STARTED" -eq 1 ]; then
    echo "NOTE: server left running (--keep-server-running). Stop with: bin/sdcpp-server-stop.sh"
  fi
fi

[ -n "$PNG" ] && [ -f "$PNG" ] || fail "fast-png" "No verified PNG produced."
echo "FAST PNG: $PNG"
if [ "$OPEN" -eq 1 ] && command -v open >/dev/null 2>&1; then open "$PNG" || true; fi
exit 0
