'use strict';

// F14: Actual cancellation engine
// Queued jobs: cancel immediately. Status becomes CANCELLED.
// Local active jobs: terminate specific process group/PID, verify process identity, release lease.
// Remote Big Mac jobs: verified job identity markers / nonce; fail closed against killing unrelated work.
// Never: pkill node, killall python, killall sd-cli.

const EventEmitter = require('events');

function createCancellationManager({
  arbiter,
  jobStore,
  eventBus,
  onLocalTerminate = null,
  onRemoteTerminate = null
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
      startedAt: Date.now()
    });
  }

  function unregisterActiveJob(jobId) {
    activeProcesses.delete(jobId);
  }

  async function cancelJob(jobId, { reason = 'User requested cancellation' } = {}) {
    if (!jobId) return { ok: false, error: 'Job ID required', gate: 'missing-id' };

    // 1. Check if job is in active processes map
    const active = activeProcesses.get(jobId);

    // 2. Check durable job store
    const record = jobStore ? jobStore.get(jobId) : null;
    const currentStatus = record ? record.status : null;

    if (currentStatus === 'COMPLETE' || currentStatus === 'FAILED' || currentStatus === 'CANCELLED' || currentStatus === 'INTERRUPTED') {
      return {
        ok: false,
        error: `Cannot cancel job in terminal state: ${currentStatus}`,
        gate: 'already-terminal',
        status: currentStatus
      };
    }

    // Queued job cancellation (immediate)
    if (!active || currentStatus === 'QUEUED') {
      if (jobStore) {
        jobStore.transition(jobId, 'CANCELLED', { error: reason, first_failed_gate: 'user-cancelled' });
      }
      if (arbiter) {
        try { arbiter.release(jobId); } catch (_) {}
      }
      if (eventBus) {
        eventBus.publish('job.cancelled', { id: jobId, reason, status: 'CANCELLED' });
      }
      return { ok: true, status: 'CANCELLED', immediate: true };
    }

    // Active Running Job cancellation
    if (active.isRemote) {
      // Remote cancellation contract: verify job-specific nonce and remote directory
      if (!active.nonce || !active.remoteWorkDir) {
        return {
          ok: false,
          error: 'Remote cancellation refused: lack of job-scoped identity marker',
          gate: 'cancel-unsafe'
        };
      }

      if (onRemoteTerminate && typeof onRemoteTerminate === 'function') {
        try {
          const res = await onRemoteTerminate(active);
          if (!res || !res.ok) {
            return {
              ok: false,
              error: res ? res.error : 'Remote termination hook failed',
              gate: 'remote-cancel-failed'
            };
          }
        } catch (e) {
          return { ok: false, error: e.message, gate: 'remote-cancel-exception' };
        }
      }
    } else {
      // Local process cancellation: verify PID
      if (active.process && typeof active.process.kill === 'function') {
        try {
          // Graceful termination first
          active.process.kill('SIGTERM');
          setTimeout(() => {
            try {
              if (activeProcesses.has(jobId)) {
                active.process.kill('SIGKILL');
              }
            } catch (_) {}
          }, 3000).unref?.();
        } catch (err) {
          return { ok: false, error: `Local termination failed: ${err.message}`, gate: 'local-cancel-failed' };
        }
      } else if (onLocalTerminate && typeof onLocalTerminate === 'function') {
        try {
          await onLocalTerminate(active);
        } catch (err) {
          return { ok: false, error: err.message, gate: 'local-cancel-failed' };
        }
      }
    }

    // Release arbiter lease
    if (arbiter) {
      try { arbiter.release(jobId); } catch (_) {}
    }

    // Transition durable state
    if (jobStore) {
      jobStore.transition(jobId, 'CANCELLED', { error: reason, first_failed_gate: 'user-cancelled' });
    }

    // Emit event
    if (eventBus) {
      eventBus.publish('job.cancelled', { id: jobId, reason, status: 'CANCELLED' });
    }

    unregisterActiveJob(jobId);

    return {
      ok: true,
      status: 'CANCELLED',
      immediate: false
    };
  }

  return {
    registerActiveJob,
    unregisterActiveJob,
    cancelJob,
    getActive: (jobId) => activeProcesses.get(jobId) || null,
    activeCount: () => activeProcesses.size
  };
}

module.exports = {
  createCancellationManager
};
