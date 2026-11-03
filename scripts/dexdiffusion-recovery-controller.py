#!/usr/bin/env python3
"""Bounded per-user DexDiffusion recovery controller.

The controller is a one-shot launchd task. It owns policy and durable state;
bin/dexdiffusion remains the only repair executor and enforces the shared lock
and process-ownership checks before changing a tunnel or service.
"""
from __future__ import annotations

import argparse
import fcntl
import hashlib
import http.client
import json
import math
import os
import random
import signal
import shlex
import socket
import subprocess
import sys
import tempfile
import time
import urllib.error
import urllib.request
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
CLI = ROOT / "bin" / "dexdiffusion"
BASE = "http://127.0.0.1:31337"
REMOTE = "westcat"
EXPECTED_CWD = "/Users/bigmac/Image_Gen/operator-console"
SUPPORT = Path.home() / "Library/Application Support/DexDiffusion/recovery"
STATE = SUPPORT / "state.json"
LOCK = SUPPORT / "controller.lock"
LOG = SUPPORT / "controller.jsonl"
MAX_LOG = 128 * 1024
MAX_EPISODES = int(os.environ.get("DEX_RECOVERY_MAX_EPISODES", "3"))
WINDOW_SECONDS = int(os.environ.get("DEX_RECOVERY_WINDOW_SECONDS", "900"))
COOLDOWN_SECONDS = int(os.environ.get("DEX_RECOVERY_COOLDOWN_SECONDS", "60"))
HEALTH_RESET_SECONDS = int(os.environ.get("DEX_RECOVERY_HEALTH_RESET_SECONDS", "300"))
EPISODE_SECONDS = int(os.environ.get("DEX_RECOVERY_EPISODE_SECONDS", "105"))
EPISODE_WALL_SECONDS = int(os.environ.get("DEX_RECOVERY_WALL_SECONDS", "180"))
PUBLICATION_SECONDS = int(os.environ.get("DEX_PUBLICATION_SYNC_SECONDS", "90"))
PUBLICATION_MAX_BACKOFF = int(os.environ.get("DEX_PUBLICATION_MAX_BACKOFF_SECONDS", "900"))
IN_FLIGHT_STATES = ("DIAGNOSING", "RECOVERING", "VERIFYING")


def _request(path: str, timeout: float, limit: int = 2_000_000) -> tuple[int, bytes, dict[str, str]]:
    # curl's max-time is a total transfer deadline, including a slow trickle.
    # A socket-read timeout alone does not bound the complete body transfer.
    with tempfile.TemporaryDirectory(prefix="dex-recovery-probe-") as directory:
        body_file, headers_file = Path(directory) / "body", Path(directory) / "headers"
        try:
            response = subprocess.run(["/usr/bin/curl", "--silent", "--show-error", "--fail",
                                       "--max-time", str(timeout), "--max-filesize", str(limit),
                                       "--dump-header", str(headers_file), "--output", str(body_file),
                                       "--write-out", "%{http_code}", BASE + path],
                                      capture_output=True, text=True, timeout=timeout + 1, check=False)
        except subprocess.TimeoutExpired as exc:
            raise RuntimeError("TRANSFER_DEADLINE") from exc
        if response.returncode:
            raise RuntimeError("TRUNCATED_BODY" if response.returncode == 18 else "TRANSFER_FAILED_" + str(response.returncode))
        if response.stdout != "200":
            raise RuntimeError("HTTP_" + response.stdout)
        body = body_file.read_bytes()
        if len(body) > limit:
            raise RuntimeError("RESPONSE_TOO_LARGE")
        headers = {}
        for line in headers_file.read_text(errors="replace").splitlines():
            if ":" in line:
                key, value = line.split(":", 1)
                headers[key.lower()] = value.strip()
        expected = headers.get("content-length")
        if expected is not None and len(body) != int(expected):
            raise RuntimeError("TRUNCATED_BODY")
        return 200, body, headers


