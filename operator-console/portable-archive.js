'use strict';

// Minimal, dependency-free ZIP reader/writer for DexDiffusion's portable packages (voice banks, project packages).
//
// Writer: streams file entries from disk with bounded memory (data descriptors), UTF-8 names, stored or deflated.
// Reader: random-access via file descriptor, never extracts implicitly, and treats every archive as hostile:
//   unsafe/duplicate names, encryption, symlinks, ZIP64, unknown methods, entry-count/size/ratio limits,
//   declared-vs-actual size and CRC-32 verification.
// 4 GiB per archive/entry is the classic-ZIP ceiling; larger exports must be split (the error says so).

const fs = require('fs');
const zlib = require('zlib');
const crypto = require('crypto');
const { Transform, Writable } = require('stream');
const { pipeline } = require('stream/promises');

const SIG_LFH = 0x04034b50, SIG_CEN = 0x02014b50, SIG_EOCD = 0x06054b50, SIG_DD = 0x08074b50, SIG_Z64 = 0x07064b50;
const U32 = 0xffffffff;
const DEFAULT_LIMITS = { maxEntries: 4000, maxTotalBytes: 8 * 1024 ** 3, maxEntryBytes: 4 * 1024 ** 3 - 1, maxRatio: 200 };
const fail = m => Object.assign(new Error(m), { gate: 'archive-invalid', status: 400 });

function safeNameProblem(name) {
  if (typeof name !== 'string' || !name) return 'empty name';
  if (name.length > 240) return 'name too long';
  if (/[\u0000-\u001f\u007f\\]/.test(name)) return 'control character or backslash';
  if (name.startsWith('/') || /^[A-Za-z]:/.test(name)) return 'absolute path';
  const parts = name.replace(/\/$/, '').split('/');
  if (parts.some(p => p === '' || p === '.' || p === '..')) return 'relative path segment';
  return null;
}
const assertSafeName = name => { const p = safeNameProblem(name); if (p) throw fail(`unsafe archive entry name ${JSON.stringify(String(name).slice(0, 60))}: ${p}`); };
const dedupKey = n => n.normalize('NFC').toLowerCase();

function dosDateTime(d) {
  const y = Math.max(1980, d.getFullYear());
  return { date: ((y - 1980) << 9) | ((d.getMonth() + 1) << 5) | d.getDate(), time: (d.getHours() << 11) | (d.getMinutes() << 5) | (d.getSeconds() >> 1) };
}

