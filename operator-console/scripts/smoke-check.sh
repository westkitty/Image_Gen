#!/usr/bin/env bash
# smoke-check.sh — fast regression check for the Operator Console.
# Does NOT generate images. Does NOT require BigMac. Does NOT require model files.
# Validates syntax, endpoint contract, and input rejection gates.
#
# Usage:
#   bash operator-console/scripts/smoke-check.sh
#   bash operator-console/scripts/smoke-check.sh --no-server  # skip live endpoint tests
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
OC_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"
SKIP_SERVER=0

for arg in "$@"; do
  case "$arg" in --no-server) SKIP_SERVER=1 ;; esac
done

PASS_COUNT=0
FAIL_COUNT=0
RESULTS=()

pass() { PASS_COUNT=$((PASS_COUNT+1)); RESULTS+=("PASS  $1"); }
fail() { FAIL_COUNT=$((FAIL_COUNT+1)); RESULTS+=("FAIL  $1"); }

echo "=== SDCPP Workbench Smoke Check ==="
echo "OC dir: $OC_DIR"
echo ""

# ---- Syntax checks -----------------------------------------------------------
echo "-- Syntax --"
if node --check "$OC_DIR/server.js" 2>/dev/null; then
  pass "node --check server.js"
else
  fail "node --check server.js"
fi

if node --check "$OC_DIR/public/app.js" 2>/dev/null; then
  pass "node --check public/app.js"
else
  fail "node --check public/app.js"
fi

# Also check scripts in sdcpp-workflow/bin if accessible
WORKFLOW_BIN="$(cd "$OC_DIR/../sdcpp-workflow/bin" 2>/dev/null && pwd)" || true
if [ -n "$WORKFLOW_BIN" ] && [ -d "$WORKFLOW_BIN" ]; then
  for sh in sdcpp-upscale.sh sdcpp-discover-assets.sh sdcpp-xyz-plot.sh sdcpp-hires-fix.sh; do
    if [ -f "$WORKFLOW_BIN/$sh" ]; then
      if bash -n "$WORKFLOW_BIN/$sh" 2>/dev/null; then
        pass "bash -n $sh"
      else
        fail "bash -n $sh"
      fi
    fi
  done
fi

# ---- Live endpoint tests (require server on 31337) ---------------------------
if [ "$SKIP_SERVER" = "1" ]; then
  echo ""
  echo "-- Skipping live endpoint tests (--no-server) --"
else
  echo ""
  echo "-- Live endpoints (http://127.0.0.1:31337) --"

  BASE="http://127.0.0.1:31337"

  # /api/capabilities
  if curl -fsS "$BASE/api/capabilities" -o /dev/null 2>/dev/null; then
    pass "GET /api/capabilities responds"
  else
    fail "GET /api/capabilities (is server running on 31337?)"
  fi

  # /api/run-index
  if curl -fsS "$BASE/api/run-index?limit=5" -o /dev/null 2>/dev/null; then
    pass "GET /api/run-index?limit=5 responds"
  else
    fail "GET /api/run-index?limit=5 (is server running?)"
  fi

  # Upscale: absolute path must be rejected (400)
  STATUS="$(curl -s -o /dev/null -w '%{http_code}' -X POST "$BASE/api/actions/upscale" \
    -H 'Content-Type: application/json' \
    -d '{"path":"/etc/passwd","scale":2,"resample":"lanczos"}' 2>/dev/null)"
  if [ "$STATUS" = "400" ]; then
    pass "Upscale rejects absolute path (HTTP 400)"
  else
    fail "Upscale absolute path should return 400 (got $STATUS)"
  fi

  # Upscale: traversal must be rejected (400)
  STATUS="$(curl -s -o /dev/null -w '%{http_code}' -X POST "$BASE/api/actions/upscale" \
    -H 'Content-Type: application/json' \
    -d '{"path":"../../etc/passwd","scale":2,"resample":"lanczos"}' 2>/dev/null)"
  if [ "$STATUS" = "400" ]; then
    pass "Upscale rejects traversal path (HTTP 400)"
  else
    fail "Upscale traversal should return 400 (got $STATUS)"
  fi

  # Upscale: invalid scale must be rejected (400)
  STATUS="$(curl -s -o /dev/null -w '%{http_code}' -X POST "$BASE/api/actions/upscale" \
    -H 'Content-Type: application/json' \
    -d '{"path":"somerun/image.png","scale":99,"resample":"lanczos"}' 2>/dev/null)"
  if [ "$STATUS" = "400" ]; then
    pass "Upscale rejects invalid scale (HTTP 400)"
  else
    fail "Upscale invalid scale should return 400 (got $STATUS)"
  fi

  # Hires Fix: missing prompt must be rejected (400)
  STATUS="$(curl -s -o /dev/null -w '%{http_code}' -X POST "$BASE/api/actions/hires-fix" \
    -H 'Content-Type: application/json' \
    -d '{"scale":2,"resample":"lanczos"}' 2>/dev/null)"
  if [ "$STATUS" = "400" ]; then
    pass "Hires Fix rejects missing prompt (HTTP 400)"
  else
    fail "Hires Fix missing prompt should return 400 (got $STATUS)"
  fi

  # Hires Fix: invalid scale must be rejected (400)
  STATUS="$(curl -s -o /dev/null -w '%{http_code}' -X POST "$BASE/api/actions/hires-fix" \
    -H 'Content-Type: application/json' \
    -d '{"prompt":"test","scale":99}' 2>/dev/null)"
  if [ "$STATUS" = "400" ]; then
    pass "Hires Fix rejects invalid scale (HTTP 400)"
  else
    fail "Hires Fix invalid scale should return 400 (got $STATUS)"
  fi

  # XYZ: >16 cells must be rejected (400)
  STATUS="$(curl -s -o /dev/null -w '%{http_code}' -X POST "$BASE/api/actions/xyz-plot" \
    -H 'Content-Type: application/json' \
    -d '{"prompt":"test","x_type":"steps","x_values":"10,20,30,40,50","y_type":"cfg","y_values":"5,6,7,8"}' \
    2>/dev/null)"
  if [ "$STATUS" = "400" ]; then
    pass "XYZ plot rejects >16 cells (HTTP 400)"
  else
    fail "XYZ >16 cells should return 400 (got $STATUS)"
  fi

  # Run-index: huge limit should be capped, not error
  BODY="$(curl -fsS "$BASE/api/run-index?limit=99999" 2>/dev/null)"
  if printf '%s' "$BODY" | python3 -c "import sys,json; d=json.load(sys.stdin); assert 'runs' in d" 2>/dev/null; then
    pass "GET /api/run-index?limit=99999 capped and returns runs array"
  else
    fail "GET /api/run-index?limit=99999 unexpected response"
  fi
fi

# ---- Summary -----------------------------------------------------------------
echo ""
echo "=== Results ==="
for r in "${RESULTS[@]}"; do echo "  $r"; done
echo ""
echo "PASS: $PASS_COUNT  FAIL: $FAIL_COUNT"
if [ "$FAIL_COUNT" -eq 0 ]; then
  echo ""
  echo "==== PASS ===="
  exit 0
else
  echo ""
  echo "==== FAIL ===="
  exit 1
fi
