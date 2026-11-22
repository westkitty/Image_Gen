#!/bin/bash
# Mandatory, fail-closed release preflight for any operation that would stop a
# working Big Mac backend (a future cutover or an owner restart).
#
#   release-gate.sh --expect-revision SHA [--target-worktree DIR] [--override-unverified REASON]
#
# Exit 0 only when the read-only release doctor reports PASS (or, for an
# UNVERIFIED verdict only, when an operator supplies a written reason, which is
# printed and appended to an audit log). BLOCKED can never be overridden here.
# Exit 78 = refused. Exit 79 = fixture verdict: recorded facts never authorize.
# This script itself never stops, restarts or signals anything.
set -euo pipefail
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
DOCTOR="$HERE/wc2tb-release-doctor.py"
PY=/opt/homebrew/bin/python3
[[ -x "$PY" ]] || PY="$(command -v python3)"
expect="" target="" reason=""
while (($#)); do
  case "$1" in
    --expect-revision) expect="${2:-}"; shift 2 ;;
    --target-worktree) target="${2:-}"; shift 2 ;;
    --override-unverified) reason="${2:-}"; shift 2 ;;
    *) echo "RELEASE_GATE_REFUSED: unknown argument $1" >&2; exit 78 ;;
  esac
done
[[ -n "$expect" ]] || { echo "RELEASE_GATE_REFUSED: --expect-revision <full sha> is mandatory" >&2; exit 78; }
args=(--release-readiness --expect-revision "$expect")
[[ -z "$target" ]] || args+=(--target-worktree "$target")
if [[ -n "${DEX_RELEASE_GATE_FIXTURE_FACTS:-}" ]]; then
  args+=(--facts "$DEX_RELEASE_GATE_FIXTURE_FACTS")
fi
set +e
report="$("$PY" "$DOCTOR" "${args[@]}")"
rc=$?
set -e
summary="$(printf '%s' "$report" | "$PY" -c '
import json, sys
try:
    r = json.load(sys.stdin)
except ValueError:
    print("INVALID false -"); sys.exit(0)
bad = [c["id"] + "=" + c["status"] for c in r.get("checks", []) if c.get("status") != "PASS"]
print(r.get("verdict", "INVALID"), str(bool(r.get("fixture"))).lower(), ",".join(bad) or "-")
' 2>/dev/null || echo "INVALID false -")"
read -r verdict fixture failing <<<"$summary"
printf '%s\n' "$report" >&2
case "$verdict" in PASS) expected_rc=0 ;; BLOCKED) expected_rc=1 ;; UNVERIFIED) expected_rc=3 ;; *) expected_rc=x ;; esac
if [[ "$rc" != "$expected_rc" ]]; then
  echo "RELEASE_GATE_REFUSED: doctor exit $rc inconsistent with verdict $verdict" >&2; exit 78
fi
# Decide first; fixtures report the decision but can never authorize.
decision=REFUSE
case "$verdict" in
  PASS) decision=AUTHORIZE ;;
  UNVERIFIED) [[ ${#reason} -lt 20 ]] || decision=AUTHORIZE_OVERRIDE ;;
esac
if [[ "$decision" == AUTHORIZE_OVERRIDE ]]; then
  log_dir="$HOME/Library/Logs/DexDiffusion"
  /bin/mkdir -p "$log_dir"
  printf '%s fixture=%s verdict=UNVERIFIED revision=%s failing=%s reason=%q\n' "$(/bin/date -u +%FT%TZ)" "$fixture" "$expect" "$failing" "$reason" \
    >> "$log_dir/release-gate-overrides.log"
  echo "RELEASE_GATE_OVERRIDE verdict=UNVERIFIED failing=$failing reason=$reason (logged to $log_dir/release-gate-overrides.log)" >&2
fi
if [[ "$fixture" == true ]]; then
  echo "GATE_FIXTURE verdict=$verdict decision=$decision failing=$failing (recorded facts never authorize a production action)"
  [[ "$decision" == REFUSE ]] && exit 78 || exit 79
fi
case "$decision" in
  AUTHORIZE) echo "RELEASE_GATE_PASS revision=$expect"; exit 0 ;;
  AUTHORIZE_OVERRIDE) echo "RELEASE_GATE_OVERRIDDEN revision=$expect"; exit 0 ;;
esac
if [[ "$verdict" == UNVERIFIED ]]; then
  echo "RELEASE_GATE_REFUSED verdict=UNVERIFIED failing=$failing (supply --override-unverified '<reason, 20+ chars>' only after manual verification)" >&2
else
  echo "RELEASE_GATE_REFUSED verdict=$verdict failing=$failing (BLOCKED cannot be overridden; fix the cause or use the rollback runbook)" >&2
fi
exit 78
