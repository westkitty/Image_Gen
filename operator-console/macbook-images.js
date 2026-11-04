'use strict';
// Runs on the Big Mac. Reads the images kept on the MacBook through bin/macbook-image-service.js. Listing never blocks and
// never downloads. Work that needs a real file gets the image back in the image folder under its own name, so every script
// and path check keeps working; sweepImagesHeldOnMacbook removes it again once it is idle.
const fs = require('fs');
const path = require('path');
const http = require('http');
const crypto = require('crypto');
const { spawnSync } = require('child_process');

// How long a file stays on the Big Mac after it was written, once the MacBook verifiably holds the same bytes.
const IDLE_BEFORE_REMOVAL_MS = 30 * 60 * 1000;

function createMacbookImages({ baseUrl, manifestFile = null, refreshMs = 5000 }) {
  let images = new Map();
  let reachable = false;
  let onRefresh = null;
  const failedAt = new Map();

  // After a restart the last known list answers until the MacBook does, so a missing MacBook is not mistaken for missing images.
  if (manifestFile) { try { images = new Map(Object.entries(JSON.parse(fs.readFileSync(manifestFile, 'utf8')).images)); } catch (_) {} }
  let saved = manifestFile ? JSON.stringify(Object.fromEntries(images)) : '';
  function remember() {
    if (!manifestFile) return;
    const text = JSON.stringify(Object.fromEntries(images));
    if (text === saved) return;
    const tmp = manifestFile + '.tmp-' + process.pid;
    try { fs.writeFileSync(tmp, JSON.stringify({ images: Object.fromEntries(images) })); fs.renameSync(tmp, manifestFile); saved = text; } catch (_) {}
  }

  function refresh() {
    return new Promise(resolve => {
      const req = http.get(baseUrl + '/manifest', { timeout: 3000 }, res => {
        const chunks = [];
        res.on('data', c => chunks.push(c));
        res.on('end', () => {
          try {
            if (res.statusCode !== 200) throw new Error('status ' + res.statusCode);
            const next = new Map(Object.entries(JSON.parse(Buffer.concat(chunks).toString('utf8')).images));
            // A folder that suddenly holds nothing is far more likely moved than emptied: keep what is known and say the MacBook is away.
            reachable = next.size > 0 || images.size === 0;
            if (reachable) { images = next; remember(); }
          } catch (_) { reachable = false; }
          if (reachable && onRefresh) { try { onRefresh(); } catch (error) { console.error('MacBook image sweep failed: ' + error.message); } }
          resolve(reachable);
        });
        res.on('error', () => { reachable = false; resolve(false); });
      });
      req.on('timeout', () => req.destroy(new Error('timeout')));
      req.on('error', () => { reachable = false; resolve(false); });
    });
  }
  let timer = null;
  function start() {
    if (timer) return;
    refresh();
    timer = setInterval(() => { refresh(); }, refreshMs);
    timer.unref();
  }
  function stop() { if (timer) clearInterval(timer); timer = null; }

  // Writes the image to destination, checked against the digest the MacBook published. Blocks the server, so it gives up at
  // once when the MacBook is known to be away, and quickly when a transfer stalls.
  function fetchInto(id, destination) {
    const info = images.get(id);
    if (!info || !reachable || Date.now() - (failedAt.get(id) || 0) < 5000) return false;
    const tmp = path.join(path.dirname(destination), '.macbook-' + crypto.randomBytes(8).toString('hex') + '.part');
    const got = spawnSync('/usr/bin/curl', ['-fsS', '--connect-timeout', '3', '--speed-limit', '10240', '--speed-time', '5', '--max-time', '30', '-o', tmp, baseUrl + '/images/' + encodeURIComponent(id)], { timeout: 35000 });
    try {
      if (got.status !== 0) throw new Error('fetch failed');
      if (crypto.createHash('sha256').update(fs.readFileSync(tmp)).digest('hex') !== info.sha256) throw new Error('digest mismatch');
      fs.renameSync(tmp, destination);
      failedAt.delete(id);
      return true;
    } catch (_) {
      try { fs.unlinkSync(tmp); } catch (_e) {}
      failedAt.set(id, Date.now());
      return false;
    }
  }

  // Streams without keeping anything on this machine. onUnavailable lets the caller answer when the MacBook cannot.
  function stream(kind, id, res, onUnavailable) {
    const req = http.get(baseUrl + '/' + kind + '/' + encodeURIComponent(id), { timeout: 20000 }, up => {
      if (up.statusCode !== 200) { up.resume(); return onUnavailable(); }
      res.set('Content-Type', up.headers['content-type']);
      if (up.headers['content-length']) res.set('Content-Length', up.headers['content-length']);
      res.set('X-Content-Type-Options', 'nosniff');
      up.on('error', () => res.destroy());
      up.pipe(res);
    });
    req.on('timeout', () => req.destroy(new Error('timeout')));
    req.on('error', () => { if (!res.headersSent) onUnavailable(); else res.destroy(); });
  }

  return {
    start, stop, refresh, fetchInto, stream,
    has: id => images.has(id),
    info: id => images.get(id) || null,
    ids: () => [...images.keys()],
    isReachable: () => reachable,
    setOnRefresh: fn => { onRefresh = fn; },
  };
}

// Removes a file from the Big Mac image folder only on this machine's own evidence: the MacBook's current manifest shows the
// digest and size of the bytes here. A receipt alone is never enough. Nothing is removed while any job is queued or running,
// while the image still waits to be published, or until the file has sat idle. Also counts acknowledged images that are in
// neither place, which means they were moved or deleted on the MacBook.
function sweepImagesHeldOnMacbook({ records, store, images, busy, now = Date.now(), idleMs = IDLE_BEFORE_REMOVAL_MS }) {
  let removed = 0, missing = 0;
  if (!images.isReachable()) return { removed, missing };
  const byId = new Map(records.map(r => [r.image_id, r]));
  for (const record of records) {
    if (record.state === 'CANONICAL_VERIFIED' && !images.info(record.image_id) && !store.isKeptHere(record.image_id)) missing++;
  }
  if (busy) return { removed, missing };
  for (const name of store.localFileNames()) {
    const file = path.join(store.root, name);
    try {
      if (name.startsWith('.macbook-')) { if (now - fs.statSync(file).mtimeMs >= idleMs) fs.unlinkSync(file); continue; }
      const info = images.info(name), record = byId.get(name);
      if (!info || !store.isKeptHere(name) || (record && record.state !== 'CANONICAL_VERIFIED')) continue;
      const st = fs.lstatSync(file);
      if (now - st.mtimeMs < idleMs || st.size !== info.bytes) continue;
      if (crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex') !== info.sha256) continue;
      if (store.removeAfterPublication(name)) removed++;
    } catch (error) { console.error('Could not remove ' + name + ': ' + error.message); }
  }
  return { removed, missing };
}

module.exports = { createMacbookImages, sweepImagesHeldOnMacbook, IDLE_BEFORE_REMOVAL_MS };
