#!/usr/bin/env bash
# Select an existing interpreter to reproduce the unit suite; no installs or live writes.
# DEX_TEST_PYTHON=/absolute/venv/bin/python bash scripts/omni-test-environment.sh [--check]
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd -P)"
PY="$(printenv DEX_TEST_PYTHON 2>/dev/null || :)"
if [ -z "$PY" ]; then
  echo 'BLOCKED: set DEX_TEST_PYTHON to an existing Python 3.11+ interpreter with Pillow and NumPy.' >&2
  echo 'This script never changes global Python or installs packages.' >&2
  exit 2
fi
case "$PY" in /*) ;; *) echo 'BLOCKED: DEX_TEST_PYTHON must be an absolute path.' >&2; exit 2;; esac
if [ ! -x "$PY" ]; then echo 'BLOCKED: interpreter missing or not executable.' >&2; exit 2; fi
"$PY" - <<'PY'
import sys
if sys.version_info < (3, 11):
    raise SystemExit('BLOCKED: tests require Python 3.11 or newer')
from PIL import Image
import numpy
print('TEST_PYTHON=' + sys.executable)
print('PYTHON_VERSION=' + sys.version.split()[0])
print('PILLOW=' + Image.__version__)
print('NUMPY=' + numpy.__version__)
PY
if [ "$#" -eq 1 ]; then
  if [ "$1" = "--check" ]; then exit 0; fi
  echo 'Only --check or no argument is supported.' >&2
  exit 2
fi
SHIM="$(mktemp -d /tmp/dex-test-python.XXXXXXXX)"
trap 'rm -rf -- "$SHIM"' EXIT
cat > "$SHIM/python3" <<'PYSH'
#!/bin/sh
exec "$DEX_TEST_PYTHON" "$@"
PYSH
chmod 700 "$SHIM/python3"
export PATH="$SHIM:$PATH"
export DEX_WORLD_COMPILER_PYTHON="$PY"
export DEX_IMAGE_VALIDATION_PYTHON="$PY"
cd "$ROOT/operator-console"
npm run check
npm test
