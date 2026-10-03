'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { splitLongText, tagsIntact } = require('../long-form');

const squash = s => s.replace(/\s+/g, ' ').trim();
const para = i => `Paragraph ${i} begins here. It has a second sentence with a comma, and a clause; plus more words to fill it. And a third sentence follows to make it longer.`;

test('short text stays a single chunk (fast single-shot path)', () => {
  const c = splitLongText('Hello there. This is short.', { maxChars: 600 });
  assert.equal(c.length, 1); assert.equal(c[0].boundary, 'end'); assert.equal(c[0].total, 1);
});

test('long text: every chunk fits, nothing is lost or reordered', () => {
  const text = Array.from({ length: 40 }, (_, i) => para(i)).join('\n\n');
  const chunks = splitLongText(text, { maxChars: 500 });
  assert.ok(chunks.length > 10);
  for (const c of chunks) assert.ok(c.text.length <= 500, `chunk ${c.index} has ${c.text.length}`);
  assert.equal(squash(chunks.map(c => c.text).join(' ')), squash(text));
  assert.deepEqual(chunks.map(c => c.index), chunks.map((_, i) => i));
});

test('paragraph breaks are preferred over sentence breaks over clause breaks', () => {
  const text = para(1) + '\n\n' + para(2);
  const chunks = splitLongText(text, { maxChars: para(1).length + 5 });
  assert.equal(chunks.length, 2); assert.equal(chunks[0].boundary, 'paragraph'); assert.equal(chunks[0].gapAfterMs, 520);
  const sent = splitLongText('One sentence is here. Another sentence is here. And a third one too.', { maxChars: 45 });
  assert.ok(sent.every(c => /[.]$/.test(c.text)), JSON.stringify(sent.map(c => c.text)));
  assert.ok(sent.slice(0, -1).every(c => c.boundary === 'sentence' && c.gapAfterMs === 260));
  const clause = splitLongText('a very long clause without any full stop at all, then another one follows here, and one more at the end', { maxChars: 50 });
  assert.ok(clause.slice(0, -1).some(c => c.boundary === 'clause'));
});

test('hard fallback only when there is no natural boundary, and it is flagged', () => {
  const word = 'x'.repeat(130);
  const chunks = splitLongText(word, { maxChars: 50 });
  assert.ok(chunks.every(c => c.text.length <= 50));
  assert.ok(chunks.slice(0, -1).every(c => c.boundary === 'hard' && c.gapAfterMs === 0));
  assert.equal(chunks.map(c => c.text).join(''), word);
});

test('performance / paralinguistic tags are never split', () => {
  const t = 'Aaaa bbbb cccc dddd [laughs quietly and then pauses] eeee ffff gggg <whisper softly> hhhh iiii (sighs) jjjj kkkk llll mmmm {long beat} nnnn.';
  for (const max of [20, 25, 30, 35, 40, 60]) {
    const chunks = splitLongText(t, { maxChars: max });
    assert.ok(tagsIntact(t, chunks), `max ${max}: ${JSON.stringify(chunks.map(c => c.text))}`);
    assert.equal(squash(chunks.map(c => c.text).join(' ')), squash(t));
  }
  // a tag longer than the limit is kept whole rather than cut
  const big = splitLongText('start [' + 'z'.repeat(60) + '] end', { maxChars: 30 });
  assert.ok(big.some(c => c.text.includes('[' + 'z'.repeat(60) + ']')));
});

test('chunk offsets point back into the original text', () => {
  const text = 'First para here.\n\nSecond para is here, and goes on. Third sentence.';
  for (const c of splitLongText(text, { maxChars: 30 })) assert.equal(text.slice(c.start, c.end), c.text);
});

test('empty input yields no chunks; tiny limits are rejected', () => {
  assert.deepEqual(splitLongText('  \n '), []);
  assert.throws(() => splitLongText('x', { maxChars: 5 }));
});
