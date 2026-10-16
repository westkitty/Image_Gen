'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs'); const os = require('node:os'); const path = require('node:path'); const crypto = require('node:crypto');
const D = require('../drama'); const T = require('../audio-tools'); const Z = require('../portable-archive'); const Pkg = require('../drama-package'); const { rig } = require('./helpers/drama-rig'); const rawZip = require('./helpers/rawzip');

const opts = { skip: T.available().ffmpeg ? false : 'ffmpeg not installed' };
const CANARY = 'PKGCANARY-8821';
const SCRIPT = `INT. ROOM\nTIGER: ${CANARY} I warned you.\nCODEC: Understood.`;
const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), 'dex-pk-'));
const sha = b => crypto.createHash('sha256').update(b).digest('hex');

async function produced() { const r = await rig(); const p = await r.project(SCRIPT); const fin = await r.finish(r.producer.produce(p.id, { delivery: { formats: ['mp3'] } })); assert.equal(fin.status, 'complete', JSON.stringify(fin.errors)); return Object.assign(r, { p }); }
const exportTo = async (r, include) => { const f = path.join(tmp(), 'p.zip'); const res = await Pkg.exportPackage({ project: r.p, profiles: r.profiles, mediaStore: r.mediaStore, include, outPath: f }); return Object.assign(res, { file: f }); };
const read = (file, name) => Z.openZip(file).read(name);

test('default export is private: no screenplay, no samples, no take audio, no masters', opts, async () => {
  const r = await produced(); const x = await exportTo(r, {}); const z = Z.openZip(x.file);
  assert.deepEqual(z.entries.map(e => e.name).sort(), ['manifest.json', 'project.json', 'voices.json']);
  const all = z.entries.map(e => z.read(e.name).toString('latin1')).join('\n'); assert.equal(all.includes(CANARY), false); assert.equal(all.includes('I warned you'), false);
  const proj = JSON.parse(z.read('project.json')); assert.equal(proj.source_script, ''); assert.ok(proj.scenes.flatMap(s => s.lines).every(l => l.text === '' && l.takes.length === 0));
  assert.equal(x.manifest.project.text_included, false); assert.equal(x.manifest.include.screenplay, false);
});

test('each selection adds exactly its material, every file with a checksum', opts, async () => {
  const r = await produced();
  const full = await exportTo(r, { screenplay: true, voice_samples: true, takes: true, masters: true, stems: false, timeline: true });
  const z = Z.openZip(full.file); const names = z.entries.map(e => e.name);
  assert.ok(names.includes('screenplay.txt')); assert.match(z.read('screenplay.txt').toString(), new RegExp(CANARY)); assert.ok(names.some(n => n.startsWith('media/')));
  const mf = JSON.parse(z.read('manifest.json')); for (const f of mf.files) { assert.match(f.sha256, /^[a-f0-9]{64}$/); assert.equal(sha(z.read(f.path)), f.sha256); }
  assert.ok(mf.media.length >= 5, 'takes + scene master + project master + mp3');
  const noMasters = await exportTo(r, { takes: true }); assert.ok(Z.openZip(noMasters.file).entries.every(e => !/media\/.*master/.test(e.name)));
});

