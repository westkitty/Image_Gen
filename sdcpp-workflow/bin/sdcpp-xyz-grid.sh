#!/usr/bin/env bash
# sdcpp-xyz-grid.sh — compose finished X/Y/Z cell images into legend-annotated grid PNGs (local, no inference).
# Usage: bin/sdcpp-xyz-grid.sh --spec <spec.json>     (spec is written by the console and removed afterwards)
set -euo pipefail
HERE="$(cd "$(dirname "$0")" && pwd)"
. "$HERE/sdcpp-lib.sh"
load_config

SPEC=""
while [ $# -gt 0 ]; do
  case "$1" in
    --spec) [ $# -ge 2 ] || fail "args" "--spec requires a value"; SPEC="$2"; shift 2 ;;
    *) fail "args" "Unknown argument: $1" ;;
  esac
done
[ -f "$SPEC" ] || fail "spec" "spec file not found"
python3 -c "from PIL import Image" 2>/dev/null || fail "pillow" "Python Pillow is not installed"

RUN_DIR="$(make_run_dir xyzgrid)"
SPEC_RUN="$RUN_DIR/.spec.json"
python3 - "$SPEC" "$SPEC_RUN" "$RUN_DIR" <<'PY'
import json, sys
s = json.load(open(sys.argv[1])); s['out_dir'] = sys.argv[3]
json.dump(s, open(sys.argv[2], 'w'))
PY
OUT="$(python3 "$HERE/xyz-grid.py" "$SPEC_RUN")" || { rm -f "$SPEC_RUN"; fail "xyz-grid" "grid composition failed"; }
rm -f "$SPEC_RUN"
log "xyz grid written under runs/$(basename "$RUN_DIR")"
echo "XYZ_GRID: $OUT"
pass_banner "XYZ grid complete.
Run: runs/$(basename "$RUN_DIR")"
