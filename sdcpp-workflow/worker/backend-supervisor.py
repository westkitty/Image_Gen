"""Opt-in, single-owner backend lifecycle beneath EngineHost."""
import fcntl
import hashlib
import importlib.util
import json
import os
import re
from pathlib import Path
import signal
import stat
import socket
import subprocess
import tempfile
import time
import urllib.request
import uuid


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
        self.cwd = None
        self.log_path = None
        self.profile = 'external'
        self.handoff = None

    def status(self):
        status = {'state': self.state, 'pid': self.child.pid if self.child else None,
                  'port': self.port, 'restart_requested': self.requested,
                  'recent_crashes': len(self.failures), 'paused': self.paused, 'profile': self.profile}
        if self.handoff:
            status['handoff'] = self.handoff.summary()
        return status

    def request_restart(self):
        if self.state in ('CIRCUIT_OPEN', 'RECOVERY_BLOCKED'):
            return False
        if self.profile != 'external' or (self.handoff and self.handoff.busy()):
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
            log = open(self.log_path, 'ab') if self.log_path else None
            try:
                self.child = subprocess.Popen(self.command, env={**self.env, 'DEX_BACKEND_CONTROL': str(self.instance)},
                                              cwd=self.cwd, stdin=subprocess.DEVNULL, start_new_session=True,
                                              pass_fds=(self.lock_fd,), stdout=log, stderr=log)
            finally:
                if log:
                    log.close()
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
        if self.handoff and self.handoff.tick():
            return
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
            if self.handoff and not self.handoff.may_release(self.child):
                return
            os.killpg(self.child.pid, signal.SIGTERM)
            self.child.wait(timeout=5)
        except (OSError, subprocess.TimeoutExpired):
            self.state = 'RECOVERY_BLOCKED'
            return
        if self._release():
            if self.handoff and self.handoff.on_released():
                return
            self.state = 'WAITING'
            self.retry_at = self.clock() + 1


# --------------------------------------------------------------------------
# Owner-authorized production <-> internal-fallback handoff.
#
# The EngineHost-owned Supervisor stays the ONLY backend owner. A handoff is a
# journaled profile switch performed by that owner. BOTH directions stop the
# current child only through the same durable drain handshake (DEX_BACKEND_CONTROL:
# fence admission, fresh "<owned pid> drained" seal, owned session and process
# group, sole listener), then start the next profile as a new owned child.
# Nothing is ever adopted, killed by remembered PID, or freed from a foreign
# process, and no timeout ever authorizes a signal.
#
#   RUNNING_EXTERNAL -> QUIESCING -> BACKEND_RELEASED -> STARTING_FALLBACK -> RUNNING_FALLBACK
#   RUNNING_FALLBACK -> QUIESCING_FALLBACK -> FALLBACK_RELEASED -> STARTING_EXTERNAL -> RUNNING_EXTERNAL
#   QUIESCING / QUIESCING_FALLBACK that cannot drain in time -> back to RUNNING_* (aborted; child untouched)
#   any other transition failure, a startup deadline, or a worker restart mid-transition -> HANDOFF_FAILED
#   (paused: nothing is spawned or signalled until an explicit, re-checked return-to-external request)
# --------------------------------------------------------------------------
HANDOFF_TRANSITIONAL = ('QUIESCING', 'BACKEND_RELEASED', 'STARTING_FALLBACK',
                        'QUIESCING_FALLBACK', 'FALLBACK_RELEASED', 'STARTING_EXTERNAL')
HANDOFF_STATES = ('RUNNING_EXTERNAL', 'RUNNING_FALLBACK', 'HANDOFF_FAILED') + HANDOFF_TRANSITIONAL
HANDOFF_KEYS = {'op', 'target', 'expect_revision', 'reason'}
FALLBACK_MODELS = ['flux-fp8', 'flux2-klein-4b', 'sdxl-photonic']
FALLBACK_FOLDERS = ('state', 'runs', 'images', 'scratch', 'logs', 'video', 'output/audio/voice',
                    'output/audio/music', 'output/worlds')
# Executable first-party files every trusted fallback manifest must cover. The
# quiescence module is what lets the owner drain the fallback instead of killing it.
MANIFEST_REQUIRED = ('operator-console/server.js', 'operator-console/backend-quiescence.js',
                     'operator-console/package.json', 'operator-console/package-lock.json')
HANDOFF_PROTOCOL = 2
JOURNAL_SCHEMA = 2


def sha256_file(path):
    try:
        digest = hashlib.sha256()
        with open(path, 'rb') as handle:
            for block in iter(lambda: handle.read(1 << 20), b''):
                digest.update(block)
        return digest.hexdigest()
    except OSError:
        return None


SUPERVISOR_SHA256 = sha256_file(__file__)  # identity of the supervisor this worker actually loaded


def http_json(base, path, timeout=2):
    try:
        with urllib.request.urlopen(base + path, timeout=timeout) as response:
            return response.status, json.load(response)
    except (OSError, ValueError):
        return None, None


def http_status(base, path, timeout=2):
    try:
        with urllib.request.urlopen(base + path, timeout=timeout) as response:
            response.read(64)
            return response.status
    except OSError:
        return None


def lsof_listeners(port):
    try:
        out = subprocess.run(['/usr/sbin/lsof' if os.path.exists('/usr/sbin/lsof') else 'lsof', '-nP',
                              f'-iTCP:{port}', '-sTCP:LISTEN', '-t'], capture_output=True, text=True, timeout=4)
    except (OSError, subprocess.TimeoutExpired):
        return None
    if out.returncode not in (0, 1):
        return None
    return sorted({int(x) for x in out.stdout.split()})


