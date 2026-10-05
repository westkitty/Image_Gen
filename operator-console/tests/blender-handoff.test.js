'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const { createAsset3dBridge } = require('../asset3d-bridge');

function makeMockMediaStore(records = {}) {
  return {
    resolve(id) {
      return records[id] || null;
    },
    finalize() {
      return null;
    }
  };
}

test('Blender handoff: 1. .glb artifact resolves and 2. Non-GLB / missing is rejected', () => {
  const store = makeMockMediaStore({
    'sample.glb': { artifact_id: 'sample.glb', kind: 'world', path: '/Users/andrew/worlds/sample.glb' },
    'sample.ply': { artifact_id: 'sample.ply', kind: 'world', path: '/tmp/sample.ply' },
    'other.txt': { artifact_id: 'other.txt', kind: 'image', path: '/tmp/other.txt' }
  });
  const bridge = createAsset3dBridge({ mediaStore: store });

  // 1. Valid GLB resolves
  let spawned = false;
  const resValid = bridge.openInBlender('sample.glb', {
    blenderBin: '/Applications/Blender.app/Contents/MacOS/Blender',
    spawn: () => { spawned = true; return { unref() {} }; }
  });
  assert.equal(resValid.ok, true);
  assert.equal(resValid.artifact, '/Users/andrew/worlds/sample.glb');
  assert.equal(spawned, true);

  // 2. Missing artifact rejected (404)
  const resMissing = bridge.openInBlender('non-existent.glb');
  assert.equal(resMissing.status, 404);
  assert.match(resMissing.error, /GLB artifact not found/);

  // 2b. Non-GLB artifact (even if world kind) rejected (404)
  const resPly = bridge.openInBlender('sample.ply');
  assert.equal(resPly.status, 404);
  assert.match(resPly.error, /GLB artifact not found/);

  // 2c. Non-world kind rejected (404)
  const resTxt = bridge.openInBlender('other.txt');
  assert.equal(resTxt.status, 404);
  assert.match(resTxt.error, /GLB artifact not found/);
});

test('Blender handoff: 3. Missing Blender is rejected truthfully (409)', () => {
  const store = makeMockMediaStore({
    'asset.glb': { artifact_id: 'asset.glb', kind: 'world', path: '/tmp/asset.glb' }
  });
  const bridge = createAsset3dBridge({ mediaStore: store });

  const res = bridge.openInBlender('asset.glb', {
    blenderBin: '/non/existent/path/to/blender'
  });
  assert.equal(res.status, 409);
  assert.match(res.error, /Blender is not installed/);
});

test('Blender handoff: 4-11. Process invocation, arguments array, python bootstrap, and security assertions', () => {
  const canonicalGlbPath = '/Users/andrew/worlds/asset3d-textured.glb';
  const store = makeMockMediaStore({
    'asset3d-textured.glb': {
      artifact_id: 'asset3d-textured.glb',
      kind: 'world',
      path: canonicalGlbPath
    }
  });
  const bridge = createAsset3dBridge({ mediaStore: store });

  let spawnedCall = null;
  const mockSpawn = (cmd, args, options) => {
    spawnedCall = { cmd, args, options };
    return {
      unref() {}
    };
  };

  const res = bridge.openInBlender('asset3d-textured.glb', {
    blenderBin: '/Applications/Blender.app/Contents/MacOS/Blender',
    spawn: mockSpawn
  });

  // Contract response check
  assert.equal(res.ok, true);
  assert.equal(res.action, 'import-glb');
  assert.equal(res.artifact, canonicalGlbPath);

  // 4. Correct Blender executable is spawned
  assert.equal(spawnedCall.cmd, '/Applications/Blender.app/Contents/MacOS/Blender', 'must spawn actual Blender binary');

  // 5. --python is present
  const pythonIdx = spawnedCall.args.indexOf('--python');
  assert.ok(pythonIdx >= 0, '--python must be in args array');

  // 6. The project helper path is present
  const helperPath = spawnedCall.args[pythonIdx + 1];
  assert.ok(helperPath.endsWith('blender-import-glb.py'), 'helper path must reference blender-import-glb.py');
  assert.ok(fs.existsSync(helperPath), 'helper script file must exist on disk');

  // 7. -- is present
  const dashDashIdx = spawnedCall.args.indexOf('--');
  assert.ok(dashDashIdx > pythonIdx, '-- separator must follow --python <helper>');

  // 8. Canonical GLB path occurs AFTER --
  const glbArgIdx = spawnedCall.args.indexOf(canonicalGlbPath);
  assert.ok(glbArgIdx > dashDashIdx, 'canonical GLB path must be positioned strictly after --');

  // 9. GLB is NOT the first positional Blender document argument
  assert.notEqual(spawnedCall.args[0], canonicalGlbPath, 'GLB must not be passed as positional document argument to Blender');

  // 10. macOS open -a Blender is NOT used
  assert.notEqual(spawnedCall.cmd, 'open', 'must not invoke macOS open');

  // 11. shell: true is NOT used
  assert.equal(spawnedCall.options.shell, undefined, 'shell: true must not be enabled');
  assert.equal(spawnedCall.options.detached, true, 'spawn options must detach GUI process');
});

test('Source code audit: verifies open -a Blender is completely eliminated from asset3d-bridge.js', () => {
  const bridgeSrc = fs.readFileSync(path.join(__dirname, '..', 'asset3d-bridge.js'), 'utf8');
  assert.doesNotMatch(bridgeSrc, /spawn\(['"]open['"]/);
  assert.doesNotMatch(bridgeSrc, /-a['"],\s*['"]Blender/);
});