def _owned_tunnel() -> tuple[str, str | None]:
    try:
        raw = subprocess.run(["/usr/sbin/lsof", "-nP", "-iTCP:31337", "-sTCP:LISTEN", "-t"],
                             capture_output=True, text=True, timeout=3, check=False).stdout
        pids = [line.strip() for line in raw.splitlines() if line.strip().isdigit()]
    except (OSError, subprocess.TimeoutExpired):
        return "UNKNOWN", None
    if not pids:
        return "ABSENT", None
    pid = pids[0]
    try:
        cmd = subprocess.run(["/bin/ps", "-ww", "-o", "command=", "-p", pid],
                             capture_output=True, text=True, timeout=3, check=False).stdout.strip()
        argv = shlex.split(cmd)
    except (OSError, subprocess.TimeoutExpired, ValueError):
        return "UNKNOWN", pid
    exact = ["-f", "-N", "-o", "ExitOnForwardFailure=yes", "-o", "ServerAliveInterval=15",
             "-o", "ServerAliveCountMax=3", "-L", "31337:127.0.0.1:31337", REMOTE]
    legacy = ["-f", "-N", "-o", "ExitOnForwardFailure=yes", "-L", "31337:127.0.0.1:31337", REMOTE]
    if argv and Path(argv[0]).name == "ssh" and argv[1:] in (exact, legacy):
        return "OWNED", pid
    return "FOREIGN", pid


def probe(deadline: float | None = None) -> dict:
    def bounded_timeout(seconds: float) -> float:
        return max(0.1, min(seconds, deadline - time.monotonic())) if deadline is not None else seconds
    result = {"backend": "UNKNOWN", "studio": "UNKNOWN", "tunnel": "UNKNOWN",
              "classification": "UNKNOWN", "detail": None, "backend_identity": None,
              "studio_bytes": None, "resources": "UNKNOWN", "publication": "UNKNOWN"}
    result["tunnel"], _pid = _owned_tunnel()
    try:
        _, body, _ = _request("/api/version", bounded_timeout(5), 64 * 1024)
        version = json.loads(body)
        if (version.get("name") != "Image_Gen Operator Console" or
                version.get("cwd") != EXPECTED_CWD or not str(version.get("pid", "")).isdigit()):
            result["backend"] = "UNEXPECTED_IDENTITY"
            result["classification"] = "AMBIGUOUS_BACKEND_IDENTITY"
            return result
        result["backend"] = "VERIFIED"
        result["backend_identity"] = {k: version.get(k) for k in ("gitHead", "pid", "cwd", "startedAt")}
        try:
            _, html, _ = _request("/dexdiffusion/", bounded_timeout(15), 2_000_000)
            if b"</html>" not in html.lower() or b"DexDiffusion" not in html:
                raise RuntimeError("INCOMPLETE_STUDIO_DOCUMENT")
            result["studio"] = "VERIFIED"
            result["studio_bytes"] = len(html)
        except Exception as exc:  # classification only; never mutates the service
            result["studio"] = "FAILED"
            result["detail"] = type(exc).__name__ + ":" + str(exc)[:100]
            result["classification"] = "STUDIO_TRANSFER_INCOMPLETE"
        try:
            _, body, _ = _request("/api/resources", bounded_timeout(4), 128 * 1024)
            resources = json.loads(body)
            owner = resources.get("owner")
            waiting = resources.get("waiting") or []
            result["resources"] = "BUSY" if owner or waiting or resources.get("quarantine") or resources.get("blocked_reason") or (resources.get("external") or {}).get("occupied") else "IDLE"
        except Exception:
            pass
        try:
            _, body, _ = _request("/api/publications/status", bounded_timeout(4), 128 * 1024)
            publication = json.loads(body)
            result["publication"] = "PENDING" if int(publication.get("pending", 0)) else "CLEAR"
        except Exception:
            pass
        if result["tunnel"] != "OWNED":
            result["classification"] = "FOREIGN_PORT_OWNER"
        elif result["studio"] == "VERIFIED":
            result["classification"] = "NONE"
        return result
    except (urllib.error.URLError, TimeoutError, OSError, ValueError, RuntimeError) as exc:
        result["detail"] = type(exc).__name__ + ":" + str(exc)[:100]
        if result["tunnel"] == "FOREIGN":
            result["classification"] = "FOREIGN_PORT_OWNER"
        elif result["tunnel"] == "ABSENT":
            result["classification"] = "SSH_TUNNEL_ABSENT"
        else:
            result["classification"] = "BACKEND_OR_TUNNEL_UNAVAILABLE"
        return result


