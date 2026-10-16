'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');
const P = require('../public/dexdiffusion/prompt-matrix.js');
const Infotext = require('../public/dexdiffusion/infotext.js');
const Helpers = require('../public/dexdiffusion/client-helpers.js');

const B = (prompt, negative_prompt = '') => ({ prompt, negative_prompt });

test('sampler map stays in step with infotext.js and the console sampler list', () => {
  assert.deepEqual(P.SAMPLER_IN, Infotext.SAMPLER_IN);
  const ids = new Set(Helpers.SAMPLER_CHOICES.map(c => c[0]));
  for (const id of Object.values(P.SAMPLER_IN)) if (id !== 'dpm2_a' && id !== 'lms') assert.ok(ids.has(id), id);
});

test('matrix: 3 parts -> 8 cells in A1111 bit order, base first, joined with ", "', () => {
  const p = P.buildMatrix(B('a cat | red hat | blue scarf | sunset'));
  assert.equal(p.ok, true); assert.equal(p.total, 8);
  assert.deepEqual(p.cells.map(c => c.prompt), [
    'a cat', 'a cat, red hat', 'a cat, blue scarf', 'a cat, red hat, blue scarf',
    'a cat, sunset', 'a cat, red hat, sunset', 'a cat, blue scarf, sunset', 'a cat, red hat, blue scarf, sunset']);
  assert.deepEqual(p.cells.map(c => c.index), [0, 1, 2, 3, 4, 5, 6, 7]);
  assert.equal(p.cells[0].title, 'base only');
  assert.equal(p.cells[3].title, 'red hat + blue scarf');
  assert.equal(p.cells[5].queueTitle, 'Matrix 6/8 · parts 1, 3', 'persisted title carries part numbers, not text');
});

test('matrix: grid layout splits parts like A1111 (boundary = ceil((N+1)/2)), cell = x + y*columns', () => {
  const two = P.buildMatrix(B('base | a | b'));
  assert.deepEqual(two.dims, [2, 2, 1]);
  assert.deepEqual(two.axes[0].values, ['base only', 'a']); assert.deepEqual(two.axes[1].values, ['base only', 'b']);
  assert.deepEqual(two.cells.map(c => [c.ix, c.iy]), [[0, 0], [1, 0], [0, 1], [1, 1]]);
  assert.equal(two.cells[2].prompt, 'base, b');
  const one = P.buildMatrix(B('base | a'));
  assert.deepEqual(one.dims, [1, 2, 1]); assert.equal(one.axes[0], null); assert.deepEqual(one.axes[1].values, ['base only', 'a']);
  const three = P.buildMatrix(B('base | a | b | c'));
  assert.deepEqual(three.dims, [2, 4, 1]);
  assert.deepEqual(three.axes[0].values, ['base only', 'a']); assert.deepEqual(three.axes[1].values, ['base only', 'b', 'c', 'b + c']);
  const six = P.buildMatrix(B('base | a | b | c | d | e | f'));
  assert.equal(six.total, 64); assert.deepEqual(six.dims, [8, 8, 1]);
  for (const c of six.cells) assert.equal(c.index, c.ix + c.iy * 8);
});

test('matrix: stripping, joiner, put-at-start, empties and seeds', () => {
  const p = P.buildMatrix(B('  a cat ,  | , red hat , |blue'), { joiner: 'space', putAtStart: true });
  assert.deepEqual(p.cells.map(c => c.prompt), ['a cat', 'red hat a cat', 'blue a cat', 'red hat blue a cat']);
  const comma = P.buildMatrix(B('a | b'), { putAtStart: true });
  assert.equal(comma.cells[1].prompt, 'b, a');
  assert.equal(P.buildMatrix(B('a | b'), { differentSeeds: true }).cells[1].seedOffset, 1);
  assert.equal(P.buildMatrix(B('a | b')).cells[1].seedOffset, 0, 'same seed for every cell by default');
  assert.match(P.buildMatrix(B('a || b')).errors[0], /Optional part 1 is empty/);
  assert.match(P.buildMatrix(B('a | b |')).errors[0], /Optional part 2 is empty/);
  assert.match(P.buildMatrix(B('| a')).errors[0], /empty prompt/);
  assert.equal(P.buildMatrix(B('| a')).ok, false);
});

test('matrix: caps and gating', () => {
  assert.match(P.buildMatrix(B('plain prompt')).errors[0], /at least one "\|"/);
  const seven = P.buildMatrix(B('b | 1 | 2 | 3 | 4 | 5 | 6 | 7'));
  assert.equal(seven.ok, false); assert.match(seven.errors[0], /7 optional parts \(128 cells\); the limit is 6 parts \(64 cells\)/);
  assert.equal(P.buildMatrix(B('a | b'), { target: 'sideways' }).ok, false);
  assert.equal(P.buildMatrix(B('a | b'), { joiner: 'tab' }).ok, false);
  const flux = { negativePrompt: false };
  assert.match(P.buildMatrix(B('a', 'x | y'), { target: 'negative' }, flux).errors[0], /does not use a negative prompt/);
  assert.equal(P.buildMatrix(B('a | b'), { target: 'positive' }, flux).ok, true);
});

