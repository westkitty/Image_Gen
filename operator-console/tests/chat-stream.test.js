'use strict';
// POST /api/ollama/chat/stream end to end against a fake NDJSON Ollama (contract D.3/D.4, C-03..C-05, C-07, C-12, C-17, C-18).
// No real model is ever contacted: every upstream URL is the loopback fake.
const test = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const express = require('express');
const { registerChatRoutes } = require('../chat-routes');
const { createChatStreamRunner, NUM_CTX } = require('../chat-stream');
const { createTemporarySessionStore } = require('../chat-sessions');
const { startFakeOllama, scripted, delta, doneLine, line, DEFAULT_TAGS } = require('./fixtures/fake-ollama-ndjson');

const FAST = { headersMs: 300, firstTokenLightMs: 300, firstTokenHeavyMs: 400, idleMs: 300, wallMs: 5000 };
const rid = () => 'cr_' + require('node:crypto').randomBytes(16).toString('hex');

function grantingAdmitter({ verify = null } = {}) {
  const calls = [], releases = [];
  const admit = async (args) => { calls.push(Object.assign({}, args, { signal: undefined, onQueued: undefined })); return { admitted: true, job_id: 'job-chat-test', release: async r => { releases.push(r); }, verifyStop: verify }; };
  return { admit, calls, releases };
}

async function boot({ enabled = true, admit, chat = null, tags, baseUrl, timeouts = FAST, extra = {} } = {}) {
  const fake = await startFakeOllama({ chat, tags });
  const logs = [];
  const app = express(); app.use(express.json({ limit: '5mb' }));
  const server = await new Promise(r => { const s = app.listen(0, '127.0.0.1', () => r(s)); });
  const port = server.address().port;
  const mod = registerChatRoutes(app, Object.assign({
    enabled, ollamaBaseUrl: baseUrl || fake.url, port, log: m => logs.push(m), timeouts, heartbeatMs: 60000,
    guardPolicy: { hosts: [`127.0.0.1:${port}`], origins: [`http://127.0.0.1:${port}`] },
  }, admit ? { admit } : {}, extra));
  const headers = { Origin: `http://127.0.0.1:${port}`, 'X-Dex-Request': '1', 'Content-Type': 'application/json' };
  const request = (method, path, body, { onEvent } = {}) => new Promise((resolve, reject) => {
    const req = http.request({ host: '127.0.0.1', port, path, method, headers: body === undefined ? { Origin: headers.Origin, 'X-Dex-Request': '1' } : headers }, res => {
      let raw = ''; const events = [];
      res.setEncoding('utf8');
      res.on('data', c => {
        raw += c;
        let i;
        while ((i = raw.indexOf('\n\n')) !== -1) {
          const frame = raw.slice(0, i); raw = raw.slice(i + 2);
          const ev = { id: /^id: (.*)$/m.exec(frame)[1], event: /^event: (.*)$/m.exec(frame)[1], data: JSON.parse(/^data: (.*)$/m.exec(frame)[1]) };
          events.push(ev);
          if (onEvent && onEvent(ev, events)) { req.destroy(); res.destroy(); return resolve({ status: res.statusCode, headers: res.headers, events, destroyed: true }); }
        }
      });
      res.on('end', () => {
        const ct = res.headers['content-type'] || '';
        resolve({ status: res.statusCode, headers: res.headers, events, body: ct.includes('json') && raw ? JSON.parse(raw) : null });
      });
      res.on('error', () => {});
    });
    req.on('error', e => (e.code === 'ECONNRESET' ? null : reject(e)));
    if (body !== undefined) req.write(JSON.stringify(body));
    req.end();
  });
  const newSession = async (model) => (await request('POST', '/api/chat/sessions', model ? { model } : {})).body.session_id;
  const send = (session_id, content, more = {}, opts) => request('POST', '/api/ollama/chat/stream', Object.assign({ session_id, request_id: rid(), action: 'send', content }, more), opts);
  return { port, fake, mod, logs, request, newSession, send, close: async () => { server.closeAllConnections(); server.close(); await fake.close(); } };
}
const terminals = evs => evs.filter(e => ['done', 'stopped', 'error'].includes(e.event));
const until = async (fn, ms = 3000) => { const t0 = Date.now(); while (!fn()) { if (Date.now() - t0 > ms) throw new Error('timeout'); await new Promise(r => setTimeout(r, 10)); } };

