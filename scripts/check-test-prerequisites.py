#!/usr/bin/env python3
"""Fail fast, with one clear message, when a test prerequisite is missing.

Without Pillow the image-validation tests fail by the dozen with misleading
errors, so the suite runner calls this first. Read-only; installs nothing.
Exit 0 when satisfied, 2 when a prerequisite is missing.
"""
import os
import shutil
import subprocess
import sys

python = os.environ.get('DEX_IMAGE_VALIDATION_PYTHON') or shutil.which('python3') or 'python3'
missing = []
try:
    done = subprocess.run([python, '-c', 'import PIL'], capture_output=True, timeout=20)
    if done.returncode != 0:
        missing.append('Pillow is not importable by %s (pip install pillow, or point DEX_IMAGE_VALIDATION_PYTHON '
                       'and DEX_GATEC_PYTHON at an interpreter that has it)' % python)
except (OSError, subprocess.TimeoutExpired) as error:
    missing.append('image-validation interpreter %s cannot run: %s' % (python, error))
if not shutil.which('node'):
    missing.append('Node.js is not on PATH')
for item in missing:
    print('PREREQUISITE MISSING: ' + item, file=sys.stderr)
if not missing:
    print('TEST_PREREQUISITES_OK python=%s' % python)
sys.exit(2 if missing else 0)
