#!/usr/bin/env bash
# sdcpp-export-latest-markdown.sh — print the latest run's UI markdown (and the
# paths a UI should read). Read-only. The Markdown/JSON are the integration API.
set -euo pipefail

HERE="$(cd "$(dirname "$0")" && pwd)"
# shellcheck source=./sdcpp-lib.sh
. "$HERE/sdcpp-lib.sh"

load_config

WHICH="any"   # any|batch|cli|server|seedtest
PRINT=1

usage() {
  cat <<EOF
Usage: $(basename "$0") [--type any|batch|cli|server|seedtest] [--paths-only]
  Prints the newest run's ui-run-card.md (or report) plus the manifest paths a UI should read.
EOF
}
while [ "$#" -gt 0 ]; do
  case "$1" in
    --type) WHICH="${2:?}"; shift 2 ;;
    --paths-only) PRINT=0; shift ;;
    -h|--help) usage; exit 0 ;;
    *) fail "args" "Unknown argument: $1 (see --help)" ;;
  esac
done

pat="*"
case "$WHICH" in
  any) pat="*" ;;
  batch) pat="*-batch" ;;
  cli) pat="*-cli" ;;
  server) pat="*-server-gen" ;;
  seedtest) pat="*-seedtest" ;;
  *) fail "args" "--type must be any|batch|cli|server|seedtest" ;;
esac

# newest run dir that actually has a ui-run-card.md
LATEST=""
while IFS= read -r d; do
  [ -f "$d/ui-run-card.md" ] && { LATEST="$d"; break; }
done < <(ls -dt "$SDCPP_RUNS_DIR"/$pat 2>/dev/null)

[ -n "$LATEST" ] || fail "no-run" "No run with a ui-run-card.md found (type=$WHICH). Generate something first."

CARD="$LATEST/ui-run-card.md"
echo "RUN_DIR=$LATEST"
echo "UI_CARD=$CARD"
[ -f "$LATEST/batch-manifest.json" ] && echo "MANIFEST_JSON=$LATEST/batch-manifest.json"
[ -f "$LATEST/batch-manifest.tsv" ]  && echo "MANIFEST_TSV=$LATEST/batch-manifest.tsv"
[ -f "$LATEST/run-metadata.json" ]   && echo "RUN_METADATA_JSON=$LATEST/run-metadata.json"
[ -f "$LATEST/batch-report.md" ]     && echo "BATCH_REPORT=$LATEST/batch-report.md"
[ -d "$LATEST/images" ]              && echo "IMAGES_DIR=$LATEST/images"

if [ "$PRINT" -eq 1 ]; then
  echo "----- ui-run-card.md -----"
  cat "$CARD"
fi
exit 0
