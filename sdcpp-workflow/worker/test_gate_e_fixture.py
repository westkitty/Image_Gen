import hashlib
import importlib.util
import os
from pathlib import Path
from types import SimpleNamespace
import tempfile
import unittest
from unittest.mock import patch


def load(name):
    spec = importlib.util.spec_from_file_location(name, Path(__file__).with_name(name + '.py'))
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


fixture = load('gate-e-fixture')
worker = load('engine-worker')


class GateEFixtureTest(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.root = Path(self.temp.name)
        self.volume = self.root / 'wc2tb'
        self.volume.mkdir()

    def create(self):
        fstat = os.fstat
        def simulated_mount(fd):
            info = fstat(fd)
            if info.st_ino == self.root.stat().st_ino:
                return SimpleNamespace(st_dev=info.st_dev + 1)
            return info
        with patch.object(fixture.os, 'fstat', simulated_mount):
            return fixture._create(self.volume, fixture.VOLUME_UUID)

    def test_fixed_tree_is_fsynced_read_back_and_created_exclusively(self):
        receipt = self.create()
        target = self.volume / fixture.TEST_ROOT
        self.assertEqual((target / 'runs/gate-e-probe/ui-run-card.md').read_bytes(), fixture.SENTINEL)
        self.assertEqual(receipt['sha256'], hashlib.sha256(fixture.SENTINEL).hexdigest())
        self.assertTrue((target / 'state').is_dir())
        with self.assertRaises(FileExistsError):
            self.create()

    def test_symlink_and_wrong_device_are_refused(self):
        with self.assertRaisesRegex(ValueError, 'device mismatch'):
            fixture._create(self.volume, fixture.VOLUME_UUID)
        (self.volume / fixture.TEST_ROOT).symlink_to(self.root)
        with self.assertRaises(FileExistsError):
            self.create()
        self.assertFalse((self.root / 'state').exists())

    def test_token_requires_private_digest_and_can_only_be_consumed_once(self):
        token = 'a' * 64
        digest = self.root / 'gate-e-bootstrap.sha256'
        digest.write_text(hashlib.sha256(token.encode()).hexdigest() + '\n')
        digest.chmod(0o600)
        with self.assertRaises(ValueError):
            fixture.authorize(self.root, 'b' * 64)
        self.assertTrue(digest.is_file())
        fixture.authorize(self.root, token)
        with self.assertRaises(FileNotFoundError):
            fixture.authorize(self.root, token)

    def test_rpc_is_fenced_and_reports_attribution_denial(self):
        import threading
        from unittest.mock import Mock
        bootstrap = Mock()
        bootstrap.create_fixture.side_effect = PermissionError(1, 'Operation not permitted')
        supervisor = SimpleNamespace(fixture_bootstrap=bootstrap, state='FIXTURE_REQUIRED',
                                     paused=True, worker_idle=lambda: True)
        obj = SimpleNamespace(supervisor=supervisor, lock=threading.RLock(), root=self.root)
        request = {'op': 'backend-prepare-fixture', 'token': 'a' * 64}
        with self.assertRaises(ValueError):
            worker.Worker.request(obj, {**request, 'path': '/Volumes/wc2tb'})
        bootstrap.authorize.assert_not_called()
        result = worker.Worker.request(obj, request)
        self.assertEqual(result['errno'], 1)
        self.assertEqual(result['state'], 'FIXTURE_BLOCKED')
        self.assertTrue(supervisor.paused)
        with self.assertRaises(ValueError):
            worker.Worker.request(obj, request)

    def test_rpc_unpauses_only_after_successful_readback(self):
        import threading
        from unittest.mock import Mock
        bootstrap = Mock()
        bootstrap.create_fixture.return_value = {'sha256': 'fixture-digest'}
        supervisor = SimpleNamespace(fixture_bootstrap=bootstrap, state='FIXTURE_REQUIRED',
                                     paused=True, worker_idle=lambda: True)
        obj = SimpleNamespace(supervisor=supervisor, lock=threading.RLock(), root=self.root)
        result = worker.Worker.request(obj, {'op': 'backend-prepare-fixture', 'token': 'a' * 64})
        self.assertEqual(result, {'ok': True, 'sha256': 'fixture-digest'})
        self.assertFalse(supervisor.paused)
        self.assertIsNone(supervisor.fixture_bootstrap)
