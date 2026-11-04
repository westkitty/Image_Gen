#!/usr/bin/env node
'use strict';
// Runs on the MacBook. Shares ~/images_made, read-only and on loopback only, with the Big Mac backend through its own
// reverse SSH forward, so the Library can read images that are no longer kept on the Big Mac.
const fs = require('fs');
const os = require('os');
const path = require('path');
const http = require('http');
const crypto = require('crypto');
const { execFile, spawn } = require('child_process');

const SAFE_ID = /^(?!\.)(?!.*[\\/])[^\u0000-\u001f\u007f]+\.(?:png|jpe?g|webp|gif)$/i;
const TYPES = { '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.webp': 'image/webp', '.gif': 'image/gif' };
const PORT = 31338;

function looksLikeImage(head, id) {
  const ext = path.extname(id).toLowerCase();
  if (ext === '.png') return head.length >= 8 && head.readUInt32BE(0) === 0x89504e47;
  if (ext === '.jpg' || ext === '.jpeg') return head.length >= 3 && head[0] === 0xff && head[1] === 0xd8 && head[2] === 0xff;
  if (ext === '.webp') return head.length >= 12 && head.toString('latin1', 0, 4) === 'RIFF' && head.toString('latin1', 8, 12) === 'WEBP';
  return head.length >= 4 && head.toString('latin1', 0, 3) === 'GIF';
}

function createImageService({ root, thumbnailDir, thumbnailSize = 384 }) {
  const known = new Map();
  fs.mkdirSync(thumbnailDir, { recursive: true });

  function fileFor(id) {
    if (typeof id !== 'string' || id.length > 255 || !SAFE_ID.test(id)) return null;
    const full = path.join(root, id);
    try { return fs.lstatSync(full).isFile() ? full : null; } catch (_) { return null; }
  }

  function describe(id) {
    const full = fileFor(id);
    if (!full) return null;
    const st = fs.statSync(full), signature = st.size + ':' + st.mtimeMs;
    const cached = known.get(id);
    if (cached && cached.signature === signature) return cached.info;
    const bytes = fs.readFileSync(full);
    const info = !looksLikeImage(bytes.subarray(0, 32), id) ? null : {
      bytes: st.size, mtimeMs: st.mtimeMs, sha256: crypto.createHash('sha256').update(bytes).digest('hex'),
      ...(path.extname(id).toLowerCase() === '.png' && bytes.length >= 24 ? { width: bytes.readUInt32BE(16), height: bytes.readUInt32BE(20) } : {}),
    };
    known.set(id, { signature, info });
    return info;
  }

  function manifest() {
    const images = {};
    for (const id of fs.readdirSync(root)) {
      try { const info = describe(id); if (info) images[id] = info; } catch (_) { /* a file being written appears on the next scan */ }
    }
    for (const id of known.keys()) if (!images[id]) known.delete(id);
    return { schema: 'dexdiffusion.macbook_images.v1', images };
  }

  function sendFile(res, file, type) {
    res.writeHead(200, { 'Content-Type': type, 'Content-Length': fs.statSync(file).size, 'X-Content-Type-Options': 'nosniff' });
    fs.createReadStream(file).on('error', () => res.destroy()).pipe(res);
  }

  function thumbnail(id, res) {
    const info = describe(id), full = fileFor(id);
    const out = path.join(thumbnailDir, info.sha256 + '-' + thumbnailSize + '.jpg');
    if (fs.existsSync(out)) return sendFile(res, out, 'image/jpeg');
    const tmp = out + '.tmp-' + process.pid + '-' + Date.now() + '.jpg';
    execFile('/usr/bin/sips', ['-Z', String(thumbnailSize), '-s', 'format', 'jpeg', '-s', 'formatOptions', '80', full, '--out', tmp], { timeout: 20000 }, err => {
      try {
        if (err || !fs.statSync(tmp).size) throw err || new Error('empty thumbnail');
        fs.renameSync(tmp, out);
        sendFile(res, out, 'image/jpeg');
      } catch (_) {
        try { fs.unlinkSync(tmp); } catch (_e) {}
        sendFile(res, full, TYPES[path.extname(id).toLowerCase()]);
      }
    });
  }

  return http.createServer((req, res) => {
    const fail = (code, text) => { res.writeHead(code, { 'Content-Type': 'text/plain' }); res.end(text); };
    if (req.method !== 'GET' && req.method !== 'HEAD') return fail(405, 'read-only');
    let parts;
    try { parts = new URL(req.url, 'http://local').pathname.split('/').filter(Boolean).map(decodeURIComponent); } catch (_) { return fail(400, 'bad path'); }
    try {
      if (parts.length === 1 && parts[0] === 'manifest') { res.writeHead(200, { 'Content-Type': 'application/json' }); return res.end(JSON.stringify(manifest())); }
      if (parts.length === 2 && (parts[0] === 'images' || parts[0] === 'thumbnails')) {
        const full = fileFor(parts[1]);
        if (!full || !describe(parts[1])) return fail(404, 'not found');
        return parts[0] === 'images' ? sendFile(res, full, TYPES[path.extname(parts[1]).toLowerCase()]) : thumbnail(parts[1], res);
      }
    } catch (_) { return fail(500, 'unavailable'); }
    return fail(404, 'not found');
  });
}

// Keeps the reverse forward up. It is separate from the Studio tunnel, so neither can take the other down.
function superviseTunnel(target) {
  const start = () => {
    const child = spawn('/usr/bin/ssh', ['-N', '-C', '-o', 'BatchMode=yes', '-o', 'ExitOnForwardFailure=yes', '-o', 'ConnectTimeout=10', '-o', 'ServerAliveInterval=15', '-o', 'ServerAliveCountMax=2',
      '-R', `127.0.0.1:${PORT}:127.0.0.1:${PORT}`, target], { stdio: ['ignore', 'inherit', 'inherit'] });
    child.on('exit', code => { console.error(`reverse forward ended (${code}); retrying in 10s`); setTimeout(start, 10000); });
    child.on('error', err => console.error('reverse forward failed: ' + err.message));
  };
  start();
}

if (require.main === module) {
  const home = os.homedir();
  const server = createImageService({ root: path.join(home, 'images_made'), thumbnailDir: path.join(home, 'Library/Caches/DexDiffusion/library-thumbnails') });
  server.listen(PORT, '127.0.0.1', () => {
    console.error(`MacBook image service on 127.0.0.1:${PORT}`);
    superviseTunnel(process.env.DEX_SSH_TARGET || 'westcat');
  });
}

module.exports = { createImageService };
