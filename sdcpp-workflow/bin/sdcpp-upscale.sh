#!/usr/bin/env bash
# sdcpp-upscale.sh — local Pillow-based image upscale for existing run images.
# Runs entirely on MacBook; no SSH, no inference, no prompts.
#
# Usage:
#   bin/sdcpp-upscale.sh --path "<run-id>/<relative-image.png>" [--scale 2] [--resample lanczos] [--overwrite]
#   bin/sdcpp-upscale.sh --run-id "<run-id>" --image "<relative.png>" [--scale 2] [--resample lanczos] [--overwrite]
#
# PASS = upscaled image written and verified.
# FAIL = first failed gate printed, nonzero exit.
set -euo pipefail

HERE="$(cd "$(dirname "$0")" && pwd)"
. "$HERE/sdcpp-lib.sh"
load_config

# ---- limits ------------------------------------------------------------------
MAX_SOURCE_BYTES=$((30 * 1024 * 1024))  # 30 MB source limit
MAX_SOURCE_SIDE=4096                     # source image max side length
MAX_OUTPUT_SIDE=4096                     # output image max side length

# ---- arg parsing -------------------------------------------------------------
SCALE=2
RESAMPLE=lanczos
OVERWRITE=0
INPUT_PATH=""
RUN_ID=""
IMAGE_REL=""

while [ $# -gt 0 ]; do
  case "$1" in
    --path)
      [ $# -ge 2 ] || fail "args" "--path requires a value"
      INPUT_PATH="$2"; shift 2 ;;
    --run-id)
      [ $# -ge 2 ] || fail "args" "--run-id requires a value"
      RUN_ID="$2"; shift 2 ;;
    --image)
      [ $# -ge 2 ] || fail "args" "--image requires a value"
      IMAGE_REL="$2"; shift 2 ;;
    --scale)
      [ $# -ge 2 ] || fail "args" "--scale requires a value"
      SCALE="$2"; shift 2 ;;
    --resample)
      [ $# -ge 2 ] || fail "args" "--resample requires a value"
      RESAMPLE="$2"; shift 2 ;;
    --overwrite)
      OVERWRITE=1; shift ;;
    *)
      fail "args" "Unknown argument: $1" ;;
  esac
done

# ---- resolve path from args --------------------------------------------------
if [ -n "$INPUT_PATH" ]; then
  # --path form: first component is run-id, rest is relative image path
  case "$INPUT_PATH" in
    /*) fail "path-absolute" "Absolute paths are not accepted. Use a run-relative path like: <run-id>/<image.png>" ;;
    ../*|*/../*|*/..) fail "path-traversal" "Path traversal is not allowed: $INPUT_PATH" ;;
  esac
  # Split on first /
  RUN_ID="${INPUT_PATH%%/*}"
  IMAGE_REL="${INPUT_PATH#*/}"
elif [ -n "$RUN_ID" ] && [ -n "$IMAGE_REL" ]; then
  : # already set
elif [ -z "$RUN_ID" ] || [ -z "$IMAGE_REL" ]; then
  fail "args" "Provide either --path <run-id>/<image> or both --run-id <run-id> --image <relative>"
fi

# ---- validate run-id (strict allowlist: A-Za-z0-9_- only) -------------------
if [ -z "$RUN_ID" ]; then
  fail "run-id" "run-id must not be empty"
fi
_rid_stripped="$(printf '%s' "$RUN_ID" | tr -d 'A-Za-z0-9_-')"
if [ -n "$_rid_stripped" ]; then
  fail "run-id" "Invalid run-id (only A-Za-z0-9_- allowed): $RUN_ID"
fi

# ---- validate image path (strict allowlist: A-Za-z0-9._/- only) -------------
if [ -z "$IMAGE_REL" ]; then
  fail "image-empty" "Image path must not be empty"
fi
case "$IMAGE_REL" in
  /*) fail "image-absolute" "Absolute image path not accepted: $IMAGE_REL" ;;
  ../*|*/../*|*/..) fail "image-traversal" "Image path traversal not allowed: $IMAGE_REL" ;;
esac
_img_stripped="$(printf '%s' "$IMAGE_REL" | tr -d 'A-Za-z0-9._/-')"
if [ -n "$_img_stripped" ]; then
  fail "image-chars" "Image path contains disallowed characters (only A-Za-z0-9._/- allowed): $IMAGE_REL"
fi

# ---- validate scale ----------------------------------------------------------
case "$SCALE" in
  2|3|4) ;;
  *) fail "scale" "Scale must be 2, 3, or 4 (got: $SCALE)" ;;
