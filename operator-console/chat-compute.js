'use strict';
// Phase 3: Chat compute admission, job lifecycle and verified release (Phase 0 contract D.5, D.6; Oct 22 handoff section 7).
//
// Invariants:
//   * Every Chat request (light Gemma included) takes the existing capacity-one 'bigmac-heavy-inference' lease, in the same
//     FIFO queue as image jobs, until a separately approved memory test proves overlap safe.
//   * The lease is granted only by the arbiter. A waiter whose request is aborted leaves the queue (arbiter.release) and a
//     grant that lands after the abort is released at once, so no lease is orphaned.
//   * Before generating, a fresh /api/ps observation must be CLEAR (no model loaded at all). OCCUPIED (anything loaded,
//     including Hermes on the same tag) and UNKNOWN (fetch failure, timeout, non-200, unparsable) both wait; neither grants.
//   * DexDiffusion only unloads the model it loaded into a CLEAR Ollama. It never unloads anything else.
//   * A stop or cleanup is 'verified' only with all three: the upstream request closed locally, Ollama acknowledged the
//     unload, and two successful /api/ps reads at least settleMs apart without the model. Absence alone never verifies.
//   * Unverified cleanup keeps the job RUNNING, the lease held and the remote-worker record quarantined (stop_unverified)
//     until the reconciler proves it or an operator releases it (released_by_operator, never "verified").
//   * Job records carry identifiers, states and numbers only: never message text, reply text or titles.

const { ollamaGetJson } = require('./chat-stream');

const ACTION = 'ollama-chat';
const KIND = 'ollama-model';

// Tri-state reading of Ollama's /api/ps. Anything other than a well-formed models array is UNKNOWN, never CLEAR.
function classifyPs(result) {
  if (!result || result.ok !== true || !result.json || !Array.isArray(result.json.models)) return { state: 'unknown', models: [] };
  const models = [];
  for (const m of result.json.models) {
    const name = m && (typeof m.name === 'string' ? m.name : typeof m.model === 'string' ? m.model : null);
    if (!name) return { state: 'unknown', models: [] };
    models.push(name);
  }
  return { state: models.length ? 'occupied' : 'clear', models };
}

