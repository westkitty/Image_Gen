'use strict';

const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');

const INTENT_SCHEMA = 'dexdiffusion.controlled_publication_intent.v1';
const MAX_STARTUP_RUNS = 256;
const SAFE_RUN_ID = /^20\d{6}-\d{6}-[A-Za-z0-9_-]{1,160}$/;
const SAFE_IMAGE_ID = /^(?!\.)(?!.*[\\/])[A-Za-z0-9][A-Za-z0-9._-]{0,250}\.(?:png|jpe?g|webp|gif)$/i;

function syncDirectory(dir) {
  const fd = fs.openSync(dir, 'r');
  try { fs.fsyncSync(fd); } finally { fs.closeSync(fd); }
}

function durableJson(file, value) {
  fs.mkdirSync(path.dirname(file), { recursive: true, mode: 0o700 });
  const temp = file + '.' + crypto.randomBytes(8).toString('hex') + '.tmp';
  let fd;
  try {
    fd = fs.openSync(temp, 'wx', 0o600);
    fs.writeFileSync(fd, JSON.stringify(value) + '\n');
    fs.fsyncSync(fd);
    fs.closeSync(fd); fd = undefined;
    try { fs.linkSync(temp, file); }
    catch (error) {
      if (error.code !== 'EEXIST') throw error;
      const existing = JSON.parse(fs.readFileSync(file, 'utf8'));
      if (JSON.stringify(existing) !== JSON.stringify(value)) throw new Error('controlled publication intent collision');
    }
    syncDirectory(path.dirname(file));
  } finally {
    if (fd !== undefined) try { fs.closeSync(fd); } catch (_) {}
    try { fs.unlinkSync(temp); } catch (_) {}
  }
}

function readJson(file) {
  try { return JSON.parse(fs.readFileSync(file, 'utf8')); }
  catch (_) { return null; }
}

function hashFile(file) {
  const hash = crypto.createHash('sha256');
  const fd = fs.openSync(file, 'r');
  try {
    const buffer = Buffer.alloc(1024 * 1024);
    let bytes = 0, count;
    while ((count = fs.readSync(fd, buffer, 0, buffer.length, null)) > 0) {
      bytes += count;
      hash.update(buffer.subarray(0, count));
    }
    return { bytes, sha256: hash.digest('hex') };
  } finally { fs.closeSync(fd); }
}

function createControlledImageStore({ createImageStore, root, runsRoot, publicationEnabled = false, ...options }) {
  if (typeof createImageStore !== 'function') throw new TypeError('createImageStore is required');
  return createImageStore({ root, runsRoot, ...options, ...(publicationEnabled ? { publicationIntentSchema: INTENT_SCHEMA } : {}) });
}

function publishCompletedControlledRun({ workerState, jobId, runId, runDir, downloads, store, publicationEnabled = false, isStopping = () => false }) {
  if (!workerState || workerState.status !== 'complete' || (workerState.run_id && workerState.run_id !== runId)) throw new Error('controlled worker did not complete this run');
  if (!Array.isArray(downloads) || downloads.length < 1) throw new Error('controlled run has no output artifacts');
  if (isStopping()) throw new Error('cancelled before publication');
  if (publicationEnabled) {
    const owner = readJson(path.join(runDir, 'job-owner.json'));
    if (!/^[a-f0-9-]{36}$/i.test(jobId || '') || !owner || owner.schema !== 'dexdiffusion.run_owner.v1' || owner.job_id !== jobId || owner.run_id !== runId) {
      throw new Error('controlled publication owner mismatch');
    }
    const artifacts = downloads.map(item => {
      const st = fs.lstatSync(item.src);
      if (!st.isFile() || st.isSymbolicLink()) throw new Error('controlled output is not a regular file');
      const actual = hashFile(item.src);
      if (item.bytes !== undefined && item.bytes !== actual.bytes) throw new Error('controlled output size mismatch');
      if (item.sha256 && item.sha256 !== actual.sha256) throw new Error('controlled output digest mismatch');
      return { run_file: item.runFile, bytes: actual.bytes, sha256: actual.sha256 };
    });
    durableJson(path.join(runDir, 'publication-intent.json'), {
      schema: INTENT_SCHEMA, job_id: jobId, run_id: runId, status: 'PASS', decision: 'publish', artifacts,
      created_at: new Date().toISOString(),
    });
  }
  if (isStopping()) throw new Error('cancelled before publication');
  return store.publishFiles(downloads, runDir);
}

