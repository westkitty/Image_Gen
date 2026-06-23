#!/usr/bin/env bash
# sdcpp-esrgan-upscale.sh — Real-ESRGAN 4× upscale via sd-cli --mode upscale on BigMac.
# Input must be a PNG within the local runs directory.
# Model is resolved server-side from REMOTE_ESRGAN_MODEL in sdcpp.env.
# Does not require an SD diffusion model.
set -euo pipefail

HERE="$(cd "$(dirname "$0")" && pwd)"
# shellcheck source=./sdcpp-lib.sh
. "$HERE/sdcpp-lib.sh"

load_config

# ----- args ------------------------------------------------------------------
ARG_INIT_IMG=""
ARG_OUT_NAME=""
ARG_TILE_SIZE="128"
ARG_REPEATS="1"

usage() {
  cat <<EOF
Usage: $(basename "$0") [options]
  --init-img PATH      path to input PNG (must be within sdcpp-workflow/runs/)
  --out-name NAME      base name for output PNG (no extension)
  --tile-size N        ESRGAN tile size (default: 128)
  --repeats N          upscale repetitions (default: 1; each pass multiplies by 4×)
  -h, --help
EOF
}

while [ "$#" -gt 0 ]; do
  case "$1" in
    --init-img) ARG_INIT_IMG="${2:?}"; shift 2 ;;
    --out-name) ARG_OUT_NAME="${2:?}"; shift 2 ;;
    --tile-size) ARG_TILE_SIZE="${2:?}"; shift 2 ;;
    --repeats) ARG_REPEATS="${2:?}"; shift 2 ;;
    -h|--help) usage; exit 0 ;;
    *) fail "args" "Unknown argument: $1 (see --help)" ;;
  esac
done

[ -z "$ARG_INIT_IMG" ] && fail "args" "--init-img is required"

# ----- validate init image path (containment) --------------------------------
INIT_IMG_ABS="$(cd "$(dirname "$ARG_INIT_IMG")" 2>/dev/null && pwd)/$(basename "$ARG_INIT_IMG")" \
  || fail "init-img" "Cannot resolve init image path: $ARG_INIT_IMG"
case "$INIT_IMG_ABS" in
  "$SDCPP_RUNS_DIR/"*) ;;
  *) fail "init-img" "Init image must be within $SDCPP_RUNS_DIR (got: $INIT_IMG_ABS)" ;;
esac
[ -f "$INIT_IMG_ABS" ] || fail "init-img" "Init image not found: $INIT_IMG_ABS"

# ----- validate numeric params -----------------------------------------------
case "$ARG_TILE_SIZE" in *[!0-9]*|'') fail "args" "--tile-size must be a positive integer" ;; esac
case "$ARG_REPEATS" in *[!0-9]*|'') fail "args" "--repeats must be a positive integer" ;; esac

# ----- check remote ESRGAN model path is configured -------------------------
[ -n "${REMOTE_ESRGAN_MODEL:-}" ] \
  || fail "config" "REMOTE_ESRGAN_MODEL not set in sdcpp.env"

# ----- setup run dir ---------------------------------------------------------
RUN_DIR="$(make_run_dir esrgan-upscale)"
SDCPP_LOGFILE="$RUN_DIR/esrgan-upscale.log"; export SDCPP_LOGFILE
NAME="${ARG_OUT_NAME:-esrgan_$(timestamp)}"
LOCAL_PNG="$RUN_DIR/${NAME}-4x.png"
REPORT="$RUN_DIR/esrgan-run-report.md"
CREATED_AT="$(iso_now)"

# ----- pre-flight ------------------------------------------------------------
log "=== Pre-flight verification ==="
verify_route >/dev/null
verify_repo_clean 7f0e728 >/dev/null
BUILD_DIR="$(get_build_dir)"
verify_binaries "$BUILD_DIR"
ensure_remote_dirs

# Verify ESRGAN model exists on BigMac (read-only; never download/move).
remote_test "test -f \"$REMOTE_ESRGAN_MODEL\"" \
  || fail "esrgan-model" "ESRGAN model not found on BigMac at: $REMOTE_ESRGAN_MODEL. Do NOT download — stage manually."
ESRGAN_SIZE="$(ssh_remote "stat -f %z \"$REMOTE_ESRGAN_MODEL\" 2>/dev/null || wc -c < \"$REMOTE_ESRGAN_MODEL\"")"
log "ESRGAN model OK: $REMOTE_ESRGAN_MODEL ($ESRGAN_SIZE bytes)"

