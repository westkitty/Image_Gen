'use strict';

// Voice production service: "render this text with this voice profile and these performance
// instructions". Resolves the profile, validates it against the engine's real capabilities,
// chunks long text on natural boundaries, runs ONE multi-item Big Mac job through the existing
// bridge (durable generic job + heavy-compute lease + canonical audio store) and stitches the
// result into a single canonical artifact with chunk lineage.

const crypto = require('crypto');
const E = require('./voice-engines');
const { splitLongText } = require('./long-form');

const MAX_TEXT_CHARS = 250000;

function createVoiceService({ bridge, jobStore, mediaStore, profiles, probeFor, log = () => {} }) {
  const sleep = ms => new Promise(r => setTimeout(r, ms));

  // text: raw text (private; never persisted by this layer). Returns { job_id, ... } or { error, status }.
  function renderText({ profileId, text, direction, language, seed, speed, engine, operation = 'speech', saveText = false, meta = {}, safeParams = {} }) {
    const profile = profiles.get(profileId);
    if (!profile) return { error: 'voice profile not found', status: 404, gate: 'profile-missing' };
    const engineId = engine || profile.preferred_engine || E.compatibleEngines(profile)[0];
    const eng = E.getEngine(engineId);
    if (!eng) return { error: 'no compatible engine', status: 400, gate: 'profile-invalid' };
    const t = String(text == null ? '' : text);
    if (!t.trim()) return { error: 'text is required', status: 400 };
    if (t.length > MAX_TEXT_CHARS) return { error: `text is limited to ${MAX_TEXT_CHARS} characters`, status: 400 };
    let chunks;
    try { chunks = splitLongText(t, { maxChars: eng.capabilities.max_chunk_chars }); } catch (e) { return { error: e.message, status: 400 }; }
    if (chunks.length > 400) return { error: 'text splits into more than 400 chunks; render it in parts', status: 400 };
    let refPath = null;
    if (profile.type === 'cloned') {
      const act = profiles.activeSample(profileId);
      if (!act || !act.path) return { error: 'the active reference sample file is missing', status: 400, gate: 'reference-invalid' };
      refPath = act.path;
    }
    const useSeed = seed == null || seed === '' ? crypto.randomInt(0, 2147483000) : Number(seed);
    let plan;
    try { plan = E.buildRenderPlan(engineId, profile, { texts: chunks.map(c => c.text), direction, language, seed: eng.capabilities.deterministic_seed ? useSeed : null, speed, refPath }); }
    catch (e) { return { error: e.message, status: 400, gate: e.gate || 'profile-invalid' }; }
    const probe = probeFor(eng.worker);
    const gapsMs = chunks.slice(0, -1).map(c => c.gapAfterMs);
    const r = bridge.startBatch(eng.worker, plan.body, {
      probe, saveText, operation: chunks.length > 1 ? 'long-form' : operation, gapsMs, boundaries: chunks.map(c => c.boundary),
      safeParams: Object.assign({ profile_id: profile.id, engine: engineId, chars: t.length }, safeParams),
      meta: Object.assign({ profile_id: profile.id, profile_name: profile.name, engine: engineId, profile_fingerprint: profile.fingerprint, seed: useSeed,
        delivery: { requested: plan.delivery.requested || null, applied: !!plan.delivery.applied }, source_chars: t.length }, meta),
    });
    if (r.error) return r;
    return { job_id: r.job_id, engine: engineId, worker: eng.worker, chunks: chunks.length, chars: t.length, seed: useSeed, delivery: { requested: plan.delivery.requested || null, applied: !!plan.delivery.applied, note: plan.delivery.note },
      notes: plan.notes, warnings: plan.warnings, long_form: chunks.length > 1, chunk_plan: chunks.map(c => ({ index: c.index, chars: c.text.length, boundary: c.boundary, gap_ms: c.gapAfterMs })) };
  }

  // Public view of a render job: status, chunk progress, lineage and the final artifact.
  function describe(jobId) {
    const j = jobStore.get(jobId);
    if (!j) return null;
    const art = (j.artifacts || []).map(a => mediaStore.resolve(a)).filter(Boolean)[0] || null;
    const p = j.progress || null;
    return {
      job_id: j.job_id, status: j.status, operation: j.operation, worker: j.worker_id, gate: j.first_failed_gate, error: j.error,
      progress: p, label: label(j),
      artifact: art ? { artifact_id: art.artifact_id, url: art.safe_url, download_url: art.download_url, duration: art.duration, sha256: art.sha256, bytes: art.bytes, meta: art.meta } : null,
    };
  }
  function label(j) {
    const p = j.progress || {};
    if (j.status === 'QUEUED') return 'Waiting for Big Mac…';
    if (j.status === 'RUNNING') return p.phase === 'generating' ? `Generating chunk ${p.chunk || 1}/${p.total || 1}` : p.phase === 'preparing' ? 'Preparing Big Mac job' : p.phase === 'loading-model' ? 'Loading the voice model on Big Mac' : 'Running on Big Mac';
    if (j.status === 'TRANSFERRING') return `Transferring and stitching ${p.total || ''} chunk${p.total > 1 ? 's' : ''}`;
    if (j.status === 'COMPLETE') return 'Complete';
    return `${j.status}${j.first_failed_gate ? ' · ' + j.first_failed_gate : ''}`;
  }
  async function waitJob(jobId, { pollMs = 1500, timeoutMs = 45 * 60 * 1000, onTick } = {}) {
    const t0 = Date.now(); const TERMINAL = ['COMPLETE', 'FAILED', 'INTERRUPTED', 'CANCELLED'];
    for (;;) {
      const j = jobStore.get(jobId);
      if (!j) return null;
      if (onTick) { try { onTick(describe(jobId)); } catch (_) {} }
      if (TERMINAL.includes(j.status)) return describe(jobId);
      if (Date.now() - t0 > timeoutMs) return Object.assign(describe(jobId), { status: 'FAILED', gate: 'timeout', error: 'timed out waiting for the render job' });
      await sleep(pollMs);
    }
  }
  return { renderText, describe, waitJob, MAX_TEXT_CHARS };
}

module.exports = { createVoiceService, MAX_TEXT_CHARS };
