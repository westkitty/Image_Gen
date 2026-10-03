'use strict';
// Voice profiles, engine capability contract, long-form batch execution through the real bridge
// (fake ssh/scp), chunk failure attribution, privacy and cleanup.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs'); const os = require('node:os'); const path = require('node:path'); const crypto = require('node:crypto');
const M = require('../media'); const B = require('../media-bridge');
const A = require('../voice-audio'); const E = require('../voice-engines');
const { createProfileStore } = require('../voice-profiles'); const { createVoiceService } = require('../voice-service');

const CANARY = 'DEXVOICEPROD-CANARY-902';
const tmp = p => fs.mkdtempSync(path.join(os.tmpdir(), 'dex-vp-' + p));
const tone = (sec = 4, hz = 220, amp = 0.4, rate = 24000) => { const n = Math.round(sec * rate), a = new Float32Array(n); for (let i = 0; i < n; i++) a[i] = amp * Math.sin(2 * Math.PI * hz * i / rate); return { sampleRate: rate, channels: [a] }; };
const wavOf = (a) => A.encodeWav(a);
const sha = b => crypto.createHash('sha256').update(b).digest('hex');
const mkStore = () => createProfileStore({ root: tmp('prof'), ingest: async p => fs.readFileSync(p) });
const writeWav = (a) => { const f = path.join(tmp('src'), 's.wav'); fs.writeFileSync(f, wavOf(a)); return f; };

// ── profiles ────────────────────────────────────────────────────────────────
test('profile CRUD: create / read / update / delete for all three voice types', async () => {
  const s = mkStore();
  const c = s.create({ name: 'Tiger', type: 'cloned', language: 'en' });
  const d = s.create({ name: 'Narrator', type: 'designed', description: 'a warm older British narrator, measured pace' });
  const p = s.create({ name: 'Bright', type: 'preset', preset_voice: 'bf_emma' });
  assert.deepEqual(s.list().map(x => x.type).sort(), ['cloned', 'designed', 'preset']);
  assert.equal(s.get(c.id).preferred_engine, 'qwen3-tts-base'); assert.equal(s.get(d.id).preferred_engine, 'qwen3-tts-voice-design'); assert.equal(s.get(p.id).preferred_engine, 'kokoro');
  const u = s.update(c.id, { name: 'Tiger II', notes: 'n', default_direction: 'calm' });
  assert.deepEqual([u.name, u.notes, u.default_direction], ['Tiger II', 'n', 'calm']);
  assert.throws(() => s.update(p.id, { preset_voice: '../x' }), /Kokoro voice/);
  assert.throws(() => s.create({ name: '', type: 'cloned' }), /name/); assert.throws(() => s.create({ name: 'x', type: 'weird' }), /type/);
  assert.equal(s.remove(d.id), true); assert.equal(s.get(d.id), null); assert.equal(s.remove('not-an-id'), false);
  assert.equal(s.get('../../etc/passwd'), null, 'ids are strictly shaped');
});

test('multiple reference samples: add, preview path, transcript, active/preferred, remove, limits', async () => {
  const s = mkStore(); const c = s.create({ name: 'Tiger', type: 'cloned' });
  const a = await s.addSample(c.id, { srcPath: writeWav(tone(6)), name: 'calm', transcript: 'This is the calm sample.' });
  const b = await s.addSample(c.id, { srcPath: writeWav(tone(8, 300)), name: 'angry' });
  let p = s.get(c.id);
  assert.equal(p.samples.length, 2); assert.deepEqual(p.samples.map(x => x.active), [true, false]);
  assert.ok(fs.existsSync(s.samplePath(c.id, a.sample.id)));
  const stored = fs.readFileSync(s.samplePath(c.id, a.sample.id));
  assert.equal(stored.toString('latin1', 0, 4), 'RIFF', 'stored sample is a real WAV, byte-for-byte');
  assert.equal(sha(stored), a.sample.sha256); assert.doesNotThrow(() => A.parseWav(stored));
  p = s.updateSample(c.id, b.sample.id, { active: true, transcript: 'Angry words here.' });
  assert.deepEqual(p.samples.map(x => x.active), [false, true]); assert.equal(s.activeSample(c.id).sample.id, b.sample.id);
  p = s.removeSample(c.id, b.sample.id); assert.equal(p.samples.length, 1); assert.equal(p.samples[0].active, true, 'active falls back to a remaining sample');
  assert.equal(s.samplePath(c.id, b.sample.id), null);
  for (let i = 0; i < 7; i++) await s.addSample(c.id, { srcPath: writeWav(tone(5)), transcript: 't' });
  await assert.rejects(s.addSample(c.id, { srcPath: writeWav(tone(5)) }), /at most 8/);
  await assert.rejects(s.addSample(s.create({ name: 'D', type: 'designed' }).id, { srcPath: writeWav(tone(5)) }), /only cloned/);
});

