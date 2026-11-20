'use strict';
// Durable engine transfer journal (Gate C).
//
// Contract: every byte of a worker result is durable on the Big Mac internal
// volume before the worker is told it may release its copy, and a journal entry
// is removed only after the run index, canonical bytes, manifest and (cross-host)
// outbox record prove publication. The journal is independent of DEX_DATA_ROOT,
// holds no prompts and no ownership secrets; the owner token stays in the
// protected owner record (~/.dexdiffusion-engine-client/<run_id>.json).
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const crypto = require('node:crypto');

const SCHEMA = 'dexdiffusion.engine_transfer.v1';
const RUN_ID = /^20\d{6}-\d{6}-[A-Za-z0-9_-]{1,80}$/;
const STATES = ['requested', 'downloading', 'downloaded', 'acked', 'published', 'discarding', 'blocked'];
const META_KEYS = new Set(['target', 'backend', 'width', 'height', 'steps', 'seed', 'sampler', 'scheduler', 'cfg_scale',
  'loras', 'operation', 'strength', 'controlnet', 'native_batch_count', 'save_prompts']);
const GiB = 1024 ** 3;

class TransferPending extends Error { constructor(reason, detail) { super(reason + (detail ? ': ' + detail : '')); this.reason = reason; this.retryable = true; } }
class TransferBlocked extends Error { constructor(reason, detail) { super(reason + (detail ? ': ' + detail : '')); this.reason = reason; this.retryable = false; } }

function defaultTransferRoot(home = os.homedir()) {
  return path.join(home, 'Library', 'Application Support', 'DexDiffusion', 'engine-transfer');
}
function sha256(data) { return crypto.createHash('sha256').update(data).digest('hex'); }
function fsyncPath(target) { const fd = fs.openSync(target, 'r'); try { fs.fsyncSync(fd); } finally { fs.closeSync(fd); } }
function inside(parent, child) { const rel = path.relative(parent, child); return !!rel && !rel.startsWith('..') && !path.isAbsolute(rel); }

