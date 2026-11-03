'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const crypto = require('node:crypto');
const vm = require('node:vm');
const { createImageStore } = require('../image-store');
const { validateImage } = require('../image-validation');
const { artifactReceipt } = require('../job-contract');
const { createPublicationOutbox } = require('../publication-outbox');
const { publishAfterAcknowledgment } = require('../bin/local-engine-generate');
const {
  INTENT_SCHEMA, createControlledImageStore, publishCompletedControlledRun, createControlledPublicationManager,
} = require('../controlled-publication');

const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAIAAAACCAIAAAD91JpzAAAAEklEQVR4nGMU0QhgYGBgYgADAAZ+AJD85S7OAAAAAElFTkSuQmCC', 'base64');
const serverSource = fs.readFileSync(path.join(__dirname, '../server.js'), 'utf8');
function serverTerminalSync(context) {
  const start = serverSource.indexOf('function syncGenericTerminal(');
  const end = serverSource.indexOf('function updateSequentialProgress(', start);
  return vm.runInNewContext(serverSource.slice(start, end) + '\nsyncGenericTerminal', context);
}

test('controlled-generation completion registers its owned publish decision in the outbox', async t => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'dex-controlled-publication-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const imageRoot = path.join(root, 'images');
  const runsRoot = path.join(root, 'runs');
  const outboxRoot = path.join(root, 'state', 'publications');
  const runId = '20261102-200000-controlled-flux2-klein-4b-test';
  const jobId = '11111111-1111-4111-8111-111111111111';
  const runDir = path.join(runsRoot, runId);
  fs.mkdirSync(runDir, { recursive: true });
  fs.writeFileSync(path.join(runDir, 'job-owner.json'), JSON.stringify({ schema: 'dexdiffusion.run_owner.v1', job_id: jobId, run_id: runId }));
  const source = path.join(root, 'engine-output.png');
  fs.writeFileSync(source, PNG);

  // The local-engine child constructs its own imageStore. This reproduces its
  // completed-worker/verified-cleanup publication call without invoking FLUX.
  const store = createControlledImageStore({ createImageStore, root: imageRoot, runsRoot, publicationEnabled: true });
  const outbox = createPublicationOutbox(outboxRoot);
  const published = await publishAfterAcknowledgment({
    acknowledge: async () => ({ acknowledged: true, cleanup: true }),
    publish: () => publishCompletedControlledRun({
      workerState: { status: 'complete', run_id: runId }, jobId, runId, runDir,
      downloads: [{ src: source, runId, runDir, runFile: 'controlled-test.png', seed: 17, bytes: PNG.length,
        sha256: crypto.createHash('sha256').update(PNG).digest('hex') }],
      store, publicationEnabled: true,
    }),
    isStopping: () => false,
  });

  assert.equal(published.length, 1);
  const [entry] = published;
  assert.equal(entry.job_id, jobId);
  assert.equal(entry.sha256, crypto.createHash('sha256').update(PNG).digest('hex'));
  assert.equal(entry.publication.intent_schema, INTENT_SCHEMA);
  assert.equal(outbox.all().length, 0, 'child has persisted intent, but the API completion path owns registration');
  const manager = createControlledPublicationManager({ runsRoot, imageRoot, outbox });
  const durableJob = { job_id: jobId, status: 'RUNNING', artifact_required: true, artifacts: [] };
  const job = { id: jobId, commandAction: 'controlled-generate', status: 'PASS', runId, results: [{ runId, imageId: entry.image_id }],
    stderr: '', stdout: '', requestParams: { target: 'flux2-klein-4b' }, completedAt: Date.now() };
  const sync = serverTerminalSync({
    crossHostPublicationEnabled: true, controlledPublication: manager, RUNS_DIR: runsRoot,
    TERMINAL: new Set(['COMPLETE', 'FAILED', 'CANCELLED', 'INTERRUPTED']), JOB_IMAGE_FIELDS: [], path, Date,
    jobStore: {
      get: () => durableJob,
      transition: (_id, status, patch) => { Object.assign(durableJob, patch, { status }); return { ...durableJob }; },
      flush: () => {},
    },
    artifactReceipt, imageStore: { resolveImage: id => store.resolveImage(id), readRunIndex: dir => store.readRunIndex(dir), acknowledgePublication: () => ({ acknowledged: 0, unresolved: [] }) },
    validateImage, holdsLease: () => false, syncRemoteRunIds: () => {}, remoteWorkers: { finished: () => {} },
    arbiter: { release: () => {} }, eventBus: { publish: () => {} }, timingStore: null, libraryIndex: null, imageMeta: { get: () => null },
  });
  sync(job);
  assert.equal(durableJob.status, 'COMPLETE');
  assert.equal(outbox.read(entry.image_id)?.state, 'PUBLICATION_PENDING');
});

