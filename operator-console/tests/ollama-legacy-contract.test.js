'use strict';
// Boots the real server.js against a loopback fake Ollama and freezes the legacy Ollama consumers (contract D.1, C-10, C-11):
// GET /api/ollama/status, POST /api/ollama/enhance, POST /api/ollama/chat and the Drama LLM parse keep their exact success
// shapes. AUTH-6 changes, asserted here explicitly: allowlisted models only, gemma3:4b default, keep_alive 0, no download
// advice. The new stream route is off by default and, when switched on, runs only under the shared Big Mac lease.
// Isolation: temp state/images/media dirs, a PATH-first `ssh` stub that reports an explicit empty Ollama load for the arbiter,
// no real Ollama, no model is ever loaded.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const net = require('node:net');
const http = require('node:http');
const { spawn } = require('node:child_process');
const { startFakeOllama, DEFAULT_TAGS, delta, doneLine } = require('./fixtures/fake-ollama-ndjson');

const SERVER_DIR = path.join(__dirname, '..');
const ENHANCED = JSON.stringify({ enhanced_prompt: 'a red fox in snow, soft light', negative_prompt: '', setting_suggestions: {}, notes: [] });

const freePort = () => new Promise((resolve, reject) => { const s = net.createServer(); s.listen(0, '127.0.0.1', () => { const p = s.address().port; s.close(() => resolve(p)); }); s.on('error', reject); });

function legacyChat(body, req, res) {
  // Legacy requests remain non-streaming; the separate Chat test receives an actual terminal NDJSON frame.
  if (body && body.stream === true) {
    res.writeHead(200, { 'Content-Type': 'application/x-ndjson' });
    return res.end(delta('reply') + doneLine());
  }
  res.writeHead(200, { 'Content-Type': 'application/json' });
  const content = body && body.format === 'json' ? 'not json at all' : ENHANCED;
  res.end(JSON.stringify({ model: body && body.model, message: { role: 'assistant', content: '  ' + content + '  ' }, done: true }));
}

async function bootServer(fake, extraEnv = {}) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'dex-ollama-legacy-'));
  const bin = path.join(root, 'bin'); fs.mkdirSync(bin);
  fs.writeFileSync(path.join(bin, 'ssh'), '#!/bin/sh\ncase "$*" in\n  *"ollama ps"*) printf "NAME ID SIZE PROCESSOR UNTIL\\nPROBE_DONE:0\\n";;\n  *) exit 255;;\nesac\n', { mode: 0o755 });
  for (const d of ['state', 'images', 'media']) fs.mkdirSync(path.join(root, d));
  const port = await freePort();
  const env = Object.assign({}, process.env, {
    PATH: bin + path.delimiter + process.env.PATH, OPERATOR_CONSOLE_PORT: String(port), OLLAMA_BASE_URL: fake.url,
    DEX_STATE_DIR: path.join(root, 'state'), DEX_IMAGES_ROOT_OVERRIDE: path.join(root, 'images'), DEX_MEDIA_ROOT_OVERRIDE: path.join(root, 'media'),
  }, extraEnv);
  delete env.OLLAMA_HOST;
  if (!('DEX_CHAT_ENABLED' in extraEnv)) delete env.DEX_CHAT_ENABLED;
  const child = spawn(process.execPath, ['server.js'], { cwd: SERVER_DIR, env, stdio: ['ignore', 'pipe', 'pipe'] });
  let output = '';
  child.stdout.on('data', c => { output += c; }); child.stderr.on('data', c => { output += c; });
  const exited = new Promise(r => child.on('exit', r));
  const t0 = Date.now();
  for (;;) {
    try { const r = await fetch(`http://127.0.0.1:${port}/api/version`); if (r.ok) break; } catch (_) {}
    if (child.exitCode !== null) throw new Error('server exited: ' + output.slice(-2000));
    if (Date.now() - t0 > 60000) throw new Error('server did not start: ' + output.slice(-2000));
    await new Promise(r => setTimeout(r, 100));
  }
  const request = (method, p, body, headers = {}) => new Promise((resolve, reject) => {
    const h = Object.assign(body === undefined ? {} : { 'Content-Type': 'application/json' }, headers);
    const req = http.request({ host: '127.0.0.1', port, path: p, method, headers: h }, res => {
      let raw = ''; res.setEncoding('utf8'); res.on('data', c => { raw += c; });
      res.on('end', () => resolve({ status: res.statusCode, headers: res.headers, raw, body: (res.headers['content-type'] || '').includes('json') && raw ? JSON.parse(raw) : null }));
    });
    req.on('error', reject); if (body !== undefined) req.write(JSON.stringify(body)); req.end();
  });
  const stop = async () => { child.kill('SIGTERM'); await Promise.race([exited, new Promise(r => setTimeout(r, 5000))]); if (child.exitCode === null) child.kill('SIGKILL'); fs.rmSync(root, { recursive: true, force: true }); };
  return { port, request, stop, output: () => output };
}

