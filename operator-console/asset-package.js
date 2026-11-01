'use strict';

// Optional portable output package. Never mutates the canonical image or GLB.
// The included provenance is allowlisted: no prompts, credentials or local paths.
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const crypto = require('node:crypto');
const Archive = require('./portable-archive');

const SAFE_ID = /^[a-zA-Z0-9][a-zA-Z0-9._-]{0,180}$/;
function safeId(id) {
  if (!SAFE_ID.test(String(id || '')) || String(id).includes('..')) throw new Error('Invalid canonical artifact ID');
  return id;
}
function publicFields(record, fields) {
  const out = {};
  for (const key of fields) {
    const value = record?.[key];
    if (value === null || value === undefined) continue;
    if (['string', 'boolean', 'number'].includes(typeof value)) out[key] = value;
  }
  return out;
}
async function verifyFile(file, expectedBytes, expectedHash) {
  if (typeof file !== 'string' || !fs.statSync(file).isFile()) throw new Error('Source file unavailable');
  const size = fs.statSync(file).size;
  if (expectedBytes != null && size !== Number(expectedBytes)) throw new Error('Canonical byte count mismatch');
  const sha256 = await Archive.sha256File(file);
  if (expectedHash && sha256 !== expectedHash) throw new Error('Canonical SHA-256 mismatch');
  return { bytes: size, sha256 };
}
async function exportAssetPackage({ artifact, source = null, job = null, tmpRoot = os.tmpdir() }) {
  if (!artifact || !artifact.path) throw new Error('Canonical artifact missing');
  const artifactId = safeId(artifact.artifact_id);
  if (artifact.kind !== 'world' || !/\.(glb|ply|png|json|obj)$/i.test(artifactId))
    throw new Error('Unsupported 3D/World package kind');
  const meta = artifact.meta || {};
  const output = await verifyFile(artifact.path, artifact.bytes, artifact.sha256);
  let sourceInfo = null, sourceEntry = null;
  const sourceId = typeof artifact.parent === 'string' ? artifact.parent : null;
  if (sourceId && source?.id === sourceId && source?.path) {
    safeId(source.id);
    const checked = await verifyFile(source.path, source.bytes, source.sha256);
    sourceInfo = { id: source.id, filename: 'source/' + source.id, ...checked };
    sourceEntry = { name: sourceInfo.filename, file: source.path, store: true };
  }
  const manifest = {
    schema: 'dexdiffusion.asset-package.v1',
    version: 1,
    artifact: {
      ...publicFields(artifact, ['artifact_id', 'kind', 'mime', 'job_id', 'model', 'worker', 'seed']),
      filename: 'artifacts/' + artifactId, ...output
    },
    lineage: {
      source_image_id: sourceId,
      source_included: !!sourceInfo,
      source: sourceInfo,
      operation: typeof meta.operation === 'string' ? meta.operation.slice(0, 80) : null,
      mode: typeof meta.mode === 'string' ? meta.mode.slice(0, 40) : null
    },
    job: job ? publicFields(job, ['job_id', 'status', 'operation', 'worker_id', 'model_id', 'created_at', 'started_at', 'completed_at']) : null,
    verified: { artifact_bytes_and_hash: true, source_bytes_and_hash: !!sourceInfo },
    redactions: ['prompt', 'negative_prompt', 'local_file_paths', 'credentials', 'private_settings']
  };
  const dir = fs.mkdtempSync(path.join(tmpRoot, 'dex-asset-export-'));
  const zip = path.join(dir, 'package.zip');
  const cleanup = () => { try { fs.rmSync(dir, { recursive: true, force: true }); } catch (_) {} };
  try {
    const entries = [
      { name: 'manifest.json', data: Buffer.from(JSON.stringify(manifest, null, 2) + '\n') },
      { name: 'artifacts/' + artifactId, file: artifact.path, store: true },
      ...(sourceEntry ? [sourceEntry] : [])
    ];
    await Archive.writeZip(zip, entries);
    return { zip, filename: 'dexdiffusion-' + artifactId.replace(/\.[^.]+$/, '') + '-package.zip', manifest, cleanup };
  } catch (error) { cleanup(); throw error; }
}
module.exports = { exportAssetPackage, safeId, verifyFile };
