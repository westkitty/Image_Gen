'use strict';
// Loopback-only fake Ollama for Chat tests. Never proxies to a real model.
// /api/tags returns the configured tags; /api/chat runs a per-test handler (scripted NDJSON for stream:true, JSON for stream:false).
const http = require('node:http');

const GIB = 1024 ** 3;
const DEFAULT_TAGS = [
  { name: 'hermes-qwen3.8-27b-64k:latest', modified_at: '2026-10-16T20:44:21-07:00', size: Math.round(16.9 * GIB) },
  { name: 'qwen3.8:27b-mlx', modified_at: '2026-10-16T20:43:15-07:00', size: Math.round(16.9 * GIB) },
  { name: 'gemma3:4b', modified_at: '2026-10-14T22:49:04-07:00', size: Math.round(3.1 * GIB) },
];

const line = obj => JSON.stringify(obj) + '\n';
const delta = content => line({ model: 'm', created_at: '2026-10-23T00:00:00Z', message: { role: 'assistant', content }, done: false });
const doneLine = (extra = {}) => line(Object.assign({ model: 'm', created_at: '2026-10-23T00:00:00Z', message: { role: 'assistant', content: '' }, done: true, done_reason: 'stop', eval_count: 7, prompt_eval_count: 11 }, extra));

// Steps: { write: string|Buffer } | { delay: ms } | { waitAbort: true } | { destroy: true }. Ends the response after the last step.
function scripted(steps, { status = 200 } = {}) {
  return async (body, req, res, state) => {
    res.writeHead(status, { 'Content-Type': 'application/x-ndjson' });
    res.flushHeaders();
    for (const s of steps) {
      if (state.aborted) return;
      if (s.write !== undefined) res.write(s.write);
      else if (s.delay) await new Promise(r => setTimeout(r, s.delay));
      else if (s.waitAbort) { await state.abortedPromise; return; }
      else if (s.destroy) { res.destroy(); return; }
    }
    res.end();
  };
}

// ps: () => ({ status, json }) per /api/ps call (default: nothing loaded). unload: (body) => ({ status, json }) for the
// unload form of /api/chat (empty messages, keep_alive 0); default acknowledges like Ollama ('done_reason: unload').
async function startFakeOllama({ tags = DEFAULT_TAGS, chat = null, tagsStatus = 200, ps = null, unload = null } = {}) {
  const requests = [];
  let chatHandler = chat, psHandler = ps, unloadHandler = unload;
  const server = http.createServer((req, res) => {
    const chunks = [];
    req.on('data', c => chunks.push(c));
    req.on('end', async () => {
      const raw = Buffer.concat(chunks).toString('utf8');
      let body = null; try { body = raw ? JSON.parse(raw) : null; } catch (_) {}
      const entry = { method: req.method, route: req.url, body, aborted: false };
      let resolveAbort; entry.abortedPromise = new Promise(r => { resolveAbort = r; });
      res.on('close', () => { if (!res.writableFinished) { entry.aborted = true; resolveAbort(); } });
      requests.push(entry);
      if (req.url === '/api/tags') { res.writeHead(tagsStatus, { 'Content-Type': 'application/json' }); return res.end(JSON.stringify(tagsStatus === 200 ? { models: tags } : { error: 'boom' })); }
      if (req.url === '/api/ps') {
        const r = psHandler ? await psHandler(entry) : { status: 200, json: { models: [] } };
        if (r.destroy) return res.destroy();
        res.writeHead(r.status || 200, { 'Content-Type': 'application/json' });
        return res.end(typeof r.raw === 'string' ? r.raw : JSON.stringify(r.json));
      }
      if (req.url === '/api/chat' && body && Array.isArray(body.messages) && body.messages.length === 0 && body.keep_alive === 0) {
        entry.unload = true;
        const r = unloadHandler ? await unloadHandler(body, entry) : { status: 200, json: { model: body.model, created_at: '2026-10-23T00:00:00Z', message: { role: 'assistant', content: '' }, done_reason: 'unload', done: true } };
        if (r.destroy) return res.destroy();
        res.writeHead(r.status || 200, { 'Content-Type': 'application/json' });
        return res.end(JSON.stringify(r.json));
      }
      if (req.url === '/api/version') { res.writeHead(200, { 'Content-Type': 'application/json' }); return res.end('{"version":"0.40.7"}'); }
      if (req.url === '/api/chat' && chatHandler) return chatHandler(body, req, res, entry);
      res.writeHead(404, { 'Content-Type': 'application/json' }); res.end('{"error":"not found"}');
    });
  });
  await new Promise(r => server.listen(0, '127.0.0.1', r));
  const sockets = new Set();
  server.on('connection', s => { sockets.add(s); s.on('close', () => sockets.delete(s)); });
  return {
    url: `http://127.0.0.1:${server.address().port}`,
    requests,
    chatRequests: () => requests.filter(r => r.route === '/api/chat' && !r.unload),
    unloadRequests: () => requests.filter(r => r.unload),
    setChat(fn) { chatHandler = fn; },
    setPs(fn) { psHandler = fn; },
    setUnload(fn) { unloadHandler = fn; },
    close: () => new Promise(r => { for (const s of sockets) s.destroy(); server.close(() => r()); }),
  };
}

module.exports = { startFakeOllama, scripted, line, delta, doneLine, DEFAULT_TAGS, GIB };
