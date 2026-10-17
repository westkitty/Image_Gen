'use strict';
// OP-7 acceptance: verified remote cancellation, compute quarantine and restart reconciliation.
// Script-level tests run bin/sdcpp-remote-cancel.sh through a stub ssh against REAL decoy processes; registry and
// reconciler tests inject deterministic failures (unreachable host, survivors, late run ids, restarts).
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');
const { spawn, execFile } = require('node:child_process');
const RW = require('../remote-workers');
const M = require('../media');

const ROOT = path.join(__dirname, '..', '..');
const SCRIPT = path.join(ROOT, 'sdcpp-workflow', 'bin', 'sdcpp-remote-cancel.sh');

function stubSshDir(failing) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'fakessh-op7-'));
  fs.writeFileSync(path.join(dir, 'ssh'), failing ? '#!/bin/bash\necho "ssh: connect to host westcat: Operation timed out" >&2\nexit 255\n'
    : '#!/bin/bash\nfor last; do :; done\nexec bash -c "$last"\n', { mode: 0o755 });
  return dir;
}
const alive = pid => { try { process.kill(pid, 0); return true; } catch (_) { return false; } };
// A decoy whose command line ends in /sd-server, like the real staging binary.
const sdServerDecoy = dir => { const f = path.join(dir, 'sd-server'); fs.writeFileSync(f, '#!/bin/bash\nexec -a "$0" sleep 300\n', { mode: 0o755 }); return spawn(f, [], { stdio: 'ignore', detached: true }); };
const sleeper = marker => spawn('python3', ['-c', 'import time;time.sleep(300)', marker], { stdio: 'ignore', detached: true });
const run = (dir, args) => new Promise(resolve => execFile(SCRIPT, args, { env: { ...process.env, PATH: dir + ':' + process.env.PATH }, encoding: 'utf8', timeout: 30000 }, (err, stdout, stderr) => resolve({ status: err ? (err.code === undefined ? 1 : err.code) : 0, stdout, stderr })));
const wait = ms => new Promise(r => setTimeout(r, ms));

test('check-only counts exactly one run\'s live processes and signals nothing', async () => {
  const dir = stubSshDir();
  const A = '20261017-101010-op7-check-a', B = '20261017-202020-op7-check-b';
  const a1 = sleeper('/x/sdcpp-staging/outputs/img-' + A + '.png'), a2 = sleeper('/x/' + A + '/y.log'), b = sleeper('/x/sdcpp-staging/outputs/img-' + B + '.png');
  await wait(600);
  try {
    const r = await run(dir, ['--check-only', '--run-id', A]);
    assert.equal(r.status, 0, r.stdout + r.stderr);
    assert.match(r.stdout, new RegExp('REMOTE_CHECK: run=' + A + ' alive=2'));
    const rb = await run(dir, ['--check-only', '--run-id', B]);
    assert.match(rb.stdout, /alive=1/);
    assert.ok(alive(a1.pid) && alive(a2.pid) && alive(b.pid), 'a liveness check never signals anything');
  } finally { for (const p of [a1, a2, b]) try { process.kill(p.pid, 'SIGKILL'); } catch (_) {} fs.rmSync(dir, { recursive: true, force: true }); }
});

test('scan-owned lists DexDiffusion run ids (sd-cli staging paths and MFLUX labels) and counts sd-server, touching nothing', async () => {
  const dir = stubSshDir();
  const A = '20261017-111111-op7-scan-a', B = '20261017-121212-op7-scan-b';
  const a = sleeper('/Users/bigmac/sdcpp-staging/outputs/cli-' + A + '.png'), b = sleeper('dexdiffusion-mflux-' + B), other = sleeper('/tmp/unrelated-20261017-131313-x.png');
  const srv = sdServerDecoy(dir);
  await wait(700);
  try {
    const r = await run(dir, ['--scan-owned']);
    assert.equal(r.status, 0, r.stdout + r.stderr);
    assert.match(r.stdout, new RegExp('REMOTE_OWNED: run=' + A));
    assert.match(r.stdout, new RegExp('REMOTE_OWNED: run=' + B));
    assert.doesNotMatch(r.stdout, /unrelated-20261017-131313/, 'paths outside the staging tree are not claimed as owned');
    assert.match(r.stdout, /REMOTE_SDSERVER: running=[1-9]/);
    assert.match(r.stdout, /REMOTE_SCAN: done/);
    assert.ok([a, b, other, srv].every(p => alive(p.pid)), 'the scan signals nothing');
  } finally { for (const p of [a, b, other, srv]) try { process.kill(p.pid, 'SIGKILL'); } catch (_) {} fs.rmSync(dir, { recursive: true, force: true }); }
});

