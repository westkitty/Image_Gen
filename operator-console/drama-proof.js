'use strict';

// Production Proof Report and Director's Revision Report.
//
// Both are derived from fingerprints and manifests, never from a natural-language guess:
//   snapshot  = compact, text-free record of every input that determines the sound (speech components per line, take checksums,
//               voice identities, assembly components per scene, cues, mastering)
//   proof     = a snapshot + what was verified (coverage, decode, loudness, ASR state) tied to the exact master checksum
//   revision  = a diff of two snapshots (or a snapshot against the current project): what changed, what is stale, what is reused,
//               what only needs a remix
// Software checks are labelled as such; performance quality is a human judgement and is recorded as such (pending/approved/rejected).

const crypto = require('crypto');
const D = require('./drama');
const F = require('./drama-fingerprint');
const P = require('./drama-planner');

const SNAPSHOT_SCHEMA = 'dexdiffusion.drama_snapshot.v1', PROOF_SCHEMA = 'dexdiffusion.production_proof.v1';
const hash = o => F.sha(F.canonical(o));

// Build a snapshot of the project as it stands. `plan` = planProduction(project, ctx) (current state).
function buildSnapshot(project, ctx, plan = P.planProduction(project, ctx)) {
  const lines = [], voices = new Map();
  for (const { scene, line } of D.renderableLines(project)) {
    const info = P.lineFingerprint(project, line, ctx), take = plan.chosen.get(line.id) || null;
    const clip = null;
    lines.push({ line_id: line.id, scene_id: scene.id, speaker_key: line.speaker_key, take_id: take ? take.id : null, take_sha256: take ? take.sha256 || null : null,
      speech_inputs_sha: info.fp ? info.fp.inputs_sha : null, components: info.fp ? info.fp.components : null, render_sha: take ? take.render_sha || null : null,
      profile_id: info.profile_id || null, engine: info.engineId || null, engine_revision: info.fp ? info.fp.revision : null, language: info.language || null, delivery_applied: info.fp ? info.fp.delivery.applied : null, state: (plan.lines.find(l => l.line_id === line.id) || {}).state || null });
    if (info.profile && !voices.has(info.profile_id)) voices.set(info.profile_id, { profile_id: info.profile_id, name: info.profile.name, type: info.profile.type, identity_version: info.profile.identity_version || 1, fingerprint: info.profile.fingerprint || null,
      approval: info.profile.approval ? info.profile.approval.state : null, consent: info.profile.consent ? info.profile.consent.kind : null, ready: info.profile.readiness ? info.profile.readiness.ready : null });
  }
  const scenes = project.scenes.filter(s => D.renderableLines(project, s.id).length).map(s => {
    const a = plan.assembly.find(x => x.scene_id === s.id), master = (project.scene_masters || {})[s.id];
    return { scene_id: s.id, title: s.title, assembly_fp: a && a.fingerprint ? a.fingerprint.sha : (master ? master.assembly_fp : null), components: a && a.fingerprint ? a.fingerprint.components : null, action: a ? a.action : null, master_artifact: master ? master.artifact_id : null };
  });
  const actors = project.actors.map(a => ({ speaker_key: a.speaker_key, voice_profile_id: a.voice_profile_id || null, fx: a.fx ? require('./fx-rack').identity(a.fx) : 'clean', pacing: a.pacing && a.pacing.mode !== 'off' ? a.pacing : null, pronunciation_rules: (a.pronunciation || []).length }));
  const body = { schema: SNAPSHOT_SCHEMA, source: { rev: project.source_rev || 1, sha256: project.source_sha256 || null }, lines, scenes, voices: [...voices.values()], actors,
    cues: (project.tracks || []).map(t => ({ id: t.id, role: t.role, scene_id: t.scene_id || null, artifact_id: t.artifact_id, start_s: t.start_s, gain: t.gain, loop: !!t.loop, duck: !!t.duck, required: t.required !== false })),
    overrides: Object.keys((project.timeline && project.timeline.clip_overrides) || {}).length, mastering: project.mastering || null, mix: require('./drama-timeline').mixSettings(project), mixer_version: F.MIXER_VERSION };
  return Object.assign(body, { snapshot_sha: hash({ lines: lines.map(l => [l.line_id, l.speech_inputs_sha, l.take_sha256]), scenes: scenes.map(s => [s.scene_id, s.assembly_fp]), mastering: body.mastering }) });
}