def git_identity(project):
    try:
        head = subprocess.run(['git', '-C', str(project), 'rev-parse', 'HEAD'], capture_output=True, text=True, timeout=5)
        dirty = subprocess.run(['git', '-C', str(project), 'status', '--porcelain', '--untracked-files=no'],
                               capture_output=True, text=True, timeout=5)
    except (OSError, subprocess.TimeoutExpired):
        return None, None
    if head.returncode or dirty.returncode:
        return None, None
    return head.stdout.strip(), dirty.stdout.strip() == ''


def _private_dir(path, create, label, private=True):
    """One directory of the isolated fallback layout: never a symlink, a directory owned
    by this user; with `private` (the root and the log directory, which are the access
    boundary) also not group/other accessible. Only `create` may make it (mode 0700)."""
    path = Path(path)
    if path.is_symlink():
        return ['FALLBACK_ROOT: %s is a symlink' % label]
    if not path.exists():
        if not create:
            return ['FALLBACK_ROOT: %s not prepared' % label]
        try:
            path.mkdir(mode=0o700)
        except OSError as error:
            return ['FALLBACK_PREPARE: cannot create %s (%s)' % (label, error.strerror or error)]
    try:
        info = path.lstat()
    except OSError as error:
        return ['FALLBACK_ROOT: %s unreadable (%s)' % (label, error.strerror or error)]
    if not stat.S_ISDIR(info.st_mode):
        return ['FALLBACK_ROOT: %s is not a directory' % label]
    if info.st_uid != os.getuid() or (private and info.st_mode & 0o077):
        return ['FALLBACK_ROOT: %s owner or permissions unsafe (uid %s, mode %o)' % (label, info.st_uid, info.st_mode & 0o777)]
    return []


def fallback_layout(root, home, log_path, min_free, create):
    """Validate (and, only when `create`, prepare) the isolated fallback data root and
    log destination. Called while the external backend is still running."""
    root, home, log = Path(root), Path(home), Path(log_path)
    if not root.is_absolute() or os.path.realpath(root.parent) != str(root.parent):
        return ['FALLBACK_ROOT: %s is not absolute or has a symlinked ancestor' % root]
    if not root.exists() and not root.is_symlink() and create and not root.parent.is_dir():
        return ['FALLBACK_ROOT: parent of %s missing' % root]
    bad = _private_dir(root, create, 'fallback root')
    if bad:
        return bad
    try:
        if root.stat().st_dev != home.stat().st_dev:
            return ['FALLBACK_DEVICE: fallback root is not on the internal (home) device']
    except OSError as error:
        return ['FALLBACK_DEVICE: unverifiable (%s)' % (error.strerror or error)]
    for folder in FALLBACK_FOLDERS:
        current = root
        for part in folder.split('/'):
            current = current / part
            bad = _private_dir(current, create, 'fallback subdirectory ' + folder, private=False)
            if bad:
                return bad
            if current.stat().st_dev != home.stat().st_dev:
                return ['FALLBACK_DEVICE: %s crosses onto another device' % folder]
    if os.path.realpath(root) != str(root):
        return ['FALLBACK_ROOT: %s resolves through a symlink' % root]
    bad = _private_dir(log.parent, create, 'log directory')
    if bad:
        return [b.replace('FALLBACK_ROOT', 'FALLBACK_LOG').replace('FALLBACK_PREPARE', 'FALLBACK_LOG') for b in bad]
    if log.is_symlink() or (log.exists() and not log.is_file()):
        return ['FALLBACK_LOG: log destination is not a regular file']
    if create:
        try:
            fd = os.open(log, os.O_WRONLY | os.O_APPEND | os.O_CREAT | getattr(os, 'O_NOFOLLOW', 0), 0o600)
            os.close(fd)
        except OSError as error:
            return ['FALLBACK_LOG: cannot open log destination (%s)' % (error.strerror or error)]
    elif not os.access(log if log.exists() else log.parent, os.W_OK):
        return ['FALLBACK_LOG: log destination not writable']
    try:
        info = os.statvfs(root)
        free = info.f_bavail * info.f_frsize
    except OSError:
        return ['FALLBACK_DISK: free space unverifiable']
    if free < min_free:
        return ['FALLBACK_DISK: %d MiB free, fallback startup needs %d MiB' % (free >> 20, min_free >> 20)]
    return []


def manifest_problems(manifest_path, manifest_sha256, source_root):
    """The package source must match a trusted, versioned manifest whose own digest is
    pinned in this supervisor (a freely replaceable manifest proves nothing)."""
    if sha256_file(manifest_path) != manifest_sha256:
        return ['FALLBACK_SOURCE: trusted manifest missing or altered (%s)' % Path(manifest_path).name]
    try:
        lines = Path(manifest_path).read_text(encoding='utf-8').splitlines()
    except (OSError, UnicodeDecodeError):
        return ['FALLBACK_SOURCE: trusted manifest unreadable']
    entries, bad = {}, []
    for line in lines:
        match = re.fullmatch(r'([0-9a-f]{64})  (\S(?:.*\S)?)', line)
        if not match or match.group(2).startswith('/') or '..' in Path(match.group(2)).parts:
            return ['FALLBACK_SOURCE: malformed manifest line']
        entries[match.group(2)] = match.group(1)
    missing = [name for name in MANIFEST_REQUIRED if name not in entries]
    if missing:
        return ['FALLBACK_DRAIN: manifest does not cover %s; this package cannot be drained by its owner' % ', '.join(missing)]
    root = Path(source_root)
    for name, digest in entries.items():
        candidate = root / name
        if candidate.is_symlink() or not candidate.is_file():
            bad.append('FALLBACK_SOURCE: %s missing or not a regular file' % name)
        elif sha256_file(candidate) != digest:
            bad.append('FALLBACK_SOURCE: %s differs from the trusted manifest' % name)
        if len(bad) >= 5:
            break
    return bad


