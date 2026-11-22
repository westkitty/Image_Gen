#!/usr/bin/env python3
"""Read-only Git closure check. Never treats Git success as deployment or CI proof."""
import argparse
import json
import os
from pathlib import Path
import subprocess
import sys


class GitCheckError(Exception):
    pass


def git(directory, *args):
    env = dict(os.environ, GIT_TERMINAL_PROMPT="0")
    try:
        result = subprocess.run(
            ["git", "-C", str(directory), *args],
            text=True, capture_output=True, timeout=15, env=env, check=False
        )
    except (OSError, subprocess.TimeoutExpired) as exc:
        raise GitCheckError(type(exc).__name__) from exc
    if result.returncode:
        raise GitCheckError("git command unavailable: " + " ".join(args[:2]))
    return result.stdout.rstrip("\n")


def checkout(directory):
    root = Path(git(directory, "rev-parse", "--show-toplevel")).resolve()
    try:
        branch = git(root, "symbolic-ref", "--quiet", "--short", "HEAD")
    except GitCheckError:
        branch = "(detached)"
    lines = git(root, "status", "--porcelain=v1", "--untracked-files=normal").splitlines()
    return {
        "root": str(root), "branch": branch,
        "head": git(root, "rev-parse", "HEAD"),
        "dirty": bool(lines),
        "staged": sum(bool(line) and line[0] not in (" ", "?") for line in lines),
        "unstaged": sum(len(line) > 1 and line[1] not in (" ", "?") for line in lines),
        "untracked": sum(line.startswith("??") for line in lines),
    }


def run(args):
    problems, unknowns = [], []
    try:
        primary = checkout(Path(args.repo).resolve())
    except GitCheckError:
        return {"verdict": "BLOCKED", "problems": ["not a readable Git worktree"],
                "not_proven": ["CI", "installed runtime", "live generation", "publication"]}

    branch = args.branch or primary["branch"]
    if primary["branch"] != branch or branch == "(detached)":
        problems.append("current branch does not match the requested branch")
    if primary["dirty"]:
        problems.append("primary worktree has staged, unstaged or untracked changes")

    primary["remote"] = args.remote
    try:
        lines = git(primary["root"], "ls-remote", "--heads", args.remote, "refs/heads/" + branch).splitlines()
        remote_sha = lines[0].split()[0] if len(lines) == 1 else None
        primary["remote_head"] = remote_sha
        if remote_sha is None:
            problems.append("requested remote branch is absent")
        elif remote_sha != primary["head"]:
            problems.append("local HEAD differs from the independently read remote SHA")
    except GitCheckError:
        primary["remote_head"] = None
        unknowns.append("remote branch could not be verified")

    held = []
    listed = {}
    if args.inventory or args.scope_worktree:
        try:
            rows = git(primary["root"], "worktree", "list", "--porcelain").splitlines()
            for line in rows:
                if line.startswith("worktree "):
                    listed[str(Path(line[9:]).resolve())] = True
        except GitCheckError:
            unknowns.append("Git worktree inventory unavailable")
        for path in listed:
            if path == primary["root"]:
                continue
            try:
                state = checkout(path)
                held.append({"path": path, "state": "HELD" if state["dirty"] else "CLEAN",
                             "branch": state["branch"], "dirty": state["dirty"]})
            except GitCheckError:
                held.append({"path": path, "state": "UNVERIFIED", "dirty": None})
        for target in args.scope_worktree:
            target_path = str(Path(target).resolve())
            if target_path not in listed and target_path != primary["root"]:
                problems.append("scoped worktree was not found: " + target_path)
                continue
            if target_path == primary["root"]:
                continue
            entry = next((row for row in held if row["path"] == target_path), None)
            if entry is None or entry["state"] != "CLEAN":
                problems.append("scoped worktree not verified clean: " + target_path)

    verdict = "BLOCKED" if problems else ("UNVERIFIED" if unknowns else "PASS")
    return {
        "verdict": verdict,
        "git_only": True,
        "primary": primary,
        "other_worktrees": held if args.inventory or args.scope_worktree else [],
        "problems": problems, "unknowns": unknowns,
        "not_proven": ["CI on the release SHA", "installed production identity",
                       "real fallback or generation", "MacBook publication and receipts"],
    }


def main(argv=None):
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--repo", default=".", help="primary local Git worktree")
    parser.add_argument("--branch", help="expected checked-out and published branch")
    parser.add_argument("--remote", default="origin")
    parser.add_argument("--inventory", action="store_true",
                        help="report other worktrees as CLEAN, HELD or UNVERIFIED")
    parser.add_argument("--scope-worktree", action="append", default=[],
                        help="additional worktree required clean (repeatable)")
    args = parser.parse_args(argv)
    report = run(args)
    print(json.dumps(report, indent=2, sort_keys=True))
    return {"PASS": 0, "BLOCKED": 2, "UNVERIFIED": 3}[report["verdict"]]


if __name__ == "__main__":
    sys.exit(main())
