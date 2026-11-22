'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { extractFailureMarkers } = require('./audit/release-diagnostics');

test('failure diagnostics preserve test index, code and location but not private literal or test name', () => {
  const privateValue = 'privatePromptFromUser123';
  const raw = [
    `not ok 2 - user wrote ${privateValue}`,
    `# Error: ${privateValue}`,
    `# code: 'ERR_ASSERTION'`,
    `# AssertionError [ERR_ASSERTION]: ${privateValue}`,
    '    at run (/home/runner/work/Image_Gen/operator-console/tests/recipes.test.js:41:13)',
    `[source-hover +2.0] FAIL selecting ${privateValue}`,
    `debug output: https://example.org/private?token=${privateValue}`,
  ].join('\n');
  const report = extractFailureMarkers(raw);
  assert.ok(report.markers.some(m => m.kind === 'failed-test' && m.index === 2));
  assert.ok(report.markers.some(m => m.kind === 'error-code' && m.code === 'ERR_ASSERTION'));
  assert.ok(report.markers.some(m => m.kind === 'test-location' && m.file === 'tests/recipes.test.js' && m.line === 41));
  assert.ok(report.markers.some(m => m.kind === 'failed-browser-check'));
  const emitted = JSON.stringify(report);
  assert.ok(!emitted.includes(privateValue));
  assert.ok(!emitted.includes('https://example.org'));
  assert.ok(!emitted.includes('/home/runner'));
});

test('unexpected private content in unquoted error messages stays excluded', () => {
  const raw = ['Error: ACCOUNT_TOKEN_UNQUOTED_SECRET', 'user input is private', '# TypeError: ACCOUNT_TOKEN_UNQUOTED_SECRET'].join('\n');
  assert.deepEqual(extractFailureMarkers(raw).markers, [
    { kind: 'error-class', name: 'Error' },
    { kind: 'error-class', name: 'TypeError' },
  ]);
});

test('diagnostics cap distinct failure markers', () => {
  const raw = Array.from({ length: 900 }, (_, i) => `not ok ${i + 1} - privateValue${i}`).join('\n');
  const { markers, truncated } = extractFailureMarkers(raw);
  assert.equal(markers.length, 18);
  assert.equal(truncated, true);
  assert.ok(markers.every(item => JSON.stringify(item).length < 200));
});
