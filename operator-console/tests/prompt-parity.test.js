'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');
const P = require('../public/dexdiffusion/prompt-parity.js');

const SDXL = { id: 'sdxl-photonic', backend: 'sdcpp' };
const SD15 = { id: 'sd15', backend: 'sdcpp' };
const FP8 = { id: 'flux-fp8', backend: 'sdcpp' };
const KLEIN = { id: 'flux2-klein-4b', backend: 'mflux' };
const kinds = text => P.analyzePrompt(text).constructs.map(c => c.kind);

test('plain prompts contain no A1111 constructs and are never altered', () => {
  for (const t of ['a red fox', 'a cat, sitting: calmly', 'price is 5.5 (approx)', '']) {
    const a = P.analyzePrompt(t);
    if (t.includes('(')) assert.deepEqual(a.kinds, ['attention']);
    else assert.deepEqual(a.constructs, []);
  }
});

test('golden: attention, explicit weights, bracket decay and escapes', () => {
  assert.deepEqual(kinds('an (important) word'), ['attention']);
  assert.deepEqual(kinds('a (house:1.3) on a [hill]'), ['attention-weight', 'bracket-decay']);
  const w = P.analyzePrompt('(house:1.3)').constructs[0];
  assert.equal(w.weight, 1.3); assert.equal(w.text, '(house:1.3)');
  assert.deepEqual(kinds('\\(literal\\)'), ['escape', 'escape']);
  assert.deepEqual(kinds('((a)) (b:0.5)').sort(), ['attention', 'attention', 'attention-weight']);
});

test('golden: scheduling, alternation, AND and BREAK are recognised with offsets', () => {
  const s = P.analyzePrompt('a [red:blue:0.5] fox').constructs;
  assert.equal(s.length, 1); assert.equal(s[0].kind, 'schedule'); assert.equal(s[0].offset, 2); assert.equal(s[0].parts, 2); assert.equal(s[0].when, 0.5);
  assert.deepEqual(kinds('[blue:0.3]'), ['schedule']);
  assert.deepEqual(kinds('[red::0.7]'), ['schedule']);
  assert.equal(P.analyzePrompt('[a|b|c]').constructs[0].options, 3);
  assert.deepEqual(kinds('[a|b]'), ['alternation']);
  assert.deepEqual(kinds('a cat AND a dog'), ['and']);
  assert.deepEqual(kinds('a cat AND a dog:0.5'), ['and']);
  assert.deepEqual(kinds('a cat BREAK a dog'), ['break']);
  assert.deepEqual(kinds('a cat and a dog'), [], 'lowercase and is ordinary text');
  assert.deepEqual(kinds('[a:b]'), ['bracket-decay'], 'non-numeric colon is not a schedule');
});

test('unbalanced brackets are reported as notes with offsets, not errors', () => {
  const a = P.analyzePrompt('a (open and [also');
  assert.equal(a.issues.length, 2);
  assert.ok(a.issues.every(i => i.severity === 'note' && Number.isInteger(i.offset) && i.hint));
});

test('support table: sd-cli executes attention and escapes; nothing executes scheduling, alternation or AND', () => {
  for (const spec of [SD15, SDXL]) {
    const s = P.supportFor(spec);
    for (const k of ['attention', 'attention-weight', 'bracket-decay', 'escape', 'break']) assert.equal(s[k], 'native', k);
    for (const k of ['schedule', 'alternation', 'and']) assert.equal(s[k], 'unsupported', k);
  }
  assert.equal(P.supportFor(FP8).break, 'unverified');
  const m = P.supportFor(KLEIN);
  for (const k of ['attention', 'attention-weight', 'bracket-decay', 'escape']) assert.equal(m[k], 'literal', k);
  for (const k of ['break', 'schedule', 'alternation', 'and']) assert.equal(m[k], 'unsupported', k);
  for (const k of P.KINDS) assert.ok(k in m && k in P.supportFor(SDXL), k);
});

test('validateForTarget rejects constructs no backend executes, with offset and a fix hint', () => {
  const e = P.validateForTarget(SDXL, 'a [red:blue:0.5] fox', '');
  assert.match(e, /Unsupported prompt syntax at offset 2: "\[red:blue:0\.5\]"/);
  assert.match(e, /per-step conditioning/);
  assert.match(P.validateForTarget(SDXL, 'x', 'bad [a|b]'), /negative prompt syntax at offset 4/);
  assert.match(P.validateForTarget(SDXL, 'a cat AND a dog', ''), /lowercase "and"/);
  assert.match(P.validateForTarget(KLEIN, 'a cat BREAK a dog', ''), /BREAK/);
});

test('validateForTarget accepts everything the target really handles', () => {
  assert.equal(P.validateForTarget(SDXL, 'a (red:1.3) fox [small] BREAK snow, \\(literal\\)', 'blurry'), null);
  assert.equal(P.validateForTarget(KLEIN, 'a red fox (in snow) with [brackets]', ''), null, 'MFLUX sends these as literal text; allowed but noted');
  assert.equal(P.validateForTarget(SDXL, 'a cat and a dog', ''), null);
});

test('notes tell the truth about literal emphasis on MFLUX and stay silent for sd-cli', () => {
  assert.match(P.notesForTarget(KLEIN, 'a (red:1.3) fox', '')[0], /does not apply emphasis weights/);
  assert.deepEqual(P.notesForTarget(KLEIN, 'a red fox', ''), []);
  assert.deepEqual(P.notesForTarget(SDXL, 'a (red:1.3) fox', ''), []);
  assert.match(P.notesForTarget(FP8, 'a BREAK b', '')[0], /unverified/);
});

test('help text never claims scheduling, alternation or AND', () => {
  for (const spec of [SD15, SDXL, FP8, KLEIN]) {
    const h = P.syntaxHelp(spec);
    assert.doesNotMatch(h, /A1111 syntax supported/);
  }
  assert.match(P.syntaxHelp(SDXL), /Not supported yet: \[a:b:0\.5\] scheduling/);
  assert.match(P.syntaxHelp(KLEIN), /plain language/);
});
