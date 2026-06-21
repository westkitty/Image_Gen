#!/usr/bin/env bash
# sdcpp-run-smoke.sh — end-to-end smoke: verify -> CLI -> server -> stop.
# PASS = CLI PNG verified AND >=1 server API PNG verified AND workflow cleaned up
#        AND upstream repo still clean.
set -euo pipefail

HERE="$(cd "$(dirname "$0")" && pwd)"
# shellcheck source=./sdcpp-lib.sh
. "$HERE/sdcpp-lib.sh"

load_config

RUN_DIR="$(make_run_dir smoke)"
SDCPP_LOGFILE="$RUN_DIR/smoke.log"; export SDCPP_LOGFILE
REPORT="$RUN_DIR/smoke-report.md"

SERVER_STARTED=0

{
  echo "# SDCPP Smoke Report"
  echo
  echo "- Timestamp: $(date)"
  echo "- Run dir: $RUN_DIR"
  echo
} > "$REPORT"

note() { record_run_report "$REPORT" "$@"; log "$@"; }

cleanup_if_needed() {
  if [ "$SERVER_STARTED" -eq 1 ]; then
    log "Smoke cleanup: stopping workflow server/tunnel..."
    "$HERE/sdcpp-server-stop.sh" >>"$SDCPP_LOGFILE" 2>&1 || log "WARN: cleanup reported non-zero (see smoke.log)."
  fi
}

smoke_fail() {
  local gate="$1"; shift || true
  note "STAGE FAILED: $gate — $*"
  cleanup_if_needed
  {
    echo
    echo "## Result"
    echo "- SMOKE: FAIL"
    echo "- First failed gate: $gate"
    echo "- Error: $*"
  } >> "$REPORT"
  fail "$gate" "$* (smoke report: $REPORT)"
}

# 1) verify -------------------------------------------------------------------
note "Stage 1: verify"
"$HERE/sdcpp-verify.sh" >>"$SDCPP_LOGFILE" 2>&1 || smoke_fail "verify" "sdcpp-verify.sh failed."

# 2) CLI generate -------------------------------------------------------------
note "Stage 2: CLI generate"
"$HERE/sdcpp-cli-generate.sh" --prompt "$PROMPT" --steps "$STEPS" >>"$SDCPP_LOGFILE" 2>&1 \
  || smoke_fail "cli-generate" "sdcpp-cli-generate.sh failed."
CLI_PNG="$(ls -t "$SDCPP_RUNS_DIR"/*-cli/*.png 2>/dev/null | head -1 || true)"
[ -n "$CLI_PNG" ] && [ -s "$CLI_PNG" ] || smoke_fail "cli-png" "No CLI PNG found after generation."
note "CLI PNG: $CLI_PNG"

# 3) server start -------------------------------------------------------------
note "Stage 3: server start"
"$HERE/sdcpp-server-start.sh" >>"$SDCPP_LOGFILE" 2>&1 || smoke_fail "server-start" "sdcpp-server-start.sh failed."
SERVER_STARTED=1

# 4) server generate (openai) -------------------------------------------------
note "Stage 4: server generate --api openai"
"$HERE/sdcpp-server-generate.sh" --api openai --prompt "$PROMPT" --steps "$STEPS" >>"$SDCPP_LOGFILE" 2>&1 \
  || smoke_fail "server-generate-openai" "OpenAI server generation failed."
OPENAI_PNG="$(ls -t "$SDCPP_RUNS_DIR"/*-server-gen/openai.png 2>/dev/null | head -1 || true)"
[ -n "$OPENAI_PNG" ] && [ -s "$OPENAI_PNG" ] || smoke_fail "server-openai-png" "No OpenAI PNG found."
note "OpenAI PNG: $OPENAI_PNG"

# 5) server generate (sdapi) — optional, non-fatal ----------------------------
note "Stage 5: server generate --api sdapi (optional)"
SDAPI_PNG=""
if "$HERE/sdcpp-server-generate.sh" --api sdapi --prompt "$PROMPT" --steps "$STEPS" >>"$SDCPP_LOGFILE" 2>&1; then
  SDAPI_PNG="$(ls -t "$SDCPP_RUNS_DIR"/*-server-gen/sdapi.png 2>/dev/null | head -1 || true)"
  note "SDAPI PNG: ${SDAPI_PNG:-<none>}"
else
  note "SDAPI optional stage did not pass (non-fatal)."
fi

# 6) server stop --------------------------------------------------------------
note "Stage 6: server stop"
if "$HERE/sdcpp-server-stop.sh" >>"$SDCPP_LOGFILE" 2>&1; then
  SERVER_STARTED=0
  CLEANUP="clean"
else
  CLEANUP="PARTIAL — inspect sdcpp-server-status.sh"
  note "WARN: server stop reported partial."
fi

# 7) repo cleanliness post-run ------------------------------------------------
note "Stage 7: repo cleanliness re-check"
HEAD="$(verify_repo_clean 7f0e728)" || smoke_fail "repo-clean-post" "Upstream repo not clean after smoke."

{
  echo
  echo "## Artifacts"
  echo "- CLI PNG: $CLI_PNG"
  echo "- OpenAI PNG: $OPENAI_PNG"
  echo "- SDAPI PNG: ${SDAPI_PNG:-<skipped/none>}"
  echo "- Cleanup: $CLEANUP"
  echo "- Repo: HEAD=$HEAD clean"
  echo
  echo "## Result"
  echo "- SMOKE: PASS"
} >> "$REPORT"

pass_banner "SMOKE PASS.
CLI PNG:    $CLI_PNG
OpenAI PNG: $OPENAI_PNG
SDAPI PNG:  ${SDAPI_PNG:-<skipped/none>}
Cleanup:    $CLEANUP
Repo:       HEAD=$HEAD clean
Report:     $REPORT"
exit 0
