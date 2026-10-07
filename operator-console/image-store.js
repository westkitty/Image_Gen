'use strict';

// Canonical image authority for DexDiffusion.
//
// Every final generated image lives exactly once under CANONICAL_IMAGE_ROOT.
// Run directories keep metadata only; `canonical-images.json` in a run dir maps
// the run-relative name a backend originally produced to the canonical file.

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { validateImage, inspectImageFiles } = require('./image-validation');

const CANONICAL_IMAGE_ROOT = '/Users/andrew/images_made';
const RUN_IMAGE_INDEX = 'canonical-images.json';
const IMAGE_CONTENT_TYPES = {
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
  '.gif': 'image/gif',
};
const SAFE_IMAGE_ID = /^[A-Za-z0-9][A-Za-z0-9_-]*(\.[A-Za-z0-9_-]+)*$/;

function datedImageKey(imageId) {
  const match = /^(20\d{6})-(\d{6})/.exec(String(imageId || ''));
  return match ? match[1] + match[2] : null;
}

function isImageName(name) {
  return Object.prototype.hasOwnProperty.call(IMAGE_CONTENT_TYPES, path.extname(String(name)).toLowerCase());
}

function hasImageSignature(file) {
  let fd;
  try {
    fd = fs.openSync(file, 'r');
    const b = Buffer.alloc(12);
    const n = fs.readSync(fd, b, 0, 12, 0);
    if (n < 4) return false;
    if (b.slice(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) return true;
    if (b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff) return true;
    if (b.slice(0, 4).toString('latin1') === 'GIF8') return true;
    if (b.slice(0, 4).toString('latin1') === 'RIFF' && b.slice(8, 12).toString('latin1') === 'WEBP') return true;
    return false;
  } catch (_) {
    return false;
  } finally {
    if (fd !== undefined) fs.closeSync(fd);
  }
}

function safeComponent(value, fallback) {
  const s = String(value == null ? '' : value).replace(/[^A-Za-z0-9_-]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 80);
  return s || fallback;
}

function createImageStore({ root = CANONICAL_IMAGE_ROOT, fault } = {}) {
  const rootDir = path.resolve(root);

  function ensureRoot() {
    fs.mkdirSync(rootDir, { recursive: true });
    return rootDir;
  }

  // Resolve a client-supplied image id to a file strictly inside the root.
  function resolveImage(id) {
    if (typeof id !== 'string' || id.length === 0 || id.length > 255) return null;
    if (!SAFE_IMAGE_ID.test(id) || !isImageName(id)) return null;
    const full = path.resolve(rootDir, id);
    if (path.dirname(full) !== rootDir) return null;
    let st;
    try { st = fs.lstatSync(full); } catch (_) { return null; }
    if (!st.isFile() || pendingImageIds().has(id)) return null;
    return { id, path: full, contentType: IMAGE_CONTENT_TYPES[path.extname(id).toLowerCase()] };
  }

  function imageUrl(id) {
    return '/api/images/' + encodeURIComponent(id);
  }

  function canonicalBaseName({ runId, seed, runFile }) {
    const run = safeComponent(runId, 'run');
    const src = safeComponent(path.basename(String(runFile || 'image'), path.extname(String(runFile || ''))), 'image');
    const seedPart = seed !== undefined && seed !== null && seed !== '' ? '-s' + safeComponent(seed, 'x') : '';
    return `${run}${seedPart}-${src}`;
  }

  function at(point) { if (fault) fault(point); }
  function pendingImageIds() {
    const ids = new Set();
    let names; try { names = fs.readdirSync(rootDir); } catch (_) { return ids; }
    for (const name of names.filter(n => /^\.pending-.*\.json$/.test(n))) {
      try {
        const journal = JSON.parse(fs.readFileSync(path.join(rootDir, name), 'utf8'));
        for (const id of journal.image_ids || []) {
          const ownership = (journal.image_records || []).find(r => r.image_id === id);
          let st; try { st = fs.lstatSync(path.join(rootDir, id)); } catch (_) {}
          // A name collision must never hide an unrelated pre-existing inode.
          if (!st || !ownership || (st.dev === ownership.device && st.ino === ownership.inode)) ids.add(id);
        }
      } catch (_) {}
    }
    return ids;
  }
  function writeJsonAtomic(file, data) {
    const tmp = file + '.' + crypto.randomBytes(8).toString('hex') + '.tmp';
    try { fs.writeFileSync(tmp, JSON.stringify(data, null, 2) + '\n', { flag: 'wx' }); fs.renameSync(tmp, file); }
    finally { try { fs.unlinkSync(tmp); } catch (_) {} }
  }
  function publishFiles(files, runDir) {
    ensureRoot();
    const token = crypto.randomBytes(12).toString('hex');
    const journal = path.join(rootDir, '.pending-' + token + '.json');
    const staged = [], linked = [];
    let committed = false, rollbackComplete = true;
    try {
      at('before-transfer');
      for (const item of files) {
        const incoming = path.join(rootDir, '.incoming-' + token + '-' + staged.length + path.extname(item.src).toLowerCase());
        const row = { ...item, incoming }; staged.push(row);
        fs.copyFileSync(item.src, incoming, fs.constants.COPYFILE_EXCL);
        at('after-transfer');
        row.validation = validateImage(incoming);
        at('after-validation');
      }
      const indexFile = path.join(runDir, RUN_IMAGE_INDEX);
      if (fs.existsSync(indexFile)) {
        const previous = JSON.parse(fs.readFileSync(indexFile, 'utf8'));
        if (!Array.isArray(previous.images)) throw new Error('canonical index invalid; historical metadata preserved');
      }
      const images = readRunIndex(runDir);
      const entries = [];
      for (const row of staged) {
        const base = canonicalBaseName(row);
        for (let i = 1; i < 1000; i++) {
          const id = base + (i > 1 ? '-' + i : '') + path.extname(row.src).toLowerCase();
          if (fs.existsSync(path.join(rootDir, id))) continue;
          const inode = fs.statSync(row.incoming);
          writeJsonAtomic(journal, { schema: 'dexdiffusion.image_publication.pending.v1', run_dir: runDir, host: 'local', cleanup_state: 'pending', incoming_paths: staged.map(r => r.incoming), source_paths: staged.map(r => r.src), inspected_at: new Date().toISOString(), image_ids: [...linked.map(e => e.image_id), id], image_records: [...linked.map(e => { const st = fs.statSync(e.image_path); return { image_id: e.image_id, device: st.dev, inode: st.ino }; }), { image_id: id, device: inode.dev, inode: inode.ino }] });
          at('before-publication');
          try { fs.linkSync(row.incoming, path.join(rootDir, id)); }
          catch (err) { if (err.code === 'EEXIST') continue; throw err; }
          const entry = { run_file: row.runFile, image_id: id, image_path: path.join(rootDir, id), image_url: imageUrl(id), ...row.validation, published_at: new Date().toISOString() };
          if (row.seed !== undefined) entry.seed = String(row.seed);
          linked.push(entry); entries.push(entry); at('after-publication'); break;
        }
        if (entries.length < staged.indexOf(row) + 1) throw new Error('no free canonical filename');
      }
      at('before-metadata');
      writeRunIndex(runDir, [...images, ...entries]);
      committed = true;
      at('after-metadata');
      // Once metadata commits, cleanup must never roll back canonical bytes.
      const remainingSources = [];
      for (const row of staged) { try { fs.unlinkSync(row.src); } catch (_) { remainingSources.push(row.src); } }
      if (remainingSources.length) {
        const pending = JSON.parse(fs.readFileSync(journal, 'utf8'));
        writeJsonAtomic(journal, { ...pending, cleanup_state: 'failed', source_paths: remainingSources });
        throw new Error('canonical-source-cleanup-failed');
      }
      fs.unlinkSync(journal);
      return entries;
    } catch (err) {
      if (!committed) { for (const e of linked) { try { fs.unlinkSync(e.image_path); } catch (_) { rollbackComplete = false; } } }
      throw err;
    } finally {
      for (const row of staged) { try { fs.unlinkSync(row.incoming); } catch (_) {} }
      if (!committed && rollbackComplete) { try { fs.unlinkSync(journal); } catch (_) {} }
    }
  }
  function publishFile(src, { runDir, runId = path.basename(runDir), seed, runFile = path.basename(src) }) {
    return publishFiles([{ src, runId, seed, runFile }], runDir)[0];
  }
  function adoptFile(src, options) {
    if (!options.runDir) throw new Error('canonical metadata runDir required');
    return publishFile(src, options);
  }
  function replacePublishedImage(runDir, imageId, transform) {
    const original = resolveImage(imageId);
    const images = readRunIndex(runDir);
    const entry = images.find(e => e.image_id === imageId);
    if (!original || !entry) throw new Error('canonical reference missing');
    const token = crypto.randomBytes(12).toString('hex');
    const staged = path.join(rootDir, '.incoming-' + token + path.extname(imageId));
    const backup = path.join(rootDir, '.backup-' + token + path.extname(imageId));
    const journal = path.join(rootDir, '.pending-' + token + '.json');
    let replaced = false, committed = false, restored = false;
    try {
      fs.copyFileSync(original.path, staged, fs.constants.COPYFILE_EXCL);
      transform(staged);
      const validation = validateImage(staged);
      fs.linkSync(original.path, backup);
      writeJsonAtomic(journal, { schema: 'dexdiffusion.image_publication.pending.v1', run_dir: runDir, host: 'local', cleanup_state: 'pending', incoming_paths: [staged], image_ids: [imageId], image_records: [{ image_id: imageId, device: fs.statSync(staged).dev, inode: fs.statSync(staged).ino }], backup_path: backup, inspected_at: new Date().toISOString() });
      fs.renameSync(staged, original.path); replaced = true;
      at('before-metadata');
      const updated = { ...entry, ...validation, transformed_at: new Date().toISOString() };
      writeRunIndex(runDir, images.map(e => e === entry ? updated : e)); committed = true;
      fs.unlinkSync(journal);
      return updated;
    } catch (err) { if (replaced && !committed) { fs.renameSync(backup, original.path); restored = true; } throw err; }
    finally {
      try { fs.unlinkSync(staged); } catch (_) {}
      if (committed || restored || !replaced) {
        try { fs.unlinkSync(backup); } catch (_) {}
        if (!committed) { try { fs.unlinkSync(journal); } catch (_) {} }
      }
    }
  }

  function readRunIndex(runDir) {
    try {
      const data = JSON.parse(fs.readFileSync(path.join(runDir, RUN_IMAGE_INDEX), 'utf8'));
      return Array.isArray(data.images) ? data.images : [];
    } catch (_) {
      return [];
    }
  }

  function writeRunIndex(runDir, images) {
    writeJsonAtomic(path.join(runDir, RUN_IMAGE_INDEX), { schema: 'dexdiffusion.canonical_images.v1', root: rootDir, images });
  }

  function findRunImageFiles(runDir) {
    const out = [];
    const walk = (dir, depth) => {
      let entries;
      try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch (_) { return; }
      for (const e of entries) {
        const full = path.join(dir, e.name);
        if (e.isDirectory() && depth < 3) walk(full, depth + 1);
        else if (e.isFile() && isImageName(e.name)) out.push(full);
      }
    };
    walk(runDir, 0);
    return out.sort();
  }

  // Move every real generated image out of a run dir into the canonical root.
  function adoptRunImages(runDir, { seed, seedFor } = {}) {
    const runId = path.basename(runDir);
    const files = findRunImageFiles(runDir).map(file => {
      const runFile = path.relative(runDir, file);
      const fileSeed = seedFor ? seedFor(runFile) : undefined;
      return { src: file, runId, runFile, seed: fileSeed !== undefined ? fileSeed : seed };
    });
    return files.length ? publishFiles(files, runDir) : [];
  }

  // Read-only reconciliation: absence stays absence; no images or indices mutate.
  function inspectIntegrity({ runsRoot, references = [] } = {}) {
    const inspected_at = new Date().toISOString();
    const refs = references.map(r => ({ ...r })), metadata_errors = [];
    if (runsRoot) {
      let dirs = []; try { dirs = fs.readdirSync(runsRoot, { withFileTypes: true }).filter(d => d.isDirectory()); } catch (_) {}
      for (const dir of dirs) {
        const index = path.join(runsRoot, dir.name, RUN_IMAGE_INDEX);
        if (!fs.existsSync(index)) continue;
        try {
          const data = JSON.parse(fs.readFileSync(index, 'utf8'));
          if (!Array.isArray(data.images)) throw new Error('invalid images index');
          refs.push(...data.images.map(e => ({ ...e, run_id: dir.name, metadata_path: index })));
        } catch (_) { metadata_errors.push({ state: 'broken', run_id: dir.name, metadata_path: index, reason: 'invalid-index', inspected_at }); }
      }
    }
    const logicalCounts = new Map();
    for (const ref of refs) {
      const key = [ref.run_id || ref.job_id || ref.metadata_path || '', ref.run_file || ref.image_id].join(':');
      logicalCounts.set(key, (logicalCounts.get(key) || 0) + 1);
    }
    const grouped = new Map();
    for (const ref of refs) {
      const id = ref.image_id;
      if (!grouped.has(id)) grouped.set(id, []);
      grouped.get(id).push(ref);
    }
    let names = []; try { names = fs.readdirSync(rootDir).filter(isImageName).filter(n => !n.startsWith('.')); } catch (_) {}
    const pending = pendingImageIds();
    const ids = [...new Set([...names, ...grouped.keys(), ...pending])];
    const rows = ids.map(image_id => {
      const owners = grouped.get(image_id) || [];
      const safe = typeof image_id === 'string' && SAFE_IMAGE_ID.test(image_id) && isImageName(image_id);
      const file = safe ? path.join(rootDir, image_id) : null;
      let st; try { if (file) st = fs.lstatSync(file); } catch (_) {}
      const row = { image_id, path: file, inspected_at, owners, reference_state: owners.length ? 'referenced' : 'unreferenced', known_digests: [...new Set(owners.map(r => r.sha256).filter(Boolean))], state: safe ? (st ? 'valid' : 'missing') : 'broken', sha256: null, bytes: null };
      if (st && !st.isFile()) { row.state = 'broken'; row.reason = 'not-regular-file'; }
      if (st && st.isFile()) { row.bytes = st.size; row.sha256 = crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex'); row.decode = true; }
      return row;
    });
    const toDecode = rows.filter(r => r.decode);
    const decoded = inspectImageFiles(toDecode.map(r => r.path));
    toDecode.forEach((row, i) => {
      delete row.decode;
      const d = decoded[i];
      if (!d.valid) { row.state = d.error === 'image-validation-unavailable' ? 'unknown' : 'broken'; row.reason = d.error; }
      else {
        row.format = d.format; row.dimensions = d.dimensions;
        if (row.owners.some(r => r.sha256 && r.sha256 !== row.sha256)) row.state = 'digest-mismatch';
        else if (!row.owners.length) row.state = 'orphan';
        const logical = row.owners.map(r => [r.run_id || r.job_id || r.metadata_path || '', r.run_file || r.image_id].join(':'));
        if (logical.some(key => logicalCounts.get(key) > 1)) row.duplicate_logical_reference = true;
      }
    });
    for (const row of rows) {
      if (row.owners.some(r => r.image_path && path.resolve(r.image_path) !== row.path)) { row.state = 'broken'; row.reason = 'reference-path-mismatch'; }
      if (pending.has(row.image_id)) row.state = 'pending';
    }

    // A missing path is not automatically a current runtime failure. Classify a
    // fully dated, strictly older missing cohort as historical only when it does
    // not overlap the retained dated cohort. Any ambiguity or overlap stays a
    // current problem; the underlying references are always preserved.
    const validDated = rows.filter(r => r.state === 'valid').map(r => datedImageKey(r.image_id)).filter(Boolean).sort();
    const missingRows = rows.filter(r => r.state === 'missing');
    const missingDated = missingRows.map(r => datedImageKey(r.image_id)).filter(Boolean).sort();
    const historicalGap = missingRows.length > 0 && missingDated.length === missingRows.length && validDated.length > 0
      && missingDated[missingDated.length - 1] < validDated[0];
    for (const row of missingRows) {
      row.missing_classification = historicalGap ? 'historical-missing-reference' : 'current-missing-reference';
      row.classification_basis = historicalGap
        ? 'missing dated cohort predates retained dated canonical cohort'
        : 'missing reference overlaps or cannot be separated from retained canonical cohort';
    }
    const counts = { valid: 0, missing: 0, orphan: 0, 'digest-mismatch': 0, broken: metadata_errors.length, duplicate: 0, pending: 0, unknown: 0 };
    for (const row of rows) { counts[row.state]++; if (row.duplicate_logical_reference) counts.duplicate++; }
    const historical_missing_references = missingRows.filter(r => r.missing_classification === 'historical-missing-reference').length;
    const current_missing_references = missingRows.length - historical_missing_references;
    const current_problems = current_missing_references + counts.broken + counts['digest-mismatch'] + counts.pending + counts.unknown;
    const classification = {
      current_problems,
      current_missing_references,
      historical_missing_references,
      retained_dated_cohort_start: validDated[0] || null,
      historical_missing_cohort_end: historicalGap ? missingDated[missingDated.length - 1] : null,
      basis: historicalGap
        ? 'strict non-overlap between fully dated missing and retained canonical cohorts'
        : 'conservative: missing references remain current when cohort separation is unavailable'
    };
    const pending_publications = [];
    let journalNames = []; try { journalNames = fs.readdirSync(rootDir).filter(n => /^\.pending-.*\.json$/.test(n)); } catch (_) {}
    for (const name of journalNames) {
      const journal_path = path.join(rootDir, name);
      try { pending_publications.push({ ...JSON.parse(fs.readFileSync(journal_path, 'utf8')), journal_path }); }
      catch (_) { pending_publications.push({ journal_path, cleanup_state: 'unknown', reason: 'invalid-publication-journal' }); }
    }
    return { schema: 'dexdiffusion.image_integrity.v1', root: rootDir, inspected_at, counts, classification, records: rows, metadata_errors, pending_publications };
  }

  function runSeedLabel(runDir) {
    try {
      const m = JSON.parse(fs.readFileSync(path.join(runDir, 'controlled-manifest.json'), 'utf8'));
      const seed = String(m.seed_label || '').match(/^\d+/);
      return seed ? seed[0] : undefined;
    } catch (_) {
      return undefined;
    }
  }

  // Finalize a completed run: the single entrypoint used by the server and by
  // bin/canonicalize-image.js (direct shell runs).
  // Native sd-cli batches write per-output seeds to controlled-extras.json.
  function runOutputSeeds(runDir) {
    try {
      const x = JSON.parse(fs.readFileSync(path.join(runDir, 'controlled-extras.json'), 'utf8'));
      return x && x.output_seeds && typeof x.output_seeds === 'object' ? x.output_seeds : null;
    } catch (_) {
      return null;
    }
  }

  function finalizeRun(runDir) {
    const seeds = runOutputSeeds(runDir);
    const seedFor = seeds ? f => (Object.prototype.hasOwnProperty.call(seeds, path.basename(f)) ? String(seeds[path.basename(f)]) : undefined) : null;
    return adoptRunImages(runDir, { seed: runSeedLabel(runDir), seedFor });
  }

  function findIndexEntry(runDir, name) {
    const wanted = String(name);
    const base = path.basename(wanted);
    return readRunIndex(runDir).find(e =>
      e.run_file === wanted || e.image_id === base || path.basename(String(e.run_file || '')) === base) || null;
  }

  // Run-relative image name -> canonical image record, if the image was adopted.
  function resolveRunImage(runDir, name) {
    const entry = findIndexEntry(runDir, name);
    if (!entry) return null;
    const img = resolveImage(entry.image_id);
    return img ? { ...img, url: imageUrl(img.id), runFile: entry.run_file } : null;
  }

  function listRunImageNames(runDir) {
    return readRunIndex(runDir).filter(e => resolveImage(e.image_id)).map(e => e.run_file);
  }

  return {
    root: rootDir,
    ensureRoot,
    resolveImage,
    imageUrl,
    adoptFile,
    publishFile,
    replacePublishedImage,
    inspectIntegrity,
    adoptRunImages,
    finalizeRun,
    readRunIndex,
    resolveRunImage,
    listRunImageNames,
    findRunImageFiles,
  };
}

module.exports = {
  CANONICAL_IMAGE_ROOT,
  RUN_IMAGE_INDEX,
  IMAGE_CONTENT_TYPES,
  createImageStore,
  hasImageSignature,
  isImageName,
};
