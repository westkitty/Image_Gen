'use strict';

// P13: scoped remote cancellation. The ssh transport is replaced by a local stub that runs the piped script, so the
// real process-matching logic of bin/sdcpp-remote-cancel.sh is exercised against real decoy processes.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');
const { spawn, execFile } = require('node:child_process');

const ROOT = path.join(__dirname, '..', '..');
const SCRIPT = path.join(ROOT, 'sdcpp-workflow', 'bin', 'sdcpp-remote-cancel.sh');
const SERVER = fs.readFileSync(path.join(__dirname, '..', 'server.js'), 'utf8');

function stubSshDir() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'fakessh-'));
  // ssh [options] host command  -> run the command locally with our stdin
  fs.writeFileSync(path.join(dir, 'ssh'), '#!/bin/bash\nfor last; do :; done\nexec bash -c "$last"\n', { mode: 0o755 });
  return dir;
}
const alive = pid => { try { process.kill(pid, 0); return true; } catch (_) { return false; } };
const sleeper = (marker, ignoreTerm) => spawn('python3', ['-c', (ignoreTerm ? 'import signal;signal.signal(signal.SIGTERM,signal.SIG_IGN)\n' : '') + 'import time;time.sleep(300)', marker], { stdio: 'ignore', detached: true });
// async on purpose: a blocked event loop would stop node reaping the killed decoys, which would linger as zombies
const run = (dir, runId) => new Promise(resolve => execFile(SCRIPT, ['--run-id', runId], { env: { ...process.env, PATH: dir + ':' + process.env.PATH }, encoding: 'utf8', timeout: 30000 }, (err, stdout, stderr) => resolve({ status: err ? (err.code === undefined ? 1 : err.code) : 0, stdout, stderr })));
const wait = ms => new Promise(r => setTimeout(r, ms));

test('only the processes of the named run are stopped; a TERM-ignoring one is escalated; others are untouched', async () => {
  const dir = stubSshDir();
  const A = '20261016-111111-controlled-testrun-a', B = '20261016-222222-controlled-testrun-b';
  const a1 = sleeper('/out/' + A + '/controlled.png'), a2 = sleeper('/out/' + A + '/x.log', true), b = sleeper('/out/' + B + '/controlled.png');
  await wait(600);
  try {
    assert.ok(alive(a1.pid) && alive(a2.pid) && alive(b.pid));
    const r = await run(dir, A);
    assert.equal(r.status, 0, r.stdout + r.stderr);
    assert.match(r.stdout, /REMOTE_CANCEL: found=2 killed=2 left=0/);
    await wait(300);
    assert.equal(alive(a1.pid), false); assert.equal(alive(a2.pid), false, 'SIGKILL escalation');
    assert.equal(alive(b.pid), true, 'a different run is never touched');
    const again = await run(dir, A);
    assert.equal(again.status, 0); assert.match(again.stdout, /found=0 killed=0 left=0/);
  } finally { for (const p of [a1, a2, b]) try { process.kill(p.pid, 'SIGKILL'); } catch (_) {} fs.rmSync(dir, { recursive: true, force: true }); }
});

test('children of a matched process are stopped even though their own argv has no run id; siblings are not', async () => {
  const dir = stubSshDir();
  const A = '20261016-333333-controlled-testrun-c';
  // wrapper carries the run id (like "bash -c ... dexdiffusion-mflux-<id>"), its child python does not
  const pidBase = path.join(dir, A);
  const wrapper = spawn('bash', ['-c', 'python3 -c "import time;time.sleep(300)" & echo $! > "$0.pid"; wait', pidBase], { stdio: 'ignore', detached: true });
  const sibling = sleeper('unrelated-marker-xyz');
  await wait(900);
  try {
    const childPid = Number(fs.readFileSync(pidBase + '.pid', 'utf8').trim());
    assert.ok(alive(childPid));
    const r = await run(dir, A);
    assert.equal(r.status, 0, r.stdout + r.stderr);
    await wait(300);
    assert.equal(alive(childPid), false, 'child without the run id in its argv is stopped');
    assert.equal(alive(sibling.pid), true, 'an unrelated process is untouched');
  } finally { for (const p of [wrapper, sibling]) try { process.kill(p.pid, 'SIGKILL'); } catch (_) {} fs.rmSync(dir, { recursive: true, force: true }); }
});

