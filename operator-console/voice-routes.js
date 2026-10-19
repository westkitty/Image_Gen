'use strict';

// HTTP surface for voice profiles, long-form speech and audio-drama production.
// Dependencies are injected by server.js so these modules stay independent of its globals.

const fs = require('fs');
const os = require('os');
const path = require('path');
const crypto = require('crypto');
const { execFile } = require('child_process');
const { createProfileStore } = require('./voice-profiles');
const { createVoiceService } = require('./voice-service');
const { createDramaStore } = require('./drama');
const { createDramaService } = require('./drama-service');
const { createAuditionService } = require('./voice-auditions');
const Bank = require('./voice-bank');
const { createChunkStore } = require('./chunk-store');
const { createProducer } = require('./drama-producer');
const { createAssembly } = require('./drama-assembly');
const { createDerivedStore } = require('./derived-store');
const FXR = require('./fx-rack');
const { createQa } = require('./drama-qa');
const { createProofStore } = require('./proof-store');
const { registerDramaStudioRoutes } = require('./drama-studio-routes');
const E = require('./voice-engines');
const { KOKORO_VOICES } = require('./media-bridge');
const PerformanceScore = require('./performance-score');
const { createDirectorPreferences } = require('./director-preferences');

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

function registerVoiceRoutes(app, { stateDir, jobStore, mediaStore, staging, mediaBridge, probeFor, llmChat, ingest = ingestToWav, log = () => {}, cancelJob = null, onJobStart = null, onJobEnd = null }) {
  const profiles = createProfileStore({ root: path.join(stateDir, 'voice-profiles'), ingest });
  const voice = createVoiceService({ bridge: mediaBridge, jobStore, mediaStore, profiles, probeFor, log });
  const dramaStore = createDramaStore({ root: path.join(stateDir, 'drama') });
  const engineAvailable = engineId => {
    const e = E.getEngine(engineId); if (!e) return { ok: false, reason: 'unknown engine' };
    const pr = probeFor(e.worker);
    return pr && pr.runtime_available && pr.model_available ? { ok: true } : { ok: false, reason: `${e.label} is not installed on Big Mac (${pr && pr.state || 'unknown'})` };
  };
  const derived = createDerivedStore({ root: path.join(stateDir, 'drama-derived') });
  const assembly = createAssembly({ mediaStore, derived });
  const drama = createDramaService({ store: dramaStore, voice, profiles, mediaStore, llmChat, engineAvailable, assembly });
  const chunkStore = createChunkStore({ root: path.join(stateDir, 'drama-chunks'), persist: id => !!(dramaStore.get(id) || {}).saved });
  const qa = createQa({ mediaStore });
  const proofs = createProofStore({ root: path.join(stateDir, 'drama-proofs') });
  const fxPresets = FXR.createPresetStore({ file: path.join(stateDir, 'fx-presets.json') });
  const producer = createProducer({ drama, store: dramaStore, voice, profiles, mediaStore, jobStore, chunkStore, assembly, qa, proofs, cancelChild: cancelJob, onJobStart, onJobEnd });
  drama.attachProducer(producer);
  const auditions = createAuditionService({ dir: path.join(stateDir, 'voice-auditions'), profiles, voice, mediaStore, jobStore });
  const directorPreferences = createDirectorPreferences(path.join(stateDir, 'director-preferences.json'));

  const h = fn => async (req, res) => {
    try { await fn(req, res); } catch (e) {
      const status = e.status || 500;
      if (status >= 500) log('voice-routes: ' + (e.stack || e.message));
      res.status(status).json(Object.assign({ error: e.message }, e.gate ? { gate: e.gate } : {}, e.missing ? { missing: e.missing } : {}, e.unresolved ? { unresolved: e.unresolved } : {}, e.preview ? { preview: e.preview } : {}, e.plan ? { plan: e.plan } : {}));
    }
  };
  const json = (res, status, body) => res.status(status).json(body);
  const nf = (res, what) => res.status(404).json({ error: what + ' not found' });
  const noStore = res => res.set('Cache-Control', 'no-store');

  // ── engines + profiles ──────────────────────────────────────────────────
  app.get('/api/voice/director-preferences', (req, res) => { noStore(res); res.json({ preferences: directorPreferences.get() }); });
  app.put('/api/voice/director-preferences', h((req, res) => res.json({ preferences: directorPreferences.update(req.body || {}) })));
  app.delete('/api/voice/director-preferences', (req, res) => res.json({ preferences: directorPreferences.reset() }));
  app.get('/api/voice/engines', (req, res) => {
    const engines = E.listEngines().map(engine => {
      let availability = null;
      try { availability = probeFor(engine.id) || null; } catch (_) {}
      if (!availability) return engine;
      return Object.assign({}, engine, { availability: { state: availability.state, runtime_available: !!availability.runtime_available,
        model_available: !!availability.model_available, installed: !!availability.installed, proven: !!availability.proven,
        runtimePath: availability.runtimePath || null, modelPath: availability.modelPath || null },
        status: availability.proven ? 'PROVEN' : availability.installed ? 'INSTALLED / UNVERIFIED' : availability.state || engine.status });
    });
    res.json({ engines, kokoro_voices: KOKORO_VOICES });
  });
  app.get('/api/voice/converters', (req, res) => {
    const converters = Object.values(E.CONVERTERS || {}).map(c => {
      const a = probeFor(c.id) || {};
      return Object.assign({}, c, { availability: { state: a.state || 'UNKNOWN', runtime_available: !!a.runtime_available,
        model_available: !!a.model_available, enabled: !!a.enabled, proven: !!a.proven, runtimePath: a.runtimePath || null, modelPath: a.modelPath || null } });
    });
    res.json({ converters });
  });
  app.post('/api/voice/convert', h((req, res) => {
    const b = req.body || {}, source = staging.get(String(b.source_staged_id || ''));
    if (!source || source.kind !== 'audio') return json(res, 400, { error: 'stage a source audio performance first', gate: 'reference-invalid' });
    const profile = profiles.get(String(b.target_profile_id || ''));
    if (!profile) return nf(res, 'target voice profile');
    if (profile.type !== 'cloned' || !profile.readiness || !profile.readiness.ready) return json(res, 409, { error: 'target voice requires an approved cloned profile, reviewed active sample and recorded consent', gate: 'consent-required', readiness: profile.readiness || null });
    const active = profiles.activeSample(profile.id);
    if (!active || !active.path || !active.sample.review || active.sample.review.state !== 'approved') return json(res, 409, { error: 'target voice has no approved active reference sample', gate: 'reference-invalid' });
    const digest = file => crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');
    const sourceSha = digest(source.path), targetSha = active.sample.sha256 || digest(active.path);
    if (sourceSha === targetSha) return json(res, 400, { error: 'source performance and target reference must be different recordings', gate: 'identity-separation' });
    const result = mediaBridge.startConversion({ sourcePath: source.path, targetPath: active.path, sourceStagingId: source.id,
      sourceSha256: sourceSha, targetProfileId: profile.id, targetSampleId: active.sample.id, targetSampleSha256: targetSha,
      targetProfileVersion: profile.identity_version,
      probe: probeFor('openvoice-v2') });
    if (result.error) return json(res, result.status || 409, result);
    noStore(res); res.status(202).json(result);
  }));
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

  // ── voice designer: lifecycle, auditions, promotion, trials, preview ──────────────────────────
  // Controls are reported from the engine capability flags (with their recorded evidence); an unsupported control is
  // disabled with a reason, never silently accepted.
  app.get('/api/voice/designer/capabilities', (req, res) => {
    const reason = (e, k) => (e.capabilities[k] ? null : (e.evidence && e.evidence[k]) || `${e.label} does not support this`);
    res.json({
      design_fields: { identity: ['age', 'gender_presentation', 'accent', 'linguistic_style', 'register', 'timbre', 'resonance', 'texture', 'breathiness', 'personality', 'language'], performance: ['pacing', 'energy', 'default_direction'], notes: ['pronunciation_notes', 'fx_preset'] },
      engines: E.listEngines().map(e => ({ id: e.id, label: e.label, revision: e.revision, voice_types: e.voice_types, controls: {
        delivery_direction: { enabled: !!e.capabilities.delivery_instructions, reason: reason(e, 'delivery_instructions') },
        seed: { enabled: !!e.capabilities.deterministic_seed, reason: reason(e, 'deterministic_seed') },
        speed: { enabled: !!e.capabilities.speed_control, reason: reason(e, 'speed_control') },
        reference_audio: { enabled: !!e.capabilities.cloning, reason: reason(e, 'cloning') },
        voice_description: { enabled: !!e.capabilities.voice_design, reason: reason(e, 'voice_design') },
        cached_voice_prompt: { enabled: !!e.capabilities.prompt_caching, reason: reason(e, 'prompt_caching') || null },
        paralinguistic_tags: { enabled: !!e.capabilities.paralinguistic_tags, reason: reason(e, 'paralinguistic_tags') },
      } })),
    });
  });
  const pv = (res, p) => (p ? res.json({ profile: p }) : nf(res, 'profile'));
  app.post('/api/voice/profiles/:id/approve', h((req, res) => pv(res, profiles.approve(req.params.id, req.body || {}))));
  app.post('/api/voice/profiles/:id/lock', h((req, res) => pv(res, profiles.lock(req.params.id))));
  app.post('/api/voice/profiles/:id/unlock', h((req, res) => pv(res, profiles.unlock(req.params.id))));
  app.put('/api/voice/profiles/:id/consent', h((req, res) => pv(res, profiles.setConsent(req.params.id, req.body || {}))));
  app.put('/api/voice/profiles/:id/samples/:sid/review', h((req, res) => pv(res, profiles.reviewSample(req.params.id, req.params.sid, req.body || {}))));
  app.post('/api/voice/profiles/:id/auditions', h((req, res) => { const b = req.body || {}; res.status(202).json({ round: auditions.start(req.params.id, { text: b.text, lines: b.lines, count: b.count, seeds: b.seeds, source: b.source, keep_text: b.keep_text === true, direction: b.direction, language: b.language }) }); }));
  app.get('/api/voice/profiles/:id/auditions', h((req, res) => { noStore(res); res.json({ rounds: auditions.listRounds(req.params.id) }); }));
  app.get('/api/voice/profiles/:id/auditions/:rid', h((req, res) => { noStore(res); res.json({ round: auditions.getRound(req.params.id, req.params.rid) }); }));
  app.patch('/api/voice/profiles/:id/auditions/:rid/candidates/:cid', h((req, res) => res.json({ candidate: auditions.mark(req.params.id, req.params.rid, req.params.cid, req.body || {}) })));
  app.post('/api/voice/profiles/:id/auditions/:rid/candidates/:cid/approve', h((req, res) => res.json(auditions.approve(req.params.id, req.params.rid, req.params.cid, req.body || {}))));
  app.post('/api/voice/profiles/:id/auditions/:rid/candidates/:cid/promote', h(async (req, res) => { const b = req.body || {}; res.status(201).json(await auditions.promote(req.params.id, req.params.rid, req.params.cid, { transcript: b.transcript, name: b.name, clip_index: b.clip_index })); }));
  app.post('/api/voice/profiles/:id/trials', h((req, res) => { const b = req.body || {}; res.status(202).json({ trial: auditions.startTrial(req.params.id, { lines: b.lines, keep_text: b.keep_text === true }) }); }));
  app.get('/api/voice/profiles/:id/trials', h((req, res) => { noStore(res); res.json({ trials: auditions.listTrials(req.params.id) }); }));
  app.get('/api/voice/profiles/:id/trials/:tid', h((req, res) => { noStore(res); res.json({ trial: auditions.getTrial(req.params.id, req.params.tid) }); }));
  app.post('/api/voice/profiles/:id/trials/:tid/accept', h((req, res) => res.json(auditions.acceptTrial(req.params.id, req.params.tid, req.body || {}))));
  app.post('/api/voice/profiles/:id/evaluations', h((req, res) => { const b = req.body || {}; res.status(202).json({ evaluation: auditions.startEvaluation(req.params.id, { scripts: b.scripts, directions: b.directions }) }); }));
  app.get('/api/voice/profiles/:id/evaluations', h((req, res) => { noStore(res); res.json({ evaluations: auditions.listEvaluations(req.params.id) }); }));
  app.get('/api/voice/profiles/:id/evaluations/:eid', h((req, res) => { noStore(res); const evaluation = auditions.getEvaluation(req.params.id, req.params.eid); return evaluation ? res.json({ evaluation }) : nf(res, 'evaluation'); }));
  app.post('/api/voice/profiles/:id/evaluations/:eid/word-integrity', h(async (req, res) => {
    noStore(res); const evaluation = await auditions.checkEvaluationWords(req.params.id, req.params.eid, (req.body || {}).scripts); res.json({ evaluation });
  }));
  app.patch('/api/voice/profiles/:id/evaluations/:eid/takes/:index/review', h((req, res) => res.json({ evaluation: auditions.reviewEvaluation(req.params.id, req.params.eid, req.params.index, (req.body || {}).state, (req.body || {}).note) })));
  app.post('/api/voice/preview', h((req, res) => { const b = req.body || {}; const r = voice.preview({ profileId: String(b.profile_id || ''), text: b.text, direction: b.direction, language: b.language, seed: b.seed, engine: b.engine }); if (r.error) return json(res, r.status || 400, { error: r.error, gate: r.gate }); res.status(202).json(r); }));

  // ── portable voice bank ───────────────────────────────────────────────────────
  app.post('/api/voice/bank/export', h(async (req, res) => {
    const b = req.body || {}, dir = fs.mkdtempSync(path.join(os.tmpdir(), 'dexbank-')), out = path.join(dir, 'voice-bank.zip');
    const cleanup = () => { try { fs.rmSync(dir, { recursive: true, force: true }); } catch (_) {} };
    try { await Bank.exportBank({ profiles, ids: Array.isArray(b.profile_ids) ? b.profile_ids : [], outPath: out, include_audio: b.include_audio === true, include_transcripts: b.include_transcripts === true }); }
    catch (e) { cleanup(); throw e; }
    res.set('Cache-Control', 'no-store'); res.download(out, `dexdiffusion-voice-bank-${new Date().toISOString().slice(0, 10)}.zip`, cleanup);
  }));
  app.post('/api/voice/bank/import', require('express').raw({ type: () => true, limit: '260mb' }), h(async (req, res) => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'dexbank-in-')), f = path.join(dir, 'in.zip');
    try {
      if (!Buffer.isBuffer(req.body) || !req.body.length) return json(res, 400, { error: 'upload a voice bank .zip' });
      fs.writeFileSync(f, req.body, { mode: 0o600 });
      const rep = await Bank.importBank({ profiles, zipPath: f, apply: req.query.apply === '1', on_conflict: req.query.on_conflict === 'skip' ? 'skip' : 'rename' });
      res.status(rep.errors.length ? 422 : 200).json(rep);
    } finally { try { fs.rmSync(dir, { recursive: true, force: true }); } catch (_) {} }
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
  app.post('/api/drama/projects/:id/reparse', h(async (req, res) => { const b = req.body || {}; const r = await drama.reparse(req.params.id, { script: b.script, mode: b.mode, apply: b.apply === true, confirm: b.confirm === true }); res.status(r.ok ? 200 : 422).json(r); }));
  app.get('/api/drama/projects/:id/plan', h((req, res) => { noStore(res); const p = drama.need(req.params.id); const plan = require('./drama-planner').planProduction(p, drama.planContext()); const { chosen, ...out } = plan; res.json({ plan: out }); }));
  app.get('/api/drama/projects/:id/source-coverage', h((req, res) => { const p = drama.need(req.params.id); const D2 = require('./drama'); res.json({ coverage: D2.verifySourceCoverage(p.source_script, D2.parseScript(p.source_script)), recorded: p.source_coverage || null }); }));
  app.post('/api/drama/projects/:id/save', h((req, res) => { const p = dramaStore.save(req.params.id); if (p) chunkStore.flush(p.id); return p ? res.json({ project: drama.view(p), saved_at: p.updated_at, path_hint: 'sdcpp-workflow/state/drama/' + p.id + '.json' }) : nf(res, 'project'); }));
  app.post('/api/drama/projects/:id/unsave', h((req, res) => { const p = dramaStore.unsave(req.params.id); return p ? res.json({ project: drama.view(p) }) : nf(res, 'project'); }));
  app.delete('/api/drama/projects/:id', h((req, res) => res.json({ removed: dramaStore.remove(req.params.id) })));

  const D = require('./drama');
  app.post('/api/drama/projects/:id/lines/:lid/conversions', h(async (req, res) => {
    const b = req.body || {};
    const result = await drama.attachConvertedTake(req.params.id, req.params.lid, { artifactId: String(b.artifact_id || ''), jobId: String(b.job_id || ''), targetProfileId: String(b.target_profile_id || '') });
    res.status(201).json({ take: result.take, word_integrity: result.qa });
  }));
  app.patch('/api/drama/projects/:id/lines/:lid', h((req, res) => { const p = drama.need(req.params.id); const l = D.setLine(p, req.params.lid, req.body || {}); if (!l) return nf(res, 'line'); dramaStore.touch(p); res.json({ project: drama.view(p) }); }));
  app.put('/api/drama/projects/:id/lines/:lid/performance-score', h((req, res) => {
    const p = drama.need(req.params.id), found = D.findLine(p, req.params.lid);
    if (!found) return nf(res, 'line');
    const actor = D.actorFor(p, found.line.speaker_key);
    const profileId = found.line.profile_override || (actor && actor.voice_profile_id);
    const profile = profileId && profiles.get(profileId);
    if (!profile) return json(res, 409, { error: 'bind an approved voice profile before saving phrase directions', gate: 'voice-missing' });
    const b = req.body || {};
    const score = PerformanceScore.createScore({ sourceText: found.line.text, profileId: profile.id, identityVersion: profile.identity_version,
      sceneId: found.scene.id, lineId: found.line.id, engineId: profile.preferred_engine, modelRevision: E.getEngine(profile.preferred_engine)?.revision,
      seed: b.seed == null ? null : b.seed, settings: b.settings || {}, phrases: Array.isArray(b.phrases) ? b.phrases : [] });
    if (found.line.performance_score && found.line.performance_score.source.sha256 === score.source.sha256) {
      score.takes = found.line.performance_score.takes;
      score.createdAt = found.line.performance_score.createdAt;
    }
    D.setLine(p, found.line.id, { performance_score: score }); dramaStore.touch(p);
    res.json({ project: drama.view(p), score });
  }));
  app.post('/api/drama/projects/:id/lines/:lid/phrases/:pid/audition', h((req, res) => {
    const p = drama.need(req.params.id), found = D.findLine(p, req.params.lid), b = req.body || {};
    if (!found) return nf(res, 'line');
    const score = found.line.performance_score;
    if (!score || score.source.text !== found.line.text) return json(res, 409, { error: 'phrase directions are missing or stale', gate: 'performance-score-stale' });
    const phrase = score.phrases.find(x => x.id === req.params.pid);
    if (!phrase) return nf(res, 'phrase');
    const actor = D.actorFor(p, found.line.speaker_key), profileId = found.line.profile_override || (actor && actor.voice_profile_id);
    if (!profileId) return json(res, 409, { error: 'bind a voice profile before auditioning this phrase', gate: 'voice-missing' });
    const profile = profiles.get(profileId), result = voice.preview({ profileId, text: phrase.text, direction: b.direction === undefined ? phrase.delivery : String(b.direction).slice(0, 240), language: profile && profile.language, seed: b.seed });
    if (result.error) return json(res, result.status || 400, { error: result.error, gate: result.gate || 'preview-failed' });
    res.status(202).json({ audition: result, phrase_id: phrase.id, engine: result.engine, direction: b.direction === undefined ? phrase.delivery : String(b.direction).slice(0, 240) });
  }));
  app.delete('/api/drama/projects/:id/lines/:lid', h((req, res) => { const p = drama.need(req.params.id); if (!D.deleteLine(p, req.params.lid)) return nf(res, 'line'); dramaStore.touch(p); res.json({ project: drama.view(p) }); }));
  app.post('/api/drama/projects/:id/scenes/:sid/lines', h((req, res) => { const p = drama.need(req.params.id); const l = D.addLine(p, req.params.sid, req.body || {}); if (!l) return nf(res, 'scene'); dramaStore.touch(p); res.status(201).json({ project: drama.view(p), line_id: l.id }); }));
  app.post('/api/drama/projects/:id/render', h((req, res) => {
    const b = req.body || {}; const run = drama.startRun(req.params.id, { scope: b.scope, sceneId: b.scene_id, lineId: b.line_id, resume: b.resume !== false, alternate: b.alternate === true });
    res.status(202).json({ run: run.id ? drama.runView(run.id) : run, project: drama.view(drama.need(req.params.id)) });
  }));
  app.get('/api/drama/runs/:rid', h((req, res) => { noStore(res); const r = drama.runView(req.params.rid); return r ? res.json({ run: r, project: drama.view(drama.need(r.project_id)) }) : nf(res, 'run'); }));
  app.post('/api/drama/projects/:id/lines/:lid/takes/:tid/select', h((req, res) => { const p = drama.need(req.params.id); if (!D.selectTake(p, req.params.lid, req.params.tid)) return json(res, 400, { error: 'take not found or not complete' }); dramaStore.touch(p); res.json({ project: drama.view(p) }); }));
  app.post('/api/drama/projects/:id/lines/:lid/takes/:tid/decision/:action', h((req, res) => {
    const p = drama.need(req.params.id), action = req.params.action;
    if (!['reject', 'restore', 'pin', 'undo'].includes(action)) return json(res, 404, { error: 'unknown take action' });
    const result = D.decideTake(p, req.params.lid, req.params.tid, action);
    if (!result) return json(res, 409, { error: action === 'undo' ? 'no take decision to undo' : 'take is missing, incomplete, rejected, or cannot be changed' });
    dramaStore.touch(p); res.json({ project: drama.view(p), take: result.take });
  }));
  // One-click production: validates, plans incrementally, reuses valid work, produces only what is missing, assembles and masters.
  app.post('/api/drama/projects/:id/produce', h((req, res) => { const r = producer.produce(req.params.id, req.body || {}); res.status(202).json(Object.assign(r, { project: drama.view(drama.need(req.params.id)) })); }));
  app.get('/api/drama/projects/:id/productions', h((req, res) => { noStore(res); const p = drama.need(req.params.id); res.json({ active: producer.activeFor(p.id), productions: p.productions || [] }); }));
  app.get('/api/drama/productions/:pid', h((req, res) => { noStore(res); const v = producer.get(req.params.pid); if (!v) return nf(res, 'production'); res.json({ production: v, project: drama.view(drama.need(v.project_id)) }); }));
  app.post('/api/drama/productions/:pid/cancel', h((req, res) => { const r = producer.cancel(req.params.pid); res.status(r.ok ? 202 : (r.status === 404 ? 404 : 409)).json(r); }));
  app.post('/api/drama/projects/:id/lines/:lid/takes/:tid/approve', h((req, res) => { drama.approveTake(req.params.id, req.params.lid, req.params.tid, (req.body || {}).approved !== false); res.json({ project: drama.view(drama.need(req.params.id)) }); }));
  app.post('/api/drama/projects/:id/lines/:lid/takes/:tid/adopt', h((req, res) => { drama.adoptLegacyTake(req.params.id, req.params.lid, req.params.tid); res.json({ project: drama.view(drama.need(req.params.id)) }); }));
  app.post('/api/drama/projects/:id/assemble', h(async (req, res) => { const r = await drama.assembleExport(req.params.id, { sceneId: (req.body || {}).scene_id || undefined, historical: (req.body || {}).historical === true }); res.json(Object.assign(r, { project: drama.view(drama.need(req.params.id)) })); }));
  app.post('/api/drama/projects/:id/tracks', h((req, res) => { const t = drama.addTrack(req.params.id, req.body || {}); res.status(201).json({ track: t, project: drama.view(drama.need(req.params.id)) }); }));
  app.put('/api/drama/projects/:id/tracks/:tid', h((req, res) => { const t = drama.updateTrack(req.params.id, req.params.tid, req.body || {}); return t ? res.json({ track: t, project: drama.view(drama.need(req.params.id)) }) : nf(res, 'track'); }));
  app.delete('/api/drama/projects/:id/tracks/:tid', h((req, res) => res.json({ removed: drama.removeTrack(req.params.id, req.params.tid), project: drama.view(drama.need(req.params.id)) })));

  registerDramaStudioRoutes(app, { drama, dramaStore, producer, assembly, derived, profiles, mediaStore, qa, proofs, fxPresets, h, nf, noStore });
  return { profiles, voice, drama, dramaStore, auditions, producer, chunkStore, assembly, derived, qa, proofs, fxPresets, directorPreferences };
}

module.exports = { registerVoiceRoutes, ingestToWav };
