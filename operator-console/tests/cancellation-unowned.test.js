'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');
const { createCancellationManager } = require('../cancellation');

for (const status of ['RUNNING', 'TRANSFERRING']) {
  test(`cancellation refuses unowned durable ${status} jobs without releasing the lease`, async () => {
    const events = [];
    const transitions = [];
    const releases = [];
    const record = { job_id: `job-${status.toLowerCase()}`, status };
    const manager = createCancellationManager({
      arbiter: { release: id => releases.push(id) },
      jobStore: {
        get: id => id === record.job_id ? record : null,
        transition: (id, next, patch) => transitions.push({ id, next, patch })
      },
      eventBus: { publish: (...args) => events.push(args) }
    });

    const result = await manager.cancelJob(record.job_id);
    assert.equal(result.ok, false);
    assert.equal(result.gate, 'cancel-unsafe');
    assert.equal(result.status, status);
    assert.equal(result.remote_stop, 'unverified');
    assert.equal(record.status, status, 'durable state must remain unchanged');
    assert.deepEqual(transitions, [], 'no terminal transition may be written');
    assert.deepEqual(releases, [], 'the shared compute lease must remain held');
    assert.deepEqual(events, [], 'no cancelled event may be published');
  });
}

test('cancellation does not treat a missing durable job as a never-started queue item', async () => {
  const releases = [];
  const manager = createCancellationManager({
    arbiter: { release: id => releases.push(id) },
    jobStore: { get: () => null, transition() {} }
  });
  const result = await manager.cancelJob('not-a-job');
  assert.equal(result.ok, false);
  assert.equal(result.gate, 'job-not-found');
  assert.deepEqual(releases, []);
});
