'use strict';
// Phase 3: Chat admission through the real heavy-compute arbiter, model ownership, verified release, Stop truth,
// restart recovery and privacy (Phase 0 contract D.5, D.6, E.3; C-06..C-09, C-12, C-18, C-20 with fakes only).
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const M = require('../media');
const RW = require('../remote-workers');
const { sanitizePayload } = require('../event-bus');
const { classifyPs, createChatCompute } = require('../chat-compute');
const { chatRig, stores, until, terminals, rid, FAST_COMPUTE } = require('./helpers/chat-rig');
const { scripted, delta, doneLine } = require('./fixtures/fake-ollama-ndjson');

const loaded = (...names) => () => ({ status: 200, json: { models: names.map(n => ({ name: n, model: n, size: 1 })) } });
const reply = scripted([{ write: delta('Hi') }, { write: doneLine() }]);
const chatJobs = r => r.jobStore.list({ media_kind: 'chat' });

test('classifyPs is tri-state and never reads a bad observation as clear', () => {
  assert.deepEqual(classifyPs({ ok: true, json: { models: [] } }), { state: 'clear', models: [] });
  assert.deepEqual(classifyPs({ ok: true, json: { models: [{ name: 'gemma3:4b' }] } }), { state: 'occupied', models: ['gemma3:4b'] });
  for (const bad of [null, { ok: false, status: 502 }, { ok: true, json: null }, { ok: true, json: {} }, { ok: true, json: { models: 'x' } }, { ok: true, json: { models: [{}] } }, { ok: true, json: { models: [null] } }]) {
    assert.equal(classifyPs(bad).state, 'unknown', JSON.stringify(bad));
  }
});

test('a happy request takes the heavy lease, owns the load, verifies unload and only then releases', async () => {
  let unloaded = false, psCalls = 0;
  const r = await chatRig({ chat: reply, ps: () => { psCalls++; return { status: 200, json: { models: [] } }; }, unload: () => { unloaded = true; return { status: 200, json: { done_reason: 'unload', done: true } }; } });
  try {
    const sid = await r.newSession();
    const out = await r.send(sid, 'hello');
    assert.deepEqual(out.events.map(e => e.event), ['started', 'delta', 'done']);
    const jobId = out.events[0].data.job_id;
    assert.ok(jobId && out.events.every(e => e.data.job_id === jobId));
    await until(() => r.jobStore.get(jobId).status === 'COMPLETE');
    const job = r.jobStore.get(jobId);
    assert.deepEqual([job.media_kind, job.operation, job.worker_id, job.model_id, job.resource_class, job.artifact_required], ['chat', 'chat-stream', 'ollama', 'gemma3:4b', 'light', false]);
    assert.deepEqual(Object.keys(job.params), ['request_id']);
    assert.equal(job.params.request_id, out.events[0].data.request_id);
    assert.equal(job.privacy.persist_text, false);
    assert.equal(r.remoteWorkers.get(jobId).state, 'completed');
    assert.equal(r.remoteWorkers.get(jobId).kind, 'ollama-model');
    assert.ok(unloaded && psCalls >= 3);
    assert.equal(r.fake.chatRequests()[0].body.keep_alive, 0);
    assert.equal(r.fake.unloadRequests()[0].body.model, 'gemma3:4b');
    assert.equal(r.arbiter.state().owner, null);
    assert.equal(r.compute.holdsLive(jobId), false);
    const kinds = r.remoteWorkers.get(jobId).evidence.map(e => e.kind);
    for (const k of ['owner-clear', 'upstream-closed', 'unload-acknowledged', 'model-absent']) assert.ok(kinds.includes(k), k);
  } finally { await r.close(); }
});

