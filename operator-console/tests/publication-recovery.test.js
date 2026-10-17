'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const M = require('../media');
const J = require('../job-contract');
const { reconcileInterruptedPublications } = require('../publication-recovery');

test('restart reconciliation completes only the exactly owned and validated publication', t => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'dexdiffusion-recovery-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const runs = path.join(root, 'runs'), runId = '20261017-010101-owned';
  const runDir = path.join(runs, runId); fs.mkdirSync(runDir, { recursive: true });
  const jobId = '11111111-1111-4111-8111-111111111111';
  fs.writeFileSync(path.join(runDir, 'job-owner.json'), JSON.stringify({ schema: 'dexdiffusion.run_owner.v1', job_id: jobId, run_id: runId }));
  fs.writeFileSync(path.join(runDir, 'controlled-manifest.json'), JSON.stringify({ status: 'PASS', run_id: runId }));
  const store = M.createJobStore(null);
  store.create({ job_id: jobId, media_kind: 'image', operation: 'controlled-generate', worker_id: 'sdcpp', params: { quantity: 1 } });
  store.transition(jobId, 'RUNNING'); store.transition(jobId, 'INTERRUPTED');
  const imageStore = {
    readRunIndex: () => [{ job_id: jobId, run_id: runId, image_id: 'owned.png', sha256: 'a'.repeat(64), bytes: 12 }],
    resolveImage: id => id === 'owned.png' ? { path: '/canonical/owned.png' } : null,
  };
  const result = reconcileInterruptedPublications({ jobStore: store, runsRoot: runs, imageStore, validateImage: () => ({ sha256: 'a'.repeat(64), bytes: 12 }) });
  assert.equal(result.recovered, 1);
  assert.equal(store.get(jobId).status, 'COMPLETE');
  assert.deepEqual(store.get(jobId).artifacts, ['owned.png']);
  assert.equal(store.get(jobId).artifact_validation.artifacts[0].sha256, 'a'.repeat(64));
});

test('restart reconciliation does not claim a publication owned by another job', t => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'dexdiffusion-recovery-owner-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const runs = path.join(root, 'runs'), runId = '20261017-010102-other';
  const runDir = path.join(runs, runId); fs.mkdirSync(runDir, { recursive: true });
  fs.writeFileSync(path.join(runDir, 'job-owner.json'), JSON.stringify({ schema: 'dexdiffusion.run_owner.v1', job_id: '22222222-2222-4222-8222-222222222222', run_id: runId }));
  fs.writeFileSync(path.join(runDir, 'controlled-manifest.json'), JSON.stringify({ status: 'PASS', run_id: runId }));
  const store = M.createJobStore(null);
  const jobId = '11111111-1111-4111-8111-111111111111';
  store.create({ job_id: jobId, media_kind: 'image', operation: 'controlled-generate', worker_id: 'sdcpp' });
  store.transition(jobId, 'RUNNING'); store.transition(jobId, 'INTERRUPTED');
  const result = reconcileInterruptedPublications({
    jobStore: store, runsRoot: runs,
    imageStore: { readRunIndex: () => [{ job_id: '22222222-2222-4222-8222-222222222222', run_id: runId, image_id: 'other.png', sha256: 'a'.repeat(64), bytes: 12 }], resolveImage: () => ({ path: '/canonical/other.png' }) },
    validateImage: () => ({ sha256: 'a'.repeat(64), bytes: 12 }),
  });
  assert.equal(result.recovered, 0);
  assert.equal(store.get(jobId).status, 'INTERRUPTED');
  assert.deepEqual(store.get(jobId).artifacts, []);
});

test('INTERRUPTED publication recovery requires exact job identity', () => {
  const job = { job_id: 'owner', status: 'INTERRUPTED', artifacts: [], artifact_required: true };
  const patch = { recovery_identity: 'other', artifacts: ['image.png'], artifact_validation: { canonical: true, validated: true, artifacts: [{ artifact_id: 'image.png', sha256: 'a'.repeat(64) }] } };
  assert.match(J.validateTransition(job, 'COMPLETE', patch), /illegal transition/);
  assert.equal(J.validateTransition(job, 'COMPLETE', { ...patch, recovery_identity: 'owner' }), null);
});