test('an unreachable Big Mac is a failure with no result line: SSH failure can never masquerade as "nothing alive"', async () => {
  const dir = stubSshDir(true);
  try {
    for (const args of [['--check-only', '--run-id', '20261017-141414-op7-x'], ['--scan-owned'], ['--run-id', '20261017-141414-op7-x']]) {
      const r = await run(dir, args);
      assert.notEqual(r.status, 0, args.join(' '));
      assert.doesNotMatch(r.stdout, /REMOTE_CHECK:|REMOTE_SCAN: done|left=0/, args.join(' '));
    }
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

// ── registry + reconciler (deterministic failure injection) ─────────────────────────────────────────
function fakeRemote() {
  const live = new Map();   // runId -> alive count
  const calls = [];
  let down = false, sdServer = 0;
  return {
    live, calls, setDown: v => { down = v; }, setSdServer: n => { sdServer = n; },
    checkRun: async id => { calls.push(['check', id]); if (down) throw new Error('ssh: Operation timed out'); return { alive: live.get(id) || 0 }; },
    stopRun: async id => { calls.push(['stop', id]); if (down) throw new Error('ssh: Operation timed out'); const n = live.get(id) || 0; live.set(id, 0); return { found: n, left: 0 }; },
    scanOwned: async () => { calls.push(['scan']); if (down) throw new Error('ssh: Operation timed out'); return { runs: [...live].filter(([, n]) => n > 0).map(([id]) => id), sdServer }; },
  };
}
const tmpFile = () => path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'op7-reg-')), 'remote-workers.json');
const A = '20261017-151515-controlled-a', B = '20261017-161616-controlled-b';

test('stopping job A never touches job B; reconciliation releases only after proof', async () => {
  const reg = RW.createRemoteWorkerRegistry({ file: tmpFile() }), fx = fakeRemote();
  fx.live.set(A, 2); fx.live.set(B, 1);
  reg.start('job-a', { action: 'controlled-generate', kind: 'per-run' }); reg.addRun('job-a', A);
  reg.start('job-b', { action: 'controlled-generate', kind: 'per-run' }); reg.addRun('job-b', B);
  reg.cancelRequested('job-a');
  const rec = RW.createReconciler({ registry: reg, ...fx });
  await rec.tick();
  assert.equal(reg.get('job-a').state, 'stop_pending', 'a stop was sent; nothing is verified yet');
  assert.ok(fx.calls.every(c => c[1] !== B), 'no call ever names job B\'s run');
  assert.equal(fx.live.get(B), 1, 'job B still runs');
  await rec.tick();
  assert.equal(reg.get('job-a').state, 'cancelled_verified');
  assert.match(reg.get('job-a').evidence.at(-1).detail, /0 processes alive/);
  assert.equal(reg.get('job-b').state, 'running');
});

