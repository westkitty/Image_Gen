'use strict';

// PNG text chunks (P12): read tEXt / zTXt / iTXt, and add an iTXt chunk, without touching pixel data.
// Bounded everywhere: a hostile PNG cannot make this allocate or loop without limit.
const zlib = require('node:zlib');

const SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
const MAX_PNG_BYTES = 40 * 1024 * 1024;
const MAX_CHUNKS = 4096;
const MAX_TEXT_BYTES = 2 * 1024 * 1024;

const CRC_TABLE = (() => { const t = new Uint32Array(256); for (let n = 0; n < 256; n++) { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; t[n] = c >>> 0; } return t; })();
function crc32(buf) { let c = 0xffffffff; for (let i = 0; i < buf.length; i++) c = CRC_TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8); return (c ^ 0xffffffff) >>> 0; }

function isPng(buf) { return Buffer.isBuffer(buf) && buf.length >= 8 && buf.subarray(0, 8).equals(SIGNATURE); }

function* chunks(buf) {
  if (!isPng(buf)) throw new Error('Not a PNG file');
  if (buf.length > MAX_PNG_BYTES) throw new Error('PNG is larger than the 40 MB limit');
  let off = 8, count = 0;
  while (off + 12 <= buf.length) {
    if (++count > MAX_CHUNKS) throw new Error('PNG has too many chunks');
    const len = buf.readUInt32BE(off), type = buf.toString('latin1', off + 4, off + 8);
    if (off + 12 + len > buf.length) throw new Error('PNG is truncated');
    yield { type, start: off, data: buf.subarray(off + 8, off + 8 + len), end: off + 12 + len };
    off += 12 + len;
    if (type === 'IEND') return;
  }
  throw new Error('PNG is truncated (no IEND chunk)');
}

function inflateLimited(data) {
  const out = zlib.inflateSync(data, { maxOutputLength: MAX_TEXT_BYTES });
  return out;
}

// -> [{ key, text, kind: 'tEXt'|'zTXt'|'iTXt', truncated }]
function readTextChunks(buf) {
  const out = [];
  for (const c of chunks(buf)) {
    try {
      if (c.type === 'tEXt') {
        const z = c.data.indexOf(0); if (z < 1) continue;
        out.push({ key: c.data.toString('latin1', 0, z), text: c.data.toString('latin1', z + 1), kind: 'tEXt' });
      } else if (c.type === 'zTXt') {
        const z = c.data.indexOf(0); if (z < 1 || c.data[z + 1] !== 0) continue;
        out.push({ key: c.data.toString('latin1', 0, z), text: inflateLimited(c.data.subarray(z + 2)).toString('latin1'), kind: 'zTXt' });
      } else if (c.type === 'iTXt') {
        const z = c.data.indexOf(0); if (z < 1) continue;
        const compressed = c.data[z + 1] === 1;
        let p = z + 3;                                  // skip null, compression flag, method
        const langEnd = c.data.indexOf(0, p); if (langEnd < 0) continue;
        const transEnd = c.data.indexOf(0, langEnd + 1); if (transEnd < 0) continue;
        const body = c.data.subarray(transEnd + 1);
        out.push({ key: c.data.toString('latin1', 0, z), text: (compressed ? inflateLimited(body) : body).toString('utf8'), kind: 'iTXt' });
      }
    } catch (_) { out.push({ key: '(unreadable chunk)', text: '', kind: c.type, truncated: true }); }
  }
  return out;
}

// Insert (or replace) one iTXt chunk before the first IDAT. Returns a new Buffer; the input is untouched.
function withTextChunk(buf, key, text) {
  if (!/^[\x20-\x7e]{1,79}$/.test(key)) throw new Error('Invalid PNG text keyword');
  const body = Buffer.concat([Buffer.from(key, 'latin1'), Buffer.from([0, 0, 0, 0, 0]), Buffer.from(String(text), 'utf8')]);
  const type = Buffer.from('iTXt', 'latin1');
  const len = Buffer.alloc(4); len.writeUInt32BE(body.length);
  const crc = Buffer.alloc(4); crc.writeUInt32BE(crc32(Buffer.concat([type, body])));
  const chunk = Buffer.concat([len, type, body, crc]);
  const parts = [buf.subarray(0, 8)];
  let inserted = false;
  for (const c of chunks(buf)) {
    if (c.type === 'IDAT' && !inserted) { parts.push(chunk); inserted = true; }
    const isSame = (c.type === 'tEXt' || c.type === 'iTXt' || c.type === 'zTXt') && c.data.toString('latin1', 0, Math.max(0, c.data.indexOf(0))) === key;
    if (!isSame) parts.push(buf.subarray(c.start, c.end));
  }
  if (!inserted) throw new Error('PNG has no image data');
  return Buffer.concat(parts);
}

module.exports = { isPng, readTextChunks, withTextChunk, crc32, MAX_PNG_BYTES };
