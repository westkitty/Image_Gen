'use strict';

// Canonical image authority for DexDiffusion.
//
// Every final generated image lives exactly once under CANONICAL_IMAGE_ROOT.
// Run directories keep metadata only; `canonical-images.json` in a run dir maps
// the run-relative name a backend originally produced to the canonical file.

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

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

function createImageStore({ root = CANONICAL_IMAGE_ROOT } = {}) {
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
    if (!st.isFile()) return null;
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

  // Move `src` into the root atomically without ever overwriting an existing
  // image: stage as .incoming-*, then hard-link to a free final name.
  function adoptFile(src, { runId, seed, runFile }) {
    ensureRoot();
    const ext = path.extname(src).toLowerCase();
    const incoming = path.join(rootDir, `.incoming-${safeComponent(runId, 'run')}-${crypto.randomBytes(4).toString('hex')}${ext}`);
    try {
      fs.renameSync(src, incoming);
    } catch (err) {
      if (err.code !== 'EXDEV') throw err;
      fs.copyFileSync(src, incoming, fs.constants.COPYFILE_EXCL);
      fs.unlinkSync(src);
    }
    try {
      const base = canonicalBaseName({ runId, seed, runFile });
      for (let i = 1; i < 1000; i++) {
        const id = `${base}${i > 1 ? '-' + i : ''}${ext}`;
        try {
          fs.linkSync(incoming, path.join(rootDir, id));
          return { run_file: runFile, image_id: id, image_path: path.join(rootDir, id), image_url: imageUrl(id) };
        } catch (err) {
          if (err.code !== 'EEXIST') throw err;
        }
      }
      throw new Error('no free canonical filename for ' + base);
    } finally {
      try { fs.unlinkSync(incoming); } catch (_) {}
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
    const file = path.join(runDir, RUN_IMAGE_INDEX);
    const tmp = file + '.tmp';
    fs.writeFileSync(tmp, JSON.stringify({ schema: 'dexdiffusion.canonical_images.v1', root: rootDir, images }, null, 2) + '\n');
    fs.renameSync(tmp, file);
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
    const images = readRunIndex(runDir);
    const adopted = [];
    for (const file of findRunImageFiles(runDir)) {
      if (!hasImageSignature(file)) continue;
      const runFile = path.relative(runDir, file);
      const fileSeed = seedFor ? seedFor(runFile) : undefined;
      const entry = adoptFile(file, { runId, seed: fileSeed !== undefined ? fileSeed : seed, runFile });
      if (fileSeed !== undefined) entry.seed = fileSeed;
      images.push(entry);
      adopted.push(entry);
    }
    if (adopted.length) writeRunIndex(runDir, images);
    return adopted;
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
