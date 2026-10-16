'use strict';

// Audition lab: DESCRIBE → AUDITION → COMPARE → APPROVE → (LOCK) → REUSE, plus design→clone promotion and the
// multi-line clone trial. Everything renders through the existing voice service (one Big Mac job per round, shared
// heavy-compute lease). Nothing is auto-approved: approval, rejection, favourites and trial acceptance are human acts.
//
// Privacy: audition text may be a line from an unsaved screenplay, so only its hash and length are stored unless the
// caller opts in with keep_text. The hash is what lets promotion verify the clone transcript is EXACT without the text.

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const A = require('./voice-audio');
const E = require('./voice-engines');
const F = require('./drama-fingerprint');

const sid = p => p + '-' + crypto.randomBytes(4).toString('hex');
const ID_OK = /^vp-[a-f0-9]{10}$/;
const gate = (message, gate_, status = 409) => Object.assign(new Error(message), { status, gate: gate_ });
const textSha = t => F.sha(F.normalizeSpokenText(t));
const descSha = p => F.sha(F.normalizeSpokenText(p.description || ''));

function createAuditionService({ dir, profiles, voice, mediaStore, jobStore, now = () => Date.now() }) {
  const root = path.resolve(dir);
  fs.mkdirSync(root, { recursive: true, mode: 0o700 });
  const cache = new Map(), active = new Set();
  const fileOf = id => path.join(root, id + '.json');
  function load(profileId) {
    if (!ID_OK.test(String(profileId))) throw gate('invalid profile id', 'invalid', 400);
    if (cache.has(profileId)) return cache.get(profileId);
    let d; try { d = JSON.parse(fs.readFileSync(fileOf(profileId), 'utf8')); } catch (_) { d = null; }
    if (!d) d = { schema: 'dexdiffusion.voice_auditions.v1', profile_id: profileId, rounds: [], trials: [] };
    for (const r of d.rounds) if (r.status === 'rendering' && !active.has(r.id)) { r.status = 'interrupted'; for (const c of r.candidates) if (c.status === 'rendering') { c.status = 'interrupted'; c.error = 'interrupted: the console restarted before this render finished'; } }
    for (const t of d.trials) if (t.status === 'rendering' && !active.has(t.id)) { t.status = 'interrupted'; t.error = 'interrupted: the console restarted before this render finished'; }
    cache.set(profileId, d); return d;
  }
  function save(d) {
    const f = fileOf(d.profile_id), tmp = `${f}.${process.pid}.${crypto.randomBytes(3).toString('hex')}.tmp`;
    const fd = fs.openSync(tmp, 'w', 0o600); try { fs.writeSync(fd, JSON.stringify(d, null, 1) + '\n'); fs.fsyncSync(fd); } finally { fs.closeSync(fd); }
    fs.renameSync(tmp, f);
  }
  const needProfile = id => { const p = profiles.get(id); if (!p) throw gate('voice profile not found', 'profile-missing', 404); return p; };
  const clipView = c => { const a = c.artifact_id && mediaStore.resolve(c.artifact_id); return Object.assign({}, c, { url: a ? a.safe_url : null, download_url: a ? a.download_url : null }); };
  const roundView = r => Object.assign({}, r, { stale: (() => { const pr = profiles.get(r.profile_id); return !!pr && r.description_sha !== descSha(pr); })(), candidates: r.candidates.map(c => Object.assign({}, c, { clips: c.clips.map(clipView) })) });

  function cleanTexts({ text, lines }) {
    const list = Array.isArray(lines) && lines.length ? lines : [text];
    const texts = list.map(t => F.normalizeSpokenText(t)).filter(Boolean);
    if (!texts.length) throw gate('audition text is required', 'invalid', 400);
    if (texts.length > 6) throw gate('an audition scene holds at most 6 lines', 'invalid', 400);
    return texts;
  }

  // ── audition rounds ───────────────────────────────────────────────────────────
  function start(profileId, opts = {}) {
    const profile = needProfile(profileId);
    if (profile.type !== 'designed') throw gate('auditions apply to designed voices; use the clone trial for a cloned voice', 'invalid', 400);
    const texts = cleanTexts(opts), count = Math.max(1, Math.min(6, Number(opts.count) || 3));
    const seeds = Array.from({ length: count }, (_, k) => (Array.isArray(opts.seeds) && opts.seeds[k] != null ? Number(opts.seeds[k]) : crypto.randomInt(0, 2147483000)));
    if (new Set(seeds).size !== seeds.length) throw gate('candidate seeds must be distinct', 'invalid', 400);
    const items = []; for (const sd of seeds) for (const t of texts) items.push({ text: t, seed: sd });
    const round = { id: sid('ar'), profile_id: profileId, created_at: now(), status: 'rendering', job_id: null, source: opts.source === 'scene' ? 'scene' : 'custom', line_count: texts.length,
      text_sha: texts.map(textSha), text_chars: texts.map(t => t.length), texts: opts.keep_text === true ? texts : undefined, engine: null, runtime: null, description_sha: descSha(profile),
      identity_version: profile.identity_version, direction: opts.direction ? 'requested' : null, delivery_applied: null,
      candidates: seeds.map(seed => ({ id: sid('au'), seed, status: 'rendering', clips: [], favorite: false, rejected: false, note: '', approved: false })) };
    const d = load(profileId);
    const total = texts.length;
    const onItem = async it => {
      const k = Math.floor(it.index / total), j = it.index % total, cand = round.candidates[k];
      const stamp = new Date().toISOString().replace(/[-:]/g, '').replace('T', '-').slice(0, 15);
      const rec = mediaStore.finalize(it.file, { kind: 'voice', base: `${stamp}-audition-${cand.id}`, job_id: it.job_id, worker: it.worker, model: it.worker, seed: cand.seed, duration: it.duration,
        meta: { operation: 'audition', audition: { profile_id: profileId, round_id: round.id, candidate_id: cand.id, line_index: j }, seed: cand.seed } });
      cand.clips.push({ line_index: j, artifact_id: rec.artifact_id, duration: rec.duration, sha256: rec.sha256 });
      if (cand.clips.length === total) cand.status = 'complete';
      save(d);
      return rec;
    };
    const r = voice.renderItems({ profileId, items, direction: opts.direction, language: opts.language, operation: 'audition', onItem, saveText: false, meta: { audition: true } });
    if (r.error) throw Object.assign(new Error(r.error), { status: r.status || 400, gate: r.gate });
    round.job_id = r.job_id; round.engine = r.engine; round.runtime = r.revision; round.delivery_applied = r.delivery.applied;
    d.rounds.push(round); active.add(round.id); save(d);
    voice.waitJob(r.job_id, { pollMs: 25 }).then(res => {
      for (const c of round.candidates) if (c.status !== 'complete') { c.status = 'failed'; c.error = (res && res.error) || 'render failed'; }
      const ok = round.candidates.filter(c => c.status === 'complete').length;
      round.status = ok === round.candidates.length ? 'complete' : ok ? 'partial' : 'failed'; if (round.status !== 'complete') round.error = res && res.error || null;
    }).catch(e => { round.status = 'failed'; round.error = String(e.message).slice(0, 200); }).finally(() => { active.delete(round.id); save(d); });
    return roundView(round);
  }
  const findRound = (profileId, roundId) => { const d = load(profileId), r = d.rounds.find(x => x.id === roundId); if (!r) throw gate('audition round not found', 'not-found', 404); return { d, r }; };
  const findCand = (r, id) => { const c = r.candidates.find(x => x.id === id); if (!c) throw gate('candidate not found', 'not-found', 404); return c; };
  function getRound(profileId, roundId) { return roundView(findRound(profileId, roundId).r); }
  function listRounds(profileId) { return load(profileId).rounds.slice().reverse().map(roundView); }

  function mark(profileId, roundId, candId, patch = {}) {
    const { d, r } = findRound(profileId, roundId), c = findCand(r, candId);
    if (patch.favorite !== undefined) c.favorite = !!patch.favorite;
    if (patch.note !== undefined) c.note = String(patch.note).slice(0, 500);
    if (patch.rejected !== undefined) { if (patch.rejected && c.approved) throw gate('this candidate is approved; unlock or re-approve another before rejecting it', 'candidate-approved'); c.rejected = !!patch.rejected; }
    save(d); return roundView(r).candidates.find(x => x.id === candId);
  }
  function approve(profileId, roundId, candId, { note } = {}) {
    const { d, r } = findRound(profileId, roundId), c = findCand(r, candId), profile = needProfile(profileId);
    if (c.rejected) throw gate('a rejected candidate cannot be approved', 'candidate-rejected');
    if (c.status !== 'complete' || !c.clips.length) throw gate('only a completed candidate can be approved', 'candidate-incomplete');
    if (r.description_sha !== descSha(profile)) throw gate('the voice description changed after this audition; audition the current voice before approving', 'audition-outdated');
    if (profile.locked) throw gate('this voice is locked; unlock it to approve a different candidate', 'profile-locked');
    for (const rr of d.rounds) for (const cc of rr.candidates) cc.approved = false;
    c.approved = true; c.approved_at = now(); c.approval_note = String(note || '').slice(0, 500);
    save(d);
    const updated = profiles.approve(profileId, { note, audition_id: c.id });
    return { candidate: roundView(r).candidates.find(x => x.id === candId), profile: updated };
  }

  // ── design → clone promotion ───────────────────────────────────────────────────────────
  async function promote(profileId, roundId, candId, { transcript, name, clip_index = 0 } = {}) {
    const { d, r } = findRound(profileId, roundId), c = findCand(r, candId), design = needProfile(profileId);
    if (!c.approved) throw gate('approve this audition candidate before promoting it to a clone', 'candidate-not-approved');
    if (r.description_sha !== descSha(design)) throw gate('the voice description changed after this audition', 'audition-outdated');
    const clip = c.clips.find(x => x.line_index === Number(clip_index));
    if (!clip) throw gate('that audition clip does not exist', 'not-found', 404);
    if (textSha(transcript) !== r.text_sha[clip.line_index]) throw gate('the transcript does not exactly match the text that was spoken in this audition clip', 'transcript-mismatch', 400);
    const art = mediaStore.resolve(clip.artifact_id); if (!art) throw gate('the audition audio is missing', 'reference-invalid', 400);
    const buf = fs.readFileSync(art.path);
    if (crypto.createHash('sha256').update(buf).digest('hex') !== clip.sha256) throw gate('the audition audio no longer matches its recorded checksum', 'reference-invalid', 400);
    const dur = A.duration(A.parseWav(buf));
    if (dur < E.MIN_SAMPLE_S) throw gate(`this clip is only ${dur.toFixed(1)} s; a clone reference should be at least ${E.MIN_SAMPLE_S} s (audition a longer line)`, 'reference-too-short', 400);
    if (dur > E.MAX_SAMPLE_S) throw gate(`this clip is ${dur.toFixed(0)} s; keep a clone reference under ${E.MAX_SAMPLE_S} s`, 'reference-too-long', 400);
    const clone = profiles.create({ name: name || `${design.name} (clone)`, type: 'cloned', language: design.language, notes: `Promoted from design ${design.id}`,
      origin: { kind: 'promoted', design_profile_id: design.id, audition_id: c.id, design_description: design.description, model: r.engine, runtime: r.runtime, engine: 'qwen3-tts-base', seed: c.seed,
        design_identity_version: design.identity_version, approved_at: c.approved_at, language: design.language } });
    const added = await profiles.addSample(clone.id, { wav: buf, name: `Design reference ${c.id}`, transcript: F.normalizeSpokenText(transcript) });
    profiles.reviewSample(clone.id, added.sample.id, { state: 'approved', note: `approved by ear as audition ${c.id}` });
    profiles.setConsent(clone.id, { kind: 'fictional', note: 'Synthetic voice created locally from a text description (Qwen3-TTS VoiceDesign); no real person is imitated.' });
    profiles.setOrigin(clone.id, { kind: 'promoted', design_profile_id: design.id, audition_id: c.id, design_description: design.description, model: r.engine, runtime: r.runtime, engine: 'qwen3-tts-base', seed: c.seed,
      design_identity_version: design.identity_version, approved_at: c.approved_at, language: design.language, reference_sha256: added.sample.sha256 });
    profiles.linkClone(design.id, clone.id);
    return { profile: profiles.get(clone.id), sample: added.sample };
  }

  // ── multi-line clone trial ───────────────────────────────────────────────────────────────
  const clipChecks = (art, chars) => {
    const out = { decodable: false, not_silent: false, duration_plausible: false };
    try {
      const a = A.parseWav(fs.readFileSync(art.path || art.canonical_path)), x = A.analyze(a); out.decodable = true;
      out.not_silent = x.rms > 0.003 && x.silenceRatio < 0.95; out.duration_plausible = x.duration > 0.2 && x.duration < Math.max(2, chars / 2);
    } catch (_) {}
    return out;
  };
  function startTrial(profileId, { lines, keep_text } = {}) {
    const profile = needProfile(profileId);
    if (profile.type !== 'cloned') throw gate('a trial applies to a cloned voice', 'invalid', 400);
    const texts = (Array.isArray(lines) ? lines : []).map(t => F.normalizeSpokenText(t)).filter(Boolean);
    if (texts.length < 3) throw gate('a clone trial needs at least 3 different dialogue lines', 'invalid', 400);
    if (texts.length > 12) throw gate('a clone trial holds at most 12 lines', 'invalid', 400);
    const d = load(profileId);
    const trial = { id: sid('tr'), profile_id: profileId, created_at: now(), status: 'rendering', job_id: null, line_count: texts.length, text_sha: texts.map(textSha), texts: keep_text === true ? texts : undefined, clips: [], identity_version: profile.identity_version, fingerprint: profile.fingerprint };
    const onItem = async it => {
      const stamp = new Date().toISOString().replace(/[-:]/g, '').replace('T', '-').slice(0, 15);
      const rec = mediaStore.finalize(it.file, { kind: 'voice', base: `${stamp}-trial-${trial.id}`, job_id: it.job_id, worker: it.worker, model: it.worker, duration: it.duration, meta: { operation: 'clone-trial', trial: { profile_id: profileId, trial_id: trial.id, line_index: it.index } } });
      trial.clips.push({ line_index: it.index, artifact_id: rec.artifact_id, duration: rec.duration, sha256: rec.sha256, checks: clipChecks(mediaStore.resolve(rec.artifact_id) || rec, texts[it.index].length) });
      save(d); return rec;
    };
    const r = voice.renderItems({ profileId, items: texts.map(t => ({ text: t })), operation: 'clone-trial', onItem, saveText: false, meta: { trial: true } });
    if (r.error) throw Object.assign(new Error(r.error), { status: r.status || 400, gate: r.gate });
    trial.job_id = r.job_id; d.trials.push(trial); active.add(trial.id); save(d);
    voice.waitJob(r.job_id, { pollMs: 25 }).then(res => { trial.status = trial.clips.length === texts.length ? 'complete' : 'failed'; if (trial.status === 'failed') trial.error = (res && res.error) || 'render failed'; })
      .catch(e => { trial.status = 'failed'; trial.error = String(e.message).slice(0, 200); }).finally(() => { active.delete(trial.id); save(d); });
    return trialView(trial);
  }
  const trialView = t => Object.assign({}, t, { clips: t.clips.slice().sort((a, b) => a.line_index - b.line_index).map(clipView) });
  const findTrial = (profileId, id) => { const t = load(profileId).trials.find(x => x.id === id); if (!t) throw gate('trial not found', 'not-found', 404); return t; };
  const getTrial = (profileId, id) => trialView(findTrial(profileId, id));
  async function waitTrial(profileId, id, { timeoutMs = 20000 } = {}) {
    const t0 = Date.now();
    for (;;) { const t = findTrial(profileId, id); if (t.status !== 'rendering') return trialView(t); if (Date.now() - t0 > timeoutMs) throw gate('trial timed out', 'timeout', 504); await new Promise(r => setTimeout(r, 10)); }
  }
  function acceptTrial(profileId, id, { note } = {}) {
    const t = findTrial(profileId, id), profile = needProfile(profileId);
    if (t.status !== 'complete') throw gate('only a completed trial can be accepted', 'trial-incomplete');
    if (t.fingerprint !== profile.fingerprint) throw gate('the voice changed after this trial; run a new trial', 'trial-outdated');
    if (t.clips.some(c => !c.checks.decodable || !c.checks.not_silent)) throw gate('some trial clips failed the integrity checks', 'trial-failed');
    const updated = profiles.setTrial(profileId, { passed: true, runs: [{ id: t.id, accepted_at: now(), note: String(note || '').slice(0, 500), lines: t.line_count }] });
    return { trial: trialView(t), profile: updated };
  }

  return { start, getRound, listRounds, mark, approve, promote, startTrial, getTrial, waitTrial, acceptTrial, listTrials: profileId => load(profileId).trials.slice().reverse().map(trialView) };
}

module.exports = { createAuditionService };
