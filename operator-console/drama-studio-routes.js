'use strict';

// HTTP surface for the Audio Drama Studio extras: Cast Bible, FX rack, Sound Director cues, multitrack timeline, pacing, QA,
// production proof & revision reports, delivery settings and portable project packages. Heavy lifting lives in the modules this
// file wires together; everything here is validation, status codes and privacy (no script text in logs or error bodies).

const fs = require('fs');
const os = require('os');
const path = require('path');
const express = require('express');
const D = require('./drama');
const P = require('./drama-planner');
const FX = require('./fx-rack');
const SD = require('./sound-director');
const Pacing = require('./pacing');
const Asr = require('./asr-adapter');
const Boundary = require('./speech-boundary');
const Proof = require('./drama-proof');
const Pkg = require('./drama-package');
const Master = require('./drama-master');
const Tools = require('./audio-tools');
const TL = require('./drama-timeline');

function registerDramaStudioRoutes(app, { drama, dramaStore, producer, assembly, derived, profiles, mediaStore, qa, proofs, fxPresets, h, nf, noStore, tools = Tools }) {
  const need = id => drama.need(id);
  const ok = (res, body) => res.json(body);
  const viewOf = id => drama.view(need(id));

  // ── Cast Bible ─────────────────────────────────────────────────────────────────
  app.put('/api/drama/projects/:id/actors/:aid', h((req, res) => { drama.updateActor(req.params.id, req.params.aid, req.body || {}); ok(res, { project: viewOf(req.params.id) }); }));

  // ── FX rack ────────────────────────────────────────────────────────────────────
  app.get('/api/drama/fx/presets', (req, res) => ok(res, { builtin: FX.listPresets().map(p => Object.assign(p, { chain: FX.presetChain(p.id) })), custom: fxPresets.list(), effects: Object.entries(FX.NODE_TYPES).map(([type, s]) => ({ type, label: s.label, params: Object.fromEntries(Object.entries(s.params).map(([k, [min, max, def]]) => [k, { min, max, default: def }])) })), max_effects: 12 }));
  app.post('/api/drama/fx/validate', h((req, res) => { const v = FX.validate((req.body || {}).chain); const c = FX.compile(v.chain); ok(res, { ok: v.ok, errors: v.errors, warnings: v.warnings, chain: v.chain, identity: FX.identity(v.chain), tail_s: c.tail_s, effects: c.nodes }); }));
  app.post('/api/drama/fx/presets', h((req, res) => res.status(201).json({ preset: fxPresets.save(req.body || {}) })));
  app.put('/api/drama/fx/presets/:pid', h((req, res) => { const p = fxPresets.update(req.params.pid, req.body || {}); return p ? ok(res, { preset: p }) : nf(res, 'preset'); }));
  app.delete('/api/drama/fx/presets/:pid', h((req, res) => ok(res, { removed: fxPresets.remove(req.params.pid) })));

  // ── timeline ───────────────────────────────────────────────────────────────────
  app.get('/api/drama/projects/:id/scenes/:sid/timeline', h((req, res) => { noStore(res); ok(res, { timeline: drama.timelineView(req.params.id, req.params.sid) }); }));
  app.post('/api/drama/projects/:id/scenes/:sid/preview', h(async (req, res) => { const r = await drama.previewScene(req.params.id, req.params.sid); ok(res, Object.assign(r, { timeline: drama.timelineView(req.params.id, req.params.sid) })); }));
  app.put('/api/drama/projects/:id/lines/:lid/clip', h((req, res) => { const o = drama.setClip(req.params.id, req.params.lid, req.body || {}); ok(res, { overrides: o, project: viewOf(req.params.id) }); }));
  app.post('/api/drama/projects/:id/markers', h((req, res) => { const b = req.body || {}; const m = drama.markers(req.params.id, b.kind === 'region' ? 'add-region' : 'add-marker', b); res.status(201).json({ marker: m }); }));
  app.delete('/api/drama/projects/:id/markers/:mid', h((req, res) => ok(res, { removed: drama.markers(req.params.id, 'remove', { id: req.params.mid }) })));
  app.get('/api/voice/peaks/:aid', h(async (req, res) => {
    const rec = mediaStore.resolve(req.params.aid); if (!rec) return nf(res, 'artifact');
    const bins = Math.max(50, Math.min(4000, Number(req.query.bins) || 800));
    const d = await derived.ensure(['peaks.v1', rec.sha256, bins], { ext: 'json', kind: 'peaks', lineage: { source_artifact_id: rec.artifact_id, source_sha256: rec.sha256 } }, async dest => { fs.writeFileSync(dest, JSON.stringify(await tools.peaks(rec.path, { bins }))); });
    noStore(res); res.type('application/json').send(fs.readFileSync(d.path));
  }));
  app.get('/api/drama/derived/:key', h((req, res) => {
    const e = /^[a-f0-9]{64}$/.test(req.params.key) && derived.get(req.params.key); if (!e || e.ext !== 'wav') return nf(res, 'derived audio');
    noStore(res); res.set('X-Content-Type-Options', 'nosniff'); res.type('audio/wav'); res.sendFile(e.path);
  }));

  app.post('/api/drama/projects/:id/tracks/:tid/split', h((req, res) => { const t = drama.splitTrack(req.params.id, req.params.tid, (req.body || {}).at_s); ok(res, { tracks: t, project: viewOf(req.params.id) }); }));

  // ── tracks & Sound Director ────────────────────────────────────────────────────
  app.get('/api/drama/projects/:id/cues', h((req, res) => { noStore(res); const p = need(req.params.id); ok(res, { cues: SD.scriptCues(p).map(c => Object.assign(c, { track: p.tracks.find(t => t.id === c.track_id) || null })), issues: SD.cueIssues(p) }); }));
  app.post('/api/drama/projects/:id/cues/:lid/bind', h((req, res) => { const p = need(req.params.id); const t = SD.bind(p, req.params.lid, req.body || {}, mediaStore); dramaStore.touch(p); ok(res, { track: t, project: viewOf(p.id) }); }));
  app.delete('/api/drama/projects/:id/cues/:lid/bind', h((req, res) => { const p = need(req.params.id); const r = SD.unbind(p, req.params.lid); dramaStore.touch(p); ok(res, { removed: r, project: viewOf(p.id) }); }));
  app.put('/api/drama/projects/:id/cues/:lid', h((req, res) => { const p = need(req.params.id); SD.setRequired(p, req.params.lid, (req.body || {}).required === true); dramaStore.touch(p); ok(res, { project: viewOf(p.id) }); }));
  app.get('/api/drama/projects/:id/cues/:lid/suggest', h((req, res) => ok(res, SD.suggest(need(req.params.id), req.params.lid, mediaStore))));
  app.post('/api/drama/procedural', h(async (req, res) => { const rec = await SD.generateProcedural(req.body || {}, { mediaStore, tools }); res.status(201).json({ artifact: { artifact_id: rec.artifact_id, url: rec.safe_url, duration: rec.duration, sha256: rec.sha256 } }); }));

  // ── pacing (optional) ──────────────────────────────────────────────────────────
  app.get('/api/drama/pacing/presets', (req, res) => ok(res, { presets: Object.entries(Pacing.PRESETS).map(([id, p]) => Object.assign({ id }, p)), note: 'Pacing is off by default and never applied to the clean take; it creates a derived, verified stretched version.' }));
  app.post('/api/drama/projects/:id/lines/:lid/pacing-preview', h(async (req, res) => {
    const p = need(req.params.id), f = D.findLine(p, req.params.lid); if (!f) return nf(res, 'line');
    const plan = P.planProduction(p, drama.planContext()); const take = plan.chosen.get(f.line.id) || (f.line.takes || []).find(t => t.id === f.line.active_take_id && t.status === 'complete'); const art = take && mediaStore.resolve(take.artifact_id);
    if (!art) return res.status(409).json({ error: 'this line has no generated take to measure', gate: 'missing-takes' });
    const m = Pacing.measureFile(f.line.text, art.path); const b = req.body || {}; const t = Pacing.planTempo({ measured_wpm: m.wpm, target_wpm: b.target_wpm, tempo: b.tempo });
    if (t.blocked) return res.status(400).json({ error: t.warnings[0], gate: 'pacing-range', warnings: t.warnings, original: m });
    const d = await derived.ensure(['pace.v1', art.sha256, t.tempo], { ext: 'wav', kind: 'pace-wav', lineage: { source_artifact_id: art.artifact_id, source_sha256: art.sha256, tempo: t.tempo, op: 'atempo' } }, async dest => { const r = await tools.timeStretch(art.path, dest, t.tempo); return { duration: r.duration }; });
    const after = Pacing.measureFile(f.line.text, d.path);
    ok(res, { tempo: t.tempo, warnings: t.warnings, original: Object.assign({ url: art.safe_url }, m), result: Object.assign({ url: '/api/drama/derived/' + d.key }, after), verified: true });
  }));

  // ── quality control ────────────────────────────────────────────────────────────
  app.get('/api/drama/qa/status', (req, res) => ok(res, { asr: Asr.detect(), silero: Boundary.detectSilero(), notes: ['Speech verification runs only on this Mac with whisper.cpp and a model you have installed; nothing is downloaded or sent anywhere.', 'ASR disagreement is advisory, not proof.'] }));
  app.post('/api/drama/projects/:id/qa', h(async (req, res) => {
    const p = need(req.params.id), ctx = drama.planContext(), plan = P.planProduction(p, ctx);
    const items = [...plan.chosen].map(([lineId, take]) => { const line = D.findLine(p, lineId).line, info = P.lineFingerprint(p, line, ctx); return { line, take, expected: info.fp ? info.fp.spoken_text : line.text, words: (take.measure && take.measure.words) || null, inputsSha: info.fp ? info.fp.inputs_sha : null }; });
    const r = await qa.run(items, { asr: (req.body || {}).asr === false ? false : 'auto' });
    for (const l of r.lines) { const f = D.findLine(p, l.line_id); const t = f && f.line.takes.find(x => x.id === l.take_id); if (t) t.qa = l.qa; }
    dramaStore.touch(p); ok(res, { summary: r.summary, lines: r.lines.map(l => ({ line_id: l.line_id, take_id: l.take_id, integrity_ok: l.qa.integrity.ok, hard: l.qa.integrity.hard, advisory: l.qa.integrity.advisory, asr: l.qa.asr && { status: l.qa.asr.status, wer: l.qa.asr.wer, incomplete: l.qa.asr.incomplete, missing: l.qa.asr.missing, repeated: l.qa.asr.repeated, pronunciation_suspects: l.qa.asr.pronunciation_suspects, reason: l.qa.asr.reason, limitations: l.qa.asr.limitations }, boundaries: l.qa.boundaries })), project: drama.view(p) });
  }));
  app.post('/api/drama/projects/:id/lines/:lid/boundaries', h((req, res) => {
    const p = need(req.params.id), f = D.findLine(p, req.params.lid); if (!f) return nf(res, 'line');
    const take = P.planProduction(p, drama.planContext()).chosen.get(f.line.id); const art = take && mediaStore.resolve(take.artifact_id); if (!art) return res.status(409).json({ error: 'no current take for this line', gate: 'missing-takes' });
    const A = require('./voice-audio'); const b = Boundary.detectBoundaries(A.parseWav(fs.readFileSync(art.path)), { padLeadMs: Number((req.body || {}).pad_lead_ms) || 80, padTailMs: Number((req.body || {}).pad_tail_ms) || 120 });
    ok(res, { boundaries: b, tempo: ((p.timeline.clip_overrides[f.line.id] || {}).pacing && 1) || 1 });
  }));
  app.post('/api/drama/projects/:id/lines/:lid/apply-trim', h((req, res) => {
    const p = need(req.params.id), f = D.findLine(p, req.params.lid); if (!f) return nf(res, 'line');
    const take = P.planProduction(p, drama.planContext()).chosen.get(f.line.id); const art = take && mediaStore.resolve(take.artifact_id); if (!art) return res.status(409).json({ error: 'no current take for this line', gate: 'missing-takes' });
    const A = require('./voice-audio'); const b = Boundary.detectBoundaries(A.parseWav(fs.readFileSync(art.path))); if (!b.suggested_trim) return res.status(409).json({ error: 'no clear speech boundaries were found; nothing to trim', gate: 'no-suggestion' });
    const tl = TL.buildSceneTimeline(p, f.scene, { takeFor: l => P.planProduction(p, drama.planContext()).chosen.get(l.id) || null, media: mediaStore }); const c = tl.clips.find(x => x.line_id === f.line.id); const tempo = (c && c.tempo) || 1;
    const o = drama.setClip(p.id, f.line.id, { trim_start_s: b.suggested_trim.start_s / tempo, trim_end_s: b.suggested_trim.end_s / tempo });
    ok(res, { overrides: o, suggestion: b.suggested_trim, note: 'Non-destructive: the original take is untouched; reset the clip to undo.', project: viewOf(p.id) });
  }));
  app.post('/api/drama/projects/:id/lines/:lid/takes/:tid/review', h((req, res) => {
    const p = need(req.params.id), f = D.findLine(p, req.params.lid); const t = f && f.line.takes.find(x => x.id === req.params.tid); if (!t) return nf(res, 'take');
    const st = String((req.body || {}).state || ''); if (!['heard-ok', 'needs-work', 'clear'].includes(st)) return res.status(400).json({ error: 'state must be heard-ok, needs-work or clear' });
    if (st === 'clear') delete t.human_review; else t.human_review = { state: st, note: String((req.body || {}).note || '').slice(0, 300), at: Date.now() };
    if (st === 'needs-work') t.review_required = true; else delete t.review_required;
    dramaStore.touch(p); ok(res, { project: viewOf(p.id) });
  }));

  // ── delivery, mastering, mix ───────────────────────────────────────────────────
  app.get('/api/drama/mastering/presets', (req, res) => ok(res, { presets: Object.entries(Master.PRESETS).map(([id, p]) => ({ id, label: p.label, target_lufs: p.lufs, ceiling_dbtp: p.tp, compress: p.compress })), formats: ['mp3', 'm4b', 'm4a', 'flac'], note: 'WAV (24-bit, 48 kHz, stereo) is always produced. Loudness is measured (ITU-R BS.1770) before and after; nothing is claimed that was not re-measured.' }));
  app.put('/api/drama/projects/:id/delivery', h((req, res) => { const p = need(req.params.id), b = req.body || {}; const formats = (b.formats === undefined ? (p.delivery || {}).formats || ['mp3', 'm4b'] : (Array.isArray(b.formats) ? b.formats : [])).filter(f => ['mp3', 'm4b', 'm4a', 'flac'].includes(f)); p.delivery = { formats: [...new Set(formats)], stems: b.stems === undefined ? !!(p.delivery || {}).stems : b.stems === true }; dramaStore.touch(p); ok(res, { delivery: p.delivery, project: viewOf(p.id) }); }));
  app.put('/api/drama/projects/:id/mastering', h((req, res) => { const p = need(req.params.id), b = req.body || {}; const cfg = { preset: b.preset || 'drama' }; if (b.target_lufs !== undefined && b.target_lufs !== null) cfg.target_lufs = Number(b.target_lufs); if (b.ceiling_dbtp !== undefined && b.ceiling_dbtp !== null) cfg.ceiling_dbtp = Number(b.ceiling_dbtp); if (b.compress !== undefined) cfg.compress = !!b.compress; try { Master.resolvePreset(cfg); } catch (e) { return res.status(400).json({ error: e.message }); } p.mastering = cfg; dramaStore.touch(p); ok(res, { mastering: p.mastering, project: viewOf(p.id) }); }));
  app.put('/api/drama/projects/:id/mix', h((req, res) => { const p = need(req.params.id), b = req.body || {}; const num = (v, lo, hi) => (v === undefined ? undefined : Math.max(lo, Math.min(hi, Number(v)))); const m = Object.assign({}, p.mix || {}); for (const [k, lo, hi] of [['duck_db', -30, 0], ['duck_attack_s', 0.01, 2], ['duck_release_s', 0.05, 5], ['duck_lookahead_s', 0, 1]]) { const v = num(b[k], lo, hi); if (v !== undefined && Number.isFinite(v)) m[k] = v; }
    if (b.dialogue_leveling !== undefined) m.dialogue_leveling = b.dialogue_leveling === null || b.dialogue_leveling === false ? null : Math.max(-40, Math.min(-6, Number(b.dialogue_leveling))); p.mix = m; dramaStore.touch(p); ok(res, { mix: TL.mixSettings(p), project: viewOf(p.id) }); }));

  // ── proof, acceptance, revisions, history ────────────────────────────────────────
  app.get('/api/drama/productions/:pid/proof', h((req, res) => { noStore(res); const pr = proofs.get(req.params.pid); if (!pr) return nf(res, 'proof'); ok(res, { proof: pr, verification: Proof.verifyProof(pr, mediaStore) }); }));
  app.post('/api/drama/productions/:pid/acceptance', h((req, res) => { const pr = proofs.setAcceptance(req.params.pid, req.body || {}); if (!pr) return nf(res, 'proof'); const p = dramaStore.get(pr.project_id); if (p) { const e = (p.productions || []).find(x => x.id === pr.production_id); if (e) { e.acceptance = pr.human_acceptance; dramaStore.touch(p); } } ok(res, { human_acceptance: pr.human_acceptance }); }));
  app.get('/api/drama/projects/:id/revisions', h((req, res) => {
    noStore(res); const p = need(req.params.id), ctx = drama.planContext();
    const snap = id => { if (!id || id === 'current') return Proof.buildSnapshot(p, ctx); const pr = proofs.get(id); if (!pr || pr.project_id !== p.id) return null; return pr.snapshot; };
    const from = snap(req.query.from), to = snap(req.query.to || 'current'); if (!from || !to) return nf(res, 'production snapshot');
    ok(res, { report: Proof.compareSnapshots(from, to), from: req.query.from || null, to: req.query.to || 'current' });
  }));
  app.get('/api/drama/projects/:id/history', h((req, res) => {
    noStore(res); const p = need(req.params.id), cur = p.project_master || {};
    ok(res, { productions: (p.productions || []).map(x => { const master = x.artifacts && x.artifacts.master && mediaStore.resolve(x.artifacts.master); const isCurrent = !!cur.artifact_id && x.artifacts && x.artifacts.master === cur.artifact_id && x.source_rev === (p.source_rev || 1);
      return Object.assign({}, x, { current: isCurrent, historical: x.status === 'complete' && !isCurrent, label: x.status === 'complete' ? (isCurrent ? 'CURRENT' : 'HISTORICAL') : String(x.status).toUpperCase(), master: master ? { artifact_id: master.artifact_id, url: master.safe_url, download_url: master.download_url, duration: master.duration } : null,
        outputs: Object.fromEntries(Object.entries((x.artifacts && x.artifacts.outputs) || {}).map(([k, id]) => { const r = mediaStore.resolve(id); return [k, r ? { artifact_id: id, url: r.safe_url, download_url: r.download_url } : null]; })) }); }) });
  }));

  // ── portable project package ───────────────────────────────────────────────────
  app.post('/api/drama/projects/:id/package', h(async (req, res) => {
    const p = need(req.params.id), b = req.body || {}, dir = fs.mkdtempSync(path.join(os.tmpdir(), 'dexpkg-out-')), out = path.join(dir, 'drama-package.zip'), cleanup = () => { try { fs.rmSync(dir, { recursive: true, force: true }); } catch (_) {} };
    try { await Pkg.exportPackage({ project: p, profiles, mediaStore, include: b.include || {}, outPath: out, plan: P.planProduction(p, drama.planContext()) }); } catch (e) { cleanup(); throw e; }
    res.set('Cache-Control', 'no-store'); res.download(out, `dexdiffusion-drama-${p.id}.zip`, cleanup);
  }));
  app.post('/api/drama/packages/import', express.raw({ type: () => true, limit: '1gb' }), h(async (req, res) => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'dexpkg-in-')), f = path.join(dir, 'in.zip');
    try {
      if (!Buffer.isBuffer(req.body) || !req.body.length) return res.status(400).json({ error: 'upload a drama package .zip' });
      fs.writeFileSync(f, req.body, { mode: 0o600 });
      const rep = await Pkg.importPackage({ zipPath: f, drama, store: dramaStore, profiles, mediaStore, apply: req.query.apply === '1' });
      res.status(rep.errors.length ? 422 : 200).json(rep);
    } finally { try { fs.rmSync(dir, { recursive: true, force: true }); } catch (_) {} }
  }));
}

module.exports = { registerDramaStudioRoutes };