def _remote_ready(deadline: float | None = None) -> tuple[bool, str]:
    def bounded_timeout(seconds: float) -> float:
        return max(0.1, min(seconds, deadline - time.monotonic())) if deadline is not None else seconds
    try:
        auth = subprocess.run(["/usr/bin/ssh", "-o", "BatchMode=yes", "-o", "ConnectTimeout=6", REMOTE,
                               "printf DEX_SSH_REACHABLE"], capture_output=True, text=True,
                              timeout=bounded_timeout(10), check=False)
        if auth.returncode or auth.stdout.strip() != "DEX_SSH_REACHABLE":
            return False, "SSH_AUTHENTICATION_UNAVAILABLE"
    except (OSError, subprocess.TimeoutExpired):
        return False, "SSH_AUTHENTICATION_UNAVAILABLE"
    command = ("python3 -c 'import json,urllib.request; "+
               "d=json.load(urllib.request.urlopen(\"http://127.0.0.1:31337/api/version\",timeout=4)); "+
               "assert d.get(\"name\")==\"Image_Gen Operator Console\" and "+
               "d.get(\"cwd\")==\"/Users/bigmac/Image_Gen/operator-console\" and "+
               "str(d.get(\"pid\",\"\")).isdigit()' && "+
               "curl -fsS --max-time 15 http://127.0.0.1:31337/dexdiffusion/ -o /dev/null && "+
               "python3 -c 'import json,urllib.request; "+
               "r=json.load(urllib.request.urlopen(\"http://127.0.0.1:31337/api/resources\",timeout=4)); "+
               "j=json.load(urllib.request.urlopen(\"http://127.0.0.1:31337/api/jobs\",timeout=4)); "+
               "jobs=j if isinstance(j,list) else j.get(\"jobs\",[]); "+
               "active=[x for x in jobs if str(x.get(\"status\",\"\")).lower() in (\"pending\",\"waiting\",\"queued\",\"claimed\",\"running\",\"starting\",\"transferring\",\"cancelling\")]; "+
               "print(\"DEX_RESOURCE_BUSY\" if r.get(\"owner\") or r.get(\"waiting\") or r.get(\"quarantine\") or r.get(\"blocked_reason\") or (r.get(\"external\") or {}).get(\"occupied\") or active else \"DEX_RECOVERY_ADMITTED\")'")
    try:
        p = subprocess.run(["/usr/bin/ssh", "-o", "BatchMode=yes", "-o", "ConnectTimeout=6", REMOTE,
                            command], capture_output=True, text=True, timeout=bounded_timeout(20), check=False)
        if "DEX_RESOURCE_BUSY" in p.stdout:
            return False, "DEX_RESOURCE_OR_ACTIVE_JOB_BUSY"
        if p.returncode or "DEX_RECOVERY_ADMITTED" not in p.stdout:
            return False, "BIG_MAC_BACKEND_OR_SERVICE_UNAVAILABLE"
        return True, "REMOTE_BACKEND_AND_RESOURCE_IDLE"
    except (OSError, subprocess.TimeoutExpired, ValueError):
        return False, "BIG_MAC_BACKEND_OR_SERVICE_UNAVAILABLE"


def _read_state() -> dict:
    invalid = {"schema": 1, "state": "BLOCKED", "state_invalid": True, "circuit_open": True,
               "reason": "recovery state is malformed; preserve it and use explicit recovery-retry"}
    try:
        if STATE.stat().st_size > 64 * 1024:
            return invalid
        value = json.loads(STATE.read_text())
        if not isinstance(value, dict) or value.get("schema") != 1:
            return invalid
        episodes = value.get("episodes", [])
        if not isinstance(episodes, list) or len(episodes) > 32:
            return invalid
        for timestamp in episodes:
            if not isinstance(timestamp, (int, float)) or not math.isfinite(timestamp):
                return invalid
        for key in ("last_episode_at", "last_check_at", "healthy_since", "latest_verified_healthy_at", "updated_at"):
            timestamp = value.get(key)
            if timestamp is not None and (not isinstance(timestamp, (int, float)) or not math.isfinite(timestamp) or timestamp > time.time() + 300):
                return invalid
        if not isinstance(value.get("failed_checks", 0), int):
            return invalid
        for key in ("publication_next_at", "publication_last_at"):
            timestamp = value.get(key)
            if timestamp is not None and (not isinstance(timestamp, (int, float)) or not math.isfinite(timestamp)):
                return invalid
        if not isinstance(value.get("publication_failures", 0), int):
            return invalid
        return value
    except FileNotFoundError:
        return {}
    except (OSError, ValueError):
        return invalid


