#!/usr/bin/env python3
"""WC2TB release doctor for the Big Mac DexDiffusion backend.

STRICTLY READ-ONLY. It never installs, stops, restarts, signals, cleans up,
remounts, repairs or writes anything. Every probe is bounded by a timeout.

  wc2tb-release-doctor.py                      inspect the running deployment
  wc2tb-release-doctor.py --release-readiness --expect-revision SHA [--target-worktree DIR]
                                               fail-closed gate for a future cutover
  wc2tb-release-doctor.py --facts FILE         evaluate recorded facts (fixture; never authorizes)

Output is one JSON document. Verdict PASS / BLOCKED / UNVERIFIED.
Exit status: 0 PASS, 1 BLOCKED, 3 UNVERIFIED, 2 usage error.
Missing evidence is UNVERIFIED, never PASS. WC2TB permission is never inferred
from the mount alone: only the EngineHost-descended backend's own storage
selection counts as evidence that the worker lineage can read the volume.
"""
import argparse
import datetime
import hashlib
import json
import os
import platform
import socket
import subprocess
import sys
import urllib.request

MIB = 1024 * 1024
HOME = '/Users/bigmac'
DEPLOYED = HOME + '/Image_Gen-wc2tb-20261120'
ENGINE = HOME + '/.dexdiffusion-engine'
RUNTIME = HOME + '/Library/Application Support/DexDiffusion/wc2tb-recovery-runtime'
ROLLBACK = HOME + '/Library/Application Support/DexDiffusion/wc2tb-fallback-rollback-v1'
BASE = 'http://127.0.0.1:31337'
PINS = {
    'node_path': RUNTIME + '/node/bin/node',
    'node_sha256': '266dec4dce3a6cdcf5cdc38722a00cf5ae6a12cc51068d2a227655bbb75751ec',
    'node_version': 'v26.13.1',
    'enginehost_path': HOME + '/Applications/DexDiffusion Engine Worker.app/Contents/MacOS/DexDiffusionEngineHost',
    'enginehost_sha256': '79faeb90fa089261f174205e8a887b62c684fffba1b8ece9eaa4daa690eec4d3',
    'worker_path': ENGINE + '/engine-worker.py',
    'wc2tb_mount': '/Volumes/wc2tb',
    'wc2tb_volume_uuid': '888EF24D-E36E-473A-A195-5CADD598E4F8',
    'legacy_label': 'local.dexdiffusion.server',
    'rollback_source_commit': 'c7708e4a40edff156cbaaccda7f6299088c0f306',
    'rollback_starter_sha256': '03bb7a28a8849fcf28736ceab2f422853e361559eb09ef7ee5bd1cf60c364ce2',
    'validation_python': HOME + '/Library/Caches/DexDiffusion/mflux/venv/bin/python',
    'required_deps': ['express', 'three', '@sparkjsdev/spark'],
}
STATUSES = ('PASS', 'BLOCKED', 'UNVERIFIED')
HANDOFF_SUPERVISOR_MARK = 'class HandoffController'
HANDOFF_WORKER_MARK = "req.get('op') == 'backend-handoff'"
SECTIONS = {
    'production_health': ('platform', 'node', 'dependencies', 'backend_revision', 'enginehost_worker', 'process_ancestry',
                          'restart_authority', 'legacy_agent', 'wc2tb_access', 'disk_reserve', 'publication_state',
                          'macbook_ack', 'image_validation_python'),
    'fallback_package_integrity': ('rollback',),
    'handoff_capability': ('handoff_capability',),
    'rollback_activation_proof': ('rollback_activation_proof',),
    'return_to_external_capability': ('return_to_external',),
}


def disk_reserve_bytes(images):
    """Mirror of operator-console/backend-quiescence.js sharedDiskReserveBytes."""
    images = max(1, min(16, int(images)))
    return (1024 + 4 * images * 64 + 256) * MIB


