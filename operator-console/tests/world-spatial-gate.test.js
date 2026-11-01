'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { evaluateSpatialReadiness, LIMITS } = require('../world-spatial-gate');

test('a panorama, depth prior and fitted point cloud never certify six-degree-of-freedom navigation', () => {
  const result = evaluateSpatialReadiness({
    checks: {
      panorama: { status: 'PASS' },
      depth360: { status: 'WARN' },
      fusion: { status: 'WARN', method: 'aligned-voxel-dedup' },
      runtime: { status: 'WARN', fullWorldValidated: false }
    }
  });
  assert.equal(result.status, 'BLOCKED');
  assert.equal(result.navigable, false);
  assert.match(result.blockers.join(' '), /independent|depth|fusion|runtime/i);
});

test('plausible metrics without independent references remain blocked', () => {
  const metrics = Object.fromEntries(Object.entries(LIMITS).map(([k,v])=>[k,v]));
  const result = evaluateSpatialReadiness({
    checks: {
      depth360: { status:'PASS' }, fusion: { status:'PASS' },
      runtime: { fullWorldValidated: true }
    },
    spatialBenchmark: { schema:'dexdiffusion.world.spatial-benchmark.v1', metrics }
  });
  assert.equal(result.status,'BLOCKED');
  assert.ok(result.blockers.some(x=>/reference/.test(x)));
  assert.equal(result.navigable,false);
});

test('complete independently measured metrics still demand witnessed runtime acceptance', () => {
  const metrics = Object.fromEntries(Object.entries(LIMITS).map(([k,v])=>[k,v]));
  const result = evaluateSpatialReadiness({
    checks: {
      depth360: { status:'PASS' }, fusion: { status:'PASS' },
      runtime: { fullWorldValidated: true }
    },
    spatialBenchmark: {
      schema:'dexdiffusion.world.spatial-benchmark.v1',
      referenceType:'independent-multiview',
      fixtureHash:'a'.repeat(64), benchmarkRunId:'fixture-001', metrics
    }
  });
  assert.equal(result.status,'CANDIDATE_REQUIRES_ACCEPTANCE');
  assert.equal(result.navigable,false);
  assert.ok(result.blockers.some(x=>/not witnessed/.test(x)));
});

test('NaN, negative, missing and failing precision metrics are rejected', () => {
  for (const value of [NaN, -1, 1e9, undefined]) {
    const result=evaluateSpatialReadiness({
      checks: {depth360:{status:'PASS'},fusion:{status:'PASS'},runtime:{fullWorldValidated:true}},
      spatialBenchmark:{ schema:'dexdiffusion.world.spatial-benchmark.v1',
        referenceType:'independent-multiview', fixtureHash:'b'.repeat(64),benchmarkRunId:'fixture-002',
        metrics:{ ...LIMITS, poseRmseDegrees:value }}
    });
    assert.equal(result.status,'BLOCKED');
    assert.equal(result.navigable,false);
  }
});
