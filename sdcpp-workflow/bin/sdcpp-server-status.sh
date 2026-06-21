#!/usr/bin/env bash
# sdcpp-server-status.sh — report server/tunnel state. Never changes anything.
set -euo pipefail

HERE="$(cd "$(dirname "$0")" && pwd)"
# shellcheck source=./sdcpp-lib.sh
. "$HERE/sdcpp-lib.sh"

load_config

# Use current-ports.env if present (the live session), else config defaults.
RPORT="$REMOTE_SERVER_PORT"
LPORT="$LOCAL_TUNNEL_PORT"
SESSION=""
if [ -f "$SDCPP_STATE_DIR/current-ports.env" ]; then
  # shellcheck disable=SC1091
  . "$SDCPP_STATE_DIR/current-ports.env"
  RPORT="${REMOTE_SERVER_PORT:-$RPORT}"
  LPORT="${LOCAL_TUNNEL_PORT:-$LPORT}"
fi
if [ -f "$SDCPP_STATE_DIR/current-server-session" ]; then
  SESSION="$(cat "$SDCPP_STATE_DIR/current-server-session" 2>/dev/null || true)"
fi

SOCK="$(tunnel_socket_path)"

echo "==== SDCPP Server / Tunnel Status ===="
echo "Configured/active ports: remote=$RPORT local=$LPORT"
echo "Recorded session: ${SESSION:-<none>}"
echo

echo "-- Local tunnel port $LPORT --"
if lsof -nP -iTCP:"$LPORT" -sTCP:LISTEN 2>/dev/null; then
  LOCAL_UP=1
else
  echo "(not listening)"; LOCAL_UP=0
fi
echo

echo "-- Local SSH tunnel process evidence --"
ps aux | grep "[s]sh .*$LPORT:127.0.0.1:$RPORT.*$SSH_TARGET" || echo "(no matching ssh -L process)"
echo

echo "-- Control socket --"
if [ -S "$SOCK" ]; then
  if ssh -S "$SOCK" -O check "$SSH_TARGET" >/dev/null 2>&1; then
    echo "present + master ALIVE: $SOCK"
  else
    echo "present but NO master (stale): $SOCK"
  fi
else
  echo "(no control socket at $SOCK)"
fi
echo

echo "-- Remote server port $RPORT --"
REMOTE_LSOF="$(ssh_remote "lsof -nP -iTCP:$RPORT -sTCP:LISTEN" 2>/dev/null || true)"
if [ -n "$REMOTE_LSOF" ]; then
  echo "$REMOTE_LSOF"; REMOTE_UP=1
else
  echo "(not listening)"; REMOTE_UP=0
fi
echo

echo "-- Remote tmux session --"
# Note: this host's ssh masks remote exit codes, so use remote_test (sentinel).
if [ -n "$SESSION" ] && remote_test "tmux has-session -t '$SESSION' 2>/dev/null"; then
  echo "ALIVE: $SESSION"
  SESSION_UP=1
else
  echo "${SESSION:+$SESSION }not running"
  SESSION_UP=0
fi
echo

echo "-- Remote server log tail --"
if [ -n "${REMOTE_LOG:-}" ]; then
  ssh_remote "tail -15 \"$REMOTE_LOG\" 2>/dev/null" || echo "(no log at $REMOTE_LOG)"
else
  ssh_remote "ls -t \"$REMOTE_LOG_DIR\"/sd-server-*.log 2>/dev/null | head -1 | xargs -I{} sh -c 'echo {}; tail -15 {}'" 2>/dev/null || echo "(no server logs found)"
fi
echo

echo "-- Assessment --"
if [ "${REMOTE_UP:-0}" -eq 1 ] && [ "${LOCAL_UP:-0}" -eq 1 ]; then
  echo "Server + tunnel appear UP. Safe to GENERATE (bin/sdcpp-server-generate.sh)."
  echo "To stop: bin/sdcpp-server-stop.sh"
elif [ "${REMOTE_UP:-0}" -eq 0 ] && [ "${LOCAL_UP:-0}" -eq 0 ] && [ "${SESSION_UP:-0}" -eq 0 ]; then
  echo "Nothing running. Safe to START (bin/sdcpp-server-start.sh)."
else
  echo "Partial/mixed state. Inspect above; bin/sdcpp-server-stop.sh will safely close workflow-owned pieces only."
fi
exit 0
