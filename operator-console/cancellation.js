'use strict';

// F14: Actual cancellation engine
// Queued jobs: cancel immediately. Status becomes CANCELLED with `not_started` proof.
// Local active jobs: terminate the exact registered process/group, verify exit, release lease.
// Remote Big Mac jobs: verified job identity markers / nonce; fail closed against killing unrelated work.
// Never: pkill node, killall python, killall sd-cli.
//
// T-101: A durable RUNNING/TRANSFERRING job with no verified process owner is NEVER finalized as
// CANCELLED. A request, a timeout or a released lease is not termination evidence. Such a job keeps
// its state and its heavy lease (quarantined) until reconciliation proves what happened.
//
// T-104 response contract (all fields always present on the structured result):
//   ok                   request accepted AND the resulting state is truthful (backward compatible)
//   status               resulting (or unchanged) job status
//   accepted             the cancellation request was acted on at all
//   alreadyTerminal      the job had already finished before this request
//   neverStarted         proven never dispatched, so no worker could be running
//   terminationVerified  a worker/process was proven stopped (null when not applicable)
//   cancelState          not_started | verified_stopped | stop_after_current | requested | refused_unsafe |
//                        refused_unsupported | already_terminal | unknown
//   leaseReleased        the heavy-compute lease was released by this call
//   gate / error         machine + human readable refusal reason

const TERMINAL = new Set(['COMPLETE', 'FAILED', 'CANCELLED', 'INTERRUPTED']);

function normalizeStatus(value) {
  return value == null ? null : String(value).toUpperCase();
}

