'use strict';

const assert = require('node:assert/strict');
const zlib = require('node:zlib');
const test = require('node:test');
const I = require('../public/dexdiffusion/infotext.js');
const P = require('../png-text.js');

const A1111 = `a red fox, snow\nsecond line
Negative prompt: blurry, lowres
Steps: 20, Sampler: DPM++ 2M Karras, CFG scale: 7, Seed: 12345, Size: 512x768, Model hash: 6ce0161689, Model: v1-5-pruned-emaonly, Clip skip: 2, Variation seed: 5, Version: v1.6.0`;

test('parseInfotext: multi-line prompt, negative, key/value line, quoted values', () => {
  const r = I.parseInfotext(A1111);
  assert.equal(r.prompt, 'a red fox, snow\nsecond line');
  assert.equal(r.negative, 'blurry, lowres');
  assert.deepEqual(r.params.slice(0, 4), [['Steps', '20'], ['Sampler', 'DPM++ 2M Karras'], ['CFG scale', '7'], ['Seed', '12345']]);
  const q = I.parseInfotext('x\nSteps: 5, Model: "a, b", Seed: 1');
  assert.deepEqual(q.params.find(p => p[0] === 'Model'), ['Model', 'a, b']);
  const none = I.parseInfotext('just a prompt\nwith two lines');
  assert.equal(none.params.length, 0); assert.equal(none.prompt, 'just a prompt\nwith two lines');
});

test('toCreateSettings: restorable, unavailable and unverified fields are all kept with reasons', () => {
  const r = I.toCreateSettings(I.parseInfotext(A1111), { targets: [{ id: 'sd15', label: 'SD1.5 standard', filename: 'v1-5-pruned-emaonly.safetensors' }] });
  assert.deepEqual(r.settings, { prompt: 'a red fox, snow\nsecond line', negPrompt: 'blurry, lowres', steps: 20, sampler: 'dpmpp2m', scheduler: 'karras', cfg: 7, seed: 12345, width: 512, height: 768, target: 'sd15', clipSkip: 2 });
  const by = k => r.fields.find(f => f.key === k);
  assert.equal(by('Model').state, 'restorable'); assert.match(by('Model').note, /SD1\.5/);
  assert.equal(by('Model hash').state, 'unverified'); assert.match(by('Model hash').reason, /not recomputed/);
  assert.equal(by('Variation seed').state, 'unavailable'); assert.match(by('Variation seed').reason, /sd-cli/);
  assert.equal(by('Version').state, 'unverified');
  assert.equal(r.warnings.length, 0);
});

test('unsupported samplers and unknown models are reported, never mapped silently', () => {
  const r = I.toCreateSettings(I.parseInfotext('p\nSteps: 20, Sampler: UniPC, CFG scale: 7, Seed: 1, Size: 512x512, Model: someOtherCheckpoint'), { targets: [{ id: 'sd15', label: 'x' }] });
  assert.equal(r.settings.sampler, undefined);
  assert.match(r.fields.find(f => f.key === 'Sampler').reason, /does not provide/);
  assert.equal(r.settings.target, undefined); assert.match(r.warnings[0], /not an installed target/);
});

test('hires fields restore together and denoise is the hires denoise', () => {
  const r = I.toCreateSettings(I.parseInfotext('p\nSteps: 20, Sampler: Euler a, Denoising strength: 0.5, Hires upscale: 2, Hires steps: 10, Hires upscaler: Latent, Seed: 1'), {});
  assert.deepEqual(r.settings.hires, { scale: 2, steps: 10, upscaler: 'Latent', denoise: 0.5 });
  assert.equal(r.fields.find(f => f.key === 'Denoising strength').state, 'restorable');
  const noHires = I.toCreateSettings(I.parseInfotext('p\nSteps: 20, Sampler: Euler a, Denoising strength: 0.5, Seed: 1'), {});
  assert.equal(noHires.fields.find(f => f.key === 'Denoising strength').state, 'unavailable');
});