test('legacy Ollama routes and the Drama LLM consumer keep their exact shapes; the stream route is off by default', { timeout: 120000 }, async () => {
  const tags = DEFAULT_TAGS.map(t => Object.assign({ digest: 'sha256:x', details: { family: 'f' } }, t));
  const fake = await startFakeOllama({ tags, chat: legacyChat });
  const s = await bootServer(fake);
  try {
    const status = await s.request('GET', '/api/ollama/status');
    assert.equal(status.status, 200);
    assert.deepEqual(status.body, { baseUrl: fake.url, models: DEFAULT_TAGS.map(t => ({ name: t.name, modified_at: t.modified_at, size: t.size })) });

    assert.deepEqual(await s.request('POST', '/api/ollama/chat', {}).then(r => [r.status, r.body]), [400, { error: 'Message is required' }]);
    assert.deepEqual(await s.request('POST', '/api/ollama/chat', { message: 'x'.repeat(12001) }).then(r => [r.status, r.body]), [400, { error: 'Message is too long' }]);
    assert.deepEqual(await s.request('POST', '/api/ollama/chat', { message: 'hi', model: 'nope:1b' }).then(r => [r.status, r.body]), [503, { error: 'Model "nope:1b" is not on the approved local model list' }]);
    const chat = await s.request('POST', '/api/ollama/chat', { message: '  hello  ' });
    assert.equal(chat.status, 200);
    assert.deepEqual(Object.keys(chat.body), ['model', 'reply']);
    assert.deepEqual(chat.body, { model: 'gemma3:4b', reply: ENHANCED }, 'AUTH-6 default is gemma3:4b (not names[0]); the reply is trimmed');
    assert.deepEqual(fake.chatRequests().at(-1).body, { model: 'gemma3:4b', stream: false, keep_alive: 0, messages: [{ role: 'user', content: 'hello' }] });

    assert.deepEqual(await s.request('POST', '/api/ollama/enhance', { prompt: ' ' }).then(r => [r.status, r.body]), [400, { error: 'Prompt is required' }]);
    assert.deepEqual(await s.request('POST', '/api/ollama/enhance', { prompt: 'x'.repeat(12001) }).then(r => [r.status, r.body]), [400, { error: 'Prompt is too long' }]);
    const enh = await s.request('POST', '/api/ollama/enhance', { prompt: 'a red fox', model: 'gemma3:4b', target: 'flux2-klein-4b', mode: 'balanced' });
    assert.equal(enh.status, 200, enh.raw);
    assert.deepEqual(Object.keys(enh.body), ['ok', 'model', 'prompt', 'enhanced_prompt', 'original_prompt', 'negative_prompt', 'setting_suggestions', 'notes', 'profile', 'mode']);
    assert.equal(enh.body.model, 'gemma3:4b');
    const enhUp = fake.chatRequests().at(-1).body;
    assert.deepEqual([enhUp.model, enhUp.stream, enhUp.keep_alive], ['gemma3:4b', false, 0]);

    const det = await s.request('POST', '/api/drama/parse', { script: 'TIGER: Hello there.', mode: 'deterministic' });
    assert.equal(det.status, 200); assert.equal(det.body.mode, 'deterministic');
    const llm = await s.request('POST', '/api/drama/parse', { script: 'TIGER: Hello there.', mode: 'llm' });
    assert.deepEqual([llm.status, llm.body.ok, llm.body.errors], [422, false, ['the model did not return valid JSON']]);
    const dramaUp = fake.chatRequests().at(-1).body;
    assert.deepEqual([dramaUp.model, dramaUp.format, dramaUp.stream, dramaUp.keep_alive], ['gemma3:4b', 'json', false, 0]);
    // Every legacy generation ran as a lease-holding job whose cleanup (unload + sustained absence) was proven;
    // cleanup finishes after the response, so wait for the last one.
    const t0 = Date.now();
    let ops;
    for (;;) {
      const workers = (await s.request('GET', '/api/remote-workers')).body;
      ops = workers.workers.filter(w => w.action === 'ollama-chat');
      if (ops.length === fake.chatRequests().length && ops.every(w => w.state === 'completed') && workers.quarantine === null) break;
      if (Date.now() - t0 > 20000) throw new Error('legacy cleanup not verified: ' + JSON.stringify(ops.map(w => w.state)));
      await new Promise(res => setTimeout(res, 200));
    }
    assert.equal(fake.unloadRequests().length, fake.chatRequests().length);
    assert.equal((await s.request('GET', '/api/resources')).body.owner, null);

    for (const [m, p, b] of [['POST', '/api/ollama/chat/stream', { session_id: 'x' }], ['POST', '/api/chat/sessions', {}], ['GET', '/api/chat/models']]) {
      assert.deepEqual(await s.request(m, p, b).then(r => [r.status, r.body]), [404, { error: 'chat-disabled' }], p);
    }
    assert.ok(fake.chatRequests().every(r => r.body.stream !== true), 'no streaming generation from the legacy surface');

    await fake.close();
    const down = await s.request('GET', '/api/ollama/status');
    assert.equal(down.status, 502);
    assert.deepEqual(Object.keys(down.body), ['error', 'baseUrl']);
    assert.equal(down.body.baseUrl, fake.url);
  } finally { await s.stop(); await fake.close(); }
});

