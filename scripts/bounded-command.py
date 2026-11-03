#!/usr/bin/env python3
"""Run one shell command in an owned process group with a hard timeout."""
import argparse
import os
import selectors
import signal
import subprocess
import sys
import time


def run(command: str, timeout: float, output_limit: int) -> tuple[int, bytes]:
    process = subprocess.Popen(
        ["/bin/bash", "-lc", command],
        stdout=subprocess.PIPE,
        stderr=subprocess.STDOUT,
        start_new_session=True,
        close_fds=True,
    )
    assert process.stdout is not None
    selector = selectors.DefaultSelector()
    selector.register(process.stdout, selectors.EVENT_READ)
    captured = bytearray()
    truncated = False
    deadline = time.monotonic() + max(0.05, timeout)
    timed_out = False
    try:
        while True:
            remaining = deadline - time.monotonic()
            if remaining <= 0 and process.poll() is None:
                timed_out = True
                break
            events = selector.select(max(0.0, min(0.1, remaining)))
            for key, _ in events:
                chunk = os.read(key.fd, 16384)
                if not chunk:
                    try:
                        selector.unregister(key.fileobj)
                    except Exception:
                        pass
                    continue
                available = max(0, output_limit - len(captured))
                if available:
                    captured.extend(chunk[:available])
                if len(chunk) > available:
                    truncated = True
            if process.poll() is not None and not selector.get_map():
                break
            if process.poll() is not None and not events:
                # Drain EOF after the command has exited.
                continue
        if timed_out:
            try:
                os.killpg(process.pid, signal.SIGTERM)
            except ProcessLookupError:
                pass
            try:
                process.wait(timeout=0.4)
            except subprocess.TimeoutExpired:
                try:
                    os.killpg(process.pid, signal.SIGKILL)
                except ProcessLookupError:
                    pass
                process.wait()
            # The child group is gone; consume any already-buffered output.
            end = time.monotonic() + 0.4
            while selector.get_map() and time.monotonic() < end:
                for key, _ in selector.select(0.05):
                    chunk = os.read(key.fd, 16384)
                    if not chunk:
                        selector.unregister(key.fileobj)
                        continue
                    available = max(0, output_limit - len(captured))
                    if available:
                        captured.extend(chunk[:available])
                    if len(chunk) > available:
                        truncated = True
            return 124, bytes(captured) + (b"\n[output truncated]" if truncated else b"")
        return int(process.returncode or 0), bytes(captured) + (b"\n[output truncated]" if truncated else b"")
    finally:
        selector.close()
        process.stdout.close()
        if process.poll() is None:
            try:
                os.killpg(process.pid, signal.SIGKILL)
            except ProcessLookupError:
                pass
            process.wait()


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--timeout", required=True, type=float)
    parser.add_argument("--output-limit", type=int, default=65536)
    parser.add_argument("command")
    args = parser.parse_args()
    code, output = run(args.command, args.timeout, max(1024, args.output_limit))
    sys.stdout.buffer.write(output)
    if code == 124:
        sys.stdout.write(f"\nTimed out: {args.command}\n")
    return code


if __name__ == "__main__":
    raise SystemExit(main())
