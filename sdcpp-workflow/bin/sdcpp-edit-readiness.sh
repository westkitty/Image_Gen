#!/usr/bin/env bash
# Read-only prerequisites shared with the SDCPP Edit scripts.
set -euo pipefail
. "$(dirname "$0")/sdcpp-lib.sh"
# This probe owns no run directory, logs or publication state.
DEX_TOP_PID=
SDCPP_LOGFILE=
[ -f "$SDCPP_CONFIG_DIR/sdcpp.env" ] || fail config "Workflow configuration is missing."
. "$SDCPP_CONFIG_DIR/sdcpp.env"
verify_route >/dev/null
verify_repo_clean 7f0e728 >/dev/null
printf '%s\n' SDCPP_UPSTREAM_VERIFIED
build_dir="$(get_build_dir)"
verify_binaries "$build_dir"
verify_model >/dev/null
printf '%s\n' SDCPP_EDIT_PREFLIGHT_READY