test('matrix on the negative prompt varies only the negative', () => {
  const p = P.buildMatrix(B('a cat', 'ugly | blurry | text'), { target: 'negative' });
  assert.equal(p.ok, true); assert.equal(p.total, 4);
  assert.deepEqual(p.cells.map(c => c.negative_prompt), ['ugly', 'ugly, blurry', 'ugly, text', 'ugly, blurry, text']);
  assert.ok(p.cells.every(c => c.prompt === 'a cat'));
  const empty = P.buildMatrix(B('a cat', '| blurry'), { target: 'negative' });
  assert.deepEqual(empty.cells.map(c => c.negative_prompt), ['', 'blurry'], 'an empty base negative is fine');
});

test('shellSplit: quotes, escapes, empties and errors', () => {
  const v = s => P.shellSplit(s).tokens.map(t => t.text);
  assert.deepEqual(v('--a "x y" \'z w\' q\\ r'), ['--a', 'x y', 'z w', 'q r']);
  assert.deepEqual(v('say "he said \\"hi\\""'), ['say', 'he said "hi"']);
  assert.deepEqual(P.shellSplit('x ""').tokens.map(t => [t.text, t.quoted]), [['x', false], ['', true]]);
  assert.match(P.shellSplit('--a "oops').error, /double quote/);
  assert.match(P.shellSplit("--a 'oops").error, /single quote/);
  assert.match(P.shellSplit('--a b\\').error, /backslash/);
});

test('lines: plain prompts, blanks skipped, physical line numbers kept', () => {
  const p = P.buildLines('a cat\n\n  \r\na dog\n', B('', 'blurry'));
  assert.equal(p.ok, true); assert.equal(p.total, 2); assert.equal(p.skipped, 3);
  assert.deepEqual(p.cells.map(c => [c.line, c.prompt, c.negative_prompt]), [[1, 'a cat', 'blurry'], [4, 'a dog', 'blurry']]);
  assert.equal(p.cells[1].title, 'Line 4');
  assert.match(P.buildLines('  \n\n', B('x')).errors[0], /at least one prompt/);
});

test('lines: A1111 flag syntax, quoting, sampler names and per-line negative', () => {
  const text = '--prompt "a red cat" --steps 20 --cfg_scale 7.5 --seed 5 --width 512 --height 640 --sampler_name "Euler a" --negative_prompt "ugly, bad hands"';
  const p = P.buildLines(text, B('ignored'));
  assert.equal(p.ok, true, JSON.stringify(p.errors));
  const c = p.cells[0];
  assert.equal(c.prompt, 'a red cat'); assert.equal(c.negative_prompt, 'ugly, bad hands');
  assert.deepEqual(c.overrides, { steps: 20, cfg_scale: 7.5, seed: 5, width: 512, height: 640, sampler: 'euler_a' });
  assert.equal(c.title, 'Line 1 · steps 20 · cfg_scale 7.5 · seed 5 · width 512 · height 640 · sampler euler_a', 'no prompt text in the persisted title');
  assert.ok(!c.queueTitle.includes('red cat') && !c.queueTitle.includes('ugly'));
  // unquoted multi-word prompt runs to the next flag; canonical ids and case-insensitive names
  const q = P.buildLines('--prompt a green dog --sampler_name DPM++ 2M --steps 8', B('x'));
  assert.equal(q.ok, false, 'an unquoted two-word sampler is two tokens: "2M" is not a flag');
  const q2 = P.buildLines('--prompt a green dog --sampler_name "DPM++ 2M" --steps 8', B('x'));
  assert.equal(q2.cells[0].prompt, 'a green dog'); assert.equal(q2.cells[0].overrides.sampler, 'dpmpp2m');
  assert.equal(P.buildLines('--prompt x --sampler_name dpmpp2m', B('')).cells[0].overrides.sampler, 'dpmpp2m');
  // a quoted "--word" is text, not a flag
  assert.equal(P.buildLines('--prompt "use --steps carefully" --steps 9', B('')).cells[0].prompt, 'use --steps carefully');
  // seed -1 = random is allowed
  assert.equal(P.buildLines('--prompt x --seed -1', B('')).cells[0].overrides.seed, -1);
});

