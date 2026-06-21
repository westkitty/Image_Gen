#!/usr/bin/env bash
# sdcpp-seed-test.sh — prove (or disprove) seed reproducibility: generate the same
# seed twice, verify both PNGs, compare SHA256. Reports deterministic PASS/FAIL/UNKNOWN.
set -euo pipefail

HERE="$(cd "$(dirname "$0")" && pwd)"
# shellcheck source=./sdcpp-lib.sh
. "$HERE/sdcpp-lib.sh"

load_config

MODE="cli"               # cli | server-sdapi | native
PRESET="smoke"
SEED=424242
ARG_PROMPT="$PROMPT"

usage() {
  cat <<EOF
Usage: $(basename "$0") [options]
  --mode cli|server-sdapi|native   (default cli)
  --preset smoke|thumbnail|fast|balanced|quality   (default smoke)
  --seed N                         fixed seed to test (default 424242)
  --prompt "..."
  -h, --help
EOF
}

while [ "$#" -gt 0 ]; do
  case "$1" in
    --mode) MODE="${2:?}"; shift 2 ;;
    --preset) PRESET="${2:?}"; shift 2 ;;
    --seed) SEED="${2:?}"; shift 2 ;;
    --prompt) ARG_PROMPT="${2:?}"; shift 2 ;;
    -h|--help) usage; exit 0 ;;
    *) fail "args" "Unknown argument: $1 (see --help)" ;;
  esac
done
case "$MODE" in cli|server-sdapi|native) : ;; *) fail "args" "--mode must be cli|server-sdapi|native" ;; esac
case "$SEED" in ''|*[!0-9]*) fail "args" "--seed must be a non-negative integer" ;; esac

RUN_DIR="$(make_run_dir seedtest)"
mkdir -p "$RUN_DIR/a" "$RUN_DIR/b"
SDCPP_LOGFILE="$RUN_DIR/seed-test.log"; export SDCPP_LOGFILE
REPORT="$RUN_DIR/seed-test-report.md"
CREATED_AT="$(iso_now)"

log "=== seed-test: mode=$MODE preset=$PRESET seed=$SEED ==="
"$HERE/sdcpp-verify.sh" >>"$SDCPP_LOGFILE" 2>&1 || fail "verify" "verify failed; see $SDCPP_LOGFILE"

SERVER_STARTED=0
cleanup() { if [ "$SERVER_STARTED" -eq 1 ]; then "$HERE/sdcpp-server-stop.sh" >>"$SDCPP_LOGFILE" 2>&1 || true; SERVER_STARTED=0; fi; }
trap 'cleanup' EXIT INT TERM

