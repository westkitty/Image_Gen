'use strict';

// Drama render orchestration. Every line render is a normal voice render job (durable generic job,
// heavy-compute lease, canonical audio store) created through the voice service; this layer adds
// takes, sequential scene/project runs with resume, and final assembly. Dialogue is never copied into
// generic job state (renders pass saveText:false) regardless of whether the project itself is saved.

const fs = require('fs');
const os = require('os');
const path = require('path');
const crypto = require('crypto');
const D = require('./drama');
const A = require('./voice-audio');
const E = require('./voice-engines');
const F = require('./drama-fingerprint');
const P = require('./drama-planner');
const R = require('./drama-reparse');
const FX = require('./fx-rack');
const Pacing = require('./pacing');
const TL = require('./drama-timeline');
const SD = require('./sound-director');

const TRACK_ROLES = ['music', 'ambience', 'sfx'];
const slug = s => String(s || 'drama').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 40) || 'drama';

function createDramaService({ store, voice, profiles, mediaStore, llmChat = null, engineAvailable = null, assembly = null, now = () => Date.now() }) {
  const runs = new Map();
  const planContext = () => ({ profiles, media: mediaStore, engineAvailable });
  let producer = null;
  const attachProducer = pr => { producer = pr; };

  // ── project views ─────────────────────────────────────────────────────────
  function profileBrief(id) { const p = id && profiles.get(id); return p ? { id: p.id, name: p.name, type: p.type, validation: p.validation && p.validation.state, preferred_engine: p.preferred_engine } : null; }
  function lineView(l, ctx, p) {
    const info = p && ctx ? P.lineFingerprint(p, l, ctx) : { fp: null };
    const takes = (l.takes || []).map(t => { const a = t.artifact_id && mediaStore.resolve(t.artifact_id); return Object.assign({}, t, { url: a ? a.safe_url : null, download_url: a ? a.download_url : null, active: t.id === l.active_take_id, state: D.takeState(t, info.fp) }); });
    const current = takes.some(t => t.state.freshness === 'current' && t.status === 'complete');
    return Object.assign({}, l, { takes, status: D.lineStatus(l), freshness: !takes.some(t => t.status === 'complete') ? 'none' : current ? 'current' : 'stale' });
  }
  // Re-resolve durable profile IDs on every view/render; profiles can be removed or invalidated.
  function unresolvedProfiles(p, sceneId, lineId) {
    const out = new Map();
    for (const { line } of D.renderableLines(p, sceneId)) {
      if (lineId && line.id !== lineId) continue;
      const actor = D.actorFor(p, line.speaker_key);
      const id = line.profile_override || (actor && actor.voice_profile_id);
      const profile = id && profiles.get(id);
      if (!profile || (profile.validation && profile.validation.state === 'invalid')) {
        const item = out.get(line.speaker_key) || { speaker: line.speaker, key: line.speaker_key, lines: 0,
          reason: !id ? 'unassigned' : !profile ? 'profile-missing' : 'profile-invalid' };
        item.lines++; out.set(line.speaker_key, item);
      }
    }
    return [...out.values()];
  }
  // What the actor's voice engine can honestly do; unsupported items are reported with the recorded evidence.
  function permittedFeatures(a) {
    const pr = a.voice_profile_id && profiles.get(a.voice_profile_id); if (!pr) return null;
    const eng = E.getEngine(pr.preferred_engine || (E.compatibleEngines(pr) || [])[0]); if (!eng) return null;
    const c = eng.capabilities, ev = eng.evidence || {};
    return { engine: eng.id, label: eng.label, delivery_direction: { ok: !!c.delivery_instructions, reason: c.delivery_instructions ? null : (ev.delivery_instructions || 'not supported') }, speed: { ok: !!c.speed_control }, seed: { ok: !!c.deterministic_seed }, cached_voice_prompt: { ok: false, reason: ev.prompt_caching || 'not supported by the installed runtime' }, paralinguistic_tags: { ok: !!c.paralinguistic_tags } };
  }
  function view(p) {
    const lineJobs = {};
    for (const r of runs.values()) if (r.project_id === p.id && r.status === 'running') lineJobs.active_run = r.id;
    const ctx = planContext();
    const plan = P.planProduction(p, ctx);
    return {
      id: p.id, title: p.title, saved: !!p.saved, schema: p.schema, settings: p.settings, parse_warnings: p.parse_warnings || [], source_script: p.source_script,
      source: { rev: p.source_rev || 1, sha256: p.source_sha256 || null, coverage: p.source_coverage || null },
      scenes: p.scenes.map(s => ({ id: s.id, title: s.title, lines: s.lines.map(l => lineView(l, ctx, p)) })),
      actors: p.actors.map(a => Object.assign({}, a, { permitted_features: permittedFeatures(a), profile: profileBrief(a.voice_profile_id), lines: D.allLines(p).filter(x => x.line.speaker_key === a.speaker_key && x.line.kind !== 'direction').length })),
      unresolved: unresolvedProfiles(p), tracks: p.tracks, exports: p.exports.map(e => Object.assign({}, e, { url: (mediaStore.resolve(e.artifact_id) || {}).safe_url || null, download_url: (mediaStore.resolve(e.artifact_id) || {}).download_url || null })),
      plan: { ready: plan.ready, work_required: plan.work_required, counts: plan.counts, blocking_errors: plan.blocking_errors, review_items: plan.review_items.length, asset_problems: plan.asset_problems.length,
        assembly: plan.assembly.map(a => ({ scene_id: a.scene_id, action: a.action, reason: a.reason || null })), cast_problems: plan.cast_problems },
      mastering: p.mastering || null, delivery: p.delivery || null, mix: TL.mixSettings(p), cue_settings: p.cue_settings || {}, markers: (p.timeline && p.timeline.markers) || [],
      scene_masters: Object.fromEntries(Object.entries(p.scene_masters || {}).map(([sid, m]) => { const r = mediaStore.resolve(m.artifact_id); return [sid, { artifact_id: m.artifact_id, duration: m.duration, assembly_fp: m.assembly_fp, url: r ? r.safe_url : null, download_url: r ? r.download_url : null }]; })),
      archived_lines: (p.archived_lines || []).length, productions: (p.productions || []).slice(0, 5), active_production: producer ? producer.activeFor(p.id) : null,
      project_master: p.project_master ? Object.assign({}, p.project_master, { url: (mediaStore.resolve(p.project_master.artifact_id) || {}).safe_url || null, download_url: (mediaStore.resolve(p.project_master.artifact_id) || {}).download_url || null }) : null,
      active_run: lineJobs.active_run || null, created_at: p.created_at, updated_at: p.updated_at,
    };
  }
  const need = id => { const p = store.get(id); if (!p) throw Object.assign(new Error('drama project not found'), { status: 404 }); return p; };

  // ── parse / create ──────────────────────────────────────────────────────────
  async function parse(script, { mode = 'deterministic', narrator } = {}) {
    if (!String(script || '').trim()) return { ok: false, errors: ['paste a script first'] };
    if (mode === 'llm') {
      if (!llmChat) return { ok: false, errors: ['no local model is configured for LLM parsing'] };
      const r = await D.parseWithLlm(script, { chat: llmChat, narrator });
      return r.ok ? { ok: true, parsed: r.parsed, mode } : { ok: false, errors: r.errors, rejected: r.rejected, mode };
    }
    const parsed = D.parseScript(script, { narrator });
    return { ok: true, parsed, mode: 'deterministic' };
  }
  async function createProject({ title, script, mode, settings }) {
    const r = await parse(script, { mode, narrator: settings && settings.narrator_name });
    if (!r.ok) return r;
    const p = store.create({ title, source_script: script, parsed: r.parsed, settings });
    return { ok: true, project: view(p), mode: r.mode };
  }
  // Safe re-parse: preview by default; apply (with confirm for ambiguous matches) keeps line identities and recordings.
  async function reparse(id, { script, mode, apply = false, confirm = false }) {
    const r = await parse(script, { mode });
    if (!r.ok) return r;
    const p = need(id);
    const out = R.reparse(p, String(script), r.parsed, { apply: !!apply, confirm: !!confirm });
    if (out.applied) store.touch(p);
    return { ok: true, applied: out.applied, preview: out.preview, project: view(p) };
  }

  // ── rendering ───────────────────────────────────────────────────────────────
  // Starts ONE render (a new take). Resolves when the take reaches a terminal state.
  async function renderTake(projectId, lineId, { seed, onJob } = {}) {
    const p = need(projectId), f = D.findLine(p, lineId);
    if (!f) throw Object.assign(new Error('line not found'), { status: 404 });
    const { scene, line } = f;
    if (line.render === false || line.kind === 'direction' || !String(line.text).trim()) throw Object.assign(new Error('this line is not renderable'), { status: 400 });
    const info = P.lineFingerprint(p, line, planContext());
    if (info.problem && info.problem.reason === 'unassigned') throw Object.assign(new Error(`assign a voice to ${line.speaker} first`), { status: 400, gate: 'unresolved-speaker' });
    if (info.problem) throw Object.assign(new Error(`${line.speaker}: voice is ${info.problem.reason}${info.problem.errors && info.problem.errors.length ? ' (' + info.problem.errors.join('; ') + ')' : ''}`), { status: 400, gate: info.problem.reason === 'engine-unavailable' ? 'engine-unavailable' : 'unresolved-speaker' });
    const { spoken_text: spoken, ...fpRecord } = info.fp;
    const res = voice.renderText({ profileId: info.profile_id, text: spoken, direction: info.direction, seed, engine: info.engineId, operation: 'drama-line', saveText: false,
      language: info.language, speed: info.fp.speed || undefined, meta: { drama: { project_id: p.id, scene_id: scene.id, line_id: line.id } }, safeParams: { project_id: p.id, line_id: line.id } });
    if (res.error) {
      const t = D.addTake(p, lineId, { profile_id: info.profile_id, engine: null, seed: seed == null ? null : seed, status: 'failed', error: res.error, gate: res.gate || null });
      store.touch(p); return { take: t, failed: true, error: res.error };
    }
    const take = D.addTake(p, lineId, { profile_id: info.profile_id, engine: res.engine, seed: res.seed, job_id: res.job_id, fingerprint: fpRecord, render_sha: F.renderFingerprint(info.fp, res.seed),
      source_rev: p.source_rev || 1, settings: { direction: info.direction, delivery: res.delivery, chunks: res.chunks, seeded: !!(E.getEngine(res.engine) && E.getEngine(res.engine).capabilities.deterministic_seed) }, status: 'rendering' });
    store.touch(p);
    if (onJob) onJob(res.job_id, take);
    const d = await voice.waitJob(res.job_id, { pollMs: 1200 });
    const p2 = store.get(projectId); if (!p2) return { take, failed: true, error: 'project was removed' };
    if (d && d.status === 'COMPLETE' && d.artifact) D.completeTake(p2, lineId, take.id, { status: 'complete', artifact_id: d.artifact.artifact_id, duration: d.artifact.duration, chunks: res.chunks, sha256: d.artifact.sha256, completed_at: now() });
    else D.completeTake(p2, lineId, take.id, { status: 'failed', error: (d && d.error) || 'render failed', gate: d && d.gate });
    store.touch(p2);
    return { take: D.findLine(p2, lineId).line.takes.find(t => t.id === take.id), failed: !(d && d.status === 'COMPLETE'), error: d && d.error };
  }

  // scope: line | scene | project. resume (default) renders only lines without a generated take;
  // alternate:true / force:true always adds NEW takes (never replaces).
  function startRun(projectId, { scope = 'project', sceneId, lineId, resume = true, alternate = false } = {}) {
    const p = need(projectId);
    const blocked = unresolvedProfiles(p, scope === 'scene' ? sceneId : undefined, scope === 'line' ? lineId : undefined);
    if (blocked.length) throw Object.assign(new Error('assign voices to: ' + blocked.map(b => `${b.speaker} (${b.lines} line${b.lines > 1 ? 's' : ''})`).join(', ')), { status: 400, gate: 'unresolved-speaker', unresolved: blocked });
    let lines;
    if (scope === 'line') { const f = D.findLine(p, lineId); if (!f) throw Object.assign(new Error('line not found'), { status: 404 }); lines = [f]; }
    else lines = D.renderableLines(p, scope === 'scene' ? sceneId : undefined);
    if (scope !== 'line' && resume && !alternate) {
      const plan = P.planProduction(p, planContext());
      const need_ = new Set(plan.lines.filter(l => l.state === 'new' || l.state === 'stale').map(l => l.line_id));
      lines = lines.filter(x => need_.has(x.line.id));
    }
    if (!lines.length) return { id: null, status: 'complete', total: 0, done: 0, note: 'nothing to render: every line already has a current take' };
    for (const r of runs.values()) if (r.project_id === projectId && r.status === 'running') throw Object.assign(new Error('a render is already running for this project'), { status: 409 });
    if (producer && producer.isBusy(projectId)) throw Object.assign(new Error('a full production is running for this project; wait for it or cancel it'), { status: 409, gate: 'production-running' });
    const run = { id: 'run-' + crypto.randomBytes(4).toString('hex'), project_id: projectId, scope, scene_id: sceneId || null, status: 'running', total: lines.length, done: 0, failed: 0,
      index: 0, active_line_id: null, active_job_id: null, queue: lines.map(x => x.line.id), errors: [], started_at: now(), finished_at: null };
    runs.set(run.id, run);
    (async () => {
      for (const x of lines) {
        run.index++; run.active_line_id = x.line.id; run.active_job_id = null;
        try {
          const r = await renderTake(projectId, x.line.id, { onJob: jid => { run.active_job_id = jid; } });
          if (r.failed) { run.failed++; run.errors.push({ line_id: x.line.id, speaker: x.line.speaker, error: r.error }); } else run.done++;
        } catch (e) { run.failed++; run.errors.push({ line_id: x.line.id, speaker: x.line.speaker, error: e.message }); }
      }
      run.active_line_id = null; run.active_job_id = null; run.status = run.failed ? (run.done ? 'partial' : 'failed') : 'complete'; run.finished_at = now();
    })().catch(e => { run.status = 'failed'; run.errors.push({ error: e.message }); run.finished_at = now(); });
    return run;
  }
  function runView(id) {
    const r = runs.get(id); if (!r) return null;
    const jobView = r.active_job_id ? voice.describe(r.active_job_id) : null;
    return Object.assign({}, r, { active: jobView ? { job_id: jobView.job_id, status: jobView.status, label: jobView.label, progress: jobView.progress } : null,
      line_label: r.active_line_id ? `line ${r.index} / ${r.total}` : null });
  }

  // ── assembly / export ─────────────────────────────────────────────────────
  // Current exports use ONLY recordings that match today's inputs. historical:true builds a clearly labelled snapshot
  // from the selected (possibly outdated) takes; it is never presented as the current master.
  // New streaming pipeline (FFmpeg-backed, bounded memory). The in-memory legacy assembler below is kept only for hosts without it and refuses long programmes.
  async function assembleExportStreaming(projectId, { sceneId, historical = false, internal = false, delivery, mastering } = {}) {
    const p = need(projectId), ctx = planContext(), plan = P.planProduction(p, ctx);
    const scopeLines = D.renderableLines(p, sceneId).map(x => x.line);
    const selected = line => (line.takes || []).find(x => x.id === line.active_take_id && x.status === 'complete') || null;
    const stateOf = new Map(plan.lines.map(l => [l.line_id, l]));
    const stale = [];
    if (historical) { for (const line of scopeLines) { const t = selected(line); if (!t) { const e = new Error(`${scopeLines.filter(l => !selected(l)).length} renderable line(s) have no generated take`); e.gate = 'missing-takes'; e.missing = scopeLines.filter(l => !selected(l)).map(l => ({ scene_id: D.findLine(p, l.id).scene.id, line_id: l.id, speaker: l.speaker, state: 'missing' })); throw e; } const st = D.takeState(t, P.lineFingerprint(p, line, ctx).fp); if (st.freshness !== 'current') stale.push({ line_id: line.id, state: st.label }); } }
    else {
      const bad = scopeLines.filter(l => !plan.chosen.has(l.id));
      if (bad.length) { const e = new Error(`${bad.length} renderable line(s) have no current generated take`); e.gate = 'missing-takes'; e.missing = bad.map(l => { const st = stateOf.get(l.id) || {}; return { scene_id: D.findLine(p, l.id).scene.id, line_id: l.id, speaker: l.speaker, state: (l.takes || []).some(t => t.status === 'complete') ? 'stale' : (st.state === 'blocked' ? 'blocked' : 'missing'), reason: st.reason || null }; }); throw e; }
    }
    if (!scopeLines.length) { const e = new Error('nothing to assemble: no renderable lines'); e.gate = 'empty'; throw e; }
    const takeFor = historical ? selected : l => plan.chosen.get(l.id) || null;
    const sceneIds = (sceneId ? [sceneId] : p.scenes.map(s => s.id)).filter(id => D.renderableLines(p, id).length);
    const entries = sceneIds.map(id => { const a = plan.assembly.find(x => x.scene_id === id); return { scene_id: id, title: (p.scenes.find(s => s.id === id) || {}).title, action: historical || !a || a.action !== 'reuse' ? 'rebuild' : 'reuse', fingerprint: a && a.fingerprint }; });
    const kind = historical ? 'historical' : 'current';
    let record, artifact, extra = {};
    if (sceneId) {
      const out = await assembly.scene(p, sceneId, { takeFor, stems: false });
      record = out.record; artifact = out.artifact; extra = { scenes: [{ id: sceneId, start_s: 0, end_s: out.frames / 48000 }], items: out.lines.map(l => { const line = scopeLines.find(x => x.id === l.line_id); const t = line && takeFor(line); return { scene_id: sceneId, line_id: l.line_id, take_id: t && t.id, speaker: line && line.speaker, start_s: l.start_s, duration_s: l.end_s - l.start_s, speech_inputs_sha: (t && t.fingerprint && t.fingerprint.inputs_sha) || null, take_sha256: (t && t.sha256) || null }; }), sample_rate: 48000, channels: 2 };
      if (!historical) { p.scene_masters[sceneId] = { assembly_fp: out.fingerprint.sha, artifact_id: out.artifact.artifact_id, sha256: out.artifact.sha256, duration: out.artifact.duration, frames: out.frames, dialogue: out.dialogue, lines: out.lines, stems: out.stems, built_at: now() }; }
    } else {
      const res = await assembly.build(p, { entries, takeFor, delivery, mastering, historical, persist: () => store.touch(p) });
      let out = res.project, master;
      if (res.reused) { master = mediaStore.resolve(res.reused.artifact_id); record = Object.assign({}, master, { canonical: true, validated: true }); }
      else { record = out.master; if (!historical) p.project_master = { assembly_fp: res.projectFp, artifact_id: out.master.artifact_id, sha256: out.master.sha256, duration: out.duration_s, frames: out.frames, outputs: Object.fromEntries(Object.entries(out.outputs).map(([k, v]) => [k, v.record.artifact_id])), stems: Object.fromEntries(Object.entries(out.stems).map(([k, v]) => [k, v.artifact_id])), mastering: out.mastering, chapters: out.chapters, integrity: out.integrity, built_at: now() }; }
      artifact = { artifact_id: record.artifact_id, url: record.safe_url, download_url: record.download_url, duration: record.duration, sha256: record.sha256, bytes: record.bytes };
      let t = 0; const items = [], scenes = [];
      for (const e of res.sceneEntries) { const sc = p.scenes.find(s => s.id === e.scene_id); scenes.push({ id: e.scene_id, title: sc.title, start_s: t / 48000, end_s: (t + e.master.frames) / 48000 }); for (const l of e.master.lines || []) { const line = scopeLines.find(x => x.id === l.line_id); const tk = line && takeFor(line); items.push({ scene_id: e.scene_id, line_id: l.line_id, take_id: tk && tk.id, speaker: line && line.speaker, start_s: t / 48000 + l.start_s, duration_s: l.end_s - l.start_s, speech_inputs_sha: (tk && tk.fingerprint && tk.fingerprint.inputs_sha) || null, take_sha256: (tk && tk.sha256) || null }); } t += e.master.frames + e.gap_after_frames; }
      extra = { scenes, items, sample_rate: 48000, channels: 2, chapters: (out || {}).chapters || (p.project_master || {}).chapters || [], mastering: out ? out.mastering : (res.reused || {}).mastering, outputs: out ? Object.fromEntries(Object.entries(out.outputs).map(([k, v]) => [k, v.record.artifact_id])) : (res.reused || {}).outputs };
    }
    const manifest = Object.assign({ schema: 'dexdiffusion.drama_manifest.v1', project_id: p.id, title: p.title, scope: sceneId ? 'scene' : 'project', scene_id: sceneId || null, kind, current: !historical, generated_at: new Date().toISOString(), duration_s: record.duration, source_rev: p.source_rev || 1, source_sha256: p.source_sha256 || null, stale_lines: stale, tracks: (p.tracks || []).map(t => ({ id: t.id, role: t.role, artifact_id: t.artifact_id, scene_id: t.scene_id || null })), settings: { line_gap_s: p.settings.line_gap_s, scene_gap_s: p.settings.scene_gap_s }, artifact_id: record.artifact_id, sha256: record.sha256 }, extra);
    if (!internal) { p.exports.unshift({ id: 'ex-' + crypto.randomBytes(3).toString('hex'), artifact_id: record.artifact_id, outputs: extra.outputs || {}, scope: manifest.scope, scene_id: sceneId || null, kind, source_rev: manifest.source_rev, at: now(), duration_s: record.duration, manifest }); p.exports = p.exports.slice(0, 20); store.touch(p); }
    return { artifact, record, manifest };
  }

  function assembleExportLegacy(projectId, { sceneId, historical = false, internal = false } = {}) {
    const p = need(projectId);
    { const total = D.planTimeline(p, { sceneId, takeDuration: t => { const a = t.artifact_id && mediaStore.resolve(t.artifact_id); return a && a.duration ? a.duration : 0; }, takeFor: l => (l.takes || []).find(x => x.id === l.active_take_id && x.status === 'complete') || null }).total_s; if (total > 30 * 60) throw Object.assign(new Error('this programme is too long for the in-memory assembler; the streaming FFmpeg pipeline is required'), { status: 501, gate: 'streaming-required' }); }
    const ctx = planContext(), plan = P.planProduction(p, ctx);
    const scopeLines = D.renderableLines(p, sceneId).map(x => x.line);
    const stateOf = new Map(plan.lines.map(l => [l.line_id, l]));
    const selected = line => (line.takes || []).find(x => x.id === line.active_take_id && x.status === 'complete') || null;
    const takeFor = historical ? selected : line => (plan.chosen.get(line.id) || null);
    const stale = [];
    if (historical) for (const line of scopeLines) { const t = selected(line); if (t) { const st = D.takeState(t, (P.lineFingerprint(p, line, ctx).fp)); if (st.freshness !== 'current') stale.push({ line_id: line.id, state: st.label }); } }
    else {
      const bad = scopeLines.filter(l => !plan.chosen.has(l.id));
      if (bad.length) {
        const e = new Error(`${bad.length} renderable line(s) have no current generated take`);
        e.gate = 'missing-takes'; e.missing = bad.map(l => { const st = stateOf.get(l.id) || {}; return { scene_id: (D.findLine(p, l.id) || {}).scene.id, line_id: l.id, speaker: l.speaker, state: (l.takes || []).some(t => t.status === 'complete') ? 'stale' : (st.state === 'blocked' ? 'blocked' : 'missing'), reason: st.reason || null }; });
        throw e;
      }
    }
    const takeDuration = t => { const a = t.artifact_id && mediaStore.resolve(t.artifact_id); return a && a.duration ? a.duration : 0; };
    const load = id => { const a = mediaStore.resolve(id); if (!a) return null; return A.parseWav(fs.readFileSync(a.path)); };
    const r = D.assemble(p, { sceneId, takeDuration, takeFor, loadAudio: id => load(id), loadTrackAudio: id => load(id) });
    const byLine = new Map(scopeLines.map(l => [l.id, l]));
    r.manifest.kind = historical ? 'historical' : 'current'; r.manifest.current = !historical;
    r.manifest.source_rev = p.source_rev || 1; r.manifest.source_sha256 = p.source_sha256 || null; r.manifest.stale_lines = stale;
    r.manifest.items = r.manifest.items.map(it => { const t = (byLine.get(it.line_id).takes || []).find(x => x.id === it.take_id); return Object.assign({}, it, { speech_inputs_sha: (t && t.fingerprint && t.fingerprint.inputs_sha) || null, take_sha256: (t && t.sha256) || null }); });
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'dexdrama-'));
    try {
      const file = path.join(dir, 'drama.wav'); fs.writeFileSync(file, A.encodeWav(r.audio));
      const stamp = new Date().toISOString().replace(/[-:]/g, '').replace('T', '-').slice(0, 15);
      const manifestSha = crypto.createHash('sha256').update(JSON.stringify(r.manifest)).digest('hex');
      const rec = mediaStore.finalize(file, { kind: 'voice', base: `${stamp}-drama-${slug(p.title)}${sceneId ? '-' + sceneId : ''}${historical ? '-historical' : ''}`, worker: 'drama-assembler', model: 'drama-assembler',
        duration: r.manifest.duration_s, meta: { operation: 'drama-export', sample_rate: r.manifest.sample_rate, channels: r.manifest.channels, drama: { project_id: p.id, scope: r.manifest.scope, scene_id: sceneId || null, lines: r.manifest.items.length, manifest_sha256: manifestSha, kind: r.manifest.kind, source_rev: r.manifest.source_rev } } });
      r.manifest.artifact_id = rec.artifact_id; r.manifest.sha256 = rec.sha256;
      if (!internal) { p.exports.unshift({ id: 'ex-' + crypto.randomBytes(3).toString('hex'), artifact_id: rec.artifact_id, scope: r.manifest.scope, scene_id: sceneId || null, kind: r.manifest.kind, source_rev: r.manifest.source_rev, at: now(), duration_s: r.manifest.duration_s, manifest: r.manifest });
      p.exports = p.exports.slice(0, 20); store.touch(p); }
      return { artifact: { artifact_id: rec.artifact_id, url: rec.safe_url, download_url: rec.download_url, duration: rec.duration, sha256: rec.sha256, bytes: rec.bytes }, record: rec, manifest: r.manifest };
    } finally { try { fs.rmSync(dir, { recursive: true, force: true }); } catch (_) {} }
  }

  const assembleExport = (projectId, opts = {}) => (assembly ? assembleExportStreaming(projectId, opts) : assembleExportLegacy(projectId, opts));

  function approveTake(projectId, lineId, takeId, approved = true) {
    const p = need(projectId), f = D.findLine(p, lineId); if (!f) throw Object.assign(new Error('line not found'), { status: 404 });
    const t = f.line.takes.find(x => x.id === takeId && x.status === 'complete'); if (!t) throw Object.assign(new Error('take not found or not complete'), { status: 400 });
    if (approved) {
      const st = D.takeState(t, P.lineFingerprint(p, f.line, planContext()).fp);
      if (st.freshness !== 'current') throw Object.assign(new Error('only a take that matches the current line, voice and settings can be approved'), { status: 409, gate: 'approve-outdated' });
      t.approved = true; t.approved_at = now(); delete t.review_required;
    } else { delete t.approved; delete t.approved_at; }
    store.touch(p); return t;
  }
  function adoptLegacyTake(projectId, lineId, takeId) {
    const p = need(projectId), t = P.adoptLegacyTake(p, lineId, takeId, planContext());
    if (!t) throw Object.assign(new Error('take cannot be adopted (not complete, or the voice is not resolvable)'), { status: 400 });
    store.touch(p); return t;
  }

  // ── Cast Bible ──────────────────────────────────────────────────────────────────────
  const ACTOR_ROLES = ['character', 'narrator', 'background', 'remote'];
  const LANG_SET = new Set(E.getEngine('qwen3-tts-base').capabilities.languages);
  const clipStr = (v, n) => String(v == null ? '' : v).trim().slice(0, n);
  function cleanPronunciation(rules) {
    if (!Array.isArray(rules)) throw Object.assign(new Error('pronunciation must be a list of rules'), { status: 400 });
    if (rules.length > 50) throw Object.assign(new Error('at most 50 pronunciation rules per actor'), { status: 400 });
    const seen = new Set(), out = [];
    for (const r of rules) {
      const from = clipStr(r && r.from, 60), to = clipStr(r && r.to, 60);
      if (!from || !to) throw Object.assign(new Error('each pronunciation rule needs a "from" word and a "to" respelling'), { status: 400 });
      const k = from.toLowerCase() + '|' + (r.ignore_case ? 1 : 0); if (seen.has(k)) continue; seen.add(k); out.push({ from, to, ignore_case: !!r.ignore_case });
    }
    return out;
  }
  function cleanFx(v) {
    if (v === null || v === undefined || v === 'none') return null;
    if (typeof v === 'string') { if (!FX.PRESETS[v]) throw Object.assign(new Error('unknown FX preset'), { status: 400 }); return v === 'none' ? null : FX.presetChain(v); }
    const r = FX.validate(v); if (!r.ok) throw Object.assign(new Error('invalid FX chain: ' + r.errors.join('; ')), { status: 400 });
    return r.chain;
  }
  function cleanPacing(v) {
    if (v === null || v === undefined) return { mode: 'off' };
    if (typeof v === 'string') { const pr = Pacing.PRESETS[v]; if (!pr) throw Object.assign(new Error('unknown pacing preset'), { status: 400 }); return pr.mode === 'off' ? { mode: 'off' } : { mode: pr.mode, target_wpm: pr.target_wpm, preset: v }; }
    if (v.mode === 'off') return { mode: 'off' };
    if (v.mode === 'wpm') { const w = Number(v.target_wpm); if (!(w >= 60 && w <= 600)) throw Object.assign(new Error('target words per minute must be 60-600'), { status: 400 }); return { mode: 'wpm', target_wpm: Math.round(w) }; }
    if (v.mode === 'tempo') { const t = Number(v.tempo); if (!(t >= 0.5 && t <= 2)) throw Object.assign(new Error('tempo must be 0.5-2'), { status: 400 }); return { mode: 'tempo', tempo: Math.round(t * 1000) / 1000 }; }
    throw Object.assign(new Error('pacing mode must be off, wpm or tempo'), { status: 400 });
  }
  function updateActor(projectId, actorId, b) {
    const p = need(projectId), a = p.actors.find(x => x.id === actorId); if (!a) throw Object.assign(new Error('actor not found'), { status: 404 });
    const changed = [];
    if (b.voice_profile_id !== undefined) { if (b.voice_profile_id && !profiles.get(b.voice_profile_id)) throw Object.assign(new Error('voice profile not found'), { status: 400 }); a.voice_profile_id = b.voice_profile_id || null; changed.push('voice'); }
    if (b.default_direction !== undefined) { a.default_direction = clipStr(b.default_direction, 200); changed.push('direction'); }
    if (b.language !== undefined) { const l = clipStr(b.language, 8); if (l && !LANG_SET.has(l)) throw Object.assign(new Error('unsupported language'), { status: 400 }); a.language = l || null; changed.push('language'); }
    if (b.pronunciation !== undefined) { a.pronunciation = cleanPronunciation(b.pronunciation); changed.push('pronunciation'); }
    if (b.notes !== undefined) { a.notes = clipStr(b.notes, 500); changed.push('notes'); }
    if (b.fx !== undefined) { a.fx = cleanFx(b.fx); changed.push('fx'); }
    if (b.pacing !== undefined) { a.pacing = cleanPacing(b.pacing); changed.push('pacing'); }
    if (b.role !== undefined) { if (!ACTOR_ROLES.includes(b.role)) throw Object.assign(new Error('role must be ' + ACTOR_ROLES.join(', ')), { status: 400 }); a.role = b.role; changed.push('role'); }
    if (changed.length) { const pr = a.voice_profile_id && profiles.get(a.voice_profile_id); a.history = [{ at: now(), changed, voice_profile_id: a.voice_profile_id, identity_version: pr ? pr.identity_version || null : null }, ...(a.history || [])].slice(0, 30); }
    store.touch(p); return a;
  }

  // ── tracks / cues (music, ambience, sfx) ──────────────────────────────────────────
  const num = (v, d, lo, hi) => { const n = v === undefined || v === '' || v === null ? d : Number(v); return Number.isFinite(n) ? Math.max(lo, Math.min(hi, n)) : d; };
  function addTrack(projectId, t) {
    const p = need(projectId);
    if (!TRACK_ROLES.includes(t.role)) throw Object.assign(new Error('role must be music, ambience or sfx'), { status: 400 });
    const a = mediaStore.resolve(String(t.artifact_id || ''));
    if (!a || !['music', 'voice'].includes(a.kind) || !/\.(wav|mp3|m4a|m4b|flac)$/i.test(a.artifact_id)) throw Object.assign(new Error('choose an audio artifact (WAV artifact or MP3/M4A/FLAC) from the Music or Voice library'), { status: 400 });
    const tr = { id: 'tr-' + crypto.randomBytes(3).toString('hex'), role: t.role, artifact_id: a.artifact_id, scene_id: t.scene_id && p.scenes.some(s => s.id === t.scene_id) ? t.scene_id : null, label: clipStr(t.label, 80),
      start_s: num(t.start_s, 0, 0, 36000), trim_start_s: num(t.trim_start_s, 0, 0, 36000), trim_end_s: t.trim_end_s == null || t.trim_end_s === '' ? null : num(t.trim_end_s, null, 0, 36000),
      gain: num(t.gain, t.role === 'music' ? 0.3 : 0.5, 0, 2), fade_in_s: num(t.fade_in_s, 0, 0, 60), fade_out_s: num(t.fade_out_s, 0, 0, 60),
      loop: !!t.loop, duck: t.duck === undefined ? t.role !== 'sfx' : !!t.duck, priority: num(t.priority, 0, -100, 100), required: t.required !== false, length_s: t.length_s == null || t.length_s === '' ? null : num(t.length_s, null, 0, 36000) };
    p.tracks.push(tr); store.touch(p); return tr;
  }
  function updateTrack(projectId, trackId, patch) {
    const p = need(projectId), tr = p.tracks.find(x => x.id === trackId); if (!tr) return null;
    // dragging on the timeline sends an absolute scene time; a script-anchored cue detaches (its anchor offset becomes absolute)
    if (patch.move_to_s !== undefined) {
      if (tr.cue_line_id) SD.detach(p, trackId, { takeFor: l => (P.planProduction(p, planContext()).chosen.get(l.id) || (l.takes || []).find(t => t.id === l.active_take_id && t.status === 'complete') || null), media: mediaStore });
      tr.start_s = num(patch.move_to_s, tr.start_s, 0, 36000);
    }
    for (const k of ['start_s', 'trim_start_s', 'trim_end_s', 'gain', 'fade_in_s', 'fade_out_s', 'length_s']) if (patch[k] !== undefined && !(k === 'start_s' && patch.move_to_s !== undefined)) tr[k] = patch[k] === '' || patch[k] === null ? (k === 'trim_end_s' || k === 'length_s' ? null : 0) : Math.max(k === 'start_s' && tr.cue_line_id ? -3600 : 0, Number(patch[k]) || 0);
    for (const k of ['loop', 'duck', 'required']) if (patch[k] !== undefined) tr[k] = !!patch[k];
    if (patch.priority !== undefined) tr.priority = num(patch.priority, 0, -100, 100);
    if (patch.label !== undefined) tr.label = clipStr(patch.label, 80);
    if (patch.scene_id !== undefined) tr.scene_id = p.scenes.some(s => s.id === patch.scene_id) ? patch.scene_id : null;
    store.touch(p); return tr;
  }
  // Split a (non-looping) cue at a scene time: two independent tracks, original audio untouched.
  function splitTrack(projectId, trackId, atS) {
    const p = need(projectId), tr = p.tracks.find(x => x.id === trackId); if (!tr) throw Object.assign(new Error('track not found'), { status: 404 });
    if (tr.loop) throw Object.assign(new Error('turn looping off before splitting a cue'), { status: 400 });
    const scene = p.scenes.find(s => s.id === tr.scene_id); if (!scene) throw Object.assign(new Error('project-wide cues are split on the project timeline; attach this cue to a scene first'), { status: 400 });
    const plan = P.planProduction(p, planContext());
    const tl = TL.buildSceneTimeline(p, scene, { takeFor: l => plan.chosen.get(l.id) || null, media: mediaStore }); const c = tl.cues.find(x => x.id === trackId);
    if (!c || !c.resolved) throw Object.assign(new Error('this cue has no audio to split'), { status: 400 });
    const start = c.start_frame / 48000, end = (c.start_frame + c.frames) / 48000, at = Number(atS);
    if (!(at > start + 0.05 && at < end - 0.05)) throw Object.assign(new Error('split inside the cue (at least 50 ms from either end)'), { status: 400 });
    const off = at - start, trimStart = tr.trim_start_s || 0;
    const b = Object.assign({}, tr, { id: 'tr-' + crypto.randomBytes(3).toString('hex') }); delete b.cue_line_id;
    b.start_s = Math.round(at * 1000) / 1000; b.trim_start_s = Math.round((trimStart + off) * 1000) / 1000; b.fade_in_s = 0; b.length_s = null;
    if (tr.cue_line_id) { tr.start_s = Math.round(start * 1000) / 1000; delete tr.cue_line_id; }
    tr.trim_end_s = Math.round((trimStart + off) * 1000) / 1000; tr.fade_out_s = 0; tr.length_s = null;
    p.tracks.splice(p.tracks.indexOf(tr) + 1, 0, b); store.touch(p); return [tr, b];
  }
  function removeTrack(projectId, trackId) { const p = need(projectId); const n = p.tracks.length; p.tracks = p.tracks.filter(t => t.id !== trackId); store.touch(p); return p.tracks.length < n; }

  // ── multitrack timeline: one server-side model, edits are non-destructive overrides ──────────
  function setClip(projectId, lineId, b) {
    const p = need(projectId), f = D.findLine(p, lineId); if (!f || f.line.render === false || f.line.kind === 'direction') throw Object.assign(new Error('clip not found'), { status: 404 });
    const ov = p.timeline.clip_overrides; if (b.reset === true) { delete ov[lineId]; store.touch(p); return null; }
    const cur = Object.assign({}, ov[lineId]);
    const set = (k, v, lo, hi) => { if (b[k] === undefined) return; if (b[k] === null || b[k] === '') delete cur[k]; else cur[k] = num(b[k], 0, lo, hi); };
    set('start_offset_s', 0, -30, 30); set('trim_start_s', 0, 0, 3600); set('trim_end_s', 0, 0, 3600); set('gain_db', 0, -24, 24); set('fade_in_s', 0, 0, 30); set('fade_out_s', 0, 0, 30);
    if (cur.trim_end_s != null && cur.trim_end_s < (cur.trim_start_s || 0)) throw Object.assign(new Error('trim end must come after trim start'), { status: 400 });
    if (b.fx_override !== undefined) { if (b.fx_override === 'inherit') delete cur.fx_override; else cur.fx_override = cleanFx(b.fx_override); }
    if (b.pacing !== undefined) { if (b.pacing === 'inherit') delete cur.pacing; else cur.pacing = cleanPacing(b.pacing); }
    if (b.pinned_take_id !== undefined) {
      if (!b.pinned_take_id) delete cur.pinned_take_id;
      else {
        const t = f.line.takes.find(x => x.id === b.pinned_take_id && x.status === 'complete'); if (!t) throw Object.assign(new Error('take not found or not complete'), { status: 400 });
        const st = D.takeState(t, P.lineFingerprint(p, f.line, planContext()).fp);
        if (st.freshness !== 'current') throw Object.assign(new Error('only a take that matches the current line, voice and settings can be pinned; export a historical snapshot to use an older take'), { status: 409, gate: 'pin-outdated' });
        cur.pinned_take_id = t.id;
      }
    }
    if (Object.keys(cur).length) ov[lineId] = cur; else delete ov[lineId];
    store.touch(p); return ov[lineId] || null;
  }
  function markers(projectId, op, body) {
    const p = need(projectId); p.timeline.markers = p.timeline.markers || []; p.timeline.regions = p.timeline.regions || [];
    const inScene = id => p.scenes.some(s => s.id === id);
    if (op === 'add-marker') { if (!inScene(body.scene_id)) throw Object.assign(new Error('scene not found'), { status: 404 }); const m = { id: 'mk-' + crypto.randomBytes(3).toString('hex'), scene_id: body.scene_id, t_s: num(body.t_s, 0, 0, 36000), label: clipStr(body.label, 60) }; p.timeline.markers.push(m); store.touch(p); return m; }
    if (op === 'add-region') { if (!inScene(body.scene_id)) throw Object.assign(new Error('scene not found'), { status: 404 }); const a = num(body.start_s, 0, 0, 36000), b2 = num(body.end_s, a + 1, 0, 36000); const r = { id: 'rg-' + crypto.randomBytes(3).toString('hex'), scene_id: body.scene_id, start_s: Math.min(a, b2), end_s: Math.max(a, b2), label: clipStr(body.label, 60) }; p.timeline.regions.push(r); store.touch(p); return r; }
    if (op === 'remove') { const n = p.timeline.markers.length + p.timeline.regions.length; p.timeline.markers = p.timeline.markers.filter(m => m.id !== body.id); p.timeline.regions = p.timeline.regions.filter(r => r.id !== body.id); store.touch(p); return p.timeline.markers.length + p.timeline.regions.length < n; }
    throw new Error('unknown marker operation');
  }
  function timelineView(projectId, sceneId) {
    const p = need(projectId), scene = p.scenes.find(s => s.id === sceneId); if (!scene) throw Object.assign(new Error('scene not found'), { status: 404 });
    const ctx = planContext(), plan = P.planProduction(p, ctx), takeFor = l => plan.chosen.get(l.id) || null;
    const tl = TL.buildSceneTimeline(p, scene, { takeFor, media: mediaStore });
    const a = plan.assembly.find(x => x.scene_id === sceneId), master = (p.scene_masters || {})[sceneId], mrec = master && mediaStore.resolve(master.artifact_id);
    const lanes = []; const byLine = new Map(tl.lines.map(l => [l.line_id, l]));
    const speakers = [...new Set(tl.clips.map(c => c.speaker_key))];
    for (const sk of speakers) {
      const actor = D.actorFor(p, sk);
      lanes.push({ id: 'dlg:' + sk, kind: 'dialogue', speaker_key: sk, label: actor ? actor.speaker : sk, clips: tl.clips.filter(c => c.speaker_key === sk).map(c => {
        const line = D.findLine(p, c.line_id).line, take = line.takes.find(t => t.id === c.take_id), art = mediaStore.resolve(c.artifact_id), l = byLine.get(c.line_id);
        return { id: 'c:' + c.line_id, line_id: c.line_id, take_id: c.take_id, artifact_id: c.artifact_id, url: art ? art.safe_url : null, start_s: c.start_frame / 48000, duration_s: c.frames / 48000, src_offset_s: c.src_offset_frames / 48000, gain_db: c.gain_db, fade_in_s: c.fade_in_frames / 48000, fade_out_s: c.fade_out_frames / 48000,
          fx: c.fx ? { preset: c.fx.preset, identity: c.fx_identity } : null, tempo: c.tempo, pacing: c.pacing, pinned: c.pinned, take_state: take ? D.takeState(take, P.lineFingerprint(p, line, ctx).fp) : null, speech_end_s: l ? l.end_s : null, overrides: p.timeline.clip_overrides[c.line_id] || null };
      }) });
    }
    for (const role of TRACK_ROLES) lanes.push({ id: role, kind: 'cue', role, clips: tl.cues.filter(c => c.role === role).map(c => { const tr = p.tracks.find(t => t.id === c.id); const art = c.artifact_id && mediaStore.resolve(c.artifact_id);
      return { id: 'cue:' + c.id, track_id: c.id, artifact_id: c.artifact_id, url: art ? art.safe_url : null, resolved: c.resolved, start_s: c.resolved ? c.start_frame / 48000 : null, duration_s: c.resolved ? c.frames / 48000 : null, gain: c.gain, loop: c.loop, duck: c.duck, required: c.required, priority: c.priority, anchored: !!(tr && tr.cue_line_id), label: tr ? tr.label || '' : '', fade_in_s: c.fade_in_frames / 48000, fade_out_s: c.fade_out_frames / 48000 }; }) });
    return { scene_id: sceneId, title: scene.title, rate: 48000, length_s: tl.length_s, incomplete: tl.incomplete, fresh: !!(a && a.action === 'reuse'), action: a ? a.action : null,
      master: mrec ? { artifact_id: master.artifact_id, url: mrec.safe_url, download_url: mrec.download_url, duration: mrec.duration } : null, lanes, lines: tl.lines.map(l => ({ ...l, speaker: (D.findLine(p, l.line_id).line || {}).speaker })),
      markers: (p.timeline.markers || []).filter(m => m.scene_id === sceneId), regions: (p.timeline.regions || []).filter(r => r.scene_id === sceneId),
      unresolved_cues: SD.scriptCues(p).filter(c => c.scene_id === sceneId && c.status === 'unresolved').map(c => ({ cue_id: c.id, role: c.role, required: c.required })), mix: tl.mix };
  }
  // Render (or reuse) the scene master: this IS the preview, byte-for-byte what the export reuses.
  async function previewScene(projectId, sceneId) {
    if (!assembly) throw Object.assign(new Error('the streaming mixer is not available on this host'), { status: 501 });
    const p = need(projectId), plan = P.planProduction(p, planContext()), a = plan.assembly.find(x => x.scene_id === sceneId);
    if (!a) throw Object.assign(new Error('scene not found or has no speech'), { status: 404 });
    if (a.action === 'blocked' || a.action === 'rebuild-after-speech') throw Object.assign(new Error('this scene still needs current speech for some lines before it can be previewed'), { status: 409, gate: 'scene-not-ready', lines: plan.lines.filter(l => l.scene_id === sceneId && l.state !== 'reuse').map(l => ({ line_id: l.line_id, state: l.state })) });
    const cur = p.scene_masters[sceneId];
    if (a.action === 'reuse' && cur && mediaStore.resolve(cur.artifact_id)) { const r = mediaStore.resolve(cur.artifact_id); return { reused: true, artifact: { artifact_id: r.artifact_id, url: r.safe_url, duration: r.duration, sha256: r.sha256 }, assembly_fp: cur.assembly_fp }; }
    const out = await assembly.scene(p, sceneId, { takeFor: l => plan.chosen.get(l.id) || null, stems: false });
    p.scene_masters[sceneId] = { assembly_fp: out.fingerprint.sha, artifact_id: out.artifact.artifact_id, sha256: out.artifact.sha256, duration: out.artifact.duration, frames: out.frames, dialogue: out.dialogue, lines: out.lines, stems: out.stems, built_at: now() };
    store.touch(p); return { reused: false, artifact: out.artifact, assembly_fp: out.fingerprint.sha, warnings: out.warnings };
  }

  return { parse, createProject, reparse, view, need, renderTake, startRun, runView, assembleExport, approveTake, adoptLegacyTake, planContext, attachProducer, addTrack, updateTrack, removeTrack, splitTrack, updateActor, setClip, markers, timelineView, previewScene, ACTOR_ROLES, TRACK_ROLES, _runs: runs };
}

module.exports = { createDramaService, TRACK_ROLES };