test('the MFLUX wrapper label form matches, but a longer run id that starts with the same text does not', async () => {
  const dir = stubSshDir();
  const A = '20261016-444444-controlled-testrun-d';
  const label = sleeper('dexdiffusion-mflux-' + A);           // how the MFLUX wrapper is named on Big Mac
  const longer = sleeper('/out/' + A + '-extra/controlled.png');  // a different run whose id merely starts with A
  await wait(600);
  try {
    const r = await run(dir, A);
    assert.equal(r.status, 0, r.stdout + r.stderr);
    assert.match(r.stdout, /found=\d+ killed=\d+ left=0/);
    await wait(300);
    assert.equal(alive(label.pid), false, 'dexdiffusion-mflux-<id> is matched (a regression once broke this form)');
    assert.equal(alive(longer.pid), true, 'a longer id is never matched');
  } finally { for (const p of [label, longer]) try { process.kill(p.pid, 'SIGKILL'); } catch (_) {} fs.rmSync(dir, { recursive: true, force: true }); }
});

test('the MFLUX remote wrappers stop their generator on HUP at once (a foreground child would defer the trap)', async () => {
  for (const script of ['mflux-remote-generate.sh', 'mflux-remote-edit.sh']) {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'mfw-'));
    const pidFile = path.join(dir, 'gen.pid');
    const fake = path.join(dir, 'fake-mflux');
    fs.writeFileSync(fake, `#!/bin/bash\necho $$ > "${pidFile}"\nexec sleep 30\n`, { mode: 0o755 });
    const ref = path.join(dir, 'in.bin'); fs.writeFileSync(ref, 'ref');
    const sha = require('node:crypto').createHash('sha256').update('ref').digest('hex');
    const b64 = Buffer.from('p').toString('base64');
    const args = script.includes('edit') ? [b64, '4', '1', '512', '512', dir, fake, sha] : [b64, '4', '1', '512', '512', dir, fake];
    const child = spawn('bash', [path.join(ROOT, 'sdcpp-workflow', 'bin', script), ...args], { stdio: [fs.openSync(ref, 'r'), 'ignore', 'ignore'], env: { ...process.env, TMPDIR: dir } });
    for (let i = 0; i < 50 && !fs.existsSync(pidFile); i++) await wait(100);
    assert.ok(fs.existsSync(pidFile), script + ': the fake generator started');
    const gen = Number(fs.readFileSync(pidFile, 'utf8').trim());
    assert.ok(alive(gen));
    const t0 = Date.now();
    child.kill('SIGHUP');
    for (let i = 0; i < 40 && alive(gen); i++) await wait(100);
    assert.equal(alive(gen), false, script + ': the generator is stopped when the wrapper is hung up');
    assert.ok(Date.now() - t0 < 4000, 'within seconds, not after the generator would have finished');
    try { process.kill(gen, 'SIGKILL'); } catch (_) {}
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('malformed run ids are refused before anything is sent', async () => {
  const dir = stubSshDir();
  for (const bad of ['', 'x', '20261016-111111', 'a; rm -rf ~', '20261016-111111-$(id)', '../20261016-111111-x']) {
    const r = await run(dir, bad);
    assert.notEqual(r.status, 0, bad);
    assert.match(r.stdout + r.stderr, /run id must look like|requires a value/, bad);
  }
  fs.rmSync(dir, { recursive: true, force: true });
});

test('server contract (OP-7): only verified evidence releases compute; no timer, no "ok but unverified" release', () => {
  assert.match(SERVER, /async function stopAndVerify\(job, why\)/);
  assert.match(SERVER, /const imageActive = img && \(\['queued', 'running'\]\.includes\(img\.status\) \|\| holdsLease\(img\)\)/, 'the sweeper keeps the lease while a remote process is unconfirmed');
  const sync = SERVER.slice(SERVER.indexOf('function syncGenericTerminal'), SERVER.indexOf('function syncGenericTerminal') + 3800);
  assert.equal((sync.match(/if \(!holdsLease\(job\)\) arbiter\.release\(job\.id\)/g) || []).length, 2, 'both release sites honour the hold');
  assert.doesNotMatch(SERVER, /REMOTE_ORPHAN_HOLD_MS/, 'elapsed time must never release a protected lease');
  assert.match(SERVER, /function holdsLease\(job\) \{ return !!\(job && \(remoteWorkers\.isQuarantined\(job\.id\)/);
  assert.match(SERVER, /quarantineCheck: \(\) => publicationRecoveryState\.blocked \? '[^']+' : remoteWorkers\.quarantineReason\(\)/, 'the arbiter honors both recovery and remote-stop quarantine');
  assert.match(SERVER, /remote_stop: 'unverified', quarantine: true, gate: 'remote-stop-unverified'/);
  assert.match(SERVER, /remote_stop: 'verified'/);
  assert.match(SERVER, /gate: 'cancel-in-progress'/, 'a second Cancel cannot release the lease while the first is verifying');
  assert.match(SERVER, /job\.childPid = child\.pid/);
  // the cancel route releases the lease only on the verified branch
  const route = SERVER.slice(SERVER.indexOf("app.post('/api/jobs/:id/cancel'"), SERVER.indexOf("app.get('/api/remote-workers'"));
  const verifiedBranch = route.slice(route.indexOf('if (out.verified) {'), route.indexOf("remote_stop: 'verified'"));
  assert.equal((route.match(/arbiter\.release\(jobId\)/g) || []).length, 4, 'released only when never started, remotely verified, or a successful natural completion won the race');
  assert.match(verifiedBranch, /arbiter\.release\(jobId\)/);
  const activeCancel = route.slice(route.indexOf("if (job && (job.status === 'running'"));
  assert.ok(activeCancel.indexOf('requestPublicationCancellation') < activeCancel.indexOf("job.status = 'CANCELLED'"),
    'the running job remains eligible to finalize until stop and completion race are resolved');
  assert.match(activeCancel, /remote_stop: 'completed_naturally'/, 'a successful finalization wins the racing cancellation');
  assert.match(SERVER, /if \(job\.cancelInFlight && job\.status !== 'PASS' && job\.status !== 'PARTIAL'\) return;/,
    'signal-induced local failure is deferred until the cancel route persists its terminal state');
  assert.match(SERVER, /successfulPassAfterCancelSignal\(\{[\s\S]{0,180}cancelInFlight: job\.cancelInFlight/,
    'a pass marker plus successful remote cleanup can beat a local signal delivered after completion');
  assert.match(SERVER, /if \(job\.cancelInFlight && code !== 0 && !completedBeforeCancelSignal\) \{[\s\S]{0,240}cleanupJobTempFiles\(job\);\s+return;/,
    'a verified cancel exit is not persisted as a capability failure');
  assert.match(activeCancel, /if \(childClosed\) await childClosed/,
    'the cancel decision awaits the actual child close event before terminalizing');
  assert.match(SERVER, /publicationWon = decision\.decision === 'publish'/,
    'an already claimed publication is allowed to drain before cancellation terminalizes');
  const mflux = fs.readFileSync(path.join(ROOT, 'sdcpp-workflow', 'bin', 'mflux-controlled-generate.sh'), 'utf8');
  assert.match(mflux, /dexdiffusion-mflux-\$RUN_ID/);
});

test('edit/upscale/hires scripts carry the run id on the remote command line and the server cancels them remotely', () => {
  const bin = name => fs.readFileSync(path.join(ROOT, 'sdcpp-workflow', 'bin', name), 'utf8');
  for (const f of ['sdcpp-img2img.sh', 'sdcpp-inpaint.sh', 'sdcpp-esrgan-upscale.sh']) {
    const s = bin(f);
    assert.match(s, /echo "SDCPP_RUN_ID: \$\(basename "\$RUN_DIR"\)"/, f + ' announces its run id');
    assert.match(s, /RUN_TAG="\$\(basename "\$RUN_DIR"\)"/, f + ' derives the tag from the run dir');
    assert.match(s, /REMOTE_(PNG|OUTPUT)="[^"]*\$\{RUN_TAG\}/, f + ' puts the run id in the remote -o path');
    assert.doesNotMatch(s, /REMOTE_(PNG|OUTPUT|INIT_IMG|MASK_IMG|INPUT)="\$REMOTE_OUTPUT_DIR\/\$\{NAME\}(?!-\$\{RUN_TAG\})[-.]/, f + ' has a remote name without the run id');
  }
  const cli = bin('sdcpp-cli-generate.sh');
  assert.match(cli, /RUN_TAG="\$\{SDCPP_REMOTE_RUN_TAG:-\$\(basename "\$RUN_DIR"\)\}"/);
  assert.match(cli, /REMOTE_PNG="\$REMOTE_OUTPUT_DIR\/\$\{NAME\}-\$\{RUN_TAG\}\.png"/);
  const hires = bin('sdcpp-hires-fix.sh');
  assert.match(hires, /echo "SDCPP_RUN_ID: \$HIRES_RUN_ID"/);
  assert.match(hires, /export SDCPP_REMOTE_RUN_TAG="\$HIRES_RUN_ID"/);
  const m = /const REMOTE_CANCEL_ACTIONS = new Set\(\[([^\]]*)\]\)/.exec(SERVER);
  assert.ok(m, 'REMOTE_CANCEL_ACTIONS found');
  for (const a of ['controlled-generate', 'img2img', 'inpaint', 'outpaint', 'upscale-esrgan', 'hires-fix']) assert.ok(m[1].includes("'" + a + "'"), a + ' is remote-cancellable');
});
