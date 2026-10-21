'use strict';

// T-101..T-104 — cancellation truth.
// A job may only become CANCELLED when it provably never started, or when its exact registered
// worker process was verified stopped. A request, a timeout, a released lease or a durable record
// with no owner is never termination evidence (I-03).
const assert = require('node:assert/strict');
const test = require('node:test');
const { EventEmitter } = require('node:events');
const { createCancellationManager } = require('../cancellation');

function fixture({ status = 'RUNNING', record = true } = {}) {
  const state = { released: [], transitions: [], events: [], job: record ? { job_id: 'job-1', status } : null };
  const jobStore = {
    get: id => (state.job && state.job.job_id === id ? state.job : null),
    transition: (id, st, patch = {}) => {
      if (!state.job || state.job.job_id !== id) return { error: 'unknown job' };
      state.job = { ...state.job, status: st, ...patch };
      state.transitions.push({ id, status: st, patch });
      return state.job;
    }
  };
  const arbiter = { release: id => state.released.push(id) };
  const eventBus = { publish: (name, payload) => state.events.push({ name, payload }) };
  return { state, jobStore, arbiter, eventBus };
}

test('T-101 an unowned durable RUNNING job is refused, never relabelled CANCELLED', async () => {
  const { state, jobStore, arbiter, eventBus } = fixture({ status: 'RUNNING' });
  const mgr = createCancellationManager({ arbiter, jobStore, eventBus });

  const res = await mgr.cancelJob('job-1', { reason: 'user' });

  assert.equal(res.ok, false, 'a request is not evidence: ok must be false');
  assert.equal(res.gate, 'cancel-unsafe');
  assert.equal(res.cancelState, 'refused_unsafe');
  assert.equal(res.terminationVerified, false);
  assert.equal(res.neverStarted, false);
  assert.equal(res.leaseReleased, false);
  assert.equal(res.status, 'RUNNING');
  assert.equal(state.job.status, 'RUNNING', 'durable state is unchanged');
  assert.deepEqual(state.transitions, [], 'no state transition was attempted');
  assert.deepEqual(state.released, [], 'the heavy-compute lease is never released without stop proof');
  assert.deepEqual(state.events, [], 'no job.cancelled event is published');
});

test('T-101 TRANSFERRING without an owner is refused exactly like RUNNING', async () => {
  const { state, jobStore, arbiter } = fixture({ status: 'TRANSFERRING' });
  const mgr = createCancellationManager({ arbiter, jobStore });
  const res = await mgr.cancelJob('job-1');
  assert.equal(res.ok, false);
  assert.equal(res.cancelState, 'refused_unsafe');
  assert.equal(state.job.status, 'TRANSFERRING');
  assert.deepEqual(state.released, []);
});

test('T-101 a queued job that provably never started is cancelled with not-started evidence', async () => {
  const { state, jobStore, arbiter, eventBus } = fixture({ status: 'QUEUED' });
  const mgr = createCancellationManager({ arbiter, jobStore, eventBus });

  const res = await mgr.cancelJob('job-1', { reason: 'queued cancel' });

  assert.equal(res.ok, true);
  assert.equal(res.status, 'CANCELLED');
  assert.equal(res.immediate, true);
  assert.equal(res.cancelState, 'not_started');
  assert.equal(res.neverStarted, true);
  assert.equal(res.terminationVerified, true, 'never having started is itself the proof');
  assert.equal(state.job.status, 'CANCELLED');
  assert.equal(state.released.length, 1, 'the queue slot is released');
  assert.equal(state.events.length, 1);
  assert.equal(state.events[0].name, 'job.cancelled');
});

test('T-101 an unknown job is refused instead of fabricated as CANCELLED', async () => {
  const { state, jobStore, arbiter } = fixture({ record: false });
  const mgr = createCancellationManager({ arbiter, jobStore });
  const res = await mgr.cancelJob('does-not-exist');
  assert.equal(res.ok, false);
  assert.equal(res.gate, 'unknown-job');
  assert.deepEqual(state.released, []);
});

test('T-101 terminal jobs answer idempotently and never rewrite history', async () => {
  for (const status of ['COMPLETE', 'FAILED', 'CANCELLED', 'INTERRUPTED']) {
    const { state, jobStore, arbiter } = fixture({ status });
    const mgr = createCancellationManager({ arbiter, jobStore });
    const res = await mgr.cancelJob('job-1');
    assert.equal(res.ok, false, status);
    assert.equal(res.alreadyTerminal, true, status);
    assert.equal(res.status, status);
    assert.deepEqual(state.transitions, [], status);
    assert.deepEqual(state.released, [], status);
  }
});

test('T-101 repeated cancel is safe and cannot double-release a lease', async () => {
  const { state, jobStore, arbiter } = fixture({ status: 'QUEUED' });
  const mgr = createCancellationManager({ arbiter, jobStore });
  const first = await mgr.cancelJob('job-1');
  const second = await mgr.cancelJob('job-1');
  assert.equal(first.ok, true);
  assert.equal(second.ok, false);
  assert.equal(second.alreadyTerminal, true);
  assert.equal(state.released.length, 1, 'released once, not twice');
});

