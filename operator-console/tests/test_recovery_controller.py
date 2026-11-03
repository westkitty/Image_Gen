import importlib.util
import json
import threading
import tempfile
import unittest
import contextlib
import io
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from unittest.mock import patch

MODULE_PATH = Path(__file__).resolve().parents[2] / "scripts/dexdiffusion-recovery-controller.py"
SPEC = importlib.util.spec_from_file_location("dex_recovery_controller", MODULE_PATH)
controller = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(controller)


class RecoveryPolicyTests(unittest.TestCase):
    def test_first_failed_probe_is_suspect(self):
        state = {"failed_checks": 1, "episodes": []}
        result, _ = controller._decision(state, {"classification": "SSH_TUNNEL_ABSENT", "tunnel": "ABSENT", "resources": "IDLE"}, 1000)
        self.assertEqual(result, "SUSPECT")

    def test_two_independent_failures_allow_diagnosis(self):
        state = {"failed_checks": 2, "episodes": []}
        result, _ = controller._decision(state, {"classification": "SSH_TUNNEL_ABSENT", "tunnel": "ABSENT", "resources": "IDLE"}, 1000)
        self.assertEqual(result, "DIAGNOSING")

    def test_slow_studio_is_classified_without_backend_restart(self):
        result, _ = controller._decision({"failed_checks": 2, "episodes": []},
                                         {"classification": "STUDIO_TRANSFER_INCOMPLETE", "tunnel": "OWNED", "resources": "IDLE"}, 1000)
        self.assertEqual(result, "DIAGNOSING")

    def test_foreign_listener_is_blocked(self):
        result, reason = controller._decision({"failed_checks": 2, "episodes": []},
                                               {"classification": "FOREIGN_PORT_OWNER", "tunnel": "FOREIGN", "resources": "IDLE"}, 1000)
        self.assertEqual(result, "BLOCKED")
        self.assertIn("FOREIGN", reason)

    def test_resource_busy_defers_recovery(self):
        result, _ = controller._decision({"failed_checks": 2, "episodes": []},
                                         {"classification": "SSH_TUNNEL_ABSENT", "tunnel": "ABSENT", "resources": "BUSY"}, 1000)
        self.assertEqual(result, "BACKOFF")

    def test_rate_limit_opens_circuit(self):
        now = 10_000
        state = {"failed_checks": 2, "episodes": [now - 700, now - 400, now - 100]}
        result, _ = controller._decision(state, {"classification": "SSH_TUNNEL_ABSENT", "tunnel": "ABSENT", "resources": "IDLE"}, now)
        self.assertEqual(result, "CIRCUIT_OPEN")

    def test_cooldown_and_bounded_exponential_backoff(self):
        now = 10_000
        state = {"failed_checks": 2, "episodes": [now - 20], "last_episode_at": now - 20, "jitter_seconds": 5}
        result, _ = controller._decision(state, {"classification": "SSH_TUNNEL_ABSENT", "tunnel": "ABSENT", "resources": "IDLE"}, now)
        self.assertEqual(result, "BACKOFF")

    def test_state_survives_controller_restart_and_bad_state_fails_closed(self):
        with tempfile.TemporaryDirectory() as directory:
            state_path = Path(directory) / "state.json"
            support_path = Path(directory)
            with patch.object(controller, "STATE", state_path), patch.object(controller, "SUPPORT", support_path):
                original = {"schema": 1, "state": "CIRCUIT_OPEN", "episodes": [1, 2, 3]}
                controller._save_state(original)
                self.assertEqual(controller._read_state(), original)
                for corrupt in ("not json",
                                json.dumps({"schema": 1, "episodes": "not-a-list"}),
                                json.dumps({"schema": 1, "episodes": [], "updated_at": controller.time.time() + 3600}),
                                json.dumps({"schema": 1, "episodes": [], "publication_next_at": "soon"})):
                    state_path.write_text(corrupt)
                    invalid = controller._read_state()
                    # Corruption must never silently reset the episode budget.
                    self.assertEqual(invalid["state"], "BLOCKED")
                    self.assertTrue(invalid["state_invalid"])
                    self.assertTrue(invalid["circuit_open"])
                state_path.unlink()
                self.assertEqual(controller._read_state(), {})

    def test_http_200_with_truncated_studio_body_is_rejected(self):
        class TruncatedHandler(BaseHTTPRequestHandler):
            def do_GET(self):
                self.send_response(200)
                self.send_header("Content-Length", "20")
                self.end_headers()
                self.wfile.write(b"short")
                self.wfile.flush()
                self.close_connection = True

            def log_message(self, *_args):
                pass

        server = ThreadingHTTPServer(("127.0.0.1", 0), TruncatedHandler)
        worker = threading.Thread(target=server.serve_forever, daemon=True)
        worker.start()
        try:
            with patch.object(controller, "BASE", f"http://127.0.0.1:{server.server_port}"):
                with self.assertRaisesRegex(RuntimeError, "TRUNCATED_BODY"):
                    controller._request("/dexdiffusion/", 2)
        finally:
            server.shutdown()
            server.server_close()
            worker.join(timeout=2)

    def test_transient_failure_then_success_never_starts_repair(self):
        failure = {"classification": "SSH_TUNNEL_ABSENT", "backend": "UNKNOWN", "studio": "UNKNOWN",
                   "tunnel": "ABSENT", "resources": "UNKNOWN", "publication": "UNKNOWN"}
        healthy = {"classification": "NONE", "backend": "VERIFIED", "studio": "VERIFIED",
                   "tunnel": "OWNED", "resources": "IDLE", "publication": "CLEAR", "studio_bytes": 10}
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            with patch.object(controller, "SUPPORT", root), patch.object(controller, "STATE", root / "state.json"), \
                 patch.object(controller, "LOCK", root / "controller.lock"), patch.object(controller, "LOG", root / "controller.jsonl"), \
                 patch.object(controller, "probe", side_effect=[failure, healthy]), patch.object(controller.time, "sleep"), \
                 patch.object(controller, "_spawn_executor") as popen, patch.object(controller, "_status", return_value={}), contextlib.redirect_stdout(io.StringIO()):
                self.assertEqual(controller.run(), 0)
                popen.assert_not_called()
                saved = controller._read_state()
                self.assertEqual(saved["state"], "HEALTHY")
                self.assertEqual(saved["last_failure_classification"], "TRANSIENT_PROBE_FAILURE")

    def test_missing_ssh_authentication_blocks_mutation(self):
        failure = {"classification": "SSH_TUNNEL_ABSENT", "backend": "UNKNOWN", "studio": "UNKNOWN",
                   "tunnel": "ABSENT", "resources": "UNKNOWN", "publication": "UNKNOWN"}
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            with patch.object(controller, "SUPPORT", root), patch.object(controller, "STATE", root / "state.json"), \
                 patch.object(controller, "LOCK", root / "controller.lock"), patch.object(controller, "LOG", root / "controller.jsonl"), \
                 patch.object(controller, "probe", return_value=failure), patch.object(controller, "_remote_ready", return_value=(False, "SSH_AUTHENTICATION_UNAVAILABLE")), \
                 patch.object(controller.time, "sleep"), patch.object(controller, "_spawn_executor") as popen, patch.object(controller, "_status", return_value={}), \
                 contextlib.redirect_stdout(io.StringIO()):
                # BLOCKED is a nonzero outcome so launchd/CLI callers never read it as success.
                self.assertEqual(controller.run(), 1)
                popen.assert_not_called()
                saved = controller._read_state()
                self.assertEqual(saved["state"], "BLOCKED")
                self.assertEqual(saved["blocked_reason"], "SSH_AUTHENTICATION_UNAVAILABLE")


