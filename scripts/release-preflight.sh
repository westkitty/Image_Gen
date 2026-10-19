#!/usr/bin/env bash
# Release preflight: the ONLY pass/fail signal is the real exit status of each step, never a filtered pipeline.
#
#   scripts/release-preflight.sh            syntax check + full unit suite + all non-Style browser suites + git hygiene
#   DEX_PREFLIGHT_UNIT_ONLY=1 ...           skip browser suites
#   DEX_PREFLIGHT_BROWSER="a b" ...         run only these browser suites (basename without .browser.js)
#
# Protected Style suites (any browser suite whose name contains "style") are never run here.
# Exit 0 only if every step exited 0 AND the unit summary is internally consistent (tests>0, pass==tests, fail==0,
# cancelled==0, skipped reported). A truncated log (no summary) is a FAILURE. Nothing uses `|| true`.
set -uo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
CONSOLE="$ROOT/operator-console"
fail=0
step() { printf '%-5s %s\n' "$1" "$2"; }

# Signals must not orphan the exact child started by this preflight step.
ACTIVE_CHILD=""
ACTIVE_SCRATCH=""
stop_owned_step() {
  if [ -n "$ACTIVE_CHILD" ]; then
    kill -TERM "$ACTIVE_CHILD" 2>/dev/null || true
    wait "$ACTIVE_CHILD" 2>/dev/null || true
    ACTIVE_CHILD=""
  fi
  if [ -n "$ACTIVE_SCRATCH" ]; then
    rm -rf -- "$ACTIVE_SCRATCH"
    ACTIVE_SCRATCH=""
  fi
}
trap 'exit 143' TERM
trap 'exit 130' INT
trap 'stop_owned_step' EXIT

run_logged() { # name cmd... -> preserve real exit status, never leak temp
  local name="$1"; shift
  case "$name" in ''|*[!a-zA-Z0-9_-]*) step FAIL "unsafe preflight step name"; return 2;; esac
  local log="$LOGDIR/$name.log"
  local scratch="$LOGDIR/scratch-$name"
  mkdir -m 700 "$scratch" || return 2
  ACTIVE_SCRATCH="$scratch"
  TMPDIR="$scratch" "$@" >"$log" 2>&1 &
  ACTIVE_CHILD=$!
  wait "$ACTIVE_CHILD"
  local rc=$?
  ACTIVE_CHILD=""
  # This exact directory was created by this invocation, not a shared TMPDIR prefix.
  if ! rm -rf -- "$scratch"; then
    step FAIL "could not reclaim owned scratch for $name"
    return 2
  fi
  ACTIVE_SCRATCH=""
  RUN_LOG="$log"; return "$rc"
}

cd "$CONSOLE" || { echo "no operator-console"; exit 2; }

# Preserve a 6-GiB reserve on the MacBook before admitting heavy work.
verify_disk_reserve() {
  local min="${DEX_PREFLIGHT_MIN_FREE_KIB:-6291456}"
  local available
  case "$min" in ''|*[!0-9]*) step FAIL "invalid DEX_PREFLIGHT_MIN_FREE_KIB"; return 2;; esac
  available="$(df -Pk "$CONSOLE" | awk 'NR==2 {print $4}')"
  case "$available" in ''|*[!0-9]*) step FAIL "cannot determine available disk space"; return 2;; esac
  if [ "$available" -lt "$min" ]; then
    step FAIL "disk reserve: ${available} KiB available, ${min} KiB required"
    return 1
  fi
  return 0
}
verify_disk_reserve || exit 2
LOGDIR="$(mktemp -d "${TMPDIR:-/tmp}/dex-preflight-XXXXXX")" || exit 2

if [ "${DEX_PREFLIGHT_SKIP_CHECK:-0}" != "1" ]; then
  if git -C "$ROOT" diff --cached --check; then step PASS "git diff --cached --check"; else step FAIL "git diff --cached --check"; fail=1; fi
  if run_logged check npm run check; then step PASS "npm run check"; else step FAIL "npm run check (exit $?)"; tail -20 "$RUN_LOG"; fail=1; fi
fi

