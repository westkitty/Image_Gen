'use strict';
// The Audio Drama Studio HTTP surface end to end (fake Big Mac, real mixer/mastering/package pipeline).
const test = require('node:test');
const assert = require('node:assert/strict');
const express = require('express'); const fs = require('node:fs'); const path = require('node:path'); const os = require('node:os');
const { registerVoiceRoutes } = require('../voice-routes'); const T = require('../audio-tools'); const A = require('../voice-audio'); const { harness } = require('./helpers/fake-bigmac');

const opts = { skip: T.available().ffmpeg ? false : 'ffmpeg not installed' };
const CANARY = 'STUDIOCANARY-7712';
async function boot() {
  const h = harness(); const app = express(); app.use(express.json());
  const mod = registerVoiceRoutes(app, { stateDir: h.base + '/state', jobStore: h.jobStore, mediaStore: h.mediaStore, staging: h.staging, mediaBridge: h.bridge, probeFor: h.probeFor, llmChat: null, ingest: async p => fs.readFileSync(p) });
  const server = await new Promise(r => { const s = app.listen(0, '127.0.0.1', () => r(s)); }); const base = `http://127.0.0.1:${server.address().port}`;
  const api = async (method, url, body, raw) => { const r = await fetch(base + url, { method, headers: raw ? {} : { 'content-type': 'application/json' }, body: raw || (body ? JSON.stringify(body) : undefined) }); const ct = r.headers.get('content-type') || ''; return { status: r.status, body: ct.includes('json') ? await r.json() : Buffer.from(await r.arrayBuffer()), headers: r.headers }; };
  return Object.assign(h, { mod, api, close: () => server.close() });
}
const until = async (fn, ms = 20000) => { const t0 = Date.now(); for (;;) { const v = await fn(); if (v) return v; if (Date.now() - t0 > ms) throw new Error('timeout'); await new Promise(r => setTimeout(r, 15)); } };
async function castAndProduce(h) {
  const SCRIPT = `INT. WAREHOUSE - NIGHT\n[AMBIENCE: rain on a tin roof, loop, fade in 1s]\nTIGER: ${CANARY} I warned you about the lamp.\nCODEC: I know that already.\n\nEXT. ROOFTOP - DAWN\nNARRATOR: And so it ended.`;
  const c = await h.api('POST', '/api/drama/projects', { title: 'Studio', script: SCRIPT }); const proj = c.body.project;
  for (const a of proj.actors) { const v = (await h.api('POST', '/api/voice/profiles', { name: a.speaker, type: 'preset', preset_voice: ['af_heart', 'am_adam', 'bf_emma'][proj.actors.indexOf(a) % 3] })).body.profile; await h.api('PUT', `/api/drama/projects/${proj.id}/actors/${a.id}`, { voice_profile_id: v.id }); }
  const r = await h.api('POST', `/api/drama/projects/${proj.id}/produce`, {}); assert.equal(r.status, 202, JSON.stringify(r.body));
  const fin = await until(async () => { const x = (await h.api('GET', `/api/drama/productions/${r.body.production.id}`)).body; return ['complete', 'failed', 'partial', 'cancelled'].includes(x.production.status) ? x : null; });
  assert.equal(fin.production.status, 'complete', JSON.stringify(fin.production.errors));
  return { id: proj.id, pid: r.body.production.id, project: fin.project };
}