test('every Chat route is off by default (feature gate)', async () => {
  const h = await boot({ enabled: false }); try {
    for (const [m, p, b] of [['GET', '/api/chat/models'], ['POST', '/api/chat/sessions', {}], ['GET', '/api/chat/sessions/cs_' + '0'.repeat(32)], ['DELETE', '/api/chat/sessions/cs_' + '0'.repeat(32)], ['POST', '/api/ollama/chat/stream', {}]]) {
      const r = await h.request(m, p, b);
      assert.deepEqual([r.status, r.body], [404, { error: 'chat-disabled' }], m + ' ' + p);
    }
    assert.equal(h.fake.requests.length, 0);
  } finally { await h.close(); }
});

test('fail closed: with the default admitter no generation request ever reaches Ollama', async () => {
  const h = await boot({ chat: scripted([{ write: delta('SHOULD-NOT-RUN') }, { write: doneLine() }]) }); try {
    const sid = await h.newSession();
    const r = await h.send(sid, 'hello');
    assert.equal(r.status, 200);
    assert.deepEqual(r.events.map(e => e.event), ['error']);
    assert.equal(r.events[0].data.code, 'compute_unavailable');
    assert.equal(r.events[0].data.job_id, null);
    assert.equal(h.fake.chatRequests().length, 0, 'no /api/chat call without an admission grant');
    const msgs = (await h.request('GET', '/api/chat/sessions/' + sid)).body.messages;
    assert.deepEqual(msgs.map(m => [m.role, m.status]), [['user', 'complete'], ['assistant', 'failed']]);
  } finally { await h.close(); }
});

test('a throwing or malformed admitter also fails closed', async () => {
  for (const admit of [async () => { throw new Error('arbiter down'); }, async () => ({ admitted: 'yes' }), async () => null]) {
    const h = await boot({ admit, chat: scripted([{ write: doneLine() }]) }); try {
      const r = await h.send(await h.newSession(), 'x');
      assert.deepEqual(terminals(r.events).map(e => e.data.code), ['compute_unavailable']);
      assert.equal(h.fake.chatRequests().length, 0);
    } finally { await h.close(); }
  }
});