# Resolve input image dims (used for post-verification)
INPUT_W_H="$(python3 -c "
from PIL import Image
img = Image.open('$INIT_IMG_ABS')
print(img.size[0], img.size[1])
" 2>/dev/null)" || INPUT_W_H="unknown"

REMOTE_INPUT="$REMOTE_OUTPUT_DIR/${NAME}-input.png"
REMOTE_OUTPUT="$REMOTE_OUTPUT_DIR/${NAME}-4x.png"

# ----- metadata --------------------------------------------------------------
EXPECTED_SCALE=$(( ARG_REPEATS * 4 ))
cat > "$RUN_DIR/run-metadata.json" <<EOF
{
  "kind": "esrgan-upscale",
  "timestamp": "$(date)",
  "init_image": $(printf '%s' "$INIT_IMG_ABS" | jq -Rs .),
  "esrgan_model": "RealESRGAN_x4plus",
  "tile_size": $ARG_TILE_SIZE,
  "repeats": $ARG_REPEATS,
  "expected_scale": $EXPECTED_SCALE,
  "input_dims": $(printf '%s' "$INPUT_W_H" | jq -Rs .),
  "build_dir": "$BUILD_DIR",
  "remote_input": "$REMOTE_INPUT",
  "remote_output": "$REMOTE_OUTPUT",
  "local_png": "$LOCAL_PNG"
}
EOF

{
  echo "# SDCPP Real-ESRGAN Upscale Run Report"
  echo
  echo "- Timestamp: $(date)"
  echo "- Init image: $INIT_IMG_ABS"
  echo "- Input dims: $INPUT_W_H"
  echo "- Model: RealESRGAN_x4plus (4× per repeat)"
  echo "- Repeats: $ARG_REPEATS → ${EXPECTED_SCALE}× total"
  echo "- Tile size: $ARG_TILE_SIZE"
  echo "- Build dir: $BUILD_DIR"
  echo "- Remote input: $REMOTE_INPUT"
  echo "- Remote output: $REMOTE_OUTPUT"
  echo "- Local PNG: $LOCAL_PNG"
  echo
} > "$REPORT"

# ----- upload input to BigMac ------------------------------------------------
log "=== Uploading input to BigMac ==="
REMOTE_INPUT_ABS="$(remote_eval_path "$REMOTE_INPUT")"
scp "$INIT_IMG_ABS" "$SSH_TARGET:$REMOTE_INPUT_ABS" >/dev/null \
  || fail "scp-input" "scp failed uploading input to BigMac"
log "Input uploaded: $REMOTE_INPUT_ABS"

# ----- run ESRGAN on BigMac --------------------------------------------------
log "=== Running Real-ESRGAN upscale on BigMac (4×, tile=$ARG_TILE_SIZE, repeats=$ARG_REPEATS) ==="
START_EPOCH="$(now_epoch)"
ssh_remote \
  "\"$BUILD_DIR/bin/sd-cli\" --mode upscale -i \"$REMOTE_INPUT\" --upscale-model \"$REMOTE_ESRGAN_MODEL\" --upscale-tile-size $ARG_TILE_SIZE --upscale-repeats $ARG_REPEATS -o \"$REMOTE_OUTPUT\" -v 2>&1" \
  > "$RUN_DIR/remote-stdout.log" 2>&1 || true
END_EPOCH="$(now_epoch)"
ELAPSED="$(elapsed_seconds "$START_EPOCH" "$END_EPOCH")"
REMOTE_ELAPSED="$(grep -hoE 'upscaled, taking [0-9.]+s' "$RUN_DIR/remote-stdout.log" 2>/dev/null | grep -oE '[0-9.]+s' | tail -1 || true)"
[ -z "$REMOTE_ELAPSED" ] && REMOTE_ELAPSED="n/a"

# ----- verify remote PNG -----------------------------------------------------
log "=== Verifying remote PNG ==="
if ! remote_test "test -s \"$REMOTE_OUTPUT\" && file \"$REMOTE_OUTPUT\" | grep -q 'PNG image data'"; then
  tail -30 "$RUN_DIR/remote-stdout.log" >&2 || true
  record_run_report "$REPORT" "- RESULT: FAIL (no valid remote PNG; see remote-stdout.log)"
  fail "esrgan-remote-png" "Remote PNG missing or invalid: $REMOTE_OUTPUT"
fi
REMOTE_FILE_OUT="$(ssh_remote "file \"$REMOTE_OUTPUT\"")"
REMOTE_LS_OUT="$(ssh_remote "ls -lh \"$REMOTE_OUTPUT\"")"