test('lines: a flag line without --prompt uses the Create prompt (A1111) unless that is empty', () => {
  const ok = P.buildLines('--steps 12', B('base prompt'));
  assert.equal(ok.cells[0].prompt, 'base prompt'); assert.ok(ok.cells[0].labels.includes('Create prompt'));
  assert.match(P.buildLines('--steps 12', B('')).errors[0], /^Line 1: no --prompt and the Create prompt is empty/);
});

test('lines: strict errors always name the line and are never ignored', () => {
  const e = text => P.buildLines(text, B('base'), {}, null).errors;
  assert.match(e('ok\n--prompt x --bogus 1')[0], /^Line 2: unknown flag --bogus \(supported: --prompt/);
  assert.match(e('--prompt x --sd_model foo')[0], /^Line 1: --sd_model is an A1111 option this console does not support/);
  assert.match(e('\n\n--prompt x --steps abc')[0], /^Line 3: --steps "abc" is not a whole number/);
  assert.match(e('--prompt x --steps 1.5')[0], /^Line 1: --steps "1.5" is not a whole number/);
  assert.match(e('--prompt x --steps 0')[0], /outside 1–150/);
  assert.match(e('--prompt x --cfg_scale lots')[0], /not a number/);
  assert.match(e('--prompt x --cfg_scale 99')[0], /outside 1–30/);
  assert.match(e('--prompt x --width 8')[0], /outside 64–2048/);
  assert.match(e('--prompt x --seed 9999999999')[0], /outside -1–2147483647/);
  assert.match(e('--prompt x --steps')[0], /--steps needs a value/);
  assert.match(e('--prompt x --steps --seed 4')[0], /--steps needs a value/);
  assert.match(e('--prompt --steps 5')[0], /--prompt needs text/);
  assert.match(e('--prompt x --steps 5 --steps 6')[0], /--steps appears twice/);
  assert.match(e('--prompt "unterminated')[0], /^Line 1: unterminated double quote/);
  assert.match(e('--prompt x --sampler_name UniPC')[0], /has no installed engine/);
  assert.match(e('--prompt x --sampler_name nonsense')[0], /unknown sampler "nonsense"/);
  assert.match(e('--steps 5 stray text')[0], /expected a "--flag"/);
  assert.match(e('a cat --steps 20')[0], /^Line 1: "--steps" looks like a flag inside a plain prompt/);
  assert.match(e('fine\nalso fine --no-wait ')[0], /^Line 2: "--no-wait"/);
  assert.equal(e('a - b -- c').length, 0, 'a lone "--" surrounded by text is not flag-like');
  // all errors are collected, one per bad line
  assert.equal(e('--steps x\nfine\n--width y').length, 2);
});

test('lines: gating by target capability', () => {
  const flux = { cfg: false, sampler: false, negativePrompt: false };
  assert.match(P.buildLines('--prompt x --cfg_scale 5', B(''), {}, flux).errors[0], /^Line 1: --cfg_scale is refused: this target does not use CFG scale/);
  assert.match(P.buildLines('--prompt x --sampler_name "Euler a"', B(''), {}, flux).errors[0], /does not use a sampler choice/);
  assert.match(P.buildLines('ok\n--prompt x --negative_prompt y', B(''), {}, flux).errors[0], /^Line 2: --negative_prompt is refused/);
  assert.equal(P.buildLines('--prompt x --steps 5 --seed 1 --width 512', B(''), {}, flux).ok, true);
});

test('lines: 64 line cap counts prompts, not blank lines; iterate seed', () => {
  const sixtyFour = Array.from({ length: 64 }, (_, i) => 'p' + i).join('\n\n');
  assert.equal(P.buildLines(sixtyFour, B('')).ok, true);
  const tooMany = P.buildLines(sixtyFour + '\nextra', B(''));
  assert.equal(tooMany.ok, false); assert.match(tooMany.errors[0], /65 prompts; the limit is 64/);
  const it = P.buildLines('a\nb\nc', B(''), { iterateSeed: true });
  assert.deepEqual(it.cells.map(c => c.seedOffset), [0, 1, 2]);
  assert.deepEqual(P.buildLines('a\nb', B('')).cells.map(c => c.seedOffset), [0, 0]);
});

test('dry run: ordered, exact preview text for both scripts', () => {
  const lines = P.dryRun('lines', { text: '--prompt "a cat" --steps 9\nplain', base: B('', 'blurry'), opts: {} });
  assert.deepEqual(lines.preview, ['1. a cat  [neg: blurry]  (steps=9)', '2. plain  [neg: blurry]']);
  const m = P.dryRun('matrix', { base: B('a | b'), opts: { differentSeeds: true } });
  assert.deepEqual(m.preview, ['1. a', '2. a, b  (seed+1)']);
  assert.deepEqual(P.dryRun('lines', { text: '--bogus 1', base: B('') }).preview, [], 'a failed plan previews nothing');
});
