#!/usr/bin/env bash
# sdcpp-remote-cancel.sh — stop the Big Mac processes that belong to ONE job, found by its unique run id.
# Usage: bin/sdcpp-remote-cancel.sh --run-id <YYYYMMDD-HHMMSS-suffix>
# Every remote command line of a job carries its run id (the sd-cli output path, or the MFLUX $0 label), so the
# match is exact: no pkill by program name, nothing outside this run is ever signalled.
# Prints: REMOTE_CANCEL: found=N killed=N left=M   Exit 0 only when nothing of the run is left running.
set -euo pipefail
HERE="$(cd "$(dirname "$0")" && pwd)"
. "$HERE/sdcpp-lib.sh"
load_config

RUN_ID=""
while [ $# -gt 0 ]; do
  case "$1" in
    --run-id) [ $# -ge 2 ] || fail "args" "--run-id requires a value"; RUN_ID="$2"; shift 2 ;;
    *) fail "args" "Unknown argument: $1" ;;
  esac
done
printf '%s' "$RUN_ID" | grep -Eq '^20[0-9]{6}-[0-9]{6}-[A-Za-z0-9_-]{1,80}$' || fail "run-id" "run id must look like 20261016-164245-controlled-sdxl-photonic"

OUT_FILE="$(mktemp /tmp/sdcpp_rcancel_XXXXXX)"
trap 'rm -f "$OUT_FILE"' EXIT
ssh_remote "bash -s -- '$RUN_ID'" > "$OUT_FILE" <<'REMOTE' || fail "remote-cancel-ssh" "Could not reach Big Mac to cancel run $RUN_ID"
marker="$1"
# Never signal this script's own ancestry (login shell, bash -s, and - when run locally - the caller).
skip=" "; p=$$
while [ -n "$p" ] && [ "$p" -gt 1 ] 2>/dev/null; do skip="$skip$p "; p="$(ps -o ppid= -p "$p" 2>/dev/null | tr -d ' ')"; done
# Match on the exact run id; skip those pids, this script's own subshells (same argv: "bash -s --") and the awk doing the matching.
list() { ps -axo pid=,command= | awk -v m="$marker" -v skip="$skip" 'index($0, m) > 0 && $2 != "awk" && index(skip, " " $1 " ") == 0 \
  && $0 !~ /bash -s --/ { print $1 }'; }
# A matched process (the bash -c wrapper) owns children whose own argv has no run id, e.g. the MFLUX python.
# Take the whole subtree of every match so nothing is left running as an orphan.
subtree() {
  ps -axo pid=,ppid= | awk -v roots="$1" -v skip="$skip" 'BEGIN { n = split(roots, r, " "); for (i = 1; i <= n; i++) keep[r[i]] = 1 }
    { pp[$1] = $2; ord[NR] = $1 }
    END { do { ch = 0; for (i = 1; i <= NR; i++) { p = ord[i]; if (!(p in keep) && (pp[p] in keep) && index(skip, " " p " ") == 0) { keep[p] = 1; ch = 1 } } } while (ch);
          for (p in keep) print p }'
}
all() { r="$(list | tr '\n' ' ')"; [ -n "${r// /}" ] && subtree "$r"; true; }
pids="$(all)"
found="$(printf '%s\n' "$pids" | grep -c . || true)"
if [ "$found" -gt 0 ]; then
  kill -TERM $pids 2>/dev/null || true
  sleep 2
  left="$(all)"
  if [ -n "$left" ]; then kill -KILL $left 2>/dev/null || true; sleep 1; fi
fi
left="$(all | grep -c . || true)"
printf 'REMOTE_CANCEL: found=%s killed=%s left=%s\n' "$found" "$((found - left))" "$left"
REMOTE
OUT="$(cat "$OUT_FILE")"
printf '%s\n' "$OUT"
LEFT="$(printf '%s\n' "$OUT" | sed -n 's/.*left=\([0-9]*\).*/\1/p' | tail -1)"
[ -n "$LEFT" ] || fail "remote-cancel-parse" "No REMOTE_CANCEL line came back"
[ "$LEFT" = "0" ] || fail "remote-cancel-left" "$LEFT process(es) of run $RUN_ID are still running on Big Mac"
pass_banner "Remote processes of run $RUN_ID are stopped."