function fixture(t, { publishFilesCallback = false } = {}) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'dex-controlled-publication-case-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const imageRoot = path.join(root, 'images'), runsRoot = path.join(root, 'runs');
  const outboxRoot = path.join(root, 'state', 'publications');
  const outbox = createPublicationOutbox(outboxRoot);
  const runId = '20261102-200001-controlled-flux2-klein-4b-test';
  const jobId = '22222222-2222-4222-8222-222222222222';
  const runDir = path.join(runsRoot, runId);
  fs.mkdirSync(runDir, { recursive: true });
  fs.writeFileSync(path.join(runDir, 'job-owner.json'), JSON.stringify({ schema: 'dexdiffusion.run_owner.v1', job_id: jobId, run_id: runId }));
  const source = path.join(root, 'engine-output.png'); fs.writeFileSync(source, PNG);
  const storeOptions = { createImageStore, root: imageRoot, runsRoot, publicationEnabled: true };
  const store = createControlledImageStore({
    ...storeOptions,
    ...(publishFilesCallback ? { onPublished: entry => outbox.create(entry, path.join(imageRoot, entry.image_id)) } : {}),
  });
  const manager = createControlledPublicationManager({ runsRoot, imageRoot, outbox });
  const download = { src: source, runId, runDir, runFile: 'controlled-test.png', seed: 23, bytes: PNG.length,
    sha256: crypto.createHash('sha256').update(PNG).digest('hex') };
  const publish = () => publishCompletedControlledRun({ workerState: { status: 'complete', run_id: runId }, jobId, runId, runDir,
    downloads: [download], store, publicationEnabled: true });
  return { root, imageRoot, runsRoot, outboxRoot, outbox, runId, jobId, runDir, source, store, manager, publish, download };
}

test('publishFiles callback behavior remains available', t => {
  const f = fixture(t, { publishFilesCallback: true });
  const [entry] = f.publish();
  assert.equal(f.outbox.read(entry.image_id).state, 'PUBLICATION_PENDING');
});

test('completion registration and publishFiles callback create one logical entry', t => {
  const f = fixture(t, { publishFilesCallback: true });
  const [entry] = f.publish();
  f.manager.registerCompletedJob({ id: f.jobId, commandAction: 'controlled-generate', status: 'PASS', runId: f.runId },
    { job_id: f.jobId, status: 'COMPLETE' });
  assert.equal(f.outbox.all().length, 1);
  assert.equal(f.outbox.read(entry.image_id).state, 'PUBLICATION_PENDING');
});

test('repeated controlled completion is idempotent', t => {
  const f = fixture(t), [entry] = f.publish();
  const job = { id: f.jobId, commandAction: 'controlled-generate', status: 'PASS', runId: f.runId };
  const durable = { job_id: f.jobId, status: 'COMPLETE' };
  f.manager.registerCompletedJob(job, durable);
  const first = f.outbox.read(entry.image_id);
  f.manager.registerCompletedJob(job, durable);
  assert.equal(f.outbox.all().length, 1);
  assert.deepEqual(f.outbox.read(entry.image_id), first);
});

