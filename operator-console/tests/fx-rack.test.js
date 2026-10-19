'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs'); const os = require('node:os'); const path = require('node:path');
const A = require('../voice-audio'); const T = require('../audio-tools'); const FX = require('../fx-rack');

const HAVE = T.available(); const opts = { skip: HAVE.ffmpeg ? false : 'ffmpeg not installed' };
const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), 'dex-fx-'));
const tone = (sec, hz, amp = 0.3, rate = 24000) => { const n = Math.round(sec * rate), a = new Float32Array(n); for (let i = 0; i < n; i++) a[i] = amp * Math.sin(2 * Math.PI * hz * i / rate); return { sampleRate: rate, channels: [a] }; };
const wav = a => { const f = path.join(tmp(), 's.wav'); fs.writeFileSync(f, A.encodeWav(a)); return f; };
const rmsOfF32 = file => { const b = fs.readFileSync(file), f = new Float32Array(b.buffer, b.byteOffset, b.length / 4); let s = 0; for (let i = 0; i < f.length; i++) s += f[i] * f[i]; return Math.sqrt(s / f.length); };

test('the preset catalogue covers the required voices and each is a valid versioned chain', () => {
  const ids = FX.listPresets().map(p => p.id);
  for (const id of ['none', 'radio', 'intercom', 'broadcast', 'synthetic', 'echo_chamber', 'resonant', 'custom']) assert.ok(ids.includes(id), id);
  for (const p of FX.listPresets()) { const v = FX.validate(FX.presetChain(p.id)); assert.equal(v.ok, true, p.id + ': ' + v.errors.join()); assert.equal(v.chain.version, FX.CHAIN_VERSION); }
});

test('clean / bypassed chains compile to nothing and share one identity', () => {
  assert.equal(FX.compile(FX.presetChain('none')).filter, ''); assert.equal(FX.compile(null).filter, '');
  const radio = FX.presetChain('radio'); const bypassed = Object.assign({}, radio, { bypass: true });
  assert.equal(FX.compile(bypassed).filter, ''); assert.equal(FX.identity(bypassed), FX.identity(null)); assert.equal(FX.identity(FX.presetChain('none')), 'clean');
  assert.notEqual(FX.identity(radio), 'clean');
});

test('identity ignores ids, labels and disabled nodes but reacts to real parameter changes', () => {
  const a = FX.presetChain('radio'); const b = JSON.parse(JSON.stringify(a));
  b.nodes.forEach((n, i) => { n.id = 'x' + i; n.label = 'renamed'; }); b.nodes.push({ id: 'z', type: 'gain', enabled: false, params: { db: 12 } });
  assert.equal(FX.identity(a), FX.identity(b));
  b.nodes.find(n => n.type === 'highpass').params.freq = 500; assert.notEqual(FX.identity(a), FX.identity(b));
});

test('validation clamps ranges, rejects unknown filters and over-long chains', () => {
  const v = FX.validate({ nodes: [{ type: 'gain', params: { db: 999 } }, { type: 'highpass', params: { freq: -5 } }] });
  assert.equal(v.ok, true); assert.equal(v.chain.nodes[0].params.db, 24); assert.equal(v.chain.nodes[1].params.freq, 20); assert.ok(v.warnings.length >= 2);
  assert.equal(FX.validate({ nodes: [{ type: 'rm -rf', params: {} }] }).ok, false);
  assert.equal(FX.validate({ nodes: Array.from({ length: 13 }, () => ({ type: 'gain', params: { db: 1 } })) }).ok, false);
  assert.equal(FX.validate({ nodes: [{ type: 'delay', params: { delay_ms: '100;rm', feedback: 0.3, mix: 0.4 } }] }).chain.nodes[0].params.delay_ms, 100, 'params are coerced to numbers, never interpolated as text');
});

test('formant pitch compiles to an ordered Rubber Band processor stage', () => {
  const c = FX.compile({ version: 1, preset: 'custom', nodes: [
    { type: 'highpass', params: { freq: 120 } },
    { type: 'pitch_formant', params: { semitones: 2 } },
    { type: 'gain', params: { db: -1 } },
  ] });
  assert.deepEqual(c.stages.map(s => s.type), ['ffmpeg', 'rubberband-formant-pitch', 'ffmpeg']);
  assert.equal(c.stages[1].semitones, 2);
  assert.equal(c.stages[1].method, 'Rubber Band R3 --formant');
});