def batch_capacity(free_bytes):
    for images in range(16, 0, -1):
        if free_bytes >= disk_reserve_bytes(images):
            return images
    return 0


# ----------------------------------------------------------------- collection
def run(argv, timeout=5):
    try:
        done = subprocess.run(argv, capture_output=True, text=True, timeout=timeout, stdin=subprocess.DEVNULL)
        return done.returncode, done.stdout
    except (OSError, subprocess.TimeoutExpired):
        return None, ''


def sha256(path):
    try:
        digest = hashlib.sha256()
        with open(path, 'rb') as handle:
            for block in iter(lambda: handle.read(1 << 20), b''):
                digest.update(block)
        return digest.hexdigest()
    except OSError:
        return None


def http_json(path, timeout=4):
    try:
        with urllib.request.urlopen(BASE + path, timeout=timeout) as response:
            return json.load(response)
    except (OSError, ValueError):
        return None


def worker_socket(op):
    try:
        with socket.socket(socket.AF_UNIX) as sock:
            sock.settimeout(2)
            sock.connect(ENGINE + '/engine.sock')
            sock.sendall((json.dumps({'op': op}) + '\n').encode())
            return json.loads(sock.makefile().readline(4096))
    except (OSError, ValueError):
        return None


def dependency_facts(console_dir):
    modules = os.path.join(console_dir, 'node_modules')
    facts = {'node_modules_path': modules, 'lockfile': os.path.isfile(os.path.join(console_dir, 'package-lock.json'))}
    facts['resolves'] = os.path.isdir(modules)
    facts['is_symlink'] = os.path.islink(modules)
    facts['target'] = os.path.realpath(modules) if facts['is_symlink'] else modules
    facts['required_missing'] = [d for d in PINS['required_deps']
                                 if not os.path.isfile(os.path.join(modules, d, 'package.json'))]
    broken = []
    if facts['resolves']:
        for root, dirs, files in os.walk(modules):
            for name in dirs + files:
                candidate = os.path.join(root, name)
                if os.path.islink(candidate) and not os.path.exists(candidate):
                    broken.append(os.path.relpath(candidate, modules))
            # Only the top two levels hold package entries and .bin links.
            if root.count(os.sep) - modules.count(os.sep) >= 1:
                dirs[:] = []
    facts['broken_symlinks'] = broken[:20]
    return facts


def git_facts(worktree):
    rc, head = run(['/usr/bin/git', '-C', worktree, 'rev-parse', 'HEAD'])
    rc2, status = run(['/usr/bin/git', '-C', worktree, 'status', '--porcelain', '--untracked-files=no'])
    return {'worktree': worktree, 'head': head.strip() if rc == 0 else None,
            'clean': (status.strip() == '') if rc2 == 0 else None}


def ps_row(pid):
    rc, out = run(['/bin/ps', '-o', 'ppid=', '-o', 'uid=', '-p', str(pid)])
    rc2, command = run(['/bin/ps', '-o', 'command=', '-p', str(pid)])
    if rc != 0 or rc2 != 0 or not out.split():
        return None
    ppid, uid = out.split()[:2]
    return {'pid': int(pid), 'ppid': int(ppid), 'uid': int(uid), 'command': command.strip()}


