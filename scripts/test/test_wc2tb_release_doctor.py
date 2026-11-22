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
        'handoff': {'installed_supports': True, 'deployed_supervisor_sha256': SUP, 'package_commit': P['handoff_package_commit'],
                    'live': {'available': True, 'handoff': {'protocol': 2, 'mode': 'production', 'supervisor_sha256': SUP,
                                                            'state': 'RUNNING_EXTERNAL'}},
                    'journal': {'state': 'RUNNING_EXTERNAL', 'history': proven()}},
    }


SUP = 's' * 64


def proven(start=1, drill='d' * 32, **binding):
    """One owner drill exactly as the supervisor journals it, bound to the good_facts identity."""
    ident = {'host': 'bigmac', 'revision': REV, 'worker_sha256': 'w' * 64, 'supervisor_sha256': SUP, **binding}
    out = []
    for i, state in enumerate(doctor.PROOF_SEQUENCE):
        out.append({'seq': start + i, 'state': state, 'mode': 'production', 'schema': 2, 'drill_id': drill,
                    'transition_id': ('f' if i < 4 else 'r') * 32, 'authorized': {0: 'fallback', 4: 'external'}.get(i), **ident})
    return out


PROVEN = proven()


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

    def proof(self, history, facts_changes=None):
        facts = good_facts()
        facts['handoff']['journal'] = {'state': 'RUNNING_EXTERNAL', 'history': history}
        for (section, field), value in (facts_changes or {}).items():
            facts[section][field] = value
        return status(doctor.evaluate(facts), 'rollback_activation_proof')

    def test_Q_production_health_pass_does_not_imply_rollback_proof(self):  # J
        facts = good_facts()
        facts['handoff']['journal'] = {'state': 'ABSENT', 'history': []}
        report = doctor.evaluate(facts)
        self.assertEqual(report['sections']['production_health'], 'PASS')
        self.assertEqual(report['sections']['fallback_package_integrity'], 'PASS')
        self.assertEqual(report['sections']['handoff_capability'], 'PASS')
        self.assertEqual(report['sections']['rollback_activation_proof'], 'UNVERIFIED')
        self.assertEqual(report['sections']['return_to_external_capability'], 'UNVERIFIED')
        self.assertNotEqual(report['verdict'], 'PASS')

    def test_proof_A_current_revision_bound_round_trip_passes(self):
        report = doctor.evaluate(good_facts(), release=True, expect_revision=REV)
        self.assertEqual(status(report, 'rollback_activation_proof'), 'PASS')
        self.assertEqual(status(report, 'recovery_plan'), 'PASS')
        self.assertEqual(report['sections']['recovery_plan'], 'PASS')
        # A proven drill followed by more history (later drills, aborted attempts) still counts.
        self.assertEqual(self.proof(proven() + [{'seq': 9, 'state': 'QUIESCING', 'mode': 'production', 'schema': 2},
                                                {'seq': 10, 'state': 'RUNNING_EXTERNAL', 'mode': 'production', 'schema': 2}]), 'PASS')

    def test_proof_B_C_other_revision_worker_supervisor_or_host_do_not_share_proof(self):
        for field, value in (('revision', 'a' * 40), ('worker_sha256', 'x' * 64), ('supervisor_sha256', 'y' * 64), ('host', 'other')):
            self.assertEqual(self.proof(proven(**{field: value})), 'UNVERIFIED', field)
        # The same journal no longer proves anything once a new revision or worker is deployed.
        self.assertEqual(self.proof(PROVEN, {('revision', 'head'): 'b' * 40}), 'UNVERIFIED')
        self.assertEqual(self.proof(PROVEN, {('enginehost', 'worker_sha256'): 'z' * 64}), 'UNVERIFIED')
        facts = good_facts()
        facts['handoff']['live']['handoff']['supervisor_sha256'] = 'q' * 64  # running worker loaded other code
        self.assertEqual(status(doctor.evaluate(facts), 'rollback_activation_proof'), 'UNVERIFIED')

    def test_proof_D_E_F_mixed_reordered_or_interrupted_events_do_not_pass(self):
        mixed = proven()[:4] + proven(start=5, drill='e' * 32)[4:]
        self.assertEqual(self.proof(mixed), 'UNVERIFIED')                      # D: two drills
        one_leg = [dict(e, transition_id='t' * 32) for e in proven()]
        self.assertEqual(self.proof(one_leg), 'UNVERIFIED')                    # D: not two transitions
        swapped = proven()
        swapped[1], swapped[2] = swapped[2], swapped[1]
        self.assertEqual(self.proof(swapped), 'UNVERIFIED')                    # E: order
        gap = proven()
        for e in gap[4:]:
            e['seq'] += 3
        self.assertEqual(self.proof(gap), 'UNVERIFIED')                        # F: events removed/reset between legs
        failed = proven()
        failed.insert(4, dict(failed[3], seq=5, state='HANDOFF_FAILED'))
        self.assertEqual(self.proof(failed), 'UNVERIFIED')                     # F: failure in between
        unauthorized = proven()
        unauthorized[4]['authorized'] = None
        self.assertEqual(self.proof(unauthorized), 'UNVERIFIED')

    def test_proof_G_corrupt_truncated_or_legacy_journal_does_not_pass(self):
        legacy = [{'state': e['state'], 'mode': 'production'} for e in PROVEN]  # pre-binding shape
        self.assertEqual(self.proof(legacy), 'UNVERIFIED')
        self.assertEqual(self.proof(PROVEN[:6]), 'UNVERIFIED')
        with tempfile.TemporaryDirectory() as root:
            journal = os.path.join(root, 'backend-handoff.json')
            with open(journal, 'w') as handle:
                handle.write(json.dumps({'state': 'RUNNING_EXTERNAL', 'history': PROVEN})[:-40])
            facts = good_facts()
            facts['handoff'] = doctor.handoff_facts(root, journal, journal, live=facts['handoff']['live'])
            facts['handoff'].update(deployed_supervisor_sha256=SUP, package_commit=P['handoff_package_commit'])
            report = doctor.evaluate(facts)
            self.assertEqual(facts['handoff']['journal']['state'], 'CORRUPT')
            self.assertEqual((status(report, 'handoff_capability'), status(report, 'rollback_activation_proof')),
                             ('BLOCKED', 'UNVERIFIED'))

    def test_proof_I_isolated_test_mode_never_proves_production(self):
        self.assertEqual(self.proof([dict(e, mode='isolated-test') for e in PROVEN]), 'UNVERIFIED')

    def test_capability_H_source_markers_without_live_support_do_not_pass(self):
        facts = good_facts()
        facts['handoff']['live'] = {'available': True, 'handoff': None}  # installed source has markers; running worker does not
        report = doctor.evaluate(facts, release=True, expect_revision=REV)
        self.assertEqual(status(report, 'handoff_capability'), 'BLOCKED')
        self.assertEqual(status(report, 'return_to_external'), 'BLOCKED')
        self.assertEqual(status(report, 'recovery_plan'), 'BLOCKED')
        facts['handoff']['live'] = {'available': False, 'handoff': None}
        self.assertEqual(status(doctor.evaluate(facts), 'handoff_capability'), 'UNVERIFIED')
        for change in ({'protocol': 1}, {'mode': 'isolated-test'}, {'supervisor_sha256': 'q' * 64}):
            facts = good_facts()
            facts['handoff']['live']['handoff'].update(change)
            self.assertEqual(status(doctor.evaluate(facts), 'handoff_capability'), 'BLOCKED', change)
        facts = good_facts()
        facts['handoff']['package_commit'] = P['rollback_source_commit']  # v1 cannot be drained by its owner
        self.assertEqual(status(doctor.evaluate(facts), 'handoff_capability'), 'BLOCKED')

    def test_R_missing_or_unproven_handoff_is_not_a_recovery_plan(self):
        facts = good_facts()
        facts['handoff']['live']['handoff'] = None
        facts['handoff']['journal'] = {'state': 'ABSENT', 'history': []}
        report = doctor.evaluate(facts, release=True, expect_revision=REV)
        self.assertEqual(status(report, 'recovery_plan'), 'BLOCKED')
        self.assertEqual(status(report, 'rollback'), 'PASS')  # a good checksum alone...
        self.assertEqual(report['verdict'], 'BLOCKED')        # ...is not a recovery plan
        facts['handoff']['target_supports'] = True
        self.assertEqual(status(doctor.evaluate(facts, release=True, expect_revision=REV), 'recovery_plan'), 'UNVERIFIED')
        facts = good_facts()
        facts['handoff']['journal'] = {'state': 'ABSENT', 'history': []}
        report = doctor.evaluate(facts, release=True, expect_revision=REV)
        self.assertEqual((status(report, 'handoff_capability'), status(report, 'recovery_plan'), report['verdict']),
                         ('PASS', 'UNVERIFIED', 'UNVERIFIED'))
        for state in ('HANDOFF_FAILED', 'RUNNING_FALLBACK', 'QUIESCING', 'CORRUPT'):
            facts['handoff']['journal'] = {'state': state, 'history': PROVEN}
            self.assertEqual(status(doctor.evaluate(facts), 'handoff_capability'), 'BLOCKED', state)
        facts['handoff']['journal'] = None
        self.assertEqual(status(doctor.evaluate(facts), 'handoff_capability'), 'UNVERIFIED')

    def test_handoff_facts_read_real_sources_and_journals_without_writing(self):  # K
        repo = os.path.abspath(os.path.join(HERE, '..', '..'))
        with tempfile.TemporaryDirectory() as root:
            journal = os.path.join(root, 'backend-handoff.json')
            facts = doctor.handoff_facts(repo, os.path.join(repo, 'sdcpp-workflow/worker/engine-worker.py'), journal, repo,
                                         live={'available': True, 'handoff': None}, package=root)
            self.assertEqual((facts['installed_supports'], facts['target_supports'], facts['journal']['state']), (True, True, 'ABSENT'))
            self.assertEqual(facts['deployed_supervisor_sha256'],
                             doctor.sha256(os.path.join(repo, 'sdcpp-workflow/worker/backend-supervisor.py')))
            self.assertIsNone(facts['package_commit'])
            with open(journal, 'w') as handle:
                # On disk the supervisor records who authorized each leg and why.
                on_disk = [dict(e, authorized={'target': e['authorized'], 'reason': 'maintenance drill'} if e['authorized'] else None)
                           for e in PROVEN]
                json.dump({'state': 'RUNNING_EXTERNAL', 'seq': 8, 'history': on_disk}, handle)
            before = {n: os.stat(os.path.join(root, n)).st_mtime_ns for n in os.listdir(root)}
            facts = doctor.handoff_facts(repo, os.path.join(repo, 'sdcpp-workflow/worker/engine-worker.py'), journal, live=None)
            self.assertEqual([h['authorized'] for h in facts['journal']['history']][::4], ['fallback', 'external'])
            self.assertEqual(before, {n: os.stat(os.path.join(root, n)).st_mtime_ns for n in os.listdir(root)})

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