function createTransferJournal({ root = defaultTransferRoot(), home = os.homedir(), dataRoot = process.env.DEX_DATA_ROOT,
  minFreeBytes = 1 * GiB, maxEntries = 200, maxBytes = 2 * GiB, fault = null } = {}) {
  const base = path.resolve(root);
  const at = point => { if (fault) fault(point); };

  // The journal must live on the home (internal) volume, below the home folder,
  // through real directories only, owned by this user with private modes.
  function assertSafeRoot() {
    const homeDir = path.resolve(home);
    if (!inside(homeDir, base)) throw new TransferBlocked('journal-root-unsafe', 'not below the home folder');
    if (dataRoot && (inside(path.resolve(dataRoot), base) || path.resolve(dataRoot) === base)) throw new TransferBlocked('journal-root-unsafe', 'inside DEX_DATA_ROOT');
    fs.mkdirSync(base, { recursive: true, mode: 0o700 });
    let cursor = homeDir;
    for (const part of path.relative(homeDir, base).split(path.sep)) {
      cursor = path.join(cursor, part);
      const st = fs.lstatSync(cursor);
      if (st.isSymbolicLink() || !st.isDirectory()) throw new TransferBlocked('journal-root-unsafe', 'symlink or non-directory component ' + part);
    }
    const homeStat = fs.statSync(homeDir), st = fs.statSync(base);
    if (st.dev !== homeStat.dev) throw new TransferBlocked('journal-root-unsafe', 'not on the home volume');
    if (typeof process.getuid === 'function' && st.uid !== process.getuid()) throw new TransferBlocked('journal-root-unsafe', 'foreign owner');
    if ((st.mode & 0o077) !== 0) fs.chmodSync(base, 0o700);
    return base;
  }
  function dirFor(runId) { if (!RUN_ID.test(String(runId || ''))) throw new TransferBlocked('invalid-run-id'); return path.join(base, runId); }
  function recordPath(runId) { return path.join(dirFor(runId), 'transfer.json'); }
  function imagePath(runId, index) { return path.join(dirFor(runId), 'output-' + Number(index) + '.png'); }

  function writeAtomic(file, buffer) {
    const tmp = file + '.' + crypto.randomBytes(6).toString('hex') + '.tmp';
    let fd;
    try {
      fd = fs.openSync(tmp, 'wx', 0o600);
      fs.writeSync(fd, buffer);
      fs.fsyncSync(fd);
      fs.closeSync(fd); fd = undefined;
      fs.renameSync(tmp, file);
      fsyncPath(path.dirname(file));
    } finally {
      if (fd !== undefined) { try { fs.closeSync(fd); } catch (_) {} }
      try { fs.unlinkSync(tmp); } catch (_) {}
    }
  }
  function writeRecord(record) {
    const next = { ...record, updated_at: new Date().toISOString() };
    writeAtomic(recordPath(record.run_id), Buffer.from(JSON.stringify(next, null, 2) + '\n'));
    return next;
  }
  function validateRecord(record, runId) {
    if (!record || record.schema !== SCHEMA || record.run_id !== runId || !STATES.includes(record.state)
      || !Number.isInteger(record.count) || record.count < 1 || record.count > 16 || typeof record.run_dir !== 'string'
      || !Array.isArray(record.images) || !Array.isArray(record.run_files) || record.run_files.length !== record.count
      || !record.run_files.every(name => typeof name === 'string' && /^[A-Za-z0-9][A-Za-z0-9._-]{0,200}\.png$/.test(name))
      || path.basename(record.run_dir) !== runId) {
      throw new TransferBlocked('journal-record-corrupt', runId);
    }
    return record;
  }
  function read(runId) {
    let raw;
    try { raw = fs.readFileSync(recordPath(runId), 'utf8'); }
    catch (err) { if (err.code === 'ENOENT') return null; throw new TransferPending('journal-unreadable', err.code); }
    let record;
    try { record = JSON.parse(raw); } catch (_) { throw new TransferBlocked('journal-record-corrupt', runId); }
    return validateRecord(record, runId);
  }
  function begin({ runId, jobId = null, runDir, count, runFiles, meta = {} }) {
    assertSafeRoot();
    const entries = list().length;
    if (entries >= maxEntries) throw new TransferBlocked('journal-capacity-exceeded', entries + ' pending transfers');
    const dir = dirFor(runId);
    fs.mkdirSync(dir, { mode: 0o700 });
    fsyncPath(base);
    const safeMeta = {};
    for (const [key, value] of Object.entries(meta)) if (META_KEYS.has(key) && value !== undefined) safeMeta[key] = value;
    const record = writeRecord({ schema: SCHEMA, run_id: runId, job_id: jobId, run_dir: path.resolve(runDir), count, run_files: runFiles,
      meta: safeMeta, state: 'requested', generate_confirmed: false, expected: [], images: [], attempts: 0,
      created_at: new Date().toISOString() });
    at('after-begin');
    return record;
  }
  function update(runId, patch) {
    const current = read(runId);
    if (!current) throw new TransferBlocked('journal-record-missing', runId);
    return writeRecord({ ...current, ...patch });
  }
  function journalBytes() {
    let total = 0;
    for (const runId of list()) {
      try { for (const name of fs.readdirSync(dirFor(runId))) if (/^output-\d+\.png$/.test(name)) total += fs.statSync(path.join(dirFor(runId), name)).size; } catch (_) {}
    }
    return total;
  }
  // Refuse before the download (and therefore before ACK) when the internal
  // volume cannot hold the result with headroom; the worker keeps its copy.
  function assertCapacity(bytesNeeded) {
    assertSafeRoot();
    let free;
    try { const s = fs.statfsSync(base); free = Number(s.bavail) * Number(s.bsize); }
    catch (err) { throw new TransferPending('journal-capacity-unknown', err.code); }
    const required = Math.max(minFreeBytes, 3 * bytesNeeded);
    if (free < required) throw new TransferBlocked('insufficient-journal-capacity', `${free} bytes free, ${required} required`);
    if (journalBytes() + bytesNeeded > maxBytes) throw new TransferBlocked('journal-capacity-exceeded', 'byte cap');
  }
  function verifyFile(runId, index, expected) {
    try {
      const data = fs.readFileSync(imagePath(runId, index));
      return data.length === expected.bytes && sha256(data) === expected.sha256;
    } catch (err) { if (err.code === 'ENOENT') return false; throw new TransferPending('journal-unreadable', err.code); }
  }
  function writeImage(runId, index, data, expected) {
    if (data.length !== expected.bytes || sha256(data) !== expected.sha256) throw new TransferPending('worker-result-digest-mismatch', 'index ' + index);
    const file = imagePath(runId, index);
    if (verifyFile(runId, index, expected)) return read(runId);
    writeAtomic(file, data);
    at('after-image-write');
    const record = read(runId);
    const images = record.images.filter(i => i.index !== index).concat([{ index, sha256: expected.sha256, bytes: expected.bytes, run_file: record.run_files[index] }]).sort((a, b) => a.index - b.index);
    return update(runId, { images });
  }
  // A hard link is what the image store consumes (and unlinks after commit),
  // so the journal's own durable copy survives until publication is proven.
  function stage(runId, index) {
    const staged = path.join(dirFor(runId), 'stage-' + Number(index) + '.png');
    try { fs.unlinkSync(staged); } catch (err) { if (err.code !== 'ENOENT') throw err; }
    fs.linkSync(imagePath(runId, index), staged);
    return staged;
  }
  function remove(runId) {
    const dir = dirFor(runId);
    at('before-remove');
    for (const name of fs.readdirSync(dir)) if (name !== 'transfer.json') fs.unlinkSync(path.join(dir, name));
    try { fs.unlinkSync(path.join(dir, 'transfer.json')); } catch (err) { if (err.code !== 'ENOENT') throw err; }
    fs.rmdirSync(dir);
    fsyncPath(base);
  }
  function list() {
    let names;
    try { names = fs.readdirSync(base, { withFileTypes: true }); }
    catch (err) { if (err.code === 'ENOENT') return []; throw new TransferPending('journal-unreadable', err.code); }
    return names.filter(d => d.isDirectory() && RUN_ID.test(d.name)).map(d => d.name).sort();
  }
  // One owner per run at a time; a lock left by a dead process is reclaimed.
  function lock(runId) {
    const file = path.join(dirFor(runId), '.lock');
    for (let attempt = 0; attempt < 2; attempt++) {
      try {
        const fd = fs.openSync(file, 'wx', 0o600);
        fs.writeSync(fd, String(process.pid)); fs.fsyncSync(fd); fs.closeSync(fd);
        return () => { try { if (fs.readFileSync(file, 'utf8') === String(process.pid)) fs.unlinkSync(file); } catch (_) {} };
      } catch (err) {
        if (err.code !== 'EEXIST') throw err;
        const pid = Number(fs.readFileSync(file, 'utf8'));
        let alive = false;
        try { if (pid > 0 && pid !== process.pid) { process.kill(pid, 0); alive = true; } } catch (e) { alive = e.code === 'EPERM'; }
        if (alive || pid === process.pid) throw new TransferPending('transfer-in-progress', 'pid ' + pid);
        try { fs.unlinkSync(file); } catch (_) {}
      }
    }
    throw new TransferPending('transfer-in-progress');
  }
  // Persist cancellation intent synchronously (safe from a signal handler).
  function requestCancel(runId) { try { const r = read(runId); if (r && !r.cancel_requested) writeRecord({ ...r, cancel_requested: true }); } catch (_) {} }
  // An entry with no record and no other files was created before generate was
  // ever sent: nothing is owed. Any surviving file is evidence and is kept.
  function removeEmpty(runId) {
    const dir = dirFor(runId);
    const names = fs.readdirSync(dir).filter(n => n !== '.lock' && !/^transfer\.json\.[0-9a-f]+\.tmp$/.test(n));
    if (names.length) return names;
    for (const name of fs.readdirSync(dir)) fs.unlinkSync(path.join(dir, name));
    fs.rmdirSync(dir); fsyncPath(base);
    return null;
  }
  return { root: base, assertSafeRoot, begin, read, update, writeImage, verifyFile, stage, remove, removeEmpty, list, lock, assertCapacity, requestCancel, fault: at };
}