test('FIFO with images: Chat (Gemma too) waits behind a heavy image job and an image waits behind Chat', async () => {
  let release;
  const gate = new Promise(res => { release = res; });
  const r = await chatRig({ chat: async (b, req, res, st) => { await gate; return scripted([{ write: delta('x') }, { write: doneLine() }])(b, req, res, st); } });
  try {
    assert.deepEqual(await r.arbiter.acquire('img-1', 'flux txt2img'), { granted: true, waitedMs: 0 });
    const sid = await r.newSession('gemma3:4b');
    const queued = [];
    const p = r.send(sid, 'q', {}, { onEvent: ev => { if (ev.event === 'queued') queued.push(ev.data); return false; } });
    await until(() => r.arbiter.state().waiting.length === 1);
    const img2 = r.arbiter.acquire('img-2', 'flux txt2img');
    assert.equal(r.arbiter.position('img-2'), 2);
    assert.equal(r.fake.chatRequests().length, 0, 'light Gemma never overlaps a heavy image job');
    r.arbiter.release('img-1');
    await until(() => r.fake.chatRequests().length === 1);
    assert.equal(r.arbiter.holds('img-2'), false, 'the image behind Chat is still waiting');
    release();
    const out = await p;
    assert.equal(out.events.at(-1).event, 'done');
    assert.deepEqual(queued[0], Object.assign({}, queued[0], { position: 1, blocked_reason: 'heavy-lease', job_id: null }));
    assert.equal((await img2).granted, true);
    assert.equal(r.arbiter.state().owner.job_id, 'img-2');
  } finally { await r.close(); }
});

test('an aborted waiter leaves the queue, is CANCELLED not_started, and can never become a future lease', async () => {
  const r = await chatRig({ chat: reply });
  try {
    await r.arbiter.acquire('img-1', 'flux');
    const sid = await r.newSession();
    const out = await r.send(sid, 'q', {}, { onEvent: ev => ev.event === 'queued' });
    assert.ok(out.destroyed);
    await until(() => r.arbiter.state().waiting.length === 0);
    const [job] = chatJobs(r);
    await until(() => r.jobStore.get(job.job_id).status === 'CANCELLED');
    assert.equal(r.jobStore.get(job.job_id).first_failed_gate, 'user-cancelled-not-started');
    r.arbiter.release('img-1');
    assert.equal(r.arbiter.state().owner, null, 'nothing was granted to the departed waiter');
    assert.equal(r.fake.chatRequests().length, 0);
    assert.equal(r.remoteWorkers.get(job.job_id), null, 'no Big Mac record for work that never started');
  } finally { await r.close(); }
});

test('a grant that lands at the same moment as an abort is released at once', async () => {
  const s = stores(fs.mkdtempSync(path.join(require('node:os').tmpdir(), 'dex-chat-race-')));
  const compute = createChatCompute(Object.assign({ arbiter: s.arbiter, jobStore: s.jobStore, remoteWorkers: s.remoteWorkers, cancelManager: s.cancelManager, baseUrl: 'http://127.0.0.1:9' }, FAST_COMPUTE));
  await s.arbiter.acquire('img-1', 'flux');
  const ctl = new AbortController();
  const p = compute.admit({ request_id: rid(), model: 'gemma3:4b', resource_class: 'light', signal: ctl.signal });
  await until(() => s.arbiter.state().waiting.length === 1);
  s.arbiter.release('img-1');   // grants the Chat waiter synchronously...
  ctl.abort();                  // ...and the abort arrives before admit resumes
  const res = await p;
  assert.deepEqual([res.admitted, res.not_started], [false, true]);
  assert.equal(s.arbiter.state().owner, null);
  assert.equal(s.jobStore.list({ media_kind: 'chat' })[0].status, 'CANCELLED');
});

test('UNKNOWN and external OCCUPIED never admit; the wait is bounded and leaves no quarantine', async () => {
  for (const [ps, why] of [[() => ({ status: 500, json: { error: 'x' } }), 'unknown'], [() => ({ status: 200, raw: 'not json' }), 'unknown'], [() => ({ destroy: true }), 'unknown'], [loaded('hermes-qwen3.8-27b-64k:latest'), 'external'], [loaded('gemma3:4b'), 'external']]) {
    const r = await chatRig({ chat: reply, ps });
    try {
      const out = await r.send(await r.newSession(), 'q');
      assert.ok(out.events.some(e => e.event === 'queued' && e.data.blocked_reason === why), why);
      assert.deepEqual(terminals(out.events).map(e => [e.event, e.data.code]), [['error', 'compute_unavailable']]);
      assert.equal(r.fake.chatRequests().length, 0, 'no generation into an occupied or unknown Ollama');
      assert.equal(r.fake.unloadRequests().length, 0, 'an external model is never unloaded');
      const [job] = chatJobs(r);
      assert.deepEqual([job.status, job.first_failed_gate], ['FAILED', 'resource-wait']);
      assert.equal(r.remoteWorkers.get(job.job_id).state, 'failed');
      assert.equal(r.remoteWorkers.quarantineReason(), null);
      assert.equal(r.arbiter.state().owner, null);
    } finally { await r.close(); }
  }
});

