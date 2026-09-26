'use strict';

// Workstation logic for DexDiffusion that is independent of Express and of the
// generation backends, so it is unit-testable:
//
//   parseNumberedPrompts   numbered Batch prompt collection -> entries
//   planSeeds              quantity -> resolved per-image seeds
//   sanitizeRecipe         privacy-aware reusable generation settings
//   createImageMetaStore   lineage (parent/children) + Keepers keyed by canonical image id
//   createQueueRunner      backend-owned sequential Batch queue
//
// Nothing here stores image bytes; everything references canonical image ids
// from image-store.js.

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

// ---- Numbered prompt parser -------------------------------------------------
// A new entry starts ONLY on a line that begins "<integer>. <title>" and is at
// the start of the text or preceded by a blank line. Anything else, including
// numbers inside prose, is body text.
const HEADER_RE = /^[ \t]*(\d{1,6})\.[ \t]+(\S.*?)[ \t]*$/;
const BARE_NUMBER_RE = /^[ \t]*(\d{1,6})\.[ \t]*$/;

function parseNumberedPrompts(text) {
  const src = String(text == null ? '' : text).replace(/\r\n?/g, '\n');
  const lines = src.split('\n');
  const entries = [];
  const warnings = [];
  const errors = [];
  let current = null;
  let preamble = [];
  let prevBlank = true;

  const close = () => {
    if (!current) return;
    const body = current.body.join('\n').replace(/^\n+|\s+$/g, '');
    if (!body) errors.push(`Entry ${current.number} ("${current.title}") has no prompt text.`);
    entries.push({ index: entries.length, number: current.number, title: current.title, prompt: body, line: current.line });
    current = null;
  };

  lines.forEach((line, i) => {
    const blank = line.trim() === '';
    const m = prevBlank ? HEADER_RE.exec(line) : null;
    if (m) {
      close();
      current = { number: Number(m[1]), title: m[2], body: [], line: i + 1 };
    } else if (prevBlank && BARE_NUMBER_RE.test(line)) {
      errors.push(`Line ${i + 1}: "${line.trim()}" starts an entry but has no title.`);
      if (current) current.body.push(line);
    } else if (current) {
      current.body.push(line);
    } else if (!blank) {
      preamble.push(line);
    }
    prevBlank = blank;
  });
  close();

  if (preamble.length) {
    errors.push(`Text before the first numbered entry is not part of any prompt (starts: "${preamble[0].trim().slice(0, 60)}"). Number it or remove it.`);
  }
  if (!entries.length && !errors.length) errors.push('No numbered prompts found. Use "1. Title", a blank line, then the prompt.');

  const seen = new Map();
  entries.forEach((e, i) => {
    if (seen.has(e.number)) warnings.push(`Duplicate number ${e.number} (entries ${seen.get(e.number) + 1} and ${i + 1}); both kept.`);
    else seen.set(e.number, i);
    if (i > 0 && e.number !== entries[i - 1].number + 1 && e.number !== entries[i - 1].number) {
      warnings.push(`Numbering jumps from ${entries[i - 1].number} to ${e.number}; all entries kept.`);
    }
  });

  return { ok: errors.length === 0 && entries.length > 0, entries, warnings, errors };
}

// ---- Seeds -----------------------------------------------------------------
const MAX_SEED = 2147483647;

function randomSeed(rand = crypto.randomInt) {
  return rand(1, 2000000000);
}

function isFixedSeedValue(seed) {
  if (typeof seed === 'number') return Number.isInteger(seed) && seed >= 0;
  return typeof seed === 'string' && /^\d+$/.test(seed.trim());
}

