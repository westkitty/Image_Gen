'use strict';
// AUTH-6: Enhance, legacy /api/ollama/chat and the Drama LLM parse share the Big Mac lease with image and Chat jobs,
// generate only into a CLEAR Ollama with keep_alive 0, and keep the lease until model cleanup is verified.
// Real arbiter, job store, remote-worker registry, reconciler and cancellation manager; fake loopback Ollama only.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const http = require('node:http');
const express = require('express');
const { enhancePrompt } = require('../prompt-enhancement');
const Legacy = require('../ollama-legacy');
const { chatRig, until, terminals } = require('./helpers/chat-rig');
const { scripted, delta, doneLine } = require('./fixtures/fake-ollama-ndjson');

const ENHANCED = JSON.stringify({ enhanced_prompt: 'a red fox in snow, soft light', negative_prompt: '', setting_suggestions: {}, notes: [] });
const WAIT = 120;

// Non-streaming fake: Enhance gets valid enhancement JSON, Drama gets a JSON object, legacy chat gets text.
function jsonChat(content = null, { hold = null } = {}) {
  return async (body, req, res, st) => {
    if (hold) await Promise.race([hold, st.abortedPromise]);
    if (st.aborted) return;
    res.writeHead(200, { 'Content-Type': 'application/json' });
    const text = content !== null ? content : body.format === 'json' ? '{"scenes":[]}' : body.messages[0].role === 'system' ? ENHANCED : 'plain reply';
    res.end(JSON.stringify({ model: body.model, message: { role: 'assistant', content: '  ' + text + '  ' }, done: true }));
  };
}

async function legacyRig({ waitMs = WAIT, ...opts } = {}) {
  const r = await chatRig(Object.assign({ chat: jsonChat() }, opts));
  const ollamaRequest = Legacy.createOllamaRequest(r.fake.url);
  const resolveModel = Legacy.createModelResolver(ollamaRequest);
  const app = express(); app.use(express.json());
  Legacy.registerLegacyOllamaRoutes(app, { ollamaRequest, resolveModel, runPromptEnhance: enhancePrompt, getCompute: () => r.compute, waitMs });
  const llmChat = Legacy.createLegacyLlmChat({ ollamaRequest, resolveModel, getCompute: () => r.compute, waitMs });
  const server = await new Promise(res => { const x = app.listen(0, '127.0.0.1', () => res(x)); });
  const port = server.address().port;
  const post = (p, body, { abortAfterMs } = {}) => new Promise((resolve, reject) => {
    const req = http.request({ host: '127.0.0.1', port, path: p, method: 'POST', headers: { 'Content-Type': 'application/json' } }, res => {
      let raw = ''; res.on('data', c => { raw += c; }); res.on('end', () => resolve({ status: res.statusCode, body: raw ? JSON.parse(raw) : null }));
    });
    req.on('error', e => (e.code === 'ECONNRESET' ? resolve({ destroyed: true }) : reject(e)));
    req.end(JSON.stringify(body));
    if (abortAfterMs) setTimeout(() => { req.destroy(); resolve({ destroyed: true }); }, abortAfterMs);
  });
  const legacyJobs = () => r.jobStore.list({ media_kind: 'chat' });
  const closeAll = async () => { server.closeAllConnections(); server.close(); await r.close(); };
  return Object.assign(r, { post, llmChat, legacyJobs, closeAll });
}

const CALLERS = {
  enhance: h => h.post('/api/ollama/enhance', { prompt: 'a red fox' }),
  'chat-legacy': h => h.post('/api/ollama/chat', { message: 'hello' }),
  'drama-parse': h => h.llmChat([{ role: 'system', content: 's' }, { role: 'user', content: 'TIGER: Hi.' }]).then(v => ({ status: 200, body: v }), e => ({ status: 'thrown', body: e.message })),
};