class HandoffChecks:
    """Facts the owner verifies itself. `config` is built once, from constants, by
    production_handoff_config(); tests build their own for isolated ports and roots."""

    def __init__(self, config):
        self.c = config

    def _package(self):
        c, bad = self.c, []
        try:
            commit = (Path(c['package']) / 'SOURCE_COMMIT').read_text().strip()
        except OSError:
            commit = None
        if commit != c['package_commit']:
            bad.append('FALLBACK_PACKAGE: SOURCE_COMMIT is %r, expected %s' % (commit, c['package_commit']))
        if sha256_file(Path(c['package']) / 'start-fallback-rollback.sh') != c['starter_sha256']:
            bad.append('FALLBACK_PACKAGE: starter missing or altered')
        if sha256_file(Path(c['fallback_cwd']) / 'public/dexdiffusion/edit-ui.js') != c['ui_sha256']:
            bad.append('FALLBACK_PACKAGE: edit-ui.js missing or altered')
        if not (Path(c['fallback_cwd']) / 'server.js').is_file():
            bad.append('FALLBACK_PACKAGE: server.js missing')
        for dep in c['required_deps']:
            if not (Path(c['fallback_cwd']) / 'node_modules' / dep / 'package.json').is_file():
                bad.append('FALLBACK_PACKAGE: dependency %s missing or node_modules unresolved' % dep)
        if not bad:
            bad += manifest_problems(c['source_manifest'], c['source_manifest_sha256'], Path(c['fallback_cwd']).parent)
        return bad

    def _no_macbook_contact(self):
        env = self.c['fallback_env']
        bad = []
        if env.get('DEX_STORAGE_MODE') != 'internal-fallback' or any('MACBOOK' in key for key in env):
            bad.append('MACBOOK_CONTACT: fallback environment could reach a MacBook destination')
        if self.c['package_commit'] not in self.c['publication_isolated_commits']:
            bad.append('MACBOOK_CONTACT: package commit is not a publication-isolated revision')
        return bad

    def _node(self):
        return [] if sha256_file(self.c['node_path']) == self.c['node_sha256'] else ['NODE_HASH: pinned Node missing or hash mismatch']

    def _identity(self):
        c, bad = self.c, []
        if c['parent_command']() != c['enginehost_path'] or sha256_file(c['enginehost_path']) != c['enginehost_sha256']:
            bad.append('IDENTITY_ENGINEHOST: worker parent is not the pinned signed EngineHost')
        expected = c['worker_expected_sha256']()
        if not expected or sha256_file(c['worker_file']) != expected:
            bad.append('IDENTITY_WORKER: running worker differs from the deployed revision')
        return bad

    def _source(self, expect):
        head, clean = git_identity(self.c['project'])
        if head != expect or clean is not True:
            return ['SOURCE_REVISION: deployed worktree %s (clean=%s) is not the expected %s' % (head, clean, expect)]
        if not os.access(Path(self.c['project']) / self.c['external_script'], os.R_OK):
            return ['RETURN_PATH: external launcher missing']
        return []

    def _locks(self):
        bad = []
        for path in self.c['recovery_locks']:
            try:
                with open(path, 'a') as handle:
                    try:
                        fcntl.flock(handle, fcntl.LOCK_EX | fcntl.LOCK_NB)
                        fcntl.flock(handle, fcntl.LOCK_UN)
                    except OSError:
                        bad.append('CONCURRENT: recovery operation in progress (%s locked)' % Path(path).name)
            except OSError:
                bad.append('CONCURRENT: recovery lock %s unavailable' % Path(path).name)
        return bad

    def _idle(self, base, pid, expected_cwd, expected_mode, check_publication):
        bad = []
        code, version = http_json(base, '/api/version')
        if not version or version.get('pid') != pid or version.get('cwd') != expected_cwd:
            return ['BACKEND_IDENTITY: /api/version does not identify the owned child pid %s' % pid]
        if (version.get('storage') or {}).get('mode') != expected_mode:
            bad.append('BACKEND_IDENTITY: storage mode %r, expected %s' % ((version.get('storage') or {}).get('mode'), expected_mode))
        _, jobs = http_json(base, '/api/jobs')
        if jobs is None or jobs.get('jobs'):
            bad.append('ACTIVE_JOB: jobs present or unreadable')
        _, lease = http_json(base, '/api/resources')
        if lease is None or lease.get('owner') or lease.get('waiting') or lease.get('quarantine'):
            bad.append('LEASE: compute lease, waiter or quarantine present or unreadable')
        if check_publication:
            _, pub = http_json(base, '/api/publications/status')
            if pub is None or pub.get('pending'):
                bad.append('PUBLICATION_PENDING: publications awaiting MacBook acknowledgment or unreadable')
            _, rec = http_json(base, '/api/publication-recovery')
            transfers = (rec or {}).get('transfers') or {}
            if rec is None or rec.get('blocked') or transfers.get('pending') or transfers.get('blocked'):
                bad.append('RECOVERY_UNSAFE: publication recovery blocked or transfers in flight')
        return bad

    def _listener(self, pid):
        listeners = self.c['listeners'](self.c['port'])
        if listeners is None:
            return ['FOREIGN_LISTENER: listener identity unverifiable']
        if listeners != ([pid] if pid else []):
            return ['FOREIGN_LISTENER: port %s listeners %s, expected %s' % (self.c['port'], listeners, [pid] if pid else [])]
        return []

    def fallback_ready(self, create=False):
        """Everything predictable about the fallback, checked (and with `create`, its
        isolated directories prepared) while the external backend is still running."""
        c = self.c
        bad = self._node() + self._package() + self._no_macbook_contact()
        if not bad:
            bad += fallback_layout(c['fallback_root'], c['home'], c['fallback_log'], c['fallback_min_free_bytes'], create)
        return bad

    def preflight_fallback(self, supervisor, expect):
        child = supervisor.child
        if child is None or child.poll() is not None:
            return ['BACKEND_IDENTITY: no running owned external child']
        # The fallback layout is prepared and re-validated by request() as the next step.
        bad = self._identity() + self._source(expect) + self._node() + self._package() + self._no_macbook_contact()
        if not supervisor.worker_idle():
            bad.append('ACTIVE_JOB: worker has an active, uncertain or unacknowledged job')
        bad += self._idle(self.c['base'], child.pid, self.c['external_cwd'], 'external', True)
        bad += self._listener(child.pid) + self._locks()
        return bad

    def preflight_return(self, supervisor, expect):
        bad = self._identity() + self._source(expect) + self._node() + self._locks()
        child = supervisor.child
        if child is not None and child.poll() is None:
            if supervisor.profile == 'fallback':
                bad += self._idle(self.c['base'], child.pid, self.c['fallback_cwd'], 'internal-fallback', False)
            else:
                bad += self.verify_external(child.pid, supervisor)
            bad += self._listener(child.pid)
        else:
            if supervisor.owner.exists() or supervisor.owner.is_symlink():
                bad.append('OWNER_PRESENT: an unreleased backend owner record exists; survivors are never adopted')
            bad += self._listener(None)
        return bad

    def verify_external(self, pid, supervisor):
        """Readiness of the owned external child: its own fresh idle seal, its own
        /api/version identity in external storage, and it is the sole listener."""
        if not supervisor._seal('idle'):
            return ['EXTERNAL_SEAL: no fresh idle seal from owned pid %s' % pid]
        _, version = http_json(self.c['base'], '/api/version')
        if not version or version.get('pid') != pid or version.get('cwd') != self.c['external_cwd']:
            return ['EXTERNAL_IDENTITY: owned external child not answering as itself']
        if (version.get('storage') or {}).get('mode') != 'external':
            return ['EXTERNAL_STORAGE: not in external mode']
        return self._listener(pid)

    def verify_fallback(self, pid):
        base, bad = self.c['base'], []
        _, version = http_json(base, '/api/version')
        if not version or version.get('pid') != pid or version.get('cwd') != self.c['fallback_cwd']:
            return ['FALLBACK_IDENTITY: owned fallback child not answering as itself']
        if (version.get('storage') or {}).get('mode') != 'internal-fallback':
            bad.append('FALLBACK_STORAGE: not in internal-fallback mode')
        _, pub = http_json(base, '/api/publications/status')
        if pub is None or pub.get('enabled') is not False:
            bad.append('FALLBACK_PUBLICATION: MacBook publication is not disabled')
        _, caps = http_json(base, '/api/capabilities')
        ids = sorted(x.get('id') for x in (caps or {}).get('modelTargets', []))
        if ids != FALLBACK_MODELS:
            bad.append('FALLBACK_MODELS: inventory %s, expected %s' % (ids, FALLBACK_MODELS))
        if http_status(base, '/dexdiffusion/') != 200:
            bad.append('FALLBACK_STUDIO: Studio not serving')
        if self._listener(pid):
            bad.append('FALLBACK_LISTENER: owned fallback is not the sole listener')
        return bad