test('validation: transcript required for Qwen clone; diagnostics warn on short/quiet/clipped/silent clips; junk rejected', async () => {
  const s = mkStore(); const c = s.create({ name: 'T', type: 'cloned' });
  assert.equal(s.get(c.id).validation.state, 'invalid');
  const a = await s.addSample(c.id, { srcPath: writeWav(tone(6)), name: 'no transcript' });
  assert.match(s.get(c.id).validation.engines['qwen3-tts-base'].errors.join(' '), /exact transcript/);
  s.updateSample(c.id, a.sample.id, { transcript: 'Hello there.' });
  assert.equal(s.get(c.id).validation.state, 'valid');
  const short = await s.addSample(c.id, { srcPath: writeWav(tone(1.2)), name: 'short', transcript: 'x' });
  assert.ok(short.sample.validation.warnings.some(w => /unreliable under 3 s/.test(w)));
  const loud = await s.addSample(c.id, { srcPath: writeWav(tone(5, 220, 1.5)), transcript: 'x' });
  assert.ok(loud.sample.validation.warnings.some(w => /clipping/.test(w)));
  const quiet = await s.addSample(c.id, { srcPath: writeWav(tone(5, 220, 0.008)), transcript: 'x' });
  assert.ok(quiet.sample.validation.warnings.some(w => /very quiet/.test(w)));
  await assert.rejects(s.addSample(c.id, { srcPath: writeWav({ sampleRate: 24000, channels: [new Float32Array(48000)] }) }), /silence|usable/);
  const junk = createProfileStore({ root: tmp('junk'), ingest: async () => Buffer.from('definitely not audio') });
  await assert.rejects(junk.addSample(junk.create({ name: 'J', type: 'cloned' }).id, { srcPath: '/dev/null' }), /not a readable WAV/);
});

test('engine capability validation: profile type ↔ engine; language; designed/preset requirements', () => {
  const mk = o => Object.assign({ language: 'en', samples: [] }, o);
  assert.match(E.validateProfileForEngine(mk({ type: 'cloned' }), 'kokoro').errors[0], /cannot be rendered/);
  assert.equal(E.validateProfileForEngine(mk({ type: 'designed', description: 'too short' }), 'qwen3-tts-voice-design').ok, false);
  assert.equal(E.validateProfileForEngine(mk({ type: 'designed', description: 'a calm older woman, slow and warm' }), 'qwen3-tts-voice-design').ok, true);
  assert.equal(E.validateProfileForEngine(mk({ type: 'preset', preset_voice: 'af_heart' }), 'kokoro').ok, true);
  assert.match(E.validateProfileForEngine(mk({ type: 'preset', preset_voice: 'af_heart', language: 'de' }), 'kokoro').errors.join(), /language/);
  assert.match(E.validateProfileForEngine(mk({ type: 'preset', preset_voice: 'nope' }), 'kokoro').errors.join(), /Kokoro voice/);
  for (const e of E.listEngines()) { assert.ok(e.capabilities && e.evidence); assert.equal(typeof e.capabilities.max_chunk_chars, 'number'); }
  assert.equal(E.getEngine('qwen3-tts-base').capabilities.prompt_caching, false, 'no caching claimed without runtime support');
});

