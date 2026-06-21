#!/usr/bin/env bash
# sdcpp-verify.sh — verify proven state before any generation.
# Read-only: never kills, starts, generates, or dirties the repo.
set -euo pipefail

HERE="$(cd "$(dirname "$0")" && pwd)"
# shellcheck source=./sdcpp-lib.sh
. "$HERE/sdcpp-lib.sh"

load_config

RUN_DIR="$(make_run_dir verify)"
REPORT="$RUN_DIR/verify-report.md"
SDCPP_LOGFILE="$RUN_DIR/verify.log"
export SDCPP_LOGFILE

WARNINGS=()
warn() { WARNINGS+=("$*"); log "WARN: $*"; }

{
  echo "# SDCPP Verify Report"
  echo
  echo "- Timestamp: $(date)"
  echo "- Run dir: $RUN_DIR"
  echo
  echo "## Local tools"
} > "$REPORT"

log "=== Local tool checks ==="
for t in ssh scp jq base64 lsof file date; do
  require_local_tool "$t"
  record_run_report "$REPORT" "- $t: OK"
done
# shell sanity
record_run_report "$REPORT" "- shell: ${BASH_VERSION:-unknown bash}"
log "Local tools OK."

record_run_report "$REPORT" ""
record_run_report "$REPORT" "## Remote route / identity"

log "=== Remote route / identity ==="
HOST="$(verify_route)"
HOME_REMOTE="$(verify_remote_home)"
record_run_report "$REPORT" "- ssh target: $SSH_TARGET"
record_run_report "$REPORT" "- hostname: $HOST (expected $REMOTE_HOST_EXPECTED)"
record_run_report "$REPORT" "- remote HOME: $HOME_REMOTE"

# Hardware summary (informational)
HW="$(ssh_remote 'printf "cpu=%s; mem=%s bytes; model=%s\n" "$(sysctl -n machdep.cpu.brand_string 2>/dev/null)" "$(sysctl -n hw.memsize 2>/dev/null)" "$(system_profiler SPHardwareDataType 2>/dev/null | awk -F": " "/Model Name/{print \$2; exit}")"' 2>/dev/null || true)"
record_run_report "$REPORT" "- hardware: ${HW:-unavailable}"
log "Hardware: ${HW:-unavailable}"

record_run_report "$REPORT" ""
record_run_report "$REPORT" "## Remote build tools (informational; never auto-installed)"
log "=== Remote build tools (informational) ==="
for t in cmake git jq gtimeout; do
  if ssh_remote "command -v '$t' >/dev/null 2>&1"; then
    record_run_report "$REPORT" "- $t: present"
    log "remote tool $t: present"
  else
    record_run_report "$REPORT" "- $t: MISSING (not required at runtime; install manually if needed)"
    warn "remote tool '$t' missing (only needed for rebuilds / bounded ops)."
  fi
done

record_run_report "$REPORT" ""
record_run_report "$REPORT" "## Proven build + model state"
log "=== Repo / build / model ==="
HEAD="$(verify_repo_clean 7f0e728)"
record_run_report "$REPORT" "- repo: \$HOME/stable-diffusion.cpp HEAD=$HEAD, clean"
BUILD_DIR="$(get_build_dir)"
record_run_report "$REPORT" "- build dir: $BUILD_DIR"
verify_binaries "$BUILD_DIR"
record_run_report "$REPORT" "- sd-cli: OK"
record_run_report "$REPORT" "- sd-server: OK"
MODEL_SZ="$(verify_model)"
record_run_report "$REPORT" "- model: present ($MODEL_SZ bytes)"

# output/log dirs
ensure_remote_dirs
record_run_report "$REPORT" "- remote output dir: $(remote_eval_path "$REMOTE_OUTPUT_DIR")"
record_run_report "$REPORT" "- remote log dir: $(remote_eval_path "$REMOTE_LOG_DIR")"

record_run_report "$REPORT" ""
record_run_report "$REPORT" "## Ports (reported, never killed)"
log "=== Port checks (report only) ==="
if check_remote_port_free "$REMOTE_SERVER_PORT"; then
  record_run_report "$REPORT" "- remote server port $REMOTE_SERVER_PORT: FREE"
else
  record_run_report "$REPORT" "- remote server port $REMOTE_SERVER_PORT: OCCUPIED (see warnings; do NOT kill — choose another port)"
  warn "remote port $REMOTE_SERVER_PORT occupied; use --remote-port to pick a free one."
fi
if check_local_port_free "$LOCAL_TUNNEL_PORT"; then
  record_run_report "$REPORT" "- local tunnel port $LOCAL_TUNNEL_PORT: FREE"
else
  record_run_report "$REPORT" "- local tunnel port $LOCAL_TUNNEL_PORT: OCCUPIED (see warnings)"
  warn "local port $LOCAL_TUNNEL_PORT occupied; use --local-port to pick a free one."
fi

# Summary
record_run_report "$REPORT" ""
record_run_report "$REPORT" "## Result"
if [ "${#WARNINGS[@]}" -gt 0 ]; then
  record_run_report "$REPORT" "- Warnings:"
  for w in "${WARNINGS[@]}"; do record_run_report "$REPORT" "  - $w"; done
fi
record_run_report "$REPORT" "- VERIFY: PASS"

pass_banner "Verify PASS. All proven-state gates green.
Report: $REPORT"
if [ "${#WARNINGS[@]}" -gt 0 ]; then
  printf 'Warnings (%d):\n' "${#WARNINGS[@]}"
  for w in "${WARNINGS[@]}"; do printf '  - %s\n' "$w"; done
fi
exit 0