test('startup reconciliation recovers a crash after durable intent and index but before enqueue', t => {
  const f = fixture(t), [entry] = f.publish();
  assert.ok(fs.existsSync(path.join(f.runDir, 'publication-intent.json')));
  assert.equal(f.outbox.all().length, 0);
  const result = f.manager.reconcileRecent();
  assert.equal(result.recovered, 1);
  assert.equal(f.outbox.read(entry.image_id).state, 'PUBLICATION_PENDING');
  const first = f.outbox.read(entry.image_id);
  assert.equal(f.manager.reconcileRecent().recovered, 1);
  assert.deepEqual(f.outbox.read(entry.image_id), first);
});

test('failed, cancelled, or stopping controlled generation cannot persist publish intent', async t => {
  for (const state of ['failed', 'cancelled']) {
    const f = fixture(t);
    assert.throws(() => publishCompletedControlledRun({ workerState: { status: state, run_id: f.runId }, jobId: f.jobId,
      runId: f.runId, runDir: f.runDir, downloads: [f.download], store: f.store, publicationEnabled: true }));
    assert.equal(fs.existsSync(path.join(f.runDir, 'publication-intent.json')), false);
    assert.equal(f.store.readRunIndex(f.runDir).length, 0);
  }
  const f = fixture(t);
  assert.throws(() => publishCompletedControlledRun({ workerState: { status: 'complete', run_id: f.runId }, jobId: f.jobId,
    runId: f.runId, runDir: f.runDir, downloads: [f.download], store: f.store, publicationEnabled: true, isStopping: () => true }), /cancelled/);
  assert.equal(fs.existsSync(path.join(f.runDir, 'publication-intent.json')), false);
  assert.equal(f.store.readRunIndex(f.runDir).length, 0);
});

test('failed, cancelled, rejected, or nonterminal jobs do not register controlled outputs', t => {
  const f = fixture(t); f.publish();
  for (const [status, durableStatus] of [['FAIL', 'FAILED'], ['CANCELLED', 'CANCELLED'], ['PASS', 'RUNNING']]) {
    assert.deepEqual(f.manager.registerCompletedJob({ id: f.jobId, commandAction: 'controlled-generate', status, runId: f.runId },
      { job_id: f.jobId, status: durableStatus }), []);
  }
  assert.equal(f.outbox.all().length, 0);
});

test('missing explicit publish decision cannot be replayed', t => {
  const f = fixture(t); f.publish();
  fs.unlinkSync(path.join(f.runDir, 'publication-decision.json'));
  const result = f.manager.reconcileRecent();
  assert.equal(result.recovered, 0);
  assert.equal(result.unresolved.length, 1);
  assert.equal(f.outbox.all().length, 0);
});

test('missing or digest-mismatched bytes cannot create a pending record', t => {
  for (const remove of [true, false]) {
    const f = fixture(t), [entry] = f.publish();
    const image = path.join(f.imageRoot, entry.image_id);
    if (remove) fs.unlinkSync(image); else fs.appendFileSync(image, Buffer.from('tamper'));
    assert.throws(() => f.manager.registerCompletedJob({ id: f.jobId, commandAction: 'controlled-generate', status: 'PASS', runId: f.runId },
      { job_id: f.jobId, status: 'COMPLETE' }));
    assert.equal(f.outbox.all().length, 0);
  }
});

test('verified canonical state is never replaced by pending during replay', t => {
  const f = fixture(t), [entry] = f.publish();
  f.manager.registerCompletedJob({ id: f.jobId, commandAction: 'controlled-generate', status: 'PASS', runId: f.runId },
    { job_id: f.jobId, status: 'COMPLETE' });
  const verified = f.outbox.update(entry.image_id, { state: 'CANONICAL_VERIFIED', receipt: { sha256: entry.sha256 } });
  f.manager.registerCompletedJob({ id: f.jobId, commandAction: 'controlled-generate', status: 'PASS', runId: f.runId },
    { job_id: f.jobId, status: 'COMPLETE' });
  assert.deepEqual(f.outbox.read(entry.image_id), verified);
});