test('Cast Bible, FX rack, pacing presets and mastering presets are served and validated', opts, async () => {
  const h = await boot(); try {
    const p = (await h.api('POST', '/api/drama/projects', { title: 'x', script: 'TIGER: Hi.' })).body.project; const a = p.actors[0];
    const u = await h.api('PUT', `/api/drama/projects/${p.id}/actors/${a.id}`, { fx: 'radio', pacing: 'fast_monologue', pronunciation: [{ from: 'Dexter', to: 'DEK-ster' }], role: 'remote', language: 'en', notes: 'tough' });
    assert.equal(u.status, 200); const act = u.body.project.actors[0]; assert.equal(act.fx.preset, 'radio'); assert.equal(act.pacing.target_wpm, 300); assert.equal(act.role, 'remote'); assert.equal(act.history.length, 1);
    assert.equal((await h.api('PUT', `/api/drama/projects/${p.id}/actors/${a.id}`, { fx: { nodes: [{ type: 'evil' }] } })).status, 400); assert.equal((await h.api('PUT', `/api/drama/projects/${p.id}/actors/ac-nope`, { notes: 'x' })).status, 404);
    const fx = (await h.api('GET', '/api/drama/fx/presets')).body; assert.ok(fx.builtin.find(x => x.id === 'echo_chamber').chain.nodes.length >= 2); assert.ok(fx.effects.find(e => e.type === 'compressor').params.ratio.max === 20);
    const v = (await h.api('POST', '/api/drama/fx/validate', { chain: { nodes: [{ type: 'gain', params: { db: 99 } }] } })).body; assert.equal(v.ok, true); assert.equal(v.chain.nodes[0].params.db, 24); assert.ok(v.warnings.length);
    const saved = (await h.api('POST', '/api/drama/fx/presets', { name: 'Mine', chain: fx.builtin.find(x => x.id === 'radio').chain })).body.preset; assert.match(saved.id, /^cp-/); assert.equal((await h.api('PUT', '/api/drama/fx/presets/radio', { name: 'x' })).status, 400);
    assert.equal((await h.api('DELETE', `/api/drama/fx/presets/${saved.id}`)).body.removed, true);
    assert.equal((await h.api('GET', '/api/drama/pacing/presets')).body.presets.find(x => x.id === 'off').mode, 'off'); const mp = (await h.api('GET', '/api/drama/mastering/presets')).body; assert.ok(mp.presets.some(x => x.id === 'audiobook' && x.target_lufs === -20));
  } finally { h.close(); }
});

test('delivery, mastering and mix settings validate and persist on the project', opts, async () => {
  const h = await boot(); try {
    const p = (await h.api('POST', '/api/drama/projects', { title: 'x', script: 'TIGER: Hi.' })).body.project;
    assert.deepEqual((await h.api('PUT', `/api/drama/projects/${p.id}/delivery`, { formats: ['mp3', 'ogg', 'm4b'], stems: true })).body.delivery, { formats: ['mp3', 'm4b'], stems: true });
    assert.equal((await h.api('PUT', `/api/drama/projects/${p.id}/mastering`, { preset: 'podcast' })).body.mastering.preset, 'podcast'); assert.equal((await h.api('PUT', `/api/drama/projects/${p.id}/mastering`, { preset: 'loud' })).status, 400); assert.equal((await h.api('PUT', `/api/drama/projects/${p.id}/mastering`, { preset: 'drama', ceiling_dbtp: 3 })).status, 400);
    const m = (await h.api('PUT', `/api/drama/projects/${p.id}/mix`, { duck_db: -99, dialogue_leveling: -20 })).body.mix; assert.equal(m.duck_db, -30); assert.equal(m.dialogue_leveling, -20);
  } finally { h.close(); }
});

test('Sound Director: script cues listed, suggestions local, procedural effect generated, bound cue anchored and audible in the preview', opts, async () => {
  const h = await boot(); try {
    const { id } = await castAndProduce(h);
    const cues = (await h.api('GET', `/api/drama/projects/${id}/cues`)).body; assert.equal(cues.cues.length, 1); assert.equal(cues.cues[0].status, 'unresolved'); assert.equal(cues.issues.blocking.length, 0);
    const lid = cues.cues[0].line_id; const sg = (await h.api('GET', `/api/drama/projects/${id}/cues/${lid}/suggest`)).body; assert.ok(sg.procedural.some(x => x.recipe === 'rain')); assert.match(sg.note, /nothing is downloaded/);
    const gen = await h.api('POST', '/api/drama/procedural', { recipe: 'rain', seconds: 3 }); assert.equal(gen.status, 201);
    assert.equal((await h.api('POST', '/api/drama/procedural', { recipe: 'thunder' })).status, 400);
    const bound = await h.api('POST', `/api/drama/projects/${id}/cues/${lid}/bind`, { artifact_id: gen.body.artifact.artifact_id, gain: 0.4 }); assert.equal(bound.status, 200); assert.equal(bound.body.track.loop, true);
    const sc = bound.body.project.scenes[0].id; const tlv = (await h.api('GET', `/api/drama/projects/${id}/scenes/${sc}/timeline`)).body.timeline;
    assert.equal(tlv.fresh, false); assert.ok(tlv.lanes.find(l => l.id === 'ambience').clips[0].resolved);
    const prev = await h.api('POST', `/api/drama/projects/${id}/scenes/${sc}/preview`, {}); assert.equal(prev.status, 200); assert.equal(prev.body.reused, false); assert.equal(prev.body.timeline.fresh, true);
    assert.equal((await h.api('PUT', `/api/drama/projects/${id}/cues/${lid}`, { required: true })).status, 200);
    assert.equal((await h.api('DELETE', `/api/drama/projects/${id}/cues/${lid}/bind`)).body.removed, true);
  } finally { h.close(); }
});

