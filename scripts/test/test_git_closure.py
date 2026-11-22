"""Git closure gate regressions from the November 2026 release/cleanup failure."""
import json
from pathlib import Path
import subprocess
import sys
import tempfile
import unittest


ROOT = Path(__file__).resolve().parents[2]
GATE = ROOT / "scripts" / "check_git_closure.py"


def command(cwd, *argv):
    result = subprocess.run(list(argv), cwd=cwd, capture_output=True, text=True, timeout=20)
    if result.returncode:
        raise AssertionError("fixture command failed: " + " ".join(argv) + "\n" + result.stderr)
    return result.stdout.strip()


class GitClosureGateTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory(prefix="git-closure-test-")
        self.addCleanup(self.temp.cleanup)
        self.base = Path(self.temp.name)
        self.remote = self.base / "remote.git"
        self.work = self.base / "work"
        command(self.base, "git", "init", "--bare", "--initial-branch=main", str(self.remote))
        command(self.base, "git", "init", "--initial-branch=main", str(self.work))
        command(self.work, "git", "config", "user.email", "fixture@example.invalid")
        command(self.work, "git", "config", "user.name", "Fixture")
        (self.work / "tracked.txt").write_text("original\n")
        command(self.work, "git", "add", "tracked.txt")
        command(self.work, "git", "commit", "-m", "initial")
        command(self.work, "git", "remote", "add", "origin", str(self.remote))
        command(self.work, "git", "push", "-u", "origin", "main")

    def gate(self, *args):
        result = subprocess.run(
            [sys.executable, str(GATE), "--repo", str(self.work), "--branch", "main", *args],
            cwd=self.work, capture_output=True, text=True, timeout=30
        )
        return result.returncode, json.loads(result.stdout)

    def test_clean_and_pushed_is_git_pass_not_production_proof(self):
        rc, data = self.gate()
        self.assertEqual((rc, data["verdict"]), (0, "PASS"))
        self.assertTrue(data["git_only"])
        self.assertIn("installed production identity", data["not_proven"])

    def test_unstaged_staged_and_untracked_changes_block(self):
        file = self.work / "tracked.txt"
        file.write_text("changed\n")
        self.assertEqual(self.gate()[1]["verdict"], "BLOCKED")
        command(self.work, "git", "add", "tracked.txt")
        self.assertEqual(self.gate()[1]["verdict"], "BLOCKED")
        command(self.work, "git", "restore", "--staged", "tracked.txt")
        command(self.work, "git", "restore", "tracked.txt")
        (self.work / "pending.txt").write_text("untracked\n")
        self.assertEqual(self.gate()[1]["verdict"], "BLOCKED")

    def test_local_commit_not_pushed_blocks(self):
        (self.work / "tracked.txt").write_text("committed locally\n")
        command(self.work, "git", "commit", "-am", "unpublished")
        rc, data = self.gate()
        self.assertEqual((rc, data["verdict"]), (2, "BLOCKED"))
        self.assertTrue(any("remote SHA" in e for e in data["problems"]))

    def test_remote_advanced_but_local_not_updated_blocks(self):
        other = self.base / "other"
        command(self.base, "git", "clone", str(self.remote), str(other))
        command(other, "git", "config", "user.email", "fixture@example.invalid")
        command(other, "git", "config", "user.name", "Fixture")
        (other / "tracked.txt").write_text("new remote release\n")
        command(other, "git", "commit", "-am", "advance")
        command(other, "git", "push", "origin", "main")
        self.assertEqual(self.gate()[1]["verdict"], "BLOCKED")

    def test_remote_unavailable_is_unverified_not_pass(self):
        command(self.work, "git", "remote", "set-url", "origin", str(self.base / "missing.git"))
        rc, data = self.gate()
        self.assertEqual((rc, data["verdict"]), (3, "UNVERIFIED"))

    def test_unrelated_worktree_is_held_not_silently_clean(self):
        other = self.base / "other-worktree"
        command(self.work, "git", "worktree", "add", "-b", "unrelated", str(other))
        (other / "tracked.txt").write_text("important separate WIP\n")
        rc, data = self.gate("--inventory")
        self.assertEqual((rc, data["verdict"]), (0, "PASS"))
        self.assertTrue(any(w["path"] == str(other.resolve()) and w["state"] == "HELD"
                            for w in data["other_worktrees"]))
        self.assertEqual(self.gate("--scope-worktree", str(other))[1]["verdict"], "BLOCKED")

    def test_detached_head_is_not_a_clean_release_branch(self):
        command(self.work, "git", "checkout", "--detach", "HEAD")
        self.assertEqual(self.gate()[1]["verdict"], "BLOCKED")

    def test_claude_entrypoint_points_to_authoritative_rules(self):
        self.assertIn("AGENTS.md", (ROOT / "CLAUDE.md").read_text())
        agents = (ROOT / "AGENTS.md").read_text()
        self.assertIn("## Release and cleanup closure gate", agents)
        self.assertIn("scripts/check_git_closure.py", agents)
        self.assertIn("not", agents.lower())


if __name__ == "__main__":
    unittest.main()
