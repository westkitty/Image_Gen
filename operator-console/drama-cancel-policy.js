'use strict';
// Drama production owns a cooperative, after-current-chunk stop—not a process kill.
// Capability is offered only when the registered exact producer owns the job.
function dramaCancelCapability({record,active}={}) {
  if (!record || record.operation !== 'drama-production' || record.worker_id !== 'drama-producer') return null;
  if (!active || active.target !== 'drama-production') return {
    cancel_supported:false, cancel_scope:'unsupported',
    cancel_reason:'This Drama job has no verified producer owner. Its stop cannot be requested safely.'
  };
  return {cancel_supported:true,cancel_scope:'stop-after-current',
    cancel_reason:'Stop after current: the current audio chunk continues, then remaining chunks are skipped.'};
}
function requestDramaStop(producer,active) {
  if (!active || active.target !== 'drama-production' || !active.jobId || !producer || typeof producer.cancelByJob !== 'function') {
    return {ok:false,verified:false,error:'No exact Drama producer owner is available'};
  }
  try {
    const outcome=producer.cancelByJob(active.jobId);
    if (!outcome || outcome.ok !== true) return {ok:false,verified:false,error:(outcome && outcome.error) || 'The owner refused or could not find this production'};
    return {ok:true,verified:false,stop_after_current:true,
      detail:'Drama stop requested by exact job identity. The current chunk is still running; cancellation is not yet verified.'};
  } catch (error) {
    return {ok:false,verified:false,error:error.message};
  }
}
module.exports={dramaCancelCapability,requestDramaStop};
