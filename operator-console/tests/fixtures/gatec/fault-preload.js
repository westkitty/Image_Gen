'use strict';
// Gate C fault injector, loaded with `node --require` into the bridge. It patches
// module exports only (no production test hooks) and works for both the pristine
// HEAD bridge and the repaired one. Every point fires at most once per process.
//   DEX_GATEC_FAULT       comma list: before-result, after-result:N, during-status, ack-uncertain,
//                         after-ack, self-cancel-after-result, store:<image-store point>, journal:<journal point>
//   DEX_GATEC_FAULT_MODE  kill (SIGKILL, default) | throw (ordinary exception)
//   DEX_GATEC_DISK        eio -> transfer writes fail with EIO;  lowdisk -> after worker completion, statfs reports ~0 free and writes fail ENOSPC
//   DEX_GATEC_DECISION_ERR EPERM | EIO -> reading any run's publication-decision.json fails with that code
const fs = require('node:fs');
const path = require('node:path');
const impl = path.resolve(process.env.DEX_GATEC_IMPL_ROOT, 'operator-console');
const points = new Set(String(process.env.DEX_GATEC_FAULT || '').split(',').filter(Boolean));
const mode = process.env.DEX_GATEC_FAULT_MODE || 'kill';
const fired = new Set();
function hit(point) {
  if (!points.has(point) || fired.has(point)) return;
  fired.add(point);
  fs.appendFileSync(path.join(process.env.HOME, 'gatec-faults.log'), point + '\n');
  if (mode === 'kill') process.kill(process.pid, 'SIGKILL');
  throw Object.assign(new Error('injected fault at ' + point), { code: 'EGATEC' });
}
const decisionErr = process.env.DEX_GATEC_DECISION_ERR;
if (decisionErr) {
  const readFile = fs.readFileSync;
  fs.readFileSync = function (file, ...rest) {
    if (typeof file === 'string' && path.basename(file) === 'publication-decision.json') {
      throw Object.assign(new Error(decisionErr + ': injected unreadable cancellation decision'), { code: decisionErr });
    }
    return readFile.call(fs, file, ...rest);
  };
}
// Redirect the production Mac Python path only for this owned test worker.
const assert = require('node:assert/strict');
const cp = require('node:child_process');
const ownedPython = process.env.DEX_GATEC_PYTHON;
const ownClient = path.join(process.env.HOME, '.dexdiffusion-engine', 'engine-worker.py');
assert.match(process.env.HOME, /^\/tmp\/dgc-[A-Za-z0-9]+$/);
assert.equal(process.env.DEX_LOCAL_ENGINE_DIRECT, '1');
assert.ok(path.isAbsolute(ownedPython));
const spawn = cp.spawn;
cp.spawn = function (file, args, options) {
  if (file === '/opt/homebrew/bin/python3' && args?.[0] === ownClient && args[1] === 'client') {
    return spawn.call(this, ownedPython, args, options);
  }
  return spawn.apply(this, arguments);
};

const client = require(path.join(impl, 'local-engine-client'));
const realRequest = client.request;
let results = 0, statuses = 0, workerCompleted = false;
client.request = async function (payload, opts) {
  if (payload.op === 'status' && ++statuses === 1) hit('during-status');
  if (payload.op === 'result') hit('before-result');
  if (payload.op === 'ack' && points.has('ack-uncertain') && !fired.has('ack-uncertain')) {
    fired.add('ack-uncertain');
    await realRequest(payload, opts); // the worker processes it; the response is lost
    throw new Error('Local engine transport timed out; owned job remains bounded on Big Mac.');
  }
  const response = await realRequest(payload, opts);
  if (payload.op === 'status' && response.status === 'complete') workerCompleted = true;
  if (payload.op === 'result') {
    results++;
    hit('after-result:' + results);
    if (points.has('self-cancel-after-result') && !fired.has('self-cancel-after-result')) { fired.add('self-cancel-after-result'); process.kill(process.pid, 'SIGTERM'); await new Promise(r => setTimeout(r, 200)); }
  }
  if (payload.op === 'ack') hit('after-ack');
  return response;
};
const store = require(path.join(impl, 'image-store'));
const realCreate = store.createImageStore;
store.createImageStore = opts => realCreate({ ...opts, fault: point => hit('store:' + point) });
try {
  const journal = require(path.join(impl, 'engine-transfer-journal'));
  const realJournal = journal.createTransferJournal;
  journal.createTransferJournal = opts => realJournal({ ...opts, fault: point => hit('journal:' + point) });
} catch (err) { if (err.code !== 'MODULE_NOT_FOUND') throw err; }
const disk = process.env.DEX_GATEC_DISK;
if (disk) {
  const transferFile = file => /dex-engine-transfer-|engine-transfer\/.*output-\d+\.png/.test(String(file));
  const fail = () => Object.assign(new Error((disk === 'eio' ? 'EIO' : 'ENOSPC') + ': injected transfer write failure'), { code: disk === 'eio' ? 'EIO' : 'ENOSPC' });
  const fds = new Map();
  const open = fs.openSync, write = fs.writeSync, writeFile = fs.writeFileSync, statfs = fs.statfsSync;
  if (disk === 'lowdisk') fs.statfsSync = (p, o) => {
    const usage = statfs(p, o);
    return workerCompleted ? { ...usage, bavail: 1, bfree: 1 } : usage;
  };
  fs.openSync = function (file, ...rest) { const fd = open.call(fs, file, ...rest); fds.set(fd, String(file)); return fd; };
  fs.writeSync = function (fd, ...rest) { if (transferFile(fds.get(fd))) throw fail(); return write.call(fs, fd, ...rest); };
  fs.writeFileSync = function (file, ...rest) { if (typeof file !== 'number' && transferFile(file)) throw fail(); return writeFile.call(fs, file, ...rest); };
}
