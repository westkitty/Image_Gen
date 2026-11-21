"""Opt-in, single-owner backend lifecycle beneath EngineHost."""
import os
from pathlib import Path
import signal
import stat
import socket
import subprocess
import tempfile
import time


def executable_identity(path):
    info = Path(path).stat()
    if not os.access(path, os.X_OK):
        raise OSError('backend executable is unavailable')
    return info.st_dev, info.st_ino, info.st_size, info.st_mtime_ns


def group_exists(group):
    try:
        os.killpg(group, 0)
        return True
    except ProcessLookupError:
        return False


def port_available(port):
    # No SO_REUSEPORT. The child must also win its own bind.
    with socket.socket() as probe:
        try:
            probe.setsockopt(socket.SOL_SOCKET, socket.SO_REUSEADDR, 1)
            probe.bind(('127.0.0.1', port))
            return True
        except OSError:
            return False


class Supervisor:
    def __init__(self, root, executable, command, env, port, worker_idle, lock_fd, clock=time.monotonic):
        self.root = Path(root)
        self.executable = executable
        self.command = command
        self.env = env
        self.port = port
        self.worker_idle = worker_idle
        self.lock_fd = lock_fd
        self.clock = clock
        self.child = None
        self.instance = None
        self.identity = None
        self.requested = False
        self.paused = False
        self.mode = None
        self.state = 'WAITING'
        self.failures = []
        self.retry_at = 0
        self.drain_since = None
        self.owner = self.root / 'backend-instance'

    def status(self):
        return {'state': self.state, 'pid': self.child.pid if self.child else None,
                'port': self.port, 'restart_requested': self.requested,
                'recent_crashes': len(self.failures), 'paused': self.paused}

    def request_restart(self):
        if self.state in ('CIRCUIT_OPEN', 'RECOVERY_BLOCKED'):
            return False
        self.requested = True
        return True

    def _seal(self, state):
        try:
            p = self.instance / 'idle'
            return time.time() - p.stat().st_mtime < 3 and p.read_text() == f'{self.child.pid} {state}\n'
        except OSError:
            return False

    def _spawn(self):
        if self.owner.exists() or self.owner.is_symlink():
            self.state = 'RECOVERY_BLOCKED'
            return
        if not port_available(self.port):
            self.state = 'PORT_HELD'
            return
        try:
            self.identity = executable_identity(self.executable)
            self.instance = Path(tempfile.mkdtemp(prefix='bc-', dir=self.root))
            # A later worker never adopts or signals an unknown survivor.
            with self.owner.open('x') as owner:
                owner.write(str(self.instance) + '\n')
                owner.flush()
                os.fsync(owner.fileno())
            fd = os.open(self.root, os.O_RDONLY)
            try:
                os.fsync(fd)
            finally:
                os.close(fd)
            self.child = subprocess.Popen(self.command, env={**self.env, 'DEX_BACKEND_CONTROL': str(self.instance)},
                                          stdin=subprocess.DEVNULL, start_new_session=True, pass_fds=(self.lock_fd,))
        except OSError:
            self.state = 'RECOVERY_BLOCKED'
            return
        self.requested = False
        self.drain_since = None
        self.state = 'STARTING'

    def _release(self):
        if group_exists(self.child.pid):
            self.state = 'RECOVERY_BLOCKED'
            return False
        for name in ('idle', 'idle.new', 'drain'):
            (self.instance / name).unlink(missing_ok=True)
        self.owner.unlink()
        self.child = None
        return True

    def _crashed(self):
        # A seal is invalidated before request admission. Without it, the dead
        # process cannot attest to its jobs, outbox, or transfer journal.
        if not self.worker_idle() or not (self._seal('idle') or self._seal('drained')):
            self.state = 'RECOVERY_BLOCKED'
            return
        if not self._release():
            return
        now = self.clock()
        self.failures = [stamp for stamp in self.failures if now - stamp < 600] + [now]
        self.state = 'CIRCUIT_OPEN' if len(self.failures) >= 4 else 'BACKOFF'
        self.retry_at = now + min(300, 10 * 2 ** (len(self.failures) - 1))

    def tick(self):
        if self.state in ('CIRCUIT_OPEN', 'RECOVERY_BLOCKED'):
            return
        if self.child is None:
            if not self.paused and self.clock() >= self.retry_at and self.worker_idle():
                self._spawn()
            return
        if self.child.poll() is not None:
            self._crashed()
            return
        try:
            stale = executable_identity(self.executable) != self.identity
        except OSError:
            stale = True
        if not (stale or self.requested or self.paused):
            self.state = 'IDLE' if self._seal('idle') else 'BUSY_OR_STARTING'
            return
        self.state = 'STALE_EXECUTABLE' if stale else 'DRAINING'
        drain = self.instance / 'drain'
        if self.drain_since is None:
            if self.worker_idle() and self._seal('idle'):
                drain.touch(mode=0o600)
                self.drain_since = self.clock()
            return
        if not self.worker_idle() or not self._seal('drained'):
            # Let reconciliation and publication ACKs continue if admission
            # raced the drain request. This attempt cannot signal the child.
            if self.clock() - self.drain_since > 3:
                drain.unlink(missing_ok=True)
                self.drain_since = None
            return
        # The direct child still owns the session and the backend has fenced ingress.
        if self.child.poll() is not None:
            self._crashed()
            return
        try:
            if os.getpgid(self.child.pid) != self.child.pid or os.getsid(self.child.pid) != self.child.pid:
                self.state = 'RECOVERY_BLOCKED'
                return
            if not self._seal('drained'):
                return
            os.killpg(self.child.pid, signal.SIGTERM)
            self.child.wait(timeout=5)
        except (OSError, subprocess.TimeoutExpired):
            self.state = 'RECOVERY_BLOCKED'
            return
        if self._release():
            self.state = 'WAITING'
            self.retry_at = self.clock() + 1