esac

# ---- validate resample -------------------------------------------------------
case "$RESAMPLE" in
  nearest|bilinear|bicubic|lanczos) ;;
  *) fail "resample" "Resample must be: nearest, bilinear, bicubic, lanczos (got: $RESAMPLE)" ;;
esac

# ---- resolve and canonicalize source path ------------------------------------
RUN_PATH="$SDCPP_RUNS_DIR/$RUN_ID"
[ -d "$RUN_PATH" ] || fail "run-dir" "Run directory not found: $RUN_PATH"

# Resolve input path; ensure it stays inside SDCPP_RUNS_DIR
# Values are passed via argv — never interpolated into Python source.
INPUT_FULL="$(cd "$SDCPP_RUNS_DIR" && python3 - "$RUN_ID" "$IMAGE_REL" <<'PYCONTAIN'
import os, sys
run_id  = sys.argv[1]
img_rel = sys.argv[2]
p    = os.path.realpath(os.path.join(run_id, img_rel))
base = os.path.realpath('.')
if not p.startswith(base + os.sep) and p != base:
    sys.exit(1)
print(p)
PYCONTAIN
)" || fail "path-containment" "Resolved path escapes RUNS_DIR: $RUN_ID/$IMAGE_REL"

[ -f "$INPUT_FULL" ] || fail "input-missing" "Source image not found: $INPUT_FULL"

# ---- validate file extension -------------------------------------------------
case "$INPUT_FULL" in
  *.png|*.PNG) ;;
  *) fail "input-extension" "Only PNG files are accepted (got: $(basename "$INPUT_FULL"))" ;;
esac

# ---- validate source file size -----------------------------------------------
INPUT_BYTES="$(wc -c < "$INPUT_FULL" | tr -d ' \t')"
if [ "$INPUT_BYTES" -gt "$MAX_SOURCE_BYTES" ]; then
  fail "input-size" "Source file too large: ${INPUT_BYTES} bytes (max ${MAX_SOURCE_BYTES})"
fi

# ---- verify Pillow is available ----------------------------------------------
python3 -c "from PIL import Image" 2>/dev/null || fail "pillow" "Python Pillow is not installed (python3 -c 'from PIL import Image' failed)"

# ---- prepare output dir ------------------------------------------------------
UPSCALE_DIR="$RUN_PATH/upscaled"
mkdir -p "$UPSCALE_DIR"

BASE_NAME="$(basename "$INPUT_FULL" .png)"
BASE_NAME="$(basename "$BASE_NAME" .PNG)"
OUT_NAME="${BASE_NAME}-upscale-${SCALE}x-${RESAMPLE}.png"
OUT_FULL="$UPSCALE_DIR/$OUT_NAME"

if [ "$OVERWRITE" = "0" ] && [ -f "$OUT_FULL" ]; then
  fail "overwrite" "Output already exists: $OUT_FULL — pass --overwrite to replace"
fi

CREATED_AT="$(iso_now)"

log "Upscaling $INPUT_FULL -> $OUT_FULL (scale=${SCALE}x resample=$RESAMPLE)"

# ---- run Pillow upscale via embedded Python ----------------------------------
python3 - \
  "$INPUT_FULL" "$OUT_FULL" "$SCALE" "$RESAMPLE" \
  "$MAX_SOURCE_SIDE" "$MAX_OUTPUT_SIDE" \
  "$RUN_ID" "$IMAGE_REL" "$CREATED_AT" \
  "$UPSCALE_DIR/upscale-manifest.json" \
  "$UPSCALE_DIR/upscale-report.md" <<'PYSCRIPT'
import sys, json, datetime, os
from PIL import Image

input_path   = sys.argv[1]
output_path  = sys.argv[2]
scale        = int(sys.argv[3])
resample_str = sys.argv[4]
max_src_side = int(sys.argv[5])
max_out_side = int(sys.argv[6])
source_run_id  = sys.argv[7]
source_image   = sys.argv[8]
created_at   = sys.argv[9]
manifest_path = sys.argv[10]
report_path  = sys.argv[11]

RESAMPLE_MAP = {
    'nearest':  Image.NEAREST,
    'bilinear': Image.BILINEAR,
    'bicubic':  Image.BICUBIC,
    'lanczos':  Image.LANCZOS,
}
resample_filter = RESAMPLE_MAP.get(resample_str)
if resample_filter is None:
    print(f"FAIL: unknown resample filter: {resample_str}", file=sys.stderr)
    sys.exit(1)

