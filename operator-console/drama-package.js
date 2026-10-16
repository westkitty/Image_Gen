'use strict';

// Portable project package (ZIP). Private material is excluded unless the user selects it:
//   screenplay text, voice reference samples (+ transcripts), take audio, masters/exports, stems, timeline & cast settings.
// Import treats the archive as hostile (portable-archive.js limits/path rules), verifies every checksum, never overwrites an
// existing project, renames colliding ids, and brings media in through the normal canonical media store.

const fs = require('fs');
const os = require('os');
const path = require('path');
const crypto = require('crypto');
const Z = require('./portable-archive');
const D = require('./drama');
const FX = require('./fx-rack');

const SCHEMA = 'dexdiffusion.drama_package.v1';
const LIMITS = { maxEntries: 3000, maxTotalBytes: 6 * 1024 ** 3, maxEntryBytes: 2 * 1024 ** 3, maxRatio: 400 };
const sha = b => crypto.createHash('sha256').update(b).digest('hex');

async function exportPackage({ project, profiles, mediaStore, include = {}, outPath, plan = null, now = () => Date.now() }) {
  const inc = { screenplay: !!include.screenplay, voice_metadata: include.voice_metadata !== false, voice_samples: !!include.voice_samples, takes: !!include.takes, masters: !!include.masters, stems: !!include.stems, timeline: include.timeline !== false };
  const entries = [], files = [];
  const addFile = (name, file, role, artifactId) => { entries.push({ name, file, store: true }); files.push({ path: name, role, artifact_id: artifactId || null }); };
  const addData = (name, data, role) => { entries.push({ name, data: Buffer.from(data) }); files.push({ path: name, role, sha256: sha(Buffer.from(data)), bytes: Buffer.byteLength(data) }); };
  // project structure (text stripped unless the screenplay is included)
  const proj = JSON.parse(JSON.stringify(project));
  delete proj.saved; delete proj._migrated_from; proj.exports = []; proj.productions = [];
  if (!inc.screenplay) { proj.source_script = ''; for (const sc of proj.scenes) for (const l of sc.lines) l.text = ''; proj.archived_lines = []; }
  if (!inc.takes) for (const sc of proj.scenes) for (const l of sc.lines) { l.takes = []; l.active_take_id = null; }
  if (!inc.timeline) { proj.tracks = []; proj.timeline = { version: 1, clip_overrides: {} }; for (const a of proj.actors) { a.fx = null; a.pacing = null; a.pronunciation = []; } }
  if (!inc.masters) { proj.scene_masters = {}; delete proj.project_master; }
  addData('project.json', JSON.stringify(proj), 'project');
  if (inc.screenplay) addData('screenplay.txt', project.source_script, 'screenplay');
  const voices = [];
  if (inc.voice_metadata) {
    for (const a of project.actors) {
      const pr = a.voice_profile_id && profiles.get(a.voice_profile_id); if (!pr || voices.some(v => v.id === pr.id)) continue;
      const rec = { id: pr.id, name: pr.name, type: pr.type, language: pr.language, description: pr.description, preset_voice: pr.preset_voice, default_direction: pr.default_direction, default_speed: pr.default_speed, design: pr.design, consent: pr.consent, identity_version: pr.identity_version, samples: [] };
      for (const s of pr.samples || []) {
        const sr = { id: s.id, name: s.name, active: !!s.active, sha256: s.sha256, bytes: s.bytes };
        if (inc.voice_samples) { const f = profiles.samplePath(pr.id, s.id); if (f) { sr.file = `voices/${pr.id}/${s.id}.wav`; sr.transcript = s.transcript; addFile(sr.file, f, 'voice-sample'); } }
        rec.samples.push(sr);
      }
      voices.push(rec);
    }
    addData('voices.json', JSON.stringify(voices), 'voices');
  }
  const refs = new Set();
  if (inc.takes) for (const sc of project.scenes) for (const l of sc.lines) for (const t of l.takes || []) if (t.artifact_id && t.status === 'complete' && (!plan || plan.chosen.get(l.id) === t || l.active_take_id === t.id)) refs.add(t.artifact_id);
  if (inc.masters) { for (const m of Object.values(project.scene_masters || {})) refs.add(m.artifact_id); const pm = project.project_master; if (pm) { refs.add(pm.artifact_id); for (const id of Object.values(pm.outputs || {})) refs.add(id); } }
  if (inc.stems) { for (const m of Object.values(project.scene_masters || {})) for (const id of Object.values(m.stems || {})) refs.add(id); const pm = project.project_master; if (pm) for (const id of Object.values(pm.stems || {})) refs.add(id); }
  if (inc.timeline) for (const t of project.tracks || []) if (t.artifact_id) refs.add(t.artifact_id);
  const media = [];
  for (const id of refs) { const r = mediaStore.resolve(id); if (!r) continue; const name = `media/${id}`; addFile(name, r.path, 'media', id); media.push({ artifact_id: id, kind: r.kind, sha256: r.sha256, bytes: r.bytes, duration: r.duration, path: name }); }
  const manifest = { schema: SCHEMA, created_at: now(), app: 'DexDiffusion', project: { id: project.id, title: project.title, source_rev: project.source_rev || 1, source_sha256: project.source_sha256 || null, text_included: inc.screenplay }, include: inc, media, voices: voices.map(v => ({ id: v.id, name: v.name, samples: v.samples.length })), files: [],
    notes: ['Reference samples, transcripts and screenplay text are only present when the matching option was selected.'] };
  // checksums for streamed file entries (computed once, recorded in the manifest)
  for (const f of files) { if (f.sha256) continue; const entry = entries.find(e => e.name === f.path); f.sha256 = await Z.sha256File(entry.file); f.bytes = fs.statSync(entry.file).size; }
  manifest.files = files;
  entries.unshift({ name: 'manifest.json', data: Buffer.from(JSON.stringify(manifest, null, 1)) });
  const w = await Z.writeZip(outPath, entries);
  return { bytes: w.bytes, manifest };
}

