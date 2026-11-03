'use strict';

const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const crypto = require('node:crypto');
const http = require('node:http');

const BASE = 'http://127.0.0.1:31337';
const DEST = '/Users/andrew/images_made';
const RECEIPTS = path.join(os.homedir(), 'Library/Application Support/DexDiffusion/publication-receipts');
const MAX_BYTES = 256 * 1024 * 1024;

function request(method, pathname, body) {
  return new Promise((resolve, reject) => {
    const data = body ? Buffer.from(JSON.stringify(body)) : null;
    const req = http.request(BASE + pathname, { method, timeout: 15000, headers: data ? { 'content-type': 'application/json', 'content-length': data.length } : {} }, res => {
      const chunks = []; let size = 0;
      res.on('data', chunk => { size += chunk.length; if (size > MAX_BYTES + 1024 * 1024) { req.destroy(new Error('response exceeds size limit')); return; } chunks.push(chunk); });
      res.on('end', () => { const bytes = Buffer.concat(chunks); if (res.statusCode < 200 || res.statusCode >= 300) return reject(new Error(`backend returned HTTP ${res.statusCode}`)); resolve({ bytes, headers: res.headers }); });
    });
    req.on('timeout', () => req.destroy(new Error('backend request timed out'))); req.on('error', reject); if (data) req.write(data); req.end();
  });
}
function hashFile(file) { const h = crypto.createHash('sha256'); const fd = fs.openSync(file, 'r'); try { const b = Buffer.alloc(1024 * 1024); let n; while ((n = fs.readSync(fd, b, 0, b.length, null)) > 0) h.update(b.subarray(0,n)); } finally { fs.closeSync(fd); } return h.digest('hex'); }
function durableJson(file, value) {
  const tmp = file + '.' + crypto.randomBytes(8).toString('hex') + '.tmp'; let fd;
  try { fd = fs.openSync(tmp, 'wx', 0o600); fs.writeFileSync(fd, JSON.stringify(value) + '\n'); fs.fsyncSync(fd); fs.closeSync(fd); fd = undefined; fs.renameSync(tmp, file); const d = fs.openSync(path.dirname(file), 'r'); try { fs.fsyncSync(d); } finally { fs.closeSync(d); } }
  finally { if (fd !== undefined) try { fs.closeSync(fd); } catch (_) {} try { fs.unlinkSync(tmp); } catch (_) {} }
}
function writeAll(fd, bytes) { let offset = 0; while (offset < bytes.length) offset += fs.writeSync(fd, bytes, offset, bytes.length - offset); }
function safeId(id) { return typeof id === 'string' && id.length <= 255 && !id.startsWith('.') && !/[\\/\0-\x1f\x7f]/.test(id) && /\.(png|jpe?g|webp|gif)$/i.test(id); }
async function run({ base = BASE, destination = DEST, receipts = RECEIPTS, transport = request } = {}) {
  // CLI entry point uses fixed production constants; injected paths exist only
  // for isolated fixtures and are never read from command-line input.
  fs.mkdirSync(destination, { recursive: true }); fs.mkdirSync(receipts, { recursive: true, mode: 0o700 });
  if (fs.lstatSync(destination).isSymbolicLink() || !fs.lstatSync(destination).isDirectory()) throw new Error('canonical image root is not a real directory');
  if (fs.lstatSync(receipts).isSymbolicLink() || !fs.lstatSync(receipts).isDirectory()) throw new Error('receipt root is not a real directory');
  const listing = await transport('GET', '/api/publications/pending?limit=8');
  const pending = JSON.parse(listing.bytes.toString('utf8')).items || [];
  const results = [];
  for (const item of pending) {
    const id = item.image_id;
    if (!safeId(id) || !Number.isSafeInteger(item.expected_bytes) || item.expected_bytes < 1 || item.expected_bytes > MAX_BYTES || !/^[a-f0-9]{64}$/.test(item.sha256)) { results.push({ id, state: 'PUBLICATION_BLOCKED', reason: 'invalid-outbox-record' }); continue; }
    const target = path.join(destination, id), receiptFile = path.join(receipts, crypto.createHash('sha256').update(id).digest('hex') + '.json');
    const tmp = path.join(destination, `.dex-publication-${crypto.randomBytes(10).toString('hex')}.tmp`);
    try {
      let st; try { st = fs.lstatSync(target); } catch (e) { if (e.code !== 'ENOENT') throw e; }
      if (st && (!st.isFile() || st.isSymbolicLink())) throw new Error('canonical destination is not a regular file');
      if (st && (st.size !== item.expected_bytes || hashFile(target) !== item.sha256)) throw new Error('canonical filename collision');
      if (!st) {
        const response = await transport('GET', `/api/publications/${encodeURIComponent(id)}/content`);
        const fd = fs.openSync(tmp, 'wx', 0o600);
        try { writeAll(fd, response.bytes); fs.fsyncSync(fd); } finally { fs.closeSync(fd); }
        if (response.bytes.length !== item.expected_bytes || hashFile(tmp) !== item.sha256) throw new Error('download size or digest mismatch');
        try { fs.linkSync(tmp, target); } catch (e) { if (e.code !== 'EEXIST') throw e; const again = fs.lstatSync(target); if (!again.isFile() || again.isSymbolicLink() || again.size !== item.expected_bytes || hashFile(target) !== item.sha256) throw new Error('canonical filename collision'); }
        fs.unlinkSync(tmp); const d = fs.openSync(destination, 'r'); try { fs.fsyncSync(d); } finally { fs.closeSync(d); }
      }
      const receipt = { schema: 'dexdiffusion.canonical_receipt.v1', image_id: id, destination: target, bytes: item.expected_bytes, sha256: item.sha256, verified_at: new Date().toISOString() };
      let existing; try { existing = JSON.parse(fs.readFileSync(receiptFile, 'utf8')); } catch (_) {}
      if (existing && (existing.image_id !== id || existing.destination !== target || existing.sha256 !== item.sha256 || existing.bytes !== item.expected_bytes)) throw new Error('local receipt collision');
      if (!existing) durableJson(receiptFile, receipt);
      await transport('POST', `/api/publications/${encodeURIComponent(id)}/ack`, receipt);
      results.push({ id, state: 'CANONICAL_VERIFIED', bytes: item.expected_bytes, sha256: item.sha256 });
    } catch (error) {
      try { fs.unlinkSync(tmp); } catch (_) {}
      results.push({ id, state: 'PUBLICATION_FAILED_RETRYABLE', reason: error.message });
      try { await transport('POST', `/api/publications/${encodeURIComponent(id)}/failure`, { code: /collision|regular file/.test(error.message) ? 'destination-conflict' : 'transfer-or-commit-failed' }); } catch (_) {}
    }
  }
  return results;
}

if (require.main === module) run().then(results => { console.log(JSON.stringify(results)); if (results.some(r => r.state === 'PUBLICATION_FAILED_RETRYABLE' || r.state === 'PUBLICATION_BLOCKED')) process.exitCode = 1; }).catch(error => { console.error(`publication sync unavailable: ${error.message}`); process.exitCode = 1; });
module.exports = { run, hashFile, durableJson, safeId, writeAll };