def collect(target_worktree=None):
    facts = {'platform': {'system': platform.system(), 'machine': platform.machine(),
                          'host': socket.gethostname().split('.')[0].lower(),
                          'user': os.environ.get('USER') or os.environ.get('LOGNAME')}}
    p = facts['platform']
    if not (p['system'] == 'Darwin' and p['machine'] == 'arm64' and p['host'] == 'bigmac' and os.getuid() == 503):
        return facts  # unsupported platform: every host check stays UNVERIFIED

    node = PINS['node_path']
    rc, version = run([node, '--version']) if os.access(node, os.X_OK) else (None, '')
    facts['node'] = {'path': node, 'exists': os.path.isfile(node), 'executable': os.access(node, os.X_OK),
                     'sha256': sha256(node), 'version': version.strip() if rc == 0 else None}
    facts['deps'] = dependency_facts(DEPLOYED + '/operator-console')
    version = http_json('/api/version')
    facts['revision'] = git_facts(DEPLOYED)
    if version:
        facts['revision'].update(api_git_head=version.get('gitHead'), api_cwd=version.get('cwd'), api_pid=version.get('pid'))
    if target_worktree:
        facts['target'] = git_facts(target_worktree)
        facts['target']['deps'] = dependency_facts(os.path.join(target_worktree, 'operator-console'))
    rc, expected_worker = run(['/usr/bin/git', '-C', DEPLOYED, 'show', 'HEAD:sdcpp-workflow/worker/engine-worker.py'])
    facts['enginehost'] = {'exe_sha256': sha256(PINS['enginehost_path']), 'worker_sha256': sha256(PINS['worker_path']),
                           'worker_expected_sha256': hashlib.sha256(expected_worker.encode()).hexdigest() if rc == 0 else None}
    rc, listeners = run(['/usr/sbin/lsof', '-nP', '-iTCP:31337', '-sTCP:LISTEN', '-t'])
    pids = sorted({int(x) for x in listeners.split()}) if rc in (0, 1) else None
    chain = []
    if pids and len(pids) == 1:
        pid = pids[0]
        for _ in range(4):
            row = ps_row(pid)
            if not row:
                break
            chain.append(row)
            if row['ppid'] <= 1:
                break
            pid = row['ppid']
    facts['ancestry'] = {'listener_pids': pids, 'chain': chain}
    mode = ENGINE + '/backend-supervisor-mode'
    content = None
    if os.path.isfile(mode) and not os.path.islink(mode):
        try:
            with open(mode, encoding='utf-8') as handle:
                content = handle.read(64).strip()
        except OSError:
            pass
    rc, disabled = run(['/bin/launchctl', 'print-disabled', 'gui/503'])
    rc2, _ = run(['/bin/launchctl', 'print', 'gui/503/' + PINS['legacy_label']])
    status = worker_socket('backend-status')
    facts['authority'] = {
        'mode_file_regular': os.path.isfile(mode) and not os.path.islink(mode), 'mode_content': content,
        'legacy_disabled': ('"%s" => disabled' % PINS['legacy_label'] in disabled) if rc == 0 else None,
        'legacy_loaded': (rc2 == 0) if rc2 is not None else None,
        'supervisor_state': status.get('state') if status else None,
        'supervisor_pid': status.get('pid') if status else None}
    rc, info = run(['/usr/sbin/diskutil', 'info', PINS['wc2tb_mount']], timeout=8)
    uuid = None
    for line in info.splitlines() if rc == 0 else []:
        if line.strip().startswith('Volume UUID:'):
            uuid = line.split(':', 1)[1].strip()
    rc3, mounts = run(['/sbin/mount'])
    storage = (version or {}).get('storage') or {}
    facts['wc2tb'] = {'mounted': (' on %s (' % PINS['wc2tb_mount'] in mounts) if rc3 == 0 else None,
                      'volume_uuid': uuid, 'backend_storage_mode': storage.get('mode'),
                      'backend_external_available': storage.get('externalAvailable')}
    working = storage.get('workingImages')
    if working and os.path.isdir(working):
        st = os.statvfs(working)
        facts['disk'] = {'path': working, 'free_bytes': st.f_bavail * st.f_frsize,
                         'same_device': os.stat(working).st_dev == os.stat(HOME).st_dev}
    jobs, resources, pubs = http_json('/api/jobs'), http_json('/api/resources'), http_json('/api/publications/status')
    facts['publication'] = {
        'jobs_active': len(jobs.get('jobs', [])) if jobs else None,
        'lease_owner': resources.get('owner') if resources else 'unknown',
        'lease_waiting': len(resources.get('waiting', [])) if resources else None,
        'quarantine': resources.get('quarantine') if resources else 'unknown',
        'enabled': pubs.get('enabled') if pubs else None,
        'pending': pubs.get('pending') if pubs else None,
        'suspended': pubs.get('suspended') if pubs else None}
    try:
        with open(ROLLBACK + '/SOURCE_COMMIT', encoding='utf-8') as handle:
            commit = handle.read(64).strip()
    except OSError:
        commit = None
    facts['rollback'] = {'source_commit': commit, 'starter_sha256': sha256(ROLLBACK + '/start-fallback-rollback.sh'),
                         'deps': dependency_facts(ROLLBACK + '/source/operator-console')}
    py = PINS['validation_python']
    rc, _ = run([py, '-c', 'import PIL'], timeout=10) if os.access(py, os.X_OK) else (None, '')
    facts['validation_python'] = {'path': py, 'pillow': (rc == 0) if rc is not None else False}
    facts['handoff'] = handoff_facts(DEPLOYED, ENGINE + '/engine-worker.py', ENGINE + '/backend-handoff.json', target_worktree)
    return facts


