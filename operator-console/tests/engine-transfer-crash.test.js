'use strict';
// Gate C black-box crash harness. Runs the REAL engine-worker.py (fake PIL engine,
// controllable clock) and the REAL bridge (bin/local-engine-generate.js) in a
// test-owned HOME under /tmp, injects faults at each transfer boundary, then
// performs what a console restart does and checks the end state.
//
// DEX_GATEC_IMPL_ROOT selects the implementation (default: this checkout). Point
// it at a pristine HEAD export to record the "before" failures with the same
// scenarios. Never reaches the network: DEX_LOCAL_ENGINE_DIRECT=1 forbids the SSH
// fallback, and no models, mounts or live services are touched.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const crypto = require('node:crypto');
const { spawn, spawnSync } = require('node:child_process');

const IMPL = path.resolve(process.env.DEX_GATEC_IMPL_ROOT || path.join(__dirname, '../..'));
const FIX = path.join(__dirname, 'fixtures/gatec');
const PY = '/usr/bin/python3';
const HAS_JOURNAL = fs.existsSync(path.join(IMPL, 'operator-console/engine-transfer-journal.js'));
const TARGET = 'sd15';
const PROMPT = 'gatec private prompt 7f3a';
const ENGINE = `#!${PY}
import os, sys, time
from PIL import Image
a = sys.argv
time.sleep(float(os.environ.get('GATEC_ENGINE_SLEEP', '0')))
out = a[a.index('-o') + 1]; w = int(a[a.index('-W') + 1]); h = int(a[a.index('-H') + 1])
n = int(a[a.index('-b') + 1]) if '-b' in a else 1
seed = int(a[a.index('--seed') + 1])
for i in range(n): Image.new('RGB', (w, h), ((seed + i * 50) % 256, 40, 90)).save(out % i if n > 1 else out)
`;
// /usr/bin/python3 finds PIL in the user site-packages, which follows HOME; the
// fixture swaps HOME, so pin PIL's location from the real environment once.
const PIL_PATH = spawnSync(PY, ['-c', 'import os, PIL; print(os.path.dirname(os.path.dirname(PIL.__file__)))'], { encoding: 'utf8' }).stdout.trim();
const bridgeRegistry = JSON.parse(spawnSync(process.execPath, [path.join(IMPL, 'sdcpp-workflow/worker/build-registry.js')], { encoding: 'utf8' }).stdout);

const sleep = ms => new Promise(r => setTimeout(r, ms));
async function until(fn, ms = 15000, what = 'condition') {
  const end = Date.now() + ms;
  while (Date.now() < end) { const v = fn(); if (v) return v; await sleep(50); }
  throw new Error('timed out waiting for ' + what);
}

