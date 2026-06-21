#!/usr/bin/env bash
# sdcpp-server-start.sh — start a workflow-owned sd-server on BigMac + SSH tunnel.
# Never uses --backend metal. Never kills port occupants — reports and stops.
set -euo pipefail

HERE="$(cd "$(dirname "$0")" && pwd)"
# shellcheck source=./sdcpp-lib.sh
. "$HERE/sdcpp-lib.sh"

load_config

ARG_RPORT="$REMOTE_SERVER_PORT"
ARG_LPORT="$LOCAL_TUNNEL_PORT"
ARG_SESSION=""

usage() {
  cat <<EOF
Usage: $(basename "$0") [options]
  --remote-port N    BigMac sd-server port (default $REMOTE_SERVER_PORT)
  --local-port N     MacBook tunnel port  (default $LOCAL_TUNNEL_PORT)
  --session-name N   tmux session name (default sdcpp_sd15_<timestamp>)
  -h, --help
EOF
}

while [ "$#" -gt 0 ]; do
  case "$1" in
    --remote-port) ARG_RPORT="${2:?}"; shift 2 ;;
    --local-port) ARG_LPORT="${2:?}"; shift 2 ;;
    --session-name) ARG_SESSION="${2:?}"; shift 2 ;;
    -h|--help) usage; exit 0 ;;
    *) fail "args" "Unknown argument: $1 (see --help)" ;;
  esac
done

SESSION="${ARG_SESSION:-sdcpp_sd15_$(date +%Y%m%d_%H%M%S)}"
RUN_DIR="$(make_run_dir server-start)"
SDCPP_LOGFILE="$RUN_DIR/server-start.log"; export SDCPP_LOGFILE
REPORT="$RUN_DIR/server-start-report.md"
REMOTE_LOG="$REMOTE_LOG_DIR/sd-server-$SESSION.log"

log "=== Pre-flight verification ==="
verify_route >/dev/null
verify_repo_clean 7f0e728 >/dev/null
BUILD_DIR="$(get_build_dir)"
verify_binaries "$BUILD_DIR"
verify_model >/dev/null
ensure_remote_dirs
require_remote_tool tmux

log "=== Port availability (report, never kill) ==="
if ! check_remote_port_free "$ARG_RPORT"; then
  fail "remote-port" "Remote port $ARG_RPORT is occupied (do NOT kill it). Re-run with --remote-port <free port>."
fi
if ! check_local_port_free "$ARG_LPORT"; then
  fail "local-port" "Local port $ARG_LPORT is occupied. Re-run with --local-port <free port>."
fi

# Guard against an already-active workflow tunnel.
SOCK="$(tunnel_socket_path)"
if [ -S "$SOCK" ] && ssh -S "$SOCK" -O check "$SSH_TARGET" >/dev/null 2>&1; then
  fail "tunnel-exists" "A workflow tunnel is already active ($SOCK). Run sdcpp-server-stop.sh first."
fi

# ----- start server ----------------------------------------------------------
log "=== Starting sd-server (tmux session '$SESSION', remote port $ARG_RPORT) ==="
start_remote_server "$SESSION" "$ARG_RPORT" "$REMOTE_LOG"

# persist chosen ports
cat > "$SDCPP_STATE_DIR/current-ports.env" <<EOF
REMOTE_SERVER_PORT=$ARG_RPORT
LOCAL_TUNNEL_PORT=$ARG_LPORT
SESSION=$SESSION
REMOTE_LOG=$REMOTE_LOG
EOF

log "=== Waiting for remote listener on $ARG_RPORT ==="
if ! wait_remote_listener "$ARG_RPORT" 90; then
  log "Server did not start listening; recent log:"
  ssh_remote "tail -40 \"$REMOTE_LOG\"" >&2 || true
  # safe cleanup of the session we just started
  stop_remote_server || true
  fail "server-listen" "sd-server never listened on remote port $ARG_RPORT (see $REMOTE_LOG)."
fi
REMOTE_LISTEN="$(ssh_remote "lsof -nP -iTCP:$ARG_RPORT -sTCP:LISTEN" 2>/dev/null || true)"

# ----- start tunnel ----------------------------------------------------------
log "=== Creating SSH tunnel $ARG_LPORT -> 127.0.0.1:$ARG_RPORT ==="
start_tunnel "$ARG_LPORT" "$ARG_RPORT" >/dev/null
sleep 1
if ! check_local_port_free "$ARG_LPORT"; then
  LOCAL_LISTEN="$(lsof -nP -iTCP:"$ARG_LPORT" -sTCP:LISTEN 2>/dev/null || true)"
else
  stop_tunnel || true
  stop_remote_server || true
  fail "tunnel-listen" "Local tunnel port $ARG_LPORT is not listening after tunnel start."
fi

{
  echo "# SDCPP Server Start Report"
  echo
  echo "- Timestamp: $(date)"
  echo "- tmux session: $SESSION"
  echo "- remote port: $ARG_RPORT"
  echo "- local tunnel port: $ARG_LPORT"
  echo "- control socket: $SOCK"
  echo "- remote log: $REMOTE_LOG"
  echo
  echo "## Remote listener"
  echo '```'
  echo "$REMOTE_LISTEN"
  echo '```'
  echo "## Local tunnel listener"
  echo '```'
  echo "$LOCAL_LISTEN"
  echo '```'
  echo
  echo "## Result"
  echo "- SERVER START: PASS"
} > "$REPORT"

pass_banner "SERVER START PASS.
tmux session: $SESSION (remote port $ARG_RPORT)
tunnel:       127.0.0.1:$ARG_LPORT -> bigmac:$ARG_RPORT
Generate:     bin/sdcpp-server-generate.sh --prompt \"...\"
Stop:         bin/sdcpp-server-stop.sh
Report:       $REPORT"
exit 0