def _save_state(state: dict) -> None:
    SUPPORT.mkdir(parents=True, exist_ok=True)
    fd, name = tempfile.mkstemp(prefix="state.", dir=SUPPORT)
    try:
        with os.fdopen(fd, "w") as stream:
            json.dump(state, stream, sort_keys=True, separators=(",", ":"))
            stream.write("\n")
            stream.flush()
            os.fsync(stream.fileno())
        os.chmod(name, 0o600)
        os.replace(name, STATE)
    finally:
        try:
            os.unlink(name)
        except FileNotFoundError:
            pass


def _log(event: dict) -> None:
    SUPPORT.mkdir(parents=True, exist_ok=True)
    try:
        if LOG.exists() and LOG.stat().st_size > MAX_LOG:
            rotated = LOG.with_suffix(".jsonl.1")
            try:
                rotated.unlink()
            except FileNotFoundError:
                pass
            LOG.replace(rotated)
        with LOG.open("a") as stream:
            stream.write(json.dumps(event, sort_keys=True, separators=(",", ":")) + "\n")
        os.chmod(LOG, 0o600)
    except OSError:
        pass


def _decision(state: dict, check: dict, now: float, manual: bool = False) -> tuple[str, str]:
    failures = int(state.get("failed_checks", 0))
    if check["classification"] == "NONE":
        return "HEALTHY", "verified backend identity and complete Studio transfer"
    if check["classification"] in ("FOREIGN_PORT_OWNER", "AMBIGUOUS_BACKEND_IDENTITY"):
        return "BLOCKED", check["classification"]
    if not manual and failures < 2:
        return "SUSPECT", "one completed failure recorded; awaiting independent probe"
    if not manual and state.get("circuit_open"):
        return "CIRCUIT_OPEN", "circuit is latched until sustained health or explicit retry"
    episodes = [float(t) for t in state.get("episodes", []) if now - float(t) < WINDOW_SECONDS]
    if not manual and len(episodes) >= MAX_EPISODES:
        return "CIRCUIT_OPEN", "automatic episode limit reached"
    if not manual:
        previous = float(state.get("last_episode_at", 0))
        cooldown = max(COOLDOWN_SECONDS, min(300, COOLDOWN_SECONDS * (2 ** max(0, len(episodes) - 1))))
        cooldown += int(state.get("jitter_seconds", 0))
        if previous and now - previous < cooldown:
            return "BACKOFF", "recovery cooldown active"
    if check["tunnel"] == "FOREIGN":
        return "BLOCKED", "local port 31337 belongs to an unrelated process"
    if check["resources"] == "BUSY":
        return "BACKOFF", "Big Mac resource lease or queue is active"
    return "DIAGNOSING", "two completed failures permit targeted recovery"