// ── writer ──────────────────────────────────────────────────────────────────────
async function writeZip(outPath, entries, { now = new Date() } = {}) {
  for (const e of entries) assertSafeName(e.name);
  const seen = new Set(); for (const e of entries) { const k = dedupKey(e.name); if (seen.has(k)) throw fail('duplicate entry name ' + e.name); seen.add(k); }
  const fd = fs.openSync(outPath, 'w', 0o600), { date, time } = dosDateTime(now);
  let pos = 0; const central = [], report = [];
  const write = buf => { let o = 0; while (o < buf.length) o += fs.writeSync(fd, buf, o, buf.length - o); pos += buf.length; };
  try {
    for (const e of entries) {
      const name = Buffer.from(e.name, 'utf8'), offset = pos;
      if (pos > U32) throw fail('archive exceeds the 4 GiB ZIP limit; export fewer items');
      const lfh = Buffer.alloc(30); lfh.writeUInt32LE(SIG_LFH, 0); lfh.writeUInt16LE(20, 4); lfh.writeUInt16LE(0x0808, 6);
      const wantStore = e.store === true || (e.data && e.data.length === 0);
      lfh.writeUInt16LE(wantStore ? 0 : 8, 8); lfh.writeUInt16LE(time, 10); lfh.writeUInt16LE(date, 12); lfh.writeUInt16LE(name.length, 26);
      write(lfh); write(name);
      let crc = 0, usize = 0, csize = 0;
      if (e.data) {
        const data = Buffer.from(e.data); crc = zlib.crc32(data); usize = data.length;
        const body = wantStore ? data : zlib.deflateRawSync(data, { level: 6 }); csize = body.length; write(body);
      } else if (e.file) {
        const tap = new Transform({ transform(chunk, _enc, cb) { crc = zlib.crc32(chunk, crc); usize += chunk.length; if (usize > U32) return cb(fail('entry exceeds the 4 GiB ZIP limit')); cb(null, chunk); } });
        const sink = new Writable({ write(chunk, _enc, cb) { try { write(chunk); csize += chunk.length; cb(); } catch (err) { cb(err); } } });
        await pipeline(...[fs.createReadStream(e.file), tap, ...(wantStore ? [] : [zlib.createDeflateRaw({ level: 6 })]), sink]);
      } else throw fail('entry needs data or file');
      if (csize > U32 || usize > U32) throw fail('entry exceeds the 4 GiB ZIP limit');
      const dd = Buffer.alloc(16); dd.writeUInt32LE(SIG_DD, 0); dd.writeUInt32LE(crc >>> 0, 4); dd.writeUInt32LE(csize, 8); dd.writeUInt32LE(usize, 12); write(dd);
      central.push({ name, offset, crc: crc >>> 0, csize, usize, method: wantStore ? 0 : 8 });
      report.push({ name: e.name, size: usize, compressed: csize, crc32: (crc >>> 0).toString(16).padStart(8, '0'), method: wantStore ? 0 : 8 });
    }
    const cdStart = pos;
    for (const c of central) {
      const h = Buffer.alloc(46); h.writeUInt32LE(SIG_CEN, 0); h.writeUInt16LE((3 << 8) | 20, 4); h.writeUInt16LE(20, 6); h.writeUInt16LE(0x0808, 8); h.writeUInt16LE(c.method, 10);
      h.writeUInt16LE(time, 12); h.writeUInt16LE(date, 14); h.writeUInt32LE(c.crc, 16); h.writeUInt32LE(c.csize, 20); h.writeUInt32LE(c.usize, 24); h.writeUInt16LE(c.name.length, 28);
      h.writeUInt32LE((0o100644 << 16) >>> 0, 38); h.writeUInt32LE(c.offset, 42); write(h); write(c.name);
    }
    const cdSize = pos - cdStart;
    if (central.length > 0xffff || pos > U32) throw fail('archive exceeds classic ZIP limits; export fewer items');
    const eocd = Buffer.alloc(22); eocd.writeUInt32LE(SIG_EOCD, 0); eocd.writeUInt16LE(central.length, 8); eocd.writeUInt16LE(central.length, 10); eocd.writeUInt32LE(cdSize, 12); eocd.writeUInt32LE(cdStart, 16); write(eocd);
    fs.fsyncSync(fd);
  } catch (e) { try { fs.closeSync(fd); fs.unlinkSync(outPath); } catch (_) {} throw e; }
  fs.closeSync(fd);
  return { bytes: pos, entries: report };
}