# ----- copy back to MacBook --------------------------------------------------
log "=== Copying PNG to MacBook ==="
REMOTE_OUTPUT_ABS="$(remote_eval_path "$REMOTE_OUTPUT")"
scp "$SSH_TARGET:$REMOTE_OUTPUT_ABS" "$LOCAL_PNG" >/dev/null \
  || fail "esrgan-scp" "scp failed: $REMOTE_OUTPUT_ABS -> $LOCAL_PNG"

# ----- verify locally + strip metadata + checksums --------------------------
verify_png "$LOCAL_PNG" "Real-ESRGAN PNG"

# Strip PNG metadata — upscale output contains sdcpp version/commit info.
# Always strip; there are no prompts to optionally preserve.
strip_png_metadata "$LOCAL_PNG" \
  || log "Warning: strip_png_metadata failed (non-fatal); PNG may retain text chunks."
log "PNG metadata stripped."

LOCAL_SUM="$(local_sha256 "$LOCAL_PNG")"
REMOTE_SUM="$(remote_sha256 "$REMOTE_OUTPUT_ABS")"

# Check output dimensions are larger than input
OUT_DIMS="$(python3 -c "
from PIL import Image
img = Image.open('$LOCAL_PNG')
print(img.size[0], img.size[1])
" 2>/dev/null)" || OUT_DIMS="unknown"
log "Output dims: $OUT_DIMS (input: $INPUT_W_H)"

{
  echo "## Remote verification"
  echo '```'
  echo "$REMOTE_FILE_OUT"
  echo "$REMOTE_LS_OUT"
  echo '```'
  echo
  echo "## Local verification"
  echo '```'
  file "$LOCAL_PNG"
  ls -lh "$LOCAL_PNG"
  echo '```'
  echo
  echo "## Dimensions"
  echo "- input:  $INPUT_W_H"
  echo "- output: $OUT_DIMS"
  echo
  echo "## Checksums (sha256)"
  echo "- local:  $LOCAL_SUM"
  echo "- remote: $REMOTE_SUM (before metadata strip)"
  echo
  echo "## Timing"
  echo "- elapsed_seconds (wall): $ELAPSED"
  echo "- remote_upscale_time: $REMOTE_ELAPSED"
  echo
  echo "## Result"
  echo "- ESRGAN UPSCALE: PASS"
} >> "$REPORT"

# ----- machine-readable metrics ----------------------------------------------
PNG_BYTES="$(png_bytes "$LOCAL_PNG")"
{
  metrics_header
  printf '%s\t%s\t%s\t%s\t%s\t%s\t%s\t%s\t%s\t%s\t%s\t%s\t%s\t%s\t%s\t%s\t%s\t%s\t%s\t%s\t%s\t%s\t%s\t%s\t%s\t%s\t%s\t%s\t%s\n' \
    "$(date '+%Y-%m-%d %H:%M:%S')" "$(sanitize_tsv "$REMOTE_HOST_EXPECTED")" "$SSH_TARGET" "7f0e728" \
    "$(sanitize_tsv "$BUILD_DIR")" "$(sanitize_tsv "$REMOTE_ESRGAN_MODEL")" "esrgan-upscale" "custom" \
    "" "" "n/a" "n/a" "n/a" "n/a" "n/a" \
    "n/a" "$START_EPOCH" "$END_EPOCH" "$ELAPSED" "$REMOTE_ELAPSED" "n/a" \
    "$(sanitize_tsv "$LOCAL_PNG")" "$PNG_BYTES" "$LOCAL_SUM" "cold" "n/a" "n/a" "esrgan-4x" "PASS"
} > "$RUN_DIR/metrics.tsv"

# ----- UI run card -----------------------------------------------------------
PRIMARY_REL="$(basename "$LOCAL_PNG")"
write_ui_run_card "$RUN_DIR" "esrgan-upscale" "PASS" "$PRIMARY_REL" "run-metadata.json" \
  "" \
  "model=RealESRGAN_x4plus scale=${EXPECTED_SCALE}x tile=${ARG_TILE_SIZE} elapsed=${ELAPSED}s" \
  "$CREATED_AT" >/dev/null

pass_banner "ESRGAN UPSCALE PASS (scale=${EXPECTED_SCALE}×, ${ELAPSED}s wall / ${REMOTE_ELAPSED} remote).
Input:  $INIT_IMG_ABS ($INPUT_W_H)
Output: $LOCAL_PNG ($OUT_DIMS)
Report: $REPORT"
printf 'sha256 local=%s remote(pre-strip)=%s\n' "$LOCAL_SUM" "$REMOTE_SUM"
exit 0
