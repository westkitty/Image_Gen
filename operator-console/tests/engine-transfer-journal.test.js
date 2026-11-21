'use strict';
// Gate C unit contracts: journal root safety, secret-free records, single-owner
// locks, and fail-closed recovery when run evidence cannot be read.
// DEX_GATEC_IMPL_ROOT may point at a pristine HEAD export for "before" evidence.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { spawnSync } = require('node:child_process');

const IMPL = path.resolve(process.env.DEX_GATEC_IMPL_ROOT || path.join(__dirname, '../..'), 'operator-console');
const { reconcileInterruptedPublications } = require(path.join(IMPL, 'publication-recovery'));
const M = require(path.join(IMPL, 'media'));
const journalModule = fs.existsSync(path.join(IMPL, 'engine-transfer-journal.js')) ? require(path.join(IMPL, 'engine-transfer-journal')) : null;
const RUN = '20261120-120000-controlled-sd15-0badc0de';

function temp(t) { const dir = fs.mkdtempSync('/tmp/dgc-unit-'); t.after(() => { try { fs.chmodSync(path.join(dir, 'runs'), 0o700); } catch (_) {} fs.rmSync(dir, { recursive: true, force: true }); }); return dir; }
function interruptedJob(dir) {
  const file = path.join(dir, 'jobs.json');
  const seed = M.createJobStore(file);
  const job = seed.create({ media_kind: 'image', operation: 'controlled-generate', worker_id: 'bigmac-local' });
  seed.transition(job.job_id, 'RUNNING'); seed.flush();
  return { jobStore: M.createJobStore(file), jobId: job.job_id };
}
const store = { readRunIndex: () => [], resolveImage: () => null };

test('unreadable runs root blocks recovery instead of reporting no artifact', t => {
  const dir = temp(t);
  fs.mkdirSync(path.join(dir, 'runs'));
  const { jobStore, jobId } = interruptedJob(dir);
  fs.chmodSync(path.join(dir, 'runs'), 0o000);
  const result = reconcileInterruptedPublications({ jobStore, runsRoot: path.join(dir, 'runs'), imageStore: store, validateImage: () => ({}) });
  assert.equal(result.blocked, true, 'an EACCES/EPERM read was reported as an empty history: ' + JSON.stringify(result));
  assert.deepEqual(result.unresolved.map(u => [u.job_id, u.reason]), [[jobId, 'runs-root-unreadable']]);
});

test('unreadable run evidence blocks instead of no-exact-owned-published-artifact', t => {
  const dir = temp(t);
  const runDir = path.join(dir, 'runs', RUN);
  fs.mkdirSync(runDir, { recursive: true });
  const { jobStore, jobId } = interruptedJob(dir);
  fs.writeFileSync(path.join(runDir, 'job-owner.json'), JSON.stringify({ schema: 'dexdiffusion.run_owner.v1', job_id: jobId, run_id: RUN }));
  fs.chmodSync(path.join(runDir, 'job-owner.json'), 0o000);
  const result = reconcileInterruptedPublications({ jobStore, runsRoot: path.join(dir, 'runs'), imageStore: store, validateImage: () => ({}) });
  fs.chmodSync(path.join(runDir, 'job-owner.json'), 0o600);
  assert.equal(result.blocked, true, JSON.stringify(result));
  assert.equal(result.unresolved[0].reason, 'run-evidence-unreadable');
});

test('absent runs root on a fresh install is not a failure', t => {
  const dir = temp(t);
  const { jobStore } = interruptedJob(dir);
  const result = reconcileInterruptedPublications({ jobStore, runsRoot: path.join(dir, 'missing'), imageStore: store, validateImage: () => ({}) });
  assert.ok(!result.blocked);
  assert.equal(result.unresolved[0].reason, 'no-exact-owned-published-artifact');
});

test('transfer journal root must be a private real directory on the home volume, outside DEX_DATA_ROOT', { skip: !journalModule && 'implementation has no transfer journal' }, t => {
  const home = temp(t);
  const { createTransferJournal, defaultTransferRoot } = journalModule;
  assert.equal(createTransferJournal({ home, root: defaultTransferRoot(home) }).assertSafeRoot(), defaultTransferRoot(home));
  assert.throws(() => createTransferJournal({ home, root: '/private/tmp/elsewhere' }).assertSafeRoot(), /journal-root-unsafe/);
  assert.throws(() => createTransferJournal({ home, root: path.join(home, 'data', 'jt'), dataRoot: path.join(home, 'data') }).assertSafeRoot(), /DEX_DATA_ROOT/);
  fs.mkdirSync(path.join(home, 'real'));
  fs.symlinkSync(path.join(home, 'real'), path.join(home, 'link'));
  assert.throws(() => createTransferJournal({ home, root: path.join(home, 'link', 'jt') }).assertSafeRoot(), /symlink/);
  const mode = fs.statSync(defaultTransferRoot(home)).mode & 0o777;
  assert.equal(mode, 0o700);
});