test('send streams split NDJSON as ordered deltas and one done; upstream gets only server-built fields', async () => {
  const a = grantingAdmitter();
  const body = delta('Hel') + delta('lo, ') + delta('wörld') + doneLine({ eval_count: 3, prompt_eval_count: 9 });
  const bytes = Buffer.from(body);
  const steps = []; for (let i = 0; i < bytes.length; i += 7) steps.push({ write: bytes.subarray(i, i + 7) }, { delay: 1 });
  const h = await boot({ admit: a.admit, chat: scripted(steps) }); try {
    const sid = await h.newSession();
    const r = await h.send(sid, '  hi there  ', { options: { temperature: 0.2, seed: 5 } });
    assert.equal(r.headers['content-type'], 'text/event-stream; charset=utf-8');
    assert.equal(r.headers['cache-control'], 'no-store');
    assert.equal(r.headers['x-accel-buffering'], 'no');
    assert.deepEqual(r.events.map(e => e.event), ['started', 'delta', 'delta', 'delta', 'done']);
    assert.deepEqual(r.events.filter(e => e.event === 'delta').map(e => [e.data.index, e.data.text]), [[0, 'Hel'], [1, 'lo, '], [2, 'wörld']]);
    const done = r.events.at(-1).data;
    assert.equal(done.done_reason, 'stop'); assert.equal(done.eval_count, 3); assert.equal(done.prompt_eval_count, 9); assert.ok(done.total_ms >= 0);
    for (const e of r.events) {
      assert.equal(e.data.v, 'dex.chat.v1'); assert.equal(e.data.session_id, sid); assert.equal(e.data.job_id, 'job-chat-test');
      assert.match(e.data.user_message_id, /^cm_[0-9a-f]{32}$/); assert.match(e.data.assistant_message_id, /^cm_[0-9a-f]{32}$/);
    }
    assert.deepEqual(r.events.map(e => e.id), ['2.0', '2.1', '2.2', '2.3', '2.4']);
    const up = h.fake.chatRequests()[0].body;
    assert.deepEqual(Object.keys(up).sort(), ['keep_alive', 'messages', 'model', 'options', 'stream', 'think']);
    assert.deepEqual([up.model, up.stream, up.think, up.keep_alive], ['gemma3:4b', true, false, 0]);
    assert.deepEqual(up.options, { temperature: 0.2, seed: 5, num_ctx: NUM_CTX });
    assert.deepEqual(up.messages.map(m => m.role), ['system', 'user']);
    assert.equal(up.messages[1].content, 'hi there');
    const s = (await h.request('GET', '/api/chat/sessions/' + sid)).body;
    assert.deepEqual(s.messages.map(m => [m.role, m.status, m.content]), [['user', 'complete', 'hi there'], ['assistant', 'complete', 'Hello, wörld']]);
    assert.equal(s.messages[1].eval_count, 3);
    assert.deepEqual(a.calls, [{ session_id: sid, request_id: r.events[0].data.request_id, model: 'gemma3:4b', resource_class: 'light', operation: 'chat-stream', signal: undefined, onQueued: undefined }]);
    assert.deepEqual(a.releases, [{ outcome: 'done', code: null, stop: null }]);
  } finally { await h.close(); }
});

test('multi-turn: turn 2 carries turn 1 in order and the newest user turn once', async () => {
  const a = grantingAdmitter();
  const h = await boot({ admit: a.admit, chat: scripted([{ write: delta('R') }, { write: doneLine() }]) }); try {
    const sid = await h.newSession();
    await h.send(sid, 'remember BLUE');
    await h.send(sid, 'what colour?');
    const up = h.fake.chatRequests()[1].body.messages;
    assert.deepEqual(up.slice(1), [{ role: 'user', content: 'remember BLUE' }, { role: 'assistant', content: 'R' }, { role: 'user', content: 'what colour?' }]);
    assert.deepEqual((await h.request('GET', '/api/chat/sessions/' + sid)).body.messages.map(m => m.seq), [1, 2, 3, 4]);
  } finally { await h.close(); }
});

test('model selection: allowlisted switch is attributed; unlisted, lookalike and uninstalled models are refused before streaming', async () => {
  const a = grantingAdmitter();
  const tags = DEFAULT_TAGS.filter(t => t.name !== 'hermes-qwen3.8-27b-64k:latest').concat([{ name: 'llama3.2:latest', size: 1 }]);
  const h = await boot({ admit: a.admit, tags, chat: scripted([{ write: delta('ok') }, { write: doneLine() }]) }); try {
    const sid = await h.newSession();
    const r = await h.send(sid, 'q', { model: 'qwen3.8:27b-mlx' });
    assert.equal(r.events[0].data.model, 'qwen3.8:27b-mlx');
    assert.equal(a.calls[0].resource_class, 'heavy');
    assert.equal(h.fake.chatRequests()[0].body.model, 'qwen3.8:27b-mlx');
    for (const [model, code] of [['llama3.2:latest', 'model-not-allowed'], ['gemma3:4b-instruct', 'model-not-allowed'], ['hermes-qwen3.8-27b-64k', 'model-not-allowed'], ['hermes-qwen3.8-27b-64k:latest', 'model-not-installed']]) {
      const x = await h.send(sid, 'q', { model });
      assert.deepEqual([x.status, x.body], [422, { error: code }], model);
    }
    assert.deepEqual((await h.request('POST', '/api/chat/sessions', { model: 'llama3.2:latest' })).body, { error: 'model-not-allowed' });
    const models = (await h.request('GET', '/api/chat/models')).body;
    assert.deepEqual(models.models.map(m => [m.name, m.installed]), [['gemma3:4b', true], ['qwen3.8:27b-mlx', true], ['hermes-qwen3.8-27b-64k:latest', false]]);
    assert.equal(models.default, 'gemma3:4b');
    assert.equal(h.fake.chatRequests().length, 1);
    const msgs = (await h.request('GET', '/api/chat/sessions/' + sid)).body.messages;
    assert.equal(msgs[1].model, 'qwen3.8:27b-mlx');
  } finally { await h.close(); }
});