for (const [op, call] of Object.entries(CALLERS)) {
  test(`${op}: queues behind a heavy image job, runs after it, and keeps the lease until cleanup is verified`, async () => {
    let releaseUnload;
    const unloadGate = new Promise(res => { releaseUnload = res; });
    const h = await legacyRig({ unload: async () => { await unloadGate; return { status: 200, json: { done_reason: 'unload', done: true } }; } });
    try {
      await h.arbiter.acquire('img-1', 'flux txt2img');
      const p = call(h);
      await until(() => h.arbiter.state().waiting.length === 1);
      assert.equal(h.fake.chatRequests().length, 0, 'no Ollama generation while the image job owns Big Mac');
      h.arbiter.release('img-1');
      const out = await p;
      assert.equal(out.status, 200, JSON.stringify(out.body));
      if (op === 'enhance') assert.deepEqual(Object.keys(out.body), ['ok', 'model', 'prompt', 'enhanced_prompt', 'original_prompt', 'negative_prompt', 'setting_suggestions', 'notes', 'profile', 'mode']);
      if (op === 'chat-legacy') assert.deepEqual(out.body, { model: 'gemma3:4b', reply: 'plain reply' });
      if (op === 'drama-parse') assert.equal(out.body.trim(), '{"scenes":[]}');
      const up = h.fake.chatRequests()[0].body;
      assert.deepEqual([up.model, up.stream, up.keep_alive], ['gemma3:4b', false, 0], 'allowlisted default, owned request unloads');
      const [job] = h.legacyJobs();
      assert.deepEqual([job.operation, job.model_id, job.worker_id], [op, 'gemma3:4b', 'ollama']);
      // Answered, but compute is still owned until the unload is proven.
      await until(() => h.fake.unloadRequests().length === 1);
      assert.equal(h.arbiter.state().owner.job_id, job.job_id);
      const img2 = h.arbiter.acquire('img-2', 'flux');
      await new Promise(res => setTimeout(res, 20));
      assert.equal(h.arbiter.holds('img-2'), false, 'the next image waits for verified cleanup');
      releaseUnload();
      assert.equal((await img2).granted, true);
      assert.equal(h.jobStore.get(job.job_id).status, 'COMPLETE');
      assert.equal(h.remoteWorkers.get(job.job_id).state, 'completed');
    } finally { await h.closeAll(); }
  });

  test(`${op}: an image job holding Big Mac past the bounded wait gives the compute-busy refusal and leaves no waiter`, async () => {
    const h = await legacyRig();
    try {
      await h.arbiter.acquire('img-1', 'flux');
      const out = await call(h);
      if (op === 'drama-parse') assert.deepEqual(out, { status: 'thrown', body: 'Big Mac compute is busy' });
      else assert.deepEqual(out, { status: 503, body: { error: 'Big Mac compute is busy', gate: 'compute-busy' } });
      assert.equal(h.arbiter.state().waiting.length, 0);
      assert.equal(h.arbiter.state().owner.job_id, 'img-1');
      assert.equal(h.fake.chatRequests().length, 0);
      const [job] = h.legacyJobs();
      assert.deepEqual([job.status, job.first_failed_gate], ['CANCELLED', 'resource-wait']);
    } finally { await h.closeAll(); }
  });

  test(`${op}: an externally loaded model or an unreadable Ollama refuses admission and is never unloaded`, async () => {
    for (const ps of [() => ({ status: 200, json: { models: [{ name: 'hermes-qwen3.8-27b-64k:latest' }] } }), () => ({ status: 500, json: {} })]) {
      const h = await legacyRig({ ps });
      try {
        const out = await call(h);
        assert.ok(out.status === 503 || out.status === 'thrown', JSON.stringify(out));
        assert.equal(h.fake.chatRequests().length, 0);
        assert.equal(h.fake.unloadRequests().length, 0);
        assert.equal(h.arbiter.state().owner, null);
        assert.equal(h.remoteWorkers.quarantineReason(), null);
      } finally { await h.closeAll(); }
    }
  });

  test(`${op}: unconfirmed cleanup keeps the lease and quarantines heavy work until reconciliation`, async () => {
    const h = await legacyRig({ unload: () => ({ status: 500, json: { error: 'x' } }) });
    try {
      const out = await call(h);
      assert.equal(out.status, 200, 'the caller still gets its successful answer');
      const [job] = h.legacyJobs();
      await until(() => h.remoteWorkers.get(job.job_id).state === 'stop_unverified');
      assert.equal(h.jobStore.get(job.job_id).status, 'RUNNING');
      assert.equal(h.arbiter.state().owner.job_id, job.job_id);
      assert.ok(h.remoteWorkers.quarantineReason());
      const img = h.arbiter.acquire('img-1', 'flux');
      // Reconciliation is periodic (every 30 s in production): one tick needs two successful /api/ps reads settleMs apart
      // inside a short budget, which a loaded machine can miss. Tick a bounded number of times; until it verifies, every
      // tick must leave the quarantine, the lease and the waiting image exactly as they were (fail-closed).
      for (let i = 0; i < 5 && h.remoteWorkers.get(job.job_id).state !== 'cancelled_verified'; i++) {
        await h.reconciler.tick();
        if (h.remoteWorkers.get(job.job_id).state !== 'cancelled_verified') {
          assert.equal(h.remoteWorkers.get(job.job_id).state, 'stop_unverified');
          assert.equal(h.arbiter.state().owner.job_id, job.job_id);
          assert.equal(h.arbiter.holds('img-1'), false);
        }
      }
      assert.equal(h.remoteWorkers.get(job.job_id).state, 'cancelled_verified');
      assert.equal(h.jobStore.get(job.job_id).status, 'COMPLETE');
      assert.equal((await img).granted, true);
    } finally { await h.closeAll(); }
  });
}

