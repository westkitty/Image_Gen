'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const D = require('../drama');
const { splitLongText, verifyChunkReconstruction } = require('../long-form');

const SCRIPT = `# ACT ONE

INT. WAREHOUSE - NIGHT

The rain hammers the roof. A single lamp swings overhead.

TIGER: I warned you.
CODEC: [quietly] I know.
TIGER (angry): Then why did you come
back here?

[pause 2s]
(A door slams somewhere below.)
CODEC: Because (sighs) I had no choice.

TIGER
(whispering)
Stay quiet.
We are not alone.

=== ACT TWO ===
EXT. ROOFTOP - DAWN

Dawn breaks over the city.
NARRATOR: And so it ended.`;

test('every non-whitespace source character is classified', () => {
  const parsed = D.parseScript(SCRIPT);
  const cov = D.verifySourceCoverage(SCRIPT, parsed);
  assert.equal(cov.ok, true, JSON.stringify(cov.unclassified.slice(0, 3)));
  assert.deepEqual(cov.unclassified, []);
  for (const cls of ['heading', 'dialogue', 'narration', 'direction', 'pause', 'syntax']) assert.ok(cov.counts[cls] > 0, `class ${cls} present`);
  assert.equal(cov.mismatches.length, 0);
});

test('coverage detects a span that was silently dropped', () => {
  const parsed = D.parseScript(SCRIPT);
  const victim = parsed.spans.findIndex(s => s.class === 'dialogue');
  parsed.spans.splice(victim, 1);
  const cov = D.verifySourceCoverage(SCRIPT, parsed);
  assert.equal(cov.ok, false);
  assert.ok(cov.unclassified.length >= 1);
});

test('coverage proves each speech line text equals its source span (not just word counts)', () => {
  const parsed = D.parseScript(SCRIPT);
  parsed.scenes.flatMap(sc => sc.lines).find(l => l.speaker === 'TIGER').text = 'I warned somebody else.';
  const cov = D.verifySourceCoverage(SCRIPT, parsed);
  assert.equal(cov.ok, false);
  assert.equal(cov.mismatches.length, 1);
  assert.equal(cov.mismatches[0].reason, 'text-differs-from-source');
});

test('CRLF sources are covered against newline-normalised offsets, original text preserved', () => {
  const crlf = SCRIPT.replace(/\n/g, '\r\n');
  const parsed = D.parseScript(crlf);
  assert.equal(D.verifySourceCoverage(crlf, parsed).ok, true);
  const p = D.newProject({ title: 't', source_script: crlf, parsed });
  assert.equal(p.source_script, crlf, 'original text is kept byte-for-byte');
  assert.match(p.source_sha256, /^[a-f0-9]{64}$/);
});

test('new projects record source revision, coverage and line source hashes', () => {
  const parsed = D.parseScript(SCRIPT);
  const p = D.newProject({ title: 't', source_script: SCRIPT, parsed });
  assert.equal(p.schema, D.SCHEMA); assert.equal(p.source_rev, 1);
  assert.equal(p.source_coverage.ok, true);
  const tiger = D.allLines(p).find(x => x.line.speaker === 'TIGER').line;
  assert.match(tiger.source_sha, /^[a-f0-9]{64}$/);
});

test('chunk reconstruction proof: ordered chunks rebuild the intended spoken text exactly', () => {
  const text = 'First sentence here, with a clause. Second sentence follows it closely! Third one ends: done. ' + 'word '.repeat(60) + 'THE END.';
  const chunks = splitLongText(text, { maxChars: 80 });
  assert.ok(chunks.length > 3);
  assert.deepEqual(verifyChunkReconstruction(text, chunks), { ok: true, chunks: chunks.length, chars: D.normalizeSpoken(text).length });
});

test('chunk reconstruction proof fails on a dropped, swapped or altered chunk', () => {
  const text = 'One two three four five six seven eight nine ten. Eleven twelve thirteen fourteen fifteen sixteen. Seventeen eighteen nineteen twenty.';
  const chunks = splitLongText(text, { maxChars: 50 });
  assert.ok(chunks.length >= 3);
  assert.equal(verifyChunkReconstruction(text, chunks.slice(1)).ok, false, 'dropped leading chunk');
  assert.equal(verifyChunkReconstruction(text, [chunks[1], chunks[0], ...chunks.slice(2)]).ok, false, 'swapped chunks');
  const altered = chunks.map((c, i) => (i === 1 ? Object.assign({}, c, { text: c.text.replace('twelve', 'twelfth') }) : c));
  assert.equal(verifyChunkReconstruction(text, altered).ok, false, 'altered chunk');
  const r = verifyChunkReconstruction(text, chunks.slice(0, -1));
  assert.equal(r.ok, false); assert.match(r.reason, /uncovered|ends before/);
});

test('hard-cut chunks (no whitespace) still reconstruct exactly', () => {
  const text = 'x'.repeat(130);
  const chunks = splitLongText(text, { maxChars: 50 });
  assert.equal(verifyChunkReconstruction(text, chunks).ok, true);
  assert.ok(chunks.some(c => c.boundary === 'hard'));
});
