'use strict';
// Incremental Ollama NDJSON parsing (contract D.4, C-05): split lines, split UTF-8, malformed, oversized and unterminated lines.
const test = require('node:test');
const assert = require('node:assert/strict');
const { createNdjsonParser, MAX_LINE_BYTES } = require('../ollama-ndjson');

const collect = (parser, chunks) => {
  const out = [];
  for (const c of chunks) { const r = parser.push(Buffer.from(c)); out.push(...r.objects); if (r.error) return { out, error: r.error }; }
  const e = parser.end(); out.push(...e.objects);
  return { out, error: e.error };
};

test('objects split anywhere across chunks are reassembled in order', () => {
  const text = '{"a":1}\n{"b":"two"}\n{"c":[3]}\n';
  for (let cut = 1; cut < text.length; cut++) {
    const r = collect(createNdjsonParser(), [text.slice(0, cut), text.slice(cut)]);
    assert.equal(r.error, null);
    assert.deepEqual(r.out, [{ a: 1 }, { b: 'two' }, { c: [3] }], 'cut ' + cut);
  }
});

test('a multi-byte UTF-8 character split between chunks decodes intact', () => {
  const bytes = Buffer.from('{"t":"café \u{1F600}"}\n', 'utf8');
  for (let cut = 1; cut < bytes.length; cut++) {
    const p = createNdjsonParser();
    const a = p.push(bytes.subarray(0, cut)), b = p.push(bytes.subarray(cut));
    assert.deepEqual([...a.objects, ...b.objects], [{ t: 'café \u{1F600}' }]);
  }
});

test('blank lines and CRLF endings are tolerated; many objects in one chunk all come out', () => {
  const r = collect(createNdjsonParser(), ['\n{"a":1}\r\n\n{"a":2}\n{"a":3}\n']);
  assert.deepEqual(r.out, [{ a: 1 }, { a: 2 }, { a: 3 }]);
});

test('a malformed line is a parse error and nothing after it is returned', () => {
  const p = createNdjsonParser();
  const r = p.push(Buffer.from('{"a":1}\n{"a":\n{"a":3}\n'));
  assert.deepEqual(r.objects, [{ a: 1 }]);
  assert.equal(r.error, 'malformed_line');
  assert.deepEqual(p.push(Buffer.from('{"a":4}\n')), { objects: [], error: 'malformed_line' });
});

test('a JSON value that is not an object is refused', () => {
  for (const v of ['[1]\n', '"x"\n', '7\n', 'null\n']) assert.equal(createNdjsonParser().push(Buffer.from(v)).error, 'not_an_object', v);
});

test('a line longer than the cap is refused before it is buffered further', () => {
  assert.equal(MAX_LINE_BYTES, 1024 * 1024);
  const p = createNdjsonParser({ maxLineBytes: 16 });
  assert.equal(p.push(Buffer.from('{"a":"0123')).error, null);
  assert.equal(p.push(Buffer.from('456789abcdef"}')).error, 'line_too_long');
  const q = createNdjsonParser({ maxLineBytes: 16 });
  assert.equal(q.push(Buffer.from('{"a":"0123456789abcdef"}\n')).error, 'line_too_long');
  // A whole default-cap line is still accepted.
  const big = '{"t":"' + 'x'.repeat(MAX_LINE_BYTES - 10) + '"}\n';
  assert.equal(createNdjsonParser().push(Buffer.from(big)).objects.length, 1);
});

test('end() parses a final unterminated object and refuses unterminated garbage', () => {
  assert.deepEqual(collect(createNdjsonParser(), ['{"a":1}\n{"done":true}']), { out: [{ a: 1 }, { done: true }], error: null });
  assert.equal(collect(createNdjsonParser(), ['{"a":1}\n{"done":tr']).error, 'malformed_line');
  assert.deepEqual(createNdjsonParser().end(), { objects: [], error: null });
});