class ControllerRunTests(unittest.TestCase):
    FAILURE = {"classification": "SSH_TUNNEL_ABSENT", "backend": "UNKNOWN", "studio": "UNKNOWN",
               "tunnel": "ABSENT", "resources": "IDLE", "publication": "UNKNOWN"}
    HEALTHY = {"classification": "NONE", "backend": "VERIFIED", "studio": "VERIFIED",
               "tunnel": "OWNED", "resources": "IDLE", "publication": "CLEAR", "studio_bytes": 10}

    def isolated(self, root, **extra):
        stack = contextlib.ExitStack()
        for name, value in (("SUPPORT", root), ("STATE", root / "state.json"),
                            ("LOCK", root / "controller.lock"), ("LOG", root / "controller.jsonl")):
            stack.enter_context(patch.object(controller, name, value))
        stack.enter_context(patch.object(controller, "_status", return_value={}))
        stack.enter_context(patch.object(controller.time, "sleep"))
        stack.enter_context(contextlib.redirect_stdout(io.StringIO()))
        for name, value in extra.items():
            stack.enter_context(patch.object(controller, name, **value))
        return stack

    def test_already_healthy_ticks_never_mutate(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            with self.isolated(root, probe={"return_value": self.HEALTHY}) as _, \
                 patch.object(controller, "_spawn_executor") as executor, \
                 patch.object(controller, "_run_publication_sync") as sync:
                for _ in range(3):
                    self.assertEqual(controller.run(), 0)
                executor.assert_not_called()
                sync.assert_not_called()
                self.assertEqual(controller._read_state()["state"], "HEALTHY")

    def test_stale_verifying_is_reconciled_only_by_fresh_probe(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            with self.isolated(root, probe={"return_value": self.FAILURE},
                               _remote_ready={"return_value": (False, "DEX_RESOURCE_OR_ACTIVE_JOB_BUSY")}), \
                 patch.object(controller, "_spawn_executor") as executor:
                now = controller.time.time()
                controller._save_state({"schema": 1, "state": "VERIFYING", "episodes": [now - 100, now - 50],
                                        "last_episode_at": now - 50, "failed_checks": 0, "updated_at": now - 40})
                self.assertEqual(controller.run(), 1)
                saved = controller._read_state()
                self.assertNotEqual(saved["state"], "HEALTHY")
                self.assertEqual(len(saved["episodes"]), 2)
                executor.assert_not_called()
                self.assertIn("INTERRUPTED_RECOVERY", (root / "controller.jsonl").read_text())
            with self.isolated(root, probe={"return_value": self.HEALTHY}):
                self.assertEqual(controller.run(), 0)
                self.assertEqual(controller._read_state()["state"], "HEALTHY")

    def test_pending_publication_dispatches_once_and_backs_off_on_failure(self):
        pending = dict(self.HEALTHY, publication="PENDING")
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            with self.isolated(root, probe={"return_value": pending}), \
                 patch.object(controller, "_run_publication_sync", return_value=(1, "transfer failed")) as sync, \
                 patch.object(controller, "_spawn_executor") as executor:
                self.assertEqual(controller.run(), 0)
                self.assertEqual(controller.run(), 0)
                self.assertEqual(sync.call_count, 1)
                executor.assert_not_called()
                saved = controller._read_state()
                self.assertEqual(saved["publication_state"], "BACKOFF")
                self.assertEqual(saved["publication_failures"], 1)
                self.assertEqual(saved["state"], "HEALTHY")
            with self.isolated(root, probe={"return_value": pending}), \
                 patch.object(controller, "_run_publication_sync", return_value=(0, "[]")) as sync:
                state = controller._read_state(); state["publication_next_at"] = 0; controller._save_state(state)
                self.assertEqual(controller.run(), 0)
                sync.assert_called_once()
                saved = controller._read_state()
                self.assertEqual(saved["publication_state"], "SYNCED")
                self.assertEqual(saved["publication_failures"], 0)

    def test_unhealthy_route_never_dispatches_publication(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            with self.isolated(root, probe={"return_value": dict(self.FAILURE, publication="PENDING")},
                               _remote_ready={"return_value": (False, "BIG_MAC_BACKEND_OR_SERVICE_UNAVAILABLE")}), \
                 patch.object(controller, "_run_publication_sync") as sync:
                controller.run()
                sync.assert_not_called()

    def test_held_lock_reports_in_progress_without_action(self):
        import fcntl
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            with self.isolated(root, probe={"return_value": self.FAILURE}), \
                 patch.object(controller, "_spawn_executor") as executor, open(root / "controller.lock", "a+") as held:
                fcntl.flock(held, fcntl.LOCK_EX | fcntl.LOCK_NB)
                self.assertEqual(controller.run(), 0)
                executor.assert_not_called()
                self.assertFalse((root / "state.json").exists())


if __name__ == "__main__":
    unittest.main()
