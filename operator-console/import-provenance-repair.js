'use strict';
// Recover the immutable, verifiable portion of failed import metadata. No
// source path is accepted from the client. No guessed original filenames.
function buildRepairRecord({ imageId, source, runIndexEntry, validation }) {
  if (typeof imageId !== 'string' || !imageId) throw new Error('Invalid canonical image ID');
  if (!source || typeof source.runId !== 'string' ||
      !/^20[0-9]{6}-[0-9]{6}-import-[a-f0-9]{10}$/.test(source.runId) ||
      !/^source-[a-zA-Z0-9_-]+\.(?:png|jpg|jpeg|webp)$/i.test(source.runFile || '')) {
    throw new Error('Not an authenticated import run');
  }
  if (!runIndexEntry || runIndexEntry.image_id !== imageId ||
      runIndexEntry.run_id !== source.runId ||
      runIndexEntry.run_file !== source.runFile ||
      !/^[a-f0-9]{64}$/i.test(String(runIndexEntry.sha256 || ''))) {
    throw new Error('Run index cannot authenticate the imported image');
  }
  if (!validation || validation.sha256 !== runIndexEntry.sha256 ||
      !Array.isArray(validation.dimensions) || validation.dimensions.length !== 2 ||
      !validation.dimensions.every(x => Number.isInteger(x) && x > 0)) {
    throw new Error('Canonical image bytes do not match the imported run index');
  }
  return {
    operation: 'import', runId: source.runId, source_kind: 'user-upload',
    width: validation.dimensions[0], height: validation.dimensions[1]
  };
}
module.exports = { buildRepairRecord };
