'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { buildRepairRecord } = require('../import-provenance-repair');
const imageId = '20261101-011101-import-evidence.png';
const source = { runId: '20261101-011101-import-123abc456d', runFile: 'source-valid-photo.png' };
const index = { image_id: imageId, run_id: source.runId, run_file: source.runFile, sha256: 'a'.repeat(64) };
const validation = { sha256: index.sha256, dimensions: [160, 90] };
test('import recovery derives only verified id, run and dimensions; never guesses original filename', () => {
  const record = buildRepairRecord({ imageId, source, runIndexEntry: index, validation });
  assert.deepEqual(record, { operation: 'import', runId: source.runId,
    source_kind: 'user-upload', width: 160, height: 90 });
  assert.equal(Object.hasOwn(record, 'original_name'), false);
});
test('run identity, path traversal, byte tampering and invalid dimensions fail closed', () => {
  const args = { imageId, source, runIndexEntry: index, validation };
  for (const changes of [
    { source: { ...source, runId: '20261101-011101-other-123abc456d' } },
    { source: { ...source, runFile: '../secret.png' } },
    { runIndexEntry: { ...index, image_id: 'different.png' } },
    { validation: { ...validation, sha256: 'b'.repeat(64) } },
    { validation: { ...validation, dimensions: [160, 0] } }
  ]) assert.throws(() => buildRepairRecord({ ...args, ...changes }));
});