function fixture(t, { count = 1, engineSleep = 0 } = {}) {
  const home = fs.mkdtempSync('/tmp/dgc-');
  const wdir = path.join(home, '.dexdiffusion-engine');
  fs.mkdirSync(path.join(wdir, 'jobs'), { recursive: true, mode: 0o700 });
  for (const name of ['engine-worker.py', 'engine-child.py']) fs.copyFileSync(path.join(IMPL, 'sdcpp-workflow/worker', name), path.join(wdir, name));
  const model = path.join(home, 'model.safetensors'); fs.writeFileSync(model, 'model');
  const engine = path.join(home, 'fake-engine'); fs.writeFileSync(engine, ENGINE, { mode: 0o700 });
  const spec = bridgeRegistry.models[TARGET];
  fs.writeFileSync(path.join(wdir, 'registry.json'), JSON.stringify({ ...bridgeRegistry, models: { [TARGET]: { ...spec, path: model } },
    adapters: {}, access_probe: {}, vaes: {}, controlnets: {}, sdcli: engine, image_python: PY }));
  for (const d of ['runs', 'images', 'state', 'tmp']) fs.mkdirSync(path.join(home, d));
  const jobId = crypto.randomUUID();
  const env = { PATH: '/usr/bin:/bin:/usr/sbin:/sbin', HOME: home, TMPDIR: path.join(home, 'tmp'), DEX_LOCAL_ENGINE_DIRECT: '1',
    DEX_RUNS_DIR: path.join(home, 'runs'), DEX_IMAGES_ROOT_OVERRIDE: path.join(home, 'images'), DEX_STATE_DIR: path.join(home, 'state'),
    DEX_WORKFLOW_ROOT: path.join(IMPL, 'sdcpp-workflow'), DEXDIFFUSION_JOB_ID: jobId, DEX_GATEC_IMPL_ROOT: IMPL, GATEC_COUNT: String(count),
    GATEC_ENGINE_SLEEP: String(engineSleep), PYTHONPATH: PIL_PATH };
  const f = { home, wdir, env, count, jobId, worker: null };
  f.startWorker = async () => {
    f.worker = spawn(PY, [path.join(FIX, 'worker-clock.py'), path.join(wdir, 'engine-worker.py'), 'serve'], { env, stdio: ['ignore', 'ignore', 'pipe'] });
    f.worker.stderr.on('data', () => {});
    await until(() => fs.existsSync(path.join(wdir, 'engine.sock')), 10000, 'worker socket');
  };
  f.stopWorker = async (signal = 'SIGKILL') => {
    if (!f.worker || f.worker.exitCode !== null || f.worker.signalCode !== null) return;
    const exited = new Promise(r => f.worker.once('exit', r));
    f.worker.kill(signal); await exited;
    try { fs.unlinkSync(path.join(wdir, 'engine.sock')); } catch (_) {}
  };
  f.bridge = ({ fault = '', mode = 'kill', disk = '', signalAfterMs = 0, decision = '' } = {}) => new Promise(resolve => {
    const args = ['--require', path.join(FIX, 'fault-preload.js'), path.join(IMPL, 'operator-console/bin/local-engine-generate.js'),
      '--target', TARGET, '--prompt', PROMPT, '--width', '64', '--height', '64', '--steps', '4', '--seed', '7', '--cfg', '7',
      '--sampler', 'euler', '--scheduler', 'discrete', ...(count > 1 ? ['--batch-count', String(count)] : [])];
    const child = spawn(process.execPath, args, { env: { ...env, DEX_GATEC_FAULT: fault, DEX_GATEC_FAULT_MODE: mode, DEX_GATEC_DISK: disk, DEX_GATEC_DECISION_ERR: decision }, stdio: ['ignore', 'pipe', 'pipe'] });
    let out = '';
    child.stdout.on('data', d => { out += d; });
    child.stderr.on('data', d => { out += d; });
    if (signalAfterMs) setTimeout(() => child.kill('SIGTERM'), signalAfterMs);
    child.on('exit', (code, signal) => resolve({ code, signal, out, runId: (out.match(/SDCPP_RUN_ID: (\S+)/) || [])[1] }));
  });
  f.recover = (extra = null) => {
    const args = extra ? ['--require', path.join(FIX, 'fault-preload.js'), path.join(FIX, 'recover.js')] : [path.join(FIX, 'recover.js')];
    const r = spawnSync(process.execPath, args, { env: { ...env, ...(extra || {}) }, encoding: 'utf8', timeout: 60000 });
    try { return JSON.parse(r.stdout.trim().split('\n').pop()); } catch (_) { return { error: r.stdout + r.stderr }; }
  };
  f.recoverAsync = () => new Promise(resolve => {
    const c = spawn(process.execPath, [path.join(FIX, 'recover.js')], { env, stdio: ['ignore', 'pipe', 'pipe'] });
    let out = ''; c.stdout.on('data', d => { out += d; });
    c.on('exit', () => { try { resolve(JSON.parse(out.trim().split('\n').pop())); } catch (_) { resolve({ error: out }); } });
  });
  f.advanceClock = seconds => fs.writeFileSync(path.join(home, 'gatec-clock-offset'), String(seconds));
  f.receipt = runId => JSON.parse(fs.readFileSync(path.join(wdir, 'jobs', runId, 'result.json'), 'utf8'));
  f.workerOutputs = runId => fs.readdirSync(path.join(wdir, 'jobs', runId)).filter(n => /^output.*\.png$/.test(n));
  f.journalDir = runId => path.join(home, 'Library/Application Support/DexDiffusion/engine-transfer', runId);
  f.state = runId => {
    const images = fs.readdirSync(path.join(home, 'images')).filter(n => !n.startsWith('.'));
    let index = []; try { index = JSON.parse(fs.readFileSync(path.join(home, 'runs', runId, 'canonical-images.json'), 'utf8')).images; } catch (_) {}
    let manifest = null; try { manifest = JSON.parse(fs.readFileSync(path.join(home, 'runs', runId, 'controlled-manifest.json'), 'utf8')); } catch (_) {}
    return { images, index: index.filter(e => e.run_id === runId), manifest, journal: fs.existsSync(f.journalDir(runId)) };
  };
  t.after(async () => { await f.stopWorker(); if (process.env.GATEC_KEEP) console.error('kept ' + home); else fs.rmSync(home, { recursive: true, force: true }); });
  return f;
}

