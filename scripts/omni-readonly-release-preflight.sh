#!/usr/bin/env bash
# Read-only fingerprints only; never an automatic deployment or release certificate.
set -u
ROOT="$(cd "$(dirname "$0")/.." && pwd -P)"
cd "$ROOT" || exit 1
echo 'DEX_OMNI_RELEASE_PREFLIGHT_V1'
echo "repo=$ROOT"
echo "hostname=$(hostname -s)"
echo "user=$(id -un)"
echo "branch=$(git branch --show-current 2>/dev/null || echo unknown)"
echo "head=$(git rev-parse HEAD 2>/dev/null || echo unknown)"
echo "origin=$(git remote get-url origin 2>/dev/null || echo unavailable)"
echo "git_dirty_count=$(git status --porcelain 2>/dev/null | wc -l | tr -d ' ')"
echo "node=$(node --version 2>/dev/null || echo missing)"
echo "npm=$(npm --version 2>/dev/null || echo missing)"
PYTHON_BIN="$(printenv DEX_TEST_PYTHON 2>/dev/null || true)"
if [ -z "$PYTHON_BIN" ]; then PYTHON_BIN="$(command -v python3 2>/dev/null || true)"; fi
if [ -n "$PYTHON_BIN" ] && [ -x "$PYTHON_BIN" ]; then
  "$PYTHON_BIN" - <<'PY'
import sys, importlib.util
print("python_executable=" + sys.executable)
print("python_version=" + sys.version.split()[0])
print("pillow=" + ("available" if importlib.util.find_spec("PIL") else "missing"))
PY
else
  echo 'python=unavailable'
fi
echo 'port_31337_listener:'
lsof -nP -iTCP:31337 -sTCP:LISTEN 2>/dev/null || echo 'none-or-inaccessible'
echo 'server_api_version:'
curl --silent --show-error --fail --max-time 4 http://127.0.0.1:31337/api/version 2>&1 || echo 'UNVERIFIED'
echo 'native_app:'
if [ -d /Applications/DexDiffusion.app ]; then
  echo 'installed=yes'
  plutil -extract CFBundleIdentifier raw -o - /Applications/DexDiffusion.app/Contents/Info.plist 2>/dev/null || echo 'bundle_id_unavailable'
else
  echo 'installed=no-or-remote-host'
fi
echo 'physical_native_dock_click=UNVERIFIED_REQUIRES_WITNESSED_MACBOOK_TEST'
echo 'test_suite=NOT_RUN_BY_THIS_SCRIPT'
echo 'privacy_exposure=NOT_A_SECURITY_CERTIFICATE'
