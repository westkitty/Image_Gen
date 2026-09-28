'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');
const { createCancellationManager } = require('../cancellation');

test('cancellation safety: stale PID or mismatched job identity fails closed against killing', async () => {
  let killedPid = null;
  const mockArbiter = { release: () => {} };
  const mockJobStore = {
    get: (id) => ({ job_id: id, status: 'RUNNING' }),
    transition: () => {}
  };

  const cancelMgr = createCancellationManager({
    arbiter: mockArbiter,
    jobStore: mockJobStore,
    onLocalTerminate: async (active) => {
      killedPid = active.pid;
    }
  });

  // Scenario 1: Missing nonce on remote job
  cancelMgr.registerActiveJob('remote-job-1', {
    pid: 99999,
    isRemote: true,
    remoteWorkDir: null, // missing work dir
    nonce: null          // missing nonce
  });

  const resUnsafe = await cancelMgr.cancelJob('remote-job-1');
  assert.equal(resUnsafe.ok, false);
  assert.equal(resUnsafe.gate, 'cancel-unsafe');
  assert.equal(killedPid, null, 'Unsafe job kill was refused');

  // Scenario 2: Properly scoped remote job cancellation
  let remoteKilled = false;
  const cancelMgrScoped = createCancellationManager({
    arbiter: mockArbiter,
    jobStore: mockJobStore,
    onRemoteTerminate: async (active) => {
      if (active.nonce === 'secret-nonce-123' && active.remoteWorkDir) {
        remoteKilled = true;
        return { ok: true };
      }
      return { ok: false, error: 'identity mismatch' };
    }
  });

  cancelMgrScoped.registerActiveJob('remote-job-2', {
    isRemote: true,
    remoteWorkDir: '/tmp/dexdiffusion-remote-work',
    nonce: 'secret-nonce-123'
  });

  const resScoped = await cancelMgrScoped.cancelJob('remote-job-2');
  assert.equal(resScoped.ok, true);
  assert.equal(remoteKilled, true);
});
