"""Portable tests for scripts/wc2tb-release-doctor.py (no Big Mac, WC2TB or credentials).

Run: python3 -m unittest discover -s scripts/test -p 'test_*.py' -v
Letters refer to the prevention contract in docs/WC2TB_PREVENTION.md.
"""
import copy
import importlib.util
import json
import os
import re
import subprocess
import sys
import tempfile
import unittest

HERE = os.path.dirname(os.path.abspath(__file__))
DOCTOR = os.path.join(HERE, '..', 'wc2tb-release-doctor.py')
spec = importlib.util.spec_from_file_location('doctor', DOCTOR)
doctor = importlib.util.module_from_spec(spec)
spec.loader.exec_module(doctor)
P = doctor.PINS
MIB = doctor.MIB
REV = '352e508ceebe950bac6b2115be6782564e7b2370'


def good_facts():
    deps = {'resolves': True, 'is_symlink': False, 'target': '/x', 'lockfile': True,
            'required_missing': [], 'broken_symlinks': []}
    return {
        'platform': {'system': 'Darwin', 'machine': 'arm64', 'host': 'bigmac', 'user': 'bigmac'},
        'node': {'path': P['node_path'], 'exists': True, 'executable': True, 'sha256': P['node_sha256'], 'version': P['node_version']},
        'deps': dict(deps),
        'revision': {'worktree': doctor.DEPLOYED, 'head': REV, 'clean': True, 'api_git_head': REV[:7],
                     'api_cwd': doctor.DEPLOYED + '/operator-console', 'api_pid': 4242},
        'enginehost': {'exe_sha256': P['enginehost_sha256'], 'worker_sha256': 'w' * 64, 'worker_expected_sha256': 'w' * 64},
        'ancestry': {'listener_pids': [4242], 'chain': [
            {'pid': 4242, 'ppid': 4241, 'uid': 503, 'command': P['node_path'] + ' server.js'},
            {'pid': 4241, 'ppid': 4240, 'uid': 503, 'command': '/opt/homebrew/bin/python3 /Users/bigmac/.dexdiffusion-engine/engine-worker.py serve'},
            {'pid': 4240, 'ppid': 1, 'uid': 503, 'command': P['enginehost_path']}]},
        'authority': {'mode_file_regular': True, 'mode_content': 'production', 'legacy_disabled': True,
                      'legacy_loaded': False, 'supervisor_state': 'IDLE', 'supervisor_pid': 4242},
        'wc2tb': {'mounted': True, 'volume_uuid': P['wc2tb_volume_uuid'], 'backend_storage_mode': 'external',
                  'backend_external_available': True},
        'disk': {'path': '/Users/bigmac/DexDiffusion-PublicationStaging', 'free_bytes': 20000 * MIB, 'same_device': True},
        'publication': {'jobs_active': 0, 'lease_owner': None, 'lease_waiting': 0, 'quarantine': None,
                        'enabled': True, 'pending': 0, 'suspended': 0},
        'rollback': {'source_commit': P['rollback_source_commit'], 'starter_sha256': P['rollback_starter_sha256'], 'deps': dict(deps)},
        'validation_python': {'path': P['validation_python'], 'pillow': True},
    }


def status(report, cid):
    return next(c for c in report['checks'] if c['id'] == cid)['status']


def run_cli(facts, *args):
    with tempfile.NamedTemporaryFile('w', suffix='.json', delete=False) as handle:
        json.dump(facts, handle)
    try:
        done = subprocess.run([sys.executable, DOCTOR, '--facts', handle.name, *args], capture_output=True, text=True, timeout=30)
        return done.returncode, json.loads(done.stdout)
    finally:
        os.unlink(handle.name)


