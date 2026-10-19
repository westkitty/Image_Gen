'use strict';

// Incremental dependency planner. One pure function that answers, for the CURRENT project state:
//   which recordings are reusable, which lines need new speech, which recordings are stale, what is
//   missing or invalid (cast, voices, audio files, cues), which scenes need only a re-mix, and what blocks
//   production. Manual rendering and one-click production both consume this same plan.

const D = require('./drama');
const E = require('./voice-engines');
const F = require('./drama-fingerprint');
const T = require('./drama-timeline');
const SD = require('./sound-director');
const { splitLongText, verifyChunkReconstruction } = require('./long-form');

// Resolve who speaks a line and with what; returns the fingerprint inputs and any casting problem.
function lineFingerprint(project, line, ctx) {
  const actor = D.actorFor(project, line.speaker_key);
  const profileId = line.profile_override || (actor && actor.voice_profile_id) || null;
  const out = { actor, profile_id: profileId, profile: null, engineId: null, fp: null, problem: null, language: null, direction: '' };
  if (!profileId) { out.problem = { reason: 'unassigned' }; return out; }
  const profile = ctx.profiles.get(profileId);
  if (!profile) { out.problem = { reason: 'profile-missing' }; return out; }
  out.profile = profile;
  const engineId = line.engine_override || profile.preferred_engine || E.compatibleEngines(profile)[0];
  out.engineId = engineId;
  const v = engineId ? E.validateProfileForEngine(profile, engineId) : { ok: false, errors: ['no compatible engine'] };
  if ((profile.validation && profile.validation.state === 'invalid') || !v.ok) { out.problem = { reason: 'profile-invalid', errors: v.errors || [] }; return out; }
  if (ctx.engineAvailable) { const a = ctx.engineAvailable(engineId); if (a && a.ok === false) { out.problem = { reason: 'engine-unavailable', errors: [a.reason || 'engine unavailable'] }; return out; } }
  out.language = (actor && actor.language) || (project.settings && project.settings.default_language) || profile.language || 'en';
  out.direction = line.direction || (actor && actor.default_direction) || '';
  try { out.fp = F.speechFingerprint({ line, actor, profile, engineId, language: out.language, direction: out.direction, performanceScore: line.performance_score || null }); }
  catch (e) { out.problem = { reason: 'performance-score-invalid', errors: [e.message] }; }
  return out;
}

const assetOk = (media, artifactId) => { const a = artifactId && media.resolve(artifactId); return a ? a : null; };