test('concurrent registration attempts create one outbox record', async t => {
  const f = fixture(t); f.publish();
  const barrier = path.join(f.root, 'go');
  const script = `const fs=require('node:fs');const {createPublicationOutbox}=require(${JSON.stringify(path.resolve(__dirname,'../publication-outbox'))});const {createControlledPublicationManager}=require(${JSON.stringify(path.resolve(__dirname,'../controlled-publication'))});process.stdout.write('READY\\n');while(!fs.existsSync(process.argv[4]))Atomics.wait(new Int32Array(new SharedArrayBuffer(4)),0,0,2);const outbox=createPublicationOutbox(process.argv[3]);createControlledPublicationManager({runsRoot:process.argv[1],imageRoot:process.argv[2],outbox}).registerRun(process.argv[5],process.argv[6]);`;
  const { spawn } = require('node:child_process');
  const children = [0, 1].map(() => spawn(process.execPath, ['-e', script, f.runsRoot, f.imageRoot, f.outboxRoot, barrier, f.runId, f.jobId], { stdio: ['ignore', 'pipe', 'pipe'] }));
  const outcomes = children.map(child => new Promise((resolve, reject) => {
    let output = '', errors = '';
    child.stdout.on('data', chunk => { output += chunk; });
    child.stderr.on('data', chunk => { errors += chunk; });
    child.on('error', reject);
    child.on('exit', (code, signal) => code === 0 ? resolve({ output, signal }) : reject(new Error(`child exit ${code}/${signal}: ${errors}`)));
  }));
  await Promise.all(children.map(child => new Promise((resolve, reject) => {
    let output = '';
    child.stdout.on('data', chunk => { output += chunk; if (output.includes('READY')) resolve(); });
    child.on('error', reject);
    child.on('exit', code => { if (code !== 0) reject(new Error('registration child exited before barrier')); });
  })));
  fs.writeFileSync(barrier, 'go');
  await Promise.all(outcomes);
  assert.equal(f.outbox.all().length, 1);
});

test('offline MacBook leaves a newly registered artifact pending', t => {
  const f = fixture(t), [entry] = f.publish();
  f.manager.registerCompletedJob({ id: f.jobId, commandAction: 'controlled-generate', status: 'PASS', runId: f.runId },
    { job_id: f.jobId, status: 'COMPLETE' });
  assert.equal(f.outbox.read(entry.image_id).state, 'PUBLICATION_PENDING');
  assert.equal(f.outbox.read(entry.image_id).receipt, undefined);
});

test('startup reconciliation leaves historical images without the versioned intent untouched', t => {
  const f = fixture(t);
  const oldRun = path.join(f.runsRoot, '20251001-120000-historical-image'); fs.mkdirSync(oldRun, { recursive: true });
  fs.mkdirSync(f.imageRoot, { recursive: true });
  const oldId = '20251001-120000-historical.png';
  fs.writeFileSync(path.join(f.imageRoot, oldId), PNG);
  fs.writeFileSync(path.join(oldRun, 'canonical-images.json'), JSON.stringify({ schema: 'dexdiffusion.canonical_images.v1', root: f.imageRoot,
    images: [{ image_id: oldId, run_id: path.basename(oldRun), run_file: 'historical.png', bytes: PNG.length, sha256: crypto.createHash('sha256').update(PNG).digest('hex') }] }));
  const before = fs.readFileSync(path.join(f.imageRoot, oldId));
  f.manager.reconcileRecent();
  assert.equal(f.outbox.read(oldId), null);
  assert.deepEqual(fs.readFileSync(path.join(f.imageRoot, oldId)), before);
});