def _status(check: dict, state: dict, holding_lock: bool = False) -> dict:
    try:
        fingerprint = hashlib.sha256((ROOT / "native/macos/Image_Gen/ImageGenApp.swift").read_bytes()).hexdigest()
    except OSError:
        fingerprint = "UNKNOWN"
    try:
        installed_fp = subprocess.run(["/usr/libexec/PlistBuddy", "-c", "Print :DexDiffusionSourceFingerprint",
                                       "/Applications/DexDiffusion.app/Contents/Info.plist"],
                                      capture_output=True, text=True, timeout=2, check=False).stdout.strip() or "UNKNOWN"
    except (OSError, subprocess.TimeoutExpired):
        installed_fp = "UNKNOWN"
    try:
        app_running = subprocess.run(["/usr/bin/pgrep", "-x", "DexDiffusion"], capture_output=True,
                                     timeout=2, check=False).returncode == 0
    except (OSError, subprocess.TimeoutExpired):
        app_running = None
    lock_active = False
    if not holding_lock and LOCK.exists():
        with LOCK.open("r+") as stream:
            try:
                fcntl.flock(stream, fcntl.LOCK_EX | fcntl.LOCK_NB)
                fcntl.flock(stream, fcntl.LOCK_UN)
            except BlockingIOError:
                lock_active = True
    episodes = [t for t in state.get("episodes", []) if time.time() - float(t) < WINDOW_SECONDS]
    return {"state": state.get("state", "UNKNOWN"),
            "latest_verified_healthy_at": state.get("latest_verified_healthy_at"),
            "last_failure_classification": state.get("last_failure_classification", "UNKNOWN"),
            "backend_identity": check.get("backend_identity"), "backend": check.get("backend"),
            "tunnel_ownership": check.get("tunnel"), "studio_full_transfer": check.get("studio"),
            "studio_bytes": check.get("studio_bytes"), "active_recovery_lock": lock_active,
            "recovery_episode": state.get("recovery_episode"), "attempts_in_window": len(episodes),
            "circuit_breaker": bool(state.get("circuit_open")),
            "native_app_running": app_running,
            "native_ui_bootstrap": "UNOBSERVED_BY_CONTROLLER",
            "native_source_fingerprint": {"checkout": fingerprint, "installed": installed_fp,
                                          "matches": fingerprint == installed_fp},
            "bigmac_resource_lease": check.get("resources"),
            "publication_status": check.get("publication"),
            "publication_sync": {"state": state.get("publication_state", "UNKNOWN"),
                                 "failures": state.get("publication_failures", 0),
                                 "next_at": state.get("publication_next_at"),
                                 "last_at": state.get("publication_last_at"),
                                 "last_exit": state.get("publication_last_exit")},
            "reason": state.get("reason"),
            "blocked_reason": state.get("blocked_reason"),
            "updated_at": state.get("updated_at")}


def _spawn_executor(env: dict) -> subprocess.Popen:
    return subprocess.Popen([str(CLI), "__controller-start"], stdout=subprocess.PIPE, stderr=subprocess.STDOUT,
                            text=True, env=env, start_new_session=True)


def _run_publication_sync(timeout: float) -> tuple[int, str]:
    # The worker holds its own lockf, so a native-app or manual sync running at
    # the same moment makes this call exit nonzero instead of writing twice.
    try:
        process = subprocess.run([str(CLI), "publication-sync"], capture_output=True, text=True,
                                 timeout=timeout, check=False, start_new_session=True)
        return process.returncode, (process.stdout or process.stderr or "").strip()[-400:]
    except subprocess.TimeoutExpired:
        return 124, "publication sync exceeded its deadline"
    except OSError as exc:
        return 127, type(exc).__name__


def _dispatch_publication(state: dict, check: dict, now: float) -> None:
    """Pull pending Big Mac artifacts only after the route was independently verified.

    Publication never mutates the tunnel or backend; failures only back off this
    subsystem so a broken transfer cannot trigger a recovery episode.
    """
    if check.get("publication") != "PENDING":
        if check.get("publication") == "CLEAR":
            state.update(publication_state="CLEAR", publication_failures=0, publication_next_at=0)
        return
    if now < float(state.get("publication_next_at", 0) or 0):
        state["publication_state"] = "BACKOFF"
        return
    code, detail = _run_publication_sync(PUBLICATION_SECONDS)
    finished = time.time()
    if code == 0:
        state.update(publication_state="SYNCED", publication_failures=0, publication_next_at=0,
                     publication_last_at=finished, publication_last_exit=0)
    else:
        failures = int(state.get("publication_failures", 0) or 0) + 1
        delay = min(PUBLICATION_MAX_BACKOFF, 60 * (2 ** (failures - 1)))
        state.update(publication_state="RETRY_BACKOFF", publication_failures=failures,
                     publication_next_at=finished + delay, publication_last_at=finished,
                     publication_last_exit=code)
    _log({"at": finished, "state": "PUBLICATION_SYNC", "exit": code, "detail": detail[:200]})


