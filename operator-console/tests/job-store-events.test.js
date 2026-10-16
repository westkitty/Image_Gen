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
