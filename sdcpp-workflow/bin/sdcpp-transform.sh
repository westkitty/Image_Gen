#!/usr/bin/env bash
# sdcpp-transform.sh — local, nondestructive rotate / flip / crop of an existing run image.
# Runs on the MacBook only (no SSH, no inference). Writes a NEW PNG under <run>/transformed/; the source is never touched.
#   bin/sdcpp-transform.sh --run-id <run-id> --image <relative.png> --ops '<json array>'
set -euo pipefail
HERE="$(cd "$(dirname "$0")" && pwd)"
. "$HERE/sdcpp-lib.sh"
load_config

RUN_ID=""; IMAGE_REL=""; OPS=""
while [ $# -gt 0 ]; do
  case "$1" in
    --run-id) [ $# -ge 2 ] || fail "args" "--run-id requires a value"; RUN_ID="$2"; shift 2 ;;
    --image)  [ $# -ge 2 ] || fail "args" "--image requires a value"; IMAGE_REL="$2"; shift 2 ;;
    --ops)    [ $# -ge 2 ] || fail "args" "--ops requires a value"; OPS="$2"; shift 2 ;;
    *) fail "args" "Unknown argument: $1" ;;
  esac
done
[ -n "$RUN_ID" ] && [ -n "$IMAGE_REL" ] && [ -n "$OPS" ] || fail "args" "--run-id, --image and --ops are required"
[ -z "$(printf '%s' "$RUN_ID" | tr -d 'A-Za-z0-9_-')" ] || fail "run-id" "Invalid run-id (only A-Za-z0-9_- allowed): $RUN_ID"
case "$IMAGE_REL" in /*) fail "image-absolute" "Absolute image path not accepted" ;; ../*|*/../*|*/..) fail "image-traversal" "Image path traversal not allowed" ;; esac
[ -z "$(printf '%s' "$IMAGE_REL" | tr -d 'A-Za-z0-9._/-')" ] || fail "image-chars" "Image path contains disallowed characters"

RUN_PATH="$SDCPP_RUNS_DIR/$RUN_ID"
[ -d "$RUN_PATH" ] || fail "run-dir" "Run directory not found: $RUN_PATH"
INPUT_FULL="$(cd "$SDCPP_RUNS_DIR" && python3 - "$RUN_ID" "$IMAGE_REL" <<'PYCONTAIN'
import os, sys
p = os.path.realpath(os.path.join(sys.argv[1], sys.argv[2])); base = os.path.realpath('.')
if not p.startswith(base + os.sep): sys.exit(1)
print(p)
PYCONTAIN
)" || fail "path-containment" "Resolved path escapes RUNS_DIR"
if [ ! -f "$INPUT_FULL" ]; then
  INPUT_FULL="$(resolve_canonical_run_image "$RUN_PATH" "$IMAGE_REL")" || fail "input-missing" "Source image not found: $RUN_ID/$IMAGE_REL"
fi
case "$INPUT_FULL" in *.png|*.PNG) ;; *) fail "input-extension" "Only PNG sources are accepted" ;; esac
python3 -c "from PIL import Image" 2>/dev/null || fail "pillow" "Python Pillow is not installed"

OUT_DIR="$RUN_PATH/transformed"; mkdir -p "$OUT_DIR"
BASE="$(basename "$INPUT_FULL" .png)"
OUT_NAME="${BASE}-tf-$(printf '%s' "$OPS" | shasum -a 256 | cut -c1-8).png"
OUT_FULL="$OUT_DIR/$OUT_NAME"
[ ! -e "$OUT_FULL" ] || fail "overwrite" "This exact transform already exists: $OUT_NAME"

log "Transforming $INPUT_FULL -> $OUT_FULL"
RESULT="$(python3 "$HERE/transform-image.py" "$INPUT_FULL" "$OUT_FULL" "$OPS")" || fail "transform" "transform-image.py rejected the request or failed"
[ -s "$OUT_FULL" ] || fail "output-missing" "Output file not written"
case "$(file "$OUT_FULL" 2>/dev/null)" in *PNG*) ;; *) fail "output-verify" "Output is not a PNG" ;; esac
echo "TRANSFORMED_IMAGE: runs/$RUN_ID/transformed/$OUT_NAME"
echo "TRANSFORM_RESULT: $RESULT"
pass_banner "Transform complete.
Source: $INPUT_FULL
Output: $OUT_FULL"
