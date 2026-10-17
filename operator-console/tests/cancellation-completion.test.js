'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');
const { successfulPassAfterCancelSignal } = require('../cancellation-completion');

const stdout = 'SDCPP_RUN_ID: 20261017-040537-controlled-sd15\n==== PASS ====\n';

test('pass marker and successful remote cleanup preserve completion after cancel signal', () => {
  assert.equal(successfulPassAfterCancelSignal({
    cancelInFlight: true, exitCode: 143, stdout, stderr: 'SDCPP_REMOTE_CLEANUP: OK\n'
  }), true);
});

test('completion evidence is rejected without run identity, pass marker, or cleanup success', () => {
  for (const args of [
    { cancelInFlight: false, exitCode: 143, stdout, stderr: 'SDCPP_REMOTE_CLEANUP: OK' },
    { cancelInFlight: true, exitCode: 143, stdout: '==== PASS ====\n', stderr: 'SDCPP_REMOTE_CLEANUP: OK' },
    { cancelInFlight: true, exitCode: 143, stdout, stderr: 'SDCPP_REMOTE_CLEANUP: FAIL' },
    { cancelInFlight: true, exitCode: 143, stdout: 'SDCPP_RUN_ID: 20261017-040537-controlled-sd15\n', stderr: 'SDCPP_REMOTE_CLEANUP: OK' },
    { cancelInFlight: true, exitCode: 0, stdout, stderr: 'SDCPP_REMOTE_CLEANUP: OK' },
  ]) assert.equal(successfulPassAfterCancelSignal(args), false);
});
