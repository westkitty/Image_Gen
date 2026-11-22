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

test('matrix tally counts and names reason-bearing outcomes without forwarding reason text', () => {
  const { tallyMatrixCells } = require('./audit/release-diagnostics');
  const log = [
    'V2/360x780/Create PASS ',
    'V2/375x812/Edit Studio FAIL layout: USER_PROMPT_SENTINEL',
    'V2/390x844/Voice BLOCKED execution: /private/FIXTURE_PATH_SENTINEL',
    'V2/768x1024/Library FAIL',
    'V2/360x780/Not A Registered Screen FAIL this must not be listed',
    'V9/360x780/Drama BLOCKED invalid shell',
    'V2/999x100/Music PASS invalid viewport',
    'prefix V2/360x780/Video PASS not a matrix record',
  ].join('\r\n');
  assert.deepEqual(tallyMatrixCells(log), {
    passed: 1, failed: 3, blocked: 1, measured: 4,
    nonPassing: [
      { id: 'V2/375x812/Edit Studio', status: 'FAIL' },
      { id: 'V2/390x844/Voice', status: 'BLOCKED' },
      { id: 'V2/768x1024/Library', status: 'FAIL' },
    ],
  });
  const markers = extractFailureMarkers(log).markers;
  assert.ok(markers.some(m => m.kind === 'failed-matrix-cell'));
  assert.doesNotMatch(JSON.stringify({ tally: tallyMatrixCells(log), markers }), /SENTINEL|Not A Registered Screen/);
});

test('matrix tally is per registered cell and cannot lose failure to an echoed PASS', () => {
  const { tallyMatrixCells } = require('./audit/release-diagnostics');
  const log = ['V2/360x780/Models PASS','V2/360x780/Models FAIL controls: detail','V2/360x780/Models PASS'].join('\n');
  assert.deepEqual(tallyMatrixCells(log), {
    passed: 0, failed: 1, blocked: 0, measured: 1,
    nonPassing: [{ id: 'V2/360x780/Models', status: 'FAIL' }],
  });
});

test('matrix tally emits only structured allowlisted contract keys for known non-passing cells', () => {
  const { matrixContractLine, tallyMatrixCells } = require('./audit/release-diagnostics');
  assert.equal(matrixContractLine('V2/375x812/Enhance', ['typography', 'PRIVATE_CATEGORY', 'keyboard', 'keyboard']),
    'DEX_MATRIX_CONTRACTS\tV2/375x812/Enhance\tkeyboard,typography');
  assert.equal(matrixContractLine('V2/375x812/PRIVATE_SCREEN', ['layout']), '');
  assert.equal(matrixContractLine('V2/375x812/Enhance', []), '');
  const log = [
    'V2/375x812/Enhance FAIL typography: PRIVATE_RAW_DETAIL',
    'DEX_MATRIX_CONTRACTS\tV2/375x812/Enhance\ttypography,keyboard,PRIVATE_CATEGORY,/private/path',
    'DEX_MATRIX_CONTRACTS\tV2/375x812/Enhance\tkeyboard,runtime',
    'V2/390x844/Enhance PASS',
    'DEX_MATRIX_CONTRACTS\tV2/390x844/Enhance\tforms',
    'DEX_MATRIX_CONTRACTS\tV2/375x812/PRIVATE_SCREEN\tlayout',
    'DEX_MATRIX_CONTRACTS\tV2/375x812/Enhance\tdialogs\tPRIVATE_METADATA',
    'V2/360x780/Create BLOCKED execution: PRIVATE_EXECUTION_DETAIL',
    'DEX_MATRIX_CONTRACTS\tV2/360x780/Create\texecution,navigation-label-regression',
  ].join('\n');
  const tally = tallyMatrixCells(log);
  assert.deepEqual(tally.nonPassing, [
    { id: 'V2/375x812/Enhance', status: 'FAIL', contracts: ['keyboard', 'runtime', 'typography'] },
    { id: 'V2/360x780/Create', status: 'BLOCKED', contracts: ['execution', 'navigation-label-regression'] },
  ]);
  assert.doesNotMatch(JSON.stringify(tally), /PRIVATE|\/private\/|dialogs/);
});
