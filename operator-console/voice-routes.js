'use strict';

// HTTP surface for voice profiles, long-form speech and audio-drama production.
// Dependencies are injected by server.js so these modules stay independent of its globals.

const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFile } = require('child_process');
const { createProfileStore } = require('./voice-profiles');
const { createVoiceService } = require('./voice-service');
const { createDramaStore } = require('./drama');
const { createDramaService } = require('./drama-service');
const E = require('./voice-engines');
const { KOKORO_VOICES } = require('./media-bridge');

// Normalise any ffmpeg-readable audio to a PCM16 mono 24 kHz WAV buffer (null on failure).
function ingestToWav(src) {
  return new Promise(resolve => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'dexprof-')), out = path.join(dir, 'in.wav');
    execFile('ffmpeg', ['-v', 'error', '-y', '-i', src, '-ac', '1', '-ar', '24000', '-c:a', 'pcm_s16le', out], { timeout: 60000 }, err => {
      let buf = null; if (!err) { try { buf = fs.readFileSync(out); } catch (_) {} }
      try { fs.rmSync(dir, { recursive: true, force: true }); } catch (_) {}
      resolve(buf);
    });
  });
}

function registerVoiceRoutes(app, { stateDir, jobStore, mediaStore, staging, mediaBridge, probeFor, llmChat, ingest = ingestToWav, log = () => {} }) {
  const profiles = createProfileStore({ root: path.join(stateDir, 'voice-profiles'), ingest });
  const voice = createVoiceService({ bridge: mediaBridge, jobStore, mediaStore, profiles, probeFor, log });
  const dramaStore = createDramaStore({ root: path.join(stateDir, 'drama') });
  const drama = createDramaService({ store: dramaStore, voice, profiles, mediaStore, llmChat });

  const h = fn => async (req, res) => {
    try { await fn(req, res); } catch (e) {
      const status = e.status || 500;
      if (status >= 500) log('voice-routes: ' + (e.stack || e.message));
      res.status(status).json(Object.assign({ error: e.message }, e.gate ? { gate: e.gate } : {}, e.missing ? { missing: e.missing } : {}, e.unresolved ? { unresolved: e.unresolved } : {}));
    }
  };
  const json = (res, status, body) => res.status(status).json(body);
  const nf = (res, what) => res.status(404).json({ error: what + ' not found' });
  const noStore = res => res.set('Cache-Control', 'no-store');

  // ── engines + profiles ──────────────────────────────────────────────────
  app.get('/api/voice/engines', (req, res) => res.json({ engines: E.listEngines(), kokoro_voices: KOKORO_VOICES }));
  app.get('/api/voice/profiles', h((req, res) => { noStore(res); res.json({ profiles: profiles.list() }); }));
  app.post('/api/voice/profiles', h((req, res) => res.status(201).json({ profile: profiles.create(req.body || {}) })));
  app.get('/api/voice/profiles/:id', h((req, res) => { noStore(res); const p = profiles.get(req.params.id); return p ? res.json({ profile: p }) : nf(res, 'profile'); }));
  app.put('/api/voice/profiles/:id', h((req, res) => { const p = profiles.update(req.params.id, req.body || {}); return p ? res.json({ profile: p }) : nf(res, 'profile'); }));
  app.delete('/api/voice/profiles/:id', h((req, res) => res.json({ removed: profiles.remove(req.params.id) })));
  app.post('/api/voice/profiles/:id/validate', h((req, res) => { const p = profiles.get(req.params.id); return p ? res.json({ profile: p, validation: p.validation }) : nf(res, 'profile'); }));
  // Promote a staged upload into a durable sample (re-encoded + validated; the staged copy is then removed).
  app.post('/api/voice/profiles/:id/samples', h(async (req, res) => {
    const b = req.body || {}, st = staging.get(String(b.staged_id || ''));
    if (!st || st.kind !== 'audio') return json(res, 400, { error: 'staged audio not found or expired; upload the clip again', gate: 'reference-invalid' });
    const r = await profiles.addSample(req.params.id, { srcPath: st.path, name: b.name, transcript: b.transcript });
    if (!r) return nf(res, 'profile');
    staging.remove(st.id);
    res.status(201).json(r);
  }));
  app.put('/api/voice/profiles/:id/samples/:sid', h((req, res) => { const p = profiles.updateSample(req.params.id, req.params.sid, req.body || {}); return p ? res.json({ profile: p }) : nf(res, 'sample'); }));
  app.delete('/api/voice/profiles/:id/samples/:sid', h((req, res) => { const p = profiles.removeSample(req.params.id, req.params.sid); return p ? res.json({ profile: p }) : nf(res, 'sample'); }));
  app.get('/api/voice/profiles/:id/samples/:sid/audio', h((req, res) => {
    const f = profiles.samplePath(req.params.id, req.params.sid);
    if (!f) return nf(res, 'sample');
    noStore(res); res.set('X-Content-Type-Options', 'nosniff'); res.type('audio/wav'); res.sendFile(f);
  }));

  // ── long-form speech ──────────────────────────────────────────────────────
  app.post('/api/voice/render', h((req, res) => {
    const b = req.body || {};
    const r = voice.renderText({ profileId: String(b.profile_id || ''), text: b.text, direction: b.direction, language: b.language, seed: b.seed, speed: b.speed, engine: b.engine, operation: 'speech', saveText: b.save_prompts === true });
    if (r.error) return json(res, r.status || 400, { error: r.error, gate: r.gate });
    res.json(r);
  }));
  app.get('/api/voice/render/:jobId', h((req, res) => { const d = voice.describe(req.params.jobId); return d ? res.json(d) : nf(res, 'job'); }));

  // ── drama ─────────────────────────────────────────────────────────────────
  app.post('/api/drama/parse', h(async (req, res) => { const r = await drama.parse((req.body || {}).script, { mode: (req.body || {}).mode }); res.status(r.ok ? 200 : 422).json(r); }));
  app.get('/api/drama/projects', h((req, res) => res.json({ projects: dramaStore.list() })));
  app.post('/api/drama/projects', h(async (req, res) => { const b = req.body || {}; const r = await drama.createProject({ title: b.title, script: b.script, mode: b.mode, settings: b.settings }); res.status(r.ok ? 201 : 422).json(r); }));
  app.get('/api/drama/projects/:id', h((req, res) => { noStore(res); const p = dramaStore.get(req.params.id); return p ? res.json({ project: drama.view(p) }) : nf(res, 'project'); }));
  app.put('/api/drama/projects/:id', h((req, res) => {
    const p = drama.need(req.params.id), b = req.body || {};
    if (b.title !== undefined) p.title = String(b.title).slice(0, 120) || p.title;
    if (b.settings && typeof b.settings === 'object') for (const k of ['line_gap_s', 'scene_gap_s']) if (b.settings[k] !== undefined) p.settings[k] = Math.max(0, Math.min(30, Number(b.settings[k]) || 0));
    if (b.settings && b.settings.default_language) p.settings.default_language = String(b.settings.default_language).slice(0, 8);
    dramaStore.touch(p); res.json({ project: drama.view(p) });
  }));
  app.post('/api/drama/projects/:id/reparse', h(async (req, res) => { const r = await drama.reparse(req.params.id, req.body || {}); res.status(r.ok ? 200 : 422).json(r); }));
  app.post('/api/drama/projects/:id/save', h((req, res) => { const p = dramaStore.save(req.params.id); return p ? res.json({ project: drama.view(p), saved_at: p.updated_at, path_hint: 'sdcpp-workflow/state/drama/' + p.id + '.json' }) : nf(res, 'project'); }));
  app.post('/api/drama/projects/:id/unsave', h((req, res) => { const p = dramaStore.unsave(req.params.id); return p ? res.json({ project: drama.view(p) }) : nf(res, 'project'); }));
  app.delete('/api/drama/projects/:id', h((req, res) => res.json({ removed: dramaStore.remove(req.params.id) })));

  const D = require('./drama');
  app.patch('/api/drama/projects/:id/lines/:lid', h((req, res) => { const p = drama.need(req.params.id); const l = D.setLine(p, req.params.lid, req.body || {}); if (!l) return nf(res, 'line'); dramaStore.touch(p); res.json({ project: drama.view(p) }); }));
  app.delete('/api/drama/projects/:id/lines/:lid', h((req, res) => { const p = drama.need(req.params.id); if (!D.deleteLine(p, req.params.lid)) return nf(res, 'line'); dramaStore.touch(p); res.json({ project: drama.view(p) }); }));
  app.post('/api/drama/projects/:id/scenes/:sid/lines', h((req, res) => { const p = drama.need(req.params.id); const l = D.addLine(p, req.params.sid, req.body || {}); if (!l) return nf(res, 'scene'); dramaStore.touch(p); res.status(201).json({ project: drama.view(p), line_id: l.id }); }));
  app.put('/api/drama/projects/:id/actors/:aid', h((req, res) => {
    const p = drama.need(req.params.id), b = req.body || {};
    if (b.voice_profile_id && !profiles.get(b.voice_profile_id)) return json(res, 400, { error: 'voice profile not found' });
    if (!D.bindActor(p, req.params.aid, b.voice_profile_id, b.default_direction)) return nf(res, 'actor');
    dramaStore.touch(p); res.json({ project: drama.view(p) });
  }));
  app.post('/api/drama/projects/:id/render', h((req, res) => {
    const b = req.body || {}; const run = drama.startRun(req.params.id, { scope: b.scope, sceneId: b.scene_id, lineId: b.line_id, resume: b.resume !== false, alternate: b.alternate === true });
    res.status(202).json({ run: run.id ? drama.runView(run.id) : run, project: drama.view(drama.need(req.params.id)) });
  }));
  app.get('/api/drama/runs/:rid', h((req, res) => { noStore(res); const r = drama.runView(req.params.rid); return r ? res.json({ run: r, project: drama.view(drama.need(r.project_id)) }) : nf(res, 'run'); }));
  app.post('/api/drama/projects/:id/lines/:lid/takes/:tid/select', h((req, res) => { const p = drama.need(req.params.id); if (!D.selectTake(p, req.params.lid, req.params.tid)) return json(res, 400, { error: 'take not found or not complete' }); dramaStore.touch(p); res.json({ project: drama.view(p) }); }));
  app.post('/api/drama/projects/:id/assemble', h((req, res) => { const r = drama.assembleExport(req.params.id, { sceneId: (req.body || {}).scene_id || undefined }); res.json(Object.assign(r, { project: drama.view(drama.need(req.params.id)) })); }));
  app.post('/api/drama/projects/:id/tracks', h((req, res) => { const t = drama.addTrack(req.params.id, req.body || {}); res.status(201).json({ track: t, project: drama.view(drama.need(req.params.id)) }); }));
  app.put('/api/drama/projects/:id/tracks/:tid', h((req, res) => { const t = drama.updateTrack(req.params.id, req.params.tid, req.body || {}); return t ? res.json({ track: t, project: drama.view(drama.need(req.params.id)) }) : nf(res, 'track'); }));
  app.delete('/api/drama/projects/:id/tracks/:tid', h((req, res) => res.json({ removed: drama.removeTrack(req.params.id, req.params.tid), project: drama.view(drama.need(req.params.id)) })));

  return { profiles, voice, drama, dramaStore };
}

module.exports = { registerVoiceRoutes, ingestToWav };