test('import validates everything, never overwrites, and rebuilds a working project with remapped media', opts, async () => {
  const r = await produced(); const x = await exportTo(r, { screenplay: true, takes: true, masters: true, voice_samples: true });
  const fresh = await rig();
  const dry = await Pkg.importPackage({ zipPath: x.file, drama: fresh.drama, store: fresh.dstore, profiles: fresh.profiles, mediaStore: fresh.mediaStore, apply: false });
  assert.equal(dry.ok, true, JSON.stringify(dry.errors)); assert.equal(dry.applied, false); assert.equal(fresh.dstore.list().length, 0); assert.equal(dry.project.text_included, true);
  const res = await Pkg.importPackage({ zipPath: x.file, drama: fresh.drama, store: fresh.dstore, profiles: fresh.profiles, mediaStore: fresh.mediaStore, apply: true });
  assert.equal(res.applied, true); assert.equal(res.media.imported, res.media.total); const p2 = fresh.dstore.get(res.project.id);
  assert.notEqual(p2.id, r.p.id); assert.equal(p2.source_script, SCRIPT); assert.equal(p2.saved, false); assert.ok(p2.imported_from);
  for (const l of D.renderableLines(p2).map(x => x.line)) for (const t of l.takes) assert.ok(fresh.mediaStore.resolve(t.artifact_id), 'take audio was imported into the canonical store');
  assert.ok(fresh.mediaStore.resolve(p2.project_master.artifact_id)); assert.ok(Object.values(p2.scene_masters).every(m => fresh.mediaStore.resolve(m.artifact_id)));
  const view = fresh.drama.view(p2); assert.equal(view.plan.counts.reuse, 2, 'imported recordings are still current when the voices carried over');
  assert.equal(r.dstore.get(r.p.id).title, r.p.title, 'the source project is untouched');
  const again = await Pkg.importPackage({ zipPath: x.file, drama: r.drama, store: r.dstore, profiles: r.profiles, mediaStore: r.mediaStore, apply: true });
  assert.notEqual(again.project.id, r.p.id); assert.ok(again.collisions.length >= 1); assert.ok(again.voices.every(v => v.renamed), 'colliding voice ids are renamed, not overwritten');
});

test('a text-free package imports as a shell and production is refused until a script exists', opts, async () => {
  const r = await produced(); const x = await exportTo(r, {}); const fresh = await rig();
  const res = await Pkg.importPackage({ zipPath: x.file, drama: fresh.drama, store: fresh.dstore, profiles: fresh.profiles, mediaStore: fresh.mediaStore, apply: true });
  assert.ok(res.warnings.some(w => /screenplay text was not included/.test(w))); const p2 = fresh.dstore.get(res.project.id);
  assert.equal(D.renderableLines(p2).length, 0, 'empty lines are not renderable'); assert.throws(() => fresh.producer.produce(p2.id), e => e.gate === 'production-blocked');
});

test('hostile or damaged packages are rejected with specific reasons and nothing is created', opts, async () => {
  const r = await produced(); const x = await exportTo(r, { takes: true, screenplay: true }); const fresh = await rig();
  const imp = file => Pkg.importPackage({ zipPath: file, drama: fresh.drama, store: fresh.dstore, profiles: fresh.profiles, mediaStore: fresh.mediaStore, apply: true });
  const z = Z.openZip(x.file); const entries = z.entries.map(e => ({ name: e.name, data: z.read(e.name) }));
  const write = es => { const f = path.join(tmp(), 'h.zip'); fs.writeFileSync(f, rawZip(es)); return f; };
  const tampered = entries.map(e => (e.name.startsWith('media/') ? { name: e.name, data: Buffer.concat([e.data.subarray(0, e.data.length - 4), Buffer.from([1, 2, 3, 4])]) } : e));
  assert.match((await imp(write(tampered))).errors.join(), /checksum mismatch/);
  assert.match((await imp(write([...entries, { name: 'extra.txt', data: 'sneaky' }]))).errors.join(), /unlisted file/);
  assert.match((await imp(write(entries.filter(e => !e.name.startsWith('media/')).concat([{ name: '../escape.txt', data: 'x' }])))).errors.join(), /unsafe/i);
  assert.match((await imp(write(entries.filter(e => e.name !== 'project.json')))).errors.join(), /project\.json/);
  const badSchema = entries.map(e => (e.name === 'manifest.json' ? { name: e.name, data: Buffer.from(JSON.stringify({ ...JSON.parse(e.data), schema: 'dexdiffusion.drama_package.v9' })) } : e));
  assert.match((await imp(write(badSchema))).errors.join(), /unsupported package version/);
  assert.match((await imp(write([{ name: 'manifest.json', data: '{broken' }]))).errors.join(), /valid JSON/);
  assert.equal(fresh.dstore.list().length, 0);
});