function createChatCompute({
  arbiter, jobStore, remoteWorkers, cancelManager, fetchImpl = fetch, baseUrl,
  // Returns a refusal reason while Chat must not run (e.g. legacy Ollama consumers still bypass arbitration), else null.
  gate = () => null,
  log = () => {}, publish = () => {}, now = () => Date.now(),
  probeTimeoutMs = 5000, pollMs = 1000, ownershipWaitMs = 30000, unloadTimeoutMs = 10000, unloadVerifyMs = 30000, settleMs = 3000,
} = {}) {
  const live = new Map(); // job_id -> controller
  let runner = null;
  const sleep = ms => new Promise(r => { const t = setTimeout(r, ms); if (t.unref) t.unref(); });

  async function probe() {
    return classifyPs(await ollamaGetJson(fetchImpl, baseUrl, '/api/ps', probeTimeoutMs));
  }

  const terminal = id => { const j = jobStore.get(id); return !j || ['COMPLETE', 'FAILED', 'CANCELLED', 'INTERRUPTED'].includes(j.status); };
  const transition = (id, status, patch) => { if (terminal(id)) return null; const r = jobStore.transition(id, status, patch); if (r && r.error && !r.job_id) log(`chat-compute ${id} transition ${status} refused: ${r.error}`); return r; };
  const resourceChanged = () => { try { publish('resource.changed', { resources: arbiter.state() }); } catch (_) {} };

  function blockedReason() {
    const st = arbiter.state();
    return st.quarantine ? 'quarantine' : st.external && st.external.occupied ? 'external' : st.owner ? 'heavy-lease' : 'waiting';
  }

  // A request that never reached Ollama: provably not started.
  function notStarted(ctrl, why) {
    arbiter.release(ctrl.job_id);
    cancelManager.unregisterActiveJob(ctrl.job_id);
    transition(ctrl.job_id, 'CANCELLED', { error: why, first_failed_gate: 'user-cancelled-not-started' });
    if (remoteWorkers.get(ctrl.job_id)) remoteWorkers.verified(ctrl.job_id, 'no upstream request was made');
    live.delete(ctrl.job_id);
    resourceChanged();
    ctrl.settle({ verified: true, not_started: true });
    return { admitted: false, code: 'cancelled', not_started: true };
  }

  // queueTimeoutMs / ownerWaitMs bound the wait for legacy callers (Chat streams wait until aborted).
  // onStop: how the cancel-manager stop hook aborts this request (default: the Chat stream runner).
  async function admit({ session_id, request_id, model, resource_class, operation = 'chat-stream', signal, onQueued = () => {}, queueTimeoutMs = Infinity, ownerWaitMs = ownershipWaitMs, onStop = null }) {
    const refusal = gate();
    if (refusal) return { admitted: false, code: 'compute_unavailable', reason: refusal };
    if (!arbiter || !jobStore || !remoteWorkers || !cancelManager) return { admitted: false, code: 'compute_unavailable', reason: 'compute-owner-missing' };

    const job = jobStore.create({ media_kind: 'chat', operation, worker_id: 'ollama', model_id: model, resource_class, params: { request_id }, persist_text: false, artifact_required: false });
    let settle;
    const ctrl = {
      job_id: job.job_id, request_id, model, resource_class, onStop, phase: 'queued', upstreamStarted: false, upstreamClosed: false,
      cleanup: null, finalized: false, outcome: null, settled: new Promise(r => { settle = r; }), result: null,
    };
    ctrl.settle = r => { if (!ctrl.result) { ctrl.result = r; settle(r); } };
    live.set(job.job_id, ctrl);
    void session_id; // the session id is a capability for the transcript; it is never stored with the job.

    // Queue: same FIFO as image jobs. Position changes are reported; an abort leaves the queue.
    const grant = arbiter.acquire(job.job_id, `chat ${model}`);
    let lastPos = null, lastWhy = null;
    const report = () => {
      const pos = arbiter.position(job.job_id);
      if (pos === null) return;
      const why = blockedReason();
      if (pos !== lastPos || why !== lastWhy) { lastPos = pos; lastWhy = why; onQueued(pos, why); }
    };
    report();
    const onAbort = () => arbiter.release(job.job_id);
    if (signal) { if (signal.aborted) onAbort(); else signal.addEventListener('abort', onAbort, { once: true }); }
    const ticker = setInterval(report, pollMs); if (ticker.unref) ticker.unref();
    let timedOut = false, queueTimer = null;
    if (Number.isFinite(queueTimeoutMs)) { queueTimer = setTimeout(() => { timedOut = true; arbiter.release(job.job_id); }, queueTimeoutMs); if (queueTimer.unref) queueTimer.unref(); }
    let r;
    try { r = await grant; } finally { clearInterval(ticker); clearTimeout(queueTimer); if (signal) signal.removeEventListener('abort', onAbort); }
    // A grant revoked in the same tick (timeout or abort) is not ownership.
    if (r && r.granted && !arbiter.holds(job.job_id)) r = { granted: false };
    if ((!r || !r.granted) && timedOut && !(signal && signal.aborted) && !terminal(job.job_id)) {
      // Bounded wait expired: compute-busy, never started, nothing held.
      transition(job.job_id, 'CANCELLED', { error: 'Big Mac compute stayed busy for the whole wait', first_failed_gate: 'resource-wait' });
      live.delete(job.job_id);
      ctrl.settle({ verified: true, not_started: true });
      return { admitted: false, code: 'compute_unavailable', reason: 'compute-busy' };
    }
    if (!r || !r.granted) return notStarted(ctrl, 'left the queue before starting');
    if ((signal && signal.aborted) || terminal(job.job_id)) return notStarted(ctrl, 'cancelled as the lease was granted');

    ctrl.phase = 'owner-check';
    transition(job.job_id, 'RUNNING', { resource_lease: arbiter.state().group });
    remoteWorkers.start(job.job_id, { action: ACTION, kind: KIND, target: model });
    cancelManager.registerActiveJob(job.job_id, { target: ACTION, stopHook: () => stop(job.job_id) });
    resourceChanged();

    // Ownership: generate only into a CLEAR Ollama, while holding the lease.
    const deadline = now() + ownerWaitMs;
    for (;;) {
      if (signal && signal.aborted) return notStarted(ctrl, 'cancelled while checking Big Mac');
      const obs = await probe();
      if (signal && signal.aborted) return notStarted(ctrl, 'cancelled while checking Big Mac');
      if (obs.state === 'clear') break;
      remoteWorkers.note(job.job_id, 'owner-check', obs.state === 'occupied' ? `external model loaded (${obs.models.length})` : 'Ollama state unknown');
      onQueued(0, obs.state === 'occupied' ? 'external' : 'unknown');
      if (now() >= deadline) {
        arbiter.release(job.job_id);
        cancelManager.unregisterActiveJob(job.job_id);
        remoteWorkers.finished(job.job_id, 'failed');
        transition(job.job_id, 'FAILED', { error: obs.state === 'occupied' ? 'Big Mac Ollama is busy with another model' : 'Big Mac Ollama state could not be read', first_failed_gate: 'resource-wait' });
        live.delete(job.job_id);
        resourceChanged();
        ctrl.settle({ verified: true, not_started: true });
        return { admitted: false, code: 'compute_unavailable', reason: obs.state === 'occupied' ? 'external' : 'unknown' };
      }
      await sleep(pollMs);
    }
    ctrl.phase = 'generating';
    ctrl.upstreamStarted = true;
    remoteWorkers.note(job.job_id, 'owner-clear', 'no model loaded before this request; DexDiffusion owns the next load');
    return {
      admitted: true, job_id: job.job_id, keep_alive: 0,
      verifyStop: async () => ((await runCleanup(ctrl)).verified ? 'verified' : 'unverified'),
      release: (o) => finish(ctrl, o),
    };
  }

  // Unload what we loaded, then prove it is gone. Cached: double stop, disconnect and release share one cleanup.
  function runCleanup(ctrl) {
    if (ctrl.cleanup) return ctrl.cleanup;
    ctrl.upstreamClosed = true; // the runner calls this only after its upstream reader has closed
    ctrl.phase = 'releasing';
    remoteWorkers.note(ctrl.job_id, 'upstream-closed', 'local upstream request ended');
    ctrl.cleanup = (async () => {
      let unloadAck = false;
      try {
        const ctl = new AbortController();
        const t = setTimeout(() => ctl.abort(), unloadTimeoutMs);
        try {
          const res = await fetchImpl(new URL('/api/chat', baseUrl), { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ model: ctrl.model, messages: [], keep_alive: 0 }), signal: ctl.signal });
          const j = res.ok ? await res.json().catch(() => null) : null;
          unloadAck = !!(j && j.done_reason === 'unload');
        } finally { clearTimeout(t); }
      } catch (_) { unloadAck = false; }
      remoteWorkers.note(ctrl.job_id, unloadAck ? 'unload-acknowledged' : 'unload-unconfirmed', ctrl.model);
      const absent = await sustainedAbsence(ctrl.model, unloadVerifyMs);
      remoteWorkers.note(ctrl.job_id, absent ? 'model-absent' : 'model-presence-unknown', absent ? `absent in two /api/ps reads >= ${settleMs} ms apart` : 'absence not confirmed');
      return { verified: ctrl.upstreamClosed && unloadAck && absent, unloadAck, absent };
    })();
    return ctrl.cleanup;
  }

  // Two successful reads at least settleMs apart, both without the model. A failed read resets the count.
  async function sustainedAbsence(model, budgetMs) {
    const stopAt = now() + budgetMs;
    let firstAt = null;
    for (;;) {
      const obs = await probe();
      if (obs.state !== 'unknown' && !obs.models.includes(model)) {
        if (firstAt === null) firstAt = now();
        else if (now() - firstAt >= settleMs) return true;
      } else firstAt = null;
      if (now() >= stopAt) return false;
      await sleep(Math.min(pollMs, Math.max(1, settleMs)));
    }
  }

  async function finish(ctrl, { outcome, code = null } = {}) {
    if (ctrl.finalized) return ctrl.settled;
    ctrl.finalized = true;
    ctrl.outcome = { outcome, code };
    const c = await runCleanup(ctrl);
    if (c.verified) {
      complete(ctrl);
    } else {
      // Keep everything protected: lease held, job RUNNING, record quarantined.
      ctrl.phase = 'stop_unverified';
      remoteWorkers.unverified(ctrl.job_id, `model cleanup not confirmed (unload ${c.unloadAck ? 'acknowledged' : 'unconfirmed'}, absence ${c.absent ? 'seen' : 'not seen'})`);
      log(`chat-compute ${ctrl.job_id} stop_unverified`);
      ctrl.settle({ verified: false, leaseReleased: false });
    }
    return ctrl.settled;
  }

  function complete(ctrl, { operator = false } = {}) {
    const { outcome, code } = ctrl.outcome || { outcome: 'stopped' };
    const rec = remoteWorkers.get(ctrl.job_id);
    if (!operator && rec && !['cancelled_verified', 'completed', 'failed', 'released_by_operator'].includes(rec.state)) {
      if (outcome === 'done') remoteWorkers.finished(ctrl.job_id, 'COMPLETE');
      else if (outcome === 'error') remoteWorkers.finished(ctrl.job_id, 'failed');
      else remoteWorkers.verified(ctrl.job_id, 'upstream closed, unload acknowledged, model absent in sustained /api/ps reads');
    }
    // A record already left in quarantine (resolved later by the reconciler) is resolved by the registry itself.
    if (operator) transition(ctrl.job_id, 'FAILED', { error: 'Chat cleanup was released by the operator without verification', first_failed_gate: 'cleanup-failed' });
    else if (outcome === 'done') transition(ctrl.job_id, 'COMPLETE', {});
    else if (outcome === 'error') transition(ctrl.job_id, 'FAILED', { error: 'chat generation failed: ' + (code || 'error'), first_failed_gate: 'generation-failed' });
    else transition(ctrl.job_id, 'CANCELLED', { error: 'Chat stopped', first_failed_gate: 'user-cancelled' });
    const leaseReleased = arbiter.release(ctrl.job_id);
    cancelManager.unregisterActiveJob(ctrl.job_id);
    live.delete(ctrl.job_id);
    ctrl.phase = 'released';
    resourceChanged();
    ctrl.settle({ verified: !operator, leaseReleased, operator });
  }

  // Cancel-manager stop hook: request abort, then wait for the cleanup verdict. Idempotent.
  async function stop(jobId) {
    const ctrl = live.get(jobId);
    if (!ctrl) return { ok: false, verified: false, error: 'no live Chat request for this job' };
    if (ctrl.result) return { ok: true, ...ctrl.result };
    if (ctrl.onStop) ctrl.onStop();
    else if (runner) runner.stop(ctrl.request_id);
    const r = await ctrl.settled;
    return { ok: true, ...r };
  }

  // Remote-worker registry observer: a quarantined Chat record resolved by the reconciler or the operator.
  function workerChanged(rec) {
    if (!rec || rec.action !== ACTION) return;
    const ctrl = live.get(rec.job_id);
    if (!ctrl || !ctrl.finalized || ctrl.phase !== 'stop_unverified') return;
    if (rec.state === 'cancelled_verified') complete(ctrl);
    else if (rec.state === 'released_by_operator') complete(ctrl, { operator: true });
  }

  // Reconciler check for kind 'ollama-model' records (live unverified or adopted after a restart).
  // Observe only: nothing is unloaded here because ownership cannot be re-proved. Verified needs upstream-closed evidence
  // (local close, or the console restart that ended the socket) plus sustained absence.
  async function checkOllamaModel(rec) {
    const ctrl = live.get(rec.job_id);
    const upstreamClosed = ctrl ? ctrl.upstreamClosed : (rec.evidence || []).some(e => e.kind === 'console-restart' || e.kind === 'upstream-closed');
    if (!upstreamClosed) return { verified: false, detail: 'the upstream request is not known to have closed' };
    const absent = await sustainedAbsence(rec.target, Math.max(settleMs * 2, pollMs * 3));
    return absent ? { verified: true, detail: `upstream closed and ${rec.target} absent in sustained /api/ps reads` } : { verified: false, detail: `${rec.target} absence not confirmed` };
  }

  // AUTH-6: one legacy Ollama generation (Enhance, /api/ollama/chat, Drama parse) under the same lease and cleanup rules.
  // call(signal) performs the upstream request and must settle only once that request has ended (completed or aborted).
  // Returns { ok:true, value, cleanup } or { ok:false, busy|cancelled }. The lease is kept until `cleanup` proves the
  // model gone; the caller may answer its client before that, but compute stays owned and uncertain cleanup quarantines.
  async function runExclusive({ operation, model, resource_class, signal = null, waitMs = 20000, call }) {
    const ac = new AbortController();
    const link = () => ac.abort();
    if (signal) { if (signal.aborted) ac.abort(); else signal.addEventListener('abort', link, { once: true }); }
    const lease = await admit({
      request_id: 'cr_' + require('crypto').randomBytes(16).toString('hex'), model, resource_class, operation, signal: ac.signal,
      queueTimeoutMs: waitMs, ownerWaitMs: Math.max(0, Math.min(ownershipWaitMs, waitMs)), onStop: () => ac.abort(),
    });
    if (!lease || lease.admitted !== true) {
      if (signal) signal.removeEventListener('abort', link);
      return lease && lease.code === 'cancelled' ? { ok: false, cancelled: true } : { ok: false, busy: true, reason: lease && lease.reason };
    }
    let value, outcome = 'error', thrown = null;
    try {
      value = await call(ac.signal);
      outcome = ac.signal.aborted ? 'stopped' : value && value.ok === false ? 'error' : 'done';
    } catch (e) { thrown = e; outcome = ac.signal.aborted ? 'stopped' : 'error'; }
    if (signal) signal.removeEventListener('abort', link);
    const cleanup = lease.release({ outcome, code: outcome === 'error' ? 'upstream_error' : null });
    if (thrown) { thrown.cleanup = cleanup; throw thrown; }
    return { ok: true, value, stopped: outcome === 'stopped', job_id: lease.job_id, cleanup };
  }

  return {
    admit, runExclusive, probe, stop, workerChanged, checkOllamaModel,
    attachRunner(r) { runner = r; },
    holdsLive: jobId => live.has(jobId),
    describe: () => [...live.values()].map(c => ({ job_id: c.job_id, model: c.model, phase: c.phase })),
  };
}

module.exports = { createChatCompute, classifyPs, ACTION, KIND };
