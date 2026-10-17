'use strict';

const fs = require('fs');
const path = require('path');
const { artifactReceipt } = require('./job-contract');

// Recover only publications whose durable run owner, PASS manifest, run index,
// canonical bytes, and durable generic job all identify the same exact job.
function reconcileInterruptedPublications({ jobStore, runsRoot, imageStore, validateImage }) {
  const result = { inspected: 0, recovered: 0, unresolved: [] };
  const root = path.resolve(runsRoot);
  const jobs = jobStore.list({ limit: 100000 }).filter(j => j.status === 'INTERRUPTED' && j.media_kind === 'image');
  let dirs = [];
  try { dirs = fs.readdirSync(root, { withFileTypes: true }).filter(d => d.isDirectory()); } catch (_) {}
  for (const job of jobs) {
    result.inspected++;
    const entries = [];
    for (const dirent of dirs) {
      const runId = dirent.name, runDir = path.join(root, runId);
      let owner, manifest;
      try {
        owner = JSON.parse(fs.readFileSync(path.join(runDir, 'job-owner.json'), 'utf8'));
        manifest = JSON.parse(fs.readFileSync(path.join(runDir, 'controlled-manifest.json'), 'utf8'));
      } catch (_) { continue; }
      if (owner.schema !== 'dexdiffusion.run_owner.v1' || owner.job_id !== job.job_id || owner.run_id !== runId
        || manifest.status !== 'PASS' || manifest.run_id !== runId) continue;
      for (const indexed of imageStore.readRunIndex(runDir)) {
        if (indexed.job_id !== job.job_id || indexed.run_id !== runId || !indexed.image_id) continue;
        const image = imageStore.resolveImage(indexed.image_id);
        if (!image) continue;
        try {
          const actual = validateImage(image.path);
          if (actual.sha256 !== indexed.sha256 || actual.bytes !== indexed.bytes) continue;
          entries.push({ artifact_id: indexed.image_id, sha256: actual.sha256, canonical: true, validated: true, run_id: runId });
        } catch (_) {}
      }
    }
    const unique = [...new Map(entries.map(e => [e.artifact_id, e])).values()];
    if (!unique.length) { result.unresolved.push({ job_id: job.job_id, reason: 'no-exact-owned-published-artifact' }); continue; }
    const ids = unique.map(e => e.artifact_id);
    const receipt = artifactReceipt(unique);
    const expected = Math.max(1, Number(job.params && job.params.quantity) || 1);
    const complete = ids.length >= expected;
    const transition = jobStore.transition(job.job_id, complete ? 'COMPLETE' : 'INTERRUPTED', {
      recovery_identity: job.job_id,
      artifacts: ids,
      artifact_validation: receipt,
      first_failed_gate: complete ? null : (job.first_failed_gate || 'server-restart-partial-publication'),
      error: complete ? null : (job.error || 'console restarted after a partial publication; verified artifacts retained'),
    });
    if (transition && transition.error) result.unresolved.push({ job_id: job.job_id, reason: transition.error });
    else result.recovered += ids.length;
  }
  jobStore.flush();
  return result;
}

module.exports = { reconcileInterruptedPublications };