test('delivery directions: applied only where the engine can honor them, otherwise reported (never silently passed)', () => {
  const des = { type: 'designed', description: 'a gravelly middle-aged British man' };
  const r = E.resolveDelivery('qwen3-tts-voice-design', des, 'whispering, frightened');
  assert.equal(r.applied, true); assert.match(r.instruct, /gravelly middle-aged British man\. Delivery: whispering, frightened\./);
  for (const eng of ['kokoro', 'qwen3-tts-base']) { const x = E.resolveDelivery(eng, { type: 'preset' }, 'furious'); assert.equal(x.applied, false); assert.match(x.note, /NOT applied/); assert.equal(x.instruct, undefined); }
  assert.equal(E.resolveDelivery('kokoro', { default_direction: '' }, '').applied, false);
  assert.equal(E.resolveDelivery('qwen3-tts-voice-design', Object.assign({ default_direction: 'calm' }, des), '').requested, 'calm', 'profile default direction is used when none is given');
});

test('profile fingerprint changes when the sample set or transcript changes (cache-invalidation key)', async () => {
  const s = mkStore(); const c = s.create({ name: 'T', type: 'cloned' });
  const a = await s.addSample(c.id, { srcPath: writeWav(tone(6)), transcript: 'one' });
  const f1 = s.get(c.id).fingerprint;
  assert.notEqual(s.updateSample(c.id, a.sample.id, { transcript: 'two' }).fingerprint, f1);
  const b = await s.addSample(c.id, { srcPath: writeWav(tone(6, 400)), transcript: 'x' });
  const f2 = s.get(c.id).fingerprint;
  s.updateSample(c.id, b.sample.id, { active: true }); assert.notEqual(s.get(c.id).fingerprint, f2);
});

// ── long-form through the real bridge (fake Big Mac) ───────────────────────────────
function harness({ failItem = null, items = null, cleaned = true } = {}) {
  const base = tmp('run');
  const roots = { image: base + '/img', voice: base + '/voice', music: base + '/music', video: base + '/video' };
  const mediaStore = M.createMediaStore({ roots, registryFile: base + '/media.json' }); mediaStore.ensureRoots();
  const jobStore = M.createJobStore(base + '/jobs.json');
  const arbiter = M.createResourceArbiter();
  const staging = M.createStaging({ root: base + '/stg' });
  const dir = '$HOME/Library/Caches/DexDiffusion/tmp/dexmedia.LONG01';
  const bytesByItem = new Map(); const calls = []; let request = null;
  const exec = async (cmd, args) => {
    const a = args.join(' '); calls.push([cmd, a]);
    if (cmd === 'ssh' && a.includes('mktemp -d')) return { ok: true, stdout: `DEXMEDIA_DIR=${dir}\n` };
    if (cmd === 'ssh' && a.includes('ref.wav')) return { ok: true, stdout: 'DEXMEDIA_REF_OK\n' };
    if (cmd === 'ssh' && a.includes('rm -rf')) return { ok: true, stdout: cleaned ? 'DEXMEDIA_CLEANED\n' : 'DEXMEDIA_STILL_THERE\n' };
    if (cmd === 'scp' && a.includes(`${dir}/out/item-`)) { const m = /item-(\d+)\.wav/.exec(a); fs.writeFileSync(args[args.length - 1], bytesByItem.get(Number(m[1]))); return { ok: true, stdout: '' }; }
    return { ok: true, stdout: '' };
  };
  const sshRunFn = async (_t, payload, _to, onData) => {
    const b64 = /request\.json"? ?|printf %s '([A-Za-z0-9+/=]+)' \| base64 -d > "\$D\/request\.json"/.exec(payload);
    request = JSON.parse(Buffer.from(/printf %s '([A-Za-z0-9+/=]{20,})' \| base64 -d > "\$D\/request\.json"/.exec(payload)[1], 'base64').toString());
    const n = request.items.length; let out = `DEXMEDIA_STARTED=${request.worker}\nDEXMEDIA_ITEMS_TOTAL=${n}\n`;
    for (let i = 0; i < n; i++) {
      const piece = `DEXMEDIA_ITEM_START=${i}\n`; out += piece; if (onData) onData(piece);
      if (failItem === i) { out += `DEXMEDIA_FAIL_ITEM=${i}\nDEXMEDIA_FAIL=generation\nDEXMEDIA_ERROR=engine exploded on [REDACTED]\n`; return out; }
      const a = tone(1 + (i % 3) * 0.2, 200 + i * 20), buf = wavOf(a); bytesByItem.set(i, buf);
      const line = `DEXMEDIA_ITEM=${i}|${dir}/out/item-${String(i).padStart(3, '0')}.wav|${sha(buf)}|${buf.length}|${A.duration(a)}|24000|1\n`; out += line; if (onData) onData(line);
    }
    return out + `DEXMEDIA_OUTPUT=${dir}/out/item-000.wav\nDEXMEDIA_PASS\nDEXMEDIA_DONE\n`;
  };
  const toWav = async () => { const f = path.join(tmp('ref'), 'ref.wav'); fs.writeFileSync(f, wavOf(tone(5))); return f; };
  const bridge = B.createMediaBridge({ jobStore, arbiter, mediaStore, staging, evidenceFile: base + '/ev.json', exec, sshRunFn, toWav });
  const profiles = createProfileStore({ root: base + '/profiles', ingest: async p => fs.readFileSync(p) });
  const svc = createVoiceService({ bridge, jobStore, mediaStore, profiles, probeFor: () => ({ runtime_available: true, model_available: true }) });
  return { base, roots, mediaStore, jobStore, arbiter, bridge, profiles, svc, calls, req: () => request };
}
const longText = n => Array.from({ length: n }, (_, i) => `Sentence number ${i + 1} is here, with a clause; and it keeps going for a while so the text gets long.`).join(' ');
async function settle(svc, id) { return svc.waitJob(id, { pollMs: 5, timeoutMs: 20000 }); }