# DEX_PREFLIGHT_UNIT_CMD exists so the gate itself can be tested (tests/release-preflight.test.js).
if [ -n "${DEX_PREFLIGHT_UNIT_CMD:-}" ]; then
  run_logged unit sh -c "$DEX_PREFLIGHT_UNIT_CMD"; rc=$?
else
  # Explicit non-protected selection: a plain npm test also includes protected Style fixtures.
  unit_files=()
  while IFS= read -r file; do unit_files+=("$file"); done < <(
    find tests -maxdepth 1 -type f -name '*.test.js' ! -iname '*style*' ! -iname '*wildcard*' -print | LC_ALL=C sort
  )
  step SKIP "protected unit files (*style*, *wildcard*)"
  if [ "${#unit_files[@]}" -gt 0 ]; then run_logged unit node --test --test-concurrency=2 "${unit_files[@]}"; rc=$?
  else rc=2; RUN_LOG="$LOGDIR/unit.log"; printf 'no eligible unit files\n' >"$RUN_LOG"; fi
fi
tests=$(sed -n 's/^ℹ tests \([0-9][0-9]*\)$/\1/p' "$RUN_LOG" | tail -1)
pass=$(sed -n 's/^ℹ pass \([0-9][0-9]*\)$/\1/p' "$RUN_LOG" | tail -1)
failn=$(sed -n 's/^ℹ fail \([0-9][0-9]*\)$/\1/p' "$RUN_LOG" | tail -1)
canc=$(sed -n 's/^ℹ cancelled \([0-9][0-9]*\)$/\1/p' "$RUN_LOG" | tail -1)
skip=$(sed -n 's/^ℹ skipped \([0-9][0-9]*\)$/\1/p' "$RUN_LOG" | tail -1)
if [ "$rc" -eq 0 ] && [ -n "$tests" ] && [ "${tests:-0}" -gt 0 ] && [ "$pass" = "$tests" ] && [ "${failn:-x}" = "0" ] && [ "${canc:-x}" = "0" ]; then
  step PASS "unit suite: $pass/$tests passed, fail=$failn cancelled=$canc skipped=${skip:-?} (exit $rc)"
else
  step FAIL "unit suite: exit=$rc tests=${tests:-none} pass=${pass:-none} fail=${failn:-none} cancelled=${canc:-none}"
  grep -E '^✖' "$RUN_LOG" | head -20; fail=1
fi

if [ "${DEX_PREFLIGHT_UNIT_ONLY:-0}" != "1" ]; then
  if [ -n "${DEX_PREFLIGHT_BROWSER:-}" ]; then suites="$DEX_PREFLIGHT_BROWSER"
  else suites="$(cd tests/browser && ls *.browser.js | sed 's/\.browser\.js$//' | grep -Evi 'style|wildcard' | sort | tr '\n' ' ')"; fi
  for s in $suites; do
    case "$s" in *[Ss][Tt][Yy][Ll][Ee]*|*[Ww][Ii][Ll][Dd][Cc][Aa][Rr][Dd]*) step SKIP "browser:$s (protected suite)"; continue;; esac
    verify_disk_reserve || { fail=1; break; }
    # interaction-matrix writes into output/; keep it away from archived revisions
    run_logged "b-$s" env DEX_MATRIX_OUTPUT_DIR="$LOGDIR/matrix" DEX_RELEASE_OUTPUT_DIR="$LOGDIR/rel" timeout -k 15s 600s node "tests/browser/$s.browser.js"; rc=$?
    p=$(grep -c '^\[[^]]*\] PASS ' "$RUN_LOG"); f=$(grep -c '^\[[^]]*\] FAIL ' "$RUN_LOG")
    if [ "$rc" -eq 0 ] && [ "$f" -eq 0 ] && [ "$p" -gt 0 ]; then step PASS "browser:$s ($p scenarios)"
    else step FAIL "browser:$s exit=$rc pass=$p fail=$f (log $RUN_LOG)"; fail=1; fi
  done
fi

# Scratch directories belong to their creating test processes. Never globally sweep TMPDIR.
if [ "$fail" -eq 0 ]; then step PASS "RELEASE PREFLIGHT"; rm -rf "$LOGDIR"; exit 0; fi
step FAIL "RELEASE PREFLIGHT (logs: $LOGDIR)"; exit 1