test('T-101 a missing job id is refused, not treated as a queued cancel', async () => {
  const { state, jobStore, arbiter } = fixture({ status: 'QUEUED' });
  const mgr = createCancellationManager({ arbiter, jobStore });
  const res = await mgr.cancelJob('');
  assert.equal(res.ok, false);
  assert.equal(res.gate, 'missing-id');
  assert.deepEqual(state.released, []);
});

test('T-103 a remote job with job-scoped identity can only stop through its own nonce', async () => {
  const { state, jobStore, arbiter } = fixture({ status: 'RUNNING' });
  let asked = null;
  const mgr = createCancellationManager({
    arbiter, jobStore,
    onRemoteTerminate: async active => { asked = active; return { ok: true, verified: true, detail: 'no run processes left' }; }
  });
  mgr.registerActiveJob('job-1', { isRemote: true, remoteWorkDir: '/tmp/dex-run-1', nonce: 'nonce-1' });

  const res = await mgr.cancelJob('job-1');

  assert.equal(res.ok, true);
  assert.equal(res.cancelState, 'verified_stopped');
  assert.equal(res.terminationVerified, true);
  assert.equal(asked.nonce, 'nonce-1');
  assert.equal(asked.remoteWorkDir, '/tmp/dex-run-1');
  assert.equal(state.job.status, 'CANCELLED');
  assert.equal(state.released.length, 1);
});

test('T-103 an unverified remote hook neither terminalizes nor releases the lease', async () => {
  const { state, jobStore, arbiter } = fixture({ status: 'RUNNING' });
  const mgr = createCancellationManager({
    arbiter, jobStore,
    onRemoteTerminate: async () => ({ ok: true, verified: false, detail: 'ssh timed out' })
  });
  mgr.registerActiveJob('job-1', { isRemote: true, remoteWorkDir: '/tmp/dex-run-1', nonce: 'nonce-1' });

  const res = await mgr.cancelJob('job-1');

  assert.equal(res.ok, false);
  assert.equal(res.accepted, true, 'the request was accepted…');
  assert.equal(res.cancelState, 'requested');
  assert.equal(res.gate, 'remote-stop-unverified', '…but it is not termination proof');
  assert.equal(res.leaseReleased, false);
  assert.equal(state.job.status, 'RUNNING');
  assert.deepEqual(state.released, []);
});

test('T-103 remote cancellation without a nonce fails closed before calling the hook', async () => {
  const { state, jobStore, arbiter } = fixture({ status: 'RUNNING' });
  let called = false;
  const mgr = createCancellationManager({
    arbiter, jobStore,
    onRemoteTerminate: async () => { called = true; return { ok: true }; }
  });
  mgr.registerActiveJob('job-1', { isRemote: true, remoteWorkDir: null, nonce: null });

  const res = await mgr.cancelJob('job-1');
  assert.equal(res.ok, false);
  assert.equal(res.gate, 'cancel-unsafe');
  assert.equal(called, false);
  assert.equal(state.job.status, 'RUNNING');
  assert.deepEqual(state.released, []);
});

test('T-102 a worker declaring cancel_supported:false is never offered a stop', async () => {
  const { state, jobStore, arbiter } = fixture({ status: 'RUNNING' });
  const mgr = createCancellationManager({
    arbiter, jobStore,
    workerCapabilities: () => ({ cancel_supported: false, cancel_reason: 'This job runs to completion.' }),
    onLocalTerminate: async () => ({ ok: true })
  });
  mgr.registerActiveJob('job-1', {});
  const cap = mgr.describeCancelCapability('job-1');
  assert.equal(cap.canCancel, false);
  assert.equal(cap.cancelCapability, 'unsupported');
  const res = await mgr.cancelJob('job-1');
  assert.equal(res.ok, false);
  assert.equal(res.cancelState, 'refused_unsupported');
  assert.match(res.error, /runs to completion/);
  assert.equal(state.job.status, 'RUNNING');
  assert.deepEqual(state.released, []);
});

test('T-102 capability projection agrees with what the route would do', async () => {
  const { jobStore, arbiter } = fixture({ status: 'QUEUED' });
  const mgr = createCancellationManager({ arbiter, jobStore });
  assert.deepEqual(
    (({ canCancel, cancelCapability }) => ({ canCancel, cancelCapability }))(mgr.describeCancelCapability('job-1')),
    { canCancel: true, cancelCapability: 'queued_only' }
  );
  assert.equal(mgr.describeCancelCapability('missing').canCancel, false);

  // An unowned running job must not be advertised: the route would refuse it.
  const unowned = fixture({ status: 'RUNNING' });
  const mgr2 = createCancellationManager({ arbiter: unowned.arbiter, jobStore: unowned.jobStore });
  const cap = mgr2.describeCancelCapability('job-1');
  assert.equal(cap.canCancel, false);
  assert.equal(cap.cancelCapability, 'unknown');
  const res = await mgr2.cancelJob('job-1');
  assert.equal(res.ok, cap.canCancel, 'snapshot and route cannot disagree');
});