gen_into() {
  # gen_into <cell-dir>  -> echoes path to produced png (or empty)
  local cell="$1"
  case "$MODE" in
    cli)
      SDCPP_RUN_DIR_OVERRIDE="$cell" "$HERE/sdcpp-cli-generate.sh" \
        --preset "$PRESET" --seed "$SEED" --prompt "$ARG_PROMPT" >"$cell/stdout.log" 2>&1 || true
      ls "$cell"/*.png 2>/dev/null | head -1 ;;
    server-sdapi)
      SDCPP_RUN_DIR_OVERRIDE="$cell" "$HERE/sdcpp-server-generate.sh" \
        --preset "$PRESET" --api sdapi --seed "$SEED" --warm-state warm --prompt "$ARG_PROMPT" >"$cell/stdout.log" 2>&1 || true
      [ -f "$cell/sdapi.png" ] && echo "$cell/sdapi.png" || true ;;
    native)
      SDCPP_RUN_DIR_OVERRIDE="$cell" "$HERE/sdcpp-server-generate.sh" \
        --preset "$PRESET" --api native --seed "$SEED" --warm-state warm --prompt "$ARG_PROMPT" >"$cell/stdout.log" 2>&1 || true
      [ -f "$cell/native.png" ] && echo "$cell/native.png" || true ;;
  esac
}

if [ "$MODE" != "cli" ]; then
  log "=== starting warm server for seed test ==="
  "$HERE/sdcpp-server-start.sh" >>"$SDCPP_LOGFILE" 2>&1 || fail "server-start" "server start failed; see $SDCPP_LOGFILE"
  SERVER_STARTED=1
fi

log "=== run A ==="; PNG_A="$(gen_into "$RUN_DIR/a")"
log "=== run B ==="; PNG_B="$(gen_into "$RUN_DIR/b")"

cleanup; trap - EXIT INT TERM

# verify both
GEN_STATUS="PASS"
if ! { [ -n "$PNG_A" ] && verify_png "$PNG_A" "seed A" >/dev/null 2>&1; }; then GEN_STATUS="FAIL"; fi
if ! { [ -n "$PNG_B" ] && verify_png "$PNG_B" "seed B" >/dev/null 2>&1; }; then GEN_STATUS="FAIL"; fi

SUM_A=""; SUM_B=""; DET="UNKNOWN"
if [ "$GEN_STATUS" = "PASS" ]; then
  SUM_A="$(local_sha256 "$PNG_A")"; SUM_B="$(local_sha256 "$PNG_B")"
  if [ -n "$SUM_A" ] && [ "$SUM_A" = "$SUM_B" ]; then DET="PASS"; else DET="FAIL"; fi
fi

BYTES_A="$([ -n "$PNG_A" ] && png_bytes "$PNG_A" || echo 0)"
BYTES_B="$([ -n "$PNG_B" ] && png_bytes "$PNG_B" || echo 0)"

{
  echo "---"
  echo "schema: sdcpp.run.v1"
  echo "run_id: \"$(basename "$RUN_DIR")\""
  echo "run_type: \"seed-test\""
  echo "status: \"$GEN_STATUS\""
  echo "created_at: \"$CREATED_AT\""
  echo "mode: \"$MODE\""
  echo "preset: \"$PRESET\""
  echo "seed: $SEED"
  echo "deterministic: \"$DET\""
  echo "primary_image: \"$([ -n "$PNG_A" ] && echo "a/$(basename "$PNG_A")" || echo "")\""
  echo "---"
  echo
  echo "# SDCPP Seed Reproducibility Test"
  echo
  echo "## Result"
  echo "- generation: $GEN_STATUS"
  echo "- deterministic: $DET"
  echo
  echo "## Settings"
  echo "- mode: $MODE"
  echo "- preset: $PRESET"
  echo "- seed: $SEED"
  echo "- prompt: $ARG_PROMPT"
  echo
  echo "## Hashes (sha256)"
  echo "- A: ${SUM_A:-n/a}  ($BYTES_A bytes)  $PNG_A"
  echo "- B: ${SUM_B:-n/a}  ($BYTES_B bytes)  $PNG_B"
  echo
  echo "## Interpretation"
  case "$DET" in
    PASS) echo "- DETERMINISTIC PASS: identical SHA256 for the same seed+settings on this path." ;;
    FAIL) echo "- DETERMINISTIC FAIL: both PNGs verified but hashes differ — this path is NOT bit-reproducible for the same seed (sampler/backend nondeterminism). Do not promise reproducibility for $MODE." ;;
    UNKNOWN) echo "- UNKNOWN: generation did not produce two verified PNGs; cannot judge determinism. See logs." ;;
  esac
} > "$REPORT"

if [ "$DET" = "PASS" ]; then
  pass_banner "SEED TEST: generation PASS, DETERMINISTIC PASS (seed=$SEED, $MODE).
sha256 A==B = $SUM_A
Report: $REPORT"
  exit 0
elif [ "$GEN_STATUS" = "PASS" ]; then
  printf '\n==== SEED TEST: generation PASS, DETERMINISTIC %s ====\nA=%s\nB=%s\nReport: %s\n' "$DET" "$SUM_A" "$SUM_B" "$REPORT"
  exit 0
fi
fail "seed-test" "Generation did not produce two verified PNGs ($MODE). See $REPORT and $SDCPP_LOGFILE."