test('unconfirmed unload keeps the job RUNNING, the lease held and compute quarantined; the reconciler then completes it', async () => {
  const r = await chatRig({ chat: reply, unload: () => ({ status: 500, json: { error: 'busy' } }) });
  try {
    const out = await r.send(await r.newSession(), 'q');
    assert.equal(out.events.at(-1).event, 'done', 'the reply itself finished');
    const jobId = out.events[0].data.job_id;
    await until(() => r.remoteWorkers.get(jobId).state === 'stop_unverified');
    assert.equal(r.jobStore.get(jobId).status, 'RUNNING');
    assert.equal(r.arbiter.state().owner.job_id, jobId, 'the lease is kept while cleanup is unproven');
    assert.match(r.arbiter.state().quarantine, /remote stop not verified/);
    // The orphan sweep's live-owner signal stays true.
    assert.equal(r.compute.holdsLive(jobId), true);
    const img = r.arbiter.acquire('img-9', 'flux');
    await new Promise(res => setTimeout(res, 30));
    assert.equal(r.arbiter.holds('img-9'), false);
    // Reconciliation: upstream closed (known) + sustained absence -> verified -> job COMPLETE, lease released, image granted.
    const t = await r.reconciler.tick();
    assert.deepEqual(t.results, [{ job_id: jobId, state: 'cancelled_verified' }]);
    assert.equal(r.jobStore.get(jobId).status, 'COMPLETE');
    assert.equal((await img).granted, true);
    assert.equal(r.compute.holdsLive(jobId), false);
  } finally { await r.close(); }
});

test('a model that never disappears stays quarantined; operator release is recorded as released_by_operator, never verified', async () => {
  let unloaded = false;
  const r = await chatRig({ chat: reply, ps: () => (unloaded ? loaded('gemma3:4b')() : { status: 200, json: { models: [] } }), unload: () => { unloaded = true; return { status: 200, json: { done_reason: 'unload', done: true } }; } });
  try {
    const out = await r.send(await r.newSession(), 'q');
    const jobId = out.events[0].data.job_id;
    await until(() => r.remoteWorkers.get(jobId).state === 'stop_unverified');
    await r.reconciler.tick();
    assert.equal(r.remoteWorkers.get(jobId).state, 'stop_unverified', 'still present: quarantine kept');
    assert.equal(r.jobStore.get(jobId).status, 'RUNNING');
    const rel = r.remoteWorkers.operatorRelease(jobId, 'operator checked Big Mac');
    assert.equal(rel.state, 'released_by_operator');
    assert.deepEqual([r.jobStore.get(jobId).status, r.jobStore.get(jobId).first_failed_gate], ['FAILED', 'cleanup-failed']);
    assert.equal(r.arbiter.state().owner, null);
    assert.ok(!r.remoteWorkers.get(jobId).evidence.some(e => e.kind === 'verified'));
  } finally { await r.close(); }
});

test('Stop through the job cancel API: verified stop, one terminal, CANCELLED, lease released once; double cancel is safe', async () => {
  const r = await chatRig({ chat: scripted([{ write: delta('a') }, { waitAbort: true }]), stream: undefined });
  try {
    const sid = await r.newSession();
    let jobId, cancels;
    const out = await r.send(sid, 'q', {}, { onEvent: ev => { if (ev.event === 'delta' && !cancels) { jobId = ev.data.job_id; cancels = Promise.all([r.cancelManager.cancelJob(jobId), r.cancelManager.cancelJob(jobId)]); } return false; } });
    const [a, b] = await cancels;
    for (const c of [a, b]) assert.deepEqual([c.ok, c.cancelState, c.terminationVerified, c.status], [true, 'verified_stopped', true, 'CANCELLED']);
    assert.deepEqual(terminals(out.events).map(e => [e.event, e.data.stop, e.data.reason]), [['stopped', 'verified', 'user']]);
    assert.equal(r.fake.chatRequests()[0].aborted, true);
    assert.equal(r.jobStore.get(jobId).status, 'CANCELLED');
    assert.equal(r.remoteWorkers.get(jobId).state, 'cancelled_verified');
    const third = await r.cancelManager.cancelJob(jobId);
    assert.deepEqual([third.ok, third.cancelState], [false, 'already_terminal']);
    assert.equal(r.arbiter.state().owner, null);
    assert.equal(r.fake.unloadRequests().length, 1, 'one cleanup for two cancels and the runner');
  } finally { await r.close(); }
});