async function importPackage({ zipPath, drama, store, profiles, mediaStore, apply = false }) {
  const report = { ok: false, applied: false, errors: [], warnings: [], project: null, media: { total: 0, imported: 0 }, voices: [], collisions: [] };
  let z; try { z = Z.openZip(zipPath, LIMITS); } catch (e) { report.errors.push(e.message); return report; }
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'dexpkg-'));
  try {
    if (!z.has('manifest.json')) { report.errors.push('the package has no manifest.json'); return report; }
    let m; try { m = JSON.parse(z.read('manifest.json').toString('utf8')); } catch (_) { report.errors.push('manifest.json is not valid JSON'); return report; }
    if (!m || typeof m.schema !== 'string' || !/^dexdiffusion\.drama_package\./.test(m.schema)) { report.errors.push('unrecognised package schema'); return report; }
    if (m.schema !== SCHEMA) { report.errors.push(`unsupported package version "${m.schema}" (this build reads ${SCHEMA})`); return report; }
    if (!Array.isArray(m.files) || !z.has('project.json')) { report.errors.push('the package is missing project.json or its file list'); return report; }
    // every listed file must exist and match its checksum; unlisted extras are refused
    const listed = new Set(['manifest.json', ...m.files.map(f => f.path)]);
    for (const e of z.entries) if (!e.dir && !listed.has(e.name)) report.errors.push(`unlisted file in package: ${e.name}`);
    for (const f of m.files) {
      if (!z.has(f.path)) { report.errors.push(`listed file is missing: ${f.path}`); continue; }
      const e = z.entries.find(x => x.name === f.path); if (e.usize !== f.bytes) report.errors.push(`size mismatch: ${f.path}`);
    }
    let proj; try { proj = JSON.parse(z.read('project.json').toString('utf8')); } catch (_) { report.errors.push('project.json is not valid JSON'); return report; }
    if (!proj || !Array.isArray(proj.scenes) || typeof proj.title !== 'string') report.errors.push('project.json is not a drama project');
    if (report.errors.length) return report;
    // verify checksums (streams large media to disk, never into memory)
    report.media.total = (m.media || []).length;
    const staged = new Map();
    for (const f of m.files) {
      const entry = z.entries.find(x => x.name === f.path);
      let digest;
      if (entry.usize > 16 * 1024 * 1024) { const tmp = path.join(tmpDir, crypto.randomBytes(6).toString('hex')); await z.extractTo(f.path, tmp); digest = await Z.sha256File(tmp); staged.set(f.path, tmp); }
      else { const buf = z.read(f.path); digest = sha(buf); if (/^media\//.test(f.path) || /^voices\//.test(f.path)) { const tmp = path.join(tmpDir, crypto.randomBytes(6).toString('hex')); fs.writeFileSync(tmp, buf); staged.set(f.path, tmp); } }
      if (digest !== f.sha256) report.errors.push(`checksum mismatch: ${f.path}`);
    }
    for (const mm of m.media || []) if (mm.path !== 'media/' + mm.artifact_id || !/^[A-Za-z0-9][A-Za-z0-9_-]{0,160}\.(wav|mp3|m4a|m4b|flac)$/.test(String(mm.artifact_id || ''))) report.errors.push(`unsafe media reference: ${String(mm.path).slice(0, 60)}`);
    if (report.errors.length) return report;
    report.project = { title: proj.title, scenes: proj.scenes.length, lines: proj.scenes.reduce((n, s) => n + (s.lines || []).length, 0), text_included: !!(m.project && m.project.text_included), source_rev: proj.source_rev || 1 };
    if (!report.project.text_included) report.warnings.push('the screenplay text was not included: the project arrives as a timeline/mix shell and cannot be produced until the script is added');
    const existing = store.get(proj.id); if (existing) report.collisions.push({ kind: 'project', id: proj.id, action: 'import under a new id' });
    report.ok = true;
    if (!apply) return report;

    // ── apply ──
    const idMap = new Map(); const mediaMap = new Map();
    for (const mm of m.media || []) {
      const f = staged.get(mm.path); if (!f) continue;
      const kind = ['voice', 'music'].includes(mm.kind) ? mm.kind : 'voice'; const ext = path.extname(mm.artifact_id).toLowerCase();
      const src = f + ext; fs.renameSync(f, src);
      try { const rec = mediaStore.finalize(src, { kind, base: path.basename(mm.artifact_id, ext), duration: mm.duration || null, meta: { operation: 'imported', imported_from_package: true, original_artifact_id: mm.artifact_id } }); mediaMap.set(mm.artifact_id, rec); report.media.imported++; }
      catch (e) { report.warnings.push(`media ${mm.artifact_id} was not imported: ${String(e.message).slice(0, 80)}`); }
    }
    // voices (metadata + optional samples) via the profile store; ids that already exist are renamed and actors re-pointed
    const voices = z.has('voices.json') ? JSON.parse(z.read('voices.json').toString('utf8')) : [];
    for (const v of voices) {
      const free = !profiles.get(v.id);
      try {
        const p = profiles.create({ id: free ? v.id : undefined, name: v.name, type: v.type, language: v.language, description: v.description, preset_voice: v.preset_voice || undefined, default_direction: v.default_direction, default_speed: v.default_speed || undefined, design: v.design || undefined, consent: v.consent, origin: { kind: 'imported', original_id: v.id } });
        idMap.set(v.id, p.id);
        for (const s of v.samples || []) { const f = s.file && staged.get(s.file); if (f) await profiles.addSample(p.id, { wav: fs.readFileSync(f), name: s.name, transcript: s.transcript || '' }); }
        report.voices.push({ original_id: v.id, id: p.id, renamed: !free, samples: (v.samples || []).filter(s => s.file).length });
      } catch (e) { report.warnings.push(`voice ${v.name} was not imported: ${String(e.message).slice(0, 80)}`); }
    }
    // rebuild the project: fresh id, remapped references
    const p = D.migrate(proj); p.id = 'dp-' + crypto.randomBytes(4).toString('hex'); p.saved = false; p.title = String(p.title).slice(0, 110) + (existing ? ' (imported)' : ''); p.imported_from = { package: true, original_id: proj.id, at: Date.now() };
    const remap = id => (id && mediaMap.has(id) ? mediaMap.get(id).artifact_id : id);
    for (const sc of p.scenes) for (const l of sc.lines) {
      l.takes = (l.takes || []).filter(t => !t.artifact_id || mediaMap.has(t.artifact_id)).map(t => Object.assign({}, t, { artifact_id: remap(t.artifact_id), imported: true, profile_id: idMap.get(t.profile_id) || t.profile_id }));
      if (l.active_take_id && !l.takes.some(t => t.id === l.active_take_id)) l.active_take_id = null;
      if (l.profile_override && idMap.has(l.profile_override)) l.profile_override = idMap.get(l.profile_override);
    }
    for (const a of p.actors) if (a.voice_profile_id && idMap.has(a.voice_profile_id)) a.voice_profile_id = idMap.get(a.voice_profile_id);
    p.tracks = (p.tracks || []).filter(t => !t.artifact_id || mediaMap.has(t.artifact_id)).map(t => Object.assign({}, t, { artifact_id: remap(t.artifact_id) }));
    for (const mm of Object.values(p.scene_masters || {})) { mm.artifact_id = remap(mm.artifact_id); if (mm.stems) for (const k of Object.keys(mm.stems)) mm.stems[k] = remap(mm.stems[k]); }
    if (p.project_master) { const pm = p.project_master; pm.artifact_id = remap(pm.artifact_id); for (const k of Object.keys(pm.outputs || {})) pm.outputs[k] = remap(pm.outputs[k]); for (const k of Object.keys(pm.stems || {})) pm.stems[k] = remap(pm.stems[k]); }
    store.adopt(p); report.applied = true; report.project.id = p.id;
    return report;
  } finally { z.close(); try { fs.rmSync(tmpDir, { recursive: true, force: true }); } catch (_) {} }
}

module.exports = { exportPackage, importPackage, SCHEMA, LIMITS };
