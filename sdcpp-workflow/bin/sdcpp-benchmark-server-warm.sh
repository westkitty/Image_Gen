#!/usr/bin/env bash
# sdcpp-benchmark-server-warm.sh — measure WARM server throughput separately
# from startup cost. Starts the server once, times startup, then runs a fixed
# request sequence (smoke, fast x2, balanced, quality) via OpenAI, optionally a
# SDAPI comparison, then stops the server. Reports startup vs per-request times.
set -euo pipefail

HERE="$(cd "$(dirname "$0")" && pwd)"
# shellcheck source=./sdcpp-lib.sh
. "$HERE/sdcpp-lib.sh"

load_config

DEF_PROMPT="a cinematic photo of a cozy anarchist library inside a concrete building, warm lamplight, shelves of books, realistic texture"
DEF_NEG="blurry, low quality, distorted"
ARG_PROMPT="$DEF_PROMPT"
ARG_NEG="$DEF_NEG"
INCLUDE_SDAPI=0
KEEP=0

usage() {
  cat <<EOF
Usage: $(basename "$0") [options]
  --prompt "..."       prompt (default cinematic library)
  --negative "..."     negative
  --include-sdapi      also run one SDAPI request for comparison
  --keep-server-running leave server up (reports evidence)
  -h, --help
EOF
}

while [ "$#" -gt 0 ]; do
  case "$1" in
    --prompt) ARG_PROMPT="${2:?}"; shift 2 ;;
    --negative) ARG_NEG="${2:?}"; shift 2 ;;
    --include-sdapi) INCLUDE_SDAPI=1; shift ;;
    --keep-server-running) KEEP=1; shift ;;
    -h|--help) usage; exit 0 ;;
    *) fail "args" "Unknown argument: $1 (see --help)" ;;
  esac
done

BENCH_DIR="$SDCPP_RUNS_DIR/$(timestamp)-benchmark-warm"
mkdir -p "$BENCH_DIR/cells"
SDCPP_LOGFILE="$BENCH_DIR/warm.log"; export SDCPP_LOGFILE
TSV="$BENCH_DIR/warm-results.tsv"
MD="$BENCH_DIR/warm-report.md"

printf 'seq\tpreset\tapi\tstatus\telapsed_seconds\tpng_bytes\tpng_path\n' > "$TSV"

log "=== Warm benchmark: verify ==="
"$HERE/sdcpp-verify.sh" >>"$SDCPP_LOGFILE" 2>&1 || fail "verify" "verify failed; see $SDCPP_LOGFILE"

SERVER_STARTED=0
cleanup() {
  if [ "$SERVER_STARTED" -eq 1 ] && [ "$KEEP" -ne 1 ]; then
    "$HERE/sdcpp-server-stop.sh" >>"$SDCPP_LOGFILE" 2>&1 || log "WARN: stop non-zero."
    SERVER_STARTED=0
  fi
}
trap 'cleanup' EXIT INT TERM

# ----- start server once, timing startup (includes model load) ---------------
log "=== Starting server (timing startup/load) ==="
T0="$(now_epoch)"
"$HERE/sdcpp-server-start.sh" >>"$SDCPP_LOGFILE" 2>&1 || fail "server-start" "server start failed; see $SDCPP_LOGFILE"
T1="$(now_epoch)"
SERVER_STARTED=1
STARTUP="$(elapsed_seconds "$T0" "$T1")"
log "Server startup/load: ${STARTUP}s"

run_req() {
  # run_req <seq> <preset> <api>
  local seq="$1" preset="$2" api="$3"
  local cell="$BENCH_DIR/cells/${seq}_${preset}_${api}"
  mkdir -p "$cell"
  SDCPP_RUN_DIR_OVERRIDE="$cell" "$HERE/sdcpp-server-generate.sh" \
    --preset "$preset" --api "$api" --warm-state warm \
    --prompt "$ARG_PROMPT" --negative "$ARG_NEG" >"$cell/stdout.log" 2>&1 || true
  local m="$cell/metrics.tsv" status elapsed png bytes
  if [ -f "$m" ] && [ "$(wc -l < "$m" | tr -d ' ')" -ge 2 ]; then
    local line; line="$(tail -1 "$m")"
    elapsed="$(printf '%s' "$line" | cut -f19)"
    png="$(printf '%s' "$line" | cut -f22)"
    bytes="$(printf '%s' "$line" | cut -f23)"
    status="$(printf '%s' "$line" | cut -f29)"
  else
    elapsed="n/a"; png=""; bytes="0"; status="FAIL"
  fi
  printf '%s\t%s\t%s\t%s\t%s\t%s\t%s\n' "$seq" "$preset" "$api" "$status" "$elapsed" "$bytes" "$(sanitize_tsv "$png")" >> "$TSV"
  log "req $seq: $preset/$api -> $status ${elapsed}s"
}