test('Stop with unconfirmed cleanup reports requested/unverified, keeps job, lease and quarantine', async () => {
  const r = await chatRig({ chat: scripted([{ write: delta('a') }, { waitAbort: true }]), unload: () => ({ destroy: true }) });
  try {
    let cancel;
    const out = await r.send(await r.newSession(), 'q', {}, { onEvent: ev => { if (ev.event === 'delta' && !cancel) cancel = r.cancelManager.cancelJob(ev.data.job_id); return false; } });
    const c = await cancel;
    assert.deepEqual([c.ok, c.accepted, c.cancelState, c.gate, c.leaseReleased, c.status], [false, true, 'requested', 'remote-stop-unverified', false, 'RUNNING']);
    assert.deepEqual(terminals(out.events).map(e => [e.event, e.data.stop]), [['stopped', 'unverified']]);
    const jobId = out.events[0].data.job_id;
    assert.equal(r.arbiter.state().owner.job_id, jobId);
    assert.equal(r.remoteWorkers.get(jobId).state, 'stop_unverified');
    const again = await r.cancelManager.cancelJob(jobId);
    assert.deepEqual([again.ok, again.cancelState], [false, 'requested'], 'a second cancel does not pretend a stop');
  } finally { await r.close(); }
});

test('queued cancel through the job API is CANCELLED not_started and the stream ends stopped/verified', async () => {
  const r = await chatRig({ chat: reply });
  try {
    await r.arbiter.acquire('img-1', 'flux');
    let cancel;
    const out = await r.send(await r.newSession(), 'q', {}, { onEvent: ev => { if (ev.event === 'queued' && !cancel) cancel = r.cancelManager.cancelJob(chatJobs(r)[0].job_id); return false; } });
    const c = await cancel;
    assert.deepEqual([c.ok, c.cancelState, c.neverStarted], [true, 'not_started', true]);
    assert.deepEqual(terminals(out.events).map(e => [e.event, e.data.stop, e.data.reason]), [['stopped', 'verified', 'user']]);
    assert.equal(r.fake.chatRequests().length, 0);
    assert.equal(r.arbiter.holds(chatJobs(r)[0].job_id), false);
    assert.equal(r.arbiter.state().owner.job_id, 'img-1');
  } finally { await r.close(); }
});

test('client disconnect: the lease is held through cleanup and released only after unload is verified', async () => {
  let releaseUnload;
  const unloadGate = new Promise(res => { releaseUnload = res; });
  const r = await chatRig({ chat: scripted([{ write: delta('a') }, { waitAbort: true }]), unload: async () => { await unloadGate; return { status: 200, json: { done_reason: 'unload', done: true } }; } });
  try {
    const out = await r.send(await r.newSession(), 'q', {}, { onEvent: ev => ev.event === 'delta' });
    const jobId = out.events[0].data.job_id;
    await until(() => r.fake.unloadRequests().length === 1);
    assert.equal(r.arbiter.state().owner.job_id, jobId, 'disconnect does not release compute ownership');
    assert.equal(r.jobStore.get(jobId).status, 'RUNNING');
    releaseUnload();
    await until(() => r.jobStore.get(jobId).status === 'CANCELLED');
    assert.equal(r.arbiter.state().owner, null);
  } finally { await r.close(); }
});

test('timeouts end FAILED generation-failed after a verified cleanup', async () => {
  const r = await chatRig({ chat: scripted([{ waitAbort: true }]) });
  try {
    const out = await r.send(await r.newSession(), 'q');
    assert.deepEqual(terminals(out.events).map(e => e.data.code), ['first_token_timeout']);
    const jobId = out.events[0].data.job_id;
    await until(() => r.jobStore.get(jobId).status === 'FAILED');
    assert.match(r.jobStore.get(jobId).error, /first_token_timeout/);
    assert.equal(r.remoteWorkers.get(jobId).state, 'failed');
  } finally { await r.close(); }
});