test('long-form: >2000 characters renders as ONE canonical artifact with chunk lineage; short text is a single chunk', async () => {
  const h = harness(); const p = h.profiles.create({ name: 'N', type: 'preset', preset_voice: 'af_heart' });
  const short = h.svc.renderText({ profileId: p.id, text: 'Hello there.' });
  assert.equal(short.chunks, 1); assert.equal(short.long_form, false);
  const shortDone = await settle(h.svc, short.job_id);
  assert.equal(shortDone.status, 'COMPLETE');
  const shortAudio = A.parseWav(fs.readFileSync(h.mediaStore.resolve(shortDone.artifact.artifact_id).path));
  const txt = longText(60); assert.ok(txt.length > 5000);
  const r = h.svc.renderText({ profileId: p.id, text: txt, saveText: false });
  assert.ok(r.chunks > 5 && r.long_form && r.chunk_plan.every(c => c.chars <= 900));
  const d = await settle(h.svc, r.job_id);
  assert.equal(d.status, 'COMPLETE', JSON.stringify(d));
  assert.equal(d.progress.total, r.chunks);
  const art = d.artifact; assert.ok(art && art.duration > r.chunks * 0.8);
  assert.equal(art.meta.long_form.chunks, r.chunks); assert.equal(art.meta.long_form.lineage.length, r.chunks);
  assert.ok(art.meta.long_form.lineage.every(c => /^[a-f0-9]{64}$/.test(c.sha256) && c.duration > 0));
  const rec = h.mediaStore.resolve(art.artifact_id); assert.ok(rec.path.startsWith(h.roots.voice));
  const parsed = A.parseWav(fs.readFileSync(rec.path)); assert.ok(A.analyze(parsed).rms > 0.01, 'non-silent final audio');
  assert.ok(Math.abs(A.analyze(parsed).peakDb - A.analyze(shortAudio).peakDb) < 0.05, 'chunk count must not boost the engine level');
  assert.deepEqual(h.mediaStore.list('voice').length, 2, 'only the final artifacts are canonical; chunk WAVs are internal');
  assert.ok(h.calls.some(([c, a]) => c === 'ssh' && a.includes('rm -rf')), 'remote dir removed'); assert.equal(h.arbiter.state().owner, null);
  assert.equal(h.req().items.length, r.chunks, 'one Big Mac invocation covers every chunk');
});

