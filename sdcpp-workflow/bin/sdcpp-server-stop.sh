#!/usr/bin/env bash
# sdcpp-server-stop.sh — stop ONLY the workflow-owned server + tunnel.
# Never broad-kills. Never touches the unrelated Python on 7860.
set -euo pipefail

HERE="$(cd "$(dirname "$0")" && pwd)"
# shellcheck source=./sdcpp-lib.sh
. "$HERE/sdcpp-lib.sh"

load_config

RPORT="$REMOTE_SERVER_PORT"
LPORT="$LOCAL_TUNNEL_PORT"
if [ -f "$SDCPP_STATE_DIR/current-ports.env" ]; then
  # shellcheck disable=SC1091
  . "$SDCPP_STATE_DIR/current-ports.env"
  RPORT="${REMOTE_SERVER_PORT:-$RPORT}"
  LPORT="${LOCAL_TUNNEL_PORT:-$LPORT}"
fi

RUN_DIR="$(make_run_dir server-stop)"
SDCPP_LOGFILE="$RUN_DIR/server-stop.log"; export SDCPP_LOGFILE
REPORT="$RUN_DIR/server-stop-report.md"

log "=== Closing workflow SSH tunnel (control socket only) ==="
stop_tunnel

log "=== Killing workflow tmux session only ==="
stop_remote_server

log "=== Verifying shutdown ==="
LOCAL_STATE="closed"; REMOTE_STATE="closed"; SESSION_STATE="gone"
if lsof -nP -iTCP:"$LPORT" -sTCP:LISTEN >/dev/null 2>&1; then
  LOCAL_STATE="STILL LISTENING"
  log "WARN: local port $LPORT still listening:"
  lsof -nP -iTCP:"$LPORT" -sTCP:LISTEN >&2 || true
fi
if remote_test "lsof -nP -iTCP:$RPORT -sTCP:LISTEN >/dev/null 2>&1"; then
  REMOTE_STATE="STILL LISTENING"
  log "WARN: remote port $RPORT still listening:"
  ssh_remote "lsof -nP -iTCP:$RPORT -sTCP:LISTEN" >&2 || true
fi
SESSION="$(cat "$SDCPP_STATE_DIR/current-server-session" 2>/dev/null || true)"
if [ -n "$SESSION" ] && remote_test "tmux has-session -t '$SESSION' 2>/dev/null"; then
  SESSION_STATE="STILL RUNNING ($SESSION)"
fi

# Confirm we did NOT touch the unrelated 7860 occupant (report only).
P7860="$(ssh_remote "lsof -nP -iTCP:7860 -sTCP:LISTEN 2>/dev/null" || true)"

{
  echo "# SDCPP Server Stop Report"
  echo
  echo "- Timestamp: $(date)"
  echo "- local tunnel port $LPORT: $LOCAL_STATE"
  echo "- remote server port $RPORT: $REMOTE_STATE"
  echo "- tmux session: $SESSION_STATE"
  echo
  echo "## Unrelated port 7860 (must remain untouched)"
  echo '```'
  echo "${P7860:-(7860 not listening)}"
  echo '```'
  echo
  echo "## Result"
} > "$REPORT"

# clear local session marker if fully stopped
if [ "$LOCAL_STATE" = "closed" ] && [ "$REMOTE_STATE" = "closed" ] && [ "$SESSION_STATE" = "gone" ]; then
  rm -f "$SDCPP_STATE_DIR/current-server-session" 2>/dev/null || true
  echo "- SERVER STOP: PASS (all workflow pieces stopped)" >> "$REPORT"
  pass_banner "SERVER STOP PASS. Tunnel + server + session all down.
Report: $REPORT"
  exit 0
fi

echo "- SERVER STOP: PARTIAL (see evidence above)" >> "$REPORT"
printf '\n==== PARTIAL ====\nSome workflow pieces remain. Evidence in %s\n' "$REPORT" >&2
printf 'local=%s remote=%s session=%s\n' "$LOCAL_STATE" "$REMOTE_STATE" "$SESSION_STATE" >&2
exit 2