class ReleaseDoctor(unittest.TestCase):
    def test_baseline_fixture_passes_release_readiness(self):
        rc, report = run_cli(good_facts(), '--release-readiness', '--expect-revision', REV)
        self.assertEqual((rc, report['verdict'], report['fixture']), (0, 'PASS', True), report)

    def test_A_node_missing_or_hash_mismatch_blocks(self):
        facts = good_facts(); facts['node']['exists'] = False
        self.assertEqual(status(doctor.evaluate(facts), 'node'), 'BLOCKED')
        facts = good_facts(); facts['node']['sha256'] = '0' * 64
        rc, report = run_cli(facts)
        self.assertEqual((rc, report['verdict'], status(report, 'node')), (1, 'BLOCKED', 'BLOCKED'))

    def test_B_broken_dependency_symlink_blocks(self):
        with tempfile.TemporaryDirectory() as root:
            console = os.path.join(root, 'operator-console')
            os.makedirs(console)
            open(os.path.join(console, 'package-lock.json'), 'w').close()
            os.symlink(os.path.join(root, 'missing-runtime', 'node_modules'), os.path.join(console, 'node_modules'))
            deps = doctor.dependency_facts(console)
            self.assertFalse(deps['resolves'])
            facts = good_facts(); facts['deps'] = deps
            self.assertEqual(status(doctor.evaluate(facts), 'dependencies'), 'BLOCKED')
            # A resolvable tree with one dangling package link is also BLOCKED.
            os.unlink(os.path.join(console, 'node_modules'))
            modules = os.path.join(console, 'node_modules')
            for dep in P['required_deps']:
                os.makedirs(os.path.join(modules, dep))
                open(os.path.join(modules, dep, 'package.json'), 'w').close()
            os.makedirs(os.path.join(modules, '.bin'))
            os.symlink('../gone/cli.js', os.path.join(modules, '.bin', 'gone'))
            deps = doctor.dependency_facts(console)
            self.assertEqual(deps['broken_symlinks'], [os.path.join('.bin', 'gone')])
            facts['deps'] = deps
            self.assertEqual(status(doctor.evaluate(facts), 'dependencies'), 'BLOCKED')

    def test_C_wc2tb_unreadable_by_worker_blocks_and_mount_alone_is_not_evidence(self):
        facts = good_facts(); facts['wc2tb']['backend_storage_mode'] = 'internal-fallback'
        facts['wc2tb']['backend_external_available'] = False
        self.assertEqual(status(doctor.evaluate(facts), 'wc2tb_access'), 'BLOCKED')
        facts = good_facts(); facts['wc2tb']['backend_storage_mode'] = None
        self.assertEqual(status(doctor.evaluate(facts), 'wc2tb_access'), 'UNVERIFIED')
        facts = good_facts(); facts['wc2tb']['volume_uuid'] = '00000000-0000-0000-0000-000000000000'
        self.assertEqual(status(doctor.evaluate(facts), 'wc2tb_access'), 'BLOCKED')

    def test_D_two_restart_owners_block(self):
        facts = good_facts(); facts['authority']['legacy_loaded'] = True
        report = doctor.evaluate(facts)
        self.assertEqual((status(report, 'restart_authority'), status(report, 'legacy_agent')), ('BLOCKED', 'BLOCKED'))
        facts = good_facts(); facts['authority']['legacy_disabled'] = False
        self.assertEqual(status(doctor.evaluate(facts), 'restart_authority'), 'BLOCKED')
        facts = good_facts(); facts['ancestry']['listener_pids'] = [4242, 5151]
        self.assertEqual(status(doctor.evaluate(facts), 'process_ancestry'), 'BLOCKED')

    def test_F_G_H_disk_reserve_boundaries(self):
        self.assertEqual(doctor.disk_reserve_bytes(1), 1536 * MIB)
        self.assertEqual(doctor.disk_reserve_bytes(16), 5376 * MIB)
        self.assertEqual(doctor.disk_reserve_bytes(99), 5376 * MIB)
        for free, expected, cap in ((1536 * MIB, 'PASS', 1), (5376 * MIB, 'PASS', 16), (1536 * MIB - 1, 'BLOCKED', 0)):
            facts = good_facts(); facts['disk']['free_bytes'] = free
            self.assertEqual(doctor.batch_capacity(free), cap)
            self.assertEqual(status(doctor.evaluate(facts), 'disk_reserve'), expected, free)

    def test_M_missing_pillow_is_a_clear_prerequisite_block(self):
        facts = good_facts(); facts['validation_python']['pillow'] = False
        check = next(c for c in doctor.evaluate(facts)['checks'] if c['id'] == 'image_validation_python')
        self.assertEqual(check['status'], 'BLOCKED')
        self.assertIn('PREREQUISITE MISSING: Pillow', check['detail'])
        with tempfile.TemporaryDirectory() as root:
            fake = os.path.join(root, 'python-without-pillow')
            with open(fake, 'w') as handle:
                handle.write('#!/bin/sh\nexit 1\n')
            os.chmod(fake, 0o755)
            done = subprocess.run([sys.executable, os.path.join(HERE, '..', 'check-test-prerequisites.py')],
                                  env={**os.environ, 'DEX_IMAGE_VALIDATION_PYTHON': fake}, capture_output=True, text=True, timeout=30)
            self.assertEqual(done.returncode, 2)
            self.assertIn('PREREQUISITE MISSING: Pillow is not importable', done.stderr)

    def test_O_unsupported_platform_is_unverified_never_pass(self):
        facts = doctor.collect() if sys.platform != 'darwin' else {'platform': {'system': 'Linux', 'machine': 'x86_64', 'host': 'ci'}}
        if facts['platform'].get('host') == 'bigmac':
            self.skipTest('running on the supported host')
        report = doctor.evaluate(facts, release=True, expect_revision=REV)
        self.assertEqual(report['verdict'], 'UNVERIFIED')
        self.assertNotIn('PASS', {c['status'] for c in report['checks']})

    def test_missing_evidence_is_unverified(self):
        for key in ('node', 'authority', 'wc2tb', 'disk', 'publication', 'rollback', 'validation_python'):
            facts = good_facts(); del facts[key]
            self.assertEqual(doctor.evaluate(facts)['verdict'], 'UNVERIFIED', key)

    def test_release_readiness_requires_idle_acknowledged_expected_target(self):
        self.assertEqual(doctor.evaluate(good_facts(), release=True)['verdict'], 'UNVERIFIED')
        self.assertEqual(doctor.evaluate(good_facts(), release=True, expect_revision='f' * 40)['verdict'], 'BLOCKED')
        for mutate in (lambda f: f['publication'].update(jobs_active=1), lambda f: f['publication'].update(pending=2),
                       lambda f: f['publication'].update(enabled=False), lambda f: f['revision'].update(clean=False)):
            facts = good_facts(); mutate(facts)
            self.assertEqual(doctor.evaluate(facts, release=True, expect_revision=REV)['verdict'], 'BLOCKED')

    def test_negative_control_broken_fixture_fails(self):
        # Every single-field corruption of the passing fixture must stop PASS.
        corruptions = [('node', 'version', 'v20.0.0'), ('enginehost', 'exe_sha256', '1' * 64),
                       ('enginehost', 'worker_sha256', '2' * 64), ('authority', 'mode_content', 'off'),
                       ('rollback', 'starter_sha256', '3' * 64), ('revision', 'api_cwd', '/Users/bigmac/Image_Gen/operator-console')]
        for section, field, value in corruptions:
            facts = copy.deepcopy(good_facts()); facts[section][field] = value
            self.assertNotEqual(doctor.evaluate(facts, release=True, expect_revision=REV)['verdict'], 'PASS', (section, field))

    def test_P_doctor_source_is_read_only(self):
        with open(DOCTOR, encoding='utf-8') as handle:
            source = handle.read()
        code = '\n'.join(line for line in source.splitlines() if not line.lstrip().startswith('#'))
        for forbidden in (r'os\.kill', r'os\.remove', r'os\.unlink', r'rmtree', r'os\.rename', r'shutil\.move',
                          r"open\([^)]*['\"][wax]", r'kickstart', r'bootout', r'bootstrap', r"'enable'", r"'disable'",
                          r"'kill'", r'backend-restart', r'\bmount\b.*-o', r'tmutil', r"diskutil', '(mount|unmount|repair|eject|erase)"):
            self.assertIsNone(re.search(forbidden, code), forbidden)
        argv0 = set(re.findall(r"run\(\[\s*'([^']+)'", code)) | set(re.findall(r'run\(\[(\w+),', code))
        self.assertLessEqual(argv0, {'/usr/bin/git', '/bin/ps', '/usr/sbin/lsof', '/bin/launchctl', '/usr/sbin/diskutil', '/sbin/mount', 'node', 'py'})
        self.assertNotRegex(code, r"launchctl', '(?!print)")


if __name__ == '__main__':
    unittest.main()