def read_text(path, limit=1 << 20):
    try:
        with open(path, encoding='utf-8') as handle:
            return handle.read(limit)
    except (OSError, UnicodeDecodeError):
        return None


def supports_handoff(supervisor_source, worker_source):
    if supervisor_source is None or worker_source is None:
        return None
    return HANDOFF_SUPERVISOR_MARK in supervisor_source and HANDOFF_WORKER_MARK in worker_source


def handoff_facts(deployed, installed_worker, journal_path, target_worktree=None):
    facts = {'installed_supports': supports_handoff(
        read_text(deployed + '/sdcpp-workflow/worker/backend-supervisor.py'), read_text(installed_worker))}
    if target_worktree:
        facts['target_supports'] = supports_handoff(
            read_text(os.path.join(target_worktree, 'sdcpp-workflow/worker/backend-supervisor.py')),
            read_text(os.path.join(target_worktree, 'sdcpp-workflow/worker/engine-worker.py')))
    raw = read_text(journal_path)
    if raw is None:
        facts['journal'] = None if os.path.exists(journal_path) else {'state': 'ABSENT', 'history': []}
    else:
        try:
            journal = json.loads(raw)
            facts['journal'] = {'state': journal.get('state'), 'failure': journal.get('failure'),
                                'history': [{'state': h.get('state'), 'mode': h.get('mode')} for h in journal.get('history') or []]}
        except ValueError:
            facts['journal'] = {'state': 'CORRUPT', 'history': []}
    return facts


def production_round_trip_proven(journal):
    """PASS evidence only: a production-mode RUNNING_FALLBACK later followed by RUNNING_EXTERNAL."""
    seen_fallback = False
    for entry in (journal or {}).get('history') or []:
        if entry.get('mode') != 'production':
            continue
        if entry.get('state') == 'RUNNING_FALLBACK':
            seen_fallback = True
        elif entry.get('state') == 'RUNNING_EXTERNAL' and seen_fallback:
            return True
    return False


# ----------------------------------------------------------------- evaluation
def check(cid, status, detail):
    assert status in STATUSES
    return {'id': cid, 'status': status, 'detail': detail}


def eval_deps(cid, deps):
    if not deps:
        return check(cid, 'UNVERIFIED', 'dependency facts missing')
    if not deps.get('resolves'):
        return check(cid, 'BLOCKED', 'node_modules does not resolve (broken or missing symlink): %s' % deps.get('target'))
    if deps.get('broken_symlinks'):
        return check(cid, 'BLOCKED', 'broken dependency symlinks: %s' % ', '.join(deps['broken_symlinks']))
    if deps.get('required_missing'):
        return check(cid, 'BLOCKED', 'required dependencies missing: %s' % ', '.join(deps['required_missing']))
    if deps.get('lockfile') is not True:
        return check(cid, 'BLOCKED', 'package-lock.json missing')
    return check(cid, 'PASS', 'dependencies resolve; lockfile present')