// proofInput: { production (producer view), project, ctx, plan, qa: {summary}, master: record, outputs: {fmt: record}, integrity, mastering, hardFailures }
function buildProof({ production, project, ctx, plan, qa = null, master, outputs = {}, integrity = null, mastering = null, chapters = [], mediaStore, now = () => Date.now() }) {
  const snapshot = buildSnapshot(project, ctx, plan);
  const renderable = D.renderableLines(project);
  const covered = renderable.filter(x => plan.chosen.has(x.line.id)).length;
  const reqCues = require('./sound-director').scriptCues(project);
  const trackChecks = (project.tracks || []).map(t => ({ id: t.id, role: t.role, resolved: !!mediaStore.resolve(t.artifact_id), required: t.required !== false }));
  const fileOf = (id, role) => { const r = mediaStore.resolve(id); return r ? { artifact_id: id, role, sha256: r.sha256, bytes: r.bytes, duration_s: r.duration, mime: r.mime } : { artifact_id: id, role, missing: true }; };
  const core = {
    schema: PROOF_SCHEMA, production_id: production.id, project_id: project.id, generated_at: now(), snapshot,
    source: { rev: snapshot.source.rev, sha256: snapshot.source.sha256, coverage: project.source_coverage || null },
    counts: { scenes: snapshot.scenes.length, lines: renderable.length, lines_rendered: production.lines.generated, lines_reused: production.lines.reused, lines_invalidated: (production.plan && (production.plan.stale || 0)) || 0, chunks: production.chunks },
    completeness: { ok: covered === renderable.length && (!project.source_coverage || project.source_coverage.ok !== false), lines_total: renderable.length, lines_covered: covered, source_coverage_ok: project.source_coverage ? project.source_coverage.ok : null,
      statement: 'Every renderable line is covered by a take whose speech fingerprint matches the screenplay and voices at the time of production.' },
    cues: { script_cues: reqCues.length, required_unresolved: reqCues.filter(c => c.required && c.status === 'unresolved').length, optional_unresolved: reqCues.filter(c => !c.required && c.status === 'unresolved').length, tracks: trackChecks.length, tracks_unresolved: trackChecks.filter(t => !t.resolved).length },
    timeline: { scenes: snapshot.scenes.length, all_scenes_mastered: snapshot.scenes.every(s => s.master_artifact), overrides: snapshot.overrides },
    outputs: [fileOf(master.artifact_id, 'master'), ...Object.entries(outputs).map(([fmt, id]) => Object.assign(fileOf(id, fmt), { format: fmt }))],
    chapters: chapters.map(c => ({ scene_id: c.scene_id, title: c.title, start_s: +Number(c.start_s).toFixed(3), end_s: +Number(c.end_s).toFixed(3) })),
    integrity: Object.assign({ method: 'ffprobe/FFmpeg decode, streamed sample scan, SHA-256, coverage accounting (software checks)' }, integrity || {}),
    asr: qa ? qa.asr : { state: 'UNAVAILABLE', reason: 'speech verification did not run' },
    qa: qa ? { checked: qa.checked, hard_failures: qa.hard_failures.length, advisories: qa.advisories.length, boundaries: qa.boundaries } : null,
    mastering: mastering ? { preset: mastering.preset, applied: mastering.applied, reason: mastering.reason || null, target_lufs: mastering.target_lufs, ceiling_dbtp: mastering.ceiling_dbtp, gain_db: mastering.gain_db, limiter_engaged: mastering.limiter_engaged, before: mastering.before, after: mastering.after, method: mastering.method, verified: mastering.verified } : null,
    provenance: { engines: [...new Set(snapshot.lines.map(l => `${l.engine}@${l.engine_revision}`))], voices: snapshot.voices, mixer: F.MIXER_VERSION, fingerprint_versions: { speech: F.FP_VERSION, assembly: F.ASSEMBLY_FP_VERSION }, local_only: true },
    review_items: production.review_items || [],
    master: { artifact_id: master.artifact_id, sha256: master.sha256, duration_s: master.duration },
    statements: [
      'Items marked as checked were verified by software (decode, checksum, coverage, loudness measurement). They do not establish performance quality.',
      'Local speech recognition is advisory: a disagreement means "listen here", not "this is wrong"; UNAVAILABLE means the check did not run.',
      'Performance, casting and acting quality are subjective; human listening acceptance below is recorded separately and starts as pending.',
    ],
  };
  const proof_sha256 = hash(core);
  return Object.assign({}, core, { proof_sha256, human_acceptance: { state: 'pending', at: null, note: '' } });
}

// A proof is only trustworthy while the master it describes still has the recorded checksum.
function verifyProof(proof, mediaStore) {
  const problems = [];
  const { human_acceptance: _h, proof_sha256, ...core } = proof;
  if (hash(core) !== proof_sha256) problems.push('the proof report was altered after it was written');
  const m = mediaStore.resolve(proof.master.artifact_id);
  if (!m) problems.push('the master file recorded in this proof is no longer in the media library'); else if (m.sha256 !== proof.master.sha256) problems.push('the master file no longer matches the checksum in this proof');
  return { ok: !problems.length, problems };
}