test('unsafe client-controlled fields and bad options are refused with 400', async () => {
  const a = grantingAdmitter();
  const h = await boot({ admit: a.admit, chat: scripted([{ write: doneLine() }]) }); try {
    const sid = await h.newSession();
    for (const field of ['messages', 'role', 'system', 'tools', 'format', 'template', 'raw', 'keep_alive', 'think', 'stream', 'context', 'images', 'url', 'base_url']) {
      const r = await h.send(sid, 'x', { [field]: field === 'stream' ? false : 'x' });
      assert.deepEqual([r.status, r.body], [400, { error: 'field-not-allowed', field }], field);
    }
    for (const [options, err] of [[{ num_ctx: 65536 }, 'option-not-allowed'], [{ keep_alive: -1 }, 'option-not-allowed'], [{ temperature: 3 }, 'option-out-of-range'], [{ top_p: -0.1 }, 'option-out-of-range'], [{ num_predict: 5000 }, 'option-out-of-range'], [{ num_predict: 1.5 }, 'option-out-of-range'], [{ seed: 'x' }, 'option-out-of-range']]) {
      assert.equal((await h.send(sid, 'x', { options })).body.error, err, JSON.stringify(options));
    }
    assert.equal((await h.send(sid, 'x', { options: [1] })).body.error, 'invalid-options');
    assert.equal((await h.send(sid, '   ')).body.error, 'content-required');
    assert.equal((await h.send(sid, 'x'.repeat(12001))).body.error, 'content-too-long');
    assert.equal((await h.send(sid, 'a\u0000b')).body.error, 'content-invalid');
    assert.equal((await h.send(sid, 'x', { action: 'execute' })).body.error, 'invalid-action');
    assert.equal((await h.send(sid, 'x', { regenerate_of: 'cm_' + '0'.repeat(32) })).body.error, 'field-not-allowed');
    assert.deepEqual((await h.send('cs_' + 'a'.repeat(32), 'x')).status, 404);
    assert.equal((await h.send('../etc', 'x')).body.error, 'invalid-session-id');
    assert.equal((await h.request('POST', '/api/ollama/chat/stream', { session_id: sid, request_id: 'nope', action: 'send', content: 'x' })).body.error, 'invalid-request-id');
    assert.deepEqual((await h.request('POST', '/api/chat/sessions', { mode: 'temporary', consent: true })).body, { error: 'field-not-allowed', field: 'consent' });
    assert.deepEqual((await h.request('POST', '/api/chat/sessions', { mode: 'saved' })).body, { error: 'saved-history-consent-required' });
    assert.deepEqual((await h.request('POST', '/api/chat/sessions', { mode: 'saved', consent: true })).body, { error: 'saved-history-unavailable' });
    assert.equal(h.fake.chatRequests().length, 0);
    assert.equal(a.calls.length, 0);
  } finally { await h.close(); }
});

