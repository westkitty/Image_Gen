#!/usr/bin/env bash
# sdcpp-clean-old-runs.sh — non-destructive housekeeping for runs/.
# Default: DRY RUN (lists only). Deletes only with explicit flags.
# Never deletes: proof Bible/report, model files, remote files, the active run.
set -euo pipefail

HERE="$(cd "$(dirname "$0")" && pwd)"
# shellcheck source=./sdcpp-lib.sh
. "$HERE/sdcpp-lib.sh"

load_config

DO_DELETE=0
OLDER_DAYS=""

usage() {
  cat <<EOF
Usage: $(basename "$0") [--delete --older-than-days N]
  (no args)                 dry run: list run folders and ages
  --delete --older-than-days N
                            delete LOCAL run folders older than N days under runs/
Safety:
  - Never touches the proof Bible/report, model files, or any remote files.
  - Never deletes the most recent run. Never uses rm -rf on arbitrary paths.
EOF
}

while [ "$#" -gt 0 ]; do
  case "$1" in
    --delete) DO_DELETE=1; shift ;;
    --older-than-days) OLDER_DAYS="${2:?}"; shift 2 ;;
    -h|--help) usage; exit 0 ;;
    *) fail "args" "Unknown argument: $1 (see --help)" ;;
  esac
done

RUNS="$SDCPP_RUNS_DIR"
[ -d "$RUNS" ] || { echo "No runs dir yet: $RUNS"; exit 0; }

# Collect run dirs (direct children only), newest first.
# Portable (no mapfile; macOS default bash is 3.2).
ALL=()
while IFS= read -r d; do [ -n "$d" ] && ALL+=("$d"); done < <(find "$RUNS" -mindepth 1 -maxdepth 1 -type d | sort -r)
if [ "${#ALL[@]}" -eq 0 ]; then echo "No run folders under $RUNS"; exit 0; fi

NEWEST="${ALL[0]}"
echo "Run folders under $RUNS (newest first):"
for d in "${ALL[@]}"; do
  age_days="$(( ( $(date +%s) - $(stat -f %m "$d") ) / 86400 ))"
  marker=""
  [ "$d" = "$NEWEST" ] && marker="  <-- newest (protected)"
  printf '  %-60s  %sd old%s\n' "$(basename "$d")" "$age_days" "$marker"
done

if [ "$DO_DELETE" -eq 0 ]; then
  echo
  echo "DRY RUN. To delete: $(basename "$0") --delete --older-than-days N"
  exit 0
fi

[ -n "$OLDER_DAYS" ] || fail "args" "--delete requires --older-than-days N"
case "$OLDER_DAYS" in (*[!0-9]*|'') fail "args" "--older-than-days must be a non-negative integer";; esac

echo
echo "Deleting LOCAL run folders older than $OLDER_DAYS days (keeping newest)..."
DELETED=0
for d in "${ALL[@]}"; do
  [ "$d" = "$NEWEST" ] && continue
  # Guard: only delete dirs that live under runs/ and look like run folders.
  case "$d" in "$RUNS"/*) : ;; *) continue ;; esac
  age_days="$(( ( $(date +%s) - $(stat -f %m "$d") ) / 86400 ))"
  if [ "$age_days" -ge "$OLDER_DAYS" ]; then
    echo "  deleting $(basename "$d") (${age_days}d)"
    rm -r -- "$d"        # NB: rm -r on a specific run dir only; never rm -rf, never on roots
    DELETED=$((DELETED+1))
  fi
done
echo "Deleted $DELETED folder(s). Newest run and all other data preserved."
exit 0
