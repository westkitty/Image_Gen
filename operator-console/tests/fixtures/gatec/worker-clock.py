"""Run the real engine-worker.py with a controllable clock (test-owned HOME only).

$HOME/gatec-clock-offset holds seconds added to time.time(); sleeps are capped so
the 10 s expiry loop observes clock jumps quickly. Nothing else is altered.
"""
import os
import runpy
import sys
import time

_real_time, _real_sleep = time.time, time.sleep
_offset_file = os.path.join(os.environ['HOME'], 'gatec-clock-offset')


def _offset():
    try:
        with open(_offset_file) as f:
            return float(f.read().strip() or 0)
    except (OSError, ValueError):
        return 0.0


time.time = lambda: _real_time() + _offset()
time.sleep = lambda s: _real_sleep(min(s, 0.2))
worker = sys.argv[1]
sys.argv = [worker] + sys.argv[2:]
runpy.run_path(worker, run_name='__main__')