test('request guard is applied: foreign Host or Origin and a missing X-Dex-Request are refused before any work', async () => {
  const a = grantingAdmitter();
  const h = await boot({ admit: a.admit }); try {
    const raw = (headers) => new Promise((resolve, reject) => {
      const req = http.request({ host: '127.0.0.1', port: h.port, path: '/api/ollama/chat/stream', method: 'POST', headers: Object.assign({ 'Content-Type': 'application/json' }, headers) }, res => { let d = ''; res.on('data', c => { d += c; }); res.on('end', () => resolve([res.statusCode, JSON.parse(d)])); });
      req.on('error', reject); req.end('{}');
    });
    const ok = { Origin: `http://127.0.0.1:${h.port}`, 'X-Dex-Request': '1' };
    assert.deepEqual(await raw(Object.assign({}, ok, { Host: 'rebind.example:' + h.port })), [403, { error: 'host-not-allowed' }]);
    assert.deepEqual(await raw(Object.assign({}, ok, { Origin: 'https://evil.example' })), [403, { error: 'origin-not-allowed' }]);
    assert.deepEqual(await raw({ Origin: ok.Origin }), [403, { error: 'request-header-required' }]);
    assert.equal(h.fake.requests.length, 0);
    assert.equal(a.calls.length, 0);
  } finally { await h.close(); }
});

test('malformed upstream line -> error parse_error; the partial reply is failed and excluded from the next context', async () => {
  const a = grantingAdmitter();
  const h = await boot({ admit: a.admit, chat: scripted([{ write: delta('PART') }, { write: '{"message":{"content":"x"' + '\n' }, { write: doneLine() }]) }); try {
    const sid = await h.newSession();
    const r = await h.send(sid, 'q');
    assert.deepEqual(r.events.map(e => e.event), ['started', 'delta', 'error']);
    assert.deepEqual([r.events.at(-1).data.code, r.events.at(-1).data.partial_chars], ['parse_error', 4]);
    h.fake.setChat(scripted([{ write: doneLine() }]));
    await h.send(sid, 'q2');
    assert.ok(!JSON.stringify(h.fake.chatRequests()[1].body.messages).includes('PART'));
    const msgs = (await h.request('GET', '/api/chat/sessions/' + sid)).body.messages;
    assert.deepEqual(msgs.map(m => m.status), ['complete', 'failed', 'complete', 'complete']);
    assert.equal(a.releases[0].outcome, 'error');
  } finally { await h.close(); }
});

test('premature EOF, upstream error line, HTTP error and an oversized line are never reported as done', async () => {
  const cases = [
    [[{ write: delta('a') }, { write: delta('b') }], 'upstream_closed_early'],
    [[{ write: delta('a') }, { destroy: true }], null],
    [[{ write: delta('a') }, { write: line({ error: 'model runner crashed' }) }], 'upstream_error'],
    [[{ write: delta('a') + '{"message":{"content":"' + 'x'.repeat(1024 * 1024 + 10) }], 'parse_error'],
  ];
  for (const [steps, code] of cases) {
    const h = await boot({ admit: grantingAdmitter().admit, chat: scripted(steps) }); try {
      const sid = await h.newSession();
      const r = await h.send(sid, 'q');
      const t = terminals(r.events);
      assert.equal(t.length, 1);
      assert.equal(t[0].event, 'error');
      if (code) assert.equal(t[0].data.code, code);
      else assert.ok(['upstream_closed_early', 'upstream_error'].includes(t[0].data.code), t[0].data.code);
      assert.equal((await h.request('GET', '/api/chat/sessions/' + sid)).body.messages[1].status, 'failed');
    } finally { await h.close(); }
  }
  const h = await boot({ admit: grantingAdmitter().admit, chat: scripted([{ write: '{"error":"x"}\n' }], { status: 500 }) }); try {
    const r = await h.send(await h.newSession(), 'q');
    assert.deepEqual(r.events.map(e => [e.event, e.data.code]), [['error', 'upstream_error']]);
  } finally { await h.close(); }
});