def configured_supervisor(worker, lock_fd):
    root = worker.root
    config = root / 'backend-supervisor-mode'
    try:
        info = config.lstat()
    except FileNotFoundError:
        return None
    if root != Path('/Users/bigmac/.dexdiffusion-engine') or socket.gethostname() != 'bigmac':
        raise RuntimeError('backend supervisor requires Big Mac')
    if not stat.S_ISREG(info.st_mode) or info.st_uid != os.getuid() or info.st_mode & 0o077:
        raise RuntimeError('unsafe backend supervisor configuration')
    mode = config.read_text().strip()
    project = root.parent / 'Image_Gen-wc2tb-20261120'
    runtime = root.parent / 'Library/Application Support/DexDiffusion/wc2tb-recovery-runtime/node/bin/node'
    if mode == 'rehearsal':
        script, port = 'scripts/test/run-optionA-probe-backend.sh', 31347
        runtime = root.parent / 'DexDiffusion-OptionA-Test-internal/node/bin/node'
    elif mode == 'production':
        gui = f'gui/{os.getuid()}'
        disabled = subprocess.run(['/bin/launchctl', 'print-disabled', gui],
                                  capture_output=True, text=True, timeout=4, check=True).stdout
        if '"local.dexdiffusion.server" => disabled' not in disabled:
            raise RuntimeError('legacy backend LaunchAgent must be disabled')
        for domain in (gui, 'system'):
            result = subprocess.run(['/bin/launchctl', 'print', f'{domain}/local.dexdiffusion.server'],
                                    capture_output=True, text=True, timeout=4)
            if result.returncode == 0 or 'Could not find service' not in result.stderr:
                raise RuntimeError('legacy backend launchd ownership unresolved')
        script, port = 'scripts/run-backend-service.sh', 31337
    else:
        raise RuntimeError('backend supervisor mode must be rehearsal or production')
    env = {'HOME': str(root.parent), 'PATH': '/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin:/usr/sbin:/sbin',
           'OPERATOR_CONSOLE_PORT': str(port), 'DEX_SUPERVISED_NODE': str(runtime),
           'DEX_AUTHORIZED_TAILSCALE_USERS': 'westkitty,bcroc',
           'DEX_IMAGE_VALIDATION_PYTHON': '/Users/bigmac/Library/Caches/DexDiffusion/mflux/venv/bin/python'}
    supervisor = Supervisor(root, runtime, ['/bin/bash', str(project / script)], env, port,
                            lambda: not worker.active and not worker.recovery_uncertain and not worker.unacknowledged(),
                            lock_fd)
    supervisor.mode = mode
    return supervisor