function createControlledPublicationManager({ runsRoot, imageRoot, outbox }) {
  const runs = path.resolve(runsRoot), images = path.resolve(imageRoot);

  function runDirectory(runId) {
    if (!SAFE_RUN_ID.test(String(runId || ''))) throw new Error('invalid controlled publication run id');
    const dir = path.resolve(runs, runId);
    if (path.dirname(dir) !== runs) throw new Error('controlled publication run escaped runs root');
    const st = fs.lstatSync(dir);
    if (!st.isDirectory() || st.isSymbolicLink()) throw new Error('controlled publication run is not a real directory');
    return dir;
  }

  function registerRun(runId, expectedJobId) {
    const dir = runDirectory(runId);
    const owner = readJson(path.join(dir, 'job-owner.json'));
    const intent = readJson(path.join(dir, 'publication-intent.json'));
    const decision = readJson(path.join(dir, 'publication-decision.json'));
    const index = readJson(path.join(dir, 'canonical-images.json'));
    if (!owner || owner.schema !== 'dexdiffusion.run_owner.v1' || owner.run_id !== runId || !owner.job_id
      || (expectedJobId && owner.job_id !== expectedJobId)) throw new Error('controlled publication owner mismatch');
    if (!intent || intent.schema !== INTENT_SCHEMA || intent.job_id !== owner.job_id || intent.run_id !== runId
      || intent.status !== 'PASS' || intent.decision !== 'publish' || !Array.isArray(intent.artifacts) || !intent.artifacts.length) {
      throw new Error('controlled publication intent is missing or invalid');
    }
    if (!decision || decision.schema !== 'dexdiffusion.publication_decision.v1' || decision.job_id !== owner.job_id
      || decision.run_id !== runId || decision.decision !== 'publish') throw new Error('controlled publication decision is not publish');
    if (!index || index.schema !== 'dexdiffusion.canonical_images.v1' || path.resolve(index.root || '') !== images || !Array.isArray(index.images)) {
      throw new Error('controlled publication index is missing or invalid');
    }
    const registered = [];
    for (const entry of index.images.filter(item => item && item.publication && item.publication.intent_schema === INTENT_SCHEMA)) {
      if (!SAFE_IMAGE_ID.test(entry.image_id || '') || entry.job_id !== owner.job_id || entry.run_id !== runId) throw new Error('controlled publication index ownership mismatch');
      const planned = intent.artifacts.find(item => item.run_file === entry.run_file && item.sha256 === entry.sha256 && item.bytes === entry.bytes);
      if (!planned) throw new Error('controlled publication artifact is absent from durable intent');
      const imagePath = path.join(images, entry.image_id);
      if (path.dirname(imagePath) !== images) throw new Error('controlled publication artifact escaped image root');
      const st = fs.lstatSync(imagePath);
      if (!st.isFile() || st.isSymbolicLink()) throw new Error('controlled publication artifact is not a regular file');
      const actual = hashFile(imagePath);
      if (actual.bytes !== entry.bytes || actual.sha256 !== entry.sha256) throw new Error('controlled publication artifact identity mismatch');
      registered.push(outbox.create(entry, imagePath));
    }
    if (!registered.length) throw new Error('controlled publication has no indexed artifacts');
    return registered;
  }

  function registerCompletedJob(job, durableJob) {
    if (!job || job.commandAction !== 'controlled-generate' || job.status !== 'PASS'
      || !durableJob || durableJob.job_id !== job.id || durableJob.status !== 'COMPLETE') return [];
    const runIds = [...new Set([job.runId, ...(job.results || []).map(result => result.runId)].filter(Boolean))];
    return runIds.flatMap(runId => registerRun(runId, job.id));
  }

  function reconcileRecent(limit = MAX_STARTUP_RUNS) {
    const max = Math.max(1, Math.min(MAX_STARTUP_RUNS, Number(limit) || MAX_STARTUP_RUNS));
    let names = [];
    try { names = fs.readdirSync(runs, { withFileTypes: true }).filter(entry => entry.isDirectory() && SAFE_RUN_ID.test(entry.name)).map(entry => entry.name).sort().reverse().slice(0, max); }
    catch (_) { return { inspected: 0, recovered: 0, unresolved: [] }; }
    const result = { inspected: names.length, recovered: 0, unresolved: [] };
    for (const runId of names) {
      const dir = path.join(runs, runId), index = readJson(path.join(dir, 'canonical-images.json'));
      if (!index || !Array.isArray(index.images)) continue;
      const controlled = index.images.some(entry => entry && entry.publication && entry.publication.intent_schema === INTENT_SCHEMA);
      const marked = index.images.filter(entry => entry && entry.publication && entry.publication.protocol === 'macbook-pull-v1');
      if (!controlled && !marked.length) continue;
      try {
        result.recovered += controlled ? registerRun(runId).length
          : marked.map(entry => outbox.create(entry, path.join(images, entry.image_id))).length;
      }
      catch (error) { result.unresolved.push({ run_id: runId, reason: error.message }); }
    }
    return result;
  }

  return { registerRun, registerCompletedJob, reconcileRecent };
}

module.exports = { INTENT_SCHEMA, MAX_STARTUP_RUNS, createControlledImageStore, publishCompletedControlledRun, createControlledPublicationManager };
