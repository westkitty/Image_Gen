#!/usr/bin/env bash
# sdcpp-open-latest.sh — show + open the latest generated PNG(s). Read-only.
set -euo pipefail

HERE="$(cd "$(dirname "$0")" && pwd)"
# shellcheck source=./sdcpp-lib.sh
. "$HERE/sdcpp-lib.sh"

load_config

RUNS="$SDCPP_RUNS_DIR"
[ -d "$RUNS" ] || { echo "No runs dir yet: $RUNS"; exit 0; }

# Latest run dir overall.
LATEST_DIR="$(find "$RUNS" -mindepth 1 -maxdepth 1 -type d | sort | tail -1 || true)"
[ -n "$LATEST_DIR" ] || { echo "No run folders found under $RUNS"; exit 0; }

echo "Latest run dir: $LATEST_DIR"

# Latest PNG anywhere under runs/ (by mtime).
LATEST_PNG="$(find "$RUNS" -type f -name '*.png' -print0 2>/dev/null \
  | xargs -0 ls -t 2>/dev/null | head -1 || true)"

echo
echo "PNGs in latest run dir:"
PNGS=()
while IFS= read -r p; do [ -n "$p" ] && PNGS+=("$p"); done < <(find "$LATEST_DIR" -type f -name '*.png' | sort)
if [ "${#PNGS[@]}" -eq 0 ]; then
  echo "  (none in $LATEST_DIR)"
else
  for p in "${PNGS[@]}"; do
    printf '  %s\n' "$p"
    file "$p" || true
    ls -lh "$p" || true
  done
fi

echo
if [ -n "$LATEST_PNG" ]; then
  echo "Most recent PNG overall: $LATEST_PNG"
  if command -v open >/dev/null 2>&1; then
    open "$LATEST_PNG" || echo "(open failed; path above)"
  else
    echo "(no 'open' command; path above)"
  fi
else
  echo "No PNGs found yet under $RUNS."
fi
exit 0
