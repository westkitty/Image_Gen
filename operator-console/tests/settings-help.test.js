'use strict';
// The help text may only say what the implementation does. These checks tie each claim to the code that makes it true.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const H = require('../public/dexdiffusion/settings-help.js');
const text = name => H.flat().find(e => e.name === name).text;
const read = f => fs.readFileSync(path.join(__dirname, '..', f), 'utf8');

test('every group has entries and every entry has real text', () => {
  assert.ok(H.GROUPS.length >= 4);
  for (const e of H.flat()) assert.ok(e.name && e.text.length > 40, e.name);
});
test('Source preparation names exactly the implemented modes', () => {
  const { MODES } = require('../public/dexdiffusion/source-resize.js');
  assert.deepEqual([...MODES].sort(), ['crop', 'fill', 'resize']);
  const t = text('Source preparation');
  for (const phrase of ['Just resize', 'Crop and resize', 'Resize and fill']) assert.ok(t.includes(phrase), phrase);
});
test('High-Res Refine is described as pixel space and refused for MFLUX, as hires-2pass.js implements', () => {
  const src = read('hires-2pass.js'), t = text('High-Res Refine');
  assert.match(src, /pixel space/i); assert.match(src, /second pass on MFLUX is refused/);
  assert.match(t, /pixel space/); assert.match(t, /FLUX\.2 Klein/); assert.match(t, /base image stays/);
});
test('Detailer text matches the detector modes and the SD1.5 inpaint dependency', () => {
  const src = read('detailer.js'); assert.match(src, /const MODES = \['face', 'hand', 'person'\]/);
  const t = text('Detailer'); for (const m of ['face', 'person', 'hand']) assert.ok(t.includes(m));
  assert.match(t, /SD1\.5/); assert.match(t, /Apple Vision/); assert.doesNotMatch(t, /\bblur\b.*\bused\b/);
});
test('sampler list claim: only methods the installed sd-cli accepts', () => {
  const { SDCLI_SAMPLER } = require('../controlled-args.js');
  assert.ok(Object.keys(SDCLI_SAMPLER).length >= 10);
  assert.match(text('Sampler'), /installed stable-diffusion\.cpp/);
});
test('Default VAE statement and seed statement are present', () => {
  assert.match(text('VAE'), /Default VAE/); assert.match(text('Seed'), /-1 picks a random seed/);
});
