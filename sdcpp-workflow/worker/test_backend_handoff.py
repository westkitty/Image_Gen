"""Isolated tests for the owner-authorized production <-> internal-fallback handoff.

Real child processes on test ports, real lsof listener identity, a real git
worktree, a private package and private roots. Never touches 31337, the
production worker, EngineHost, WC2TB or the MacBook. Letters map to
docs/WC2TB_RECOVERY_RUNBOOK.md ("Which tests prove source behavior").
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
import subprocess
import sys
import tempfile
import threading
import time
import unittest

spec = importlib.util.spec_from_file_location('backend_supervisor', Path(__file__).with_name('backend-supervisor.py'))
module = importlib.util.module_from_spec(spec)
spec.loader.exec_module(module)

EXTERNAL = r'''
import http.server, json, os, pathlib, sys, threading, time
root = pathlib.Path(os.environ['DEX_BACKEND_CONTROL']); fx = pathlib.Path(os.environ['FIXTURE'])
def body(path):
    if path == '/api/version':
        return {'pid': os.getpid(), 'cwd': os.environ['EXTERNAL_CWD'], 'storage': {'mode': 'external'}}
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
server = http.server.ThreadingHTTPServer(('127.0.0.1', int(os.environ['PORT'])), H)
def seal():
    while True:
        state = 'drained' if (root / 'drain').exists() else 'idle'
        (root / 'idle.t').write_text(f'{os.getpid()} {state}\n'); (root / 'idle.t').replace(root / 'idle')
        time.sleep(.04)
threading.Thread(target=seal, daemon=True).start()
server.serve_forever()
'''

FALLBACK = r'''
import http.server, json, os, pathlib, sys, urllib.request
fx = pathlib.Path(os.environ['DEX_DATA_ROOT']).parent / 'fixture'
(fx / 'fallback-env.json').write_text(json.dumps(sorted(os.environ)))
print('fallback booting pid=%d' % os.getpid(), flush=True)
if (fx / 'fail-boot').exists():
    print('FATAL: simulated boot failure', flush=True); sys.exit(3)
for key, value in os.environ.items():
    if 'MACBOOK' in key:
        urllib.request.urlopen(value, timeout=1)  # what an unisolated build would do
def body(path):
    return {'/api/version': {'pid': os.getpid(), 'cwd': os.getcwd(), 'storage': {'mode': os.environ.get('DEX_STORAGE_MODE')}},
            '/api/jobs': {'jobs': []}, '/api/resources': {'owner': None, 'waiting': [], 'quarantine': None},
            '/api/publications/status': {'enabled': (fx / 'publication-on').exists(), 'pending': 0},
            '/api/capabilities': {'modelTargets': [{'id': x} for x in ('sdxl-photonic', 'flux-fp8', 'flux2-klein-4b')]},
            '/dexdiffusion/': {}}.get(path)
class H(http.server.BaseHTTPRequestHandler):
    def log_message(self, *a): pass
    def do_GET(self):
        data = json.dumps(body(self.path)).encode()
        self.send_response(200); self.send_header('Content-Length', str(len(data))); self.end_headers(); self.wfile.write(data)
http.server.ThreadingHTTPServer(('127.0.0.1', int(os.environ['OPERATOR_CONSOLE_PORT'])), H).serve_forever()
'''


def sha(path):
    return hashlib.sha256(Path(path).read_bytes()).hexdigest()


def free_port():
    with socket.socket() as sock:
        sock.bind(('127.0.0.1', 0))
        return sock.getsockname()[1]


class Canary(http.server.BaseHTTPRequestHandler):
    hits = []

    def log_message(self, *a):
        pass

    def do_GET(self):
        Canary.hits.append(self.path)
        self.send_response(200)
        self.end_headers()


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
        (cwd / 'public/dexdiffusion/edit-ui.js').write_text('ui\n')
        for dep in ('express', 'three', '@sparkjsdev/spark'):
            (cwd / 'node_modules' / dep).mkdir(parents=True)
            (cwd / 'node_modules' / dep / 'package.json').write_text('{}')
        (package / 'SOURCE_COMMIT').write_text('c' * 40 + '\n')
        (package / 'start-fallback-rollback.sh').write_text('#!/bin/bash\n')
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
            'required_deps': ('express', 'three', '@sparkjsdev/spark'), 'fallback_cwd': str(cwd),
            'fallback_env': {'HOME': str(t), 'PATH': '/usr/bin:/bin', 'DEX_DATA_ROOT': str(t / 'fallback-root'),
                             'DEX_STORAGE_MODE': 'internal-fallback', 'OPERATOR_CONSOLE_PORT': str(self.port)},
            'fallback_root': str(t / 'fallback-root'), 'fallback_log': str(package / 'logs/owner-handoff-test.log'),
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

    def attach(self):
        handoff = module.attach_handoff(self.sup, self.config, 'isolated-test', quiesce_timeout=5, boot_timeout=8, stop_timeout=8)
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
        child = self.sup.child
        if child and child.poll() is None:
            os.killpg(child.pid, signal.SIGKILL)
            child.wait(4)
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

    def states(self):
        return [h['state'] for h in json.loads((self.engine / 'backend-handoff.json').read_text())['history']]

    def assert_untouched(self, child):
        self.assertIs(self.sup.child, child)
        self.assertIsNone(child.poll())
        self.assertEqual(self.handoff.journal['state'], 'RUNNING_EXTERNAL')
        self.assertEqual(module.lsof_listeners(self.port), [child.pid])

    def snapshot(self):
        return {p.name: sha(p) for p in sorted(self.images.iterdir())}, (self.receipts / 'r1.json').read_text()

    # A, L, M, N -------------------------------------------------------------
    def test_A_L_M_N_full_owner_handoff_and_return(self):
        before = self.snapshot()
        server = http.server.ThreadingHTTPServer(('127.0.0.1', 0), Canary)
        threading.Thread(target=server.serve_forever, daemon=True).start()
        canary = f'http://127.0.0.1:{server.server_address[1]}/manifest'
        self.sup.env['DEX_MACBOOK_IMAGES_URL'] = canary
        self.handoff.profiles['external']['env']['DEX_MACBOOK_IMAGES_URL'] = canary
        Canary.hits = []
        old = self.start_external()
        reply = self.ask('fallback')
        self.assertTrue(reply['ok'], reply)
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
        # N: owner-controlled return to external supervision.
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

    # B C D -------------------------------------------------------------------
    def test_B_C_D_active_job_lease_or_pending_publication_refuse(self):
        child = self.start_external()
        for name, code in (('active-job', 'ACTIVE_JOB'), ('lease', 'LEASE'), ('pending', 'PUBLICATION_PENDING')):
            (self.fx / name).touch()
            reply = self.ask('fallback')
            self.assertFalse(reply['ok'])
            self.assertTrue(any(r.startswith(code) for r in reply['refused']), reply)
            self.assert_untouched(child)
            (self.fx / name).unlink()
        self.sup.worker_idle = lambda: False
        self.assertTrue(any(r.startswith('ACTIVE_JOB') for r in self.ask('fallback')['refused']))
        self.assert_untouched(child)

    # E -----------------------------------------------------------------------
    def test_E_foreign_listener_refuses_and_is_never_signalled(self):
        child = self.start_external()
        self.listener_extra = [999999]
        self.assertTrue(any(r.startswith('FOREIGN_LISTENER') for r in self.ask('fallback')['refused']))
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

    # F G H -------------------------------------------------------------------
    def test_F_G_H_package_node_and_identity_refuse(self):
        child = self.start_external()
        starter = Path(self.config['package']) / 'start-fallback-rollback.sh'
        starter.unlink()
        self.assertTrue(any(r.startswith('FALLBACK_PACKAGE') for r in self.ask('fallback')['refused']))
        starter.write_text('#!/bin/bash\n')
        dep = Path(self.config['fallback_cwd']) / 'node_modules/three/package.json'
        dep.unlink()
        self.assertTrue(any('three' in r for r in self.ask('fallback')['refused']))
        dep.write_text('{}')
        Path(self.config['node_path']).write_text('drifted node\n')
        self.assertTrue(any(r.startswith('NODE_HASH') for r in self.ask('fallback')['refused']))
        Path(self.config['node_path']).write_text('pinned node\n')
        self.worker_expected = lambda: '0' * 64
        self.assertTrue(any(r.startswith('IDENTITY_WORKER') for r in self.ask('fallback')['refused']))
        self.worker_expected = lambda: sha(self.engine / 'engine-worker.py')
        self.parent = '/usr/bin/some-other-parent'
        self.assertTrue(any(r.startswith('IDENTITY_ENGINEHOST') for r in self.ask('fallback')['refused']))
        self.parent = self.config['enginehost_path']
        self.assertTrue(any(r.startswith('SOURCE_REVISION') for r in
                            self.handoff.request({'op': 'backend-handoff', 'target': 'fallback', 'expect_revision': 'f' * 40,
                                                  'reason': 'wrong revision must be refused'})['refused']))
        self.assert_untouched(child)
        self.assertTrue(self.ask('fallback')['ok'])  # all facts restored: accepted

    # I -----------------------------------------------------------------------
    def test_I_concurrent_operations_are_serialized(self):
        child = self.start_external()
        holder = subprocess.Popen([sys.executable, '-c', 'import fcntl,sys,time;f=open(sys.argv[1],"a");'
                                   'fcntl.flock(f,fcntl.LOCK_EX);print("held",flush=True);time.sleep(30)',
                                   self.config['recovery_locks'][0]], stdout=subprocess.PIPE, text=True)
        try:
            self.assertEqual(holder.stdout.readline().strip(), 'held')
            self.assertTrue(any(r.startswith('CONCURRENT') for r in self.ask('fallback')['refused']))
            self.assert_untouched(child)
        finally:
            holder.kill()
            holder.wait()
        self.assertTrue(self.ask('fallback')['ok'])
        second = self.ask('fallback')
        self.assertFalse(second['ok'])
        self.assertTrue(second['refused'][0].startswith('STATE'))
        self.assertTrue(any(r.startswith('STATE') for r in self.ask('external')['refused']))
        # The owner holds the recovery lock for the whole transition.
        with open(self.config['recovery_locks'][0], 'a') as handle:
            with self.assertRaises(OSError):
                fcntl.flock(handle, fcntl.LOCK_EX | fcntl.LOCK_NB)
        self.until(lambda: self.handoff.journal['state'] == 'RUNNING_FALLBACK')
        with open(self.config['recovery_locks'][0], 'a') as handle:
            fcntl.flock(handle, fcntl.LOCK_EX | fcntl.LOCK_NB)

    # J -----------------------------------------------------------------------
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

    def test_J_unverified_fallback_is_stopped_by_its_owner(self):
        self.start_external()
        (self.fx / 'publication-on').touch()
        self.assertTrue(self.ask('fallback')['ok'])
        self.until(lambda: self.handoff.journal['state'] == 'HANDOFF_FAILED', seconds=20)
        self.assertIn('FALLBACK_PUBLICATION', self.handoff.journal['failure'])
        self.assertIsNone(self.sup.child)
        self.assertEqual(module.lsof_listeners(self.port), [])

    # K -----------------------------------------------------------------------
    def test_K_worker_crash_mid_transition_is_reconciled_without_adoption(self):
        for state in ('QUIESCING', 'STARTING_FALLBACK', 'RUNNING_FALLBACK', 'STARTING_EXTERNAL'):
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
        self.assertTrue(any(r.startswith('OWNER_PRESENT') for r in self.ask('external')['refused']))
        self.sup.owner.unlink()
        (self.engine / 'backend-handoff.json').write_text('{not json')
        self.attach()
        self.assertEqual(self.handoff.journal['state'], 'HANDOFF_FAILED')

    def test_quiesce_timeout_aborts_and_leaves_external_running(self):
        child = self.start_external()
        self.sup.worker_idle = lambda: True
        self.assertTrue(self.ask('fallback')['ok'])
        self.sup.worker_idle = lambda: False  # a job sneaks in after acceptance: drain cannot complete
        self.handoff.deadline = self.handoff.clock() + .5
        self.until(lambda: self.handoff.journal['state'] == 'RUNNING_EXTERNAL')
        self.assertIs(self.sup.child, child)
        self.assertIsNone(child.poll())
        self.assertIn('QUIESCE_TIMEOUT', self.handoff.journal['last_refusal']['codes'][0])

    # O -----------------------------------------------------------------------
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
        self.assertEqual(config['package_commit'], 'c7708e4a40edff156cbaaccda7f6299088c0f306')
        source = Path(__file__).with_name('backend-supervisor.py').read_text()
        handoff = source[source.index('class HandoffChecks'):source.index('def configured_supervisor')]
        self.assertNotIn('os.environ', handoff)
        self.assertIn("if supervisor.mode == 'production':\n        attach_handoff(supervisor, production_handoff_config(", source)
        # The rehearsal-only pause restriction is unchanged.
        worker = Path(__file__).with_name('engine-worker.py').read_text()
        self.assertIn("raise ValueError('pause is only available for the rehearsal backend')", worker)

    def test_fallback_environment_with_macbook_destination_is_refused(self):
        child = self.start_external()
        self.config['fallback_env']['DEX_MACBOOK_IMAGES_URL'] = 'http://127.0.0.1:1/'
        self.assertTrue(any(r.startswith('MACBOOK_CONTACT') for r in self.ask('fallback')['refused']))
        self.config['fallback_env'].pop('DEX_MACBOOK_IMAGES_URL')
        self.config['publication_isolated_commits'] = ('d' * 40,)
        self.assertTrue(any(r.startswith('MACBOOK_CONTACT') for r in self.ask('fallback')['refused']))
        self.assert_untouched(child)


if __name__ == '__main__':
    unittest.main()