def run(manual: bool = False, status_only: bool = False) -> int:
    if status_only:
        state = _read_state()
        check = probe()
        print(json.dumps(_status(check, state), sort_keys=True))
        return 0
    SUPPORT.mkdir(parents=True, exist_ok=True)
    with LOCK.open("a+") as lock:
        try:
            fcntl.flock(lock, fcntl.LOCK_EX | fcntl.LOCK_NB)
        except BlockingIOError:
            print(json.dumps({"state": "RECOVERING", "reason": "controller lock held"}))
            return 0
        now = time.time()
        state = _read_state()
        if state.get("state_invalid") and not manual:
            print(json.dumps(_status(probe(), state, True), sort_keys=True))
            return 1
        if state.get("state") in IN_FLIGHT_STATES:
            # This process holds the only controller lock, so an in-flight state
            # was left by an interrupted run. Keep its episode budget; only a
            # fresh independent probe below may move it back to HEALTHY.
            _log({"at": now, "state": "INTERRUPTED_RECOVERY", "previous": state.get("state")})
            state.update(state="INTERRUPTED_RECOVERY", interrupted_from=state.get("state"), updated_at=now)
            _save_state(state)
        if manual:
            if state.get("state_invalid") and STATE.exists():
                backup = SUPPORT / ("invalid-state-" + str(time.time_ns()) + ".json")
                backup.write_bytes(STATE.read_bytes())
                backup.chmod(0o600)
                state = {"schema": 1}
            state["episodes"] = []
            state["last_episode_at"] = 0
            state["circuit_open"] = False
            state["reason"] = "explicit manual retry reset the automatic circuit"
        check = probe()
        state.setdefault("schema", 1)
        state.setdefault("episodes", [])
        if check["classification"] == "NONE":
            healthy_since = float(state.get("healthy_since", now))
            state.update(state="HEALTHY", failed_checks=0, last_failure_classification="NONE",
                         latest_verified_healthy_at=now, healthy_since=healthy_since,
                         reason="verified backend identity and complete Studio transfer",
                         blocked_reason=None, recovery_episode=None)
            if now - healthy_since >= HEALTH_RESET_SECONDS:
                state["episodes"] = []
                state["last_episode_at"] = 0
                state["circuit_open"] = False
            state.pop("interrupted_from", None)
            state["updated_at"] = now
            _save_state(state)
            _log({"at": now, "state": "HEALTHY", "studio_bytes": check["studio_bytes"]})
            _dispatch_publication(state, check, now)
            state["updated_at"] = time.time()
            _save_state(state)
            print(json.dumps(_status(check, state, True), sort_keys=True))
            return 0
        prior_failures = int(state.get("failed_checks", 0))
        if not manual and prior_failures < 1:
            state.update(state="SUSPECT", failed_checks=1, updated_at=now,
                         last_failure_classification=check["classification"])
            _save_state(state)
            _log({"at": now, "state": "SUSPECT", "classification": check["classification"]})
            # A second independently completed check distinguishes a transient
            # probe failure from a stable outage before any repair is allowed.
            time.sleep(1)
            second = probe()
            if second["classification"] == "NONE":
                state.update(schema=1, state="HEALTHY", failed_checks=0,
                             last_failure_classification="TRANSIENT_PROBE_FAILURE",
                             latest_verified_healthy_at=time.time(), healthy_since=time.time(),
                             blocked_reason=None, recovery_episode=None, updated_at=time.time())
                _save_state(state)
                _log({"at": time.time(), "state": "HEALTHY", "classification": "TRANSIENT_PROBE_FAILURE"})
                print(json.dumps(_status(second, state, True), sort_keys=True))
                return 0
            check = second
            state["failed_checks"] = prior_failures + 2
        else:
            state["failed_checks"] = prior_failures + 1
        state.pop("healthy_since", None)
        state["last_failure_classification"] = check["classification"]
        state.update(updated_at=now, state="DEGRADED")
        _save_state(state)
        _log({"at": now, "state": "DEGRADED", "classification": check["classification"]})
        decision, reason = _decision(state, check, now, manual)
        state["last_check_at"] = now
        if decision != "DIAGNOSING":
            if decision == "CIRCUIT_OPEN":
                state["circuit_open"] = True
            state.update(state=decision, reason=reason, blocked_reason=reason if decision == "BLOCKED" else None)
            _save_state(state)
            _log({"at": now, "state": decision, "classification": check["classification"], "reason": reason})
            print(json.dumps(_status(check, state, True), sort_keys=True))
            return 1
        state.update(state="DIAGNOSING", reason=reason, blocked_reason=None, updated_at=time.time())
        _save_state(state)
        _log({"at": time.time(), "state": "DIAGNOSING", "classification": check["classification"]})
        episode_deadline = time.monotonic() + EPISODE_WALL_SECONDS
        # Only invoke the existing repair executor after an independent remote
        # full-transfer check proves the backend and resource arbiter are safe.
        ready, evidence = _remote_ready(episode_deadline)
        if not ready:
            next_state = "BLOCKED" if evidence == "SSH_AUTHENTICATION_UNAVAILABLE" else "BACKOFF"
            state.update(state=next_state, reason=evidence,
                         blocked_reason=evidence if next_state == "BLOCKED" else None, updated_at=time.time())
            _save_state(state)
            _log({"at": time.time(), "state": state["state"], "classification": check["classification"], "reason": evidence})
            print(json.dumps(_status(check, state, True), sort_keys=True))
            return 1
        episodes = [float(t) for t in state.get("episodes", []) if now - float(t) < WINDOW_SECONDS]
        episodes.append(now)
        state.update(state="RECOVERING", episodes=episodes, last_episode_at=now,
                     recovery_episode=len(episodes), reason=evidence, blocked_reason=None, updated_at=now,
                     jitter_seconds=random.randint(0, 10))
        _save_state(state)
        _log({"at": now, "state": "RECOVERING", "classification": check["classification"], "evidence": evidence})
        try:
            execution_env = dict(os.environ, DEX_RECOVERY_CONTROLLER_ROOT=str(ROOT))
            process = _spawn_executor(execution_env)
            old_handler = signal.getsignal(signal.SIGTERM)
            def interrupted(_signal, _frame):
                raise InterruptedError("controller terminated")
            signal.signal(signal.SIGTERM, interrupted)
            try:
                remaining = max(0.1, episode_deadline - time.monotonic())
                _output, _ = process.communicate(timeout=min(EPISODE_SECONDS, remaining))
                code = process.returncode
            except subprocess.TimeoutExpired:
                try:
                    os.killpg(process.pid, 15)
                    process.wait(timeout=1)
                except (ProcessLookupError, subprocess.TimeoutExpired):
                    try:
                        os.killpg(process.pid, 9)
                    except ProcessLookupError:
                        pass
                code = 124
            finally:
                if process.poll() is None:
                    try:
                        os.killpg(process.pid, signal.SIGKILL)
                    except ProcessLookupError:
                        pass
                process.wait()
                signal.signal(signal.SIGTERM, old_handler)
        except (OSError, subprocess.TimeoutExpired):
            code = 124
        state["failed_checks"] = 0
        state.update(state="VERIFYING", reason="independent post-repair full-transfer check", updated_at=time.time())
        _save_state(state)
        verified = probe(episode_deadline)
        if code == 0 and verified["classification"] == "NONE":
            state.update(state="HEALTHY", latest_verified_healthy_at=time.time(), healthy_since=time.time(),
                         last_failure_classification="NONE", reason="recovery verified", blocked_reason=None, recovery_episode=None)
            _log({"at": time.time(), "state": "VERIFIED", "studio_bytes": verified["studio_bytes"]})
        else:
            state.update(state="BACKOFF", reason="repair did not pass independent full-transfer verification",
                         blocked_reason=None,
                         recovery_episode=None, last_failure_classification=verified["classification"])
            _log({"at": time.time(), "state": "BACKOFF", "classification": verified["classification"], "exit": code})
        _save_state(state)
        print(json.dumps(_status(verified, state, True), sort_keys=True))
        return 0 if state["state"] == "HEALTHY" else 1


def main() -> int:
    parser = argparse.ArgumentParser()
    mode = parser.add_mutually_exclusive_group()
    mode.add_argument("--status", action="store_true", help="read-only live diagnostic")
    mode.add_argument("--manual", action="store_true", help="explicitly retry while preserving safety checks")
    args = parser.parse_args()
    return run(manual=args.manual, status_only=args.status)


if __name__ == "__main__":
    raise SystemExit(main())
