"""Gate C retention contract: a completed, unacknowledged result is never lost to time.

Isolated: temp roots under /tmp, fake PIL engines, no models, no live inference.
Set DEX_GATEC_WORKER to another engine-worker.py (e.g. a pristine HEAD copy) to
run the identical scenarios against it and record the "before" failures.
"""
import importlib.util
import json
import os
from pathlib import Path
import shutil
import sys
import tempfile
import time
import unittest
from unittest import mock

WORKER = Path(os.environ.get('DEX_GATEC_WORKER') or Path(__file__).with_name('engine-worker.py'))
spec = importlib.util.spec_from_file_location('engine_worker_retention', WORKER)
m = importlib.util.module_from_spec(spec)
spec.loader.exec_module(m)

TOKEN = 'c' * 64
ENGINE = ('#!' + sys.executable + '\nfrom PIL import Image\nimport sys\na=sys.argv\nout=a[a.index("-o")+1]\n'
          'n=int(a[a.index("-b")+1]) if "-b" in a else 1\n'
          'for i in range(n): Image.new("RGB",(64,64),(i*40,9,9)).save(out%i if n>1 else out)\n')


def expire(worker, now):
    """Run exactly one expiry pass at a chosen clock, on either worker version."""
    if hasattr(worker, 'expire_once'):
        return worker.expire_once(now)
    with mock.patch.object(m.time, 'time', return_value=now), \
            mock.patch.object(m.time, 'sleep', side_effect=lambda _s: setattr(worker, 'stopping', True)):
        worker.expire_results()
    worker.stopping = False


class RetentionTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory(prefix='dex-gc-ret-', dir='/tmp')
        self.root = Path(self.temp.name)
        (self.root / 'jobs').mkdir()
        model = self.root / 'model.safetensors'
        model.write_bytes(b'model')
        engine = self.root / 'fake-engine'
        engine.write_text(ENGINE)
        engine.chmod(0o700)
        registry = {'models': {'sdxl-base': {'maxSteps': 50, 'path': str(model)}}, 'samplers': {'euler': 'euler'},
                    'schedulers': ['discrete'], 'adapters': {}, 'access_probe': {}, 'sdcli': str(engine),
                    'image_python': sys.executable}
        (self.root / 'registry.json').write_text(json.dumps(registry))
        shutil.copyfile(WORKER.with_name('engine-child.py'), self.root / 'engine-child.py')
        self.worker = self.make_worker()

    def tearDown(self):
        until = time.time() + 8
        while self.worker.active and time.time() < until:
            time.sleep(.05)
        self.temp.cleanup()

    def make_worker(self, **limits):
        worker = m.Worker(self.root, external_probe=lambda: '')
        # A worker without a retention contract simply ignores these attributes.
        if isinstance(getattr(worker, 'retention', None), dict):
            worker.retention.update(limits)
        else:
            worker.retention = dict(limits)
        return worker

    def req(self, run_id='20261120-120000-retention', **extra):
        return {'op': 'generate', 'run_id': run_id, 'token': TOKEN, 'target': 'sdxl-base', 'prompt': 'p',
                'negative_prompt': '', 'width': 64, 'height': 64, 'steps': 4, 'seed': 1, 'cfg': 7,
                'sampler': 'euler', 'scheduler': 'discrete', 'loras': [], **extra}

    def complete(self, run_id='20261120-120000-retention', **extra):
        self.worker.request(self.req(run_id, **extra))
        until = time.time() + 15
        while self.worker.active and time.time() < until:
            time.sleep(.05)
        job = self.worker.jobs[run_id]
        self.assertEqual(job['status'], 'complete', job.get('error'))
        return job

    def owned(self, op, run_id='20261120-120000-retention', worker=None, **extra):
        return (worker or self.worker).request({'op': op, 'run_id': run_id, 'token': TOKEN, **extra})

    def test_unacknowledged_result_survives_expiry(self):
        job = self.complete()
        expire(self.worker, job['finished'] + 3601)
        result = self.owned('result')
        self.assertEqual(result['sha256'], job['sha256'])

    def test_partial_batch_survives_expiry(self):
        job = self.complete(batch_count=3)
        self.owned('result', index=0)  # one image downloaded, the client then disappears
        expire(self.worker, job['finished'] + 7200)
        for index in range(3):
            self.assertEqual(self.owned('result', index=index)['sha256'], job['images'][index]['sha256'])

    def test_restart_with_unacknowledged_result_then_expiry(self):
        job = self.complete()
        restarted = self.make_worker()
        self.worker = restarted
        expire(restarted, job['finished'] + 3601)
        self.assertEqual(restarted.jobs[job['run_id']]['status'], 'complete')
        self.assertEqual(self.owned('result', worker=restarted)['sha256'], job['sha256'])

    def test_restart_before_complete_receipt_preserves_staged_and_promoted_outputs(self):
        job = self.complete(batch_count=3)
        directory = self.root / 'jobs' / job['run_id']
        tmp = directory / 'tmp'
        tmp.mkdir()
        moved = directory / 'output-1.png'
        moved.rename(tmp / 'output-b01.png')
        staged = tmp / 'output-b01.png'
        promoted = directory / 'output-0.png'
        expected = [p.read_bytes() for p in (staged, promoted)]
        self.worker.save({**job, 'status': 'running', 'cleanup': False, 'pgid': None})

        for _ in range(2):
            self.worker = self.make_worker()
            self.assertEqual(self.worker.recovery_uncertain, [job['run_id']])
            self.assertFalse(self.owned('status')['cleanup'])
            with self.assertRaisesRegex(ValueError, 'cleanup is unverified'):
                self.owned('ack')
            expire(self.worker, job['finished'] + 7200)
            self.assertEqual([p.read_bytes() for p in (staged, promoted)], expected)

    def test_acknowledged_and_failed_outputs_still_expire(self):
        job = self.complete()
        self.owned('ack')
        expire(self.worker, job['finished'] + 3601)
        self.assertEqual(list((self.root / 'jobs' / job['run_id']).glob('output*.png')), [])

    def test_ack_is_idempotent_and_releases_outputs(self):
        self.complete()
        first = self.owned('ack')
        second = self.owned('ack')
        self.assertTrue(first['acknowledged'] and second['acknowledged'])
        self.assertEqual(list((self.root / 'jobs' / '20261120-120000-retention').glob('output*.png')), [])
        with self.assertRaisesRegex(ValueError, 'no pending result'):
            self.owned('result')

    def test_ack_receipt_is_durable_before_outputs_are_released(self):
        self.complete()
        order = []
        real_save, real_unlink = self.worker.save, Path.unlink
        with mock.patch.object(self.worker, 'save', side_effect=lambda job: (order.append('save'), real_save(job))), \
                mock.patch.object(Path, 'unlink', autospec=True,
                                  side_effect=lambda p, missing_ok=False: (order.append('unlink'), real_unlink(p, missing_ok=missing_ok))):
            self.owned('ack')
        self.assertEqual(order[0], 'save', order)

    def test_failed_ack_receipt_write_keeps_the_result_for_retry(self):
        job = self.complete()
        with mock.patch.object(self.worker, 'save', side_effect=OSError('simulated disk failure')):
            with self.assertRaises(OSError):
                self.owned('ack')
        self.assertFalse(self.owned('status').get('acknowledged', False))
        self.assertEqual(self.owned('result')['sha256'], job['sha256'])
        self.assertTrue(self.owned('ack')['acknowledged'])

    def test_receipt_writes_are_fsynced(self):
        job = self.complete()
        with mock.patch.object(m.os, 'fsync', wraps=os.fsync) as fsync:
            self.worker.save(job)
        self.assertGreaterEqual(fsync.call_count, 1)

    def test_retention_bound_refuses_new_work_instead_of_deleting(self):
        self.worker = self.make_worker(max_jobs=1)
        held = self.complete()
        with self.assertRaisesRegex(ValueError, 'retention bound'):
            self.worker.request(self.req('20261120-120001-second'))
        self.assertTrue((self.root / 'jobs' / held['run_id'] / 'output.png').exists())
        self.owned('ack', run_id=held['run_id'])
        self.complete('20261120-120001-second')

    def test_low_disk_refuses_new_work(self):
        self.worker.free_space = lambda _p: 0
        with self.assertRaisesRegex(ValueError, 'insufficient worker disk'):
            self.worker.request(self.req())
        self.assertNotIn('20261120-120000-retention', self.worker.jobs)

    def test_health_reports_retention_without_secrets(self):
        self.complete()
        health = self.worker.request({'op': 'health'})
        self.assertEqual(health['retention']['unacknowledged'], ['20261120-120000-retention'])
        self.assertNotIn(TOKEN, json.dumps(health))
        self.assertNotIn('token_hash', json.dumps(health))


if __name__ == '__main__':
    unittest.main()