test('timeline edits, markers, peaks, pacing preview and boundary trim work over HTTP and stay non-destructive', opts, async () => {
  const h = await boot(); try {
    const { id, project } = await castAndProduce(h); const l1 = project.scenes[0].lines.find(l => l.kind === 'dialogue'); const sc = project.scenes[0].id;
    const clip = await h.api('PUT', `/api/drama/projects/${id}/lines/${l1.id}/clip`, { gain_db: -3, fade_out_s: 0.05 }); assert.equal(clip.body.overrides.gain_db, -3);
    assert.equal((await h.api('PUT', `/api/drama/projects/${id}/lines/${l1.id}/clip`, { pinned_take_id: 'tk-nope' })).status, 400);
    const mk = await h.api('POST', `/api/drama/projects/${id}/markers`, { scene_id: sc, t_s: 1, label: 'beat' }); assert.equal(mk.status, 201); assert.equal((await h.api('DELETE', `/api/drama/projects/${id}/markers/${mk.body.marker.id}`)).body.removed, true);
    const take = l1.takes[0]; const pk = await h.api('GET', `/api/voice/peaks/${take.artifact_id}?bins=200`); assert.equal(pk.status, 200); assert.equal(pk.body.bins, 200); assert.ok(Math.max(...pk.body.max) > 10); assert.equal((await h.api('GET', '/api/voice/peaks/..%2F..%2Fetc%2Fpasswd')).status, 404);
    const pp = await h.api('POST', `/api/drama/projects/${id}/lines/${l1.id}/pacing-preview`, { tempo: 1.2 }); assert.equal(pp.status, 200); assert.equal(pp.body.tempo, 1.2); assert.equal(pp.body.verified, true);
    const aud = await h.api('GET', pp.body.result.url); assert.equal(aud.status, 200); assert.equal(aud.headers.get('content-type'), 'audio/wav'); assert.equal((await h.api('GET', '/api/drama/derived/' + 'a'.repeat(64))).status, 404);
    assert.equal((await h.api('POST', `/api/drama/projects/${id}/lines/${l1.id}/pacing-preview`, { tempo: 5 })).status, 400);
    const bd = await h.api('POST', `/api/drama/projects/${id}/lines/${l1.id}/boundaries`, {}); assert.equal(bd.body.boundaries.engine, 'energy-vad'); assert.equal(bd.body.boundaries.silero.available, false);
    const before = h.mediaStore.resolve(take.artifact_id).sha256; const tr = await h.api('POST', `/api/drama/projects/${id}/lines/${l1.id}/apply-trim`, {}); if (tr.status === 200) assert.ok(tr.body.overrides.trim_end_s > 0); assert.equal(h.mediaStore.resolve(take.artifact_id).sha256, before, 'the original take is untouched');
    const rv = await h.api('POST', `/api/drama/projects/${id}/lines/${l1.id}/takes/${take.id}/review`, { state: 'heard-ok', note: 'good' }); assert.equal(rv.status, 200); assert.equal((await h.api('POST', `/api/drama/projects/${id}/lines/${l1.id}/takes/${take.id}/review`, { state: 'meh' })).status, 400);
  } finally { h.close(); }
});

