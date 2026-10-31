'use strict';

// Durable, strictly milestone-based World progress. This is a count of
// independently verified pipeline stages, NOT a prediction of elapsed time.
// In particular, PARTIAL outputs may leave some milestones BLOCKED.
const MILESTONES = Object.freeze({
  quick3d: [
    ['source', 'Source ready', ['source']],
    ['reconstruct', 'Reconstruct geometry', ['reconstruct']],
    ['finalize', 'Publish geometry', ['finalize']],
    ['viewer', 'Preview ready', ['viewer']],
  ],
  complete360: [
    ['camera', 'Camera and source', ['camera', 'erpReference']],
    ['complete', 'Complete panorama', ['complete']],
    ['depth360', 'Depth map', ['depth360']],
    ['project', 'Geometry scaffold', ['project']],
    ['rig', 'Camera rig', ['rig']],
    ['reconstruct', 'SHARP geometry', ['reconstruct']],
    ['fusion', 'Align and fuse', ['align', 'fusion']],
    ['runtime', 'Runtime preview', ['runtime', 'viewer']],
    ['quality', 'Quality report', ['quality']],
  ],
});

function deriveWorldProgress(project) {
  const plan = MILESTONES[project?.mode] || MILESTONES.quick3d;
  const stages = project?.stages || {};
  const segments = plan.map(([id, label, keys]) => {
    const statuses = keys.map(k => String(stages[k]?.status || 'NOT_STARTED'));
    let status = 'NOT_STARTED';
    if (statuses.includes('FAILED')) status = 'FAILED';
    else if (statuses.includes('BLOCKED')) status = 'BLOCKED';
    else if (statuses.every(s => s === 'READY')) status = 'READY';
    else if (statuses.some(s => s !== 'NOT_STARTED')) status = ['FAILED', 'BLOCKED', 'PARTIAL', 'COMPLETE', 'INTERRUPTED', 'CANCELLED'].includes(project?.status) ? 'UNVERIFIED' : 'RUNNING';
    const current = keys.includes(project?.currentStage);
    return { id, label, status, current };
  });
  const done = segments.filter(s => s.status === 'READY').length;
  const current = segments.find(s => s.status === 'RUNNING' && s.current)
    || segments.find(s => s.status === 'RUNNING')
    || segments.find(s => s.status === 'NOT_STARTED');
  return {
    kind: 'verified-milestones',
    done,
    total: segments.length,
    segments,
    active: current ? current.id : null,
    activeLabel: current ? current.label : null,
    result: String(project?.status || 'QUEUED'),
    // No synthetic percent: numeric percent requires measured sampling.
  };
}

module.exports = { MILESTONES, deriveWorldProgress };