test('with DEX_CHAT_ENABLED=1 the real server streams only under the shared lease, with verified cleanup and no chat text logged', { timeout: 120000 }, async () => {
  const CANARY = 'LEGACYCANARY-' + Date.now();
  const fake = await startFakeOllama({ chat: legacyChat });
  const s = await bootServer(fake, { DEX_CHAT_ENABLED: '1' });
  // Off-by-default is proven by the first test; this one switches it on against the fake only.
  try {
    const guard = { Origin: `http://127.0.0.1:${s.port}`, 'X-Dex-Request': '1' };
    assert.equal((await s.request('POST', '/api/chat/sessions', {})).status, 403, 'guard is live on the real server');
    const created = await s.request('POST', '/api/chat/sessions', {}, guard);
    assert.equal(created.status, 201);
    assert.deepEqual(Object.keys(created.body), ['session_id', 'mode', 'model', 'created_at']);
    const r = await s.request('POST', '/api/ollama/chat/stream', { session_id: created.body.session_id, request_id: 'cr_' + 'a'.repeat(32), action: 'send', content: 'tell me ' + CANARY }, guard);
    assert.equal(r.status, 200);
    assert.equal(r.headers['content-type'], 'text/event-stream; charset=utf-8');
    const events = r.raw.trim().split('\n\n').map(f => /^event: (.*)$/m.exec(f)[1]);
    // A leading `queued` is legitimate while the arbiter's first external-Ollama observation is still pending after boot;
    // what this test proves is that nothing streams before `started`, the lease grant.
    assert.deepEqual(events.filter(e => e !== 'queued'), ['started', 'delta', 'done']);
    assert.ok(events.indexOf('started') === events.lastIndexOf('queued') + 1 || !events.includes('queued'), 'queued events only precede started');
    const jobId = /"job_id":"([^"]+)"/.exec(r.raw)[1];
    assert.equal(fake.chatRequests().length, 1);
    assert.equal(fake.chatRequests()[0].body.keep_alive, 0);
    const t0 = Date.now();
    let rec;
    for (;;) {
      rec = (await s.request('GET', '/api/remote-workers')).body.workers.find(w => w.job_id === jobId);
      if (rec && rec.state === 'completed') break;
      if (Date.now() - t0 > 20000) throw new Error('cleanup not verified: ' + JSON.stringify(rec));
      await new Promise(res => setTimeout(res, 200));
    }
    assert.equal(fake.unloadRequests().length, 1);
    assert.equal((await s.request('GET', '/api/resources')).body.owner, null, 'lease released only after verified cleanup');
    assert.equal((await s.request('GET', '/api/chat/models')).body.default, 'gemma3:4b');
    assert.ok(!s.output().includes(CANARY), 'chat text must not reach server output');
    assert.match(s.output(), /chat-stream cr_a{32} done/);
  } finally { await s.stop(); await fake.close(); }
});