test('restart: a RUNNING Chat job becomes INTERRUPTED, its record orphan_suspect, heavy work blocked until the model is proven gone', async () => {
  const dir = fs.mkdtempSync(path.join(require('node:os').tmpdir(), 'dex-chat-restart-'));
  const first = stores(dir);
  const job = first.jobStore.create({ media_kind: 'chat', operation: 'chat-stream', worker_id: 'ollama', model_id: 'qwen3.8:27b-mlx', resource_class: 'heavy', params: { request_id: rid() }, artifact_required: false });
  first.jobStore.transition(job.job_id, 'RUNNING', { resource_lease: 'bigmac-heavy-inference' });
  first.jobStore.flush();
  first.remoteWorkers.start(job.job_id, { action: 'ollama-chat', kind: 'ollama-model', target: 'qwen3.8:27b-mlx' });
  // "Restart": fresh processes over the same files.
  let psMode = 'unknown';
  const r = await chatRig({ dir, chat: reply, ps: () => (psMode === 'unknown' ? { status: 502, json: {} } : psMode === 'present' ? loaded('qwen3.8:27b-mlx')() : { status: 200, json: { models: [] } }) });
  try {
    assert.equal(r.jobStore.get(job.job_id).status, 'INTERRUPTED');
    assert.equal(r.jobStore.get(job.job_id).resource_lease, null);
    r.remoteWorkers.adoptAfterRestart();
    assert.equal(r.remoteWorkers.get(job.job_id).state, 'orphan_suspect');
    const img = r.arbiter.acquire('img-1', 'flux');
    await r.reconciler.tick();
    assert.equal(r.remoteWorkers.get(job.job_id).state, 'stop_unverified', 'a failed /api/ps is never clear');
    psMode = 'present';
    await r.reconciler.tick();
    assert.equal(r.arbiter.holds('img-1'), false);
    psMode = 'clear';
    await r.reconciler.tick();
    assert.equal(r.remoteWorkers.get(job.job_id).state, 'cancelled_verified');
    r.arbiter.poke();
    assert.equal((await img).granted, true);
    assert.equal(r.fake.unloadRequests().length, 0, 'reconciliation never unloads: ownership cannot be re-proved after a restart');
    assert.equal(r.jobStore.get(job.job_id).status, 'INTERRUPTED', 'the job keeps its truthful terminal state');
  } finally { await r.close(); }
});

test('the reconciler never decides a Chat record from the sd scan, and without the Ollama check it stays unverified', async () => {
  const reg = RW.createRemoteWorkerRegistry();
  reg.start('j1', { action: 'ollama-chat', kind: 'ollama-model', target: 'gemma3:4b' });
  reg.adoptAfterRestart();
  let scans = 0;
  const rec = RW.createReconciler({ registry: reg, checkRun: async () => ({ alive: 0 }), stopRun: async () => ({ left: 0, found: 0 }), scanOwned: async () => { scans++; return { runs: [], sdServer: 0 }; } });
  await rec.tick();
  assert.equal(scans, 0);
  assert.equal(reg.get('j1').state, 'stop_unverified');
  assert.ok(reg.quarantineReason());
});

test('the gate refuses before any job, lease or upstream call exists (legacy consumers still unarbitrated)', async () => {
  const r = await chatRig({ chat: reply, gate: () => 'legacy-ollama-consumers-unarbitrated' });
  try {
    const out = await r.send(await r.newSession(), 'q');
    assert.deepEqual(out.events.map(e => [e.event, e.data.code]), [['error', 'compute_unavailable']]);
    assert.equal(chatJobs(r).length, 0);
    assert.equal(r.fake.requests.filter(x => x.route !== '/api/tags').length, 0);
    assert.equal(r.arbiter.state().owner, null);
  } finally { await r.close(); }
});