test('timeouts: headers, first token and idle each end in a distinct error and abort the upstream', async () => {
  const cases = [
    [async (b, req, res, st) => { await st.abortedPromise; }, 'upstream_timeout'],
    [scripted([{ waitAbort: true }]), 'first_token_timeout'],
    [scripted([{ write: delta('a') }, { waitAbort: true }]), 'idle_timeout'],
  ];
  for (const [chat, code] of cases) {
    const h = await boot({ admit: grantingAdmitter().admit, chat }); try {
      const r = await h.send(await h.newSession(), 'q');
      assert.deepEqual(terminals(r.events).map(e => [e.event, e.data.code]), [['error', code]]);
      await until(() => h.fake.chatRequests()[0].aborted);
    } finally { await h.close(); }
  }
  const h = await boot({ admit: grantingAdmitter().admit, timeouts: Object.assign({}, FAST, { idleMs: 1000, wallMs: 250 }), chat: scripted([{ write: delta('a') }, { delay: 100 }, { write: delta('b') }, { waitAbort: true }]) }); try {
    const r = await h.send(await h.newSession(), 'q');
    assert.deepEqual(terminals(r.events).map(e => e.data.code), ['upstream_timeout']);
  } finally { await h.close(); }
});

test('client disconnect mid-stream aborts the upstream and records stopped/client_disconnected; the lease is released after', async () => {
  const a = grantingAdmitter();
  const h = await boot({ admit: a.admit, timeouts: Object.assign({}, FAST, { idleMs: 5000 }), chat: scripted([{ write: delta('one') }, { waitAbort: true }]) }); try {
    const sid = await h.newSession();
    const r = await h.send(sid, 'q', {}, { onEvent: ev => ev.event === 'delta' });
    assert.ok(r.destroyed);
    await until(() => h.fake.chatRequests()[0].aborted);
    await until(() => a.releases.length === 1);
    assert.deepEqual(a.releases[0], { outcome: 'stopped', code: null, stop: 'unverified' });
    const m = (await h.request('GET', '/api/chat/sessions/' + sid)).body.messages[1];
    assert.deepEqual([m.status, m.content], ['stopped', 'one']);
    assert.equal(h.mod.runner.activeCount(), 0);
  } finally { await h.close(); }
});

test('internal stop hook: stopped is unverified unless the lease proves it; exactly one terminal', async () => {
  for (const [verify, expected] of [[null, 'unverified'], [async () => 'verified', 'verified'], [async () => { throw new Error('ps failed'); }, 'unverified']]) {
    const a = grantingAdmitter({ verify });
    const h = await boot({ admit: a.admit, timeouts: Object.assign({}, FAST, { idleMs: 5000 }), chat: scripted([{ write: delta('x') }, { waitAbort: true }]) }); try {
      const sid = await h.newSession();
      const r = await h.send(sid, 'q', {}, { onEvent: (ev) => { if (ev.event === 'delta') h.mod.runner.stop(ev.data.request_id); return false; } });
      assert.deepEqual(terminals(r.events).map(e => [e.event, e.data.stop, e.data.reason, e.data.partial_chars]), [['stopped', expected, 'user', 1]]);
      assert.equal((await h.request('GET', '/api/chat/sessions/' + sid)).body.messages[1].status, 'stopped');
      assert.equal(h.mod.runner.stop('cr_' + '0'.repeat(32)), false);
    } finally { await h.close(); }
  }
});

test('lines after done never produce a second terminal, and thinking text is never surfaced', async () => {
  const h = await boot({ admit: grantingAdmitter().admit, chat: scripted([{ write: line({ message: { role: 'assistant', content: '', thinking: 'SECRET-THOUGHT' }, done: false }) }, { write: delta('A') }, { write: doneLine() }, { write: delta('AFTER') }, { write: line({ error: 'late' }) }]) }); try {
    const r = await h.send(await h.newSession(), 'q');
    assert.deepEqual(r.events.map(e => e.event), ['started', 'delta', 'done']);
    assert.ok(!JSON.stringify(r.events).includes('SECRET-THOUGHT'));
  } finally { await h.close(); }
});