// Fixed seed S -> S, S+1, ...; otherwise an independent random non-negative seed
// per image. `consecutive` (native sd-cli batches) uses a random base S..S+N-1.
function planSeeds(seed, quantity, { consecutive = false, rand } = {}) {
  const n = Math.max(1, Number(quantity) || 1);
  if (isFixedSeedValue(seed)) {
    const base = parseInt(seed, 10);
    if (base + n - 1 > MAX_SEED) throw new Error('seed + quantity exceeds the maximum seed');
    return Array.from({ length: n }, (_, i) => base + i);
  }
  if (consecutive) {
    const base = randomSeed(rand);
    return Array.from({ length: n }, (_, i) => base + i);
  }
  return Array.from({ length: n }, () => randomSeed(rand));
}

// Seed Lab neighbours: S-k .. S+k, never negative.
function neighborSeeds(seed, radius = 2) {
  const s = parseInt(seed, 10);
  if (!Number.isInteger(s) || s < 0) return [];
  const out = [];
  for (let d = -radius; d <= radius; d++) if (s + d >= 0 && s + d <= MAX_SEED) out.push(s + d);
  return out;
}

// ---- Recipes ---------------------------------------------------------------
// One implementation shared with the browser (client-helpers.js).
const { sanitizeRecipe, RECIPE_FIELDS } = require('./public/dexdiffusion/client-helpers.js');

// ---- Image metadata: lineage + keepers --------------------------------------
// One compact JSON document keyed by canonical image id. Never holds prompts or
// image bytes. Written atomically (tmp + rename).
const META_FIELDS = ['operation', 'parent', 'runId', 'target', 'seed', 'width', 'height', 'steps', 'cfg', 'scheduler', 'strength', 'queueId', 'batchNumber'];

function createImageMetaStore(file) {
  let cache = null;
  function read() {
    if (cache) return cache;
    try { cache = JSON.parse(fs.readFileSync(file, 'utf8')); } catch (_) { cache = null; }
    if (!cache || typeof cache.images !== 'object') cache = { schema: 'dexdiffusion.image_meta.v1', images: {} };
    return cache;
  }
  function write() {
    fs.mkdirSync(path.dirname(file), { recursive: true });
    const tmp = `${file}.${process.pid}.tmp`;
    fs.writeFileSync(tmp, JSON.stringify(cache, null, 1) + '\n');
    fs.renameSync(tmp, file);
  }
  function record(imageId, meta) {
    if (!imageId) return null;
    const data = read();
    const prev = data.images[imageId] || {};
    const next = { ...prev };
    for (const k of META_FIELDS) if (meta && meta[k] !== undefined && meta[k] !== null && meta[k] !== '') next[k] = meta[k];
    if (next.parent === imageId) delete next.parent;
    next.at = prev.at || new Date().toISOString();
    data.images[imageId] = next;
    write();
    return next;
  }
  function get(imageId) {
    return read().images[imageId] || null;
  }
  function children(imageId) {
    const imgs = read().images;
    return Object.keys(imgs).filter(id => imgs[id].parent === imageId).sort();
  }
  function ancestors(imageId, limit = 32) {
    const out = [];
    let cur = get(imageId);
    const seen = new Set([imageId]);
    while (cur && cur.parent && !seen.has(cur.parent) && out.length < limit) {
      out.push(cur.parent);
      seen.add(cur.parent);
      cur = get(cur.parent);
    }
    return out;
  }
  function setKeeper(imageId, keeper) {
    const data = read();
    const entry = { ...(data.images[imageId] || { at: new Date().toISOString() }) };
    if (keeper) entry.keeper = true; else delete entry.keeper;
    data.images[imageId] = entry;
    write();
    return !!entry.keeper;
  }
  function keepers() {
    const imgs = read().images;
    return Object.keys(imgs).filter(id => imgs[id].keeper).sort();
  }
  function all() { return read().images; }
  return { file, record, get, children, ancestors, setKeeper, keepers, all, _reset() { cache = null; } };
}

