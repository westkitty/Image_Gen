#!/usr/bin/env python3
"""Start one command as a fully detached, double-forked process."""

from __future__ import annotations

import os
import sys


def main() -> int:
    if len(sys.argv) < 4:
        print("usage: detach-process.py WORKING_DIR LOG_FILE COMMAND [ARG ...]", file=sys.stderr)
        return 2

    working_dir, log_file, *command = sys.argv[1:]
    log_fd = os.open(log_file, os.O_WRONLY | os.O_CREAT | os.O_APPEND, 0o600)

    first_child = os.fork()
    if first_child:
        os.close(log_fd)
        return 0

    os.setsid()
    second_child = os.fork()
    if second_child:
        os._exit(0)

    try:
        os.chdir(working_dir)
        null_fd = os.open(os.devnull, os.O_RDONLY)
        os.dup2(null_fd, 0)
        os.dup2(log_fd, 1)
        os.dup2(log_fd, 2)
        if null_fd > 2:
            os.close(null_fd)
        if log_fd > 2:
            os.close(log_fd)
        os.execvp(command[0], command)
    except BaseException as exc:  # The parent has exited; preserve startup evidence in the log.
        message = f"DexDiffusion detached start failed: {exc}\n".encode("utf-8", "replace")
        try:
            os.write(2, message)
        finally:
            os._exit(127)


if __name__ == "__main__":
    raise SystemExit(main())
