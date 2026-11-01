'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const crypto = require('node:crypto');
const { exportAssetPackage } = require('../asset-package');
const Archive = require('../portable-archive');

test('portable 3D package contains exact hash-verified artifact and parent, without prompts or machine paths', async t => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'dex-asset-pkg-test-'));
  t.after(() => fs.rmSync(tmp, { recursive: true, force: true }));
  const artifactPath = path.join(tmp, 'private-glb.glb');
  const sourcePath = path.join(tmp, 'private-source.png');
  const glb = Buffer.from('glTF synthetic fixture bytes'); const png = Buffer.from('PNG fixture bytes');
  fs.writeFileSync(artifactPath, glb); fs.writeFileSync(sourcePath, png);
  const sha = bytes => crypto.createHash('sha256').update(bytes).digest('hex');
  const result = await exportAssetPackage({
    artifact: { artifact_id: 'model-1.glb', kind: 'world', path: artifactPath, bytes: glb.length,
      sha256: sha(glb), parent: 'source-1.png', job_id: 'job1', meta: {
        operation: 'asset3d', mode: 'mesh', prompt: 'SECRET_PROMPT', device_path: '/Users/andrew/private' } },
    source: { id: 'source-1.png', path: sourcePath },
    job: { job_id: 'job1', status: 'COMPLETE', operation: 'asset3d-mesh',
      params: { prompt: 'SECRET_PROMPT' } }, tmpRoot: tmp
  });
  const zip = Archive.openZip(result.zip);
  const manifest = JSON.parse(zip.read('manifest.json').toString('utf8'));
  assert.equal(manifest.schema, 'dexdiffusion.asset-package.v1');
  assert.equal(manifest.artifact.sha256, sha(glb));
  assert.deepEqual(zip.read('artifacts/model-1.glb'), glb);
  assert.deepEqual(zip.read('source/source-1.png'), png);
  assert.equal(manifest.lineage.source_image_id, 'source-1.png');
  assert.equal(manifest.lineage.source_included, true);
  assert.equal(manifest.job.status, 'COMPLETE');
  assert.doesNotMatch(JSON.stringify(manifest), /SECRET_PROMPT|\/Users\/andrew|private-glb/);
  zip.close();
  result.cleanup();
  assert.equal(fs.existsSync(result.zip), false);
});
test('hash mismatch fails closed without publishing a package', async t => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'dex-asset-pkg-bad-'));
  t.after(() => fs.rmSync(tmp, { recursive: true, force: true }));
  const file = path.join(tmp, 'bad.glb');
  fs.writeFileSync(file, 'tampered');
  await assert.rejects(exportAssetPackage({
    artifact: { artifact_id: 'bad.glb', kind: 'world', path: file, bytes: 8, sha256: '0'.repeat(64) },
    tmpRoot: tmp
  }), /SHA-256 mismatch/);
});