// ENOENT means no decision exists. Any other failure (EPERM, EIO, corrupt JSON)
// means the cancellation decision cannot be established: block, never guess.
function readDecision(runDir) {
  let raw;
  try { raw = fs.readFileSync(path.join(runDir, 'publication-decision.json'), 'utf8'); }
  catch (err) { if (err.code === 'ENOENT') return null; throw new TransferBlocked('cancellation-evidence-unreadable', err.code || err.message); }
  try { return JSON.parse(raw).decision || null; }
  catch (_) { throw new TransferBlocked('cancellation-evidence-unreadable', 'corrupt publication-decision.json'); }
}
function isOwnedJob(error) { return /unknown owned job/i.test(String(error && error.message || error)); }

// Advance one journal entry as far as the evidence allows. Shared verbatim by
// the bridge (first attempt) and startup reconciliation (every later attempt),
// so both follow the same idempotent order:
//   status -> durable download -> ACK -> publish (run index) -> manifest -> outbox -> remove.
async function advanceTransfer(runId, { journal, owned, store, runsRoot = null, isStopping = () => false, outbox = null, imageRoot = null, manifestExtras = {}, validateImage = null }) {
  let record = journal.read(runId);
  if (!record) {
    const surviving = journal.removeEmpty(runId);
    if (!surviving) return { state: 'no-output', reason: 'record-never-written' };
    throw new TransferBlocked('journal-record-missing', 'surviving files: ' + surviving.join(','));
  }
  const runDir = record.run_dir;
  // Publication goes only into this run's own folder under the configured runs root.
  if (runsRoot && path.relative(path.resolve(runsRoot), path.resolve(runDir)) !== runId) throw new TransferBlocked('run-dir-untrusted', runId);
  // Cancellation intent is durable: a live stop, a persisted cancel request, or the run's cancel decision.
  // Errors propagate: unreadable cancellation evidence blocks before any ACK or publication.
  const cancelled = () => { const r = journal.read(runId); return !!(r && r.cancel_requested) || readDecision(runDir) === 'cancel'; };
  const stopping = () => isStopping() || cancelled();
  const call = async (op, extra) => {
    if (!owned) throw new TransferBlocked('owner-record-missing', runId);
    return owned(op, extra);
  };
  journal.update(runId, { attempts: (record.attempts || 0) + 1 });
  record = journal.read(runId);

  if (record.state === 'discarding' || (stopping() && ['requested', 'downloading', 'downloaded'].includes(record.state))) {
    if (record.state !== 'discarding') record = journal.update(runId, { state: 'discarding' });
    let status = null;
    try { status = await call('status'); } catch (err) { if (!isOwnedJob(err)) throw new TransferPending('worker-unavailable', err.message); }
    if (status && !['complete', 'failed', 'cancelled'].includes(status.status)) { await call('cancel').catch(() => {}); return { state: 'pending', reason: 'cancel-awaiting-worker' }; }
    if (status) { const ack = await call('ack'); if (!ack.acknowledged) throw new TransferPending('remote-cleanup-not-verified'); }
    journal.remove(runId);
    return { state: 'discarded' };
  }

  if (record.state === 'requested' || record.state === 'downloading') {
    let status;
    try { status = await call('status'); }
    catch (err) {
      if (err instanceof TransferBlocked) throw err;
      if (isOwnedJob(err)) {
        if (!record.generate_confirmed) { journal.remove(runId); return { state: 'no-output', reason: 'worker-never-accepted' }; }
        throw new TransferBlocked('worker-receipt-missing', runId);
      }
      throw new TransferPending('worker-unavailable', err.message);
    }
    if (!['complete', 'failed', 'cancelled'].includes(status.status)) return { state: 'pending', reason: 'worker-running', status: status.status };
    if (status.status !== 'complete') { journal.remove(runId); return { state: 'no-output', reason: 'worker-' + status.status, status }; }
    if (status.acknowledged) {
      // The worker released its copy; only a complete local journal can continue.
      const images = record.images;
      if (images.length !== record.count || !images.every(i => journal.verifyFile(runId, i.index, i))) throw new TransferBlocked('worker-acknowledged-without-journal', runId);
      record = journal.update(runId, { state: 'acked' });
    } else {
      const expected = (status.images || [status]).map((image, index) => ({ index, sha256: image.sha256, bytes: image.bytes }));
      if (expected.length !== record.count || expected.some(e => !/^[a-f0-9]{64}$/.test(e.sha256 || '') || !Number.isInteger(e.bytes))) throw new TransferBlocked('worker-receipt-inconsistent', runId);
      record = journal.update(runId, { state: 'downloading', expected, generate_confirmed: true });
      const missing = expected.filter(e => !journal.verifyFile(runId, e.index, e));
      if (missing.length) journal.assertCapacity(missing.reduce((n, e) => n + e.bytes, 0));
      for (const exp of missing) {
        if (stopping()) return advanceTransfer(runId, arguments[1]);
        journal.fault('before-result');
        let result;
        try { result = await call('result', record.count > 1 ? { index: exp.index } : {}); }
        catch (err) { throw new TransferPending('worker-result-unavailable', err.message); }
        journal.fault('after-result');
        const data = Buffer.from(String(result.png || ''), 'base64');
        if (result.sha256 !== exp.sha256) throw new TransferPending('worker-result-digest-mismatch', 'index ' + exp.index);
        journal.writeImage(runId, exp.index, data, exp);
      }
      record = journal.read(runId);
      if (!record.expected.every(e => journal.verifyFile(runId, e.index, e))) throw new TransferBlocked('journal-digest-mismatch', runId);
      record = journal.update(runId, { state: 'downloaded' });
      journal.fault('after-downloaded');
    }
  }

  if (record.state === 'downloaded') {
    if (stopping()) return advanceTransfer(runId, arguments[1]);
    if (!record.expected.every(e => journal.verifyFile(runId, e.index, e))) throw new TransferBlocked('journal-digest-mismatch', runId);
    let ack;
    try { ack = await call('ack'); }
    catch (err) {
      if (err instanceof TransferBlocked) throw err;
      throw new TransferPending('ack-uncertain', err.message);
    }
    journal.fault('after-ack-sent');
    if (!ack.acknowledged || !ack.cleanup) throw new TransferPending('remote-cleanup-not-verified');
    record = journal.update(runId, { state: 'acked', images: record.expected.map(e => ({ ...e, run_file: record.run_files[e.index] })) });
    journal.fault('after-acked');
  }

  if (record.state === 'acked') {
    if (stopping()) {
      // The owner cancelled after the worker released its copy: an explicit,
      // recorded discard (the same outcome the bridge always had), never silent.
      if (readDecision(runDir) !== 'publish') { try { store.requestPublicationCancellation(runDir, record.job_id); } catch (_) {} }
      if (readDecision(runDir) !== 'publish') { journal.remove(runId); return { state: 'discarded', reason: 'cancelled-after-ack' }; }
    }
    const index = store.readRunIndex(runDir);
    const published = image => index.find(e => e.run_id === runId && e.run_file === image.run_file && e.sha256 === image.sha256);
    const todo = record.images.filter(image => !published(image));
    for (const image of todo) if (!journal.verifyFile(runId, image.index, image)) throw new TransferBlocked('journal-digest-mismatch', runId + ' index ' + image.index);
    if (todo.length) {
      const seed = Number(record.meta.seed);
      try {
        store.publishFiles(todo.map(image => ({ src: journal.stage(runId, image.index), runDir, runId, runFile: image.run_file,
          seed: Number.isFinite(seed) ? seed + image.index : undefined })), runDir);
      } catch (err) {
        if (/publication cancelled before decision/.test(err.message)) { journal.remove(runId); return { state: 'discarded', reason: 'cancel-decision' }; }
        throw new TransferPending('publication-failed', err.code || err.message);
      }
    }
    journal.fault('after-publish');
    const after = store.readRunIndex(runDir);
    const entries = record.images.map(image => after.find(e => e.run_id === runId && e.run_file === image.run_file && e.sha256 === image.sha256));
    if (entries.some(e => !e)) throw new TransferPending('publication-not-indexed', runId);
    record = journal.update(runId, { state: 'published', image_ids: entries.map(e => e.image_id) });
  }

  if (record.state === 'published') {
    const index = store.readRunIndex(runDir);
    const entries = record.image_ids.map(id => index.find(e => e.image_id === id && e.run_id === runId));
    if (entries.some(e => !e)) throw new TransferBlocked('publication-evidence-missing', runId);
    for (const entry of entries) {
      const image = store.resolveImage(entry.image_id);
      if (!image) throw new TransferPending('canonical-image-unavailable', entry.image_id);
      if (validateImage) { const actual = validateImage(image.path); if (actual.sha256 !== entry.sha256) throw new TransferBlocked('canonical-digest-mismatch', entry.image_id); }
      if (outbox && entry.publication && entry.publication.protocol === 'macbook-pull-v1' && !outbox.read(entry.image_id)) {
        outbox.create(entry, path.join(imageRoot, entry.image_id));
      }
    }
    const manifestPath = path.join(runDir, 'controlled-manifest.json');
    let existing = null;
    try { existing = JSON.parse(fs.readFileSync(manifestPath, 'utf8')); } catch (_) {}
    if (!existing || existing.status !== 'PASS' || existing.run_id !== runId || existing.image_id !== entries[0].image_id) {
      const m = record.meta;
      const logical = record.run_files.map(name => path.join(runDir, name));
      const manifest = { schema: 'dexdiffusion.local-engine.v1', run_id: runId, status: 'PASS', controlledTarget: m.target,
        backend: m.backend || 'sdcpp', controlledOutputImage: logical[0], image_id: entries[0].image_id, local_png: logical[0],
        width: m.width, height: m.height, steps: m.steps, seed_label: String(m.seed), sampler: m.sampler, scheduler: m.scheduler,
        cfg_scale: m.cfg_scale, loras: m.loras, prompt: '[REDACTED]', runtime_controlled_proven: true,
        ...(m.operation ? { operation: m.operation, strength: m.strength } : {}), ...(m.controlnet ? { controlnet: m.controlnet } : {}),
        native_batch_count: record.count, images: entries, transfer_journal: SCHEMA, ...manifestExtras };
      const tmp = manifestPath + '.' + crypto.randomBytes(6).toString('hex') + '.tmp';
      const fd = fs.openSync(tmp, 'wx', 0o600);
      try { fs.writeSync(fd, JSON.stringify(manifest, null, 2) + '\n'); fs.fsyncSync(fd); } finally { fs.closeSync(fd); }
      fs.renameSync(tmp, manifestPath);
      fsyncPath(runDir);
    }
    journal.fault('after-manifest');
    journal.remove(runId);
    return { state: 'complete', entries, manifestPath, logicalOutputs: record.run_files.map(name => path.join(runDir, name)) };
  }
  if (record.state === 'blocked') throw new TransferBlocked(record.blocked_reason || 'blocked', runId);
  return { state: 'pending', reason: 'state-' + record.state };
}

