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

module.exports = {
  projectOperationalJob,
  SCHEMA_VERSION,
  FORBIDDEN_FIELDS
};