test('unreachable host: the record stays quarantined (never verified), and the quarantine blocks the arbiter', async () => {
  const reg = RW.createRemoteWorkerRegistry({ file: tmpFile() }), fx = fakeRemote();
  fx.live.set(A, 1); fx.setDown(true);
  reg.start('job-a', { action: 'img2img', kind: 'per-run' }); reg.addRun('job-a', A); reg.cancelRequested('job-a');
  await RW.createReconciler({ registry: reg, ...fx }).tick();
  assert.equal(reg.get('job-a').state, 'stop_unverified');
  assert.ok(reg.get('job-a').evidence.some(e => e.kind === 'reconcile-error' && /timed out/.test(e.detail)));
  const arb = M.createResourceArbiter({ quarantineCheck: () => reg.quarantineReason() });
  let granted = false; arb.acquire('job-new').then(r => { granted = r.granted; });
  await wait(20);
  assert.equal(granted, false, 'no heavy grant while a stop is unverified');
  assert.match(arb.state().blocked_reason, /remote stop not verified/);
  fx.setDown(false);
  await RW.createReconciler({ registry: reg, ...fx }).tick();   // reconnect: stop re-sent
  await RW.createReconciler({ registry: reg, ...fx }).tick();   // liveness check proves it
  assert.equal(reg.get('job-a').state, 'cancelled_verified');
  arb.poke(); await wait(20);
  assert.equal(granted, true, 'the waiting job starts only after proof');
});

test('time is not evidence: an old quarantine is still a quarantine; only a check or an explicit labelled release ends it', async () => {
  let t = 1000; const reg = RW.createRemoteWorkerRegistry({ file: tmpFile(), now: () => t });
  reg.start('job-x', { action: 'xyz-plot', kind: 'shared-server' }); reg.cancelRequested('job-x'); reg.unverified('job-x', 'shared server');
  t += 7 * 24 * 3600e3;
  assert.equal(reg.isQuarantined('job-x'), true);
  assert.match(reg.quarantineReason(), /xyz-plot/);
  const fx = fakeRemote(); fx.setSdServer(1);
  await RW.createReconciler({ registry: reg, ...fx }).tick();
  assert.equal(reg.get('job-x').state, 'stop_unverified', 'shared sd-server still up: cannot be proven');
  const r = reg.operatorRelease('job-x', 'operator accepted the risk');
  assert.equal(r.state, 'released_by_operator', 'an explicit release is labelled, never "verified"');
  assert.equal(reg.quarantineReason(), null);
});

test('shared-server request: verified once the scan shows no sd-server; "unknown" needs no owned work at all', async () => {
  const reg = RW.createRemoteWorkerRegistry({ file: tmpFile() }), fx = fakeRemote();
  reg.start('s', { action: 'server-generate', kind: 'shared-server' }); reg.cancelRequested('s');
  reg.start('u', { action: 'seed-test', kind: 'unknown' }); reg.cancelRequested('u');
  fx.setSdServer(0); fx.live.set(B, 1);
  await RW.createReconciler({ registry: reg, ...fx }).tick();
  assert.equal(reg.get('s').state, 'cancelled_verified');
  assert.equal(reg.get('u').state, 'stop_unverified', 'other DexDiffusion work is visible and cannot be attributed');
  fx.live.set(B, 0);
  await RW.createReconciler({ registry: reg, ...fx }).tick();
  assert.equal(reg.get('u').state, 'cancelled_verified');
});

test('console restart: running and stopping records survive on disk, are quarantined, and are reconciled', async () => {
  const file = tmpFile();
  const reg1 = RW.createRemoteWorkerRegistry({ file });
  reg1.start('j1', { action: 'controlled-generate', kind: 'per-run' }); reg1.addRun('j1', A);
  reg1.start('j2', { action: 'xyz-plot', kind: 'shared-server' }); reg1.cancelRequested('j2'); reg1.unverified('j2', 'shared');
  reg1.start('j3', { action: 'img2img', kind: 'per-run' }); reg1.finished('j3', 'PASS');
  const reg2 = RW.createRemoteWorkerRegistry({ file });            // a new console process
  const adopted = reg2.adoptAfterRestart();
  assert.deepEqual(adopted.map(r => r.job_id).sort(), ['j1', 'j2']);
  assert.equal(reg2.get('j1').state, 'orphan_suspect'); assert.equal(reg2.get('j2').state, 'stop_unverified'); assert.equal(reg2.get('j3').state, 'completed');
  const fx = fakeRemote(); fx.live.set(A, 1); fx.setSdServer(1);
  const rec = RW.createReconciler({ registry: reg2, ...fx });
  await rec.tick(); await rec.tick();
  assert.equal(reg2.get('j1').state, 'cancelled_verified', 'the orphan of the dead console was stopped by its run id and verified');
  assert.equal(reg2.get('j2').state, 'stop_unverified', 'still unprovable; quarantine carried over the restart');
  assert.equal(RW.createRemoteWorkerRegistry({ file }).isQuarantined('j2'), true, 'and is still on disk for the next restart');
});