def evaluate(facts, release=False, expect_revision=None):
    checks = []
    p = facts.get('platform') or {}
    supported = p.get('system') == 'Darwin' and p.get('machine') == 'arm64' and p.get('host') == 'bigmac'
    checks.append(check('platform', 'PASS' if supported else 'UNVERIFIED',
                        'Big Mac arm64' if supported else 'unsupported platform %s/%s host=%s; host checks not evaluated' % (p.get('system'), p.get('machine'), p.get('host'))))

    n = facts.get('node')
    if not n:
        checks.append(check('node', 'UNVERIFIED', 'node facts missing'))
    elif not (n.get('exists') and n.get('executable')):
        checks.append(check('node', 'BLOCKED', 'pinned Node missing or not executable: %s' % n.get('path')))
    elif n.get('sha256') != PINS['node_sha256']:
        checks.append(check('node', 'BLOCKED', 'pinned Node hash mismatch: %s' % n.get('sha256')))
    elif n.get('version') != PINS['node_version']:
        checks.append(check('node', 'BLOCKED', 'pinned Node version %r != %s' % (n.get('version'), PINS['node_version'])))
    else:
        checks.append(check('node', 'PASS', '%s sha256 pinned' % PINS['node_version']))

    checks.append(eval_deps('dependencies', facts.get('deps')))

    r = facts.get('revision')
    if not r or not r.get('head') or not r.get('api_git_head'):
        checks.append(check('backend_revision', 'UNVERIFIED', 'deployed worktree HEAD or /api/version unavailable'))
    elif r.get('clean') is not True:
        checks.append(check('backend_revision', 'BLOCKED', 'deployed worktree is dirty or unreadable'))
    elif not r['head'].startswith(r['api_git_head']) or r.get('api_cwd') != DEPLOYED + '/operator-console':
        checks.append(check('backend_revision', 'BLOCKED', 'running backend %s@%s does not match worktree %s'
                            % (r.get('api_git_head'), r.get('api_cwd'), r['head'][:12])))
    else:
        checks.append(check('backend_revision', 'PASS', 'running %s from %s' % (r['head'][:12], DEPLOYED)))

    e = facts.get('enginehost')
    if not e or not e.get('exe_sha256') or not e.get('worker_sha256') or not e.get('worker_expected_sha256'):
        checks.append(check('enginehost_worker', 'UNVERIFIED', 'EngineHost or worker hash unavailable'))
    elif e['exe_sha256'] != PINS['enginehost_sha256']:
        checks.append(check('enginehost_worker', 'BLOCKED', 'EngineHost executable hash changed'))
    elif e['worker_sha256'] != e['worker_expected_sha256']:
        checks.append(check('enginehost_worker', 'BLOCKED', 'installed worker differs from deployed revision'))
    else:
        checks.append(check('enginehost_worker', 'PASS', 'signed EngineHost and worker match pins'))

    a = facts.get('ancestry')
    if not a or a.get('listener_pids') is None:
        checks.append(check('process_ancestry', 'UNVERIFIED', 'listener facts unavailable'))
    elif len(a['listener_pids']) != 1:
        checks.append(check('process_ancestry', 'BLOCKED', 'expected exactly one 31337 listener, found %s' % a['listener_pids']))
    else:
        chain = a.get('chain') or []
        ok = (len(chain) >= 3 and chain[0]['command'].startswith(PINS['node_path'])
              and 'engine-worker.py' in chain[1]['command'] and chain[2]['command'] == PINS['enginehost_path']
              and chain[2]['ppid'] == 1 and all(x.get('uid') == 503 for x in chain[:3]))
        checks.append(check('process_ancestry', 'PASS' if ok else 'BLOCKED',
                            'node -> engine-worker.py -> EngineHost -> launchd' if ok
                            else 'listener is not a pinned-Node child of the EngineHost worker'))

    au = facts.get('authority')
    if not au:
        checks.append(check('restart_authority', 'UNVERIFIED', 'authority facts missing'))
        checks.append(check('legacy_agent', 'UNVERIFIED', 'authority facts missing'))
    else:
        owners = []
        if au.get('mode_file_regular') and au.get('mode_content') == 'production':
            owners.append('engine-worker')
        if au.get('legacy_loaded'):
            owners.append(PINS['legacy_label'])
        if au.get('legacy_disabled') is False:
            owners.append(PINS['legacy_label'] + ' (enabled)')
        pid = (a or {}).get('listener_pids') or [None]
        if len(owners) > 1 or (owners and owners[0] != 'engine-worker'):
            checks.append(check('restart_authority', 'BLOCKED', 'more than one restart owner: %s' % ', '.join(owners)))
        elif not owners:
            checks.append(check('restart_authority', 'BLOCKED', 'worker supervision mode is not production'))
        elif au.get('supervisor_pid') is None:
            checks.append(check('restart_authority', 'UNVERIFIED', 'worker backend-status unavailable'))
        elif au.get('supervisor_pid') != pid[0]:
            checks.append(check('restart_authority', 'BLOCKED', 'supervisor pid %s != listener %s' % (au.get('supervisor_pid'), pid[0])))
        else:
            checks.append(check('restart_authority', 'PASS', 'single owner: EngineHost worker (%s)' % au.get('supervisor_state')))
        if au.get('legacy_disabled') is None or au.get('legacy_loaded') is None:
            checks.append(check('legacy_agent', 'UNVERIFIED', 'launchd state unavailable'))
        elif au['legacy_disabled'] and not au['legacy_loaded']:
            checks.append(check('legacy_agent', 'PASS', '%s disabled and not loaded' % PINS['legacy_label']))
        else:
            checks.append(check('legacy_agent', 'BLOCKED', '%s enabled or loaded' % PINS['legacy_label']))

    w = facts.get('wc2tb')
    if not w or w.get('mounted') is None:
        checks.append(check('wc2tb_access', 'UNVERIFIED', 'mount facts missing'))
    elif not w['mounted']:
        checks.append(check('wc2tb_access', 'BLOCKED', 'WC2TB is not mounted'))
    elif w.get('volume_uuid') != PINS['wc2tb_volume_uuid']:
        checks.append(check('wc2tb_access', 'BLOCKED' if w.get('volume_uuid') else 'UNVERIFIED',
                            'mounted volume identity %r is not the pinned WC2TB' % w.get('volume_uuid')))
    elif w.get('backend_storage_mode') is None:
        checks.append(check('wc2tb_access', 'UNVERIFIED', 'mounted, but no worker-lineage access evidence (mount alone proves nothing)'))
    elif w['backend_storage_mode'] != 'external' or w.get('backend_external_available') is not True:
        checks.append(check('wc2tb_access', 'BLOCKED', 'worker-lineage backend cannot read WC2TB (storage mode %s)' % w['backend_storage_mode']))
    else:
        checks.append(check('wc2tb_access', 'PASS', 'pinned volume; EngineHost-descended backend selected external storage'))

    d = facts.get('disk')
    if not d or d.get('free_bytes') is None:
        checks.append(check('disk_reserve', 'UNVERIFIED', 'shared-disk facts missing'))
    elif d.get('same_device') is False:
        checks.append(check('disk_reserve', 'BLOCKED', 'publication staging is not on the Big Mac internal device'))
    else:
        cap = batch_capacity(d['free_bytes'])
        free_mib = d['free_bytes'] // MIB
        if cap == 0:
            checks.append(check('disk_reserve', 'BLOCKED', '%d MiB free < one-image reserve %d MiB' % (free_mib, disk_reserve_bytes(1) // MIB)))
        else:
            checks.append(check('disk_reserve', 'PASS', '%d MiB free; batch capacity %d image(s)%s'
                                % (free_mib, cap, '' if cap == 16 else ' (below full 16-image reserve %d MiB)' % (disk_reserve_bytes(16) // MIB))))

    pub = facts.get('publication')
    if not pub or pub.get('jobs_active') is None or pub.get('pending') is None or pub.get('lease_owner') == 'unknown':
        checks.append(check('publication_state', 'UNVERIFIED', 'jobs/resources/publication status unavailable'))
        checks.append(check('macbook_ack', 'UNVERIFIED', 'publication status unavailable'))
    else:
        busy = pub['jobs_active'] or pub.get('lease_owner') or pub.get('lease_waiting') or pub.get('quarantine')
        if busy and release:
            checks.append(check('publication_state', 'BLOCKED', 'active jobs, lease or quarantine present; not idle'))
        else:
            checks.append(check('publication_state', 'PASS', 'idle' if not busy else 'active work present (inspect mode)'))
        if pub.get('enabled') is not True:
            checks.append(check('macbook_ack', 'BLOCKED', 'cross-host publication is disabled (internal fallback?)'))
        elif pub['pending'] and release:
            checks.append(check('macbook_ack', 'BLOCKED', '%d publication(s) awaiting MacBook acknowledgment' % pub['pending']))
        elif pub['pending']:
            checks.append(check('macbook_ack', 'UNVERIFIED', '%d publication(s) awaiting acknowledgment' % pub['pending']))
        else:
            checks.append(check('macbook_ack', 'PASS', 'no publication awaiting MacBook acknowledgment'))

    rb = facts.get('rollback')
    if not rb:
        checks.append(check('rollback', 'UNVERIFIED', 'rollback facts missing'))
    elif rb.get('source_commit') != PINS['rollback_source_commit'] or rb.get('starter_sha256') != PINS['rollback_starter_sha256']:
        checks.append(check('rollback', 'BLOCKED', 'versioned rollback v1 package missing or altered'))
    else:
        dep = eval_deps('rollback', rb.get('deps'))
        checks.append(check('rollback', dep['status'], 'rollback v1 c7708e4 package intact; ' + dep['detail']
                            + ' (package integrity only: not proof that a production rollback works)'))

    h = facts.get('handoff')
    journal = (h or {}).get('journal')
    proven = production_round_trip_proven(journal)
    if not h or h.get('installed_supports') is None or journal is None:
        capability = check('handoff_capability', 'UNVERIFIED', 'installed worker, deployed supervisor or handoff journal unreadable')
    elif not h['installed_supports']:
        capability = check('handoff_capability', 'BLOCKED', 'deployed EngineHost worker has no owner-authorized handoff '
                           '(backend-pause is rehearsal-only): the v1 package cannot take over port 31337')
    elif journal.get('state') not in ('ABSENT', 'RUNNING_EXTERNAL'):
        capability = check('handoff_capability', 'BLOCKED', 'handoff journal is %s (%s)' % (journal.get('state'), journal.get('failure')))
    else:
        capability = check('handoff_capability', 'PASS', 'owner-authorized handoff installed; journal %s' % journal.get('state'))
    checks.append(capability)
    if proven:
        checks.append(check('rollback_activation_proof', 'PASS', 'production fallback and return recorded in the owner journal'))
    else:
        checks.append(check('rollback_activation_proof', 'UNVERIFIED', 'no production-to-fallback-to-production transition has '
                            'been demonstrated on this hardware; source tests are not proof'))
    if capability['status'] != 'PASS':
        checks.append(check('return_to_external', capability['status'], 'return path depends on the owner handoff: ' + capability['detail']))
    elif proven:
        checks.append(check('return_to_external', 'PASS', 'owner return to external supervision recorded in production'))
    else:
        checks.append(check('return_to_external', 'UNVERIFIED', 'owner return implemented but never demonstrated in production'))

    v = facts.get('validation_python')
    if not v:
        checks.append(check('image_validation_python', 'UNVERIFIED', 'validation interpreter facts missing'))
    elif not v.get('pillow'):
        checks.append(check('image_validation_python', 'BLOCKED',
                            'PREREQUISITE MISSING: Pillow is not importable by %s' % v.get('path')))
    else:
        checks.append(check('image_validation_python', 'PASS', 'Pillow importable'))

    if release:
        t = facts.get('target') or facts.get('revision') or {}
        if not expect_revision:
            checks.append(check('release_target', 'UNVERIFIED', 'release-readiness requires --expect-revision'))
        elif not t.get('head'):
            checks.append(check('release_target', 'UNVERIFIED', 'target worktree HEAD unavailable'))
        elif t['head'] != expect_revision or t.get('clean') is not True:
            checks.append(check('release_target', 'BLOCKED', 'target %s (clean=%s) is not the expected revision %s'
                                % (t['head'][:12], t.get('clean'), expect_revision[:12])))
        else:
            checks.append(check('release_target', 'PASS', 'target worktree at %s and clean' % expect_revision[:12]))
        if facts.get('target'):
            checks.append(eval_deps('release_target_dependencies', facts['target'].get('deps')))
        if capability['status'] == 'PASS' and proven:
            checks.append(check('recovery_plan', 'PASS', 'owner handoff installed and production round trip demonstrated'))
        elif capability['status'] in ('PASS', 'UNVERIFIED') or (h or {}).get('target_supports'):
            checks.append(check('recovery_plan', 'UNVERIFIED', 'owner handoff is unproven (not installed, unverifiable, or never '
                                'demonstrated live): not yet a proven recovery plan'))
        else:
            checks.append(check('recovery_plan', 'BLOCKED', 'no owner-authorized production rollback path: a package checksum '
                                'is not a recovery plan'))

    statuses = {c['status'] for c in checks}
    verdict = 'BLOCKED' if 'BLOCKED' in statuses else 'UNVERIFIED' if 'UNVERIFIED' in statuses else 'PASS'
    by_id = {c['id']: c['status'] for c in checks}
    sections = {}
    for name, members in SECTIONS.items():
        found = {by_id[m] for m in members if m in by_id}
        sections[name] = 'BLOCKED' if 'BLOCKED' in found else 'UNVERIFIED' if 'UNVERIFIED' in found or not found else 'PASS'
    return {'tool': 'wc2tb-release-doctor', 'schema': 2, 'mode': 'release-readiness' if release else 'inspect',
            'verdict': verdict, 'sections': sections, 'checks': checks}


def main(argv=None):
    parser = argparse.ArgumentParser(description='Read-only WC2TB release doctor.')
    parser.add_argument('--release-readiness', action='store_true', help='fail-closed cutover preflight')
    parser.add_argument('--expect-revision', help='full commit the cutover will run')
    parser.add_argument('--target-worktree', help='worktree holding the revision to cut over to')
    parser.add_argument('--facts', help='evaluate recorded facts JSON instead of probing (fixture; never authorizes)')
    parser.add_argument('--dump-facts', action='store_true', help='include the collected facts in the output')
    args = parser.parse_args(argv)
    if args.expect_revision and (len(args.expect_revision) != 40 or any(c not in '0123456789abcdef' for c in args.expect_revision)):
        parser.error('--expect-revision must be a full 40-character lowercase commit id')
    if args.facts:
        with open(args.facts, encoding='utf-8') as handle:
            facts = json.load(handle)
    else:
        facts = collect(args.target_worktree)
    report = evaluate(facts, release=args.release_readiness, expect_revision=args.expect_revision)
    report['fixture'] = bool(args.facts)
    report['checked_at'] = datetime.datetime.now(datetime.timezone.utc).isoformat(timespec='seconds')
    if args.dump_facts:
        report['facts'] = facts
    print(json.dumps(report, indent=2, sort_keys=True))
    return {'PASS': 0, 'BLOCKED': 1, 'UNVERIFIED': 3}[report['verdict']]


if __name__ == '__main__':
    sys.exit(main())
