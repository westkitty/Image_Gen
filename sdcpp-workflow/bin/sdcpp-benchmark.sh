#!/usr/bin/env bash
# sdcpp-benchmark.sh — bounded benchmark matrix across presets and modes.
# Modes: cli (cold per call) and server-openai/server-sdapi (server started once
# = warm across presets). Verifies every PNG. Cleans up the workflow-owned
# server/tunnel unless --keep-server-running. Never native by default.
set -euo pipefail

HERE="$(cd "$(dirname "$0")" && pwd)"
# shellcheck source=./sdcpp-lib.sh
. "$HERE/sdcpp-lib.sh"

load_config

DEF_PROMPT="a cinematic photo of a cozy anarchist library inside a concrete building, warm lamplight, shelves of books, realistic texture"
DEF_NEG="blurry, low quality, distorted"

ARG_MODES="both"                 # cli | server-openai | server-sdapi | both
ARG_PRESETS="smoke,thumbnail,fast,balanced,quality"
ARG_REPEATS=1
ARG_PROMPT="$DEF_PROMPT"
ARG_NEG="$DEF_NEG"
ARG_SKIP_SERVER=0
ARG_KEEP=0
ARG_OUTDIR=""

usage() {
  cat <<EOF
Usage: $(basename "$0") [options]
  --modes M            cli | server-openai | server-sdapi | both   (default both = cli + server-openai)
  --presets a,b,c      comma list (default smoke,thumbnail,fast,balanced,quality)
  --repeats N          repeats per cell (default 1)
  --prompt "..."       benchmark prompt
  --negative "..."     benchmark negative
  --skip-server        CLI only; do not start a server
  --keep-server-running leave server+tunnel up at the end (reports evidence)
  --output-dir DIR     benchmark run dir (default runs/<ts>-benchmark)
  -h, --help
EOF
}

while [ "$#" -gt 0 ]; do
  case "$1" in
    --modes) ARG_MODES="${2:?}"; shift 2 ;;
    --presets) ARG_PRESETS="${2:?}"; shift 2 ;;
    --repeats) ARG_REPEATS="${2:?}"; shift 2 ;;
    --prompt) ARG_PROMPT="${2:?}"; shift 2 ;;
    --negative) ARG_NEG="${2:?}"; shift 2 ;;
    --skip-server) ARG_SKIP_SERVER=1; shift ;;
    --keep-server-running) ARG_KEEP=1; shift ;;
    --output-dir) ARG_OUTDIR="${2:?}"; shift 2 ;;
    -h|--help) usage; exit 0 ;;
    *) fail "args" "Unknown argument: $1 (see --help)" ;;
  esac
done

# Resolve mode list.
MODE_LIST=""
case "$ARG_MODES" in
  both) MODE_LIST="cli server-openai" ;;
  cli) MODE_LIST="cli" ;;
  server-openai) MODE_LIST="server-openai" ;;
  server-sdapi) MODE_LIST="server-sdapi" ;;
  *) fail "args" "--modes must be cli|server-openai|server-sdapi|both" ;;
esac
# A server is needed if any server-* mode is present and not skipped.
NEED_SERVER=0
case " $MODE_LIST " in *" server-openai "*|*" server-sdapi "*) NEED_SERVER=1 ;; esac
[ "$ARG_SKIP_SERVER" -eq 1 ] && { MODE_LIST="$(printf '%s\n' $MODE_LIST | grep -v '^server-' | tr '\n' ' ')"; NEED_SERVER=0; }
[ -n "$(printf '%s' "$MODE_LIST" | tr -d ' ')" ] || fail "args" "No modes left to run."

# Bound the matrix to keep things sane.
PRESET_COUNT="$(printf '%s' "$ARG_PRESETS" | tr ',' ' ' | wc -w | tr -d ' ')"
MODE_COUNT="$(printf '%s' "$MODE_LIST" | wc -w | tr -d ' ')"
TOTAL_CELLS=$(( PRESET_COUNT * MODE_COUNT * ARG_REPEATS ))
if [ "$TOTAL_CELLS" -gt 40 ]; then
  fail "matrix-bound" "Refusing to run $TOTAL_CELLS cells (>40). Narrow --presets/--modes/--repeats."
fi

# ----- run dir + verify ------------------------------------------------------
BENCH_DIR="${ARG_OUTDIR:-$SDCPP_RUNS_DIR/$(timestamp)-benchmark}"
mkdir -p "$BENCH_DIR"
SDCPP_LOGFILE="$BENCH_DIR/benchmark.log"; export SDCPP_LOGFILE
TSV="$BENCH_DIR/benchmark-results.tsv"
MD="$BENCH_DIR/benchmark-results.md"

