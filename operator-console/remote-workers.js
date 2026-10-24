'use strict';
// OP-7: verified remote cancellation, compute quarantine and restart reconciliation.
//
// A durable record links a local heavy job to the Big Mac work it started (run ids announced as SDCPP_RUN_ID), the
// cancellation request, the evidence gathered while stopping it, and the outcome. Invariants:
//   * A cancellation request is not evidence of a stop. Only an identity-scoped liveness check that finds nothing alive
//     (or an authoritative scan) moves a record to `cancelled_verified`.
//   * SSH failures, exit codes, timeouts and elapsed time are never evidence. They leave the record quarantined.
//   * While any record is quarantined, the heavy-compute arbiter grants nothing (`quarantineReason()`), across restarts.
//   * A human may release a quarantine; that outcome is `released_by_operator`, never "verified".
//
// Worker kinds:
//   per-run        every remote command line carries the run id (sd-cli output path / MFLUX label): stop and check by id.
//   shared-server  the work runs inside the shared sd-server (one HTTP request among others); it cannot be stopped per
//                  request without killing the server, so it stays quarantined until the scan shows no sd-server running.
//   unknown        no run identity: verified only when the owned-process scan finds no DexDiffusion work at all.
const fs = require('node:fs');
const path = require('node:path');

const STATES = ['running', 'cancel_requested', 'stop_dispatched', 'stop_pending', 'cancelled_verified', 'stop_unverified', 'orphan_suspect', 'completed', 'failed', 'released_by_operator'];
const QUARANTINE = new Set(['cancel_requested', 'stop_dispatched', 'stop_pending', 'stop_unverified', 'orphan_suspect']);
const RESOLVED = new Set(['cancelled_verified', 'completed', 'failed', 'released_by_operator']);
const RUN_ID_RE = /^20\d{6}-\d{6}-[A-Za-z0-9_-]{1,80}$/;
const MAX_EVIDENCE = 40;
const MAX_RESOLVED_KEPT = 200;