# ----- fixed warm sequence (OpenAI) ------------------------------------------
run_req 1 smoke    openai
run_req 2 fast     openai
run_req 3 fast     openai
run_req 4 balanced openai
run_req 5 quality  openai
if [ "$INCLUDE_SDAPI" -eq 1 ]; then
  run_req 6 fast sdapi
fi

# ----- stop server (unless keeping) ------------------------------------------
if [ "$KEEP" -eq 1 ]; then
  trap - EXIT INT TERM
  LPORT_NOW="$(. "$SDCPP_STATE_DIR/current-ports.env" 2>/dev/null; printf '%s' "${LOCAL_TUNNEL_PORT:-17870}")"
else
  cleanup
  trap - EXIT INT TERM
fi

# ----- compute summary --------------------------------------------------------
FIRST_REQ="$(awk -F'\t' 'NR==2{print $5}' "$TSV")"
FAIL_N="$(awk -F'\t' 'NR>1 && $4!="PASS"{c++} END{print c+0}' "$TSV")"
# average per preset (openai only), numeric elapsed only
avg_for() { awk -F'\t' -v p="$1" 'NR>1 && $2==p && $3=="openai" && $5+0==$5 {s+=$5;n++} END{if(n)printf "%.2f",s/n; else printf "n/a"}' "$TSV"; }
AVG_SMOKE="$(avg_for smoke)"; AVG_FAST="$(avg_for fast)"; AVG_BAL="$(avg_for balanced)"; AVG_QUAL="$(avg_for quality)"

# fastest verified preset (min elapsed among PASS openai)
FASTEST="$(awk -F'\t' 'NR>1 && $4=="PASS" && $3=="openai" && $5+0==$5 {print $5"\t"$2}' "$TSV" | sort -n | head -1 | cut -f2)"
# recommended default: prefer 'fast' if it passed; else 'smoke'
REC="smoke"
if awk -F'\t' 'NR>1 && $2=="fast" && $4=="PASS"{f=1} END{exit !f}' "$TSV"; then REC="fast"; fi

{
  echo "# Warm Server Benchmark"
  echo
  echo "- Timestamp: $(date)"
  echo "- Prompt: $ARG_PROMPT"
  echo "- Server startup/load time: ${STARTUP}s"
  echo "- First request (cold model already loaded, first HTTP): ${FIRST_REQ}s"
  echo "- Failures: $FAIL_N"
  echo
  echo "## Per-request (warm)"
  echo "| seq | preset | api | status | elapsed_s | png_bytes |"
  echo "|-----|--------|-----|--------|-----------|-----------|"
  awk -F'\t' 'NR>1 {printf "| %s | %s | %s | %s | %s | %s |\n",$1,$2,$3,$4,$5,$6}' "$TSV"
  echo
  echo "## Average request time by preset (OpenAI, warm)"
  echo "- smoke:    ${AVG_SMOKE}s"
  echo "- fast:     ${AVG_FAST}s"
  echo "- balanced: ${AVG_BAL}s"
  echo "- quality:  ${AVG_QUAL}s"
  echo
  echo "## Findings"
  echo "- Fastest verified preset (warm): ${FASTEST:-n/a}"
  echo "- Recommended default preset: $REC"
  echo "- Server startup cost (${STARTUP}s) is paid ONCE; warm requests amortize it."
  echo "  Use server mode for multiple images in a session; CLI for one-offs."
  echo
  echo "TSV: $TSV"
} > "$MD"

if [ "$KEEP" -eq 1 ]; then
  {
    echo
    echo "## Server LEFT RUNNING"
    echo '```'
    lsof -nP -iTCP:"${LPORT_NOW:-17870}" -sTCP:LISTEN 2>/dev/null || echo "(no local listener?)"
    echo "Stop with: bin/sdcpp-server-stop.sh"
    echo '```'
  } >> "$MD"
fi

if [ "$FAIL_N" -eq 0 ]; then
  pass_banner "WARM BENCHMARK PASS.
Startup/load: ${STARTUP}s | first req: ${FIRST_REQ}s
avg: smoke=${AVG_SMOKE}s fast=${AVG_FAST}s balanced=${AVG_BAL}s quality=${AVG_QUAL}s
Fastest verified: ${FASTEST:-n/a} | Recommended default: $REC
Report: $MD"
  exit 0
fi
printf '\n==== WARM BENCHMARK COMPLETED WITH FAILURES ====\nFailures=%s\nReport: %s\n' "$FAIL_N" "$MD" >&2
exit 1
