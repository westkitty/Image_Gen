'use strict';

// F02 / F03: Normalized Operational Job Projection
// Public safe shape:
// schemaVersion, id, mediaKind, operation, label, worker, target, status, progress,
// createdAt, startedAt, completedAt, elapsedMs, queuePosition, resourceClass,
// resourceState, canCancel, firstFailedGate, artifactIds, estimatedStartAt, estimatedCompletionAt

const SCHEMA_VERSION = 'dexdiffusion.job.v1';

// Fields strictly forbidden from operational job projections (privacy canary guarantee)
const FORBIDDEN_FIELDS = [
  'prompt', 'negative_prompt', 'requestParams', 'text', 'lyrics', 'caption', 'ref_text', 'instruct'
];

function projectOperationalJob({
  id,
  mediaKind = 'image',
  operation = 'generate',
  label = null,
  worker = 'sdcpp',
  target = null,
  status = 'queued',
  progress = null,
  createdAt = null,
  startedAt = null,
  completedAt = null,
  queuePosition = null,
  resourceClass = 'heavy',
  resourceState = null,
  canCancel = false,
  firstFailedGate = null,
  artifactIds = [],
  estimatedDurationMs = null,
  estimatedStartAt = null,
  now = Date.now()
} = {}) {
  // Normalize status to UPPERCASE standard
  const normalizedStatus = String(status || 'queued').toUpperCase();

  const cAt = createdAt || now;
  const sAt = startedAt || (['RUNNING', 'TRANSFERRING', 'COMPLETE', 'FAILED', 'CANCELLED', 'INTERRUPTED'].includes(normalizedStatus) ? cAt : null);
  const endAt = completedAt || (['COMPLETE', 'FAILED', 'CANCELLED', 'INTERRUPTED'].includes(normalizedStatus) ? now : null);

  let elapsedMs = null;
  if (sAt) {
    elapsedMs = Math.max(0, (endAt || now) - sAt);
  }

  let estimatedCompletionAt = null;
  if (estimatedDurationMs && sAt && ['RUNNING', 'TRANSFERRING'].includes(normalizedStatus)) {
    estimatedCompletionAt = sAt + estimatedDurationMs;
  }

  const projection = {
    schemaVersion: SCHEMA_VERSION,
    id: String(id),
    mediaKind: String(mediaKind || 'image'),
    operation: String(operation || 'generate'),
    label: String(label || operation || 'Job'),
    worker: String(worker || 'default'),
    target: target ? String(target) : null,
    status: normalizedStatus,
    progress: progress && typeof progress === 'object' ? {
      currentRun: Number(progress.currentRun || 1),
      totalRuns: Number(progress.totalRuns || 1),
      currentRunPercent: Number(progress.currentRunPercent || 0),
      totalPercent: Number(progress.totalPercent || 0),
      step: progress.step != null ? Number(progress.step) : null,
      totalSteps: progress.totalSteps != null ? Number(progress.totalSteps) : null
    } : null,
    createdAt: cAt,
    startedAt: sAt,
    completedAt: endAt,
    elapsedMs,
    queuePosition: queuePosition != null ? Number(queuePosition) : null,
    resourceClass: String(resourceClass || 'heavy'),
    resourceState: resourceState ? String(resourceState) : null,
    canCancel: Boolean(canCancel),
    firstFailedGate: firstFailedGate ? String(firstFailedGate) : null,
    artifactIds: Array.isArray(artifactIds) ? artifactIds.map(String) : [],
    estimatedStartAt: estimatedStartAt ? Number(estimatedStartAt) : null,
    estimatedCompletionAt: estimatedCompletionAt ? Number(estimatedCompletionAt) : null
  };

  // Enforce no forbidden fields exist in projection
  for (const f of FORBIDDEN_FIELDS) {
    if (f in projection) {
      delete projection[f];
    }
  }

  return projection;
}

// Durable generic jobs (voice/music/drama) carry {phase, done, total, label}. A percentage exists only when the
// counts do; otherwise the job is shown as indeterminate rather than with an invented number.
function projectGenericProgress(progress) {
  if (!progress || typeof progress !== 'object') return null;
  const done = Number(progress.done), total = Number(progress.total);
  if (!Number.isFinite(done) || !Number.isFinite(total) || total <= 0 || done < 0) return null;
  const pct = Math.max(0, Math.min(100, Math.round(done / total * 100)));
  return { currentRun: 1, totalRuns: 1, currentRunPercent: pct, totalPercent: pct, step: Math.min(done, total), totalSteps: total };
}
function genericJobLabel(job) {
  const l = job && job.progress && typeof job.progress.label === 'string' ? job.progress.label : '';
  return (l || (job && job.operation) || 'Job').slice(0, 120);
}

// Publishes durable non-image job lifecycle changes on the SSE bus. Payloads carry ids, status, measured counts and a
// generated label only: never request text.
const GENERIC_EVENT = { created: 'job.created', started: 'job.started', progress: 'job.progress', completed: 'job.completed', failed: 'job.failed', cancelled: 'job.cancelled', interrupted: 'job.interrupted' };
function createGenericJobEventPublisher(eventBus) {
  return function genericJobEvent(kind, job) {
    const name = GENERIC_EVENT[kind];
    if (!name || !job || job.media_kind === 'image') return;
    if (kind === 'progress') { eventBus.publish(name, { id: job.job_id, progress: projectGenericProgress(job.progress), label: genericJobLabel(job) }); return; }
    eventBus.publish(name, { id: job.job_id, mediaKind: job.media_kind, operation: job.operation, status: String(job.status).toLowerCase(), firstFailedGate: job.first_failed_gate || null, artifactIds: job.artifacts || [] });
    if (kind === 'completed' && (job.artifacts || []).length) eventBus.publish('library.changed', { count: job.artifacts.length });
  };
}

module.exports = {
  createGenericJobEventPublisher,
  projectGenericProgress,
  genericJobLabel,
  projectOperationalJob,
  SCHEMA_VERSION,
  FORBIDDEN_FIELDS
};
