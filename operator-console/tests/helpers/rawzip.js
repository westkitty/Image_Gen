'use strict';
const zlib = require('node:zlib');
// Hand-built archives so hostile shapes can be produced exactly (the real writer refuses to make them).
function rawZip(entries, { flags = 0, method = 0, extAttr = 0, hostByte = 3, badCrc = false, truncateTail = 0, sizeLie = 0 } = {}) {
  const locals = [], centrals = []; let off = 0;
  for (const e of entries) {
    const name = Buffer.from(e.name, 'utf8'), data = Buffer.from(e.data || ''); const comp = method === 8 ? zlib.deflateRawSync(data) : data;
    const crc = (zlib.crc32(data) ^ (badCrc ? 1 : 0)) >>> 0;
    const lh = Buffer.alloc(30); lh.writeUInt32LE(0x04034b50, 0); lh.writeUInt16LE(20, 4); lh.writeUInt16LE(flags, 6); lh.writeUInt16LE(method, 8); lh.writeUInt32LE(crc, 14); lh.writeUInt32LE(comp.length, 18); lh.writeUInt32LE(data.length + sizeLie, 22); lh.writeUInt16LE(name.length, 26);
    locals.push(lh, name, comp);
    const ch = Buffer.alloc(46); ch.writeUInt32LE(0x02014b50, 0); ch.writeUInt16LE((hostByte << 8) | 20, 4); ch.writeUInt16LE(20, 6); ch.writeUInt16LE(flags, 8); ch.writeUInt16LE(method, 10); ch.writeUInt32LE(crc, 16); ch.writeUInt32LE(comp.length, 20); ch.writeUInt32LE(data.length + sizeLie, 24); ch.writeUInt16LE(name.length, 28); ch.writeUInt32LE((e.extAttr == null ? extAttr : e.extAttr) >>> 0, 38); ch.writeUInt32LE(off, 42);
    centrals.push(ch, name); off += 30 + name.length + comp.length;
  }
  const cd = Buffer.concat(centrals), eocd = Buffer.alloc(22); eocd.writeUInt32LE(0x06054b50, 0); eocd.writeUInt16LE(entries.length, 8); eocd.writeUInt16LE(entries.length, 10); eocd.writeUInt32LE(cd.length, 12); eocd.writeUInt32LE(off, 16);
  const all = Buffer.concat([...locals, cd, eocd]);
  return truncateTail ? all.subarray(0, all.length - truncateTail) : all;
}

module.exports = rawZip;