test('privacy canary: no chat text in jobs.json, remote-workers.json, event replay, resource state, cancel results or logs', async () => {
  const CANARY = 'P3CANARY-' + Date.now();
  const r = await chatRig({ chat: scripted([{ write: delta('reply ' + CANARY) }, { write: doneLine() }]) });
  try {
    const sid = await r.newSession();
    await r.send(sid, 'secret ' + CANARY);
    r.fake.setChat(scripted([{ write: delta(CANARY) }, { waitAbort: true }]));
    let cancel;
    await r.send(sid, 'more ' + CANARY, {}, { onEvent: ev => { if (ev.event === 'delta' && !cancel) cancel = r.cancelManager.cancelJob(ev.data.job_id); return false; } });
    const c = await cancel;
    await until(() => chatJobs(r).every(j => ['COMPLETE', 'CANCELLED'].includes(j.status)));
    r.jobStore.flush();
    const blobs = {
      jobs: fs.readFileSync(path.join(r.dir, 'jobs.json'), 'utf8'),
      workers: fs.readFileSync(path.join(r.dir, 'remote-workers.json'), 'utf8'),
      replay: JSON.stringify(r.eventBus.getReplaySince(0)),
      resources: JSON.stringify(r.arbiter.state()), cancel: JSON.stringify(c), logs: JSON.stringify(r.logs), describe: JSON.stringify(r.compute.describe()),
    };
    for (const [name, blob] of Object.entries(blobs)) assert.ok(!blob.includes(CANARY), name + ' leaked chat text');
    assert.ok(r.eventBus.getReplaySince(0).some(e => e.event === 'job.completed' && e.data.mediaKind === 'chat'), 'the replay ring did carry Chat job events');
    assert.ok(blobs.jobs.includes('"media_kind": "chat"') || blobs.jobs.includes('"media_kind":"chat"'));
  } finally { await r.close(); }
});

test('redaction keys: job params and event payloads drop chat transcript fields', () => {
  for (const k of ['message', 'messages', 'content', 'reply', 'title']) {
    assert.ok(M.PRIVATE_KEYS.has(k), k);
    assert.deepEqual(M.safeParams({ [k]: 'secret', model: 'm' }, false), { [k]: '[REDACTED]', model: 'm' });
    assert.deepEqual(sanitizePayload({ id: 1, [k]: 'secret', nested: { [k]: 'x' } }), { id: 1, nested: {} });
  }
  assert.ok(!M.MEDIA_KINDS.includes('chat'), 'chat has no media root, so the Doctor root checks are unchanged');
  assert.deepEqual(M.JOB_ONLY_KINDS, ['chat']);
});

test('cancel capability: a Chat stop hook is a verified owner; without one a running Chat job is refused as unsafe', () => {
  const s = stores(fs.mkdtempSync(path.join(require('node:os').tmpdir(), 'dex-chat-cap-')));
  const j = s.jobStore.create({ media_kind: 'chat', operation: 'chat-stream', worker_id: 'ollama', params: {}, artifact_required: false });
  s.jobStore.transition(j.job_id, 'RUNNING', {});
  assert.equal(s.cancelManager.describeCancelCapability(j.job_id).cancelState, 'refused_unsafe');
  s.cancelManager.registerActiveJob(j.job_id, { target: 'ollama-chat', stopHook: async () => ({ ok: true, verified: true }) });
  assert.equal(s.cancelManager.describeCancelCapability(j.job_id).cancelState, 'verified_stopped');
});

test('AUTH-6 wiring: every legacy Ollama consumer in server.js goes through ollama-legacy.js, and only then is the gate open', () => {
  const server = fs.readFileSync(path.join(__dirname, '..', 'server.js'), 'utf8');
  assert.match(server, /OllamaLegacy\.registerLegacyOllamaRoutes\(app, \{ ollamaRequest, resolveModel: resolveOllamaModel, runPromptEnhance, getCompute: \(\) => chatCompute \}\);/);
  assert.match(server, /llmChat: OllamaLegacy\.createLegacyLlmChat\(/);
  assert.ok(!/app\.post\('\/api\/ollama\/(enhance|chat)'/.test(server), 'no legacy handler left outside the arbitrated module');
  assert.equal((server.match(/ollamaRequest\('\/api\/chat'/g) || []).length, 0, 'no direct /api/chat call left in server.js');
  assert.match(server, /const LEGACY_OLLAMA_CONSUMERS_ARBITRATED = true;/);
  assert.match(server, /enabled: process\.env\.DEX_CHAT_ENABLED === '1'/, 'Chat itself stays off by default');
});