test('T-103 a local process that really exits is verified stopped', async () => {
  const { state, jobStore, arbiter } = fixture({ status: 'RUNNING' });
  const child = new EventEmitter();
  child.kill = () => { setImmediate(() => child.emit('exit', 0, 'SIGTERM')); return true; };
  child.exitCode = null; child.signalCode = null;

  const mgr = createCancellationManager({ arbiter, jobStore, localExitTimeoutMs: 1000 });
  mgr.registerActiveJob('job-1', { process: child, pid: 4242 });

  const res = await mgr.cancelJob('job-1');
  assert.equal(res.ok, true);
  assert.equal(res.cancelState, 'verified_stopped');
  assert.equal(state.job.status, 'CANCELLED');
  assert.equal(state.released.length, 1);
});

test('T-103 a local process that never exits stays RUNNING and keeps its lease', async () => {
  const { state, jobStore, arbiter } = fixture({ status: 'RUNNING' });
  const child = new EventEmitter();
  child.kill = () => true; // signal ignored; no exit event
  child.exitCode = null; child.signalCode = null;

  const mgr = createCancellationManager({ arbiter, jobStore, localExitTimeoutMs: 120 });
  mgr.registerActiveJob('job-1', { process: child, pid: 4243 });

  const res = await mgr.cancelJob('job-1');
  assert.equal(res.ok, false);
  assert.equal(res.gate, 'local-stop-unverified');
  assert.equal(res.terminationVerified, false);
  assert.equal(res.leaseReleased, false);
  assert.equal(state.job.status, 'RUNNING');
  assert.deepEqual(state.released, []);
});

test('T-103 a job-owned stop hook that refuses keeps the job running', async () => {
  const { state, jobStore, arbiter } = fixture({ status: 'RUNNING' });
  const mgr = createCancellationManager({
    arbiter, jobStore,
    workerCapabilities: () => ({ cancel_supported: true, cancel_scope: 'stop-after-current' }),
    onLocalTerminate: async () => ({ ok: false, error: 'producer refused' })
  });
  mgr.registerActiveJob('job-1', {});
  const res = await mgr.cancelJob('job-1');
  assert.equal(res.ok, false);
  assert.equal(res.gate, 'local-cancel-failed');
  assert.equal(state.job.status, 'RUNNING');
  assert.deepEqual(state.released, []);
});

test('T-103 a job-owned stop hook (stop-after-current) is reported as such', async () => {
  const { state, jobStore, arbiter } = fixture({ status: 'RUNNING' });
  let hooked = false;
  const mgr = createCancellationManager({
    arbiter, jobStore,
    workerCapabilities: () => ({ cancel_supported: true, cancel_scope: 'stop-after-current' }),
    onLocalTerminate: async () => { hooked = true; return { ok: true, verified: false, stop_after_current: true } }
  });
  mgr.registerActiveJob('job-1', {});
  const res = await mgr.cancelJob('job-1');
  assert.equal(hooked, true);
  assert.equal(res.ok, false);
  assert.equal(res.accepted, true);
  assert.equal(res.cancelState, 'stop_after_current');
  assert.equal(state.job.status, 'RUNNING');
  assert.equal(state.released.length, 0);
});


test('T-103 an undefined owner hook response cannot release the lease', async () => {
  const { state, jobStore, arbiter } = fixture({ status: 'RUNNING' });
  const mgr = createCancellationManager({ arbiter, jobStore,
    workerCapabilities: () => ({ cancel_supported: true, cancel_scope: 'stop-after-current' }),
    onLocalTerminate: async () => undefined });
  mgr.registerActiveJob('job-1', {});
  const res = await mgr.cancelJob('job-1');
  assert.equal(res.ok, false);
  assert.equal(res.gate, 'local-stop-unverified');
  assert.equal(state.job.status, 'RUNNING');
  assert.deepEqual(state.released, []);
});

test('T-103 an explicit verified owner result is required for final cancellation', async () => {
  const { state, jobStore, arbiter } = fixture({ status: 'RUNNING' });
  const mgr = createCancellationManager({ arbiter, jobStore,
    workerCapabilities: () => ({ cancel_supported: true, cancel_scope: 'stop-after-current' }),
    onLocalTerminate: async () => ({ ok: true, verified: true, detail: 'owner exited' }) });
  mgr.registerActiveJob('job-1', {});
  const res = await mgr.cancelJob('job-1');
  assert.equal(res.ok, true);
  assert.equal(res.terminationVerified, true);
  assert.equal(state.job.status, 'CANCELLED');
  assert.deepEqual(state.released, ['job-1']);
});
