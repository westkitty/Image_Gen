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

const TRACK_ROLES = ['music', 'ambience', 'sfx'];
const slug = s => String(s || 'drama').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 40) || 'drama';

function createDramaService({ store, voice, profiles, mediaStore, llmChat = null, now = () => Date.now() }) {
  const runs = new Map();

  // ── project views ─────────────────────────────────────────────────────────
  function profileBrief(id) { const p = id && profiles.get(id); return p ? { id: p.id, name: p.name, type: p.type, validation: p.validation && p.validation.state, preferred_engine: p.preferred_engine } : null; }
  function lineView(l, base) {
    const takes = (l.takes || []).map(t => { const a = t.artifact_id && mediaStore.resolve(t.artifact_id); return Object.assign({}, t, { url: a ? a.safe_url : null, download_url: a ? a.download_url : null, active: t.id === l.active_take_id }); });
    return Object.assign({}, l, { takes, status: D.lineStatus(l) });
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
  function view(p) {
    const lineJobs = {};
    for (const r of runs.values()) if (r.project_id === p.id && r.status === 'running') lineJobs.active_run = r.id;
    return {
      id: p.id, title: p.title, saved: !!p.saved, schema: p.schema, settings: p.settings, parse_warnings: p.parse_warnings || [], source_script: p.source_script,
      scenes: p.scenes.map(s => ({ id: s.id, title: s.title, lines: s.lines.map(lineView) })),
      actors: p.actors.map(a => Object.assign({}, a, { profile: profileBrief(a.voice_profile_id), lines: D.allLines(p).filter(x => x.line.speaker_key === a.speaker_key && x.line.kind !== 'direction').length })),
      unresolved: unresolvedProfiles(p), tracks: p.tracks, exports: p.exports.map(e => Object.assign({}, e, { url: (mediaStore.resolve(e.artifact_id) || {}).safe_url || null, download_url: (mediaStore.resolve(e.artifact_id) || {}).download_url || null })),
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
  function reparse(id, { script, mode }) { return parse(script, { mode }).then(r => { if (!r.ok) return r; const p = need(id); p.source_script = String(script); p.scenes = r.parsed.scenes; p.parse_warnings = r.parsed.warnings; D.ensureActors(p); store.touch(p); return { ok: true, project: view(p) }; }); }

  // ── rendering ───────────────────────────────────────────────────────────────
  // Starts ONE render (a new take). Resolves when the take reaches a terminal state.
  async function renderTake(projectId, lineId, { seed, onJob } = {}) {
    const p = need(projectId), f = D.findLine(p, lineId);
    if (!f) throw Object.assign(new Error('line not found'), { status: 404 });
    const { scene, line } = f;
    if (line.render === false || line.kind === 'direction' || !String(line.text).trim()) throw Object.assign(new Error('this line is not renderable'), { status: 400 });
    const actor = D.actorFor(p, line.speaker_key);
    const profileId = line.profile_override || (actor && actor.voice_profile_id);
    if (!profileId) throw Object.assign(new Error(`assign a voice to ${line.speaker} first`), { status: 400, gate: 'unresolved-speaker' });
    const direction = line.direction || (actor && actor.default_direction) || '';
    const res = voice.renderText({ profileId, text: line.text, direction, seed, engine: line.engine_override || undefined, operation: 'drama-line', saveText: false,
      language: p.settings.default_language, meta: { drama: { project_id: p.id, scene_id: scene.id, line_id: line.id } }, safeParams: { project_id: p.id, line_id: line.id } });
    if (res.error) {
      const t = D.addTake(p, lineId, { profile_id: profileId, engine: null, seed: seed == null ? null : seed, status: 'failed', error: res.error, gate: res.gate || null });
      store.touch(p); return { take: t, failed: true, error: res.error };
    }
    const take = D.addTake(p, lineId, { profile_id: profileId, engine: res.engine, seed: res.seed, job_id: res.job_id, settings: { direction, delivery: res.delivery, chunks: res.chunks, seeded: !!(E.getEngine(res.engine) && E.getEngine(res.engine).capabilities.deterministic_seed) }, status: 'rendering' });
    store.touch(p);
    if (onJob) onJob(res.job_id, take);
    const d = await voice.waitJob(res.job_id, { pollMs: 1200 });
    const p2 = store.get(projectId); if (!p2) return { take, failed: true, error: 'project was removed' };
    if (d && d.status === 'COMPLETE' && d.artifact) D.completeTake(p2, lineId, take.id, { status: 'complete', artifact_id: d.artifact.artifact_id, duration: d.artifact.duration, chunks: res.chunks, sha256: d.artifact.sha256 });
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
    if (scope !== 'line' && resume && !alternate) lines = lines.filter(x => D.lineStatus(x.line) !== 'generated');
    if (!lines.length) return { id: null, status: 'complete', total: 0, done: 0, note: 'nothing to render: every line already has a take' };
    for (const r of runs.values()) if (r.project_id === projectId && r.status === 'running') throw Object.assign(new Error('a render is already running for this project'), { status: 409 });
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
  function assembleExport(projectId, { sceneId } = {}) {
    const p = need(projectId);
    const takeDuration = t => { const a = t.artifact_id && mediaStore.resolve(t.artifact_id); return a && a.duration ? a.duration : 0; };
    const load = id => { const a = mediaStore.resolve(id); if (!a) return null; return A.parseWav(fs.readFileSync(a.path)); };
    const r = D.assemble(p, { sceneId, takeDuration, loadAudio: id => load(id), loadTrackAudio: id => load(id) });
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'dexdrama-'));
    try {
      const file = path.join(dir, 'drama.wav'); fs.writeFileSync(file, A.encodeWav(r.audio));
      const stamp = new Date().toISOString().replace(/[-:]/g, '').replace('T', '-').slice(0, 15);
      const manifestSha = crypto.createHash('sha256').update(JSON.stringify(r.manifest)).digest('hex');
      const rec = mediaStore.finalize(file, { kind: 'voice', base: `${stamp}-drama-${slug(p.title)}${sceneId ? '-' + sceneId : ''}`, worker: 'drama-assembler', model: 'drama-assembler',
        duration: r.manifest.duration_s, meta: { operation: 'drama-export', sample_rate: r.manifest.sample_rate, channels: r.manifest.channels, drama: { project_id: p.id, scope: r.manifest.scope, scene_id: sceneId || null, lines: r.manifest.items.length, manifest_sha256: manifestSha } } });
      r.manifest.artifact_id = rec.artifact_id; r.manifest.sha256 = rec.sha256;
      p.exports.unshift({ id: 'ex-' + crypto.randomBytes(3).toString('hex'), artifact_id: rec.artifact_id, scope: r.manifest.scope, scene_id: sceneId || null, at: now(), duration_s: r.manifest.duration_s, manifest: r.manifest });
      p.exports = p.exports.slice(0, 20); store.touch(p);
      return { artifact: { artifact_id: rec.artifact_id, url: rec.safe_url, download_url: rec.download_url, duration: rec.duration, sha256: rec.sha256, bytes: rec.bytes }, manifest: r.manifest };
    } finally { try { fs.rmSync(dir, { recursive: true, force: true }); } catch (_) {} }
  }

  // ── tracks (music / ambience / sfx) ──────────────────────────────────────────
  function addTrack(projectId, t) {
    const p = need(projectId);
    if (!TRACK_ROLES.includes(t.role)) throw Object.assign(new Error('role must be music, ambience or sfx'), { status: 400 });
    const a = mediaStore.resolve(String(t.artifact_id || ''));
    if (!a || !['music', 'voice'].includes(a.kind) || !/\.wav$/i.test(a.artifact_id)) throw Object.assign(new Error('choose a WAV artifact from the Music or Voice library'), { status: 400 });
    const num = (v, d, lo, hi) => { const n = v === undefined || v === '' || v === null ? d : Number(v); return Number.isFinite(n) ? Math.max(lo, Math.min(hi, n)) : d; };
    const tr = { id: 'tr-' + crypto.randomBytes(3).toString('hex'), role: t.role, artifact_id: a.artifact_id, scene_id: t.scene_id && p.scenes.some(s => s.id === t.scene_id) ? t.scene_id : null,
      start_s: num(t.start_s, 0, 0, 36000), trim_start_s: num(t.trim_start_s, 0, 0, 36000), trim_end_s: t.trim_end_s == null || t.trim_end_s === '' ? null : num(t.trim_end_s, null, 0, 36000),
      gain: num(t.gain, t.role === 'music' ? 0.3 : 0.5, 0, 2), fade_in_s: num(t.fade_in_s, 0, 0, 60), fade_out_s: num(t.fade_out_s, 0, 0, 60) };
    p.tracks.push(tr); store.touch(p); return tr;
  }
  function updateTrack(projectId, trackId, patch) {
    const p = need(projectId), tr = p.tracks.find(x => x.id === trackId); if (!tr) return null;
    for (const k of ['start_s', 'trim_start_s', 'trim_end_s', 'gain', 'fade_in_s', 'fade_out_s']) if (patch[k] !== undefined) tr[k] = patch[k] === '' || patch[k] === null ? (k === 'trim_end_s' ? null : 0) : Math.max(0, Number(patch[k]) || 0);
    if (patch.scene_id !== undefined) tr.scene_id = p.scenes.some(s => s.id === patch.scene_id) ? patch.scene_id : null;
    store.touch(p); return tr;
  }
  function removeTrack(projectId, trackId) { const p = need(projectId); const n = p.tracks.length; p.tracks = p.tracks.filter(t => t.id !== trackId); store.touch(p); return p.tracks.length < n; }

  return { parse, createProject, reparse, view, need, renderTake, startRun, runView, assembleExport, addTrack, updateTrack, removeTrack, TRACK_ROLES, _runs: runs };
}

module.exports = { createDramaService, TRACK_ROLES };