function createRemoteWorkerRegistry({ file = null, now = () => Date.now(), onChange = () => {} } = {}) {
  let records = {};
  if (file) {
    try { const d = JSON.parse(fs.readFileSync(file, 'utf8')); if (d && d.records && typeof d.records === 'object') records = d.records; } catch (_) {}
  }
  function persist() {
    if (!file) return;
    // Keep every unresolved record; trim old resolved ones.
    const resolved = Object.values(records).filter(r => RESOLVED.has(r.state)).sort((a, b) => b.updated_at - a.updated_at);
    for (const r of resolved.slice(MAX_RESOLVED_KEPT)) delete records[r.job_id];
    const tmp = file + '.tmp-' + process.pid;
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(tmp, JSON.stringify({ schema: 'dexdiffusion.remote-workers.v1', records }, null, 1));
    fs.renameSync(tmp, file);
  }
  const changed = r => { persist(); try { onChange(r); } catch (_) {} return r; };
  function evidence(r, kind, detail) {
    r.evidence.push({ at: now(), kind, detail: String(detail == null ? '' : detail).slice(0, 300) });
    if (r.evidence.length > MAX_EVIDENCE) r.evidence.splice(0, r.evidence.length - MAX_EVIDENCE);
  }
  function move(r, state, kind, detail) {
    if (!STATES.includes(state)) throw new Error('unknown worker state ' + state);
    r.state = state; r.updated_at = now();
    if (RESOLVED.has(state)) r.resolved_at = r.updated_at;
    if (kind) evidence(r, kind, detail);
    return changed(r);
  }

  function start(jobId, { action, kind = 'unknown', target = null } = {}) {
    if (records[jobId] && !RESOLVED.has(records[jobId].state)) return records[jobId];
    const t = now();
    records[jobId] = { job_id: jobId, action: action || null, kind, target, run_ids: [], state: 'running', created_at: t, updated_at: t, stop_attempts: 0, evidence: [] };
    evidence(records[jobId], 'started', `${action || 'job'} (${kind})`);
    return changed(records[jobId]);
  }
  function addRun(jobId, runId) {
    const r = records[jobId];
    if (!r || !RUN_ID_RE.test(String(runId)) || r.run_ids.includes(runId)) return r || null;
    r.run_ids.push(runId); r.updated_at = now();
    evidence(r, 'run-id', runId);
    return changed(r);
  }
  // Natural end of the local worker. A finish while a cancel is in progress is NOT a verified stop: the record keeps its
  // quarantine state and the reconciler decides from evidence.
  function finished(jobId, status) {
    const r = records[jobId];
    if (!r || RESOLVED.has(r.state)) return r || null;
    // A successful terminal result means the worker returned its completion marker after
    // remote inference, transfer, canonicalization and cleanup. Preserve that success if
    // a cancel request arrived concurrently; it is not a cancellation proof.
    if (QUARANTINE.has(r.state) && (status === 'PASS' || status === 'COMPLETE' || status === 'completed')) {
      return move(r, 'completed', 'completed-during-cancel', 'successful job completion won the cancellation race');
    }
    if (QUARANTINE.has(r.state)) { evidence(r, 'local-exit-during-cancel', `local worker ended (${status}); remote stop still to be verified`); r.updated_at = now(); return changed(r); }
    return move(r, status === 'FAIL' || status === 'failed' ? 'failed' : 'completed', 'finished', status);
  }
  const cancelRequested = (jobId, why = 'user') => { const r = records[jobId]; if (!r || RESOLVED.has(r.state)) return r || null; return QUARANTINE.has(r.state) ? r : move(r, 'cancel_requested', 'cancel-requested', why); };
  const stopDispatched = (jobId, runIds) => { const r = records[jobId]; if (!r || RESOLVED.has(r.state)) return r || null; r.stop_attempts++; return move(r, 'stop_dispatched', 'stop-dispatched', (runIds || []).join(' ') || '(no run id)'); };
  const stopPending = (jobId, detail) => { const r = records[jobId]; if (!r || RESOLVED.has(r.state)) return r || null; return move(r, 'stop_pending', 'stop-pending', detail); };
  const verified = (jobId, detail) => { const r = records[jobId]; if (!r || RESOLVED.has(r.state)) return r || null; return move(r, 'cancelled_verified', 'verified', detail); };
  const unverified = (jobId, detail) => { const r = records[jobId]; if (!r || RESOLVED.has(r.state)) return r || null; return move(r, 'stop_unverified', 'unverified', detail); };
  const note = (jobId, kind, detail) => { const r = records[jobId]; if (!r) return null; evidence(r, kind, detail); r.updated_at = now(); return changed(r); };
  function operatorRelease(jobId, detail) {
    const r = records[jobId];
    if (!r || !QUARANTINE.has(r.state)) return null;
    return move(r, 'released_by_operator', 'operator-release', detail || 'released by the operator without verification');
  }
  // After a console restart nothing of the previous process is running locally: any record that was still running or
  // stopping is suspected to have Big Mac work left and is quarantined until reconciled.
  function adoptAfterRestart() {
    const out = [];
    for (const r of Object.values(records)) if (r.state === 'running') { move(r, 'orphan_suspect', 'console-restart', 'the console restarted while this job was running'); out.push(r); }
      else if (QUARANTINE.has(r.state)) { evidence(r, 'console-restart', 'quarantine carried over a console restart'); changed(r); out.push(r); }
    return out;
  }
  const get = jobId => records[jobId] || null;
  const list = () => Object.values(records).sort((a, b) => b.updated_at - a.updated_at);
  const quarantined = () => list().filter(r => QUARANTINE.has(r.state));
  function quarantineReason() {
    const q = quarantined();
    if (!q.length) return null;
    const r = q[q.length - 1];
    return `remote stop not verified for ${r.action || 'a job'} (${r.job_id.slice(0, 8)}); heavy work is paused until reconciliation proves it stopped`;
  }
  return { start, addRun, finished, cancelRequested, stopDispatched, stopPending, verified, unverified, note, operatorRelease, adoptAfterRestart, get, list, quarantined, quarantineReason, isQuarantined: id => !!(records[id] && QUARANTINE.has(records[id].state)) };
}

