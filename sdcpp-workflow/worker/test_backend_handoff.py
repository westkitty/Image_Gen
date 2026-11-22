"""Isolated tests for the owner-authorized production <-> internal-fallback handoff.

Real child processes on test ports, real lsof listener identity, a real git
worktree, a private package, a private trusted manifest and private roots. Never
touches 31337, the production worker, EngineHost, WC2TB or the MacBook. Letters
map to docs/WC2TB_RECOVERY_RUNBOOK.md ("Which tests prove source behavior").
"""
import fcntl
import hashlib
import http.server
import importlib.util
import json
import os
from pathlib import Path
import shutil
import signal
import socket
import socketserver
import subprocess
import sys
import tempfile
import threading
import time
import unittest
import urllib.error
import urllib.request

spec = importlib.util.spec_from_file_location('backend_supervisor', Path(__file__).with_name('backend-supervisor.py'))
module = importlib.util.module_from_spec(spec)
spec.loader.exec_module(module)

# Fake external backend. Fixture switches: active-job, lease, pending, ext-noseal (alive,
# never ready), ext-unhealthy (seals, but answers as another process), ext-exit (dies at boot).
EXTERNAL = r'''
import http.server, json, os, pathlib, socketserver, sys, threading, time
root = pathlib.Path(os.environ['DEX_BACKEND_CONTROL']); fx = pathlib.Path(os.environ['FIXTURE'])
if (fx / 'ext-exit').exists():
    sys.exit(4)
def body(path):
    if path == '/api/version':
        return {'pid': os.getpid() + (1 if (fx / 'ext-unhealthy').exists() else 0), 'cwd': os.environ['EXTERNAL_CWD'],
                'storage': {'mode': 'external'}}
    if path == '/api/jobs':
        return {'jobs': [{'id': 'j'}] if (fx / 'active-job').exists() else []}
    if path == '/api/resources':
        return {'owner': 'job-1' if (fx / 'lease').exists() else None, 'waiting': [], 'quarantine': None}
    if path == '/api/publications/status':
        return {'enabled': True, 'pending': 1 if (fx / 'pending').exists() else 0}
    if path == '/api/publication-recovery':
        return {'blocked': False, 'transfers': {'pending': [], 'blocked': []}}
class H(http.server.BaseHTTPRequestHandler):
    def log_message(self, *a): pass
    def do_GET(self):
        data = json.dumps(body(self.path)).encode()
        self.send_response(200); self.send_header('Content-Length', str(len(data))); self.end_headers(); self.wfile.write(data)
class Server(http.server.ThreadingHTTPServer):
    def server_bind(self):  # skip getfqdn(): reverse DNS stalls on macOS CI runners
        socketserver.TCPServer.server_bind(self)
        self.server_name, self.server_port = self.server_address[:2]
server = Server(('127.0.0.1', int(os.environ['PORT'])), H)
def seal():
    while True:
        if not (fx / 'ext-noseal').exists():
            state = 'drained' if (root / 'drain').exists() else 'idle'
            (root / 'idle.t').write_text(f'{os.getpid()} {state}\n'); (root / 'idle.t').replace(root / 'idle')
        time.sleep(.04)
threading.Thread(target=seal, daemon=True).start()
server.serve_forever()
'''

# Fake internal fallback speaking the real owner drain protocol (DEX_BACKEND_CONTROL):
# admission is fenced (503) once `drain` exists, and "<pid> drained" is sealed only when
# no work is active. Fault switches: fb-busy (active job), fb-lease, fb-noseal, fb-stale
# (one seal, never refreshed), fb-forge (seal names another pid), fb-predrained (claims
# drained without a drain request), fb-orphan (a group member that survives SIGTERM).
FALLBACK = r'''
import http.server, json, os, pathlib, signal, socketserver, subprocess, sys, threading, time, urllib.request
fx = pathlib.Path(os.environ['DEX_DATA_ROOT']).parent / 'fixture'
control = pathlib.Path(os.environ['DEX_BACKEND_CONTROL'])
(fx / 'fallback-env.json').write_text(json.dumps(sorted(os.environ)))
print('fallback booting pid=%d' % os.getpid(), flush=True)
if (fx / 'fail-boot').exists():
    print('FATAL: simulated boot failure', flush=True); sys.exit(3)
for key, value in os.environ.items():
    if 'MACBOOK' in key:
        urllib.request.urlopen(value, timeout=1)  # what an unisolated build would do
if (fx / 'fb-orphan').exists():
    orphan = subprocess.Popen([sys.executable, '-c', 'import signal,time;signal.signal(signal.SIGTERM,signal.SIG_IGN);time.sleep(60)'])
    (fx / 'orphan-pid').write_text(str(orphan.pid))
def busy():
    return (fx / 'fb-busy').exists() or (fx / 'fb-lease').exists()
def body(path):
    return {'/api/version': {'pid': os.getpid(), 'cwd': os.getcwd(), 'storage': {'mode': os.environ.get('DEX_STORAGE_MODE')}},
            '/api/jobs': {'jobs': [{'id': 'fallback-job'}] if (fx / 'fb-busy').exists() else []},
            '/api/resources': {'owner': 'job-9' if (fx / 'fb-lease').exists() else None, 'waiting': [], 'quarantine': None},
            '/api/publications/status': {'enabled': (fx / 'publication-on').exists(), 'pending': 0},
            '/api/capabilities': {'modelTargets': [{'id': x} for x in ('sdxl-photonic', 'flux-fp8', 'flux2-klein-4b')]},
            '/dexdiffusion/': {}}.get(path)
class H(http.server.BaseHTTPRequestHandler):
    def log_message(self, *a): pass
    def fenced(self):
        if (control / 'drain').exists():
            with open(fx / 'refused-after-fence', 'a') as log:
                log.write(self.command + ' ' + self.path + '\n')
            self.send_response(503); self.send_header('Content-Length', '0'); self.end_headers()
            return True
        return False
    def do_GET(self):
        if self.fenced():
            return
        data = json.dumps(body(self.path)).encode()
        self.send_response(200); self.send_header('Content-Length', str(len(data))); self.end_headers(); self.wfile.write(data)
    def do_POST(self):
        if self.fenced():
            return
        (fx / 'fb-busy').touch()  # an admitted job is now active
        self.send_response(202); self.send_header('Content-Length', '0'); self.end_headers()
class Server(http.server.ThreadingHTTPServer):
    def server_bind(self):  # skip getfqdn(): reverse DNS stalls on macOS CI runners
        socketserver.TCPServer.server_bind(self)
        self.server_name, self.server_port = self.server_address[:2]
def seal():
    first = True
    while True:
        target = control / 'idle'
        pid = os.getpid() + (1 if (fx / 'fb-forge').exists() else 0)
        if (fx / 'fb-noseal').exists() or ((fx / 'fb-stale').exists() and not first):
            pass
        elif busy():
            target.unlink(missing_ok=True)
        else:
            state = 'drained' if (control / 'drain').exists() or (fx / 'fb-predrained').exists() else 'idle'
            (control / 'idle.t').write_text(f'{pid} {state}\n'); (control / 'idle.t').replace(target)
        first = False
        time.sleep(.04)
threading.Thread(target=seal, daemon=True).start()
Server(('127.0.0.1', int(os.environ['OPERATOR_CONSOLE_PORT'])), H).serve_forever()
'''


