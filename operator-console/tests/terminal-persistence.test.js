'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const M = require('../media');

test('terminal job state and its artifact receipt are persisted together before transition returns', t => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'dex-terminal-persist-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const file = path.join(root, 'jobs.json');
  const store = M.createJobStore(file);
  const id = 'persisted-terminal';
  store.create({ job_id: id, media_kind: 'image', operation: 'generate', worker_id: 'sdcpp' });
  store.transition(id, 'RUNNING');
  store.transition(id, 'COMPLETE', {
    artifacts: ['result.png'],
    artifact_validation: { canonical: true, validated: true, artifacts: [{ artifact_id: 'result.png', sha256: 'a'.repeat(64) }] },
  });
  const reopened = M.createJobStore(file);
  assert.equal(reopened.get(id).status, 'COMPLETE');
  assert.deepEqual(reopened.get(id).artifacts, ['result.png']);
  assert.equal(reopened.get(id).artifact_validation.artifacts[0].sha256, 'a'.repeat(64));
});

test('failed durable terminal write restores the prior nonterminal state', t => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'dex-terminal-fail-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const store = M.createJobStore(root); // An existing directory cannot be atomically replaced by jobs.json.
  const id = 'terminal-write-failure';
  store.create({ job_id: id, media_kind: 'image', operation: 'generate', worker_id: 'sdcpp', artifact_required: false });
  store.transition(id, 'RUNNING');
  const outcome = store.transition(id, 'COMPLETE');
  assert.match(outcome.error, /not persisted/);
  assert.equal(store.get(id).status, 'RUNNING');
});
