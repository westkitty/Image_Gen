'use strict';
// Chat Phase 3 rig: the REAL arbiter, job store, remote-worker registry, reconciler, cancellation manager and event bus,
// the Chat routes and compute owner, and a loopback fake Ollama. Nothing reaches a real model or Big Mac.
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const http = require('node:http');
const express = require('express');
const M = require('../../media');
const RW = require('../../remote-workers');
const { createCancellationManager } = require('../../cancellation');
const { createEventBus } = require('../../event-bus');
const { createGenericJobEventPublisher } = require('../../operational-jobs');
const { createChatCompute } = require('../../chat-compute');
const { registerChatRoutes } = require('../../chat-routes');
const { startFakeOllama } = require('../fixtures/fake-ollama-ndjson');

const FAST_STREAM = { headersMs: 400, firstTokenLightMs: 400, firstTokenHeavyMs: 500, idleMs: 400, wallMs: 5000 };
const FAST_COMPUTE = { probeTimeoutMs: 300, pollMs: 10, ownershipWaitMs: 150, unloadTimeoutMs: 300, unloadVerifyMs: 250, settleMs: 25 };
const rid = () => 'cr_' + require('node:crypto').randomBytes(16).toString('hex');

function stores(dir) {
  let compute = null;
  const logs = [];
  const eventBus = createEventBus({ heartbeatMs: 3600000 });
  const publishGeneric = createGenericJobEventPublisher(eventBus);
  const jobStore = M.createJobStore(path.join(dir, 'jobs.json'), { onChange: (kind, job) => publishGeneric(kind, job) });
  const remoteWorkers = RW.createRemoteWorkerRegistry({ file: path.join(dir, 'remote-workers.json'), onChange: r => { try { eventBus.publish('remote.worker', { job_id: r.job_id, state: r.state, action: r.action }); } catch (_) {} if (compute) compute.workerChanged(r); } });
  const arbiter = M.createResourceArbiter({ quarantineCheck: () => remoteWorkers.quarantineReason() });
  const cancelManager = createCancellationManager({ arbiter, jobStore, eventBus });
  return { eventBus, jobStore, remoteWorkers, arbiter, cancelManager, logs, setCompute: c => { compute = c; } };
}

async function chatRig({ ps, unload, chat, gate, compute: computeOpts = {}, stream = FAST_STREAM, dir, savedFile } = {}) {
  dir = dir || fs.mkdtempSync(path.join(os.tmpdir(), 'dex-chat-p3-'));
  const fake = await startFakeOllama({ chat, ps, unload });
  const s = stores(dir);
  const compute = createChatCompute(Object.assign({ arbiter: s.arbiter, jobStore: s.jobStore, remoteWorkers: s.remoteWorkers, cancelManager: s.cancelManager, baseUrl: fake.url, gate, log: m => s.logs.push(m), publish: (e, d) => s.eventBus.publish(e, d) }, FAST_COMPUTE, computeOpts));
  s.setCompute(compute);
  const reconciler = RW.createReconciler({ registry: s.remoteWorkers, checkRun: async () => { throw new Error('not an sd run'); }, stopRun: async () => { throw new Error('not an sd run'); }, scanOwned: async () => { throw new Error('scanOwned must not decide Chat records'); }, checkOllamaModel: r => compute.checkOllamaModel(r) });
  const app = express(); app.use(express.json());
  const server = await new Promise(r => { const x = app.listen(0, '127.0.0.1', () => r(x)); });
  const port = server.address().port;
  const mod = registerChatRoutes(app, { enabled: true, ollamaBaseUrl: fake.url, port, admit: compute.admit, log: m => s.logs.push(m), timeouts: stream, heartbeatMs: 60000, sessionOptions: savedFile ? { savedFile } : undefined, guardPolicy: { hosts: [`127.0.0.1:${port}`], origins: [`http://127.0.0.1:${port}`] } });
  compute.attachRunner(mod.runner);
  const headers = { Origin: `http://127.0.0.1:${port}`, 'X-Dex-Request': '1', 'Content-Type': 'application/json' };
  const request = (method, p, body, { onEvent } = {}) => new Promise((resolve, reject) => {
    const req = http.request({ host: '127.0.0.1', port, path: p, method, headers: body === undefined ? { Origin: headers.Origin, 'X-Dex-Request': '1' } : headers }, res => {
      let raw = ''; const events = [];
      res.setEncoding('utf8');
      res.on('data', c => {
        raw += c; let i;
        while ((i = raw.indexOf('\n\n')) !== -1) {
          const frame = raw.slice(0, i); raw = raw.slice(i + 2);
          const ev = { event: /^event: (.*)$/m.exec(frame)[1], data: JSON.parse(/^data: (.*)$/m.exec(frame)[1]) };
          events.push(ev);
          if (onEvent && onEvent(ev, events)) { req.destroy(); res.destroy(); return resolve({ status: res.statusCode, events, destroyed: true }); }
        }
      });
      res.on('end', () => resolve({ status: res.statusCode, events, body: (res.headers['content-type'] || '').includes('json') && raw ? JSON.parse(raw) : null }));
      res.on('error', () => {});
    });
    req.on('error', e => (e.code === 'ECONNRESET' ? null : reject(e)));
    if (body !== undefined) req.write(JSON.stringify(body));
    req.end();
  });
  const newSession = async (model) => (await request('POST', '/api/chat/sessions', model ? { model } : {})).body.session_id;
  const send = (sid, content, more = {}, opts) => request('POST', '/api/ollama/chat/stream', Object.assign({ session_id: sid, request_id: rid(), action: 'send', content }, more), opts);
  const close = async () => { server.closeAllConnections(); server.close(); await fake.close(); };
  return Object.assign(s, { dir, fake, compute, reconciler, mod, request, newSession, send, close });
}

const until = async (fn, ms = 4000) => { const t0 = Date.now(); for (;;) { const v = await fn(); if (v) return v; if (Date.now() - t0 > ms) throw new Error('timeout waiting for condition'); await new Promise(r => setTimeout(r, 5)); } };
const terminals = evs => evs.filter(e => ['done', 'stopped', 'error'].includes(e.event));

module.exports = { chatRig, stores, until, terminals, rid, FAST_COMPUTE, FAST_STREAM };
