'use strict';

// Portable voice bank: versioned export/import of voice profiles as a ZIP.
//
// Export is metadata-only unless the caller explicitly selects audio and/or transcripts. Import treats the archive as
// hostile (see portable-archive.js), verifies every checksum and WAV, reports engine compatibility, renames or skips
// duplicate profile ids, and NEVER imports cached speaker state: DexDiffusion recomputes the reference on every render,
// so any "embedding"/"cached prompt" in a package would be unverifiable and is dropped with a warning.
// Imported voices arrive as unapproved, unlocked drafts that must be re-auditioned locally.

const crypto = require('crypto');
const fs = require('fs');
const os = require('os');
const path = require('path');
const Z = require('./portable-archive');
const E = require('./voice-engines');
const A = require('./voice-audio');
const { TYPES, CONSENT_KINDS } = require('./voice-profiles');

const SCHEMA = 'dexdiffusion.voice_bank.v1';
const LIMITS = { maxEntries: 400, maxTotalBytes: 400 * 1024 ** 2, maxEntryBytes: 40 * 1024 ** 2, maxRatio: 200 };
const PID = /^vp-[a-f0-9]{10}$/, SID = /^sm-[a-f0-9]{10}$/;
const CACHED_KEY = /embed|speaker_prompt|cached|prompt_cache|voice_state|latent/i;
const sha = b => crypto.createHash('sha256').update(b).digest('hex');
const cap = (v, n) => String(v == null ? '' : v).slice(0, n);

async function exportBank({ profiles, ids, outPath, include_audio = false, include_transcripts = false, now = () => Date.now() }) {
  const list = (ids || []).map(id => { const p = profiles.get(id); if (!p) throw Object.assign(new Error('voice profile not found: ' + id), { status: 404 }); return p; });
  if (!list.length) throw Object.assign(new Error('choose at least one voice to export'), { status: 400 });
  const entries = [];
  const manifest = { schema: SCHEMA, bank_id: 'vb-' + crypto.randomBytes(5).toString('hex'), created_at: now(), app: 'DexDiffusion', options: { include_audio: !!include_audio, include_transcripts: !!include_transcripts },
    notes: ['Cached speaker embeddings and prompts are never exported or imported; DexDiffusion recomputes the reference audio on every render.'], profiles: [] };
  for (const p of list) {
    const out = { id: p.id, name: p.name, type: p.type, language: p.language, description: p.description || '', preset_voice: p.preset_voice || null, default_direction: p.default_direction || '', default_speed: p.default_speed || null,
      notes: p.notes || '', design: p.design || null, preferred_engine: p.preferred_engine || null, required_engines: E.compatibleEngines(p), identity_version: p.identity_version, fingerprint: p.fingerprint,
      approval_at_export: p.approval && p.approval.state, consent: p.consent, origin: p.origin, samples: [] };
    for (const s of p.samples || []) {
      const rec = { id: s.id, name: s.name, active: !!s.active, sha256: s.sha256, bytes: s.bytes, duration: s.diagnostics && s.diagnostics.duration, review: s.review && s.review.state };
      if (include_transcripts) rec.transcript = s.transcript || '';
      if (include_audio) {
        const file = profiles.samplePath(p.id, s.id);
        if (!file) throw Object.assign(new Error(`reference sample ${s.id} of ${p.name} is missing on disk`), { status: 409, gate: 'reference-invalid' });
        rec.file = `samples/${p.id}/${s.id}.wav`; entries.push({ name: rec.file, file, store: true });
      }
      out.samples.push(rec);
    }
    manifest.profiles.push(out);
  }
  entries.unshift({ name: 'manifest.json', data: Buffer.from(JSON.stringify(manifest, null, 1)) });
  const w = await Z.writeZip(outPath, entries);
  return { bytes: w.bytes, manifest, entries: w.entries };
}

