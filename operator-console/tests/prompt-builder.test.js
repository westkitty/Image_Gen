'use strict';
// Prompt Builder pure logic: comma splitting that respects syntax, randomize-pieces / new-prompt at a given randomness,
// and syntax actions that only offer what the target backend really runs (prompt-parity.js support table).
const test = require('node:test'), assert = require('node:assert/strict');
const fs = require('node:fs'), os = require('node:os'), path = require('node:path');
const PB = require('../public/dexdiffusion/prompt-builder.js');
const DP = require('../public/dexdiffusion/prompt-parity.js');
const { getWildcardItems } = require('../wildcards');

const seq = vals => { let i = 0; return () => vals[i++ % vals.length]; };
const BANKS = { colors: ['red', 'blue', 'green'], moods: ['calm', 'tense'], lighting: ['rim light', 'golden hour'] };

test('splitPieces keeps commas inside (), [] and <> with their piece', () => {
  assert.deepEqual(PB.splitPieces('a cat, (red, blue:1.2), [x, y], <lora:a,b:1>, __colors__'), ['a cat', '(red, blue:1.2)', '[x, y]', '<lora:a,b:1>', '__colors__']);
  assert.deepEqual(PB.splitPieces('  '), []);
});

test('randomness 0 changes nothing; the subject is kept', () => {
  const text = 'a lighthouse, red, calm';
  assert.equal(PB.randomizePieces(text, BANKS, { amount: 0, rnd: seq([0.5]) }), text);
});

test('a piece from a bank is swapped for another item of the same bank', () => {
  // rnd: 0 → always below amount (change), pick index 0 of alternatives; no reorder at 0.5, no extras (extra uses rnd too → 0).
  const out = PB.randomizePieces('a lighthouse, red, calm', BANKS, { amount: 0.5, keepSubject: true, rnd: seq([0]) });
  assert.equal(out, 'a lighthouse, blue, tense');
});

test('token mode swaps to bank tokens and never invents a bank', () => {
  const out = PB.randomizePieces('a lighthouse, red, __moods__', BANKS, { amount: 0.5, tokens: true, rnd: seq([0]) });
  const pieces = PB.splitPieces(out);
  assert.equal(pieces[0], 'a lighthouse');
  assert.equal(pieces[1], '__colors__');
  assert.match(pieces[2], /^__(colors|lighting)__$/);
});

test('newRandomPrompt draws 2–7 distinct banks scaled by randomness and keeps the subject', () => {
  const low = PB.newRandomPrompt(BANKS, { amount: 0, subject: 'a fox', rnd: seq([0.1, 0.7, 0.3]) });
  assert.equal(PB.splitPieces(low).length, 3, 'subject + 2 pieces');
  assert.equal(PB.splitPieces(low)[0], 'a fox');
  const high = PB.newRandomPrompt(BANKS, { amount: 1, tokens: true, rnd: seq([0.2, 0.9, 0.5]) });
  const p = PB.splitPieces(high);
  assert.equal(p.length, 3, 'capped at the number of banks');
  assert.equal(new Set(p).size, 3);
  for (const x of p) assert.match(x, /^__(colors|moods|lighting)__$/);
});

test('syntax actions follow the backend support table', () => {
  const sd = PB.syntaxActions(DP.supportFor({ id: 'sd15', backend: 'sdcpp' }));
  const flux2 = PB.syntaxActions(DP.supportFor({ id: 'flux2-klein-4b', backend: 'mflux' }));
  const st = (acts, id) => acts.find(a => a.id === id).status;
  assert.equal(st(sd, 'weight'), 'native'); assert.equal(st(sd, 'break'), 'native'); assert.equal(st(sd, 'schedule'), 'unsupported');
  assert.equal(st(flux2, 'weight'), 'literal'); assert.equal(st(flux2, 'break'), 'unsupported');
  assert.equal(sd.find(a => a.id === 'weight').insert('sky', 1.3), '(sky:1.3)');
  assert.equal(sd.find(a => a.id === 'emphasis').insert(''), '(word)');
  assert.equal(sd.find(a => a.id === 'schedule').insert, null, 'unsupported constructs have no insert action');
});

test('getWildcardItems resolves banks case-insensitively and refuses path-like names', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'wc-items-'));
  try {
    fs.writeFileSync(path.join(dir, 'Colors.txt'), '# comment\nred\n\nblue\n');
    assert.deepEqual(getWildcardItems('colors', dir), { name: 'Colors', count: 2, items: ['red', 'blue'], truncated: false });
    assert.equal(getWildcardItems('../etc/passwd', dir), null);
    assert.equal(getWildcardItems('missing', dir), null);
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

test('the Studio page loads the modal and builder scripts before the component', () => {
  const html = fs.readFileSync(path.join(__dirname, '../public/dexdiffusion/index.html'), 'utf8');
  const at = n => html.indexOf('src="' + n + '"');
  assert.ok(at('dex-modal.js') > 0 && at('prompt-builder.js') > at('dex-modal.js') && at('component.js') > at('prompt-builder.js'));
});
