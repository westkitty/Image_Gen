'use strict';

// PRODUCE ENTIRE DRAMA — the one-click orchestration.
//
//   snapshot → validate → incremental plan → reuse every valid chunk/take → synthesise only what is missing or stale
//   (grouped per voice: ONE Big Mac job / model load per group, sequential through the shared heavy-compute lease)
//   → stitch chunks into line takes → re-mix only scenes whose assembly fingerprint changed → project master → manifest.
//
// There is no second queue: speech runs as ordinary voice jobs (lease, bridge, cleanup ownership); the production
// itself is one durable generic job whose progress is index-only (never script text) and is mirrored on the SSE bus by
// the job store. Chunk audio is cached with checksum receipts (chunk-store.js) so an interruption keeps verified work.

const fs = require('fs');
const os = require('os');
const path = require('path');
const crypto = require('crypto');
const D = require('./drama');
const E = require('./voice-engines');
const F = require('./drama-fingerprint');
const P = require('./drama-planner');
const A = require('./voice-audio');
const Pacing = require('./pacing');
const Integrity = require('./audio-integrity');
const Proof = require('./drama-proof');
const { splitLongText } = require('./long-form');
const { artifactReceipt } = require('./job-contract');

const sha = F.sha;
const sid = p => p + '-' + crypto.randomBytes(4).toString('hex');
const lineSeedOf = inputsSha => parseInt(inputsSha.slice(0, 8), 16) % 2147483000;
const chunkFpOf = (inputsSha, seed, i, n, text) => sha(`dxck1|${inputsSha}|${seed == null ? 'none' : seed}|${i}/${n}|${sha(F.normalizeSpokenText(text))}`);
const chunkArray = (a, n) => { const out = []; for (let i = 0; i < a.length; i += n) out.push(a.slice(i, i + n)); return out; };
const TERMINAL = new Set(['complete', 'failed', 'partial', 'cancelled', 'superseded', 'interrupted']);

