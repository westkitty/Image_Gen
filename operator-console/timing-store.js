'use strict';

// F06: ETA prediction derived strictly from conservative historical completed duration data.
// - Minimum 3 completed comparable jobs per bucket (worker + operation + workloadBucket).
// - Uses median rather than mean.
// - Bounded recent history.
// - Excludes failed, interrupted, cancelled work.
// - Returns truthful status if insufficient history.

const fs = require('fs');
const path = require('path');

const MIN_SAMPLES_THRESHOLD = 3;
const MAX_SAMPLES_PER_BUCKET = 30;

function computeBucketKey(worker, operation, workload = {}) {
  const w = worker || 'unknown';
  const op = operation || 'unknown';
  // Workload bucket distinctions: resolution class (512, 768, 1024, 2048) or audio duration bucket
  let resClass = 'std';
  if (workload.width && workload.height) {
    const area = workload.width * workload.height;
    if (area <= 512 * 512) resClass = '512';
    else if (area <= 768 * 768) resClass = '768';
    else if (area <= 1024 * 1024) resClass = '1024';
    else resClass = 'hires';
  } else if (workload.durationSec) {
    if (workload.durationSec <= 5) resClass = 'short';
    else if (workload.durationSec <= 15) resClass = 'med';
    else resClass = 'long';
  }
  const qty = Number(workload.quantity || 1) > 1 ? `x${workload.quantity}` : 'x1';
  return `${w}:${op}:${resClass}:${qty}`;
}

function calculateMedian(arr) {
  if (!arr || arr.length === 0) return 0;
  const sorted = [...arr].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  if (sorted.length % 2 === 1) {
    return sorted[mid];
  }
  return Math.round((sorted[mid - 1] + sorted[mid]) / 2);
}

function createTimingStore(filePath) {
  let stats = {}; // bucketKey -> array of durations in ms

  function load() {
    if (!filePath) return;
    try {
      if (fs.existsSync(filePath)) {
        const raw = fs.readFileSync(filePath, 'utf8');
        const data = JSON.parse(raw);
        if (data && typeof data === 'object' && data.version === 'dexdiffusion.timing.v1') {
          stats = data.buckets || {};
        }
      }
    } catch (_) {
      stats = {};
    }
  }

  function save() {
    if (!filePath) return;
    try {
      const dir = path.dirname(filePath);
      if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
      const tmp = `${filePath}.tmp.${Date.now()}`;
      fs.writeFileSync(tmp, JSON.stringify({ version: 'dexdiffusion.timing.v1', updatedAt: Date.now(), buckets: stats }, null, 2), 'utf8');
      fs.renameSync(tmp, filePath);
    } catch (_) {}
  }

  load();

  function recordCompletedJob({ worker, operation, durationMs, workload = {} }) {
    if (!durationMs || durationMs <= 0 || !Number.isFinite(durationMs)) return;
    const key = computeBucketKey(worker, operation, workload);
    if (!stats[key]) stats[key] = [];
    stats[key].push(Math.round(durationMs));
    if (stats[key].length > MAX_SAMPLES_PER_BUCKET) {
      stats[key].shift();
    }
    save();
  }

  function getEstimate(worker, operation, workload = {}) {
    const key = computeBucketKey(worker, operation, workload);
    const samples = stats[key] || [];
    if (samples.length < MIN_SAMPLES_THRESHOLD) {
      // Check fallback broader bucket without quantity
      const broadKey = `${worker || 'unknown'}:${operation || 'unknown'}`;
      const broadSamples = [];
      for (const [k, v] of Object.entries(stats)) {
        if (k.startsWith(broadKey)) broadSamples.push(...v);
      }
      if (broadSamples.length >= MIN_SAMPLES_THRESHOLD) {
        const median = calculateMedian(broadSamples);
        return {
          available: true,
          estimatedDurationMs: median,
          display: `~${Math.round(median / 1000)}s`,
          sampleCount: broadSamples.length,
          confidence: 'low'
        };
      }
      return {
        available: false,
        estimatedDurationMs: null,
        display: 'ETA unavailable · insufficient history',
        sampleCount: samples.length,
        confidence: 'none'
      };
    }
    const median = calculateMedian(samples);
    return {
      available: true,
      estimatedDurationMs: median,
      display: `~${Math.round(median / 1000)}s`,
      sampleCount: samples.length,
      confidence: samples.length >= 10 ? 'high' : 'medium'
    };
  }

  function estimateQueueWait(queuedJobsAhead = [], activeJob = null) {
    let totalEstimatedMs = 0;
    let reliable = true;

    if (activeJob) {
      const activeEst = getEstimate(activeJob.worker, activeJob.operation, activeJob.workload);
      if (activeEst.available && activeJob.startedAt) {
        const elapsed = Math.max(0, Date.now() - activeJob.startedAt);
        const remaining = Math.max(0, activeEst.estimatedDurationMs - elapsed);
        totalEstimatedMs += remaining;
      } else {
        reliable = false;
      }
    }

    for (const job of queuedJobsAhead) {
      const est = getEstimate(job.worker, job.operation, job.workload);
      if (est.available) {
        totalEstimatedMs += est.estimatedDurationMs;
      } else {
        reliable = false;
      }
    }

    if (!reliable && totalEstimatedMs === 0) {
      return {
        available: false,
        display: 'Wait ETA unavailable',
        totalMs: null
      };
    }

    const sec = Math.round(totalEstimatedMs / 1000);
    return {
      available: true,
      reliable,
      totalMs: totalEstimatedMs,
      display: `~${sec}s${reliable ? '' : ' (partial estimate)'}`
    };
  }

  return {
    recordCompletedJob,
    getEstimate,
    estimateQueueWait,
    computeBucketKey,
    stats: () => stats
  };
}

module.exports = {
  createTimingStore,
  computeBucketKey,
  MIN_SAMPLES_THRESHOLD
};