function planProduction(project, ctx) {
  const media = ctx.media, chunker = ctx.chunker || splitLongText;
  const lines = [], stale = [], required = [], reusable = [], inFlight = [];
  const cast = new Map(), assetProblems = [], review = [], blocking = [], chunkProofs = [];
  const chosen = new Map();     // line_id -> take chosen for the master
  const seenCast = new Set();

  for (const { scene, line } of D.renderableLines(project)) {
    const info = lineFingerprint(project, line, ctx);
    const base = { line_id: line.id, scene_id: scene.id, speaker_key: line.speaker_key };
    if (info.problem) {
      const c = cast.get(line.speaker_key) || Object.assign({ key: line.speaker_key, speaker: line.speaker, lines: 0 }, info.problem);
      c.lines++; cast.set(line.speaker_key, c);
      lines.push(Object.assign(base, { state: 'blocked', reason: info.problem.reason }));
      continue;
    }
    const takes = (line.takes || []);
    const running = takes.find(t => (t.status === 'rendering' || t.status === 'queued') && t.fingerprint && t.fingerprint.inputs_sha === info.fp.inputs_sha);
    const complete = takes.filter(t => t.status === 'complete' && !t.rejected);
    const current = complete.filter(t => t.fingerprint && t.fingerprint.inputs_sha === info.fp.inputs_sha);
    const usable = [];
    for (const t of current) {
      if (assetOk(media, t.artifact_id)) usable.push(t);
      else assetProblems.push({ code: 'take-audio-missing', line_id: line.id, scene_id: scene.id, take_id: t.id, artifact_id: t.artifact_id || null });
    }
    // Prefer the user's active take; otherwise the newest eligible one.
    const pinId = line.pinned_take_id || ((project.timeline && project.timeline.clip_overrides && project.timeline.clip_overrides[line.id]) || {}).pinned_take_id;
    if (pinId && !usable.some(t => t.id === pinId) && complete.some(t => t.id === pinId)) review.push({ code: 'pinned-take-outdated', line_id: line.id, take_id: pinId, detail: 'the take pinned for this clip no longer matches the line; it is ignored' });
    let pick = usable.find(t => t.id === pinId) || usable.find(t => t.id === line.active_take_id) || usable.slice().sort((a, b) => (b.created_at || 0) - (a.created_at || 0))[0] || null;
    for (const t of complete) if (t.legacy && !t.adopted_legacy && !(t.fingerprint)) review.push({ code: 'legacy-take-unverified', line_id: line.id, take_id: t.id, detail: 'recorded before fingerprints existed; regenerate it or explicitly adopt it as matching the current text' });
    if (pick) {
      const switched = line.active_take_id && line.active_take_id !== pick.id;
      if (switched) review.push({ code: 'active-take-outdated', line_id: line.id, take_id: pick.id, detail: 'the selected take no longer matches this line; a current alternate take will be used' });
      chosen.set(line.id, pick); reusable.push({ line_id: line.id, scene_id: scene.id, take_id: pick.id });
      lines.push(Object.assign(base, { state: 'reuse', take_id: pick.id, fingerprint: info.fp.inputs_sha, selection_change: !!switched }));
      continue;
    }
    if (running) { inFlight.push({ line_id: line.id, scene_id: scene.id, take_id: running.id }); lines.push(Object.assign(base, { state: 'in-flight', take_id: running.id, fingerprint: info.fp.inputs_sha })); continue; }
    const hasHistory = complete.length > 0;
    const entry = { line_id: line.id, scene_id: scene.id, speaker_key: line.speaker_key, profile_id: info.profile_id, engine: info.engineId, fingerprint: info.fp.inputs_sha,
      reason: hasHistory ? (current.length ? 'audio-missing' : 'outdated') : 'no-take' };
    // exact-reconstruction proof of the chunks this line will be synthesised as
    const eng = E.getEngine(info.engineId);
    const chunks = chunker(info.fp.spoken_text, { maxChars: eng.capabilities.max_chunk_chars });
    const proof = verifyChunkReconstruction(info.fp.spoken_text, chunks);
    chunkProofs.push(Object.assign({ line_id: line.id }, proof));
    if (!proof.ok) blocking.push({ code: 'chunk-reconstruction', scope: line.id, message: `line ${line.id}: ${proof.reason}` });
    if (hasHistory && !current.length) { stale.push(entry); lines.push(Object.assign(base, { state: 'stale', reason: entry.reason, fingerprint: info.fp.inputs_sha, chunks: chunks.length })); }
    else { required.push(entry); lines.push(Object.assign(base, { state: 'new', reason: entry.reason, fingerprint: info.fp.inputs_sha, chunks: chunks.length })); }
    if (hasHistory && !current.length) review.push({ code: 'stale-takes-kept', line_id: line.id, detail: 'earlier recordings are kept but cannot enter the current master' });
  }

  // advisory: cast voices that have not completed their approval/trial/consent checklist
  const noted = new Set();
  for (const { line } of D.renderableLines(project)) {
    const info = lineFingerprint(project, line, ctx);
    const pr = info.profile;
    if (pr && pr.readiness && pr.readiness.ready === false && !noted.has(pr.id)) {
      noted.add(pr.id);
      review.push({ code: 'voice-not-production-ready', profile_id: pr.id, speaker_key: line.speaker_key, failing: pr.readiness.checks.filter(c => !c.ok).map(c => c.id), detail: 'this voice has unmet checks (approval, sample review, consent or clone trial); production proceeds but the proof report will note it' });
    }
  }

  // scenes → assembly (re-mix) planning
  const stateOf = new Map(lines.map(l => [l.line_id, l.state]));
  const assembly = [];
  const needSpeech = s => ['new', 'stale', 'in-flight'].includes(s);
  for (const scene of project.scenes) {
    const sceneLines = D.renderableLines(project, scene.id).map(x => x.line);
    if (!sceneLines.length) continue;
    const states = sceneLines.map(l => stateOf.get(l.id));
    const entry = { scene_id: scene.id, title: scene.title };
    // optional / required cues
    const cueIssues = [];
    for (const t of (project.tracks || []).filter(x => x.scene_id === scene.id)) {
      if (!assetOk(media, t.artifact_id)) {
        const req = t.required !== false;
        cueIssues.push({ track_id: t.id, required: req });
        (req ? assetProblems : review).push(req ? { code: 'cue-audio-missing', scene_id: scene.id, track_id: t.id, required: true } : { code: 'optional-cue-missing', scene_id: scene.id, track_id: t.id, detail: 'optional cue audio is missing and will be skipped' });
        if (req) blocking.push({ code: 'cue-unresolved', scope: scene.id, message: `scene ${scene.title}: required sound cue ${t.id} has no audio asset` });
      }
    }
    if (states.includes('blocked')) { assembly.push(Object.assign(entry, { action: 'blocked', reason: 'cast' })); continue; }
    if (states.some(needSpeech)) { assembly.push(Object.assign(entry, { action: 'rebuild-after-speech', fingerprint: null })); continue; }
    const input = T.sceneAssemblyInput(project, scene, { takeFor: l => chosen.get(l.id) || null, media });
    const fingerprint = F.assemblyFingerprint(input);
    const master = (project.scene_masters || {})[scene.id];
    if (master && master.assembly_fp === fingerprint.sha && assetOk(media, master.artifact_id)) assembly.push(Object.assign(entry, { action: 'reuse', fingerprint, input }));
    else assembly.push(Object.assign(entry, { action: 'rebuild', fingerprint, input, reason: master ? (master.assembly_fp !== fingerprint.sha ? 'inputs-changed' : 'master-missing') : 'no-master' }));
  }
  { const ci = SD.cueIssues(project); blocking.push(...ci.blocking); review.push(...ci.warnings); }
  if (cast.size) blocking.push({ code: 'cast-unresolved', scope: 'cast', message: 'assign a valid voice to: ' + [...cast.values()].map(c => `${c.speaker} (${c.lines} line${c.lines > 1 ? 's' : ''}, ${c.reason})`).join('; ') });
  const unbound = !D.renderableLines(project).length ? [{ code: 'nothing-to-render', scope: 'project', message: 'the project has no renderable lines' }] : [];
  blocking.push(...unbound);
  const counts = { lines: lines.length, reuse: reusable.length, new: required.length, stale: stale.length, blocked: lines.filter(l => l.state === 'blocked').length, in_flight: inFlight.length };
  const workRequired = counts.new + counts.stale + counts.in_flight > 0 || assembly.some(a => a.action.startsWith('rebuild'));
  return { ready: blocking.length === 0, counts, lines, reusable, required, stale, in_flight: inFlight, cast_problems: [...cast.values()], asset_problems: assetProblems,
    review_items: review, blocking_errors: blocking, assembly, chunk_proofs: chunkProofs, work_required: workRequired, chosen };
}

// Explicit human attestation that a pre-fingerprint recording matches the line as written now.
function adoptLegacyTake(project, lineId, takeId, ctx) {
  const f = D.findLine(project, lineId); if (!f) return null;
  const t = f.line.takes.find(x => x.id === takeId && x.status === 'complete'); if (!t) return null;
  const info = lineFingerprint(project, f.line, ctx); if (!info.fp) return null;
  t.fingerprint = info.fp; t.adopted_legacy = true; t.legacy = true; t.adopted_at = Date.now();
  return t;
}

module.exports = { lineFingerprint, planProduction, adoptLegacyTake };