test('successful completion wins a cancellation race without being mislabeled cancelled; failed local exit stays quarantined', async () => {
  const reg = RW.createRemoteWorkerRegistry({ file: tmpFile() });
  reg.start('j', { action: 'inpaint', kind: 'per-run' }); reg.addRun('j', A);
  reg.cancelRequested('j'); reg.cancelRequested('j'); reg.cancelRequested('j');
  assert.equal(reg.get('j').evidence.filter(e => e.kind === 'cancel-requested').length, 1);
  reg.finished('j', 'PASS');
  assert.equal(reg.get('j').state, 'completed', 'a successful finalized result remains successful');
  assert.ok(reg.get('j').evidence.some(e => e.kind === 'completed-during-cancel'));
  reg.verified('j', 'late stop check');
  assert.equal(reg.get('j').state, 'completed', 'a late stop check cannot rewrite successful completion as cancellation');

  reg.start('failed', { action: 'inpaint', kind: 'per-run' }); reg.addRun('failed', B); reg.cancelRequested('failed'); reg.finished('failed', 'FAIL');
  assert.equal(reg.get('failed').state, 'cancel_requested', 'a failed local exit does not prove the remote stop');
  assert.ok(reg.get('failed').evidence.some(e => e.kind === 'local-exit-during-cancel'));
});

test('survivors are escalated, not released: after max stop attempts the record stays quarantined', async () => {
  const reg = RW.createRemoteWorkerRegistry({ file: tmpFile() }), fx = fakeRemote();
  const stubborn = { ...fx, stopRun: async id => ({ found: 1, left: 1 }) };   // TERM/KILL ineffective
  fx.live.set(A, 1);
  reg.start('j', { action: 'img2img', kind: 'per-run' }); reg.addRun('j', A); reg.cancelRequested('j');
  const rec = RW.createReconciler({ registry: reg, ...stubborn, maxStopAttempts: 3 });
  for (let i = 0; i < 6; i++) await rec.tick();
  assert.equal(reg.get('j').state, 'stop_unverified');
  assert.ok(reg.get('j').evidence.some(e => e.kind === 'still-alive'));
  assert.equal(reg.get('j').stop_attempts, 3);
});

test('run identity is the unique run id, not a pid: malformed ids are refused and pid reuse is irrelevant', () => {
  const reg = RW.createRemoteWorkerRegistry({ file: tmpFile() });
  reg.start('j', { action: 'img2img', kind: 'per-run' });
  for (const bad of ['12345', 'image-01', '20261017-151515', '20261017-151515-x;rm -rf ~']) reg.addRun('j', bad);
  assert.deepEqual(reg.get('j').run_ids, []);
  reg.addRun('j', A); reg.addRun('j', A);
  assert.deepEqual(reg.get('j').run_ids, [A]);
});

test('batch cells announce unique per-cell run tags; cli-generate announces its tag before remote generation', () => {
  const batch = fs.readFileSync(path.join(ROOT, 'sdcpp-workflow', 'bin', 'sdcpp-batch-generate.sh'), 'utf8');
  assert.match(batch, /cell_tag="\$\(basename "\$RUN_DIR"\)-image-\$idx"/);
  assert.match(batch, /SDCPP_REMOTE_RUN_TAG="\$cell_tag"/);
  const cli = fs.readFileSync(path.join(ROOT, 'sdcpp-workflow', 'bin', 'sdcpp-cli-generate.sh'), 'utf8');
  const announce = cli.indexOf("printf 'SDCPP_RUN_ID: %s\\n' \"$RUN_TAG\""), firstGen = cli.indexOf('ssh_remote', cli.indexOf('RUN_TAG='));
  assert.ok(announce > 0 && announce < firstGen, 'announced before the first remote command that uses the tag');
});