test('Rubber Band formant pitch creates a verified, duration-matched derivative', { skip: HAVE.rubberband ? false : 'Rubber Band CLI not installed', timeout: 30000 }, async () => {
  const src = wav(tone(1.25, 220)), original = require('node:crypto').createHash('sha256').update(fs.readFileSync(src)).digest('hex');
  const out = path.join(tmp(), 'formant.wav'), result = await T.formantPitch(src, out, 2);
  const after = require('node:crypto').createHash('sha256').update(fs.readFileSync(src)).digest('hex');
  const info = await T.probe(out), scan = await T.scanWav(out);
  assert.equal(original, after, 'source bytes are unchanged');
  assert.match(result.method, /^Rubber Band 4\.0\.0 R3 --formant/);
  assert.equal(result.formant_preserved, true);
  assert.ok(Math.abs(info.duration - 1.25) <= 0.08, `duration ${info.duration}`);
  assert.equal(scan.silent, false); assert.equal(scan.non_finite, 0);
});

test('compiled filter strings are injection-proof and contain only the expected filter names', () => {
  for (const p of FX.listPresets()) { const f = FX.compile(FX.presetChain(p.id)).filter; assert.ok(!/[;`$\n"']/.test(f.replace(/'/g, '')), p.id + ' ' + f); }
  const f = FX.compile({ nodes: [{ type: 'eq', params: { freq: 1000, width: 200, gain_db: 3 } }] }).filter; assert.match(f, /^equalizer=f=1000:width_type=h:width=200:g=3$/);
});

test('reorder / reset / append operate on copies and keep the chain valid', () => {
  const r = FX.presetChain('radio'); const first = r.nodes[0].type;
  const moved = FX.reorder(r, 0, 2); assert.equal(r.nodes[0].type, first, 'original untouched'); assert.notEqual(moved.nodes[0].type, first); assert.equal(moved.nodes.length, r.nodes.length);
  assert.throws(() => FX.reorder(r, 0, 99), /range/);
  const added = FX.addNode(r, 'delay'); assert.equal(added.nodes.length, r.nodes.length + 1); assert.equal(added.preset, 'custom');
  assert.deepEqual(FX.presetChain('radio'), FX.reset('radio'));
});

test('every preset runs through real FFmpeg and produces audible, finite output', opts, async () => {
  const src = wav(tone(1, 800));
  for (const p of FX.listPresets().filter(x => x.id !== 'custom')) {
    const out = path.join(tmp(), 'o.f32'); const c = FX.compile(FX.presetChain(p.id));
    const r = await T.conformToF32(src, out, { filters: c.filter || null });
    assert.ok(r.frames > 0, p.id); const rms = rmsOfF32(out); assert.ok(Number.isFinite(rms) && rms > 0.005, `${p.id} rms ${rms}`);
  }
});

test('the radio preset really band-limits: a 100 Hz tone is removed, a 1 kHz tone passes', opts, async () => {
  const c = FX.compile(FX.presetChain('radio')); const lo = path.join(tmp(), 'lo.f32'), hi = path.join(tmp(), 'hi.f32'), ref = path.join(tmp(), 'ref.f32');
  await T.conformToF32(wav(tone(1, 100)), lo, { filters: c.filter }); await T.conformToF32(wav(tone(1, 1000)), hi, { filters: c.filter }); await T.conformToF32(wav(tone(1, 1000)), ref);
  assert.ok(rmsOfF32(lo) < rmsOfF32(ref) * 0.2, 'low tone attenuated by > 14 dB: ' + rmsOfF32(lo) / rmsOfF32(ref)); assert.ok(rmsOfF32(hi) > rmsOfF32(ref) * 0.3, 'mid tone survives: ' + rmsOfF32(hi));
});

test('echo / reverb tails are padded so they are not cut off', opts, async () => {
  const c = FX.compile(FX.presetChain('echo_chamber')); assert.ok(c.tail_s > 0.3);
  const out = path.join(tmp(), 'e.f32'); const r = await T.conformToF32(wav(tone(0.5, 600)), out, { filters: c.filter });
  assert.ok(r.frames / 48000 > 0.5 + c.tail_s * 0.9, 'length includes the tail: ' + r.frames / 48000);
});

test('custom presets persist with a version, survive reload, and cannot overwrite built-ins', () => {
  const file = path.join(tmp(), 'fx-presets.json'); const s = FX.createPresetStore({ file });
  const saved = s.save({ name: 'My comms', chain: FX.presetChain('radio') }); assert.match(saved.id, /^cp-[a-f0-9]{8}$/);
  assert.equal(FX.createPresetStore({ file }).list()[0].name, 'My comms');
  assert.throws(() => s.save({ name: 'x', chain: { nodes: [{ type: 'nope' }] } }), /invalid/i);
  assert.throws(() => s.update('radio', { name: 'hack' }), /built-in/i);
  s.remove(saved.id); assert.equal(s.list().length, 0);
  assert.equal(JSON.parse(fs.readFileSync(file, 'utf8')).schema, 'dexdiffusion.fx_presets.v1');
});