test('QA status is honest, a QA run reports UNAVAILABLE speech verification, and a hard failure is named', opts, async () => {
  const h = await boot(); try {
    const { id } = await castAndProduce(h); const st = (await h.api('GET', '/api/drama/qa/status')).body; assert.equal(typeof st.asr.available, 'boolean'); assert.equal(st.silero.available, false);
    const q = await h.api('POST', `/api/drama/projects/${id}/qa`, { asr: false }); assert.equal(q.status, 200); assert.equal(q.body.summary.checked, 3); assert.deepEqual(q.body.summary.hard_failures, []); assert.equal(q.body.summary.asr.state, 'UNAVAILABLE');
    assert.ok(q.body.lines.every(l => l.integrity_ok));
  } finally { h.close(); }
});

test('proof, acceptance, history, revisions: evidence tied to the master; labels CURRENT/HISTORICAL; edits show up as derived differences', opts, async () => {
  const h = await boot(); try {
    const { id, pid, project } = await castAndProduce(h);
    const pr = (await h.api('GET', `/api/drama/productions/${pid}/proof`)).body; assert.equal(pr.verification.ok, true); assert.equal(pr.proof.master.sha256, project.project_master ? h.mediaStore.resolve(project.project_master.artifact_id).sha256 : null);
    assert.equal(JSON.stringify(pr).includes(CANARY), false); assert.equal(pr.proof.human_acceptance.state, 'pending');
    assert.equal((await h.api('POST', `/api/drama/productions/${pid}/acceptance`, { state: 'maybe' })).status, 400); assert.equal((await h.api('POST', `/api/drama/productions/${pid}/acceptance`, { state: 'approved', note: 'listened' })).body.human_acceptance.state, 'approved');
    const hist = (await h.api('GET', `/api/drama/projects/${id}/history`)).body.productions; assert.equal(hist[0].label, 'CURRENT'); assert.equal(hist[0].acceptance.state, 'approved'); assert.ok(hist[0].master.download_url); assert.ok(hist[0].outputs.m4b.download_url);
    const l1 = project.scenes[0].lines.find(l => l.kind === 'dialogue');
    await h.api('PATCH', `/api/drama/projects/${id}/lines/${l1.id}`, { text: 'I warned you about the light.' });
    const rev = (await h.api('GET', `/api/drama/projects/${id}/revisions?from=${pid}&to=current`)).body.report; assert.equal(rev.summary.dialogue_changed, 1); assert.equal(rev.summary.needs_regeneration, 1); assert.equal(rev.summary.reused, 2); assert.equal((await h.api('GET', `/api/drama/projects/${id}/revisions?from=pr-00000000`)).status, 404);
    const r2 = await h.api('POST', `/api/drama/projects/${id}/produce`, {}); await until(async () => { const x = (await h.api('GET', `/api/drama/productions/${r2.body.production.id}`)).body; return x.production.status === 'complete' ? x : null; });
    const hist2 = (await h.api('GET', `/api/drama/projects/${id}/history`)).body.productions; assert.deepEqual(hist2.slice(0, 2).map(x => x.label), ['CURRENT', 'HISTORICAL'], 'the earlier production stays playable and is labelled historical');
  } finally { h.close(); }
});

test('portable project package over HTTP: private by default, full on request, importable once and checked', opts, async () => {
  const h = await boot(); try {
    const { id } = await castAndProduce(h);
    const priv = await h.api('POST', `/api/drama/projects/${id}/package`, {}); assert.equal(priv.status, 200); assert.equal(priv.body.toString('latin1').includes(CANARY), false);
    const full = await h.api('POST', `/api/drama/projects/${id}/package`, { include: { screenplay: true, takes: true, masters: true } }); assert.equal(full.status, 200);
    const dry = await h.api('POST', '/api/drama/packages/import', null, full.body); assert.equal(dry.status, 200); assert.equal(dry.body.applied, false);
    const ap = await h.api('POST', '/api/drama/packages/import?apply=1', null, full.body); assert.equal(ap.body.applied, true); assert.notEqual(ap.body.project.id, id);
    assert.equal((await h.api('POST', '/api/drama/packages/import', null, Buffer.from('definitely not a zip'))).status, 422);
  } finally { h.close(); }
});
