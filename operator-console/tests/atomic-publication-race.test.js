'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const M = require('../media');
const { createImageStore } = require('../image-store');
const { validateImage } = require('../image-validation');

const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAIAAAACCAIAAAD91JpzAAAAEklEQVR4nGMU0QhgYGBgYgADAAZ+AJD85S7OAAAAAElFTkSuQmCC', 'base64');
const JOB = '11111111-1111-4111-8111-111111111111';
const sha = value => require('node:crypto').createHash('sha256').update(value).digest('hex');
function fixture(t, fault) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'dex-atomic-race-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const runs = path.join(root, 'runs'), runId = '20261017-120001-atomic', run = path.join(runs, runId);
  fs.mkdirSync(run, { recursive: true });
  fs.writeFileSync(path.join(run, 'job-owner.json'), JSON.stringify({ schema: 'dexdiffusion.run_owner.v1', job_id: JOB, run_id: runId }));
  fs.writeFileSync(path.join(run, 'controlled-manifest.json'), JSON.stringify({ status: 'PASS', run_id: runId }));
  const source = path.join(run, 'generated.png'); fs.writeFileSync(source, PNG);
  const jobs = M.createJobStore(path.join(root, 'state/jobs.json'));
  jobs.create({ job_id: JOB, media_kind: 'image', operation: 'controlled-generate', worker_id: 'sdcpp', params: { quantity: 1 } });
  jobs.transition(JOB, 'RUNNING');
  const images = createImageStore({ root: path.join(root, 'images'), runsRoot: runs, fault });
  return { root, runs, runId, run, source, jobs, images };
}
function receipt(entry) {
  return { canonical: true, validated: true, artifacts: [{ artifact_id: entry.image_id, sha256: entry.sha256 }] };
}
function barrier() {
  let open, arrive;
  const release = new Promise(resolve => { open = resolve; });
  const entered = new Promise(resolve => { arrive = resolve; });
  return { entered, release: open, wait: async () => { arrive(); await release; } };
}