test('regenerate creates a new variant of the last reply only, using the selected model', async () => {
  const a = grantingAdmitter();
  const h = await boot({ admit: a.admit, chat: scripted([{ write: delta('first') }, { write: doneLine() }]) }); try {
    const sid = await h.newSession();
    const r1 = await h.send(sid, 'q');
    const target = r1.events[0].data.assistant_message_id;
    h.fake.setChat(scripted([{ write: delta('second') }, { write: doneLine() }]));
    const r2 = await h.request('POST', '/api/ollama/chat/stream', { session_id: sid, request_id: rid(), action: 'regenerate', regenerate_of: target, model: 'qwen3.8:27b-mlx' });
    assert.equal(r2.events.at(-1).event, 'done');
    assert.equal(r2.events[0].data.user_message_id, r1.events[0].data.user_message_id);
    assert.notEqual(r2.events[0].data.assistant_message_id, target);
    assert.deepEqual(h.fake.chatRequests()[1].body.messages.slice(1), [{ role: 'user', content: 'q' }]);
    const msgs = (await h.request('GET', '/api/chat/sessions/' + sid)).body.messages;
    assert.deepEqual(msgs.filter(m => m.role === 'assistant').map(m => [m.variant, m.model, m.content]), [[0, 'gemma3:4b', 'first'], [1, 'qwen3.8:27b-mlx', 'second']]);
    const stale = await h.request('POST', '/api/ollama/chat/stream', { session_id: sid, request_id: rid(), action: 'regenerate', regenerate_of: target });
    assert.deepEqual([stale.status, stale.body], [409, { error: 'not-last-assistant-message' }]);
  } finally { await h.close(); }
});

test('duplicate request_id and a second concurrent request are refused with 409, never generating twice', async () => {
  const a = grantingAdmitter();
  const h = await boot({ admit: a.admit, timeouts: Object.assign({}, FAST, { idleMs: 5000 }), chat: scripted([{ write: delta('x') }, { delay: 200 }, { write: doneLine() }]) }); try {
    const sid = await h.newSession();
    const id = rid();
    const first = h.send(sid, 'q', { request_id: id });
    await until(() => h.fake.chatRequests().length === 1);
    const busy = await h.send(sid, 'other');
    assert.deepEqual([busy.status, busy.body], [409, { error: 'session-busy' }]);
    const dupRunning = await h.send(sid, 'q', { request_id: id });
    assert.equal(dupRunning.body.error, 'duplicate-request'); assert.equal(dupRunning.body.request_status, 'running');
    await first;
    const dupDone = await h.send(sid, 'q', { request_id: id });
    assert.deepEqual([dupDone.status, dupDone.body.request_status], [409, 'complete']);
    assert.equal(h.fake.chatRequests().length, 1);
    assert.equal((await h.request('DELETE', '/api/chat/sessions/' + sid)).status, 204);
    assert.equal((await h.request('GET', '/api/chat/sessions/' + sid)).status, 404);
  } finally { await h.close(); }
});

test('a non-loopback Ollama base URL or an unreachable Ollama is refused before streaming', async () => {
  const a = grantingAdmitter();
  const h = await boot({ admit: a.admit, baseUrl: 'https://ollama.example.com' }); try {
    const sid = await h.newSession();
    assert.deepEqual((await h.send(sid, 'q')).body, { error: 'loopback-required' });
    assert.deepEqual((await h.request('GET', '/api/chat/models')).body, { error: 'loopback-required' });
  } finally { await h.close(); }
  const h2 = await boot({ admit: a.admit, baseUrl: 'http://127.0.0.1:9' }); try {
    const r = await h2.send(await h2.newSession(), 'q');
    assert.deepEqual([r.status, r.body], [503, { error: 'ollama-unreachable' }]);
  } finally { await h2.close(); }
  assert.equal(a.calls.length, 0);
});

