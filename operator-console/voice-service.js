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
    const useSeed = eng.capabilities.deterministic_seed ? (seed == null || seed === '' ? crypto.randomInt(0, 2147483000) : Number(seed)) : null;
    let plan;
    try { plan = E.buildRenderPlan(engineId, profile, { texts: chunks.map(c => c.text), direction, language, seed: eng.capabilities.deterministic_seed ? useSeed : null, speed, refPath }); }
    catch (e) { return { error: e.message, status: 400, gate: e.gate || 'profile-invalid' }; }
    const probe = probeFor(eng.worker);
    const gapsMs = chunks.slice(0, -1).map(c => c.gapAfterMs);
    const r = bridge.startBatch(eng.worker, plan.body, {
      probe, saveText, operation: chunks.length > 1 ? 'long-form' : operation, gapsMs, boundaries: chunks.map(c => c.boundary),
      safeParams: Object.assign({ profile_id: profile.id, engine: engineId, chars: t.length }, safeParams),
      meta: Object.assign({ profile_id: profile.id, profile_name: profile.name, engine: engineId, profile_fingerprint: profile.fingerprint, seed: useSeed,
        delivery: { requested: !!plan.delivery.requested, applied: !!plan.delivery.applied }, source_chars: t.length }, meta),
    });
    if (r.error) return r;
    return { job_id: r.job_id, engine: engineId, worker: eng.worker, chunks: chunks.length, chars: t.length, seed: useSeed, delivery: { requested: plan.delivery.requested || null, applied: !!plan.delivery.applied, note: plan.delivery.note },
      notes: plan.notes, warnings: plan.warnings, long_form: chunks.length > 1, chunk_plan: chunks.map(c => ({ index: c.index, chars: c.text.length, boundary: c.boundary, gap_ms: c.gapAfterMs })) };
  }


  // N independent outputs (auditions, trials, production chunks) in ONE Big Mac invocation. Each text must already fit the
  // engine's chunk limit; each item carries its own seed. onItem receives every verified output as soon as it is local.
  function renderItems({ profileId, items, direction, language, engine, operation = 'batch', saveText = false, meta = {}, safeParams = {}, onItem, speed }) {
    const profile = profiles.get(profileId);
    if (!profile) return { error: 'voice profile not found', status: 404, gate: 'profile-missing' };
    const engineId = engine || profile.preferred_engine || E.compatibleEngines(profile)[0];
    const eng = E.getEngine(engineId);
    if (!eng) return { error: 'no compatible engine', status: 400, gate: 'profile-invalid' };
    if (!Array.isArray(items) || !items.length) return { error: 'at least one item is required', status: 400 };
    if (items.length > 400) return { error: 'at most 400 items per job', status: 400 };
    const texts = items.map(i => { const raw = String((i && i.text) == null ? '' : i.text); return i && i.preserve_text ? raw : raw.trim(); });
    if (texts.some(t => !t.trim())) return { error: 'every item needs text', status: 400 };
    if (texts.some(t => t.length > eng.capabilities.max_chunk_chars)) return { error: `each item is limited to ${eng.capabilities.max_chunk_chars} characters for ${eng.label}`, status: 400 };
    let refPath = null;
    if (profile.type === 'cloned') {
      const act = profiles.activeSample(profileId);
      if (!act || !act.path) return { error: 'the active reference sample file is missing', status: 400, gate: 'reference-invalid' };
      refPath = act.path;
    }
    const seeds = items.map(i => (!eng.capabilities.deterministic_seed ? null : i.seed == null || i.seed === '' ? crypto.randomInt(0, 2147483000) : Number(i.seed)));
    let plan;
    const directions = items.map(i => i && i.direction != null ? String(i.direction) : direction);
    try { plan = E.buildRenderPlan(engineId, profile, { texts, direction, directions, language, seeds, speed, refPath, preserveText: items.some(i => i && i.preserve_text) }); }
    catch (e) { return { error: e.message, status: 400, gate: e.gate || 'profile-invalid' }; }
    const r = bridge.startBatch(eng.worker, plan.body, {
      probe: probeFor(eng.worker), saveText, operation, mode: 'items', onItem,
      safeParams: Object.assign({ profile_id: profile.id, engine: engineId, items: texts.length }, safeParams),
      meta: Object.assign({ profile_id: profile.id, profile_name: profile.name, engine: engineId, profile_fingerprint: profile.fingerprint, delivery: { requested: !!plan.delivery.requested, applied: !!plan.delivery.applied } }, meta),
    });
    if (r.error) return r;
    return { job_id: r.job_id, engine: engineId, worker: eng.worker, revision: eng.revision || null, seeds, items: texts.length, delivery: { requested: plan.delivery.requested || null, applied: !!plan.delivery.applied, note: plan.delivery.note }, notes: plan.notes, warnings: plan.warnings };
  }

  // Fast scratch render of the opening of a text. Always labelled preview; it never becomes a take or enters a master.
  const PREVIEW_CHARS = 240;
  function preview({ profileId, text, direction, language, seed, engine }) {
    const full = String(text == null ? '' : text).trim();
    if (!full) return { error: 'text is required', status: 400 };
    let t = full.slice(0, PREVIEW_CHARS), truncated = full.length > PREVIEW_CHARS;
    if (truncated) { const cut = Math.max(t.lastIndexOf('. '), t.lastIndexOf('! '), t.lastIndexOf('? ')); t = cut > 60 ? t.slice(0, cut + 1) : t.replace(/\s+\S*$/, ''); }
    const r = renderText({ profileId, text: t, direction, language, seed, engine, operation: 'preview', saveText: false, meta: { preview: true } });
    return r.error ? r : Object.assign(r, { truncated, preview: true, chars: t.length });
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
  return { renderText, renderItems, preview, describe, waitJob, MAX_TEXT_CHARS, PREVIEW_CHARS };
}

module.exports = { createVoiceService, MAX_TEXT_CHARS };