// The single invariant every scenario must end in: exactly `count` canonical,
// distinct, run-indexed images with a PASS manifest, a COMPLETE job, an empty
// journal, and the worker's copy released only after all of that.
function assertPublishedExactlyOnce(f, runId, recovery) {
  const s = f.state(runId);
  const digests = s.index.map(e => e.sha256);
  assert.equal(s.index.length, f.count, `run index has ${s.index.length} entries, expected ${f.count} (lost or duplicated)`);
  assert.equal(new Set(digests).size, f.count, 'duplicate canonical entries for one image');
  assert.equal(s.images.length, f.count, `canonical image directory holds ${s.images.length}`);
  const expected = f.receipt(runId).images.map(i => i.sha256).sort();
  assert.deepEqual([...digests].sort(), expected, 'canonical bytes differ from the worker result');
  assert.ok(s.manifest && s.manifest.status === 'PASS', 'no PASS manifest');
  assert.ok(!s.journal, 'transfer journal entry left behind');
  if (recovery) assert.equal(recovery.job && recovery.job.status, 'COMPLETE', 'generic job not COMPLETE: ' + JSON.stringify(recovery.job && recovery.job.first_failed_gate));
  assert.ok(f.receipt(runId).acknowledged, 'worker never acknowledged');
  assert.deepEqual(f.workerOutputs(runId), [], 'worker kept outputs after a verified publication');
}
function assertNoSecretsInJournal(f, runId) {
  const dir = f.journalDir(runId);
  assert.ok(fs.existsSync(dir), 'no durable transfer journal exists for the interrupted run');
  const owner = JSON.parse(fs.readFileSync(path.join(f.home, '.dexdiffusion-engine-client', runId + '.json'), 'utf8'));
  const record = fs.readFileSync(path.join(dir, 'transfer.json'), 'utf8');
  assert.ok(!record.includes(PROMPT), 'journal contains the prompt');
  assert.ok(!record.includes(owner.token), 'journal contains the ownership token');
  assert.ok(!/token/i.test(record), 'journal names a token field');
}

const scenarios = [
  { name: 'client crashes before its first result, then >3600 s pass', fault: 'before-result', clock: 3700 },
  { name: 'client crashes after a result but before its first durable write, then >3600 s pass', fault: 'after-result:1', clock: 3700, secrets: true },
  { name: 'partial batch download (1 of 3) then crash, then >3600 s pass', count: 3, fault: 'after-result:1', clock: 3700 },
  { name: 'backend dies while the worker is still generating and stays away >3600 s', fault: 'during-status', engineSleep: 1.5, waitComplete: true, clock: 3700 },
  { name: 'worker restarts while a completed, unacknowledged result exists', fault: 'before-result', restartWorker: true, clock: 3700 },
  { name: 'crash after the worker ACK, before publication', fault: 'after-ack' },
  { name: 'ordinary exception after ACK during publication', fault: 'store:before-transfer', mode: 'throw' },
  { name: 'uncertain ACK response (worker acted, reply lost)', fault: 'ack-uncertain' },
  { name: 'crash between canonical link and run index', fault: 'store:after-publication' },
  { name: 'crash after run index commit, before manifest', fault: 'store:after-metadata' },
  { name: 'transfer write fails with EIO, then >3600 s pass', disk: 'eio', clock: 3700 },
  { name: 'low disk (no free space, ENOSPC on write), then >3600 s pass', disk: 'lowdisk', clock: 3700 },
  { name: 'partial batch: crash after ACK of a 3-image batch', count: 3, fault: 'after-ack' },
];