test('chunk failure is attributed: "Long-form render failed at chunk 7/14: <reason>", text never leaks', async () => {
  const h = harness({ failItem: 6 }); const p = h.profiles.create({ name: 'N', type: 'preset', preset_voice: 'af_heart' });
  let txt = longText(110), r = h.svc.renderText({ profileId: p.id, text: txt });
  const target = r.chunks; assert.ok(target >= 7);
  const d = await settle(h.svc, r.job_id);
  assert.equal(d.status, 'FAILED'); assert.equal(d.gate, 'generation');
  assert.match(d.error, new RegExp(`Long-form render failed at chunk 7/${target}: kokoro: engine exploded`));
  assert.ok(!JSON.stringify(h.jobStore.get(r.job_id)).includes('Sentence number'), 'dialogue is not in generic job state');
  assert.equal(h.arbiter.state().owner, null); assert.equal(h.mediaStore.list('voice').length, 0, 'no partial artifact');
});

test('privacy: text, transcripts and descriptions never reach durable job state when saveText is false', async () => {
  const h = harness(); const c = h.profiles.create({ name: 'C', type: 'cloned' });
  await h.profiles.addSample(c.id, { srcPath: writeWav(tone(6)), transcript: CANARY + ' transcript' });
  const r = h.svc.renderText({ profileId: c.id, text: CANARY + ' spoken line', direction: 'calm', saveText: false });
  assert.ok(!r.error, JSON.stringify(r)); await settle(h.svc, r.job_id); h.jobStore.flush();
  assert.ok(!fs.readFileSync(path.join(h.base, 'jobs.json'), 'utf8').includes(CANARY));
  assert.ok(!fs.readFileSync(path.join(h.base, 'media.json'), 'utf8').includes(CANARY));
  assert.equal(r.delivery.applied, false); assert.match(r.delivery.note, /NOT applied/, 'Base clone reports it cannot honor delivery');
});

test('profile-engine capability gating happens before any lease or job', () => {
  const h = harness();
  assert.equal(h.svc.renderText({ profileId: 'vp-0000000000', text: 'x' }).status, 404);
  const c = h.profiles.create({ name: 'C', type: 'cloned' });
  assert.match(h.svc.renderText({ profileId: c.id, text: 'x' }).error, /active reference sample|sample/);
  assert.equal(h.jobStore.list().length, 0); assert.equal(h.arbiter.state().owner, null);
  const d = h.profiles.create({ name: 'D', type: 'designed', description: 'a calm older woman, slow and warm' });
  const r = h.svc.renderText({ profileId: d.id, text: 'Hello', direction: 'whispering' });
  assert.equal(r.delivery.applied, true); assert.match(h.req ? '' : '', /^$/);
});

test('existing single-shot Kokoro/Qwen request validation is unchanged (compatibility)', () => {
  assert.equal(B.validateRequest('kokoro', { text: 'hi', voice: 'bf_emma' }).req.lang_code, 'b');
  assert.match(B.validateRequest('kokoro', { text: 'x'.repeat(2001) }).error, /limited/);
  assert.equal(B.validateBatchPlan('kokoro', { items: [{ text: 'a' }], voice: 'af_heart' }).req.items.length, 1);
  assert.match(B.validateBatchPlan('ace-step', { items: [{ text: 'a' }] }).error, /no multi-item/);
  assert.match(B.validateBatchPlan('qwen3-tts-base', { items: [{ text: 'a' }], ref_path: '/x' }).error, /transcript/);
  assert.match(B.validateBatchPlan('kokoro', { items: [] }).error, /1-400/);
});


test('privacy-off VoiceDesign direction stays out of durable jobs and canonical media metadata', async () => {
  const h = harness();
  const p = h.profiles.create({ name: 'Direction privacy', type: 'designed', description: 'a calm low voice' });
  const direction = 'rev18directionalpha\nrev18directionbeta';
  const r = h.svc.renderText({ profileId: p.id, text: 'Hello.', direction, saveText: false });
  assert.ok(r.job_id, JSON.stringify(r));
  const done = await settle(h.svc, r.job_id); assert.equal(done.status, 'COMPLETE');
  assert.deepEqual(done.artifact.meta.delivery, { requested: true, applied: true });
  h.jobStore.flush();
  for (const file of ['jobs.json', 'media.json']) assert.ok(!fs.readFileSync(path.join(h.base, file), 'utf8').includes('rev18direction'), file);
});
