#!/usr/bin/env python3
"""Owned process-group watchdog. No inference starts before durable registration."""
import json
import os
from pathlib import Path
import signal
import subprocess
import sys
import time

root = Path(sys.argv[1])
parent = os.getppid()
args = json.loads(sys.stdin.readline())
deadline = time.time() + 1800
while not (root / 'registered').exists():
    if os.getppid() != parent or time.time() > deadline - 1785:
        sys.exit(125)
    time.sleep(.05)
child = subprocess.Popen(args)
try:
    while child.poll() is None:
        if os.getppid() != parent or time.time() >= deadline:
            os.killpg(os.getpgrp(), signal.SIGKILL)
        time.sleep(.2)
    sys.exit(child.returncode)
finally:
    if child.poll() is None:
        child.kill()
        child.wait()