for (const sc of scenarios) {
  test('gate-c crash: ' + sc.name, { timeout: 90000 }, async t => {
    const f = fixture(t, { count: sc.count || 1, engineSleep: sc.engineSleep || 0 });
    await f.startWorker();
    const run = await f.bridge({ fault: sc.fault, mode: sc.mode, disk: sc.disk });
    assert.ok(run.runId, 'bridge never announced a run: ' + run.out.slice(-400));
    assert.ok(!/CONTROLLED_OUTPUT_IMAGE/.test(run.out), 'interrupted bridge reported a published image');
    if (sc.waitComplete) await until(() => { try { return f.receipt(run.runId).status === 'complete'; } catch (_) { return false; } }, 20000, 'worker completion');
    if (sc.secrets && HAS_JOURNAL) assertNoSecretsInJournal(f, run.runId);
    if (sc.restartWorker) { await f.stopWorker(); await f.startWorker(); }
    if (sc.clock) { f.advanceClock(sc.clock); await sleep(1500); }
    const recovery = f.recover();
    t.diagnostic('bridge exit ' + run.code + '/' + run.signal + ': ' + run.out.split('\n').filter(l => /ENGINE_TRANSFER_PENDING|First failed gate|ENGINE_FAILURE_REASON|failed:/.test(l)).join(' | '));
    t.diagnostic('recovery: ' + JSON.stringify({ transfers: recovery.transfers, jobs: recovery.jobs && recovery.jobs.unresolved, error: recovery.error }));
    assert.ok(!recovery.error, 'recovery failed: ' + recovery.error);
    if (!HAS_JOURNAL || !recovery.transfers) {
      // The pristine implementation has no transfer reconciliation: report what restart leaves.
      t.diagnostic('legacy end state: ' + JSON.stringify({ ...f.state(run.runId), worker_outputs: f.workerOutputs(run.runId), job: recovery.job && recovery.job.status }));
    }
    assertPublishedExactlyOnce(f, run.runId, recovery);
  });
}

test('gate-c: repeated and concurrent reconciliation publish exactly once', { timeout: 90000 }, async t => {
  const f = fixture(t);
  await f.startWorker();
  const run = await f.bridge({ fault: 'after-ack' });
  const [a, b] = await Promise.all([f.recoverAsync(), f.recoverAsync()]);
  const c = f.recover();
  for (const r of [a, b, c]) assert.ok(!r.error, r.error);
  assertPublishedExactlyOnce(f, run.runId, c);
});

test('gate-c: retries while the worker is unavailable keep the result, then complete', { timeout: 90000 }, async t => {
  const f = fixture(t);
  await f.startWorker();
  const run = await f.bridge({ fault: 'before-result' });
  await f.stopWorker();
  for (let i = 0; i < 3; i++) {
    const r = f.recover();
    assert.ok(!r.error, r.error);
    assert.ok(r.transfers && r.transfers.pending.some(p => p.run_id === run.runId && p.reason === 'worker-unavailable'), 'unavailable worker not reported pending: ' + JSON.stringify(r.transfers));
    assert.notEqual(r.job.status, 'COMPLETE');
  }
  await f.startWorker();
  assertPublishedExactlyOnce(f, run.runId, f.recover());
});

