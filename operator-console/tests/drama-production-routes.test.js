'use strict';
// PRODUCE over HTTP with the real event bus + cancellation manager: live job events, Job Center projection, cancel.
const test = require('node:test');
const assert = require('node:assert/strict');
const express = require('express'); const fs = require('node:fs'); const path = require('node:path');
const { registerVoiceRoutes } = require('../voice-routes'); const { createEventBus } = require('../event-bus'); const { createCancellationManager } = require('../cancellation');
const O = require('../operational-jobs'); const { harness } = require('./helpers/fake-bigmac');
const { dramaCancelCapability, requestDramaStop } = require('../drama-cancel-policy');

const CANARY = 'ROUTECANARY-9034';
async function boot(opts) {
  const bus = createEventBus(); const pub = O.createGenericJobEventPublisher(bus);
  const h = harness(Object.assign({ onChange: (k, j) => pub(k, j) }, opts));
  const app = express(); app.use(express.json());
  let mod; const cancelManager = createCancellationManager({ arbiter: h.arbiter, jobStore: h.jobStore, eventBus: bus, workerCapabilities: dramaCancelCapability, onLocalTerminate: async a => requestDramaStop(mod.producer, a) });
  mod = registerVoiceRoutes(app, { stateDir: h.base + '/state', jobStore: h.jobStore, mediaStore: h.mediaStore, staging: h.staging, mediaBridge: h.bridge, probeFor: h.probeFor, llmChat: null, ingest: async p => fs.readFileSync(p),
    cancelJob: id => cancelManager.cancelJob(id), onJobStart: id => cancelManager.registerActiveJob(id, { target: 'drama-production' }), onJobEnd: id => cancelManager.unregisterActiveJob(id) });
  const server = await new Promise(r => { const s = app.listen(0, '127.0.0.1', () => r(s)); });
  const base = `http://127.0.0.1:${server.address().port}`;
  const api = async (method, url, body) => { const r = await fetch(base + url, { method, headers: { 'content-type': 'application/json' }, body: body ? JSON.stringify(body) : undefined }); return { status: r.status, body: await r.json() }; };
  return Object.assign(h, { mod, api, bus, cancelManager, close: () => server.close() });
}
const castProject = async (h, script) => {
  const c = await h.api('POST', '/api/drama/projects', { title: 'HTTP drama', script }); const proj = c.body.project;
  for (const a of proj.actors) { const v = (await h.api('POST', '/api/voice/profiles', { name: a.speaker, type: 'preset', preset_voice: ['af_heart', 'am_adam', 'bf_emma'][proj.actors.indexOf(a) % 3] })).body.profile; await h.api('PUT', `/api/drama/projects/${proj.id}/actors/${a.id}`, { voice_profile_id: v.id }); }
  return proj.id;
};
const until = async (fn, ms = 15000) => { const t0 = Date.now(); for (;;) { const v = await fn(); if (v) return v; if (Date.now() - t0 > ms) throw new Error('timeout'); await new Promise(r => setTimeout(r, 10)); } };

test('POST produce → live events on the bus → complete production with a downloadable master', async () => {
  const h = await boot(); try {
    const id = await castProject(h, `TIGER: ${CANARY} I warned you.\nCODEC: Hello there.\nNARRATOR: The end.`);
    const r = await h.api('POST', `/api/drama/projects/${id}/produce`, {}); assert.equal(r.status, 202); assert.ok(r.body.job_id);
    const pid = r.body.production.id;
    const fin = await until(async () => { const x = (await h.api('GET', `/api/drama/productions/${pid}`)).body; return TERMINALS.includes(x.production.status) ? x : null; });
    assert.equal(fin.production.status, 'complete', JSON.stringify(fin.production.errors));
    assert.ok(fin.project.project_master.download_url); assert.equal(fin.project.active_production, null);
    const names = h.bus.getReplaySince(0).map(e => e.event);
    assert.ok(names.includes('job.created') && names.includes('job.started') && names.includes('job.progress') && names.includes('job.completed'), names.join());
    const dump = JSON.stringify(h.bus.getReplaySince(0)); assert.ok(!dump.includes(CANARY), 'no script text on the SSE bus');
    const prog = h.bus.getReplaySince(0).filter(e => e.event === 'job.progress' && e.data.id === r.body.job_id).map(e => e.data.label);
    assert.ok(prog.some(l => /Scene 1\/1 · line \d\/3 · chunk 1\/1/.test(l)), prog.join(' | '));
  } finally { h.close(); }
});
const TERMINALS = ['complete', 'failed', 'partial', 'cancelled', 'superseded'];

test('POST produce on an uncast project is refused with the plan; unknown project is 404', async () => {
  const h = await boot(); try {
    const c = await h.api('POST', '/api/drama/projects', { title: 'x', script: 'TIGER: Hi.' });
    const r = await h.api('POST', `/api/drama/projects/${c.body.project.id}/produce`, {}); assert.equal(r.status, 409); assert.equal(r.body.gate, 'production-blocked'); assert.ok(r.body.plan.cast_problems.length);
    assert.equal((await h.api('POST', '/api/drama/projects/dp-00000000/produce', {})).status, 404);
    assert.equal((await h.api('GET', '/api/drama/productions/pr-nope')).status, 404);
  } finally { h.close(); }
});

test('cancelling through the shared job cancel path stops the production at the next safe boundary', async () => {
  const h = await boot({ delayMs: 20 }); try {
    const id = await castProject(h, 'TIGER: One.\nCODEC: Two.\nNARRATOR: Three.');
    const r = await h.api('POST', `/api/drama/projects/${id}/produce`, {});
    await until(() => h.state.requests.length > 0);
    const res = await h.cancelManager.cancelJob(r.body.job_id, { reason: 'user' });
    assert.equal(res.ok, false, 'safe-boundary stop is pending, never immediately verified');
    assert.equal(res.accepted, true);
    assert.equal(res.cancelState, 'stop_after_current');
    assert.equal(res.terminationVerified, false);
    assert.equal(res.leaseReleased, false);
    const fin = await until(async () => { const x = (await h.api('GET', `/api/drama/productions/${r.body.production.id}`)).body; return TERMINALS.includes(x.production.status) ? x : null; });
    assert.equal(fin.production.status, 'cancelled'); assert.ok(h.state.requests.length < 3);
    assert.equal(h.jobStore.get(r.body.job_id).status, 'CANCELLED');
    assert.equal(h.arbiter.state().owner, null);
  } finally { h.close(); }
});

test('the operational snapshot projection shows the production with a measured percentage and an index-only label', async () => {
  const j = { job_id: 'j1', media_kind: 'voice', operation: 'drama-production', status: 'RUNNING', progress: { phase: 'rendering', label: 'Scene 2/5 · line 14/40 · chunk 1/2', done: 10, total: 40 } };
  assert.equal(O.genericJobLabel(j), 'Scene 2/5 · line 14/40 · chunk 1/2'); assert.equal(O.projectGenericProgress(j.progress).totalPercent, 25);
});
