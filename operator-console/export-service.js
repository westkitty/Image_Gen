'use strict';

// Export service (A1111 parity MT-07 sidecar .txt, MT-13 save-all ZIP, MT-14 filename patterns,
// MT-15 PNG/JPEG/WebP, MT-16 quality + metadata control).
//
// HARD INVARIANTS
//  - Canonical originals are never modified, moved or re-encoded in place. The source is only ever opened read-only
//    (by bin/encode-image.py, which writes to stdout); every export is a new Buffer.
//  - Prompt privacy: a prompt / negative prompt reaches an export (filename, sidecar, embedded metadata, ZIP entry
//    name, ZIP comment) only when BOTH the caller allows it (opts.savePrompts !== false) AND the record says it was
//    saved (meta.prompt_saved !== false and meta.prompt is a non-empty string). Otherwise prompt tokens resolve to ''
//    (empty string, documented below) and infotext / sidecars carry settings only.
//  - Filenames are sanitized: no path separators, no control chars, no '..', no leading dots, bounded length.
//
// Record shape (matches imageView() in server.js):
//   { id, path, width, height, meta: { prompt, negative_prompt, prompt_saved, steps, cfg, seed, sampler, scheduler,
//     target, clip_skip, model_hash, job_timestamp, hires, ... } }

const fs = require('node:fs');
const path = require('node:path');
const zlib = require('node:zlib');
const { execFile } = require('node:child_process');
const { crc32 } = require('./png-text');
const Infotext = require('./public/dexdiffusion/infotext.js');

const ENCODER = path.join(__dirname, 'bin', 'encode-image.py');
const FORMATS = { png: { ext: '.png', type: 'image/png' }, jpeg: { ext: '.jpg', type: 'image/jpeg' }, webp: { ext: '.webp', type: 'image/webp' } };
const LIMITS = { maxImages: 200, maxTotalBytes: 512 * 1024 * 1024, maxFilenameBytes: 120, encodeTimeoutMs: 60000, maxPatternLength: 256 };
const DEFAULT_PATTERN = '[basename]';
const ZIP_COMMENT = 'DexDiffusion export';

// ---- filenames (MT-14) ---------------------------------------------------------------------------------------------
function truncateBytes(s, max) {
  if (Buffer.byteLength(s) <= max) return s;
  let out = '';
  for (const ch of s) { if (Buffer.byteLength(out + ch) > max) break; out += ch; }
  return out;
}