for (const variant of ['missing', 'corrupt']) {
  test(`gate-c: ${variant} owner record blocks explicitly and the worker keeps its copy past 3600 s`, { timeout: 90000 }, async t => {
    const f = fixture(t);
    await f.startWorker();
    const run = await f.bridge({ fault: 'before-result' });
    const ownerFile = path.join(f.home, '.dexdiffusion-engine-client', run.runId + '.json');
    if (variant === 'missing') fs.unlinkSync(ownerFile); else fs.writeFileSync(ownerFile, '{not json');
    f.advanceClock(3700); await sleep(1500);
    const r = f.recover();
    assert.ok(!r.error, r.error);
    assert.ok(r.transfers && r.transfers.blocked.some(b => b.run_id === run.runId && b.reason === 'owner-record-' + variant), JSON.stringify(r.transfers));
    assert.equal(f.workerOutputs(run.runId).length, 1, 'worker deleted the only copy');
    assert.equal(f.state(run.runId).index.length, 0, 'published without ownership');
  });
}

for (const variant of ['image-bytes', 'record']) {
  test(`gate-c: corrupt journal ${variant} is blocked, never published, never deleted`, { timeout: 90000 }, async t => {
    const f = fixture(t);
    await f.startWorker();
    const run = await f.bridge({ fault: 'after-ack' });
    assert.ok(HAS_JOURNAL && fs.existsSync(f.journalDir(run.runId)), 'no journal entry to corrupt (implementation has no durable journal)');
    const target = path.join(f.journalDir(run.runId), variant === 'record' ? 'transfer.json' : 'output-0.png');
    const before = fs.readFileSync(target);
    fs.writeFileSync(target, variant === 'record' ? '{"schema":"broken"' : Buffer.concat([before.subarray(0, 40), Buffer.from('corrupt')]));
    const r = f.recover();
    assert.ok(r.transfers.blocked.some(b => b.run_id === run.runId && /journal-(digest-mismatch|record-corrupt)/.test(b.reason)), JSON.stringify(r.transfers));
    assert.equal(f.state(run.runId).index.length, 0, 'corrupt bytes were published');
    assert.ok(fs.existsSync(target), 'corrupt evidence was deleted');
    assert.notEqual(r.job.status, 'COMPLETE');
  });
}

test('gate-c: cancellation while generating discards cleanly (regression)', { timeout: 90000 }, async t => {
  const f = fixture(t, { engineSleep: 2 });
  await f.startWorker();
  const run = await f.bridge({ signalAfterMs: 1800 });
  assert.notEqual(run.code, 0);
  await until(() => { try { return ['cancelled', 'failed'].includes(f.receipt(run.runId).status); } catch (_) { return false; } }, 20000, 'worker cancellation');
  const s = f.state(run.runId);
  assert.equal(s.index.length, 0); assert.equal(s.images.length, 0); assert.ok(!s.journal, 'journal left after cancel');
  assert.ok(!/ENGINE_TRANSFER_PENDING/.test(run.out), 'cancel misreported as pending transfer');
});

test('gate-c: cancellation after download, before ACK, is an explicit discard', { timeout: 90000 }, async t => {
  const f = fixture(t);
  await f.startWorker();
  const run = await f.bridge({ fault: 'self-cancel-after-result' });
  assert.notEqual(run.code, 0);
  const s = f.state(run.runId);
  assert.equal(s.index.length, 0, 'cancelled result was published');
  assert.ok(!s.journal, 'journal left after an explicit discard');
  assert.ok(!/CONTROLLED_OUTPUT_IMAGE/.test(run.out));
});

test('gate-c: uninterrupted single and batch transfers still publish exactly once (regression)', { timeout: 90000 }, async t => {
  for (const count of [1, 3]) {
    const f = fixture(t, { count });
    await f.startWorker();
    const run = await f.bridge();
    assert.equal(run.code, 0, run.out.slice(-600));
    assert.match(run.out, /SDCPP_REMOTE_CLEANUP: OK/);
    assertPublishedExactlyOnce(f, run.runId, null);
    await f.stopWorker();
  }
});