log "=== Benchmark: modes=[$MODE_LIST] presets=[$ARG_PRESETS] repeats=$ARG_REPEATS cells=$TOTAL_CELLS ==="
log "=== Stage 0: verify ==="
"$HERE/sdcpp-verify.sh" >>"$SDCPP_LOGFILE" 2>&1 || fail "verify" "sdcpp-verify.sh failed; see $SDCPP_LOGFILE"

printf 'run_id\ttimestamp\tmode\tpreset\twidth\theight\tsteps\tcfg_scale\tsampler\trepeat\tstatus\telapsed_seconds\tpng_bytes\tpng_path\treport_path\tnotes\n' > "$TSV"

SERVER_STARTED=0
cleanup() {
  if [ "$SERVER_STARTED" -eq 1 ] && [ "$ARG_KEEP" -ne 1 ]; then
    log "Stopping workflow server/tunnel..."
    "$HERE/sdcpp-server-stop.sh" >>"$SDCPP_LOGFILE" 2>&1 || log "WARN: stop reported non-zero."
    SERVER_STARTED=0
  fi
}
trap 'cleanup' EXIT INT TERM

# ----- start server once if needed (warm across presets) ---------------------
if [ "$NEED_SERVER" -eq 1 ]; then
  log "=== Starting server once (warm across presets) ==="
  "$HERE/sdcpp-server-start.sh" >>"$SDCPP_LOGFILE" 2>&1 || fail "server-start" "Could not start server; see $SDCPP_LOGFILE"
  SERVER_STARTED=1
fi

# ----- helper: append one matrix row from a cell's metrics.tsv ----------------
append_row() {
  # append_row <run_id> <mode> <preset> <repeat> <cell_dir> <warm_state_unused>
  local run_id="$1" mode="$2" preset="$3" repeat="$4" cell="$5"
  local m="$cell/metrics.tsv" line status elapsed png bytes w h steps cfg sampler report notes
  if [ -f "$m" ] && [ "$(wc -l < "$m" | tr -d ' ')" -ge 2 ]; then
    line="$(tail -1 "$m")"
    w="$(printf '%s' "$line" | cut -f11)"
    h="$(printf '%s' "$line" | cut -f12)"
    steps="$(printf '%s' "$line" | cut -f13)"
    cfg="$(printf '%s' "$line" | cut -f14)"
    sampler="$(printf '%s' "$line" | cut -f15)"
    elapsed="$(printf '%s' "$line" | cut -f19)"
    png="$(printf '%s' "$line" | cut -f22)"
    bytes="$(printf '%s' "$line" | cut -f23)"
    status="$(printf '%s' "$line" | cut -f29)"
    notes="from-metrics"
  else
    # synthesize a FAIL row (script failed before writing metrics)
    apply_preset "$preset" >/dev/null 2>&1 || true
    w="${PRESET_W:-?}"; h="${PRESET_H:-?}"; steps="${PRESET_STEPS:-?}"; cfg="${PRESET_CFG:-?}"; sampler="${PRESET_SAMPLER:-?}"
    elapsed="n/a"; png=""; bytes="0"; status="FAIL"; notes="no-metrics(see benchmark.log)"
  fi
  report="$cell"
  printf '%s\t%s\t%s\t%s\t%s\t%s\t%s\t%s\t%s\t%s\t%s\t%s\t%s\t%s\t%s\t%s\n' \
    "$run_id" "$(date '+%Y-%m-%d %H:%M:%S')" "$mode" "$preset" "$w" "$h" "$steps" "$cfg" "$sampler" \
    "$repeat" "$status" "$elapsed" "$bytes" "$(sanitize_tsv "$png")" "$(sanitize_tsv "$report")" "$notes" >> "$TSV"
  log "cell $run_id: mode=$mode preset=$preset repeat=$repeat -> $status ${elapsed}s ${bytes}b"
}