// Single owner of every journal entry after the bridge that created it is gone.
// Never deletes bytes without publication evidence or a definite no-output answer.
async function reconcileTransfers({ journal, ownedFor, store, runsRoot = null, outbox = null, imageRoot = null, validateImage = null }) {
  const result = { inspected: 0, completed: [], discarded: [], no_output: [], pending: [], blocked: [] };
  let ids;
  try { ids = journal.list(); } catch (err) { result.blocked.push({ reason: err.reason || 'journal-unreadable', detail: err.message }); return result; }
  for (const runId of ids) {
    result.inspected++;
    let release = null;
    try {
      release = journal.lock(runId);
      let owned;
      // A missing or corrupt owner record only matters where the worker must be asked.
      try { owned = ownedFor(runId); }
      catch (err) { owned = () => Promise.reject(err); }
      const outcome = await advanceTransfer(runId, { journal, owned, store, runsRoot, outbox, imageRoot, validateImage });
      if (outcome.state === 'complete') result.completed.push({ run_id: runId, image_ids: outcome.entries.map(e => e.image_id) });
      else if (outcome.state === 'discarded') result.discarded.push({ run_id: runId, reason: outcome.reason });
      else if (outcome.state === 'no-output') result.no_output.push({ run_id: runId, reason: outcome.reason });
      else if (outcome.state === 'absent') result.blocked.push({ run_id: runId, reason: 'journal-record-missing' });
      else result.pending.push({ run_id: runId, reason: outcome.reason });
    } catch (err) {
      const row = { run_id: runId, reason: err.reason || 'reconciliation-error', detail: String(err.message).slice(0, 200) };
      (err.retryable === false ? result.blocked : result.pending).push(row);
    } finally { if (release) release(); }
  }
  return result;
}

// Owner record → owned request. Missing or corrupt records are explicit errors.
function ownerBackedRequest(runId, { readOwner, request }) {
  let owner;
  try { owner = readOwner(runId); } catch (_) { throw new TransferBlocked('owner-record-corrupt', runId); }
  if (!owner) throw new TransferBlocked('owner-record-missing', runId);
  if (owner.run_id !== runId || !/^[a-f0-9]{64}$/.test(String(owner.token || ''))) throw new TransferBlocked('owner-record-corrupt', runId);
  return (op, extra = {}) => request({ op, run_id: runId, token: owner.token, ...extra });
}

function transferPendingRunId(output) {
  const match = String(output || '').match(/ENGINE_TRANSFER_PENDING:\s*(20\d{6}-\d{6}-[A-Za-z0-9_-]{1,80})/);
  return match ? match[1] : null;
}

module.exports = { SCHEMA, createTransferJournal, defaultTransferRoot, advanceTransfer, reconcileTransfers, ownerBackedRequest,
  transferPendingRunId, TransferPending, TransferBlocked };