// Reconciliation: decide each quarantined record from evidence only.
//   checkRun(runId)  -> { alive: n }   (throws on transport failure)
//   stopRun(runId)   -> { left: n, found: n } (throws on transport failure)
//   scanOwned()      -> { runs: [ids], sdServer: n } (throws on transport failure)
//   checkOllamaModel(record) -> { verified, detail } for kind 'ollama-model' (Chat); absent hook = cannot verify.
function createReconciler({ registry, checkRun, stopRun, scanOwned, checkOllamaModel = null, maxStopAttempts = 5, log = () => {} }) {
  let busy = false;
  async function reconcileOne(r) {
    // A Chat model record is never decided by the sd-cli/sd-server scan: only its own Ollama evidence counts.
    if (r.kind === 'ollama-model') {
      if (typeof checkOllamaModel !== 'function') throw new Error('no Ollama model check is configured');
      const c = await checkOllamaModel(r);
      if (c && c.verified === true) return registry.verified(r.job_id, c.detail || 'Ollama model cleanup verified');
      return r.state === 'stop_unverified' ? registry.note(r.job_id, 'still-unverified', (c && c.detail) || 'Ollama model cleanup not confirmed')
        : registry.unverified(r.job_id, (c && c.detail) || 'Ollama model cleanup not confirmed');
    }
    if (r.kind === 'per-run' && r.run_ids.length) {
      const alive = [];
      for (const id of r.run_ids) {
        const c = await checkRun(id);
        if (!Number.isInteger(c && c.alive)) throw new Error('liveness check returned no count for ' + id);
        if (c.alive > 0) alive.push(id);
      }
      if (!alive.length) return registry.verified(r.job_id, `identity-scoped liveness: 0 processes alive for ${r.run_ids.join(', ')}`);
      if (r.stop_attempts >= maxStopAttempts) { registry.note(r.job_id, 'still-alive', `${alive.join(', ')} still running after ${r.stop_attempts} stop attempts; quarantine kept`); return registry.unverified(r.job_id, 'escalated: remote processes survive stop attempts'); }
      registry.stopDispatched(r.job_id, alive);
      for (const id of alive) { const s = await stopRun(id); registry.note(r.job_id, 'stop-result', `${id}: found ${s.found}, left ${s.left}`); }
      return registry.stopPending(r.job_id, 'stop re-sent; awaiting a liveness check');
    }
    const scan = await scanOwned();
    if (!scan || !Array.isArray(scan.runs) || !Number.isInteger(scan.sdServer)) throw new Error('owned-process scan returned no result');
    if (r.kind === 'shared-server') {
      if (scan.sdServer === 0) return registry.verified(r.job_id, 'owned-process scan: no sd-server running on Big Mac, so the shared-server request cannot still be computing');
      registry.note(r.job_id, 'shared-server-alive', `${scan.sdServer} sd-server process(es) still running; the request may still be computing`);
      return registry.unverified(r.job_id, 'shared sd-server still running; stop it or release the quarantine explicitly');
    }
    // per-run without a recorded id, or unknown: verified only when no DexDiffusion work is visible at all.
    if (!scan.runs.length && scan.sdServer === 0) return registry.verified(r.job_id, 'owned-process scan: no DexDiffusion run and no sd-server on Big Mac');
    registry.note(r.job_id, 'owned-work-visible', `owned runs: ${scan.runs.join(', ') || 'none'}; sd-server: ${scan.sdServer}`);
    return registry.unverified(r.job_id, 'DexDiffusion work is still visible on Big Mac and cannot be attributed');
  }
  async function tick() {
    if (busy) return { skipped: true };
    busy = true;
    const results = [];
    try {
      for (const r of registry.quarantined()) {
        try { results.push({ job_id: r.job_id, state: (await reconcileOne(r)).state }); }
        catch (e) { registry.note(r.job_id, 'reconcile-error', e.message); if (r.state !== 'stop_unverified') registry.unverified(r.job_id, 'could not reach Big Mac to verify: ' + e.message); results.push({ job_id: r.job_id, state: 'stop_unverified', error: e.message }); log('reconcile ' + r.job_id + ': ' + e.message); }
      }
    } finally { busy = false; }
    return { results };
  }
  return { tick, reconcileOne };
}

module.exports = { createRemoteWorkerRegistry, createReconciler, STATES, QUARANTINE, RESOLVED, RUN_ID_RE };