class HandoffController:
    def __init__(self, supervisor, journal_path, checks, external, fallback, mode, clock=time.monotonic,
                 quiesce_timeout=30, boot_timeout=90, stop_timeout=15):
        self.sup = supervisor
        self.path = Path(journal_path)
        self.checks = checks
        self.profiles = {'external': external, 'fallback': fallback}
        self.mode = mode
        self.clock = clock
        # stop_timeout bounds the fallback drain; quiesce_timeout the external drain.
        self.quiesce_timeout, self.boot_timeout, self.stop_timeout = quiesce_timeout, boot_timeout, stop_timeout
        self.deadline = None
        self.lock_handles = []
        self.journal = self._load()
        state = self.journal['state']
        if state in HANDOFF_TRANSITIONAL or state == 'RUNNING_FALLBACK':
            # A worker restart lost the child handle: never adopt, never respawn.
            self._set('HANDOFF_FAILED', 'worker restarted during %s; any survivor is not adopted' % state)
        if self.journal['state'] == 'HANDOFF_FAILED':
            self.sup.paused = True

    # ---- journal
    def _load(self):
        try:
            data = json.loads(self.path.read_text())
            if isinstance(data, dict) and data.get('state') in HANDOFF_STATES:
                return data
            return {'state': 'HANDOFF_FAILED', 'history': [], 'failure': 'unreadable journal state'}
        except FileNotFoundError:
            return {'state': 'RUNNING_EXTERNAL', 'history': []}
        except (OSError, ValueError):
            return {'state': 'HANDOFF_FAILED', 'history': [], 'failure': 'corrupt handoff journal'}

    def _set(self, state, detail='', **extra):
        self.journal.update(extra)
        self.journal['state'] = state
        self.journal['schema'] = JOURNAL_SCHEMA
        if state == 'HANDOFF_FAILED':
            self.journal['failure'] = detail
        seq = int(self.journal.get('seq') or 0) + 1
        self.journal['seq'] = seq
        ident = self.journal.get('identity') or {}
        entry = {'seq': seq, 'state': state, 'at': time.time(), 'mode': self.mode, 'detail': detail,
                 'pid': self.sup.child.pid if self.sup.child else None, 'schema': JOURNAL_SCHEMA,
                 'drill_id': self.journal.get('drill_id'), 'transition_id': self.journal.get('transition_id'),
                 'host': ident.get('host'), 'revision': ident.get('revision'),
                 'worker_sha256': ident.get('worker_sha256'), 'supervisor_sha256': ident.get('supervisor_sha256')}
        if extra.get('authorized'):
            entry['authorized'] = extra['authorized']
        self.journal.pop('authorized', None)
        self.journal['history'] = (self.journal.get('history') or [])[-63:] + [entry]
        tmp = self.path.with_name(self.path.name + '.new')
        with open(tmp, 'w') as handle:
            handle.write(json.dumps(self.journal, indent=2, sort_keys=True))
            handle.flush()
            os.fsync(handle.fileno())
        os.chmod(tmp, 0o600)
        os.replace(tmp, self.path)
        fd = os.open(self.path.parent, os.O_RDONLY)
        try:
            os.fsync(fd)
        finally:
            os.close(fd)
        if state in ('RUNNING_EXTERNAL', 'RUNNING_FALLBACK', 'HANDOFF_FAILED'):
            self._unlock()
            self.deadline = None

    def _lock(self):
        for path in self.checks.c['recovery_locks']:
            handle = open(path, 'a')
            try:
                fcntl.flock(handle, fcntl.LOCK_EX | fcntl.LOCK_NB)
            except OSError:
                handle.close()
                self._unlock()
                return False
            self.lock_handles.append(handle)
        return True

    def _unlock(self):
        for handle in self.lock_handles:
            handle.close()
        self.lock_handles = []

    def summary(self):
        return {'state': self.journal['state'], 'failure': self.journal.get('failure'),
                'last_refusal': self.journal.get('last_refusal'), 'mode': self.mode,
                'protocol': HANDOFF_PROTOCOL, 'supervisor_sha256': SUPERVISOR_SHA256,
                'drill_id': self.journal.get('drill_id')}

    def busy(self):
        return self.journal['state'] != 'RUNNING_EXTERNAL'

    def _apply(self, name):
        profile = self.profiles[name]
        sup = self.sup
        sup.profile = name
        sup.executable, sup.command, sup.env = profile['executable'], list(profile['command']), dict(profile['env'])
        sup.cwd, sup.log_path = profile.get('cwd'), profile.get('log_path')

    def _fail(self, detail):
        self.sup.paused = True
        self.sup.requested = False
        child = self.sup.child
        evidence = None
        if child is not None:
            evidence = {'pid': child.pid, 'returncode': child.poll(), 'supervisor_state': self.sup.state,
                        'profile': self.sup.profile, 'instance': str(self.sup.instance) if self.sup.instance else None}
        self._set('HANDOFF_FAILED', detail, evidence=evidence)
        self.sup.state = 'HANDOFF_FAILED' if self.sup.child is None else self.sup.state

    def _identity_for(self, expect):
        return {'host': socket.gethostname().split('.')[0].lower(), 'revision': expect,
                'worker_sha256': sha256_file(self.checks.c['worker_file']), 'supervisor_sha256': SUPERVISOR_SHA256}

    def _withdraw_drain(self):
        sup = self.sup
        sup.requested = False
        if sup.instance:
            (sup.instance / 'drain').unlink(missing_ok=True)
        sup.drain_since = None

    # ---- operator request (worker socket, under the worker lock)
    def request(self, req):
        def refuse(*codes):
            self.journal['last_refusal'] = {'at': time.time(), 'target': req.get('target'), 'codes': list(codes)}
            return {'ok': False, 'refused': list(codes), **self.sup.status()}
        if set(req) != HANDOFF_KEYS or req.get('target') not in ('fallback', 'external'):
            return refuse('REQUEST_INVALID: requires exactly op, target (fallback|external), expect_revision, reason')
        if not isinstance(req['expect_revision'], str) or not re.fullmatch(r'[0-9a-f]{40}', req['expect_revision']):
            return refuse('REQUEST_INVALID: expect_revision must be a full lowercase commit id')
        if not isinstance(req['reason'], str) or not 20 <= len(req['reason']) <= 500:
            return refuse('REQUEST_INVALID: reason must be 20-500 characters')
        state = self.journal['state']
        authorized = {'target': req['target'], 'reason': req['reason']}
        if req['target'] == 'fallback':
            if state != 'RUNNING_EXTERNAL' or self.sup.profile != 'external' or self.sup.state != 'IDLE':
                return refuse('STATE: handoff needs RUNNING_EXTERNAL with a sealed-idle backend (now %s/%s)' % (state, self.sup.state))
            refusals = self.checks.preflight_fallback(self.sup, req['expect_revision'])
            if refusals:
                return refuse(*refusals)
            # Prepare the isolated fallback directories now, while external still serves;
            # then re-validate read-only. Any failure leaves the external backend untouched.
            refusals = self.checks.fallback_ready(create=True) or self.checks.fallback_ready(create=False)
            if refusals:
                return refuse(*refusals)
            if not self._lock():
                return refuse('CONCURRENT: recovery lock taken')
            self.deadline = self.clock() + self.quiesce_timeout
            self.sup.requested = True
            self._set('QUIESCING', 'owner drain of the external backend', authorized=authorized,
                      drill_id=uuid.uuid4().hex, transition_id=uuid.uuid4().hex,
                      identity=self._identity_for(req['expect_revision']), evidence=None, failure=None,
                      request={**authorized, 'expect_revision': req['expect_revision'], 'at': time.time()})
            return {'ok': True, 'accepted': 'fallback', **self.sup.status()}
        if state not in ('RUNNING_FALLBACK', 'HANDOFF_FAILED'):
            return refuse('STATE: return needs RUNNING_FALLBACK or HANDOFF_FAILED (now %s)' % state)
        refusals = self.checks.preflight_return(self.sup, req['expect_revision'])
        if refusals:
            return refuse(*refusals)
        if not self._lock():
            return refuse('CONCURRENT: recovery lock taken')
        fields = {'authorized': authorized, 'transition_id': uuid.uuid4().hex,
                  'identity': self._identity_for(req['expect_revision']),
                  'request': {**authorized, 'expect_revision': req['expect_revision'], 'at': time.time()}}
        if state == 'HANDOFF_FAILED':
            fields['drill_id'] = None  # a failed drill can never become a proven round trip
        child = self.sup.child
        if child is not None and self.sup.profile == 'external':
            # The owner's own external child (e.g. one that missed its startup deadline)
            # is now verified ready: resume supervising it. Nothing is adopted.
            self.sup.paused = False
            self.sup.state = 'IDLE'
            self._set('RUNNING_EXTERNAL', 'owned external child re-verified ready after %s' % state, **fields)
            return {'ok': True, 'accepted': 'external', **self.sup.status()}
        if child is not None:
            self._begin_fallback_drain('return', 'owner drain of the verified-idle fallback', **fields)
        else:
            self._start_external(**fields)
        return {'ok': True, 'accepted': 'external', **self.sup.status()}

    # ---- transitions (supervisor tick, under the worker lock)
    def _begin_fallback_drain(self, purpose, detail, **fields):
        self.sup.paused = False
        self.sup.requested = True
        self.sup.drain_since = None
        self.deadline = self.clock() + self.stop_timeout
        self._set('QUIESCING_FALLBACK', detail, purpose=purpose, **fields)

    def _start_external(self, **fields):
        self._apply('external')
        if self.checks.c['listeners'](self.checks.c['port']) != []:
            return self._fail('FOREIGN_LISTENER before external start')
        self.sup.paused = False
        self.sup.failures = []
        self.sup.retry_at = 0
        self.sup.state = 'WAITING'
        self.deadline = self.clock() + self.boot_timeout
        self._set('STARTING_EXTERNAL', 'owner start of the deployed external backend', **fields)

    def may_release(self, child):
        """Last owner check immediately before signalling a drained child (the backend
        has already fenced admission and sealed 'drained'). False aborts the drain."""
        state = self.journal['state']
        if state not in ('QUIESCING', 'QUIESCING_FALLBACK'):
            return True
        problems = self.checks._listener(child.pid)
        if not self.sup.worker_idle():
            problems.append('ACTIVE_JOB: worker admitted work during the drain')
        if state == 'QUIESCING':
            problems += self.checks.fallback_ready(create=False)
        if not problems:
            return True
        self._withdraw_drain()
        self._abort(state, 'RELEASE_REFUSED: ' + '; '.join(problems))
        return False

    def _abort(self, state, code):
        self.journal['last_refusal'] = {'at': time.time(), 'target': 'fallback' if state == 'QUIESCING' else 'external',
                                        'codes': [code]}
        if state == 'QUIESCING':
            self._set('RUNNING_EXTERNAL', 'handoff aborted before release; external backend untouched')
        elif self.journal.get('purpose') == 'return':
            self.sup.state = 'RUNNING_FALLBACK'
            self._set('RUNNING_FALLBACK', 'return aborted before release; fallback left running, not signalled')
        else:
            self._fail('FALLBACK_UNVERIFIED: %s; %s; owned fallback left running, not signalled'
                       % (self.journal.get('unverified') or '', code))

    def on_released(self):
        """Called after the owner stopped and released its sealed, drained child."""
        state = self.journal['state']
        if state == 'QUIESCING_FALLBACK':
            if self.journal.get('purpose') != 'return':
                self._fail('FALLBACK_UNVERIFIED: %s; owned fallback drained and stopped, port left free'
                           % (self.journal.get('unverified') or ''))
                return True
            self._set('FALLBACK_RELEASED', 'fallback child drained and stopped by its owner; owner record released')
            self._start_external()
            return True
        if state != 'QUIESCING':
            return False
        self._set('BACKEND_RELEASED', 'external child drained and stopped by its owner; owner record released')
        if self.checks.c['listeners'](self.sup.port) != [] or not port_available(self.sup.port):
            self._fail('FOREIGN_LISTENER: port not free after release')
            return True
        problems = self.checks.fallback_ready(create=False)
        if problems:
            self._fail('FALLBACK_PREPARE: %s' % '; '.join(problems))
            return True
        self._apply('fallback')
        self._set('STARTING_FALLBACK', 'owner start of fallback package %s' % self.checks.c['package_commit'][:12])
        self.sup._spawn()
        if self.sup.state != 'STARTING' or self.sup.child is None:
            self._fail('FALLBACK_SPAWN: %s' % self.sup.state)
            return True
        self.deadline = self.clock() + self.boot_timeout
        return True

    def _child_exited(self, what='FALLBACK_EXITED'):
        child = self.sup.child
        code = child.poll()
        if group_exists(child.pid):
            self.sup.state = 'RECOVERY_BLOCKED'
            self._fail('%s rc=%s but its process group survives; owner record kept' % (what, code))
            return
        self.sup._release()
        self._fail('%s rc=%s; not restarted; evidence kept in %s' % (what, code, self.sup.log_path))

    def tick(self):
        """True: the handoff owns this tick. False: let the Supervisor's own proven
        spawn/seal/drain path run (external supervision, drains, external startup)."""
        state = self.journal['state']
        sup = self.sup
        if state == 'RUNNING_EXTERNAL':
            return False
        if state == 'HANDOFF_FAILED':
            sup.paused = True
            if sup.child is not None and sup.child.poll() is not None:
                if not group_exists(sup.child.pid):
                    sup._release()
            if sup.child is None and sup.state not in ('RECOVERY_BLOCKED',):
                sup.state = 'HANDOFF_FAILED'
            return True
        if state == 'QUIESCING':
            if sup.state in ('RECOVERY_BLOCKED', 'CIRCUIT_OPEN', 'BACKOFF'):
                self._fail('QUIESCE: external backend left owner control (%s)' % sup.state)
                return True
            if self.deadline is not None and self.clock() > self.deadline and sup.child is not None:
                self._withdraw_drain()
                self._abort('QUIESCING', 'QUIESCE_TIMEOUT: backend did not drain; left running')
                return True
            return False  # the owner's proven drain path runs, then calls on_released()
        if state == 'STARTING_FALLBACK':
            if sup.child is None or sup.child.poll() is not None:
                if sup.child is not None:
                    self._child_exited()
                else:
                    self._fail('FALLBACK_SPAWN: no child')
                return True
            failures = self.checks.verify_fallback(sup.child.pid)
            if not failures:
                sup.state = 'RUNNING_FALLBACK'
                self._set('RUNNING_FALLBACK', 'fallback verified: internal-fallback, publication disabled, 3 models')
            elif self.clock() > self.deadline:
                # Never SIGTERM an unverified fallback that may already have admitted work:
                # it is stopped only through the same drained-seal handshake.
                self._begin_fallback_drain('unverified', 'owner drain of the unverified fallback',
                                           unverified='; '.join(failures))
            else:
                sup.state = 'STARTING_FALLBACK'
            return True
        if state == 'RUNNING_FALLBACK':
            if sup.child is None or sup.child.poll() is not None:
                self._child_exited() if sup.child is not None else self._fail('FALLBACK_LOST')
                return True
            sup.state = 'RUNNING_FALLBACK'
            return True
        if state == 'QUIESCING_FALLBACK':
            if sup.child is None:
                self._fail('QUIESCE_FALLBACK: owned fallback child lost')
                return True
            if sup.child.poll() is not None:
                self._child_exited('FALLBACK_EXITED during drain')
                return True
            if sup.state in ('RECOVERY_BLOCKED', 'CIRCUIT_OPEN'):
                self._fail('QUIESCE_FALLBACK: fallback left owner control (%s); owner record kept' % sup.state)
                return True
            if self.deadline is not None and self.clock() > self.deadline:
                self._withdraw_drain()
                self._abort('QUIESCING_FALLBACK', 'QUIESCE_TIMEOUT: fallback did not seal drained; not signalled')
                return True
            return False  # Supervisor drain: fence, drained seal, session check, release, on_released()
        if state == 'STARTING_EXTERNAL':
            child = sup.child
            if sup.state in ('RECOVERY_BLOCKED', 'CIRCUIT_OPEN'):
                self._fail('RETURN: external backend %s' % sup.state)
                return True
            if child is not None and child.poll() is not None:
                self._child_exited('RETURN: external exited before readiness')
                return True
            if child is not None and sup.state == 'IDLE' and not self.checks.verify_external(child.pid, sup):
                self._set('RUNNING_EXTERNAL', 'external backend verified ready under its owner')
                return False
            if self.deadline is not None and self.clock() > self.deadline:
                problems = self.checks.verify_external(child.pid, sup) if child is not None else ['no child started']
                self._fail('START_TIMEOUT: external backend not ready within %ss (supervisor %s; %s); any owned child '
                           'is kept as evidence and not signalled' % (self.boot_timeout, sup.state, '; '.join(problems)))
                return True
            return False
        return False