async function importBank({ profiles, zipPath, apply = false, on_conflict = 'rename' }) {
  const report = { ok: false, applied: false, errors: [], warnings: [], profiles: [], created: [] };
  let z;
  try { z = Z.openZip(zipPath, LIMITS); } catch (e) { report.errors.push(e.message); return report; }
  try {
    if (!z.has('manifest.json')) { report.errors.push('the package has no manifest.json'); return report; }
    const mEntry = z.entries.find(e => e.name === 'manifest.json');
    if (mEntry.usize > 2 * 1024 ** 2) { report.errors.push('manifest.json is too large'); return report; }
    let m; try { m = JSON.parse(z.read('manifest.json').toString('utf8')); } catch (_) { report.errors.push('manifest.json is not valid JSON'); return report; }
    if (!m || typeof m.schema !== 'string' || !/^dexdiffusion\.voice_bank\./.test(m.schema)) { report.errors.push('unrecognised package schema'); return report; }
    if (m.schema !== SCHEMA) { report.errors.push(`unsupported voice bank version "${m.schema}" (this build reads ${SCHEMA})`); return report; }
    if (!Array.isArray(m.profiles)) { report.errors.push('manifest.json has no profile list'); return report; }
    if (m.profiles.length > 100) { report.errors.push('too many profiles in one package (max 100)'); return report; }
    const seen = new Set(), existing = new Set(profiles.list().map(p => p.id));
    const prepared = [];
    for (const raw of m.profiles) {
      const r = { id: cap(raw && raw.id, 60), name: cap(raw && raw.name, 80), action: 'create', problems: [], warnings: [], new_id: null };
      report.profiles.push(r);
      if (!raw || typeof raw !== 'object') { r.problems.push('invalid profile entry'); continue; }
      if (!PID.test(r.id)) r.problems.push('invalid profile id');
      else if (seen.has(r.id)) r.problems.push('duplicate profile id in this package'); else seen.add(r.id);
      if (!TYPES.includes(raw.type)) r.problems.push(`unsupported profile type "${cap(raw.type, 20)}"`);
      if (!r.name.trim()) r.problems.push('profile has no name');
      for (const k of Object.keys(raw)) if (CACHED_KEY.test(k)) r.warnings.push(`ignored cached voice state "${k}": DexDiffusion recomputes the reference on every render`);
      for (const eng of Array.isArray(raw.required_engines) ? raw.required_engines : []) if (!E.getEngine(String(eng))) r.warnings.push(`engine "${cap(eng, 40)}" is not available in this DexDiffusion; the voice cannot render here until a compatible engine is installed`);
      const samples = [];
      for (const s of Array.isArray(raw.samples) ? raw.samples : []) {
        if (!s || typeof s !== 'object') { r.problems.push('invalid sample entry'); continue; }
        for (const k of Object.keys(s)) if (CACHED_KEY.test(k)) r.warnings.push(`ignored cached voice state "${k}" on a sample`);
        if (!s.file) { r.warnings.push(`sample "${cap(s.name, 40)}": audio was not included in the package`); continue; }
        if (!SID.test(String(s.id)) || s.file !== `samples/${r.id}/${s.id}.wav`) { r.problems.push(`invalid sample path ${JSON.stringify(cap(s.file, 80))}`); continue; }
        if (!z.has(s.file)) { r.warnings.push(`missing sample audio for "${cap(s.name, 40)}" (${s.file} is not in the package)`); continue; }
        let buf; try { buf = z.read(s.file); } catch (e) { r.problems.push(`sample ${s.id}: ${e.message}`); continue; }
        if (sha(buf) !== String(s.sha256)) { r.problems.push(`sample ${s.id}: checksum mismatch (the audio does not match the manifest)`); continue; }
        const diag = profiles.diagnose(buf);
        if (!diag.ok) { r.problems.push(`sample ${s.id}: invalid audio (${diag.errors.join('; ')})`); continue; }
        if (raw.type === 'cloned' && !String(s.transcript || '').trim()) r.warnings.push(`sample "${cap(s.name, 40)}" has no transcript; add its exact transcript before rendering`);
        samples.push({ wav: buf, name: cap(s.name, 80), transcript: cap(s.transcript, 4000), active: !!s.active, original_id: s.id });
      }
      if (existing.has(r.id) && !r.problems.length) {
        if (on_conflict === 'skip') { r.action = 'skip'; r.warnings.push('a voice with this id already exists; skipped'); }
        else { r.action = 'rename'; r.new_id = 'vp-' + crypto.randomBytes(5).toString('hex'); r.warnings.push('a voice with this id already exists; imported under a new id'); }
      }
      if (r.problems.length) r.action = 'reject';
      prepared.push({ r, raw, samples });
    }
    report.ok = prepared.length > 0 && prepared.every(x => x.r.action !== 'reject') || prepared.some(x => x.r.action === 'create' || x.r.action === 'rename');
    report.warnings = [...new Set(prepared.flatMap(x => x.r.warnings))];
    if (!apply) return report;
    for (const { r, raw, samples } of prepared) {
      if (r.action === 'reject' || r.action === 'skip') continue;
      const design = raw.type === 'designed' && raw.design && typeof raw.design === 'object' ? raw.design : undefined;
      const created = profiles.create({ id: r.new_id || r.id, name: raw.name, type: raw.type, language: raw.language || 'en', description: raw.description, preset_voice: raw.preset_voice || undefined, default_direction: raw.default_direction,
        default_speed: raw.default_speed || undefined, notes: raw.notes, design, preferred_engine: raw.preferred_engine || undefined, consent: raw.consent && CONSENT_KINDS.includes(raw.consent.kind) ? raw.consent : undefined,
        origin: { kind: 'imported', original_id: r.id, imported_from: cap(m.bank_id, 40) } });
      let activeSet = false;
      for (const s of samples) {
        const added = await profiles.addSample(created.id, { wav: s.wav, name: s.name, transcript: s.transcript });
        if (s.active && !activeSet) { profiles.updateSample(created.id, added.sample.id, { active: true }); activeSet = true; }
      }
      const final = profiles.get(created.id);
      report.created.push({ id: final.id, original_id: r.id, name: final.name, validation: final.validation.state });
    }
    report.applied = true;
    return report;
  } finally { z.close(); }
}

module.exports = { exportBank, importBank, SCHEMA, LIMITS };