test('formatInfotext round-trips through parse for the fields the console records', () => {
  const meta = { steps: 24, sampler: 'dpmpp2m', scheduler: 'karras', cfg: 6.5, seed: 99, width: 640, height: 384, clip_skip: 2, eta: 0.3, hires: { scale: 1.5, steps: 8, denoise: 0.45, upscaler: 'Latent' } };
  const text = I.formatInfotext(meta, { prompt: 'a cat, fluffy', negative: 'bad', modelName: 'sd15' });
  const r = I.toCreateSettings(I.parseInfotext(text), { targets: [{ id: 'sd15', label: 'SD1.5' }] });
  assert.deepEqual(r.settings, { prompt: 'a cat, fluffy', negPrompt: 'bad', steps: 24, sampler: 'dpmpp2m', scheduler: 'karras', cfg: 6.5, seed: 99, width: 640, height: 384, target: 'sd15', clipSkip: 2, eta: 0.3, hires: { denoise: 0.45, scale: 1.5, steps: 8, upscaler: 'Latent' } });
  assert.doesNotMatch(I.formatInfotext(meta, {}), /Negative prompt|a cat/, 'no prompt unless given');
});

// ── PNG text chunks ──
function png(extraChunks) {
  const c = (type, data) => { const len = Buffer.alloc(4); len.writeUInt32BE(data.length); const t = Buffer.from(type, 'latin1'); const crc = Buffer.alloc(4); crc.writeUInt32BE(P.crc32(Buffer.concat([t, data]))); return Buffer.concat([len, t, data, crc]); };
  const ihdr = Buffer.alloc(13); ihdr.writeUInt32BE(1, 0); ihdr.writeUInt32BE(1, 4); ihdr[8] = 8; ihdr[9] = 2;
  const idat = zlib.deflateSync(Buffer.from([0, 255, 0, 0]));
  return Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), c('IHDR', ihdr), ...(extraChunks || []).map(([t, d]) => c(t, d)), c('IDAT', idat), c('IEND', Buffer.alloc(0))]);
}
test('readTextChunks reads tEXt, zTXt and iTXt (compressed and not)', () => {
  const kz = Buffer.concat([Buffer.from('zk\0\0'), zlib.deflateSync(Buffer.from('zipped text'))]);
  const it = Buffer.concat([Buffer.from('ik\0\0\0\0\0'), Buffer.from('héllo ☃')]);
  const ic = Buffer.concat([Buffer.from('ic\0\x01\0\0\0'), zlib.deflateSync(Buffer.from('compressed utf8 ✓'))]);
  const buf = png([['tEXt', Buffer.from('parameters\0hello\nSteps: 1')], ['zTXt', kz], ['iTXt', it], ['iTXt', ic]]);
  const out = P.readTextChunks(buf);
  assert.deepEqual(out.map(o => [o.key, o.text]), [['parameters', 'hello\nSteps: 1'], ['zk', 'zipped text'], ['ik', 'héllo ☃'], ['ic', 'compressed utf8 ✓']]);
});
test('withTextChunk inserts before IDAT, replaces a same-key chunk, keeps pixels and CRCs valid', () => {
  const base = png([['tEXt', Buffer.from('parameters\0old')]]);
  const out = P.withTextChunk(base, 'parameters', 'new text — ✓');
  assert.deepEqual(P.readTextChunks(out).map(o => [o.key, o.text]), [['parameters', 'new text — ✓']]);
  assert.ok(out.length > base.length - 20);
  const idat = c => c.toString('latin1').indexOf('IDAT');
  assert.ok(out.toString('latin1').indexOf('iTXt') < idat(out), 'text chunk precedes IDAT');
  assert.ok(out.includes(Buffer.from(zlib.deflateSync(Buffer.from([0, 255, 0, 0])))), 'image data untouched');
  assert.throws(() => P.withTextChunk(base, 'bad\nkey', 'x'), /keyword/);
});
test('hostile input: not a PNG, truncated, zip bomb', () => {
  assert.throws(() => P.readTextChunks(Buffer.from('GIF89a')), /Not a PNG/);
  assert.throws(() => P.readTextChunks(png().subarray(0, 40)), /truncated/);
  const bomb = Buffer.concat([Buffer.from('b\0\0'), zlib.deflateSync(Buffer.alloc(8 * 1024 * 1024))]);
  const r = P.readTextChunks(png([['zTXt', bomb]]));
  assert.equal(r[0].truncated, true, 'oversized decompression is refused, not allocated');
});