def production_handoff_config(project, runtime, root):
    """Every value is a constant or derived from the deployed worktree; no environment
    variable, request field or fixture can change it."""
    home = root.parent
    # v2 = v1 (c7708e4) + the owner drain protocol. Source branch
    # rollback/wc2tb-fallback-drain-v2-20261121; the package is built and installed only
    # in an approved maintenance window (docs/WC2TB_RECOVERY_RUNBOOK.md, section I).
    package = home / 'Library/Application Support/DexDiffusion/wc2tb-fallback-rollback-v2'
    fallback_cwd = package / 'source/operator-console'
    # PATH matches scripts/run-backend-service.sh: the fallback's heavy-inference arbiter
    # probes `ollama ps` (in /opt/homebrew/bin) and fails closed when it cannot run it,
    # which left the 2026-11-21 live drill's fallback unable to admit any image job.
    fallback_env = {'HOME': str(home), 'PATH': '/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin:/usr/sbin:/sbin',
                    'DEX_DATA_ROOT': str(home / 'DexDiffusion-InternalFallback'),
                    'DEX_STORAGE_MODE': 'internal-fallback', 'DEX_STORAGE_REASON': 'owner-handoff-v2',
                    'DEX_LOCAL_ENGINE_BRIDGE': '0', 'DEX_CHAT_ENABLED': '0', 'OPERATOR_CONSOLE_PORT': '31337',
                    'DEX_AUTHORIZED_TAILSCALE_USERS': 'westkitty,bcroc',
                    'DEX_IMAGE_VALIDATION_PYTHON': str(home / 'Library/Caches/DexDiffusion/mflux/venv/bin/python')}

    def worker_expected():
        try:
            blob = subprocess.run(['/usr/bin/git', '-C', str(project), 'show', 'HEAD:sdcpp-workflow/worker/engine-worker.py'],
                                  capture_output=True, timeout=5)
        except (OSError, subprocess.TimeoutExpired):
            return None
        return hashlib.sha256(blob.stdout).hexdigest() if blob.returncode == 0 else None

    def parent_command():
        try:
            out = subprocess.run(['/bin/ps', '-o', 'command=', '-p', str(os.getppid())], capture_output=True, text=True, timeout=4)
            return out.stdout.strip()
        except (OSError, subprocess.TimeoutExpired):
            return None

    stamp = time.strftime('%Y%m%dT%H%M%S')
    return {
        'base': 'http://127.0.0.1:31337', 'port': 31337, 'home': str(home), 'project': str(project),
        'external_cwd': str(project / 'operator-console'), 'external_script': 'scripts/run-backend-service.sh',
        'node_path': str(runtime), 'node_sha256': '266dec4dce3a6cdcf5cdc38722a00cf5ae6a12cc51068d2a227655bbb75751ec',
        'enginehost_path': str(home / 'Applications/DexDiffusion Engine Worker.app/Contents/MacOS/DexDiffusionEngineHost'),
        'enginehost_sha256': '79faeb90fa089261f174205e8a887b62c684fffba1b8ece9eaa4daa690eec4d3',
        'parent_command': parent_command, 'worker_file': str(root / 'engine-worker.py'), 'worker_expected_sha256': worker_expected,
        'package': str(package), 'package_commit': '3f0abf5d0bd9c1d3777a9abbf46181ce2e040350',
        'publication_isolated_commits': ('3f0abf5d0bd9c1d3777a9abbf46181ce2e040350',),
        'starter_sha256': '03bb7a28a8849fcf28736ceab2f422853e361559eb09ef7ee5bd1cf60c364ce2',
        'ui_sha256': '44e7e73974642c1c71b57592c61a078b40415f0a931ab90bce1c0798030577e8',
        'source_manifest': str(project / 'rollback-packages/wc2tb-emergency-internal-fallback-rollback-v2/SOURCE-SHA256SUMS'),
        'source_manifest_sha256': 'de9f5719a59d621596e9e133ec2582c9eeda8f0e86cfe5c792343248cbdf3ba3',
        'required_deps': ('express', 'three', '@sparkjsdev/spark'),
        'fallback_cwd': str(fallback_cwd), 'fallback_env': fallback_env,
        'fallback_root': str(home / 'DexDiffusion-InternalFallback'),
        'fallback_log': str(package / 'logs' / ('owner-handoff-%s.log' % stamp)),
        'fallback_min_free_bytes': 2 << 30,
        'listeners': lsof_listeners,
        'recovery_locks': (str(home / 'Library/Caches/DexDiffusion/authorized-backend-recovery.lock'),
                           str(root / 'backend-handoff.lock')),
    }