test('queued events from the admitter are framed before started', async () => {
  const admit = async ({ onQueued }) => { onQueued(1, 'heavy-lease'); onQueued(0, 'external'); return { admitted: true, job_id: 'job-q', release: async () => {} }; };
  const h = await boot({ admit, chat: scripted([{ write: doneLine() }]) }); try {
    const r = await h.send(await h.newSession(), 'q');
    assert.deepEqual(r.events.map(e => [e.event, e.data.position, e.data.blocked_reason]), [['queued', 1, 'heavy-lease'], ['queued', 0, 'external'], ['started', undefined, undefined], ['done', undefined, undefined]]);
    assert.equal(r.events[0].data.job_id, null, 'job id is only known once admitted');
  } finally { await h.close(); }
});

test('privacy canary: chat text never reaches logs, the admitter, release records or console output', async () => {
  const CANARY = 'CHATCANARY-' + Date.now();
  const a = grantingAdmitter();
  const seen = [];
  const orig = { log: console.log, error: console.error, warn: console.warn, info: console.info };
  for (const k of Object.keys(orig)) console[k] = (...args) => { seen.push(args.join(' ')); };
  const h = await boot({ admit: a.admit, chat: scripted([{ write: delta('reply ' + CANARY) }, { write: doneLine() }]) });
  try {
    const sid = await h.newSession();
    await h.send(sid, 'secret ' + CANARY);
    h.fake.setChat(scripted([{ write: delta(CANARY) }, { write: '{bad\n' }]));
    await h.send(sid, 'again ' + CANARY);
  } finally {
    Object.assign(console, orig);
    await h.close();
  }
  assert.ok(h.logs.length >= 2);
  for (const [name, blob] of [['logs', h.logs], ['admit calls', a.calls], ['releases', a.releases], ['console', seen]]) {
    assert.ok(!JSON.stringify(blob).includes(CANARY), name + ' leaked chat text');
  }
});

test('backpressure: the next upstream chunk is not read until the client drains; an undrained client is a disconnect', async () => {
  const { EventEmitter } = require('node:events');
  let pulls = 0;
  const chunks = [delta('a'), delta('b'), delta('c'), doneLine()].map(s => Buffer.from(s));
  const fetchImpl = async () => new Response(new ReadableStream({ pull(c) { pulls++; const x = chunks.shift(); if (x) c.enqueue(x); else c.close(); } }, { highWaterMark: 0 }), { status: 200 });
  const store = createTemporarySessionStore();
  const sid = store.create({ model: 'gemma3:4b' }).session.session_id;
  const turn = store.beginSend(sid, { request_id: rid(), content: 'q' }).turn;
  const res = Object.assign(new EventEmitter(), { writes: [], writableLength: 0, writableNeedDrain: false, destroyed: false, writableEnded: false,
    writeHead() {}, write(s) { this.writes.push(s); this.writableNeedDrain = true; return false; }, end() { this.writableEnded = true; }, destroy() { this.destroyed = true; this.emit('close'); } });
  const releases = [];
  const runner = createChatStreamRunner({ fetchImpl, baseUrl: 'http://127.0.0.1:1', admit: async () => ({ admitted: true, job_id: 'j', release: async r => releases.push(r) }), timeouts: FAST, undrainedMs: 150 });
  const done = runner.run({ res, store, turn, resourceClass: 'light' });
  await until(() => res.writes.some(w => w.includes('event: delta')));
  const pullsAtStall = pulls;
  await new Promise(r => setTimeout(r, 60));
  assert.equal(pulls, pullsAtStall, 'no upstream read while the client buffer is full');
  res.writableNeedDrain = false; res.emit('drain');
  await until(() => res.writes.filter(w => w.includes('event: delta')).length === 2);
  assert.ok(pulls > pullsAtStall);
  // Never drain again: after undrainedMs the stream is treated as a client disconnect.
  assert.equal(await done, 'stopped');
  assert.ok(res.destroyed);
  assert.equal(store.get(sid).session.messages[1].status, 'stopped');
  assert.deepEqual(releases, [{ outcome: 'stopped', code: null, stop: 'unverified' }]);
});
