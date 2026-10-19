'use strict';
// HTTP surface of the voice designer, exercised end to end against a fake Big Mac.
const test = require('node:test');
const assert = require('node:assert/strict');
const express = require('express'); const path = require('node:path'); const fs = require('node:fs');
const { registerVoiceRoutes } = require('../voice-routes');
const A = require('../voice-audio');
const { harness, tone } = require('./helpers/fake-bigmac');

async function boot({ probeFor } = {}) {
  const h = harness(); const app = express(); app.use(express.json());
  const mod = registerVoiceRoutes(app, { stateDir: h.base + '/state', jobStore: h.jobStore, mediaStore: h.mediaStore, staging: h.staging, mediaBridge: h.bridge, probeFor: probeFor || h.probeFor, llmChat: null, ingest: async p => fs.readFileSync(p) });
  const server = await new Promise(r => { const s = app.listen(0, '127.0.0.1', () => r(s)); });
  const base = `http://127.0.0.1:${server.address().port}`;
  const api = async (method, url, body, raw) => { const r = await fetch(base + url, { method, headers: raw ? {} : { 'content-type': 'application/json' }, body: raw || (body ? JSON.stringify(body) : undefined) }); const ct = r.headers.get('content-type') || ''; return { status: r.status, body: ct.includes('json') ? await r.json() : Buffer.from(await r.arrayBuffer()), headers: r.headers }; };
  return Object.assign(h, { mod, api, close: () => server.close() });
}
const until = async (fn) => { for (let i = 0; i < 400; i++) { const v = await fn(); if (v) return v; await new Promise(r => setTimeout(r, 10)); } throw new Error('timeout'); };

test('capabilities report unsupported controls as disabled with the recorded evidence', async () => {
  const h = await boot(); try {
    const { body } = await h.api('GET', '/api/voice/designer/capabilities');
    const base = body.engines.find(e => e.id === 'qwen3-tts-base'), des = body.engines.find(e => e.id === 'qwen3-tts-voice-design');
    assert.equal(base.controls.delivery_direction.enabled, false); assert.match(base.controls.delivery_direction.reason, /instruct/);
    assert.equal(des.controls.delivery_direction.enabled, true);
    for (const e of body.engines) { assert.equal(e.controls.cached_voice_prompt.enabled, false); assert.match(e.controls.cached_voice_prompt.reason, /./); }
  } finally { h.close(); }
});

test('DESCRIBE → AUDITION → COMPARE → APPROVE → LOCK → promote → trial → REUSE over HTTP, no cloud anywhere', async () => {
  const h = await boot(); try {
    const TEXT = 'This is a long enough reference line for the clone, spoken clearly and calmly.';
    const c = await h.api('POST', '/api/voice/profiles', { name: 'Tiger', type: 'designed', design: { identity: { age: 'middle-aged', accent: 'Scottish', timbre: 'gravelly' } } });
    assert.equal(c.status, 201); const pid = c.body.profile.id;
    const st = await h.api('POST', `/api/voice/profiles/${pid}/auditions`, { text: TEXT, count: 3 }); assert.equal(st.status, 202);
    const rid = st.body.round.id;
    const round = await until(async () => { const r = (await h.api('GET', `/api/voice/profiles/${pid}/auditions/${rid}`)).body.round; return r.status === 'rendering' ? null : r; });
    assert.equal(round.status, 'complete'); assert.equal(round.candidates.length, 3);
    const cand = round.candidates[1];
    assert.equal((await h.api('PATCH', `/api/voice/profiles/${pid}/auditions/${rid}/candidates/${round.candidates[0].id}`, { favorite: true, note: 'warm' })).body.candidate.favorite, true);
    const ap = await h.api('POST', `/api/voice/profiles/${pid}/auditions/${rid}/candidates/${cand.id}/approve`, { note: 'this' }); assert.equal(ap.status, 200); assert.equal(ap.body.profile.approval.state, 'approved');
    assert.equal((await h.api('POST', `/api/voice/profiles/${pid}/lock`)).body.profile.locked, true);
    assert.equal((await h.api('PUT', `/api/voice/profiles/${pid}`, { description: 'A completely different voice.' })).status, 409);
    const bad = await h.api('POST', `/api/voice/profiles/${pid}/auditions/${rid}/candidates/${cand.id}/promote`, { transcript: 'wrong words' }); assert.equal(bad.status, 400); assert.equal(bad.body.gate, 'transcript-mismatch');
    const pr = await h.api('POST', `/api/voice/profiles/${pid}/auditions/${rid}/candidates/${cand.id}/promote`, { transcript: TEXT }); assert.equal(pr.status, 201);
    const cid = pr.body.profile.id; assert.equal(pr.body.profile.origin.kind, 'promoted');
    const tr = await h.api('POST', `/api/voice/profiles/${cid}/trials`, { lines: ['One line here.', 'Another line follows.', 'A third and last line.'] }); assert.equal(tr.status, 202);
    const trial = await until(async () => { const t = (await h.api('GET', `/api/voice/profiles/${cid}/trials/${tr.body.trial.id}`)).body.trial; return t.status === 'rendering' ? null : t; });
    assert.equal(trial.status, 'complete');
    const acc = await h.api('POST', `/api/voice/profiles/${cid}/trials/${trial.id}/accept`, { note: 'good' }); assert.equal(acc.body.profile.trial.passed, true);
    // reuse in a drama
    const d = await h.api('POST', '/api/drama/projects', { title: 'Two scenes', script: 'INT. A\nTIGER: First scene.\nINT. B\nTIGER: Second scene.' });
    const proj = d.body.project; const actor = proj.actors.find(a => a.speaker_key === 'TIGER');
    assert.equal((await h.api('PUT', `/api/drama/projects/${proj.id}/actors/${actor.id}`, { voice_profile_id: cid })).status, 200);
    const pl = await h.api('GET', `/api/drama/projects/${proj.id}/plan`); assert.equal(pl.body.plan.ready, true); assert.equal(pl.body.plan.counts.new, 2);
    const nothing = JSON.stringify(h.calls); assert.ok(!/googleapis|gemini|api\.openai|elevenlabs/i.test(nothing));
  } finally { h.close(); }
});