test('model restriction: only the approved allowlist; no download advice; the legacy default is gemma3:4b', async () => {
  const h = await legacyRig();
  try {
    assert.deepEqual(await h.post('/api/ollama/chat', { message: 'x', model: 'llama3.2:latest' }), { status: 503, body: { error: 'Model "llama3.2:latest" is not on the approved local model list' } });
    assert.deepEqual(await h.post('/api/ollama/enhance', { prompt: 'x', model: 'gemma3:4b-instruct' }), { status: 503, body: { error: 'Model "gemma3:4b-instruct" is not on the approved local model list' } });
    const heavy = await h.post('/api/ollama/chat', { message: 'x', model: 'qwen3.8:27b-mlx' });
    assert.deepEqual(heavy.body.model, 'qwen3.8:27b-mlx');
    assert.equal(h.legacyJobs()[0].resource_class, 'heavy');
    const resolve = Legacy.createModelResolver(async () => ({ ok: true, json: { models: [{ name: 'qwen3.8:27b-mlx', size: 1 }] } }));
    assert.deepEqual(await resolve(), { model: '', error: 'Model "gemma3:4b" is not installed' });
    assert.deepEqual(await resolve('qwen3.8:27b-mlx'), { model: 'qwen3.8:27b-mlx', resource_class: 'heavy', error: null });
  } finally { await h.closeAll(); }
});

test('legacy chat client disconnect aborts the upstream request; the lease is released only after verified cleanup', async () => {
  let release;
  const hold = new Promise(res => { release = res; });
  const h = await legacyRig({ chat: jsonChat(null, { hold }) });
  try {
    const out = await h.post('/api/ollama/chat', { message: 'hello' }, { abortAfterMs: 80 });
    assert.ok(out.destroyed);
    await until(() => h.fake.chatRequests()[0] && h.fake.chatRequests()[0].aborted);
    const [job] = h.legacyJobs();
    await until(() => h.jobStore.get(job.job_id).status === 'CANCELLED');
    assert.equal(h.remoteWorkers.get(job.job_id).state, 'cancelled_verified');
    assert.equal(h.arbiter.state().owner, null);
    release();
  } finally { await h.closeAll(); }
});

test('Stop through the job cancel API aborts a legacy request and reports a verified stop', async () => {
  const h = await legacyRig({ chat: jsonChat(null, { hold: new Promise(() => {}) }) });
  try {
    const p = h.post('/api/ollama/chat', { message: 'hello' });
    await until(() => h.fake.chatRequests().length === 1);
    const [job] = h.legacyJobs();
    const c = await h.cancelManager.cancelJob(job.job_id);
    assert.deepEqual([c.ok, c.cancelState, c.status], [true, 'verified_stopped', 'CANCELLED']);
    assert.equal(h.fake.chatRequests()[0].aborted, true);
    const out = await p;
    assert.equal(out.status, 502, 'the aborted upstream surfaces through the existing error path');
  } finally { await h.closeAll(); }
});

test('legacy calls and Chat streams exclude each other on the same lease', async () => {
  let release;
  const hold = new Promise(res => { release = res; });
  // A generous wait: this test is about ordering on the lease, not the bounded-wait refusal (covered above).
  const h = await legacyRig({ waitMs: 10000, chat: async (b, req, res, st) => (b.stream ? scripted([{ write: delta('x') }, { delay: 1 }])(b, req, res, st).then(() => hold).then(() => { if (!st.aborted) { res.end(doneLine()); } }) : jsonChat()(b, req, res, st)) });
  try {
    const sid = await h.newSession();
    const chat = h.send(sid, 'q');
    await until(() => h.fake.chatRequests().length === 1);
    const legacy = h.post('/api/ollama/chat', { message: 'hello' });
    await until(() => h.arbiter.state().waiting.length === 1);
    assert.equal(h.fake.chatRequests().length, 1, 'the legacy request waits while Chat owns Big Mac');
    release();
    const done = await chat;
    assert.ok(terminals(done.events).length === 1);
    assert.equal((await legacy).status, 200);
  } finally { await h.closeAll(); }
});

test('privacy canary across legacy jobs, worker records, event replay and logs', async () => {
  const CANARY = 'LEGACYP3B-' + Date.now();
  const h = await legacyRig({ chat: jsonChat('reply ' + CANARY) });
  try {
    await h.post('/api/ollama/chat', { message: 'secret ' + CANARY });
    await h.llmChat([{ role: 'user', content: CANARY }]);
    await until(() => h.legacyJobs().every(j => j.status === 'COMPLETE'));
    h.jobStore.flush();
    for (const blob of [fs.readFileSync(path.join(h.dir, 'jobs.json'), 'utf8'), fs.readFileSync(path.join(h.dir, 'remote-workers.json'), 'utf8'), JSON.stringify(h.eventBus.getReplaySince(0)), JSON.stringify(h.logs), JSON.stringify(h.arbiter.state())]) {
      assert.ok(!blob.includes(CANARY));
    }
    assert.equal(h.legacyJobs().length, 2);
  } finally { await h.closeAll(); }
});
