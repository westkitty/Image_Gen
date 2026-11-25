'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const M = require('../media');
const O = require('../operational-jobs');

test('job store reports lifecycle changes through onChange with the job, never with private params', () => {
  const seen = [];
  const s = M.createJobStore(null, { onChange: (kind, job) => seen.push([kind, job.status, JSON.stringify(job.params)]) });
  const j = s.create({ media_kind: 'voice', operation: 'drama-production', worker_id: 'drama-producer', params: { project_id: 'dp-1', text: 'SECRET LINE' } });
  s.transition(j.job_id, 'RUNNING', { progress: { phase: 'planning' } });
  s.transition(j.job_id, 'RUNNING', { progress: { phase: 'rendering', done: 1, total: 4 } });
  s.transition(j.job_id, 'FAILED', { first_failed_gate: 'x', error: 'boom' });
  assert.deepEqual(seen.map(x => x[0]), ['created', 'started', 'progress', 'failed']);
  assert.ok(seen.every(x => !x[2].includes('SECRET')), 'redacted params');
});

test('a throwing observer never breaks the job lifecycle', () => {
  const s = M.createJobStore(null, { onChange: () => { throw new Error('observer exploded'); } });
  const j = s.create({ media_kind: 'voice', operation: 'x', worker_id: 'w' });
  assert.doesNotThrow(() => s.transition(j.job_id, 'RUNNING'));
  assert.equal(s.get(j.job_id).status, 'RUNNING');
});

test('illegal transitions notify nobody', () => {
  const seen = []; const s = M.createJobStore(null, { onChange: k => seen.push(k) });
  const j = s.create({ media_kind: 'voice', operation: 'x', worker_id: 'w' }); s.transition(j.job_id, 'FAILED', { first_failed_gate: 'g', error: 'e' });
  seen.length = 0; assert.ok(s.transition(j.job_id, 'RUNNING').error); assert.deepEqual(seen, []);
});

test('generic job progress becomes measured percentages only when counts exist', () => {
  assert.deepEqual(O.projectGenericProgress({ phase: 'generating', done: 3, total: 12 }), { currentRun: 1, totalRuns: 1, currentRunPercent: 25, totalPercent: 25, step: 3, totalSteps: 12 });
  assert.equal(O.projectGenericProgress({ phase: 'loading-model' }), null, 'no counts → indeterminate, never a made-up percentage');
  assert.equal(O.projectGenericProgress({ done: 5, total: 0 }), null);
  assert.equal(O.projectGenericProgress(null), null);
  assert.equal(O.projectGenericProgress({ done: 9, total: 4 }).totalPercent, 100);
});

test('job labels come from the safe progress label and fall back to the operation', () => {
  assert.equal(O.genericJobLabel({ operation: 'drama-production', progress: { label: 'Scene 2/5 · line 14/40' } }), 'Scene 2/5 · line 14/40');
  assert.equal(O.genericJobLabel({ operation: 'speech', progress: null }), 'speech');
  assert.equal(O.genericJobLabel({ operation: 'x', progress: { label: 'a'.repeat(300) } }).length, 120);
});

test('admission persists before notification, refuses duplicate IDs, and preserves corrupt ledgers', t => {
  const fs = require('node:fs');
  const os = require('node:os');
  const path = require('node:path');
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'dex-job-admission-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const file = path.join(dir, 'jobs.json');
  const observed = [];
  const store = M.createJobStore(file, { onChange: (_, job) => {
    observed.push(JSON.parse(fs.readFileSync(file, 'utf8')).jobs.find(item => item.job_id === job.job_id)?.status);
  } });
  const request = { media_kind: 'image', operation: 'controlled-generate', worker_id: 'sdcpp' };
  const job = store.create({ ...request, job_id: 'kept' });
  assert.deepEqual(observed, ['QUEUED']);
  assert.throws(() => store.create({ ...request, job_id: 'kept' }), /already exists/);
  assert.equal(store.get('kept'), job);

  const invalid = '{ "schema": "dexdiffusion.jobs.v1", "jobs": [null] }';
  fs.writeFileSync(file, invalid);
  const blocked = M.createJobStore(file);
  assert.throws(() => blocked.create({ ...request, job_id: 'blocked' }), /invalid job ledger/);
  assert.equal(blocked.get('blocked'), null);
  assert.equal(fs.readFileSync(file, 'utf8'), invalid);
});