test('barrier-controlled publication winner records the 12 durable lifecycle boundaries', async t => {
  const events = [];
  const x = fixture(t, point => {
    if (point === 'after-decision') events.push('publication_decision_acquired');
    if (point === 'after-intent') events.push('publication_intent_persisted');
    if (point === 'before-publication') events.push('canonical_publication_begins');
    if (point === 'after-publication') events.push('canonical_file_commit_succeeds');
  });
  const arbiter = M.createResourceArbiter();
  assert.equal((await arbiter.acquire(JOB)).granted, true);
  assert.equal(arbiter.holds(JOB), true);
  events.push('remote_generation_pass');
  events.push('png_verification_started');
  assert.equal(validateImage(x.source).sha256, sha(PNG));
  events.push('png_verified');

  // Barrier 1 is before the shared durable decision: the publisher is held,
  // cancellation claims the per-run decision, and no canonical link is made.
  const beforeDecision = barrier();
  const firstPublish = (async () => { await beforeDecision.wait(); return x.images.finalizeRun(x.run); })();
  await beforeDecision.entered;
  const canceled = x.images.requestPublicationCancellation(x.run, JOB);
  assert.equal(canceled.decision, 'cancel');
  beforeDecision.release();
  await assert.rejects(firstPublish, /publication cancelled before decision/);
  assert.equal(fs.existsSync(path.join(x.images.root, '20261017-120001-atomic-generated.png')), false);
  const canceledTransition = x.jobs.transition(JOB, 'CANCELLED', { artifacts: [], artifact_validation: null, first_failed_gate: 'user-cancelled' });
  assert.equal(canceledTransition.status, 'CANCELLED');
  // The isolated case supplies verified remote-stop evidence before releasing the held compute lease.
  assert.equal(arbiter.release(JOB), true);
  assert.equal(arbiter.state().owner, null);

  // Use a fresh job/run transaction to exercise cancellation after the durable
  // publication decision and canonical commit. The caller cannot replace it.
  const run2 = path.join(x.runs, '20261017-120002-atomic'); fs.mkdirSync(run2);
  fs.writeFileSync(path.join(run2, 'job-owner.json'), JSON.stringify({ schema: 'dexdiffusion.run_owner.v1', job_id: JOB, run_id: path.basename(run2) }));
  fs.writeFileSync(path.join(run2, 'controlled-manifest.json'), JSON.stringify({ status: 'PASS', run_id: path.basename(run2) }));
  const source2 = path.join(run2, 'generated.png'); fs.writeFileSync(source2, PNG);
  events.length = 0;
  events.push('remote_generation_pass');
  events.push('png_verification_started');
  assert.equal(validateImage(source2).sha256, sha(PNG));
  events.push('png_verified');
  // Restore a fresh interrupted job as the same stable identity for this isolated fixture.
  const secondJob = M.createJobStore(path.join(x.root, 'state/second-jobs.json'));
  assert.equal((await arbiter.acquire(JOB)).granted, true);
  secondJob.create({ job_id: JOB, media_kind: 'image', operation: 'controlled-generate', worker_id: 'sdcpp', params: { quantity: 1 } });
  secondJob.transition(JOB, 'RUNNING');
  let entry;
  const afterCommit = barrier();
  const finalize = (async () => {
    [entry] = x.images.finalizeRun(run2);
    await afterCommit.wait();
    events.push('artifact_receipt_persistence_and_terminalization_begin');
    // In this store, receipt and terminal status share one fsynced atomic jobs.json replacement.
    const terminal = secondJob.transition(JOB, 'COMPLETE', { artifacts: [entry.image_id], artifact_validation: receipt(entry) });
    assert.equal(terminal.status, 'COMPLETE');
    events.push('artifact_receipt_and_terminal_state_durable');
  })();
  await afterCommit.entered;
  const lateCancel = x.images.requestPublicationCancellation(run2, JOB);
  assert.equal(lateCancel.decision, 'publish');
  events.push('cancel_requested_after_commit');
  events.push('artifact_receipt_persistence_begins');
  afterCommit.release();
  await finalize;
  assert.equal(M.createJobStore(path.join(x.root, 'state/second-jobs.json')).get(JOB).status, 'COMPLETE');
  assert.equal(x.images.resolveImage(entry.image_id).id, entry.image_id);
  assert.equal(x.images.acknowledgePublication(JOB, [entry.image_id]).acknowledged, 1);
  assert.equal(arbiter.release(JOB), true);
  assert.equal(arbiter.state().owner, null);
  events.push('compute_lease_safely_released');
  assert.equal(arbiter.state().quarantine, null);

  const required = ['remote_generation_pass', 'png_verification_started', 'png_verified', 'publication_intent_persisted',
    'publication_decision_acquired', 'canonical_publication_begins', 'canonical_file_commit_succeeds',
    'cancel_requested_after_commit',
    'artifact_receipt_persistence_begins', 'artifact_receipt_persistence_and_terminalization_begin',
    'artifact_receipt_and_terminal_state_durable', 'compute_lease_safely_released'];
  for (const event of required) assert.ok(events.includes(event), `missing event ${event}`);
  assert.ok(events.indexOf('publication_intent_persisted') < events.indexOf('canonical_file_commit_succeeds'));
  assert.ok(events.indexOf('canonical_file_commit_succeeds') < events.indexOf('artifact_receipt_and_terminal_state_durable'));
});

test('terminal receipts are idempotent and partial batch output remains durable', t => {
  const x = fixture(t);
  const entry = { image_id: 'partial.png', sha256: 'b'.repeat(64) };
  const partial = x.jobs.transition(JOB, 'CANCELLED', { artifacts: [entry.image_id], artifact_validation: { canonical: true, validated: true, artifacts: [{ artifact_id: entry.image_id, sha256: entry.sha256 }] } });
  assert.equal(partial.status, 'CANCELLED');
  x.jobs.transition(JOB, 'CANCELLED', { artifacts: [entry.image_id], artifact_validation: { canonical: true, validated: true, artifacts: [{ artifact_id: entry.image_id, sha256: entry.sha256 }] } });
  assert.deepEqual(M.createJobStore(path.join(x.root, 'state/jobs.json')).get(JOB).artifacts, ['partial.png']);
  assert.deepEqual(M.createJobStore(path.join(x.root, 'state/jobs.json')).get(JOB).artifacts, ['partial.png'], 'reload does not duplicate a receipt');
});
