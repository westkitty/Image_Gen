'use strict';

// Gate for a future independently validated, navigable 6DoF World.
// Merely receiving a 360 panorama, depth prior, coarse PLY or Gaussian
// proposals is NOT evidence of globally coherent spatial reconstruction.
// This module never enables navigation or mutates artifact contents.
const LIMITS = Object.freeze({
  independentViews: 6,
  poseRmseDegrees: 5,
  translationRmseMeters: 0.15,
  geometryChamferMeters: 0.10,
  surfaceCoverage: 0.9,
  occlusionF1: 0.85,
  collisionPassRate: 0.99
});
const REQUIRED = Object.freeze(Object.keys(LIMITS));
function evaluateSpatialReadiness(input = {}) {
  const measurements = input.spatialBenchmark || null;
  const checks = input.checks || {};
  const blockers = [];
  if (!measurements || measurements.schema !== 'dexdiffusion.world.spatial-benchmark.v1') {
    blockers.push('No independent multi-view spatial benchmark available.');
  }
  if (checks.depth360?.status !== 'PASS') blockers.push('Learned/global depth consistency has not passed.');
  if (checks.fusion?.status !== 'PASS') blockers.push('Globally aligned 3D fusion has not passed.');
  if (checks.runtime?.fullWorldValidated !== true) blockers.push('Collision and translation runtime is not independently validated.');
  const independent = !!(measurements && measurements.referenceType === 'independent-multiview' &&
    measurements.fixtureHash && /^[a-f0-9]{64}$/i.test(measurements.fixtureHash) &&
    measurements.benchmarkRunId && typeof measurements.benchmarkRunId === 'string');
  if (!independent) blockers.push('Independent reference captures and exact benchmark identity are missing.');
  const values = measurements?.metrics || {};
  for (const key of REQUIRED) {
    const value = values[key];
    if (!Number.isFinite(value) || value < 0) {
      blockers.push(key + ' has no finite nonnegative measurement.');
      continue;
    }
    const boundary = LIMITS[key];
    const atLeast = key === 'independentViews' || key === 'surfaceCoverage' ||
      key === 'occlusionF1' || key === 'collisionPassRate';
    if (atLeast ? value < boundary : value > boundary)
      blockers.push(key + ' is outside the provisional test threshold.');
  }
  // A metric report alone is not physical navigation proof. Even a plausible
  // all-green result remains a research candidate until an independently
  // witnessed, matched-build walk/turn/collision test has been verified.
  const candidate = blockers.length === 0;
  if (candidate) blockers.push('Native/browser locomotion, parallax, occlusion and collision acceptance not witnessed.');
  return {
    schema: 'dexdiffusion.world.spatial-readiness.v1',
    status: candidate ? 'CANDIDATE_REQUIRES_ACCEPTANCE' : 'BLOCKED',
    navigable: false,
    metricsPresent: !!measurements,
    thresholds: LIMITS,
    blockers
  };
}
module.exports = { evaluateSpatialReadiness, LIMITS };
