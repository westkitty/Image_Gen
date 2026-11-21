'use strict';

// Private filesystem handshake with the EngineHost worker. No HTTP route can request a drain.
const fs = require('node:fs');
const path = require('node:path');

function backendQuiescence(directory, isIdle) {
  const sealFile = path.join(directory, 'idle');
  const drainFile = path.join(directory, 'drain');
  let requests = 0;
  let seal = '';
  let faulted = false;

  function syncDirectory() {
    const fd = fs.openSync(directory, 'r');
    try { fs.fsyncSync(fd); } finally { fs.closeSync(fd); }
  }
  function invalidate() {
    if (!seal) return;
    fs.unlinkSync(sealFile);
    syncDirectory();
    seal = '';
  }
  function draining() {
    try { fs.lstatSync(drainFile); return true; }
    catch (error) { if (error.code === 'ENOENT') return false; throw error; }
  }
  function checkpoint() {
    try {
      if (faulted || requests || !isIdle()) return invalidate();
      const next = process.pid + (draining() ? ' drained\n' : ' idle\n');
      if (next !== seal) {
        const fd = fs.openSync(sealFile + '.new', 'w', 0o600);
        try { fs.writeFileSync(fd, next); fs.fsyncSync(fd); } finally { fs.closeSync(fd); }
        fs.renameSync(sealFile + '.new', sealFile);
        seal = next;
        syncDirectory();
      } else {
        const now = new Date();
        fs.utimesSync(sealFile, now, now);
      }
    } catch (error) {
      try { invalidate(); } catch (_) { /* the parent also requires a recent seal */ }
    }
  }
  function middleware(req, res, next) {
    try {
      if (faulted || draining()) return res.status(503).json({ error: 'Backend is draining for restart' });
      invalidate();
    } catch (_) {
      faulted = true;
      return res.status(503).json({ error: 'Backend restart evidence is unavailable' });
    }
    requests++;
    let finished = false;
    function done() {
      if (finished) return;
      finished = true;
      requests--;
    }
    res.once('finish', done);
    // A cancelled mutating request may still be executing asynchronous work.
    if (req.method === 'GET' || req.method === 'HEAD') res.once('close', done);
    next();
  }
  return { checkpoint, middleware, invalidate };
}

function requireLedgerShape(file, valid) {
  try {
    if (!fs.lstatSync(file).isFile() || !valid(JSON.parse(fs.readFileSync(file, 'utf8')) || {})) {
      throw new Error('unreadable or invalid restart evidence: ' + path.basename(file));
    }
  } catch (error) {
    if (error.code !== 'ENOENT') throw error;
  }
}

module.exports = { backendQuiescence, requireLedgerShape };