test('gate-c: a journal entry whose record is missing but whose files survive is BLOCKED and preserved', { timeout: 90000 }, async t => {
  const f = fixture(t);
  await f.startWorker();
  const run = await f.bridge({ fault: 'after-ack' });
  const dir = f.journalDir(run.runId);
  assert.ok(fs.existsSync(path.join(dir, 'output-0.png')), 'no durable bytes to preserve');
  fs.unlinkSync(path.join(dir, 'transfer.json'));
  for (let attempt = 0; attempt < 2; attempt++) {
    const r = f.recover();
    assert.ok(!r.error, r.error);
    assert.ok(r.transfers.blocked.some(b => b.run_id === run.runId && b.reason === 'journal-record-missing'), 'not reported BLOCKED: ' + JSON.stringify(r.transfers));
    assert.ok(fs.existsSync(path.join(dir, 'output-0.png')), 'surviving evidence was deleted');
    assert.equal(f.state(run.runId).index.length, 0, 'published without a record');
  }
});

for (const code of ['EPERM', 'EIO']) {
  test(`gate-c: ${code} on the cancellation decision blocks before ACK; worker keeps its copy; recovery then publishes once`, { timeout: 90000 }, async t => {
    const f = fixture(t);
    await f.startWorker();
    const run = await f.bridge({ decision: code });
    assert.notEqual(run.code, 0, 'bridge published while cancellation evidence was unreadable');
    assert.match(run.out, /ENGINE_TRANSFER_PENDING: /);
    assert.match(run.out, /cancellation-evidence-unreadable/);
    assert.ok(!f.receipt(run.runId).acknowledged, 'worker was told to release its copy');
    assert.equal(f.workerOutputs(run.runId).length, 1, 'worker copy lost');
    assert.equal(f.state(run.runId).index.length, 0, 'published before the decision was established');
    const blocked = f.recover({ DEX_GATEC_DECISION_ERR: code });
    assert.ok(blocked.transfers.blocked.some(b => b.run_id === run.runId && b.reason === 'cancellation-evidence-unreadable'), JSON.stringify(blocked.transfers));
    assert.ok(!f.receipt(run.runId).acknowledged);
    assertPublishedExactlyOnce(f, run.runId, f.recover());
  });

  test(`gate-c: ${code} on the cancellation decision after ACK blocks publication and preserves journal bytes`, { timeout: 90000 }, async t => {
    const f = fixture(t);
    await f.startWorker();
    const run = await f.bridge({ fault: 'after-ack' });
    const blocked = f.recover({ DEX_GATEC_DECISION_ERR: code });
    assert.ok(blocked.transfers.blocked.some(b => b.run_id === run.runId && b.reason === 'cancellation-evidence-unreadable'), JSON.stringify(blocked.transfers));
    assert.ok(fs.existsSync(path.join(f.journalDir(run.runId), 'output-0.png')), 'journal bytes lost');
    assert.equal(f.state(run.runId).index.length, 0, 'published while cancellation evidence was unreadable');
    assert.notEqual(blocked.job.status, 'COMPLETE');
    assertPublishedExactlyOnce(f, run.runId, f.recover());
  });
}

test('gate-c: a journal record whose run_dir points outside the runs root is BLOCKED, never published there', { timeout: 90000 }, async t => {
  const f = fixture(t);
  await f.startWorker();
  const run = await f.bridge({ fault: 'after-ack' });
  const recordFile = path.join(f.journalDir(run.runId), 'transfer.json');
  const escape = path.join(f.home, 'elsewhere', run.runId);
  fs.mkdirSync(escape, { recursive: true });
  const record = JSON.parse(fs.readFileSync(recordFile, 'utf8'));
  fs.writeFileSync(recordFile, JSON.stringify({ ...record, run_dir: escape }));
  const r = f.recover();
  assert.ok(r.transfers.blocked.some(b => b.run_id === run.runId && b.reason === 'run-dir-untrusted'), JSON.stringify(r.transfers));
  assert.deepEqual(fs.readdirSync(escape), [], 'wrote into an untrusted directory');
  assert.ok(fs.existsSync(path.join(f.journalDir(run.runId), 'output-0.png')), 'journal bytes lost');
});