# ----- run the matrix --------------------------------------------------------
OLD_IFS="$IFS"; IFS=','
for preset in $ARG_PRESETS; do
  IFS="$OLD_IFS"
  r=1
  while [ "$r" -le "$ARG_REPEATS" ]; do
    for mode in $MODE_LIST; do
      RUN_ID="${preset}__${mode}__r${r}"
      CELL="$BENCH_DIR/cells/$RUN_ID"
      mkdir -p "$CELL"
      log "--- running $RUN_ID ---"
      case "$mode" in
        cli)
          SDCPP_RUN_DIR_OVERRIDE="$CELL" "$HERE/sdcpp-cli-generate.sh" \
            --preset "$preset" --prompt "$ARG_PROMPT" --negative "$ARG_NEG" \
            >"$CELL/stdout.log" 2>&1 || true
          ;;
        server-openai)
          SDCPP_RUN_DIR_OVERRIDE="$CELL" "$HERE/sdcpp-server-generate.sh" \
            --preset "$preset" --api openai --warm-state warm \
            --prompt "$ARG_PROMPT" --negative "$ARG_NEG" \
            >"$CELL/stdout.log" 2>&1 || true
          ;;
        server-sdapi)
          SDCPP_RUN_DIR_OVERRIDE="$CELL" "$HERE/sdcpp-server-generate.sh" \
            --preset "$preset" --api sdapi --warm-state warm \
            --prompt "$ARG_PROMPT" --negative "$ARG_NEG" \
            >"$CELL/stdout.log" 2>&1 || true
          ;;
      esac
      append_row "$RUN_ID" "$mode" "$preset" "$r" "$CELL"
    done
    r=$((r + 1))
  done
  IFS=','
done
IFS="$OLD_IFS"

# ----- stop server (unless keeping) ------------------------------------------
KEEP_NOTE="server not started"
if [ "$NEED_SERVER" -eq 1 ]; then
  if [ "$ARG_KEEP" -eq 1 ]; then
    KEEP_NOTE="SERVER LEFT RUNNING by request"
    trap - EXIT INT TERM
    LPORT_NOW="$(. "$SDCPP_STATE_DIR/current-ports.env" 2>/dev/null; printf '%s' "${LOCAL_TUNNEL_PORT:-}")"
  else
    cleanup
    trap - EXIT INT TERM
    KEEP_NOTE="server+tunnel stopped"
  fi
fi

# ----- results markdown ------------------------------------------------------
PASS_N="$(awk -F'\t' 'NR>1 && $11=="PASS"{c++} END{print c+0}' "$TSV")"
FAIL_N="$(awk -F'\t' 'NR>1 && $11!="PASS"{c++} END{print c+0}' "$TSV")"
{
  echo "# Benchmark Results"
  echo
  echo "- Timestamp: $(date)"
  echo "- Modes: $MODE_LIST"
  echo "- Presets: $ARG_PRESETS"
  echo "- Repeats: $ARG_REPEATS"
  echo "- Cells: $TOTAL_CELLS (PASS=$PASS_N FAIL=$FAIL_N)"
  echo "- Prompt: $ARG_PROMPT"
  echo "- Server: $KEEP_NOTE"
  echo
  echo "| mode | preset | size | steps | repeat | status | elapsed_s | png_bytes |"
  echo "|------|--------|------|-------|--------|--------|-----------|-----------|"
  awk -F'\t' 'NR>1 {printf "| %s | %s | %sx%s | %s | %s | %s | %s | %s |\n",$3,$4,$5,$6,$7,$10,$11,$12,$13}' "$TSV"
  echo
  echo "TSV: $TSV"
  echo
  echo "Summarize with: bin/sdcpp-summarize-benchmarks.sh \"$TSV\""
} > "$MD"

if [ "$ARG_KEEP" -eq 1 ] && [ "$NEED_SERVER" -eq 1 ]; then
  {
    echo
    echo "## Server LEFT RUNNING (by --keep-server-running)"
    echo '```'
    echo "Local tunnel:"; lsof -nP -iTCP:"${LPORT_NOW:-17870}" -sTCP:LISTEN 2>/dev/null || echo "(no local listener?)"
    echo "Stop with: bin/sdcpp-server-stop.sh"
    echo '```'
  } >> "$MD"
fi

if [ "$FAIL_N" -eq 0 ]; then
  pass_banner "BENCHMARK PASS ($PASS_N/$TOTAL_CELLS cells).
Benchmark dir: $BENCH_DIR
Results:       $MD
TSV:           $TSV
Server:        $KEEP_NOTE
Summarize:     bin/sdcpp-summarize-benchmarks.sh \"$TSV\""
  exit 0
fi
printf '\n==== BENCHMARK COMPLETED WITH FAILURES ====\nPASS=%s FAIL=%s\nResults: %s\n' "$PASS_N" "$FAIL_N" "$MD" >&2
exit 1