def sha(path):
    return hashlib.sha256(Path(path).read_bytes()).hexdigest()


def free_port():
    with socket.socket() as sock:
        sock.bind(('127.0.0.1', 0))
        return sock.getsockname()[1]


class Server(http.server.ThreadingHTTPServer):
    def server_bind(self):  # skip getfqdn(): reverse DNS stalls on macOS CI runners
        socketserver.TCPServer.server_bind(self)
        self.server_name, self.server_port = self.server_address[:2]


class Canary(http.server.BaseHTTPRequestHandler):
    hits = []

    def log_message(self, *a):
        pass

    def do_GET(self):
        Canary.hits.append(self.path)
        self.send_response(200)
        self.end_headers()


def write_manifest(path, source_root, names):
    lines = ['%s  %s' % (sha(Path(source_root) / name), name) for name in sorted(names)]
    Path(path).write_text('\n'.join(lines) + '\n')
    return sha(path)


@unittest.skipUnless(shutil.which('lsof') or os.path.exists('/usr/sbin/lsof'), 'lsof is required for listener identity')
class HandoffTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        t = self.root = Path(self.temp.name).resolve()
        self.fx = t / 'fixture'
        self.fx.mkdir()
        self.lock = (t / 'worker.lock').open('w')
        self.port = free_port()
        project = t / 'project'
        (project / 'scripts').mkdir(parents=True)
        (project / 'operator-console').mkdir()
        (project / 'scripts/run-backend-service.sh').write_text('#!/bin/bash\n')
        (project / 'sdcpp-workflow/worker').mkdir(parents=True)
        (project / 'sdcpp-workflow/worker/engine-worker.py').write_text('# worker\n')
        git = ['git', '-C', str(project), '-c', 'user.name=t', '-c', 'user.email=t@example.invalid']
        subprocess.run(['git', 'init', '-q', str(project)], check=True)
        subprocess.run(git + ['add', '-A'], check=True)
        subprocess.run(git + ['commit', '-qm', 'fixture'], check=True)
        self.rev = subprocess.run(['git', '-C', str(project), 'rev-parse', 'HEAD'], capture_output=True, text=True).stdout.strip()
        engine = t / 'engine'
        engine.mkdir()
        (engine / 'engine-worker.py').write_text('# worker\n')
        (t / 'EngineHost').write_text('signed host\n')
        (t / 'node').write_text('pinned node\n')
        package = t / 'package'
        cwd = package / 'source/operator-console'
        (cwd / 'public/dexdiffusion').mkdir(parents=True)
        (cwd / 'server.js').write_text(FALLBACK)
        (cwd / 'backend-quiescence.js').write_text('// owner drain protocol\n')
        (cwd / 'package.json').write_text('{"name":"fixture"}\n')
        (cwd / 'package-lock.json').write_text('{"lockfileVersion":3}\n')
        (cwd / 'public/dexdiffusion/edit-ui.js').write_text('ui\n')
        for dep in ('express', 'three', '@sparkjsdev/spark'):
            (cwd / 'node_modules' / dep).mkdir(parents=True)
            (cwd / 'node_modules' / dep / 'package.json').write_text('{}')
        (package / 'SOURCE_COMMIT').write_text('c' * 40 + '\n')
        (package / 'start-fallback-rollback.sh').write_text('#!/bin/bash\n')
        (package / 'logs').mkdir(mode=0o700)
        self.manifest_names = list(module.MANIFEST_REQUIRED) + ['operator-console/public/dexdiffusion/edit-ui.js']
        trusted = t / 'trusted'
        trusted.mkdir()
        self.manifest = trusted / 'SOURCE-SHA256SUMS'
        manifest_sha = write_manifest(self.manifest, package / 'source', self.manifest_names)
        self.images = t / 'canonical-images'
        self.images.mkdir()
        for n in range(3):
            (self.images / f'img-{n}.png').write_bytes(os.urandom(512))
        self.receipts = t / 'receipts'
        self.receipts.mkdir()
        (self.receipts / 'r1.json').write_text('{"state":"CANONICAL_VERIFIED"}')
        self.listener_extra = []
        self.after_release = None
        self.worker_expected = lambda: sha(engine / 'engine-worker.py')
        self.parent = str(t / 'EngineHost')
        self.config = {
            'base': f'http://127.0.0.1:{self.port}', 'port': self.port, 'home': str(t), 'project': str(project),
            'external_cwd': str(project / 'operator-console'), 'external_script': 'scripts/run-backend-service.sh',
            'node_path': str(t / 'node'), 'node_sha256': sha(t / 'node'),
            'enginehost_path': str(t / 'EngineHost'), 'enginehost_sha256': sha(t / 'EngineHost'),
            'parent_command': lambda: self.parent, 'worker_file': str(engine / 'engine-worker.py'),
            'worker_expected_sha256': lambda: self.worker_expected(),
            'package': str(package), 'package_commit': 'c' * 40, 'publication_isolated_commits': ('c' * 40,),
            'starter_sha256': sha(package / 'start-fallback-rollback.sh'), 'ui_sha256': sha(cwd / 'public/dexdiffusion/edit-ui.js'),
            'source_manifest': str(self.manifest), 'source_manifest_sha256': manifest_sha,
            'required_deps': ('express', 'three', '@sparkjsdev/spark'), 'fallback_cwd': str(cwd),
            'fallback_env': {'HOME': str(t), 'PATH': '/usr/bin:/bin', 'DEX_DATA_ROOT': str(t / 'fallback-root'),
                             'DEX_STORAGE_MODE': 'internal-fallback', 'OPERATOR_CONSOLE_PORT': str(self.port)},
            'fallback_root': str(t / 'fallback-root'), 'fallback_log': str(package / 'logs/owner-handoff-test.log'),
            'fallback_min_free_bytes': 1 << 20,
            'listeners': self.listeners,
            'recovery_locks': (str(t / 'authorized-backend-recovery.lock'), str(engine / 'backend-handoff.lock')),
        }
        # Fallback profile runs the fake server.js with Python instead of Node.
        self.sup = module.Supervisor(engine, sys.executable, [sys.executable, '-c', EXTERNAL],
                                     {'PORT': str(self.port), 'FIXTURE': str(self.fx), 'EXTERNAL_CWD': str(project / 'operator-console'),
                                      'DEX_MACBOOK_IMAGES_URL': 'http://127.0.0.1:1/never'},
                                     self.port, lambda: True, self.lock.fileno())
        self.attach()
        self.engine = engine
        self.groups = []

    def attach(self):
        handoff = module.attach_handoff(self.sup, self.config, 'isolated-test', quiesce_timeout=5, boot_timeout=8, stop_timeout=6)
        handoff.profiles['fallback']['executable'] = sys.executable
        handoff.profiles['fallback']['command'] = [sys.executable, 'server.js']
        self.handoff = handoff

    def listeners(self, port):
        found = module.lsof_listeners(port)
        if found is not None and self.after_release and self.handoff.journal['state'] == 'BACKEND_RELEASED':
            self.after_release()
            self.after_release = None
            found = module.lsof_listeners(port)
        return None if found is None else sorted(found + self.listener_extra)

    def tearDown(self):
        for child in [self.sup.child] + self.groups:
            if child is not None and module.group_exists(child.pid):
                os.killpg(child.pid, signal.SIGKILL)
            if child is not None:
                child.wait(4)
        orphan = self.fx / 'orphan-pid'
        if orphan.exists():
            try:
                os.kill(int(orphan.read_text()), signal.SIGKILL)
            except ProcessLookupError:
                pass
        self.lock.close()
        self.temp.cleanup()

    def until(self, predicate, seconds=12):
        deadline = time.monotonic() + seconds
        while time.monotonic() < deadline:
            self.sup.tick()
            if predicate():
                return
            time.sleep(.05)
        self.fail(json.dumps(self.sup.status()))

    def start_external(self):
        self.until(lambda: self.sup.state == 'IDLE')
        return self.sup.child

    def ask(self, target, **extra):
        req = {'op': 'backend-handoff', 'target': target, 'expect_revision': self.rev,
               'reason': 'isolated test of the owner handoff path', **extra}
        return self.handoff.request(req)

    def journal(self):
        return json.loads((self.engine / 'backend-handoff.json').read_text())

    def states(self):
        return [h['state'] for h in self.journal()['history']]

    def assert_untouched(self, child):
        self.assertIs(self.sup.child, child)
        self.assertIsNone(child.poll())
        self.assertEqual(self.handoff.journal['state'], 'RUNNING_EXTERNAL')
        self.assertEqual(module.lsof_listeners(self.port), [child.pid])

    def snapshot(self):
        return {p.name: sha(p) for p in sorted(self.images.iterdir())}, (self.receipts / 'r1.json').read_text()

    def refused(self, reply, code):
        self.assertFalse(reply['ok'], reply)
        self.assertTrue(any(r.startswith(code) for r in reply['refused']), reply)

    def enter_fallback(self):
        self.start_external()
        self.assertTrue(self.ask('fallback')['ok'])
        self.until(lambda: self.handoff.journal['state'] == 'RUNNING_FALLBACK')
        return self.sup.child

    def assert_fallback_kept(self, fallback):
        """The fallback was never signalled: same owned child, alive, sole listener."""
        self.assertIs(self.sup.child, fallback)
        self.assertIsNone(fallback.poll())
        self.assertEqual(module.lsof_listeners(self.port), [fallback.pid])

    def http_post(self, path):
        try:
            with urllib.request.urlopen(urllib.request.Request(self.config['base'] + path, data=b'{}', method='POST'), timeout=3) as r:
                return r.status
        except urllib.error.HTTPError as error:
            error.close()
            return error.code

    # ======================================================== A, L, M, N (full path)
    def test_A_L_M_N_full_owner_handoff_and_return(self):
        before = self.snapshot()
        server = Server(('127.0.0.1', 0), Canary)
        threading.Thread(target=server.serve_forever, daemon=True).start()
        canary = f'http://127.0.0.1:{server.server_address[1]}/manifest'
        self.sup.env['DEX_MACBOOK_IMAGES_URL'] = canary
        self.handoff.profiles['external']['env']['DEX_MACBOOK_IMAGES_URL'] = canary
        Canary.hits = []
        old = self.start_external()
        self.assertFalse(Path(self.config['fallback_root']).exists(), 'nothing is prepared before an accepted request')
        reply = self.ask('fallback')
        self.assertTrue(reply['ok'], reply)
        # Preparation happened while the external backend was still serving.
        self.assertIsNone(old.poll())
        self.assertTrue((Path(self.config['fallback_root']) / 'output/audio/voice').is_dir())
        self.until(lambda: self.handoff.journal['state'] == 'RUNNING_FALLBACK')
        fallback = self.sup.child
        self.assertIsNotNone(old.poll())
        self.assertFalse(module.group_exists(old.pid))
        self.assertEqual(module.lsof_listeners(self.port), [fallback.pid])
        status = self.sup.status()
        self.assertEqual((status['profile'], status['state'], status['handoff']['state']), ('fallback', 'RUNNING_FALLBACK', 'RUNNING_FALLBACK'))
        self.assertEqual(self.states(), ['QUIESCING', 'BACKEND_RELEASED', 'STARTING_FALLBACK', 'RUNNING_FALLBACK'])
        # L: no MacBook destination is reachable from fallback, even though the external profile had one.
        self.assertFalse([k for k in json.loads((self.fx / 'fallback-env.json').read_text()) if 'MACBOOK' in k])
        # An external-mode restart cannot reclaim the port while in fallback.
        self.assertFalse(self.sup.request_restart())
        for _ in range(10):
            self.sup.tick()
        self.assertIs(self.sup.child, fallback)
        # N: owner-controlled, drain-sealed return to external supervision.
        reply = self.ask('external')
        self.assertTrue(reply['ok'], reply)
        self.until(lambda: self.handoff.journal['state'] == 'RUNNING_EXTERNAL')
        self.assertIsNotNone(fallback.poll())
        self.assertNotIn(self.sup.child.pid, (old.pid, fallback.pid))
        self.assertEqual(self.sup.profile, 'external')
        self.until(lambda: self.sup.state == 'IDLE')
        self.assertEqual(self.states()[-4:], ['QUIESCING_FALLBACK', 'FALLBACK_RELEASED', 'STARTING_EXTERNAL', 'RUNNING_EXTERNAL'])
        self.assertTrue(self.sup.request_restart())
        server.shutdown()
        self.assertEqual(Canary.hits, [])
        self.assertEqual(self.snapshot(), before)  # M
        self.assertTrue(Path(self.config['fallback_log']).read_text().startswith('fallback booting'))
        # Proof identity: one drill, contiguous sequence numbers, one bound identity.
        history = self.journal()['history']
        self.assertEqual(len({h['drill_id'] for h in history}), 1)
        self.assertEqual([h['seq'] for h in history], list(range(history[0]['seq'], history[0]['seq'] + 8)))
        self.assertEqual({(h['revision'], h['mode'], h['supervisor_sha256']) for h in history},
                         {(self.rev, 'isolated-test', module.SUPERVISOR_SHA256)})
        self.assertEqual([h.get('authorized', {}).get('target') for h in history if h.get('authorized')], ['fallback', 'external'])

    # ===================================================== external-side refusals
    def test_B_C_D_active_job_lease_or_pending_publication_refuse(self):
        child = self.start_external()
        for name, code in (('active-job', 'ACTIVE_JOB'), ('lease', 'LEASE'), ('pending', 'PUBLICATION_PENDING')):
            (self.fx / name).touch()
            self.refused(self.ask('fallback'), code)
            self.assert_untouched(child)
            (self.fx / name).unlink()
        self.sup.worker_idle = lambda: False
        self.refused(self.ask('fallback'), 'ACTIVE_JOB')
        self.assert_untouched(child)

    def test_E_foreign_listener_refuses_and_is_never_signalled(self):
        child = self.start_external()
        self.listener_extra = [999999]
        self.refused(self.ask('fallback'), 'FOREIGN_LISTENER')
        self.assert_untouched(child)
        # A foreign process that grabs the port after release fails the handoff and is left alone.
        self.listener_extra = []
        foreign = []
        def grab():
            proc = subprocess.Popen([sys.executable, '-c', 'import socket,sys,time;s=socket.socket();s.setsockopt(socket.SOL_SOCKET,socket.SO_REUSEADDR,1);'
                                     f's.bind(("127.0.0.1",{self.port}));s.listen();print("bound",flush=True);time.sleep(30)'],
                                    stdout=subprocess.PIPE, text=True)
            self.assertEqual(proc.stdout.readline().strip(), 'bound')
            foreign.append(proc)
        self.after_release = grab
        self.assertTrue(self.ask('fallback')['ok'])
        try:
            self.until(lambda: self.handoff.journal['state'] == 'HANDOFF_FAILED')
            self.assertIn('FOREIGN_LISTENER', self.handoff.journal['failure'])
            self.assertIsNone(foreign[0].poll())
            self.assertIsNone(self.sup.child)
            for _ in range(10):
                self.sup.tick()
            self.assertIsNone(self.sup.child)
        finally:
            foreign[0].kill()
            foreign[0].wait()

    def test_F_G_H_package_node_and_identity_refuse(self):
        child = self.start_external()
        starter = Path(self.config['package']) / 'start-fallback-rollback.sh'
        starter.unlink()
        self.refused(self.ask('fallback'), 'FALLBACK_PACKAGE')
        starter.write_text('#!/bin/bash\n')
        Path(self.config['node_path']).write_text('drifted node\n')
        self.refused(self.ask('fallback'), 'NODE_HASH')
        Path(self.config['node_path']).write_text('pinned node\n')
        self.worker_expected = lambda: '0' * 64
        self.refused(self.ask('fallback'), 'IDENTITY_WORKER')
        self.worker_expected = lambda: sha(self.engine / 'engine-worker.py')
        self.parent = '/usr/bin/some-other-parent'
        self.refused(self.ask('fallback'), 'IDENTITY_ENGINEHOST')
        self.parent = self.config['enginehost_path']
        self.refused(self.handoff.request({'op': 'backend-handoff', 'target': 'fallback', 'expect_revision': 'f' * 40,
                                           'reason': 'wrong revision must be refused'}), 'SOURCE_REVISION')
        self.assert_untouched(child)
        self.assertTrue(self.ask('fallback')['ok'])  # all facts restored: accepted

    def test_I_concurrent_operations_are_serialized(self):
        child = self.start_external()
        holder = subprocess.Popen([sys.executable, '-c', 'import fcntl,sys,time;f=open(sys.argv[1],"a");'
                                   'fcntl.flock(f,fcntl.LOCK_EX);print("held",flush=True);time.sleep(30)',
                                   self.config['recovery_locks'][0]], stdout=subprocess.PIPE, text=True)
        try:
            self.assertEqual(holder.stdout.readline().strip(), 'held')
            self.refused(self.ask('fallback'), 'CONCURRENT')
            self.assert_untouched(child)
        finally:
            holder.kill()
            holder.wait()
        self.assertTrue(self.ask('fallback')['ok'])
        second = self.ask('fallback')
        self.assertFalse(second['ok'])
        self.assertTrue(second['refused'][0].startswith('STATE'))
        self.refused(self.ask('external'), 'STATE')
        # The owner holds the recovery lock for the whole transition.
        with open(self.config['recovery_locks'][0], 'a') as handle:
            with self.assertRaises(OSError):
                fcntl.flock(handle, fcntl.LOCK_EX | fcntl.LOCK_NB)
        self.until(lambda: self.handoff.journal['state'] == 'RUNNING_FALLBACK')
        with open(self.config['recovery_locks'][0], 'a') as handle:
            fcntl.flock(handle, fcntl.LOCK_EX | fcntl.LOCK_NB)

    def test_J_failed_fallback_boot_preserves_state_and_never_respawns(self):
        before = self.snapshot()
        self.start_external()
        (self.fx / 'fail-boot').touch()
        self.assertTrue(self.ask('fallback')['ok'])
        self.until(lambda: self.handoff.journal['state'] == 'HANDOFF_FAILED')
        self.assertIn('FALLBACK_EXITED rc=3', self.handoff.journal['failure'])
        self.assertIn('simulated boot failure', Path(self.config['fallback_log']).read_text())
        for _ in range(20):
            self.sup.tick()
        self.assertIsNone(self.sup.child)
        self.assertEqual((self.sup.state, self.sup.paused), ('HANDOFF_FAILED', True))
        self.assertEqual(module.lsof_listeners(self.port), [])
        self.assertFalse(self.sup.owner.exists())
        self.assertEqual(self.snapshot(), before)
        # Only the explicit, re-checked return path restarts the external backend.
        (self.fx / 'fail-boot').unlink()
        self.assertTrue(self.ask('external')['ok'])
        self.until(lambda: self.handoff.journal['state'] == 'RUNNING_EXTERNAL')

    def test_J_unverified_fallback_is_drained_by_its_owner_not_killed(self):
        self.start_external()
        (self.fx / 'publication-on').touch()
        self.assertTrue(self.ask('fallback')['ok'])
        self.until(lambda: self.handoff.journal['state'] == 'HANDOFF_FAILED', seconds=20)
        self.assertIn('FALLBACK_PUBLICATION', self.handoff.journal['failure'])
        self.assertIn('drained and stopped', self.handoff.journal['failure'])
        self.assertIn('QUIESCING_FALLBACK', self.states())
        self.assertIsNone(self.sup.child)
        self.assertEqual(module.lsof_listeners(self.port), [])

    def test_J_unverified_fallback_with_admitted_work_is_kept_not_signalled(self):
        self.start_external()
        (self.fx / 'publication-on').touch()
        self.handoff.boot_timeout = 1
        self.assertTrue(self.ask('fallback')['ok'])
        self.until(lambda: self.handoff.journal['state'] in ('STARTING_FALLBACK', 'QUIESCING_FALLBACK'))
        fallback = self.sup.child
        (self.fx / 'fb-busy').touch()  # the unverified fallback admitted a job before it could be drained
        self.until(lambda: self.handoff.journal['state'] == 'HANDOFF_FAILED', seconds=20)
        self.assertIn('not signalled', self.handoff.journal['failure'])
        self.assert_fallback_kept(fallback)
        self.assertEqual(self.handoff.journal['evidence']['pid'], fallback.pid)

    def test_K_worker_crash_mid_transition_is_reconciled_without_adoption(self):
        for state in ('QUIESCING', 'STARTING_FALLBACK', 'RUNNING_FALLBACK', 'QUIESCING_FALLBACK', 'STARTING_EXTERNAL'):
            (self.engine / 'backend-handoff.json').write_text(json.dumps({'state': state, 'history': []}))
            self.sup.paused = False
            self.attach()
            self.assertEqual(self.handoff.journal['state'], 'HANDOFF_FAILED', state)
            self.assertIn('worker restarted during ' + state, self.handoff.journal['failure'])
            for _ in range(10):
                self.sup.tick()
            self.assertIsNone(self.sup.child)
        # A survivor's owner record blocks return: it is never adopted or signalled.
        self.sup.owner.write_text('/unknown/instance\n')
        self.refused(self.ask('external'), 'OWNER_PRESENT')
        self.sup.owner.unlink()
        (self.engine / 'backend-handoff.json').write_text('{not json')
        self.attach()
        self.assertEqual(self.handoff.journal['state'], 'HANDOFF_FAILED')

    def test_quiesce_timeout_aborts_and_leaves_external_running(self):
        child = self.start_external()
        self.assertTrue(self.ask('fallback')['ok'])
        self.sup.worker_idle = lambda: False  # a job sneaks in after acceptance: drain cannot complete
        self.handoff.deadline = self.handoff.clock() + .5
        self.until(lambda: self.handoff.journal['state'] == 'RUNNING_EXTERNAL')
        self.assertIs(self.sup.child, child)
        self.assertIsNone(child.poll())
        self.assertIn('QUIESCE_TIMEOUT', self.handoff.journal['last_refusal']['codes'][0])

    # ============================== Correction 1: drain-sealed fallback return (A-G)
    def test_C1_A_return_from_verified_idle_fallback_drains_then_stops(self):
        fallback = self.enter_fallback()
        self.assertTrue(self.ask('external')['ok'])
        saw_drain = []
        self.until(lambda: saw_drain.append((self.sup.instance / 'drain').exists() if self.sup.instance else False)
                   or self.handoff.journal['state'] == 'RUNNING_EXTERNAL')
        self.assertTrue(any(saw_drain), 'the owner fenced admission before stopping')
        self.assertIsNotNone(fallback.poll())
        self.assertEqual(fallback.returncode, -signal.SIGTERM)

    def test_C1_B_job_admitted_before_the_fence_is_protected(self):
        fallback = self.enter_fallback()
        self.handoff.stop_timeout = 1.5
        self.assertTrue(self.ask('external')['ok'])
        self.assertEqual(self.http_post('/api/jobs'), 202)  # admitted before the drain fence exists
        self.until(lambda: self.handoff.journal['state'] == 'RUNNING_FALLBACK', seconds=10)
        self.assertIn('QUIESCE_TIMEOUT', self.handoff.journal['last_refusal']['codes'][0])
        self.assert_fallback_kept(fallback)
        self.assertFalse((self.sup.instance / 'drain').exists(), 'admission reopened for the protected job')
        # Once the job finishes, an explicit retry drains and returns normally.
        (self.fx / 'fb-busy').unlink()
        self.assertTrue(self.ask('external')['ok'])
        self.until(lambda: self.handoff.journal['state'] == 'RUNNING_EXTERNAL')

    def test_C1_C_job_arriving_after_the_fence_is_refused(self):
        fallback = self.enter_fallback()
        self.assertTrue(self.ask('external')['ok'])
        self.until(lambda: (self.sup.instance / 'drain').exists())
        self.assertEqual(self.http_post('/api/jobs'), 503)
        self.assertIn('POST /api/jobs', (self.fx / 'refused-after-fence').read_text())
        self.assertFalse((self.fx / 'fb-busy').exists())
        self.until(lambda: self.handoff.journal['state'] == 'RUNNING_EXTERNAL')
        self.assertIsNotNone(fallback.poll())

    def test_C1_D_active_job_or_lease_prevents_termination(self):
        fallback = self.enter_fallback()
        for name, code in (('fb-busy', 'ACTIVE_JOB'), ('fb-lease', 'LEASE')):
            (self.fx / name).touch()
            self.refused(self.ask('external'), code)
            self.assert_fallback_kept(fallback)
            (self.fx / name).unlink()
        # Worker-side work admitted after acceptance also blocks the stop.
        self.handoff.stop_timeout = 1.5
        self.assertTrue(self.ask('external')['ok'])
        self.sup.worker_idle = lambda: False
        self.until(lambda: self.handoff.journal['state'] == 'RUNNING_FALLBACK', seconds=10)
        self.assert_fallback_kept(fallback)

    def test_C1_E_missing_stale_forged_or_unrequested_seal_never_authorizes(self):
        fallback = self.enter_fallback()
        self.handoff.stop_timeout = 1.5
        for switch in ('fb-noseal', 'fb-stale', 'fb-forge', 'fb-predrained'):
            (self.fx / switch).touch()
            if switch == 'fb-stale':
                (self.sup.instance / 'idle').write_text(f'{fallback.pid} idle\n')
                old = time.time() - 30
                os.utime(self.sup.instance / 'idle', (old, old))
            self.assertTrue(self.ask('external')['ok'], switch)
            self.until(lambda: self.handoff.journal['state'] == 'RUNNING_FALLBACK', seconds=10)
            self.assertIn('QUIESCE_TIMEOUT', self.handoff.journal['last_refusal']['codes'][0], switch)
            self.assert_fallback_kept(fallback)
            (self.fx / switch).unlink()
            self.until(lambda: self.sup._seal('idle'))  # healthy seal restored before the next case

    def test_C1_F_failed_drain_times_out_without_killing_active_work(self):
        fallback = self.enter_fallback()
        self.handoff.stop_timeout = 2
        self.assertTrue(self.ask('external')['ok'])
        self.until(lambda: (self.sup.instance / 'drain').exists())
        (self.fx / 'fb-busy').touch()  # work became active after the fence: never drained
        self.until(lambda: self.handoff.journal['state'] == 'RUNNING_FALLBACK', seconds=10)
        self.assert_fallback_kept(fallback)
        self.assertNotIn('FALLBACK_RELEASED', self.states())

    def test_C1_G_foreign_listener_or_surviving_group_is_never_adopted(self):
        fallback = self.enter_fallback()
        self.assertTrue(self.ask('external')['ok'])
        self.listener_extra = [999999]  # appears after acceptance: checked again right before the signal
        self.until(lambda: self.handoff.journal['state'] == 'RUNNING_FALLBACK', seconds=10)
        self.assertIn('RELEASE_REFUSED: FOREIGN_LISTENER', self.handoff.journal['last_refusal']['codes'][0])
        self.assert_fallback_kept(fallback)

    def test_C1_G_surviving_process_group_keeps_owner_record(self):
        (self.fx / 'fb-orphan').touch()
        fallback = self.enter_fallback()
        orphan = int((self.fx / 'orphan-pid').read_text())
        self.assertTrue(self.ask('external')['ok'])
        self.until(lambda: self.handoff.journal['state'] == 'HANDOFF_FAILED', seconds=15)
        self.assertIn('process group survives', self.handoff.journal['failure'])
        self.assertTrue(self.sup.owner.exists(), 'owner record kept as evidence')
        os.kill(orphan, 0)  # the surviving member was not killed or adopted
        for _ in range(10):
            self.sup.tick()
        self.assertIs(self.sup.child, fallback)
        self.refused(self.ask('external'), 'OWNER_PRESENT')
        self.assertNotIn('STARTING_EXTERNAL', self.states())

    # ============================ Correction 2: external startup deadline (A-G)
    def return_to_external(self, switch, boot_timeout=1.5):
        (self.engine / 'backend-handoff.json').write_text(json.dumps({'state': 'HANDOFF_FAILED', 'history': []}))
        self.attach()
        self.handoff.boot_timeout = boot_timeout
        if switch:
            (self.fx / switch).touch()
        self.assertTrue(self.ask('external')['ok'])

    def test_C2_A_alive_but_unhealthy_child_times_out(self):
        self.return_to_external('ext-unhealthy')
        self.until(lambda: self.handoff.journal['state'] == 'HANDOFF_FAILED', seconds=10)
        self.assertIn('START_TIMEOUT', self.handoff.journal['failure'])
        self.assertIn('EXTERNAL_IDENTITY', self.handoff.journal['failure'])
        self.assertIsNone(self.sup.child.poll())

    def test_C2_B_child_that_never_seals_times_out_and_is_kept_as_evidence(self):
        self.return_to_external('ext-noseal')
        self.until(lambda: self.handoff.journal['state'] == 'HANDOFF_FAILED', seconds=10)
        child = self.sup.child
        failure = self.handoff.journal['failure']
        self.assertIn('START_TIMEOUT', failure)
        self.assertIn('EXTERNAL_SEAL', failure)
        self.assertEqual(self.handoff.journal['evidence']['pid'], child.pid)  # F: actual identity recorded
        # E/F: no restart loop, no signal: same child, alive, owner record kept, supervisor paused.
        for _ in range(30):
            self.sup.tick()
        self.assertIs(self.sup.child, child)
        self.assertIsNone(child.poll())
        self.assertTrue(self.sup.owner.exists())
        self.assertTrue(self.sup.paused)
        # Recoverable: once the owned child proves ready, an explicit re-checked return resumes it.
        self.refused(self.ask('external'), 'EXTERNAL_SEAL')
        (self.fx / 'ext-noseal').unlink()
        self.until(lambda: self.sup._seal('idle'))
        self.assertTrue(self.ask('external')['ok'])
        self.assertEqual(self.handoff.journal['state'], 'RUNNING_EXTERNAL')
        self.assertIs(self.sup.child, child)

    def test_C2_C_child_exiting_before_readiness_fails_without_restart(self):
        self.return_to_external('ext-exit', boot_timeout=8)
        self.until(lambda: self.handoff.journal['state'] == 'HANDOFF_FAILED', seconds=10)
        self.assertIn('external exited before readiness rc=4', self.handoff.journal['failure'])
        spawned = []
        original = self.sup._spawn
        self.sup._spawn = lambda: spawned.append(1) or original()
        for _ in range(30):
            self.sup.tick()
        self.assertEqual(spawned, [])  # E: no uncontrolled restart loop
        self.assertIsNone(self.sup.child)

    def test_C2_D_healthy_child_completes_before_the_deadline(self):
        self.return_to_external(None, boot_timeout=8)
        self.until(lambda: self.handoff.journal['state'] == 'RUNNING_EXTERNAL')
        self.assertIsNone(self.sup.child.poll())

    def test_C2_E_deadline_is_enforced_with_a_deterministic_clock(self):
        now = [1000.0]
        self.sup.clock = lambda: now[0]
        self.return_to_external('ext-noseal', boot_timeout=60)
        self.handoff.clock = self.sup.clock
        self.handoff.deadline = now[0] + 60
        self.until(lambda: self.sup.child is not None)
        for _ in range(5):
            self.sup.tick()
        self.assertEqual(self.handoff.journal['state'], 'STARTING_EXTERNAL')  # before the deadline: still waiting
        now[0] += 61
        self.sup.tick()
        self.assertEqual(self.handoff.journal['state'], 'HANDOFF_FAILED')
        self.assertIn('START_TIMEOUT', self.handoff.journal['failure'])

    def test_C2_G_worker_restart_during_startup_never_adopts_the_survivor(self):
        self.return_to_external('ext-noseal', boot_timeout=60)
        self.until(lambda: self.sup.child is not None)
        survivor = self.sup.child
        self.groups.append(survivor)
        # A new worker: fresh Supervisor (no child handle) over the same root and journal.
        self.sup = module.Supervisor(self.engine, sys.executable, list(self.sup.command), dict(self.sup.env),
                                     self.port, lambda: True, self.lock.fileno())
        self.attach()
        self.assertEqual(self.handoff.journal['state'], 'HANDOFF_FAILED')
        self.assertIn('worker restarted during STARTING_EXTERNAL', self.handoff.journal['failure'])
        for _ in range(10):
            self.sup.tick()
        self.assertIsNone(self.sup.child)
        self.assertIsNone(survivor.poll())
        self.refused(self.ask('external'), 'OWNER_PRESENT')

    # ===================== Correction 3: fallback validated before production stops (A-J)
    def refused_before_stop(self, code):
        child = self.sup.child
        before = self.snapshot()
        self.refused(self.ask('fallback'), code)
        self.assert_untouched(child)  # H: the external backend keeps running
        self.assertEqual(self.snapshot(), before)  # J

    def test_C3_A_unsafe_root_permissions_refuse_before_stop(self):
        self.start_external()
        Path(self.config['fallback_root']).mkdir(mode=0o755)
        os.chmod(self.config['fallback_root'], 0o755)
        self.refused_before_stop('FALLBACK_ROOT')
        # The private root is the access boundary: an owned 0755 subdirectory inside it
        # (the real Big Mac layout) is acceptable; a foreign-owned one is not checked here.
        os.chmod(self.config['fallback_root'], 0o700)
        (Path(self.config['fallback_root']) / 'runs').mkdir(mode=0o755)
        os.chmod(Path(self.config['fallback_root']) / 'runs', 0o755)
        self.assertEqual(self.handoff.checks.fallback_ready(create=True), [])

    def test_C3_B_wrong_device_refuses_before_stop(self):
        self.start_external()
        self.config['home'] = '/dev'  # a different filesystem than the private root
        self.refused_before_stop('FALLBACK_DEVICE')

    def test_C3_C_symlinked_root_subdirectory_or_ancestor_refuses(self):
        self.start_external()
        elsewhere = self.root / 'elsewhere'
        elsewhere.mkdir(mode=0o700)
        root = Path(self.config['fallback_root'])
        root.symlink_to(elsewhere)
        self.refused_before_stop('FALLBACK_ROOT')
        root.unlink()
        root.mkdir(mode=0o700)
        (root / 'runs').symlink_to(elsewhere)
        self.refused_before_stop('FALLBACK_ROOT')
        (root / 'runs').unlink()
        link = self.root / 'linked-parent'
        link.symlink_to(self.root)
        self.config['fallback_root'] = str(link / 'fallback-root')
        self.refused_before_stop('FALLBACK_ROOT')
        self.assertEqual(list(elsewhere.iterdir()), [])

    def test_C3_D_inaccessible_log_destination_refuses(self):
        self.start_external()
        logs = Path(self.config['package']) / 'logs'
        logs.rmdir()
        logs.write_text('not a directory')
        self.refused_before_stop('FALLBACK_LOG')

    def test_C3_E_missing_dependency_refuses(self):
        self.start_external()
        (Path(self.config['fallback_cwd']) / 'node_modules/three/package.json').unlink()
        self.refused_before_stop('FALLBACK_PACKAGE')

    def test_C3_F_modified_server_js_refuses(self):
        self.start_external()
        with open(Path(self.config['fallback_cwd']) / 'server.js', 'a') as handle:
            handle.write('# tampered\n')
        self.refused_before_stop('FALLBACK_SOURCE')

    def test_C3_G_modified_or_undrainable_manifest_refuses(self):
        self.start_external()
        with open(self.manifest, 'a') as handle:
            handle.write('%s  operator-console/extra.js\n' % ('0' * 64))
        self.refused_before_stop('FALLBACK_SOURCE')
        # A manifest that is itself trusted but does not cover the drain protocol (the v1 shape).
        self.config['source_manifest_sha256'] = write_manifest(
            self.manifest, Path(self.config['package']) / 'source', ['operator-console/server.js', 'operator-console/package.json'])
        self.refused_before_stop('FALLBACK_DRAIN')

    def test_C3_disk_shortfall_refuses_and_mutation_before_release_aborts(self):
        child = self.start_external()
        self.config['fallback_min_free_bytes'] = 1 << 62
        self.refused_before_stop('FALLBACK_DISK')
        self.config['fallback_min_free_bytes'] = 1 << 20
        # H: a prerequisite that changes after acceptance is caught right before the signal.
        self.assertTrue(self.ask('fallback')['ok'])
        with open(Path(self.config['fallback_cwd']) / 'server.js', 'a') as handle:
            handle.write('# changed during the drain\n')
        self.until(lambda: self.handoff.journal['state'] == 'RUNNING_EXTERNAL')
        self.assertIn('RELEASE_REFUSED: FALLBACK_SOURCE', self.handoff.journal['last_refusal']['codes'][0])
        self.assertIs(self.sup.child, child)
        self.assertIsNone(child.poll())
        self.until(lambda: self.sup.state == 'IDLE')
        self.assertFalse((self.sup.instance / 'drain').exists())

    # ================================================ O: authorization surface
    def test_O_fixtures_and_request_fields_cannot_authorize_or_redirect(self):
        child = self.start_external()
        for bad in ({'facts': {}}, {'config': {}}, {'force': True}):
            self.assertTrue(self.ask('fallback', **bad)['refused'][0].startswith('REQUEST_INVALID'))
        self.assertTrue(self.handoff.request({'op': 'backend-handoff', 'target': 'fallback', 'expect_revision': self.rev,
                                              'reason': 'short'})['refused'][0].startswith('REQUEST_INVALID'))
        self.assert_untouched(child)
        env = {k: v for k, v in os.environ.items()}
        try:
            os.environ.update(DEX_RELEASE_GATE_FIXTURE_FACTS='/tmp/x', DEX_DATA_ROOT='/tmp/y', DEX_MACBOOK_IMAGES_URL='http://x',
                              OPERATOR_CONSOLE_PORT='1')
            config = module.production_handoff_config(Path('/Users/bigmac/Image_Gen-wc2tb-20261120'),
                                                      Path('/runtime/node'), Path('/Users/bigmac/.dexdiffusion-engine'))
        finally:
            os.environ.clear()
            os.environ.update(env)
        self.assertEqual((config['base'], config['port']), ('http://127.0.0.1:31337', 31337))
        self.assertEqual(config['fallback_env']['DEX_DATA_ROOT'], '/Users/bigmac/DexDiffusion-InternalFallback')
        self.assertFalse([k for k in config['fallback_env'] if 'MACBOOK' in k])
        self.assertEqual(config['package_commit'], '3f0abf5d0bd9c1d3777a9abbf46181ce2e040350')
        manifest = Path(__file__).resolve().parents[2] / 'rollback-packages/wc2tb-emergency-internal-fallback-rollback-v2/SOURCE-SHA256SUMS'
        self.assertEqual(sha(manifest), config['source_manifest_sha256'], 'pinned digest matches the versioned manifest')
        self.assertTrue(config['source_manifest'].endswith('rollback-packages/wc2tb-emergency-internal-fallback-rollback-v2/SOURCE-SHA256SUMS'))
        source = Path(__file__).with_name('backend-supervisor.py').read_text()
        handoff = source[source.index('def _private_dir'):source.index('def configured_supervisor')]
        self.assertNotIn('os.environ', handoff)
        self.assertIn("if supervisor.mode == 'production':\n        attach_handoff(supervisor, production_handoff_config(", source)
        # The rehearsal-only pause restriction is unchanged.
        worker = Path(__file__).with_name('engine-worker.py').read_text()
        self.assertIn("raise ValueError('pause is only available for the rehearsal backend')", worker)
        # attach_handoff creates nothing on disk.
        log_dir = Path(self.config['package']) / 'logs'
        log_dir.rmdir()
        self.attach()
        self.assertFalse(log_dir.exists())

    def test_fallback_environment_with_macbook_destination_is_refused(self):
        child = self.start_external()
        self.config['fallback_env']['DEX_MACBOOK_IMAGES_URL'] = 'http://127.0.0.1:1/'
        self.refused(self.ask('fallback'), 'MACBOOK_CONTACT')
        self.config['fallback_env'].pop('DEX_MACBOOK_IMAGES_URL')
        self.config['publication_isolated_commits'] = ('d' * 40,)
        self.refused(self.ask('fallback'), 'MACBOOK_CONTACT')
        self.assert_untouched(child)


if __name__ == '__main__':
    unittest.main()
