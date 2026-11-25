import importlib.util
import os
from pathlib import Path
import shutil
import signal
import socket
import sys
import tempfile
import time
import unittest
import urllib.request

spec = importlib.util.spec_from_file_location('backend_supervisor', Path(__file__).with_name('backend-supervisor.py'))
module = importlib.util.module_from_spec(spec)
spec.loader.exec_module(module)

CHILD = '''
import os, pathlib, socket, subprocess, sys, time
root = pathlib.Path(os.environ['DEX_BACKEND_CONTROL'])
fixture = pathlib.Path(os.environ['FIXTURE'])
port = int(os.environ['PORT'])
listener = socket.socket()
listener.setsockopt(socket.SOL_SOCKET, socket.SO_REUSEADDR, 1)
listener.bind(('127.0.0.1', port))
listener.listen()
if (fixture / 'with-child').exists():
    import signal
    child = subprocess.Popen([sys.executable, '-c', 'import time; time.sleep(60)'])
    (fixture / 'child-pid').write_text(str(child.pid))
    def stop_group(*_):
        child.wait(3)
        sys.exit(0)
    signal.signal(signal.SIGTERM, stop_group)
while True:
    result = root / 'idle'
    if (fixture / 'busy').exists():
        result.unlink(missing_ok=True)
    else:
        state = 'drained' if (root / 'drain').exists() else 'idle'
        pending = root / 'idle.test'
        pending.write_text(f'{os.getpid()} {state}\\n')
        pending.replace(result)
    time.sleep(.04)
'''


class SupervisorTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.root = Path(self.temp.name)
        self.lock = (self.root / 'lock').open('w')
        self.exe = self.root / 'node'
        self.exe.symlink_to(sys.executable)
        self.busy = False
        self.now = 10
        with socket.socket() as sock:
            sock.bind(('127.0.0.1', 0))
            self.port = sock.getsockname()[1]
        self.supervisor = module.Supervisor(self.root, self.exe, [str(self.exe), '-c', CHILD],
                                            {'PORT': str(self.port), 'FIXTURE': str(self.root)},
                                            self.port, lambda: not self.busy, self.lock.fileno(),
                                            clock=lambda: self.now)

    def tearDown(self):
        child = self.supervisor.child
        if child and child.poll() is None:
            os.killpg(child.pid, signal.SIGKILL)
            child.wait(4)
        self.lock.close()
        self.temp.cleanup()

    def until(self, predicate):
        deadline = time.monotonic() + 6
        while time.monotonic() < deadline:
            self.supervisor.tick()
            if predicate():
                return
            time.sleep(.025)
        self.fail(self.supervisor.status())

    def start(self):
        self.until(lambda: self.supervisor.state == 'IDLE')
        return self.supervisor.child

    def test_one_owned_session_and_graceful_restart(self):
        old = self.start()
        self.assertEqual(os.getpgid(old.pid), old.pid)
        self.assertEqual(os.getsid(old.pid), old.pid)
        self.supervisor.request_restart()
        self.until(lambda: self.supervisor.child is None)
        self.assertIsNotNone(old.poll())
        self.assertFalse(module.group_exists(old.pid))
        self.now += 2
        self.assertNotEqual(self.start().pid, old.pid)

    def test_restart_terminates_owned_child_process_group(self):
        (self.root / 'with-child').touch()
        old = self.start()
        worker = int((self.root / 'child-pid').read_text())
        self.assertEqual(os.getpgid(worker), old.pid)
        self.supervisor.request_restart()
        self.until(lambda: self.supervisor.child is None)
        with self.assertRaises(ProcessLookupError):
            os.kill(worker, 0)

    def test_busy_worker_and_backend_prevent_restart(self):
        old = self.start()
        busy_file = self.root / 'busy'
        busy_file.touch()
        self.until(lambda: not self.supervisor._seal('idle'))
        self.supervisor.request_restart()
        self.busy = True
        busy_file.unlink()
        self.until(lambda: self.supervisor._seal('idle'))
        self.assertIsNone(old.poll())
        self.assertFalse((self.supervisor.instance / 'drain').exists())
        self.busy = False
        self.until(lambda: self.supervisor.child is None)

    def test_clean_crash_backoff_and_circuit(self):
        for count in range(4):
            old = self.start()
            old.kill()
            old.wait(4)
            self.supervisor.tick()
            self.assertEqual(len(self.supervisor.failures), count + 1)
            self.assertIsNone(self.supervisor.child)
            self.supervisor.tick()
            self.assertIsNone(self.supervisor.child)
            self.now += 100
        self.assertEqual(self.supervisor.state, 'CIRCUIT_OPEN')

    def test_unsealed_crash_preserves_owner_and_refuses_restart(self):
        old = self.start()
        (self.root / 'busy').touch()
        self.until(lambda: not self.supervisor._seal('idle'))
        old.kill()
        old.wait(4)
        self.supervisor.tick()
        self.assertEqual(self.supervisor.state, 'RECOVERY_BLOCKED')
        self.assertTrue(self.supervisor.owner.exists())
        self.assertFalse(self.supervisor.request_restart())

    def test_stale_executable_is_detected_and_drained(self):
        old = self.start()
        copy = self.root / 'replacement'
        shutil.copyfile(sys.executable, copy)
        copy.chmod(0o700)
        copy.replace(self.exe)
        self.supervisor.tick()
        self.assertEqual(self.supervisor.state, 'STALE_EXECUTABLE')
        self.until(lambda: self.supervisor.child is None)
        self.assertIsNotNone(old.poll())

    def test_foreign_listener_is_left_alone(self):
        with socket.socket() as foreign:
            foreign.bind(('127.0.0.1', self.port))
            foreign.listen()
            self.supervisor.tick()
            self.assertEqual(self.supervisor.state, 'PORT_HELD')
            self.assertIsNone(self.supervisor.child)
            self.assertEqual(foreign.getsockname()[1], self.port)
        self.start()

    @unittest.skipUnless(shutil.which('node'), 'Node is required for the cross-language fixture')
    def test_node_control_protocol_and_http_drain(self):
        source = Path(__file__).parents[2] / 'operator-console/backend-quiescence.js'
        busy = self.root / 'busy'
        javascript = """
const http = require('node:http');
const fs = require('node:fs');
const { backendQuiescence } = require(process.env.QUIESCENCE);
const gate = backendQuiescence(process.env.DEX_BACKEND_CONTROL, () => !fs.existsSync(process.env.BUSY));
const app = http.createServer((req, res) => {
  res.status = code => { res.statusCode = code; return res; };
  res.json = value => res.end(JSON.stringify(value));
  gate.middleware(req, res, () => res.end('ready'));
});
app.listen(Number(process.env.PORT), '127.0.0.1', () => setInterval(gate.checkpoint, 30));
"""
        exe = shutil.which('node')
        self.supervisor.executable = exe
        self.supervisor.command = [exe, '-e', javascript]
        self.supervisor.env.update(QUIESCENCE=str(source), BUSY=str(busy))
        old = self.start()
        with urllib.request.urlopen(f'http://127.0.0.1:{self.port}', timeout=1) as response:
            self.assertEqual(response.read(), b'ready')
        busy.touch()
        self.until(lambda: not self.supervisor._seal('idle'))
        self.supervisor.request_restart()
        self.supervisor.tick()
        self.assertIs(self.supervisor.child, old)
        self.assertIsNone(old.poll())
        busy.unlink()
        self.until(lambda: self.supervisor.child is None)
        self.now += 2
        self.assertNotEqual(self.start().pid, old.pid)

    def test_previous_owner_is_never_adopted(self):
        self.supervisor.owner.write_text('unverified owner')
        self.supervisor.tick()
        self.assertEqual(self.supervisor.state, 'RECOVERY_BLOCKED')
        self.assertIsNone(self.supervisor.child)

    # A process cannot outlive the boot that started it. Anything short of that
    # proof keeps the record and stays blocked.
    def interrupted_owner(self, boot, age=0):
        instance = self.root / 'bc-prior'
        instance.mkdir()
        record = str(instance) + '\n' + (f'boot {boot}\n' if boot else '')
        self.supervisor.owner.write_text(record)
        stamp = time.time() - age
        os.utime(self.supervisor.owner, (stamp, stamp))
        return record

    def blocked(self, record):
        self.supervisor.tick()
        self.assertEqual(self.supervisor.state, 'RECOVERY_BLOCKED')
        self.assertIsNone(self.supervisor.child)
        self.assertEqual(self.supervisor.owner.read_text(), record)

    def test_owner_from_an_earlier_boot_is_archived_and_backend_starts(self):
        self.supervisor.boot = lambda: ('BOOT-B', time.time() - 60)
        record = self.interrupted_owner('BOOT-A')
        self.start()
        archived = list(self.root.glob('backend-instance.ended-*'))
        self.assertEqual([p.read_text() for p in archived], [record])
        self.assertIn('boot BOOT-B\n', self.supervisor.owner.read_text())

    def test_owner_from_this_boot_stays_blocked(self):
        self.supervisor.boot = lambda: ('BOOT-A', time.time() - 60)
        self.blocked(self.interrupted_owner('BOOT-A', age=86400))

    def test_unknown_boot_identity_stays_blocked(self):
        self.supervisor.boot = lambda: None
        self.blocked(self.interrupted_owner('BOOT-A', age=86400))

    def test_unstamped_owner_needs_to_clearly_predate_boot(self):
        self.supervisor.boot = lambda: ('BOOT-B', time.time() - 3600)
        record = self.interrupted_owner(None, age=3660)
        self.blocked(record)
        self.supervisor.state = 'WAITING'
        os.utime(self.supervisor.owner, (time.time() - 7200,) * 2)
        self.start()

    def test_earlier_boot_owner_is_kept_while_another_listener_holds_the_port(self):
        self.supervisor.boot = lambda: ('BOOT-B', time.time() - 60)
        record = self.interrupted_owner('BOOT-A')
        with socket.socket() as foreign:
            foreign.bind(('127.0.0.1', self.port))
            foreign.listen()
            self.supervisor.tick()
            self.assertEqual(self.supervisor.state, 'PORT_HELD')
            self.assertEqual(self.supervisor.owner.read_text(), record)

    def test_earlier_boot_owner_is_kept_while_worker_recovery_is_uncertain(self):
        self.supervisor.boot = lambda: ('BOOT-B', time.time() - 60)
        record = self.interrupted_owner('BOOT-A')
        self.busy = True
        self.supervisor.tick()
        self.assertIsNone(self.supervisor.child)
        self.assertEqual(self.supervisor.owner.read_text(), record)

    def test_symlinked_owner_is_never_archived(self):
        self.supervisor.boot = lambda: ('BOOT-B', time.time() - 60)
        target = self.root / 'elsewhere'
        target.write_text(str(self.root / 'bc-prior') + '\nboot BOOT-A\n')
        self.supervisor.owner.symlink_to(target)
        self.supervisor.tick()
        self.assertEqual(self.supervisor.state, 'RECOVERY_BLOCKED')
        self.assertTrue(self.supervisor.owner.is_symlink())


if __name__ == '__main__':
    unittest.main()