// ---- Queue runner ----------------------------------------------------------
// Items run strictly one after another. A failed item never stops the queue;
// completed items are never re-run. Prompts never appear in the queue view.
//
// Durability: with `file`, every change is written atomically (tmp + fsync +
// rename). Prompt text (and settings.private) is written ONLY for queues whose
// settings.save_prompts is true. On load, an item that was RUNNING when the
// console stopped becomes INTERRUPTED (retryable) — the remote process is not
// re-attached. A restored queue whose prompts were not persisted needs the same
// numbered text again before remaining items can run.
const ITEM_STATES = ['QUEUED', 'RUNNING', 'DONE', 'FAILED', 'SKIPPED', 'INTERRUPTED'];

function atomicWriteJson(file, data) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const tmp = `${file}.${process.pid}.${crypto.randomBytes(3).toString('hex')}.tmp`;
  const fd = fs.openSync(tmp, 'w', 0o600);
  try { fs.writeSync(fd, JSON.stringify(data, null, 1) + '\n'); fs.fsyncSync(fd); } finally { fs.closeSync(fd); }
  fs.renameSync(tmp, file);
}

function createQueueRunner({ runItem, onChange = () => {}, file = null }) {
  const queues = new Map();

  function view(q) {
    const counts = Object.fromEntries(ITEM_STATES.map(s => [s, 0]));
    for (const it of q.items) counts[it.status]++;
    const { private: _priv, ...settings } = q.settings || {};
    return {
      id: q.id, status: q.status, createdAt: q.createdAt, updatedAt: q.updatedAt || q.createdAt, settings,
      stopAfterCurrent: q.stopAfterCurrent, total: q.items.length, restored: !!q.restored,
      promptsMissing: q.items.some(it => ['QUEUED', 'INTERRUPTED', 'FAILED'].includes(it.status) && typeof it.prompt !== 'string'),
      complete: counts.DONE, failed: counts.FAILED, interrupted: counts.INTERRUPTED, queued: counts.QUEUED, counts,
      items: q.items.map(({ prompt: _p, ...it }) => it),
    };
  }

  function persist() {
    if (!file) return;
    const out = [...queues.values()].map(q => {
      const keep = !!(q.settings && q.settings.save_prompts);
      const settings = { ...q.settings };
      if (!keep) delete settings.private;
      return {
        id: q.id, status: q.status, createdAt: q.createdAt, updatedAt: Date.now(), settings, stopAfterCurrent: q.stopAfterCurrent,
        items: q.items.map(({ prompt, ...it }) => (keep && typeof prompt === 'string' ? { ...it, prompt } : it)),
      };
    });
    atomicWriteJson(file, { schema: 'dexdiffusion.queues.v1', queues: out });
  }
  function changed(q) { q.updatedAt = Date.now(); try { persist(); } catch (_) {} onChange(view(q)); }

  function load() {
    if (!file) return;
    let data;
    try { data = JSON.parse(fs.readFileSync(file, 'utf8')); } catch (_) { return; }
    for (const q of (data && data.queues) || []) {
      let interrupted = false;
      for (const it of q.items) {
        if (it.status === 'RUNNING') { it.status = 'INTERRUPTED'; it.error = 'console restarted while this item was running'; it.gate = 'server-restart'; interrupted = true; }
      }
      q.running = false;
      q.restored = true;
      if (q.status === 'RUNNING' || interrupted) q.status = q.items.some(x => x.status === 'QUEUED' || x.status === 'INTERRUPTED') ? 'STOPPED' : 'DONE';
      queues.set(q.id, q);
    }
    try { persist(); } catch (_) {}
  }

  function create({ entries, settings }) {
    const id = crypto.randomUUID();
    const q = {
      id, status: 'RUNNING', createdAt: Date.now(), settings: settings || {}, stopAfterCurrent: false, running: false,
      items: entries.map((e, i) => ({
        queueIndex: i, number: e.number, title: e.title, target: (settings && settings.target) || null,
        status: 'QUEUED', seeds: [], results: [], error: null, gate: null, jobId: null, attempts: 0, prompt: e.prompt,
      })),
    };
    queues.set(id, q);
    changed(q);
    pump(q);
    return view(q);
  }

  async function pump(q) {
    if (q.running) return;
    q.running = true;
    try {
      for (;;) {
        if (q.stopAfterCurrent) { q.status = 'STOPPED'; break; }
        const it = q.items.find(x => x.status === 'QUEUED' && typeof x.prompt === 'string');
        if (!it) { q.status = q.items.some(x => x.status === 'QUEUED') ? 'STOPPED' : 'DONE'; break; }
        it.status = 'RUNNING';
        it.attempts++;
        it.startedAt = Date.now();
        changed(q);
        let r;
        try { r = await runItem(it, it.prompt, q.settings, q); } catch (err) { r = { ok: false, error: err.message, gate: 'exception' }; }
        r = r || {};
        it.jobId = r.jobId || it.jobId;
        it.seeds = r.seeds || it.seeds;
        it.finishedAt = Date.now();
        if (r.ok) { it.status = 'DONE'; it.results = r.results || []; it.error = null; it.gate = null; }
        else { it.status = 'FAILED'; it.error = r.error || 'failed'; it.gate = r.gate || null; }
        changed(q);
      }
    } finally {
      q.running = false;
      changed(q);
    }
  }

  function get(id) { const q = queues.get(id); return q ? view(q) : null; }
  function list() { return [...queues.values()].map(view); }
  function stopAfterCurrent(id) {
    const q = queues.get(id); if (!q) return null;
    q.stopAfterCurrent = true;
    if (!q.running && q.status === 'RUNNING') q.status = 'STOPPED';
    changed(q);
    return view(q);
  }
  // prompts: optional [{ queueIndex, prompt }] to re-supply text for a restored queue.
  function resume(id, prompts) {
    const q = queues.get(id); if (!q) return null;
    for (const p of prompts || []) {
      const it = q.items.find(x => x.queueIndex === p.queueIndex);
      if (it && typeof p.prompt === 'string') it.prompt = p.prompt;
    }
    const pending = q.items.filter(x => x.status === 'QUEUED');
    if (pending.some(x => typeof x.prompt !== 'string')) return { error: 'Prompt text for this restored queue was not saved (prompt saving is off). Paste the same numbered batch to resume.', promptsMissing: true };
    q.stopAfterCurrent = false;
    if (pending.length) { q.status = 'RUNNING'; pump(q); }
    changed(q);
    return view(q);
  }
  function retryFailed(id, prompts) {
    const q = queues.get(id); if (!q) return null;
    for (const it of q.items) if (it.status === 'FAILED' || it.status === 'INTERRUPTED') { it.status = 'QUEUED'; it.error = null; it.gate = null; }
    return resume(id, prompts);
  }
  function removeItem(id, queueIndex) {
    const q = queues.get(id); if (!q) return null;
    const it = q.items.find(x => x.queueIndex === queueIndex);
    if (!it || it.status !== 'QUEUED') return { error: 'Only QUEUED items can be removed.' };
    it.status = 'SKIPPED';
    changed(q);
    return view(q);
  }
  // Move a QUEUED item past the neighbouring QUEUED item.
  function moveItem(id, queueIndex, direction) {
    const q = queues.get(id); if (!q) return null;
    const i = q.items.findIndex(x => x.queueIndex === queueIndex);
    if (i < 0 || q.items[i].status !== 'QUEUED') return { error: 'Only QUEUED items can be reordered.' };
    const step = direction === 'up' ? -1 : 1;
    let j = i + step;
    while (j >= 0 && j < q.items.length && q.items[j].status !== 'QUEUED') j += step;
    if (j < 0 || j >= q.items.length) return view(q);
    [q.items[i], q.items[j]] = [q.items[j], q.items[i]];
    changed(q);
    return view(q);
  }
  load();
  return { create, get, list, stopAfterCurrent, resume, retryFailed, removeItem, moveItem, _queues: queues };
}

module.exports = {
  parseNumberedPrompts, planSeeds, neighborSeeds, isFixedSeedValue, MAX_SEED,
  sanitizeRecipe, RECIPE_FIELDS, createImageMetaStore, createQueueRunner, ITEM_STATES,
};