// One path component, safe on macOS / Windows / Linux and inside a ZIP. Never returns '' (caller supplies fallback).
function sanitizeFilename(name, fallback = 'image') {
  let s = String(name == null ? '' : name).normalize('NFC')
    .replace(/[\u0000-\u001f\u007f-\u009f\u2028\u2029\u202a-\u202e\u2066-\u2069]/g, "")   // control + bidi override chars
    .replace(/[\/\\:*?"<>|]/g, '-')
    .replace(/\.{2,}/g, '.')
    .replace(/\s+/g, ' ')
    .replace(/^[.\s-]+/, '').replace(/[.\s]+$/, '');
  s = truncateBytes(s, LIMITS.maxFilenameBytes).replace(/[.\s]+$/, '');
  if (/^(con|prn|aux|nul|com\d|lpt\d)$/i.test(s)) s = '_' + s;
  return s || fallback;
}

// A1111 sanitize_filename_part: spaces -> '_' (optional), strip invalid characters, bound at 128.
function filenamePart(value, replaceSpaces = true) {
  let s = String(value == null ? '' : value);
  if (replaceSpaces) s = s.replace(/\s/g, '_');
  s = s.replace(/[\u0000-\u001f\u007f]/g, ' ').replace(/[\/\\:*?"<>|]/g, '').replace(/\.{2,}/g, '.');
  return s.slice(0, 128).replace(/^[.\s]+|[.\s]+$/g, '');
}

function pad(n, w = 2) { return String(n).padStart(w, '0'); }
const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
const DAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
// strftime subset (local time) used by [datetime<fmt>]; unknown directives are dropped.
function strftime(fmt, d) {
  return String(fmt).replace(/%([A-Za-z%])/g, (_, c) => {
    switch (c) {
      case 'Y': return String(d.getFullYear());
      case 'y': return pad(d.getFullYear() % 100);
      case 'm': return pad(d.getMonth() + 1);
      case 'd': return pad(d.getDate());
      case 'H': return pad(d.getHours());
      case 'M': return pad(d.getMinutes());
      case 'S': return pad(d.getSeconds());
      case 'f': return pad(d.getMilliseconds(), 3) + '000';
      case 'j': return pad(Math.floor((d - new Date(d.getFullYear(), 0, 0)) / 86400000), 3);
      case 'b': return MONTHS[d.getMonth()].slice(0, 3);
      case 'B': return MONTHS[d.getMonth()];
      case 'a': return DAYS[d.getDay()].slice(0, 3);
      case 'A': return DAYS[d.getDay()];
      case '%': return '%';
      default: return '';
    }
  });
}

// Whether prompt text may appear in any output for this record.
function promptsAllowed(record, opts) {
  if (opts && opts.savePrompts === false) return false;
  const m = (record && record.meta) || {};
  if (m.prompt_saved === false || m.save_prompts === false) return false;
  return typeof m.prompt === 'string' && m.prompt.length > 0;
}

function baseId(record) { return String((record && record.id) || 'img').replace(/\.[A-Za-z0-9]+$/, ''); }

function promptWords(prompt, max = 8) {
  const words = String(prompt || '').split(/[^\p{L}\p{N}']+/u).filter(Boolean);
  return filenamePart((words.length ? words.slice(0, max) : ['empty']).join(' '), false);
}

// Tokens (A1111 FilenameGenerator subset). Unknown tokens resolve to ''.
//   [basename] source image id without extension   [seed] [steps] [cfg] [width] [height] [sampler] [scheduler]
//   [sampler_scheduler] [clip_skip] [model_name] [model_hash] [date] [datetime] [datetime<fmt>] [job_timestamp]
//   [index] 1-based position in this export       [none] empty (lets a pattern be just the sequence suffix)
//   PROMPT TOKENS: [prompt] [prompt_spaces] [prompt_words] [prompt_hash] resolve to '' when prompts are not saved
//   or not allowed (never a placeholder, so nothing derived from prompt text, not even a hash, can leak).
//   [negative_prompt_hash] likewise. If the whole name ends up empty the image id is used.
function formatFilename(pattern, record, options = {}) {
  const o = options, m = (record && record.meta) || {};
  const allowed = promptsAllowed(record, { savePrompts: o.savePrompts });
  const now = o.now instanceof Date ? o.now : new Date();
  const pat = String(pattern == null || pattern === '' ? DEFAULT_PATTERN : pattern).slice(0, LIMITS.maxPatternLength);
  const modelName = o.modelName || m.model_name || m.target || '';
  const simple = {
    basename: () => baseId(record), seed: () => m.seed, steps: () => m.steps, cfg: () => m.cfg,
    width: () => record.width, height: () => record.height,
    sampler: () => filenamePart(m.sampler || '', false), scheduler: () => filenamePart(m.scheduler || '', false),
    sampler_scheduler: () => filenamePart([m.sampler, m.scheduler].filter(Boolean).join(' '), false),
    clip_skip: () => m.clip_skip, model_name: () => filenamePart(modelName, false), model_hash: () => m.model_hash,
    date: () => strftime('%Y-%m-%d', now), job_timestamp: () => m.job_timestamp || strftime('%Y%m%d%H%M%S', now),
    index: () => o.index, none: () => '',
  };
  const promptish = {
    prompt: () => filenamePart(m.prompt), prompt_spaces: () => filenamePart(m.prompt, false), prompt_words: () => promptWords(m.prompt),
    prompt_hash: () => hashPart(m.prompt, 8), negative_prompt_hash: () => hashPart(m.negative_prompt, 8),
  };
  const out = pat.replace(/\[([A-Za-z_]+)((?:<[^<>]*>)*)\]/g, (whole, name, args) => {
    const key = name.toLowerCase();
    const argv = [...args.matchAll(/<([^<>]*)>/g)].map(x => x[1]);
    let v;
    if (key === 'datetime') v = strftime(argv[0] || '%Y%m%d%H%M%S', now);
    else if (key in promptish) v = allowed ? promptish[key]() : '';
    else if (key in simple) v = simple[key]();
    else v = '';
    return v == null ? '' : String(v);
  });
  return sanitizeFilename(out, sanitizeFilename(baseId(record)));
}
function hashPart(text, len) {
  if (!text) return '';
  return require('node:crypto').createHash('sha256').update(String(text)).digest('hex').slice(0, len);
}

// ---- infotext / sidecar (MT-07) ------------------------------------------------------------------------------------
function infotextFor(record, options = {}) {
  const m = (record && record.meta) || {};
  const allowed = promptsAllowed(record, options);
  const meta = { ...m, width: record.width, height: record.height };
  return Infotext.formatInfotext(meta, {
    prompt: allowed ? m.prompt : '', negative: allowed ? (m.negative_prompt || '') : '',
    modelName: options.modelName || m.model_name || m.target || '',
  });
}
// A1111 "save text information about generation parameters as chunk/txt": the same infotext, as UTF-8 text.
function sidecarText(record, options = {}) { return infotextFor(record, options) + '\n'; }

// ---- image encoding (MT-15 / MT-16) --------------------------------------------------------------------------------
function normalizeEncodeOpts(o = {}) {
  const format = String(o.format || 'png').toLowerCase().replace('jpg', 'jpeg');
  if (!FORMATS[format]) throw new Error('Unsupported format: ' + o.format);
  let quality = o.quality == null || o.quality === '' ? 90 : Number(o.quality);
  if (!Number.isFinite(quality)) throw new Error('Invalid quality');
  quality = Math.max(1, Math.min(100, Math.round(quality)));
  const metadata = o.metadata === 'infotext' ? 'infotext' : 'none';
  return { format, quality, lossless: !!o.lossless, metadata, infotext: o.infotext };
}

// Resolves to a Buffer. opts.infotext (string) is embedded only when metadata === 'infotext'.
// The source is read by a child process that writes to stdout; there is no output path, so nothing can be overwritten.
async function encodeImage(srcPath, options = {}) {
  const o = normalizeEncodeOpts(options);
  if (typeof srcPath !== 'string' || !srcPath) throw new Error("srcPath required");
  const args = [ENCODER, '--src', srcPath, '--format', o.format, '--quality', String(o.quality)];
  if (o.lossless) args.push('--lossless');
  const embed = o.metadata === 'infotext' && typeof o.infotext === 'string' && o.infotext.length > 0;
  if (embed) args.push('--infotext-stdin');
  return new Promise((resolve, reject) => {
    const child = execFile('python3', args, { encoding: 'buffer', maxBuffer: 256 * 1024 * 1024, timeout: LIMITS.encodeTimeoutMs, windowsHide: true },
      (err, stdout, stderr) => {
        if (err) return reject(new Error('Image encode failed: ' + (stderr && stderr.length ? stderr.toString('utf8').trim().slice(0, 300) : err.message)));
        resolve(stdout);
      });
    if (embed) child.stdin.end(o.infotext, 'utf8'); else child.stdin.end();
  });
}

// ---- ZIP (MT-13) ---------------------------------------------------------------------------------------------------
function dosDateTime(d) {
  const y = Math.max(1980, d.getFullYear());
  return { time: (d.getHours() << 11) | (d.getMinutes() << 5) | (d.getSeconds() >> 1), date: ((y - 1980) << 9) | ((d.getMonth() + 1) << 5) | d.getDate() };
}
function zipEntryName(name) {
  const s = String(name);
  if (!s || /[\u0000-\u001f\u007f\\]/.test(s) || s.startsWith('/') || s.split('/').some(p => p === '..' || p === '.' || p === '')) throw new Error('Unsafe ZIP entry name: ' + JSON.stringify(s).slice(0, 80));
  if (Buffer.byteLength(s) > 255) throw new Error('ZIP entry name too long');
  return s;
}
// entries: [{ name, data: Buffer|string, store?: boolean, mtime?: Date }]; options: { comment, now }. Returns a Buffer.
function buildZip(entries, options = {}) {
  if (!Array.isArray(entries)) throw new Error('entries must be an array');
  if (entries.length > 65535) throw new Error('Too many ZIP entries');
  const seen = new Set(), locals = [], centrals = [];
  let offset = 0;
  for (const e of entries) {
    const name = zipEntryName(e.name);
    if (seen.has(name.toLowerCase())) throw new Error('Duplicate ZIP entry: ' + name);
    seen.add(name.toLowerCase());
    const raw = Buffer.isBuffer(e.data) ? e.data : Buffer.from(String(e.data == null ? '' : e.data), 'utf8');
    const deflated = e.store || raw.length < 64 ? null : zlib.deflateRawSync(raw, { level: 6 });
    const useDeflate = deflated && deflated.length < raw.length;
    const body = useDeflate ? deflated : raw, method = useDeflate ? 8 : 0;
    const { time, date } = dosDateTime(e.mtime instanceof Date ? e.mtime : (options.now instanceof Date ? options.now : new Date()));
    const nameBuf = Buffer.from(name, 'utf8'), crc = crc32(raw);
    if (raw.length > 0xfffffffe || offset > 0xfffffffe) throw new Error('ZIP64 is not supported');
    const lh = Buffer.alloc(30);
    lh.writeUInt32LE(0x04034b50, 0); lh.writeUInt16LE(20, 4); lh.writeUInt16LE(0x0800, 6); lh.writeUInt16LE(method, 8);
    lh.writeUInt16LE(time, 10); lh.writeUInt16LE(date, 12); lh.writeUInt32LE(crc, 14); lh.writeUInt32LE(body.length, 18);
    lh.writeUInt32LE(raw.length, 22); lh.writeUInt16LE(nameBuf.length, 26); lh.writeUInt16LE(0, 28);
    locals.push(lh, nameBuf, body);
    const ch = Buffer.alloc(46);
    ch.writeUInt32LE(0x02014b50, 0); ch.writeUInt16LE(20, 4); ch.writeUInt16LE(20, 6); ch.writeUInt16LE(0x0800, 8); ch.writeUInt16LE(method, 10);
    ch.writeUInt16LE(time, 12); ch.writeUInt16LE(date, 14); ch.writeUInt32LE(crc, 16); ch.writeUInt32LE(body.length, 20);
    ch.writeUInt32LE(raw.length, 24); ch.writeUInt16LE(nameBuf.length, 28);
    ch.writeUInt32LE(((0o100644 << 16) >>> 0), 38);   // extra/comment/disk/internal attrs stay zero (Buffer.alloc)
    ch.writeUInt16LE(0x031e, 4);                        // version made by: Unix, 3.0 (so the mode bits are honoured)
 ch.writeUInt32LE(offset, 42);
    centrals.push(ch, nameBuf);
    offset += 30 + nameBuf.length + body.length;
  }
  const cdBuf = Buffer.concat(centrals);
  const comment = Buffer.from(options.comment == null ? ZIP_COMMENT : String(options.comment), 'utf8').subarray(0, 65535);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0); end.writeUInt16LE(entries.length, 8); end.writeUInt16LE(entries.length, 10);
  end.writeUInt32LE(cdBuf.length, 12); end.writeUInt32LE(offset, 16); end.writeUInt16LE(comment.length, 20);
  return Buffer.concat([...locals, cdBuf, end, comment]);
}

// ---- top level -----------------------------------------------------------------------------------------------------
// records: [{id, path, width, height, meta}] (already resolved through the image store by the caller).
// opts: { format, quality, lossless, metadata:'none'|'infotext' (default 'infotext'), pattern, sidecar:boolean,
//         zip:boolean, savePrompts:boolean (false forces privacy), modelName:(record)=>string, now:Date,
//         zipName:string }
// -> { filename, buffer, contentType, count, promptsIncluded }
async function exportImages(records, options = {}) {
  if (!Array.isArray(records) || records.length === 0) throw new Error('No images to export');
  if (records.length > LIMITS.maxImages) throw new Error(`At most ${LIMITS.maxImages} images per export`);
  const enc = normalizeEncodeOpts(options);
  const fmt = FORMATS[enc.format];
  const metadata = options.metadata === 'none' ? 'none' : 'infotext';
  const now = options.now instanceof Date ? options.now : new Date();
  const wantZip = !!options.zip || records.length > 1 || !!options.sidecar;
  const used = new Set(), entries = [];
  let total = 0, promptsIncluded = false;
  for (let i = 0; i < records.length; i++) {
    const r = records[i];
    if (!r || typeof r.path !== 'string') throw new Error('Record has no file path');
    const o = { savePrompts: options.savePrompts, now, index: i + 1, modelName: typeof options.modelName === 'function' ? options.modelName(r) : undefined };
    const allowed = promptsAllowed(r, o);
    if (allowed) promptsIncluded = true;
    const stem = formatFilename(options.pattern, r, o);
    let name = stem + fmt.ext;
    for (let n = 2; used.has(name.toLowerCase()); n++) name = truncateBytes(stem, LIMITS.maxFilenameBytes - 6) + '-' + n + fmt.ext;
    used.add(name.toLowerCase());
    const info = infotextFor(r, o);
    const buffer = await encodeImage(r.path, { ...enc, metadata, infotext: info });
    total += buffer.length;
    if (total > LIMITS.maxTotalBytes) throw new Error('Export is larger than the size limit');
    entries.push({ name, data: buffer, store: true });
    if (options.sidecar) {
      const txt = name.slice(0, -fmt.ext.length) + '.txt';
      used.add(txt.toLowerCase());
      entries.push({ name: txt, data: sidecarText(r, o) });
    }
  }
  if (!wantZip) return { filename: entries[0].name, buffer: entries[0].data, contentType: fmt.type, count: 1, promptsIncluded };
  const zipName = sanitizeFilename(options.zipName || 'dexdiffusion-export-' + strftime('%Y%m%d-%H%M%S', now), 'export').replace(/\.zip$/i, '') + '.zip';
  return { filename: zipName, buffer: buildZip(entries, { now }), contentType: 'application/zip', count: records.length, promptsIncluded };
}

module.exports = { formatFilename, sanitizeFilename, encodeImage, sidecarText, infotextFor, buildZip, exportImages, promptsAllowed, strftime, LIMITS, FORMATS };