function createProducer({ drama, store, voice, profiles, mediaStore, jobStore, chunkStore, now = () => Date.now(), pollMs = 500, retry = { max_attempts: 3 }, batchSize = 60,
  chunker = splitLongText, onEvent = () => {}, cancelChild = null, onJobStart = null, onJobEnd = null, assembly, qa = null, proofs = null }) {
  const productions = new Map(), active = new Map();
  const ctxOf = () => drama.planContext();
  const emit = e => { try { onEvent(Object.assign({ at: now() }, e)); } catch (_) {} };

  // ── helpers ────────────────────────────────────────────────────────────────
  function setJob(prod, patch) {
    const j = jobStore.get(prod.job_id); if (!j || ['COMPLETE', 'FAILED', 'CANCELLED', 'INTERRUPTED'].includes(j.status)) return;
    jobStore.transition(prod.job_id, j.status === 'QUEUED' ? 'RUNNING' : j.status, { progress: patch });
  }
  function progress(prod, phase, extra = {}) {
    const c = prod.chunks, total = prod.progress_total || 0;
    const done = phase === 'rendering' ? c.cached + c.generated : (extra.done != null ? extra.done : total);
    prod.phase = phase; prod.status = ['planning', 'rendering', 'assembling', 'mastering', 'publishing', 'reviewing'].includes(phase) ? phase : prod.status;
    prod.progress = Object.assign({ phase, label: extra.label || phase, done, total: extra.total != null ? extra.total : total, cached: c.cached, generated: c.generated, failed: c.failed, retries: c.retries }, extra);
    setJob(prod, prod.progress); emit({ type: 'phase', phase, production_id: prod.id });
  }
  const view = prod => ({ id: prod.id, project_id: prod.project_id, job_id: prod.job_id, status: prod.status, phase: prod.phase, progress: prod.progress, source_rev: prod.source_rev, started_at: prod.started_at, finished_at: prod.finished_at,
    noop: !!prod.noop, superseded: !!prod.superseded, cancel_requested: !!prod.cancel_requested, lines: prod.lines, chunks: prod.chunks, scenes: prod.scenes, errors: prod.errors, warnings: prod.warnings, review_items: prod.review_items, artifacts: prod.artifacts, plan: prod.plan_counts, qa: prod.qa || null, proof: prod.proof || null, mastering: prod.mastering ? { preset: prod.mastering.preset, applied: prod.mastering.applied, gain_db: prod.mastering.gain_db, limiter_engaged: prod.mastering.limiter_engaged, after: prod.mastering.after } : null });
  function summary(prod) { const v = view(prod); delete v.progress; return Object.assign(v, { source_sha256: prod.source_sha256 }); }
  function persistSummary(prod) {
    const p = store.get(prod.project_id); if (!p) return;
    p.productions = (p.productions || []).filter(x => x.id !== prod.id); p.productions.unshift(summary(prod)); p.productions = p.productions.slice(0, 20); store.touch(p);
  }
  const planSummary = (plan, blocking) => ({ ready: !blocking.length, counts: plan.counts, blocking_errors: blocking, cast_problems: plan.cast_problems, asset_problems: plan.asset_problems, review_items: plan.review_items, assembly: plan.assembly.map(a => ({ scene_id: a.scene_id, action: a.action, reason: a.reason || null })) });

  // ── public: start ────────────────────────────────────────────────────────────
  function produce(projectId, opts = {}) {
    const p = drama.need(projectId);
    if (active.has(projectId)) throw Object.assign(new Error('a production is already running for this project'), { status: 409, gate: 'production-running' });
    const plan = P.planProduction(p, ctxOf());
    const blocking = plan.blocking_errors.slice();
    if (p.source_coverage && p.source_coverage.ok === false) blocking.push({ code: 'source-coverage', scope: 'source', message: 'some screenplay text is not classified or does not match its parsed line; fix the script or re-parse before producing' });
    if (blocking.length) throw Object.assign(new Error('production is blocked: ' + blocking.map(b => b.message).join(' | ')), { status: 409, gate: 'production-blocked', plan: planSummary(plan, blocking) });
    const prod = { id: sid('pr'), project_id: projectId, status: 'planning', phase: 'planning', started_at: now(), finished_at: null, source_rev: p.source_rev || 1, source_sha256: p.source_sha256 || null,
      lines: { total: plan.counts.lines, reused: 0, generated: 0, failed: 0 }, chunks: { total: 0, cached: 0, generated: 0, failed: 0, retries: 0, invalid: 0 }, scenes: [], errors: [], warnings: [], review_items: plan.review_items.map(r => ({ code: r.code, line_id: r.line_id || null })),
      artifacts: { master: null, scenes: [], outputs: {}, stems: {} }, plan_counts: plan.counts, cancel_requested: false, noop: false, superseded: false, opts, progress: null, child_job_id: null };
    const job = jobStore.create({ media_kind: 'voice', operation: 'drama-production', worker_id: 'drama-producer', resource_class: 'light', params: { project_id: projectId, production_id: prod.id, source_rev: prod.source_rev }, persist_text: false, artifact_required: true });
    prod.job_id = job.job_id; productions.set(prod.id, prod); active.set(projectId, prod.id);
    if (onJobStart) { try { onJobStart(prod.job_id); } catch (_) {} }
    prod.done = Promise.resolve().then(() => run(prod)).catch(e => finish(prod, 'failed', { gate: 'production-error', message: String(e && e.message || e).slice(0, 200) }))
      .finally(() => { active.delete(projectId); if (onJobEnd) { try { onJobEnd(prod.job_id); } catch (_) {} } });
    return { production: view(prod), job_id: prod.job_id, plan: planSummary(plan, []) };
  }

  // ── finishing ──────────────────────────────────────────────────────────────────
  function finish(prod, status, { gate = null, message = null, record = null } = {}) {
    if (TERMINAL.has(prod.status)) return;
    prod.status = status; prod.phase = status; prod.finished_at = now();
    const label = { complete: 'Complete', failed: 'Failed', partial: 'Finished with failures', cancelled: 'Cancelled', superseded: 'Superseded by edits' }[status] || status;
    prod.progress = Object.assign({}, prod.progress, { phase: status === 'complete' ? 'complete' : status, label });
    const j = jobStore.get(prod.job_id);
    if (j && !['COMPLETE', 'FAILED', 'CANCELLED', 'INTERRUPTED'].includes(j.status)) {
      if (j.status === 'QUEUED') jobStore.transition(prod.job_id, 'RUNNING');
      if (status === 'complete' && record) jobStore.transition(prod.job_id, 'COMPLETE', { artifacts: [record.artifact_id], artifact_validation: artifactReceipt([record]), progress: Object.assign({}, prod.progress, { done: prod.progress.total || 1, total: prod.progress.total || 1 }) });
      else if (status === 'cancelled') jobStore.transition(prod.job_id, 'CANCELLED', { error: 'Cancelled by user', first_failed_gate: 'user-cancelled' });
      else jobStore.transition(prod.job_id, 'FAILED', { first_failed_gate: gate || status, error: message || label, progress: prod.progress });
    }
    if (message && status !== 'complete' && status !== 'cancelled') prod.errors.push({ code: gate || status, message });
    persistSummary(prod); emit({ type: 'finished', production_id: prod.id, status });
    try { chunkStore.flush(prod.project_id); } catch (_) {}
  }

  // ── the run ──────────────────────────────────────────────────────────────────
  async function run(prod) {
    const projectId = prod.project_id, ctx = ctxOf();
    const live = () => drama.need(projectId);
    const snap = structuredClone(live());
    const j0 = jobStore.get(prod.job_id); if (j0 && j0.status === 'QUEUED') jobStore.transition(prod.job_id, 'RUNNING', { progress: { phase: 'planning', label: 'Planning production', done: 0, total: 0 } });
    progress(prod, 'planning', { label: 'Planning production', done: 0, total: 0 });
    const plan = P.planProduction(snap, ctx);
    prod.lines.reused = plan.counts.reuse;

    // 1. work items: every chunk of every line that needs speech, with its deterministic fingerprint and receipt state
    const sceneOrder = new Map(snap.scenes.map((s, i) => [s.id, i]));
    const renderable = D.renderableLines(snap); const lineIndex = new Map(renderable.map((x, i) => [x.line.id, i]));
    const work = [];
    for (const entry of [...plan.stale, ...plan.required]) {
      const f = D.findLine(snap, entry.line_id), line = f.line, info = P.lineFingerprint(snap, line, ctx);
      const eng = E.getEngine(info.engineId), seeded = !!eng.capabilities.deterministic_seed;
      const seed = seeded ? lineSeedOf(info.fp.inputs_sha) : null;
      const chunks = chunker(info.fp.spoken_text, { maxChars: eng.capabilities.max_chunk_chars });
      const lw = { line, scene: f.scene, info, seed, chunks, finished: false, failed: false, order: lineIndex.get(line.id) };
      lw.items = chunks.map((c, i) => ({ lw, i, chunk: c, fp: chunkFpOf(info.fp.inputs_sha, seed, i, chunks.length, c.text), seed: seeded ? (seed + i) % 2147483647 : null }));
      for (const it of lw.items) {
        const rc = chunkStore.get(projectId, it.fp);
        if (rc) { it.receipt = rc; prod.chunks.cached++; } else if (chunkStore.lastInvalid(projectId, it.fp)) prod.chunks.invalid++;
      }
      prod.chunks.total += lw.items.length; work.push(lw);
    }
    prod.progress_total = prod.chunks.total;
    const label = (lw, it) => `Scene ${sceneOrder.get(lw.scene.id) + 1}/${snap.scenes.length} · line ${lw.order + 1}/${renderable.length} · chunk ${it.i + 1}/${lw.items.length}`;

    // 2. finish any line whose chunks are all already cached (resume), then group the rest by voice
    const finishLine = lw => {
      if (lw.finished) return; lw.finished = true;
      const took = makeTake(prod, snap, lw); lw.take = took; prod.lines.generated++;
    };
    for (const lw of work) if (lw.items.every(it => it.receipt)) finishLine(lw);
    const groups = new Map();
    for (const lw of work) {
      if (lw.finished) continue;
      const dir = lw.info.fp.delivery.applied ? lw.info.direction : '';
      const key = [lw.info.profile_id, lw.info.engineId, lw.info.language, lw.info.fp.speed || '', dir].join('|');
      if (!groups.has(key)) groups.set(key, { key, lw0: lw, dir, items: [] });
      groups.get(key).items.push(...lw.items.filter(it => !it.receipt));
    }
    progress(prod, 'rendering', { label: work.length ? 'Preparing speech' : 'Speech is up to date', total: prod.chunks.total });

    // 3. synthesis: one group (= one model load) at a time through the shared lease; bounded retries
    const hasReceipt = it => !!it.receipt;
    for (const g of groups.values()) {
      for (const batch of chunkArray(g.items.sort((a, b) => a.lw.order - b.lw.order || a.i - b.i), batchSize)) {
        if (prod.cancel_requested) break;
        let remaining = batch, attempt = 0, fatal = null;
        while (remaining.length && attempt < retry.max_attempts && !prod.cancel_requested && !fatal) {
          if (attempt > 0) prod.chunks.retries++;
          attempt++;
          fatal = await runBatch(prod, snap, g, remaining, label);
          remaining = remaining.filter(it => !hasReceipt(it));
        }
        for (const it of remaining) { it.lw.failed = true; }
        if (remaining.length && !prod.cancel_requested) {
          prod.chunks.failed += remaining.length;
          const lines = [...new Set(remaining.map(it => it.lw.line.id))];
          for (const id of lines) prod.errors.push({ code: fatal ? fatal.gate || 'render-error' : 'chunk-failed', line_id: id, message: (fatal && fatal.error) || prod.last_error || 'speech synthesis failed after retries' });
        }
      }
      if (prod.cancel_requested) break;
    }
    prod.lines.failed = work.filter(lw => !lw.finished).length;
    if (prod.cancel_requested) return finish(prod, 'cancelled');
    if (prod.lines.failed) return finish(prod, prod.lines.generated + prod.lines.reused ? 'partial' : 'failed', { gate: 'speech-incomplete', message: `${prod.lines.failed} line(s) could not be synthesised; completed chunks were kept and a new run will only render the missing ones` });

    // 4. did the project change underneath the snapshot?
    const l1 = live(); const post = P.planProduction(l1, ctx);
    const changed = (l1.source_rev || 1) !== prod.source_rev || post.lines.some(l => l.state !== 'reuse');
    if (changed) { prod.superseded = true; return finish(prod, 'superseded', { gate: 'superseded', message: 'the screenplay or cast changed while this was being produced; the new recordings are saved, produce again to assemble the current version' }); }

    // 5. integrity gate: every take that will enter the master must still be the exact audio that was rendered
    progress(prod, 'assembling', { label: 'Verifying takes', done: 0, total: post.chosen.size });
    const bad = [];
    for (const [lineId, take] of post.chosen) {
      const r = await Integrity.checkTake({ take, record: mediaStore.resolve(take.artifact_id), words: (take.measure && take.measure.words) || null });
      if (!r.ok) bad.push({ line_id: lineId, take_id: take.id, codes: r.hard.map(h => h.code) });
    }
    if (bad.length) { for (const b of bad) prod.errors.push({ code: 'integrity', line_id: b.line_id, message: 'take failed integrity checks: ' + b.codes.join(', ') }); prod.lines.failed = bad.length; return finish(prod, 'failed', { gate: 'integrity', message: `${bad.length} take(s) failed integrity checks (${[...new Set(bad.flatMap(b => b.codes))].join(', ')}); they were not used. Re-render those lines.` }); }

    // 6. assembly: scene masters (only rebuilt where their assembly fingerprint changed), then the project master
    const result = await assembleAll(prod, l1, post);
    if (prod.cancel_requested) return finish(prod, 'cancelled');
    if (!result.ok) return finish(prod, 'failed', { gate: result.gate || 'assembly-failed', message: result.error });

    // 7. review: local speech verification (when available), speech-boundary suggestions, then the Production Proof
    await review(prod, l1, post, result);
    finish(prod, 'complete', { record: result.record });
  }

  // Post-master review. Never changes the master; records what was (not) verified.
  async function review(prod, p, post, result) {
    let summary = null;
    if (qa) {
      progress(prod, 'reviewing', { label: 'Reviewing speech', done: 0, total: post.chosen.size });
      try {
        const items = [...post.chosen].map(([lineId, take]) => { const line = D.findLine(p, lineId).line, info = P.lineFingerprint(p, line, ctxOf());
          return { line, take, expected: info.fp ? info.fp.spoken_text : line.text, words: (take.measure && take.measure.words) || null, inputsSha: info.fp ? info.fp.inputs_sha : null }; });
        const r = await qa.run(items, { asr: prod.opts && prod.opts.asr === false ? false : 'auto', onProgress: x => progress(prod, 'reviewing', { label: `Reviewing speech ${x.done + 1}/${x.total}`, done: x.done, total: x.total }) });
        for (const l of r.lines) { const f = D.findLine(p, l.line_id); const t = f && f.line.takes.find(x => x.id === l.take_id); if (t) t.qa = l.qa; }
        summary = r.summary; prod.qa = summary; store.touch(p);
      } catch (e) { prod.warnings.push({ code: 'qa-error', message: String(e.message).slice(0, 160) }); }
    }
    if (proofs) {
      try {
        const out = p.project_master || {};
        const proof = Proof.buildProof({ production: view(prod), project: p, ctx: ctxOf(), plan: post, qa: summary, master: result.record, outputs: prod.artifacts.outputs || {}, integrity: out.integrity || null, mastering: prod.mastering || out.mastering || null, chapters: out.chapters || [], mediaStore, now });
        proofs.save(proof); prod.proof = { id: prod.id, proof_sha256: proof.proof_sha256, master_sha256: proof.master.sha256, asr_state: proof.asr.state };
      } catch (e) { prod.warnings.push({ code: 'proof-error', message: String(e.message).slice(0, 160) }); }
    }
  }

  // Render one batch of pending chunks (same voice) as ONE Big Mac job; each verified chunk is receipted immediately.
  async function runBatch(prod, snap, g, items, label) {
    const info = g.lw0.info;
    const onItem = async it => {
      const x = items[it.index]; if (!x) throw new Error('unexpected item index');
      x.receipt = chunkStore.put(prod.project_id, x.fp, it.file, { line_id: x.lw.line.id, ordinal: x.i, total: x.lw.items.length, boundary: x.chunk.boundary, gap_ms: x.chunk.gapAfterMs, inputs_sha: x.lw.info.fp.inputs_sha,
        engine: info.engineId, engine_revision: x.lw.info.fp.revision, profile_id: info.profile_id, profile_fp: (info.profile && info.profile.fingerprint) || null, seed: x.seed });
      prod.chunks.generated++;
      progress(prod, 'rendering', { label: label(x.lw, x) });
      if (x.lw.items.every(i2 => i2.receipt) && !x.lw.finished) { x.lw.finished = true; x.lw.take = makeTake(prod, snap, x.lw); prod.lines.generated++; }
    };
    const r = voice.renderItems({ profileId: info.profile_id, items: items.map(x => ({ text: x.chunk.text, seed: x.seed })), direction: g.dir || undefined, language: info.language, engine: info.engineId, speed: info.fp.speed || undefined,
      operation: 'drama-chunks', saveText: false, meta: { drama: { project_id: prod.project_id, production_id: prod.id } }, safeParams: { project_id: prod.project_id, production_id: prod.id }, onItem });
    if (r.error) { prod.last_error = r.error; return { fatal: true, gate: r.gate || 'render-refused', error: r.error }; }
    prod.child_job_id = r.job_id;
    const d = await voice.waitJob(r.job_id, { pollMs, timeoutMs: 60 * 60 * 1000, onTick: t => {
      if (!t) return;
      if (t.status === 'QUEUED') progress(prod, 'rendering', { label: 'Waiting for Big Mac', waiting: true });
      else if (t.progress && t.progress.phase === 'loading-model') progress(prod, 'rendering', { label: 'Loading voice model on Big Mac', waiting: false });
      else if (t.progress && t.progress.chunk && items[t.progress.chunk - 1]) progress(prod, 'rendering', { label: label(items[t.progress.chunk - 1].lw, items[t.progress.chunk - 1]), waiting: false });
    } });
    prod.child_job_id = null;
    if (!d || d.status !== 'COMPLETE') { prod.last_error = (d && d.error) || 'render failed'; return d && d.status === 'CANCELLED' ? { fatal: true, gate: 'cancelled', error: 'cancelled' } : null; }
    return null;
  }

  // Stitch a line's chunks into one take, exactly like a long-form render, and publish it to the canonical voice store.
  function makeTake(prod, snap, lw) {
    const project = prod.project_id;
    const parts = lw.items.map(it => A.parseWav(fs.readFileSync(chunkStore.pathOf(project, it.fp))));
    let audio = parts.length > 1 ? A.stitch(parts, { gapsMs: lw.chunks.slice(0, -1).map(c => c.gapAfterMs), crossfadeMs: 25, normalizeOutput: false }) : parts[0];
    audio = A.normalize(audio, { targetPeakDb: -1, maxGainDb: 0 });
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'dexline-')), file = path.join(dir, 'line.wav');
    try {
      fs.writeFileSync(file, A.encodeWav(audio));
      const stamp = new Date().toISOString().replace(/[-:]/g, '').replace('T', '-').slice(0, 15);
      const eng = E.getEngine(lw.info.engineId);
      const lineage = lw.items.map(it => ({ index: it.i, duration: it.receipt.duration, sha256: it.receipt.sha256, boundary: it.chunk.boundary, chars: it.chunk.text.length }));
      const rec = mediaStore.finalize(file, { kind: 'voice', base: `${stamp}-${eng.worker}-drama-line`, worker: eng.worker, model: eng.worker, seed: lw.seed, duration: A.duration(audio),
        meta: { operation: 'drama-line', production_id: prod.id, sample_rate: audio.sampleRate, channels: 1, drama: { project_id: project, scene_id: lw.scene.id, line_id: lw.line.id }, long_form: lw.items.length > 1 ? { chunks: lw.items.length, lineage } : null, engine: lw.info.engineId, profile_id: lw.info.profile_id } });
      const { spoken_text: _t, ...fpRecord } = lw.info.fp;
      const take = { id: sid('tk'), line_id: lw.line.id, status: 'complete', created_at: now(), completed_at: now(), artifact_id: rec.artifact_id, duration: rec.duration, sha256: rec.sha256, profile_id: lw.info.profile_id, engine: lw.info.engineId, seed: lw.seed,
        fingerprint: fpRecord, render_sha: F.renderFingerprint(lw.info.fp, lw.seed), measure: Pacing.measure(lw.info.fp.spoken_text, audio), source_rev: prod.source_rev, production_id: prod.id, chunks: lw.items.length, receipts: lw.items.map(it => it.fp), settings: { direction: lw.info.direction, delivery: lw.info.fp.delivery, chunks: lw.items.length, seeded: lw.seed != null } };
      const liveLine = D.findLine(drama.need(project), lw.line.id);
      if (liveLine) { liveLine.line.takes.push(take); if (!liveLine.line.active_take_id || !liveLine.line.takes.some(t => t.id === liveLine.line.active_take_id && t.status === 'complete' && t.fingerprint && t.fingerprint.inputs_sha === fpRecord.inputs_sha)) liveLine.line.active_take_id = take.id; store.touch(drama.need(project)); }
      const sl = D.findLine(snap, lw.line.id); if (sl) { sl.line.takes.push(Object.assign({}, take)); sl.line.active_take_id = take.id; }
      return take;
    } finally { try { fs.rmSync(dir, { recursive: true, force: true }); } catch (_) {} }
  }

  // Scene masters (rebuilt only where their assembly fingerprint changed) + the mastered project master and delivery formats.
  async function assembleAll(prod, p, post) {
    const entries = post.assembly.filter(a => a.action !== 'blocked').map(a => ({ scene_id: a.scene_id, title: a.title, action: a.action === 'reuse' ? 'reuse' : 'rebuild', fingerprint: a.fingerprint }));
    let res;
    try {
      res = await assembly.build(p, { entries, takeFor: l => post.chosen.get(l.id) || null, delivery: prod.opts.delivery, mastering: prod.opts.mastering, productionId: prod.id, persist: () => store.touch(p),
        cancelled: () => prod.cancel_requested, onProgress: x => progress(prod, x.phase, { label: x.label, done: x.done, total: x.total }) });
    } catch (e) { return { ok: false, gate: e.gate || 'assembly-failed', error: String(e.message).slice(0, 200) }; }
    if (res.cancelled) return { ok: false, cancelled: true };
    prod.scenes = res.sceneEntries.map(s => ({ scene_id: s.scene_id, action: s.action, artifact_id: s.master.artifact_id }));
    prod.artifacts.scenes = prod.scenes.map(s => s.artifact_id);
    if (res.reused) {
      const cur = res.reused; prod.noop = res.noop && prod.chunks.generated === 0 && prod.lines.generated === 0;
      prod.artifacts.master = cur.artifact_id; prod.artifacts.outputs = cur.outputs || {}; prod.artifacts.stems = cur.stems || {}; prod.mastering = cur.mastering || null;
      return { ok: true, record: Object.assign({}, mediaStore.resolve(cur.artifact_id), { canonical: true, validated: true }) };
    }
    const out = res.project;
    progress(prod, 'publishing', { label: 'Publishing master', done: entries.length, total: entries.length });
    p.project_master = { assembly_fp: res.projectFp, artifact_id: out.master.artifact_id, sha256: out.master.sha256, duration: out.duration_s, frames: out.frames, outputs: Object.fromEntries(Object.entries(out.outputs).map(([k, v]) => [k, v.record.artifact_id])),
      stems: Object.fromEntries(Object.entries(out.stems).map(([k, v]) => [k, v.artifact_id])), mastering: out.mastering, chapters: out.chapters, integrity: out.integrity, production_id: prod.id, built_at: now() };
    prod.artifacts.master = out.master.artifact_id; prod.artifacts.outputs = p.project_master.outputs; prod.artifacts.stems = p.project_master.stems; prod.mastering = out.mastering;
    p.exports.unshift({ id: sid('ex'), production_id: prod.id, artifact_id: out.master.artifact_id, outputs: p.project_master.outputs, kind: 'current', scope: 'project', source_rev: prod.source_rev, at: now(), duration_s: out.duration_s, chapters: out.chapters, mastering: { preset: out.mastering.preset, applied: out.mastering.applied, gain_db: out.mastering.gain_db, limiter_engaged: out.mastering.limiter_engaged } });
    p.exports = p.exports.slice(0, 20); store.touch(p);
    return { ok: true, record: out.master };
  }

  // ── control & queries ───────────────────────────────────────────────────────────
  function cancel(productionId) {
    const prod = productions.get(productionId); if (!prod) return { ok: false, error: 'production not found', status: 404 };
    if (TERMINAL.has(prod.status)) return { ok: false, error: 'production already finished', status: prod.status };
    prod.cancel_requested = true;
    if (prod.child_job_id && cancelChild) { const c = jobStore.get(prod.child_job_id); if (c && c.status === 'QUEUED') { try { cancelChild(prod.child_job_id); } catch (_) {} } }
    emit({ type: 'cancel-requested', production_id: prod.id });
    return { ok: true, status: 'cancelling', note: 'stops after the Big Mac render that is already running (it cannot be interrupted safely); finished chunks are kept' };
  }
  const cancelByJob = jobId => { for (const p of productions.values()) if (p.job_id === jobId) return cancel(p.id); return { ok: false }; };
  async function waitFor(id, ms = 30000) { const prod = productions.get(id); if (!prod) return null; await Promise.race([prod.done, new Promise((_, rej) => setTimeout(() => rej(new Error('production wait timed out')), ms))]); return view(prod); }
  return { produce, cancel, cancelByJob, waitFor, get: id => { const p = productions.get(id); return p ? view(p) : null; }, list: projectId => [...productions.values()].filter(p => p.project_id === projectId).map(view),
    isBusy: projectId => active.has(projectId), activeFor: projectId => (active.has(projectId) ? view(productions.get(active.get(projectId))) : null) };
}

module.exports = { createProducer, lineSeedOf, chunkFpOf };