// ── Director's Revision Report ───────────────────────────────────────────────────────────
const COMP_LABEL = { text: 'dialogue', speaker: 'casting', voice: 'voice identity', reference: 'reference sample', engine: 'engine / runtime', language: 'language', settings: 'synthesis settings', delivery: 'delivery direction', pronunciation: 'pronunciation', source: 'source' };
function compareSnapshots(a, b) {
  const ia = new Map(a.lines.map(l => [l.line_id, l])), ib = new Map(b.lines.map(l => [l.line_id, l]));
  const report = { schema: 'dexdiffusion.revision_report.v1', from: { snapshot_sha: a.snapshot_sha, source_rev: a.source.rev }, to: { snapshot_sha: b.snapshot_sha, source_rev: b.source.rev },
    dialogue_changed: [], lines_added: [], lines_removed: [], voice_identity_changed: [], stale_clips: [], effects_changed: [], cues_changed: [], mastering_changed: false, needs_regeneration: [], reused: [], remix_only: [], scenes: [] };
  const voiceChanged = new Set();
  for (const [id, la] of ia) {
    const lb = ib.get(id); if (!lb) { report.lines_removed.push({ line_id: id, scene_id: la.scene_id }); continue; }
    if (la.speech_inputs_sha === lb.speech_inputs_sha && la.speech_inputs_sha) { if (la.take_sha256 && la.take_sha256 === lb.take_sha256) report.reused.push({ line_id: id }); continue; }
    const diff = la.components && lb.components ? Object.keys(lb.components).filter(k => la.components[k] !== lb.components[k]) : ['unknown'];
    const entry = { line_id: id, scene_id: lb.scene_id, changed: diff.map(k => COMP_LABEL[k] || k) };
    if (diff.includes('text')) report.dialogue_changed.push(entry);
    if (diff.some(k => ['speaker', 'voice', 'reference', 'engine'].includes(k))) { report.voice_identity_changed.push(entry); voiceChanged.add(lb.speaker_key); }
    report.stale_clips.push(Object.assign({ take_id: la.take_id }, entry));
    if (!lb.take_id || lb.state === 'new' || lb.state === 'stale') report.needs_regeneration.push(entry);
  }
  for (const [id, lb] of ib) if (!ia.has(id)) { report.lines_added.push({ line_id: id, scene_id: lb.scene_id }); if (!lb.take_id) report.needs_regeneration.push({ line_id: id, scene_id: lb.scene_id, changed: ['new line'] }); }
  const sa = new Map(a.scenes.map(s => [s.scene_id, s])), speechTouched = new Set([...report.stale_clips, ...report.lines_added, ...report.lines_removed].map(x => x.scene_id));
  for (const s of b.scenes) {
    const o = sa.get(s.scene_id); const entry = { scene_id: s.scene_id, title: s.title };
    if (!o) { report.scenes.push(Object.assign(entry, { change: 'new scene' })); continue; }
    if (o.assembly_fp === s.assembly_fp) { report.scenes.push(Object.assign(entry, { change: 'unchanged' })); continue; }
    const parts = o.components && s.components ? Object.keys(s.components).filter(k => o.components[k] !== s.components[k]) : [];
    report.scenes.push(Object.assign(entry, { change: 'remix', parts }));
    if (parts.includes('clips') && !speechTouched.has(s.scene_id)) report.effects_changed.push({ scene_id: s.scene_id, title: s.title });
    if (parts.includes('cues')) report.cues_changed.push({ scene_id: s.scene_id, title: s.title });
    if (!speechTouched.has(s.scene_id)) report.remix_only.push({ scene_id: s.scene_id, title: s.title, parts });
  }
  report.mastering_changed = hash(a.mastering) !== hash(b.mastering);
  report.voices_changed = [...voiceChanged];
  report.summary = { dialogue_changed: report.dialogue_changed.length, lines_added: report.lines_added.length, lines_removed: report.lines_removed.length, voice_identity_changed: report.voice_identity_changed.length, stale_clips: report.stale_clips.length,
    effects_changed: report.effects_changed.length, cues_changed: report.cues_changed.length, needs_regeneration: report.needs_regeneration.length, reused: report.reused.length, remix_only: report.remix_only.length, mastering_changed: report.mastering_changed };
  report.method = 'Derived from speech/assembly fingerprints and take checksums recorded in the production snapshots; no text comparison or language-model guess is involved.';
  return report;
}

module.exports = { buildSnapshot, buildProof, verifyProof, compareSnapshots, SNAPSHOT_SCHEMA, PROOF_SCHEMA };
