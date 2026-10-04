'use strict';
// Incremental boundary contract; legacy public state names remain compatible.
const STATES = ['QUEUED', 'RUNNING', 'TRANSFERRING', 'COMPLETE', 'FAILED', 'INTERRUPTED', 'CANCELLED'];
const TERMINAL = new Set(['COMPLETE', 'FAILED', 'INTERRUPTED', 'CANCELLED']);
const NEXT = { QUEUED: ['RUNNING', 'FAILED', 'CANCELLED', 'INTERRUPTED'], RUNNING: ['TRANSFERRING', 'COMPLETE', 'FAILED', 'CANCELLED', 'INTERRUPTED'], TRANSFERRING: ['COMPLETE', 'FAILED', 'INTERRUPTED', 'CANCELLED'] };
const STAGES = { QUEUED: 'queued', RUNNING: 'running', TRANSFERRING: 'transferring', COMPLETE: 'completed', FAILED: 'failed', INTERRUPTED: 'interrupted', CANCELLED: 'cancelled' };
function artifactReceipt(records) {
  if (!Array.isArray(records) || !records.length || records.some(r => r.canonical !== true || r.validated !== true || !r.artifact_id || !/^[a-f0-9]{64}$/.test(r.sha256))) throw new Error('artifact receipt requires validated canonical records');
  return { canonical: true, validated: true, artifacts: records.map(r => ({ artifact_id: r.artifact_id, sha256: r.sha256 })) };
}
function validateTransition(job, status, patch = {}) {
  if (!STATES.includes(status)) return 'unknown state ' + status;
  if (job.status !== status && !(NEXT[job.status] || []).includes(status)) return `illegal transition ${job.status} -> ${status}`;
  if (TERMINAL.has(status) && patch.resource_lease != null) return 'terminal job cannot retain a resource lease';
  const progress = patch.progress;
  if (progress && progress.percent != null) {
    const sample = progress.sampling;
    if (!sample || !Number.isFinite(sample.done) || !Number.isFinite(sample.total) || sample.total <= 0 || sample.done < 0 || sample.done > sample.total || progress.percent !== sample.done * 100 / sample.total) return 'percentage requires measured sampling counts';
  }
  if (status === 'COMPLETE') {
    const ids = patch.artifacts || job.artifacts || [], receipt = patch.artifact_validation || job.artifact_validation;
    if (job.artifact_required !== false || ids.length) {
      if (!ids.length || !receipt || receipt.validated !== true || receipt.canonical !== true || !Array.isArray(receipt.artifacts) || receipt.artifacts.length !== ids.length || !ids.every(id => receipt.artifacts.some(a => a.artifact_id === id && /^[a-f0-9]{64}$/.test(a.sha256)))) return 'completed requires validated canonical artifacts';
    }
  }
  if (TERMINAL.has(job.status)) {
    for (const k of ['artifacts', 'artifact_validation', 'error', 'first_failed_gate']) if (patch[k] !== undefined && JSON.stringify(patch[k]) !== JSON.stringify(job[k])) return 'terminal outcome is immutable';
  }
  return null;
}
module.exports = { STATES, TERMINAL, STAGES, validateTransition, artifactReceipt };