function createCancellationManager({
  arbiter,
  jobStore,
  eventBus,
  onLocalTerminate = null,
  onRemoteTerminate = null,
  // Optional resolver: ({ jobId, record, active }) => { cancel_supported, cancel_scope, cancel_reason }
  // Lets the owning worker contract decide whether a mid-run stop is even offered.
  workerCapabilities = null,
  // How long a locally signalled process gets to exit before the stop is reported unverified.
  localExitTimeoutMs = 5000
} = {}) {
  const activeProcesses = new Map(); // jobId -> { pid, process, target, startTime, nonce, remoteWorkDir }

  function registerActiveJob(jobId, meta = {}) {
    activeProcesses.set(jobId, {
      jobId,
      pid: meta.pid || null,
      process: meta.process || null,
      target: meta.target || null,
      nonce: meta.nonce || null,
      remoteWorkDir: meta.remoteWorkDir || null,
      isRemote: Boolean(meta.isRemote),
      // Job-owned stop that also finalizes its own job and lease (Chat): ({ reason }) => { ok, verified, leaseReleased, not_started }
      stopHook: typeof meta.stopHook === 'function' ? meta.stopHook : null,
      startedAt: Date.now()
    });
  }

  function unregisterActiveJob(jobId) {
    activeProcesses.delete(jobId);
  }

  function declaredCapability(jobId, record, active) {
    if (typeof workerCapabilities !== 'function') return null;
    try { return workerCapabilities({ jobId, record, active }) || null; } catch (_) { return null; }
  }

  // A process registration only counts as ownership when it names something we can stop and verify.
  function hasTerminationPath(active) {
    if (!active) return false;
    if (active.stopHook) return true;
    if (active.isRemote) return Boolean(active.nonce && active.remoteWorkDir && typeof onRemoteTerminate === 'function');
    if (active.process && typeof active.process.kill === 'function') return true;
    if (active.pid && typeof onLocalTerminate === 'function') return true;
    // An arbitrary registered job is not sufficient proof of a stoppable worker.
    // A job-owned stop-after-current path is advertised only by a declared worker contract.
    return false;
    return false;
  }

  // Single source of truth for "may this job be cancelled right now, and how truthfully".
  function describeCancelCapability(jobId, { record = null, active = null } = {}) {
    const rec = record !== undefined && record !== null ? record : (jobStore ? jobStore.get(jobId) : null);
    const act = active !== undefined && active !== null ? active : (activeProcesses.get(jobId) || null);
    const status = normalizeStatus(rec && rec.status);

    if (!rec) {
      return { canCancel: false, cancelCapability: 'unknown', cancelState: 'unknown',
        reason: 'No durable record exists for this job, so nothing can be verified stopped.' };
    }
    if (TERMINAL.has(status)) {
      return { canCancel: false, cancelCapability: 'terminal', cancelState: 'already_terminal',
        reason: `This job already finished (${status}).` };
    }
    if (status === 'QUEUED' && !act) {
      return { canCancel: true, cancelCapability: 'queued_only', cancelState: 'not_started',
        reason: 'This job has not started, so it can be cancelled immediately.' };
    }

    const declared = declaredCapability(jobId, rec, act);
    if (declared && declared.cancel_supported === false && !(status === 'QUEUED' && !act)) {
      return { canCancel: false, cancelCapability: 'unsupported', cancelState: 'refused_unsupported',
        reason: declared.cancel_reason || 'This type of job cannot be stopped once it starts.' };
    }

    if (!(hasTerminationPath(act) || (declared && declared.cancel_scope === 'stop-after-current' && typeof onLocalTerminate === 'function' && !!act))) {
      // T-101: the unsafe case. RUNNING/TRANSFERRING without a verified owner.
      return { canCancel: false, cancelCapability: 'unknown', cancelState: 'refused_unsafe',
        reason: 'This job is marked running but no worker process is registered for it, so a stop cannot be verified. It stays running until reconciliation.' };
    }

    if (declared && declared.cancel_scope === 'stop-after-current') {
      return { canCancel: true, cancelCapability: 'stop_after_current', cancelState: 'stop_after_current',
        reason: 'The work already running will finish; nothing further will be started.' };
    }
    return { canCancel: true, cancelCapability: 'running_verified', cancelState: 'verified_stopped',
      reason: 'A job-scoped stop is available and its result is verified.' };
  }

  function refuse(jobId, { gate, cancelState, status = null, reason, error = null }) {
    return {
      ok: false, accepted: false, status: status || undefined,
      cancelState, gate, error: error || reason,
      alreadyTerminal: cancelState === 'already_terminal',
      neverStarted: false, terminationVerified: false, leaseReleased: false
    };
  }

  function releaseLease(jobId) {
    if (!arbiter) return false;
    try { arbiter.release(jobId); return true; } catch (_) { return false; }
  }

  function finalize(jobId, reason, patch = {}) {
    if (jobStore && jobStore.get(jobId)) {
      const out = jobStore.transition(jobId, 'CANCELLED', { error: reason, first_failed_gate: 'user-cancelled', ...patch });
      // A transition failure is a bare { error } with no job record; a successful transition returns the
      // job itself (which legitimately carries an `error` field holding the cancellation reason).
      if (out && out.error && out.job_id === undefined) return { ok: false, error: out.error };
    }
    if (eventBus) {
      try { eventBus.publish('job.cancelled', { id: jobId, reason, status: 'CANCELLED' }); } catch (_) {}
    }
    return { ok: true };
  }

  // Wait for an actual exit event. A kill() call alone is never termination proof (I-03).
  function awaitLocalExit(child, timeoutMs) {
    if (!child) return Promise.resolve(false);
    if (child.exitCode !== null && child.exitCode !== undefined) return Promise.resolve(true);
    if (child.signalCode) return Promise.resolve(true);
    if (typeof child.once !== 'function') return Promise.resolve(false);
    return new Promise(resolve => {
      let settled = false;
      let escalate = null;
      let giveUp = null;
      const finish = (ok) => {
        if (settled) return;
        settled = true;
        if (escalate) clearTimeout(escalate);
        if (giveUp) clearTimeout(giveUp);
        resolve(ok);
      };
      try { child.once('exit', () => finish(true)); } catch (_) { return finish(false); }
      // Bounded: escalate once, then report the stop as unverified rather than waiting forever.
      escalate = setTimeout(() => {
        try { child.kill('SIGKILL'); } catch (_) {}
        giveUp = setTimeout(() => finish(false), Math.max(100, Math.min(1200, Math.floor(timeoutMs / 4))));
      }, timeoutMs);
    });
  }

  async function cancelJob(jobId, { reason = 'User requested cancellation' } = {}) {
    if (!jobId) {
      return refuse(null, { gate: 'missing-id', cancelState: 'unknown', reason: 'A job id is required.' });
    }

    const active = activeProcesses.get(jobId) || null;
    const record = jobStore ? jobStore.get(jobId) : null;
    const currentStatus = record ? normalizeStatus(record.status) : null;

    if (record && TERMINAL.has(currentStatus)) {
      return refuse(jobId, {
        gate: 'already-terminal', cancelState: 'already_terminal', status: currentStatus,
        reason: `Cannot cancel job in terminal state: ${currentStatus}`
      });
    }

    // ---- 1. Queued and proven never started -------------------------------------------------
    // Only when no worker registration exists: an active registration means execution began.
    if ((record && currentStatus === 'QUEUED' && !active) || (!record && !active)) {
      if (!record) {
        return refuse(jobId, {
          gate: 'unknown-job', cancelState: 'unknown',
          reason: 'No durable record exists for this job, so there is nothing to cancel.'
        });
      }
      const fin = finalize(jobId, reason, { first_failed_gate: 'user-cancelled-not-started' });
      if (!fin.ok) return refuse(jobId, { gate: 'state-write-failed', cancelState: 'unknown', reason: fin.error });
      const leaseReleased = releaseLease(jobId);
      unregisterActiveJob(jobId);
      return {
        ok: true, accepted: true, status: 'CANCELLED', immediate: true,
        alreadyTerminal: false, neverStarted: true, terminationVerified: true,
        cancelState: 'not_started', leaseReleased,
        evidence: { kind: 'not_started', detail: 'never dispatched; no worker process existed' }
      };
    }

    // ---- 2. Worker contract first: an unsupported mid-run stop is never offered ---------
    const declared = declaredCapability(jobId, record, active);
    if (declared && declared.cancel_supported === false) {
      return refuse(jobId, {
        gate: 'cancel-unsupported', cancelState: 'refused_unsupported', status: currentStatus,
        reason: declared.cancel_reason || 'This type of job cannot be stopped once it starts.',
        error: declared.cancel_reason || 'This job cannot be stopped while it is running.'
      });
    }

    // ---- 3. Running without a verified owner: refuse, keep state and lease ---------------
    if (!(hasTerminationPath(active) || (declared && declared.cancel_scope === 'stop-after-current' && typeof onLocalTerminate === 'function' && !!active))) {
      return refuse(jobId, {
        gate: 'cancel-unsafe', cancelState: 'refused_unsafe', status: currentStatus,
        error: 'Cancellation refused: this job is marked running but no process owner is registered for it. ' +
          'The job keeps running and its heavy-compute lease is held until reconciliation proves the worker stopped.'
      });
    }

    // ---- 4. Active, job-owned stop ------------------------------------------------------
    let terminationVerified = false;
    let evidence = null;

    // 4a. Owner-finalized stop (Chat): the owner proves the stop, transitions its own job and releases its own lease, so
    // this manager neither finalizes nor releases. Unverified keeps the job, the lease and the quarantine.
    if (active.stopHook) {
      let res;
      try { res = await active.stopHook({ reason }); } catch (err) {
        return refuse(jobId, { gate: 'local-cancel-failed', cancelState: 'requested', status: currentStatus, error: err.message });
      }
      const after = jobStore && jobStore.get(jobId) ? normalizeStatus(jobStore.get(jobId).status) : currentStatus;
      if (res && res.ok === true && res.verified === true) {
        return {
          ok: true, accepted: true, status: after, immediate: false,
          alreadyTerminal: false, neverStarted: res.not_started === true, terminationVerified: true,
          cancelState: res.not_started === true ? 'not_started' : 'verified_stopped', leaseReleased: res.leaseReleased === true,
          evidence: { kind: res.not_started === true ? 'not_started' : 'verified', detail: res.not_started === true ? 'no upstream request was made' : 'upstream closed, unload acknowledged, model absent' }
        };
      }
      return {
        ok: false, accepted: !!(res && res.ok === true), status: after,
        alreadyTerminal: false, neverStarted: false, terminationVerified: false,
        cancelState: 'requested', leaseReleased: false, gate: 'remote-stop-unverified',
        error: (res && res.error) || 'The stop was requested but the model cleanup on Big Mac is not confirmed. The job, its lease and the quarantine are kept until reconciliation.'
      };
    }

    if (active.isRemote) {
      // Remote contract: exact job-scoped nonce and remote work directory, never a broad kill.
      if (!active.nonce || !active.remoteWorkDir) {
        return refuse(jobId, {
          gate: 'cancel-unsafe', cancelState: 'refused_unsafe', status: currentStatus,
          error: 'Remote cancellation refused: lack of job-scoped identity marker'
        });
      }
      try {
        const res = await onRemoteTerminate(active);
        if (!res || res.ok === false) {
          return refuse(jobId, {
            gate: 'remote-cancel-failed', cancelState: 'requested', status: currentStatus,
            error: (res && res.error) || 'Remote termination hook failed'
          });
        }
        terminationVerified = res.verified !== false;
        evidence = { kind: terminationVerified ? 'verified' : 'unverified', detail: res.detail || 'remote stop hook' };
      } catch (e) {
        return refuse(jobId, { gate: 'remote-cancel-exception', cancelState: 'requested', status: currentStatus, error: e.message });
      }
      if (!terminationVerified) {
        // Accepted request, but no proof. Fail closed: keep the job and the lease.
        return {
          ok: false, accepted: true, status: currentStatus,
          alreadyTerminal: false, neverStarted: false, terminationVerified: false,
          cancelState: 'requested', leaseReleased: false, gate: 'remote-stop-unverified',
          error: 'The stop was requested but the remote worker is not confirmed stopped. Heavy work stays paused until reconciliation.'
        };
      }
    } else if (active.process && typeof active.process.kill === 'function') {
      try {
        const alreadyExited = (active.process.exitCode !== null && active.process.exitCode !== undefined) || !!active.process.signalCode;
        if (alreadyExited) {
          terminationVerified = true;
        } else {
          // Attach the exit listener before signalling so a fast exit is never missed.
          const exited = awaitLocalExit(active.process, localExitTimeoutMs);
          try { active.process.kill('SIGTERM'); } catch (err) {
            return refuse(jobId, { gate: 'local-cancel-failed', cancelState: 'requested', status: currentStatus, error: `Local termination failed: ${err.message}` });
          }
          terminationVerified = await exited;
        }
        evidence = { kind: terminationVerified ? 'verified' : 'unverified', detail: 'local process exit' };
      } catch (err) {
        return refuse(jobId, { gate: 'local-cancel-failed', cancelState: 'requested', status: currentStatus, error: err.message });
      }
      if (!terminationVerified) {
        return {
          ok: false, accepted: true, status: currentStatus,
          alreadyTerminal: false, neverStarted: false, terminationVerified: false,
          cancelState: 'requested', leaseReleased: false, gate: 'local-stop-unverified',
          error: 'The local process was signalled but its exit could not be verified. The job and its lease are held.'
        };
      }
    } else {
      // Job-owned stop hook (queue/stop-after-current). Its own result is the evidence.
      let ownerAccepted = false;
      if (typeof onLocalTerminate !== 'function') {
        return refuse(jobId, {
          gate: 'cancel-unsafe', cancelState: 'refused_unsafe', status: currentStatus,
          error: 'No verified termination path exists for this job.'
        });
      }
      try {
        const res = await onLocalTerminate(active);
        if (res && res.ok === false) {
          return refuse(jobId, {
            gate: 'local-cancel-failed', cancelState: 'requested', status: currentStatus,
            error: res.error || 'The job owner refused the stop.'
          });
        }
        ownerAccepted = !!res && res.ok === true;
        // A hook returning undefined, {ok:true}, or a sent signal is NOT exit proof.
        // Do not release the heavy lease until the exact owner confirms termination.
        terminationVerified = !!res && res.ok === true && res.verified === true;
        if (!terminationVerified && res && res.ok === true && res.stop_after_current === true) {
          return {
            ok: false, accepted: true, status: currentStatus,
            alreadyTerminal: false, neverStarted: false, terminationVerified: false,
            cancelState: 'stop_after_current', leaseReleased: false, gate: 'stop-after-current',
            error: res.detail || 'The current group is still running. No further groups should start; wait for the owner to finish and reconcile.'
          };
        }
        evidence = { kind: terminationVerified ? 'verified' : 'unverified', detail: (res && res.detail) || 'job-owned stop hook' };
      } catch (err) {
        return refuse(jobId, { gate: 'local-cancel-failed', cancelState: 'requested', status: currentStatus, error: err.message });
      }
      if (!terminationVerified) {
        return {
          ok: false, accepted: ownerAccepted,
          status: currentStatus, alreadyTerminal: false, neverStarted: false,
          terminationVerified: false, cancelState: 'requested', leaseReleased: false,
          gate: 'local-stop-unverified',
          error: 'The job owner has not verified termination. The job and lease remain active until reconciliation.'
        };
      }
    }

    // ---- 5. Verified stop: only now may the job become CANCELLED -----------------------
    const fin = finalize(jobId, reason);
    if (!fin.ok) return refuse(jobId, { gate: 'state-write-failed', cancelState: 'unknown', status: currentStatus, reason: fin.error });
    const leaseReleased = releaseLease(jobId);
    unregisterActiveJob(jobId);

    return {
      ok: true, accepted: true, status: 'CANCELLED', immediate: false,
      alreadyTerminal: false, neverStarted: false, terminationVerified: true,
      cancelState: active.isRemote ? 'verified_stopped' : (evidence && evidence.kind === 'owner_accepted' ? 'stop_after_current' : 'verified_stopped'),
      leaseReleased, evidence
    };
  }

  return {
    registerActiveJob,
    unregisterActiveJob,
    cancelJob,
    describeCancelCapability: (jobId, opts = {}) => describeCancelCapability(jobId, opts),
    getActive: (jobId) => activeProcesses.get(jobId) || null,
    activeCount: () => activeProcesses.size
  };
}

module.exports = {
  createCancellationManager
};
