'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { genericJobCanCancel } = require('../operational-jobs');

test('generic operational projection only advertises cancellation for never-started queue records', () => {
  for (const status of ['RUNNING', 'TRANSFERRING', 'COMPLETE', 'FAILED', 'CANCELLED', 'INTERRUPTED', undefined]) {
    assert.equal(genericJobCanCancel({ status }), false, `${status} must not advertise unverified generic cancellation`);
  }
  assert.equal(genericJobCanCancel({ status: 'QUEUED' }), true);
  assert.equal(genericJobCanCancel({ status: 'queued' }), true);
  assert.equal(genericJobCanCancel(null), false);
});
