#!/usr/bin/env bash
# sdcpp-remote-cancel.sh — stop the Big Mac processes that belong to ONE job, found by its unique run id.
# Usage: bin/sdcpp-remote-cancel.sh --run-id <YYYYMMDD-HHMMSS-suffix>
# Every remote command line of a job carries its run id (the sd-cli output path, or the MFLUX $0 label), so the
# match is exact: no pkill by program name, nothing outside this run is ever signalled.
# Prints: REMOTE_CANCEL: found=N killed=N left=M   Exit 0 only when nothing of the run is left running.
#
# OP-7 reconciliation modes (never signal anything):
#   --check-only --run-id ID   prints REMOTE_CHECK: run=ID alive=N   (identity-scoped liveness, same matching as the stop)
#   --scan-owned               prints REMOTE_OWNED: run=ID for every DexDiffusion run id seen on a live command line
#                              (sd-cli output paths under the staging tree, or the dexdiffusion-mflux-<id> label) and
#                              REMOTE_SDSERVER: running=N for staging sd-server processes, then REMOTE_SCAN: done
# A connection failure is a FAIL (exit non-zero, no REMOTE_* line): it is never evidence that something stopped.
set -euo pipefail
HERE="$(cd "$(dirname "$0")" && pwd)"
. "$HERE/sdcpp-lib.sh"
load_config

RUN_ID=""; MODE=stop
while [ $# -gt 0 ]; do
  case "$1" in
    --run-id) [ $# -ge 2 ] || fail "args" "--run-id requires a value"; RUN_ID="$2"; shift 2 ;;
    --check-only) MODE=check; shift ;;
    --scan-owned) MODE=scan; shift ;;
    *) fail "args" "Unknown argument: $1" ;;
  esac
done

if [ "$MODE" = "scan" ]; then
  OUT="$(ssh_remote "bash -s" <<'REMOTE'
ps -axo pid=,command= | awk '$2 != "awk" && $0 !~ /bash -s/ {
    if (match($0, /dexdiffusion-mflux-20[0-9]{6}-[0-9]{6}-[A-Za-z0-9_-]+/)) { s = substr($0, RSTART + 19, RLENGTH - 19); print "REMOTE_OWNED: run=" s }
    else if ($0 ~ /sdcpp-staging\// && match($0, /-20[0-9]{6}-[0-9]{6}-[A-Za-z0-9_-]+\.(png|log)/)) { s = substr($0, RSTART + 1, RLENGTH - 1); sub(/\.(png|log)$/, "", s); print "REMOTE_OWNED: run=" s }
  }' | sort -u
printf 'REMOTE_SDSERVER: running=%s\n' "$(ps -axo command= | grep -E '(^|/)sd-server( |$)' | grep -v grep | grep -c . || true)"
echo "REMOTE_SCAN: done"
REMOTE
)" || fail "remote-scan-ssh" "Could not reach Big Mac to scan DexDiffusion processes"
  printf '%s\n' "$OUT"
  printf '%s\n' "$OUT" | grep -q '^REMOTE_SCAN: done$' || fail "remote-scan-parse" "No complete REMOTE_SCAN result came back"
  pass_banner "Owned-process scan complete."
  exit 0
fi
printf '%s' "$RUN_ID" | grep -Eq '^20[0-9]{6}-[0-9]{6}-[A-Za-z0-9_-]{1,80}$' || fail "run-id" "run id must look like 20261016-164245-controlled-sdxl-photonic"

OUT_FILE="$(mktemp /tmp/sdcpp_rcancel_XXXXXX)"
trap 'rm -f "$OUT_FILE"' EXIT
ssh_remote "bash -s -- '$RUN_ID' '$MODE'" > "$OUT_FILE" <<'REMOTE' || fail "remote-cancel-ssh" "Could not reach Big Mac to cancel run $RUN_ID"
marker="$1"
# Never signal this script's own ancestry (login shell, bash -s, and - when run locally - the caller).
skip=" "; p=$$
while [ -n "$p" ] && [ "$p" -gt 1 ] 2>/dev/null; do skip="$skip$p "; p="$(ps -o ppid= -p "$p" 2>/dev/null | tr -d ' ')"; done
# Match the exact run id as a whole token: not followed by more id characters, so a longer id that starts with it never matches
# (the MFLUX label is "dexdiffusion-mflux-<id>", so a leading hyphen is allowed); skip those pids, this script's own subshells (same argv: "bash -s --") and the awk doing the matching.
list() { ps -axo pid=,command= | awk -v m="$marker" -v skip="$skip" '$0 ~ ("(^|[^A-Za-z0-9_])" m "([^A-Za-z0-9_-]|$)") && $2 != "awk" && index(skip, " " $1 " ") == 0 \
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
if [ "${2:-}" = "check" ]; then printf 'REMOTE_CHECK: run=%s alive=%s\n' "$marker" "$found"; exit 0; fi
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
if [ "$MODE" = "check" ]; then
  printf '%s\n' "$OUT" | grep -Eq '^REMOTE_CHECK: run=.* alive=[0-9]+$' || fail "remote-check-parse" "No REMOTE_CHECK line came back"
  pass_banner "Liveness check for run $RUN_ID complete."
  exit 0
fi
LEFT="$(printf '%s\n' "$OUT" | sed -n 's/.*left=\([0-9]*\).*/\1/p' | tail -1)"
[ -n "$LEFT" ] || fail "remote-cancel-parse" "No REMOTE_CANCEL line came back"
[ "$LEFT" = "0" ] || fail "remote-cancel-left" "$LEFT process(es) of run $RUN_ID are still running on Big Mac"
pass_banner "Remote processes of run $RUN_ID are stopped."