// ── reader ──────────────────────────────────────────────────────────────────────
function openZip(file, limits = {}) {
  const L = Object.assign({}, DEFAULT_LIMITS, limits);
  const fd = fs.openSync(file, 'r'); let closed = false;
  const close = () => { if (!closed) { closed = true; try { fs.closeSync(fd); } catch (_) {} } };
  try {
    const size = fs.fstatSync(fd).size;
    if (size < 22) throw fail('not a valid zip file (end of central directory not found)');
    const tailLen = Math.min(size, 22 + 65535), tail = Buffer.alloc(tailLen); fs.readSync(fd, tail, 0, tailLen, size - tailLen);
    let at = -1; for (let i = tailLen - 22; i >= 0; i--) if (tail.readUInt32LE(i) === SIG_EOCD) { at = i; break; }
    if (at < 0) throw fail('not a valid zip file (end of central directory not found)');
    if (at >= 20 && tail.readUInt32LE(at - 20) === SIG_Z64) throw fail('ZIP64 archives are not supported');
    const count = tail.readUInt16LE(at + 10), cdSize = tail.readUInt32LE(at + 12), cdOff = tail.readUInt32LE(at + 16);
    if (count === 0xffff || cdSize === U32 || cdOff === U32) throw fail('ZIP64 archives are not supported');
    if (count > L.maxEntries) throw fail(`too many entries (${count} > ${L.maxEntries})`);
    if (cdOff + cdSize > size) throw fail('not a valid zip file (central directory out of range)');
    const cd = Buffer.alloc(cdSize); fs.readSync(fd, cd, 0, cdSize, cdOff);
    const entries = [], seen = new Set(); let p = 0, total = 0;
    for (let i = 0; i < count; i++) {
      if (p + 46 > cd.length || cd.readUInt32LE(p) !== SIG_CEN) throw fail('not a valid zip file (bad central directory entry)');
      const host = cd.readUInt16LE(p + 4) >> 8, flags = cd.readUInt16LE(p + 8), method = cd.readUInt16LE(p + 10), crc = cd.readUInt32LE(p + 16);
      const csize = cd.readUInt32LE(p + 20), usize = cd.readUInt32LE(p + 24), nl = cd.readUInt16LE(p + 28), el = cd.readUInt16LE(p + 30), cl = cd.readUInt16LE(p + 32);
      const ext = cd.readUInt32LE(p + 38), off = cd.readUInt32LE(p + 42);
      if (p + 46 + nl + el + cl > cd.length) throw fail('not a valid zip file (central directory entry overruns)');
      const name = cd.toString('utf8', p + 46, p + 46 + nl); p += 46 + nl + el + cl;
      assertSafeName(name);
      if (flags & 0x41) throw fail('encrypted entries are not supported');
      if (method !== 0 && method !== 8) throw fail(`unsupported compression method ${method}`);
      if (host === 3 && ((ext >>> 16) & 0xf000) === 0xa000) throw fail('symbolic links are not allowed in packages');
      if (csize === U32 || usize === U32) throw fail('ZIP64 archives are not supported');
      const k = dedupKey(name); if (seen.has(k)) throw fail('duplicate entry name ' + name); seen.add(k);
      if (usize > L.maxEntryBytes) throw fail(`entry ${name} is too large (${usize} bytes)`);
      if (usize > (1 << 20) && usize / Math.max(1, csize) > L.maxRatio) throw fail(`entry ${name} has a suspicious compression ratio (possible zip bomb)`);
      total += usize; if (total > L.maxTotalBytes) throw fail(`archive total size is too large (${total} bytes)`);
      if (off + 30 > size) throw fail('not a valid zip file (entry offset out of range)');
      entries.push({ name, dir: name.endsWith('/'), method, crc, csize, usize, offset: off });
    }
    const byName = new Map(entries.map(e => [e.name, e]));
    const dataStart = e => {
      const h = Buffer.alloc(30); fs.readSync(fd, h, 0, 30, e.offset);
      if (h.readUInt32LE(0) !== SIG_LFH) throw fail('not a valid zip file (bad local header)');
      const start = e.offset + 30 + h.readUInt16LE(26) + h.readUInt16LE(28);
      if (start + e.csize > size) throw fail('not a valid zip file (entry data out of range)');
      return start;
    };
    const need = name => { const e = byName.get(name); if (!e || e.dir) throw fail(`${name} is not in archive`); return e; };
    return {
      entries, total_bytes: total, close,
      has: name => byName.has(name),
      read(name) {
        const e = need(name), start = dataStart(e), raw = Buffer.alloc(e.csize); fs.readSync(fd, raw, 0, e.csize, start);
        let out;
        try { out = e.method === 0 ? raw : zlib.inflateRawSync(raw, { maxOutputLength: e.usize + 1 }); } catch (err) { throw fail(`${name}: size mismatch while decompressing (${err.code || err.message})`); }
        if (out.length !== e.usize) throw fail(`${name}: size mismatch (declared ${e.usize}, actual ${out.length})`);
        if ((zlib.crc32(out) >>> 0) !== e.crc) throw fail(`${name}: CRC mismatch`);
        return out;
      },
      async extractTo(name, dest) {
        const e = need(name), start = dataStart(e); let crc = 0, n = 0;
        const tap = new Transform({ transform(chunk, _enc, cb) { crc = zlib.crc32(chunk, crc); n += chunk.length; if (n > e.usize) return cb(fail(`${name}: size mismatch (more data than declared)`)); cb(null, chunk); } });
        const src = e.csize ? fs.createReadStream(file, { start, end: start + e.csize - 1 }) : require('stream').Readable.from([]);
        try { await pipeline(...[src, ...(e.method === 8 ? [zlib.createInflateRaw()] : []), tap, fs.createWriteStream(dest, { flags: 'wx', mode: 0o600 })]); }
        catch (err) { try { fs.unlinkSync(dest); } catch (_) {} throw err.gate ? err : fail(`${name}: ${err.message}`); }
        if (n !== e.usize || (crc >>> 0) !== e.crc) { try { fs.unlinkSync(dest); } catch (_) {} throw fail(`${name}: ${n !== e.usize ? 'size' : 'CRC'} mismatch`); }
        return { bytes: n, sha256: null };
      },
    };
  } catch (err) { close(); throw err; }
}

const sha256File = file => new Promise((res, rej) => { const h = crypto.createHash('sha256'); fs.createReadStream(file).on('data', d => h.update(d)).on('end', () => res(h.digest('hex'))).on('error', rej); });

module.exports = { writeZip, openZip, assertSafeName, safeNameProblem, sha256File, DEFAULT_LIMITS };