def attach_handoff(supervisor, config, mode, **timeouts):
    # Pure construction: nothing is created here. The fallback layout and log are
    # prepared only by an accepted owner request, while the external backend still runs.
    external = {'executable': supervisor.executable, 'command': list(supervisor.command), 'env': dict(supervisor.env),
                'cwd': supervisor.cwd, 'log_path': supervisor.log_path}
    fallback = {'executable': config['node_path'], 'command': [config['node_path'], 'server.js'],
                'env': dict(config['fallback_env']), 'cwd': config['fallback_cwd'], 'log_path': config['fallback_log']}
    supervisor.handoff = HandoffController(supervisor, supervisor.root / 'backend-handoff.json', HandoffChecks(config),
                                           external, fallback, mode, clock=supervisor.clock, **timeouts)
    return supervisor.handoff


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
    if mode in ('rehearsal', 'rehearsal-preparation'):
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
        raise RuntimeError('unknown backend supervisor mode')
    env = {'HOME': str(root.parent), 'PATH': '/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin:/usr/sbin:/sbin',
           'OPERATOR_CONSOLE_PORT': str(port), 'DEX_SUPERVISED_NODE': str(runtime),
           'DEX_AUTHORIZED_TAILSCALE_USERS': 'westkitty,bcroc',
           'DEX_IMAGE_VALIDATION_PYTHON': '/Users/bigmac/Library/Caches/DexDiffusion/mflux/venv/bin/python'}
    supervisor = Supervisor(root, runtime, ['/bin/bash', str(project / script)], env, port,
                            lambda: not worker.active and not worker.recovery_uncertain and not worker.unacknowledged(),
                            lock_fd)
    supervisor.mode = 'rehearsal' if mode == 'rehearsal-preparation' else mode
    supervisor.fixture_bootstrap = None
    if mode == 'rehearsal-preparation':
        source = Path(__file__).with_name('gate-e-fixture.py')
        spec = importlib.util.spec_from_file_location('dex_gate_e_fixture', source)
        module = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(module)
        supervisor.fixture_bootstrap = module
        supervisor.paused = True
        supervisor.state = 'FIXTURE_REQUIRED'
    if supervisor.mode == 'production':
        attach_handoff(supervisor, production_handoff_config(project, runtime, root), 'production')
    return supervisor