first_failed_gate = None

try:
    img = Image.open(input_path).convert('RGB')
    src_w, src_h = img.size

    if src_w > max_src_side or src_h > max_src_side:
        first_failed_gate = 'source-dimensions'
        raise ValueError(f"Source image too large: {src_w}x{src_h} (max side {max_src_side})")

    out_w = src_w * scale
    out_h = src_h * scale
    if out_w > max_out_side or out_h > max_out_side:
        first_failed_gate = 'output-dimensions'
        raise ValueError(f"Output would be {out_w}x{out_h}, exceeds max side {max_out_side}")

    out_img = img.resize((out_w, out_h), resample_filter)
    out_img.save(output_path, format='PNG', optimize=False)
    out_bytes = os.path.getsize(output_path)

    manifest = {
        'schema': 'sdcpp-upscale-manifest-v1',
        'source_run_id':   source_run_id,
        'source_image':    source_image,
        'output_image':    os.path.relpath(output_path, os.path.dirname(os.path.dirname(output_path))),
        'scale':           scale,
        'resample':        resample_str,
        'source_width':    src_w,
        'source_height':   src_h,
        'output_width':    out_w,
        'output_height':   out_h,
        'output_bytes':    out_bytes,
        'status':          'PASS',
        'created_at':      created_at,
        'first_failed_gate': None,
    }
    with open(manifest_path, 'w') as f:
        json.dump(manifest, f, indent=2)
        f.write('\n')

    report_lines = [
        f'# Upscale Report',
        f'',
        f'- **Source run:** `{source_run_id}`',
        f'- **Source image:** `{source_image}`',
        f'- **Source size:** {src_w}x{src_h}',
        f'- **Scale:** {scale}x',
        f'- **Resample:** {resample_str}',
        f'- **Output:** `{os.path.basename(output_path)}`',
        f'- **Output size:** {out_w}x{out_h}',
        f'- **Output bytes:** {out_bytes}',
        f'- **Method:** local Pillow resize (not Real-ESRGAN; not AI upscale)',
        f'- **Status:** PASS',
        f'- **Created at:** {created_at}',
    ]
    with open(report_path, 'w') as f:
        f.write('\n'.join(report_lines) + '\n')

    print(f'UPSCALED_IMAGE: {source_run_id}/upscaled/{os.path.basename(output_path)}')
    print(f'UPSCALE_MANIFEST: {source_run_id}/upscaled/upscale-manifest.json')
    print(f'SOURCE_SIZE: {src_w}x{src_h}')
    print(f'OUTPUT_SIZE: {out_w}x{out_h}')
    print(f'OUTPUT_BYTES: {out_bytes}')

except Exception as exc:
    gate = first_failed_gate or 'upscale'
    manifest = {
        'schema': 'sdcpp-upscale-manifest-v1',
        'source_run_id':   source_run_id,
        'source_image':    source_image,
        'output_image':    None,
        'scale':           scale,
        'resample':        resample_str,
        'source_width':    None,
        'source_height':   None,
        'output_width':    None,
        'output_height':   None,
        'output_bytes':    None,
        'status':          'FAIL',
        'created_at':      created_at,
        'first_failed_gate': gate,
    }
    try:
        with open(manifest_path, 'w') as f:
            json.dump(manifest, f, indent=2)
            f.write('\n')
    except Exception:
        pass
    print(f"FAIL: {gate}: {exc}", file=sys.stderr)
    print(f"First failed gate: {gate}", file=sys.stderr)
    sys.exit(1)
PYSCRIPT

# ---- verify output file exists and is nonzero --------------------------------
[ -f "$OUT_FULL" ] || fail "output-missing" "Output file not written: $OUT_FULL"
OUT_BYTES="$(wc -c < "$OUT_FULL" | tr -d ' \t')"
[ "$OUT_BYTES" -gt 0 ] || fail "output-empty" "Output file is empty: $OUT_FULL"

# ---- verify output is a valid PNG via file command ---------------------------
FILE_OUT="$(file "$OUT_FULL" 2>/dev/null)"
case "$FILE_OUT" in
  *PNG*|*PNG*) ;;
  *) fail "output-verify" "Output file did not pass 'file' PNG check: $FILE_OUT" ;;
esac

log "Output verified: $OUT_FULL ($OUT_BYTES bytes)"

pass_banner "Pillow upscale complete.
Source: $INPUT_FULL
Output: $OUT_FULL
Scale:  ${SCALE}x  Resample: $RESAMPLE"