test('transfer records keep only allow-listed, secret-free metadata and are fsynced atomically', { skip: !journalModule && 'implementation has no transfer journal' }, t => {
  const home = temp(t);
  const journal = journalModule.createTransferJournal({ home, root: journalModule.defaultTransferRoot(home) });
  const token = crypto.randomBytes(32).toString('hex');
  journal.begin({ runId: RUN, runDir: path.join(home, 'runs', RUN), count: 1, runFiles: ['controlled-sd15.png'],
    meta: { target: 'sd15', seed: 7, prompt: 'secret words', negative_prompt: 'more secret', token, save_prompts: true } });
  const raw = fs.readFileSync(path.join(journal.root, RUN, 'transfer.json'), 'utf8');
  for (const forbidden of ['secret words', 'more secret', token, '"prompt"', 'token']) assert.ok(!raw.includes(forbidden), 'record contains ' + forbidden);
  assert.equal(JSON.parse(raw).meta.save_prompts, true);
  assert.equal(fs.statSync(path.join(journal.root, RUN, 'transfer.json')).mode & 0o777, 0o600);
  assert.throws(() => journal.begin({ runId: RUN, runDir: home, count: 1, runFiles: ['x.png'] }), /EEXIST/);
});

test('one owner per transfer: a live lock is refused, a dead owner lock is reclaimed', { skip: !journalModule && 'implementation has no transfer journal' }, t => {
  const home = temp(t);
  const journal = journalModule.createTransferJournal({ home, root: journalModule.defaultTransferRoot(home) });
  journal.begin({ runId: RUN, runDir: home, count: 1, runFiles: ['x.png'] });
  const release = journal.lock(RUN);
  const live = spawnSync(process.execPath, ['-e', `const j=require(${JSON.stringify(path.join(IMPL, 'engine-transfer-journal'))}).createTransferJournal({home:${JSON.stringify(home)},root:${JSON.stringify(journal.root)}});try{j.lock(${JSON.stringify(RUN)});console.log('acquired')}catch(e){console.log(e.reason)}`], { encoding: 'utf8' });
  assert.equal(live.stdout.trim(), 'transfer-in-progress');
  release();
  fs.writeFileSync(path.join(journal.root, RUN, '.lock'), '999999');
  journal.lock(RUN)();
});

test('a bridge exit that retained its result is recognised as pending, not failed', { skip: !journalModule && 'implementation has no transfer journal' }, () => {
  assert.equal(journalModule.transferPendingRunId('x\nENGINE_TRANSFER_PENDING: ' + RUN + '\nFirst failed gate: engine-transfer-pending'), RUN);
  assert.equal(journalModule.transferPendingRunId('First failed gate: engine-failed'), null);
});

test('journal admission fails before generation when its disk floor or byte cap is reached', { skip: !journalModule && 'implementation has no transfer journal' }, t => {
  const home = temp(t);
  const { createTransferJournal } = journalModule;
  const run = { runId: RUN, runDir: home, count: 1, runFiles: ['x.png'] };
  const root = journalModule.defaultTransferRoot(home);
  const fullDisk = createTransferJournal({ home, root, minFreeBytes: Number.MAX_SAFE_INTEGER });
  assert.throws(() => fullDisk.begin(run), /insufficient-journal-capacity/);
  assert.deepEqual(fullDisk.list(), []);

  const journal = createTransferJournal({ home, root, maxBytes: 10 });
  journal.begin(run);
  const file = path.join(journal.root, RUN, 'output-0.png');
  fs.writeFileSync(file, Buffer.alloc(10));
  const next = { ...run, runId: RUN + '-next' };
  assert.throws(() => journal.begin(next), /journal-capacity-exceeded/);
  assert.deepEqual(journal.list(), [RUN]);

  fs.unlinkSync(file);
  fs.symlinkSync('absent', file);
  assert.throws(() => journal.begin(next), /journal-image-unsafe/);
  assert.deepEqual(journal.list(), [RUN]);
  fs.symlinkSync('absent', path.join(journal.root, next.runId));
  assert.throws(() => journal.list(), /journal-entry-unsafe/);
});

test('interrupted worker cleanup keeps the journal and refuses ACK', { skip: !journalModule && 'implementation has no transfer journal' }, async t => {
  const home = temp(t);
  const { createTransferJournal, defaultTransferRoot, advanceTransfer } = journalModule;
  const journal = createTransferJournal({ home, root: defaultTransferRoot(home) });
  journal.begin({ runId: RUN, runDir: path.join(home, RUN), count: 1, runFiles: ['x.png'] });
  const requests = [];
  const owned = async op => {
    requests.push(op);
    return { status: 'failed', cleanup: false };
  };
  await assert.rejects(advanceTransfer(RUN, { journal, owned, store }), /worker-cleanup-unverified/);
  journal.requestCancel(RUN);
  await assert.rejects(advanceTransfer(RUN, { journal, owned, store }), /worker-cleanup-unverified/);
  assert.deepEqual(requests, ['status', 'status']);
  assert.deepEqual(journal.list(), [RUN]);
});
