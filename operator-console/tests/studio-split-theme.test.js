'use strict';
// Pure parts of the canvas/settings divider (studio-split.js) and the color scheme editor (studio-theme.js).
const test = require('node:test');
const assert = require('node:assert/strict');
const Split = require('../public/dexdiffusion/studio-split.js');
const Theme = require('../public/dexdiffusion/studio-theme.js');

const box = { left: 0, right: 1400, width: 1400 };

test('divider: dragging resizes the settings within the minimum canvas and settings widths', () => {
  assert.deepEqual(Split.dragResult(1000, box, 'right', 0), { width: 400, swap: false });
  assert.deepEqual(Split.dragResult(1350, box, 'right', 0), { width: Split.MIN_SETTINGS, swap: false });
  assert.deepEqual(Split.dragResult(100, box, 'right', 0), { width: 1400 - Split.MIN_CANVAS, swap: false });
  assert.deepEqual(Split.dragResult(400, box, 'left', 14), { width: 393, swap: false });
});

test('divider: dragging all the way to the far edge asks for a swap', () => {
  assert.equal(Split.dragResult(box.left + 10, box, 'right', 0).swap, true);
  assert.equal(Split.dragResult(box.right - 10, box, 'left', 0).swap, true);
  assert.equal(Split.dragResult(box.right - 10, box, 'right', 0).swap, false, 'the near edge only shrinks the settings');
});

test('divider: layout CSS puts the settings on the chosen side at the chosen width', () => {
  assert.equal(Split.cssFor({}), '');
  const css = Split.cssFor({ create: { width: 500 } });
  assert.match(css, /\[data-studio-create\]\{grid-template-columns:minmax\(0,1fr\) min\(500px, calc\(100% - 240px\)\)!important\}/);
  assert.doesNotMatch(css, /order:/);
  const swapped = Split.cssFor({ create: { width: 500, swapped: true }, edit: { swapped: true } });
  assert.match(swapped, /\[data-studio-create\]\{grid-template-columns:min\(500px, calc\(100% - 240px\)\) minmax\(0,1fr\)!important\}/);
  assert.match(swapped, /\[data-studio-create\]>:nth-child\(2\)\{order:1\}/);
  assert.match(swapped, /\.dex-ed-studio\{grid-template-columns:minmax\(300px,1fr\) minmax\(0,1\.5fr\)!important\}/);
  assert.match(swapped, /@media \(min-width:1101px\)/, 'narrow windows keep the stacked layout');
});

test('theme: colour conversions round-trip', () => {
  for (const hex of ['#100f18', '#f59e0b', '#38bdf8', '#ffffff', '#000000']) {
    const rgb = Theme.parseHex(hex);
    assert.equal(Theme.toHex(Theme.hslToRgb(Theme.rgbToHsl(rgb))), hex);
    assert.equal(Theme.toHex(Theme.hsvToRgb(Theme.rgbToHsv(rgb))), hex);
  }
  assert.deepEqual(Theme.parseHex('#abc'), [170, 187, 204]);
  assert.equal(Theme.parseHex('blue'), null);
});

test('theme: changing a theme colour moves its shades and leaves other colours alone', () => {
  const map = Theme.buildMap({ overrides: { workspace: '#0b2a4a' } });
  assert.deepEqual(map.get('16,15,24'), [11, 42, 74], 'the main colour becomes exactly the chosen one');
  assert.ok(map.has('12,11,20'), 'a darker shade of the workspace moves too');
  assert.equal(map.has('245,158,11'), false, 'the orange accent is untouched');
  const text = 'background:#100f18;border:1px solid #F59E0B;color:rgba(16, 15, 24, 0.5);x:rgb(16,15,24);y:#100f1880';
  assert.equal(Theme.remapText(text, map), 'background:#0b2a4a;border:1px solid #F59E0B;color:rgba(11, 42, 74, 0.5);x:rgb(11, 42, 74);y:#0b2a4a80');
  assert.equal(Theme.remapText('#app-root,#bad-id{color:#fff}', map), '#app-root,#bad-id{color:#fff}');
});

test('theme: a single colour picked from the screen is replaced on its own', () => {
  const map = Theme.buildMap({ overrides: { 'c:#123456': '#654321' } });
  assert.equal(map.size, 1);
  assert.equal(Theme.remapText('a:#123456;b:#100f18', map), 'a:#654321;b:#100f18');
});

test('theme: prompt boxes are 20% brighter than the surface they sit on', () => {
  assert.deepEqual(Theme.lighten([22, 15, 34], 20), [69, 63, 78]);
  assert.deepEqual(Theme.lighten([0, 0, 0], 0), [0, 0, 0]);
  const under = Theme.composite([[17, 10, 30, 0.55]], [22, 15, 34]);
  assert.deepEqual(under.map(Math.round), [19, 12, 32]);
  assert.equal(Theme.DEFAULT_LIFT, 20);
});

test('theme: every theme colour has a valid main colour and no colour belongs to two theme colours', () => {
  const seen = new Map();
  for (const role of Theme.ROLES) {
    if (role.special) continue;
    for (const hex of [role.primary].concat(role.members)) {
      assert.ok(Theme.parseHex(hex), role.id + ' ' + hex);
      assert.equal(seen.has(hex), false, hex + ' in ' + role.id + ' and ' + seen.get(hex));
      seen.set(hex, role.id);
    }
  }
});