test('preview returns a labelled scratch render; bank export is metadata-only by default and imports back', async () => {
  const h = await boot(); try {
    const p = (await h.api('POST', '/api/voice/profiles', { name: 'Bright', type: 'preset', preset_voice: 'af_heart' })).body.profile;
    const pv = await h.api('POST', '/api/voice/preview', { profile_id: p.id, text: 'Hello there, this is a preview.' }); assert.equal(pv.status, 202); assert.equal(pv.body.preview, true);
    const done = await until(async () => { const d = (await h.api('GET', `/api/voice/render/${pv.body.job_id}`)).body; return d.status === 'COMPLETE' ? d : null; });
    assert.equal(done.artifact.meta.preview, true);
    const ex = await h.api('POST', '/api/voice/bank/export', { profile_ids: [p.id] }); assert.equal(ex.status, 200); assert.match(ex.headers.get('content-disposition'), /voice-bank/);
    const dry = await h.api('POST', '/api/voice/bank/import', null, ex.body); assert.equal(dry.status, 200); assert.equal(dry.body.applied, false); assert.equal(dry.body.profiles[0].action, 'rename');
    const ap = await h.api('POST', '/api/voice/bank/import?apply=1', null, ex.body); assert.equal(ap.body.created.length, 1);
    assert.equal((await h.api('POST', '/api/voice/bank/import', null, Buffer.from('not a zip at all'))).status, 422);
    assert.equal((await h.api('POST', '/api/voice/bank/export', { profile_ids: [] })).status, 400);
  } finally { h.close(); }
});

test('OpenVoice conversion refuses unreviewed voices, dispatches only an approved synthetic target, and reports unavailable capability', async () => {
  const h = await boot(); try {
    let dispatch = null;
    h.bridge.startConversion = args => { dispatch = args; return { job_id: 'job-openvoice-test', status: 'QUEUED', worker: 'openvoice-v2' }; };
    const profile = (await h.api('POST', '/api/voice/profiles', { name: 'Test-only synthetic target', type: 'cloned' })).body.profile;
    const refFile = require('./helpers/fake-bigmac').writeWav(tone(5, 220));
    const refStage = h.staging.stage(fs.readFileSync(refFile), { accept: 'audio' });
    const sample = await h.api('POST', `/api/voice/profiles/${profile.id}/samples`, { staged_id: refStage.id, name: 'Synthetic target sample', transcript: 'This is a synthetic target voice sample.' });
    assert.equal(sample.status, 201);
    const sourceFile = require('./helpers/fake-bigmac').writeWav(tone(5, 310));
    const source = h.staging.stage(fs.readFileSync(sourceFile), { accept: 'audio' });
    const refused = await h.api('POST', '/api/voice/convert', { source_staged_id: source.id, target_profile_id: profile.id });
    assert.equal(refused.status, 409); assert.equal(refused.body.gate, 'consent-required'); assert.equal(dispatch, null);

    await h.api('PUT', `/api/voice/profiles/${profile.id}/consent`, { kind: 'fictional', note: 'Isolated synthetic conversion test fixture.' });
    await h.api('POST', `/api/voice/profiles/${profile.id}/approve`, { note: 'Isolated test fixture only; not production approval.' });
    const reviewed = await h.api('PUT', `/api/voice/profiles/${profile.id}/samples/${sample.body.sample.id}/review`, { state: 'approved', note: 'Automated route-test fixture; no human-audition claim.' });
    assert.equal(reviewed.status, 200);
    const accepted = await h.api('POST', '/api/voice/convert', { source_staged_id: source.id, target_profile_id: profile.id });
    assert.equal(accepted.status, 202); assert.equal(accepted.body.job_id, 'job-openvoice-test');
    assert.equal(dispatch.targetProfileId, profile.id); assert.equal(dispatch.targetSampleId, sample.body.sample.id);
    assert.notEqual(dispatch.sourceSha256, dispatch.targetSampleSha256, 'source and target audio identities remain separate');
    assert.equal(dispatch.probe.runtime_available, true);
    const sameSource = h.staging.stage(fs.readFileSync(refFile), { accept: 'audio' });
    const same = await h.api('POST', '/api/voice/convert', { source_staged_id: sameSource.id, target_profile_id: profile.id });
    assert.equal(same.status, 400); assert.equal(same.body.gate, 'identity-separation');
  } finally { h.close(); }

  const unavailable = await boot({ probeFor: id => id === 'openvoice-v2' ? { state: 'runtime-missing', runtime_available: false, model_available: false, enabled: false } : { runtime_available: true, model_available: true } });
  try {
    const { body } = await unavailable.api('GET', '/api/voice/converters');
    const ov = body.converters.find(c => c.id === 'openvoice-v2');
    assert.equal(ov.capabilities.voice_conversion, true); assert.equal(ov.capabilities.text_generation, false);
    assert.equal(ov.availability.enabled, false); assert.equal(ov.availability.runtime_available, false);
  } finally { unavailable.close(); }
});
