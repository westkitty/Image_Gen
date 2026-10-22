'use strict';
// The release gate must trust real exit statuses and consistent summaries, never a filtered pipeline.
const test = require('node:test');
const assert = require('node:assert/strict');
const { spawnSync } = require('node:child_process');
const path = require('node:path');
const SCRIPT = path.join(__dirname, '..', '..', 'scripts', 'release-preflight.sh');
const run = cmd => spawnSync('bash', [SCRIPT], { encoding: 'utf8', env: Object.assign({}, process.env, { DEX_PREFLIGHT_SKIP_CHECK: '1', DEX_PREFLIGHT_UNIT_ONLY: '1', DEX_PREFLIGHT_UNIT_CMD: cmd, DEX_PREFLIGHT_NO_CLEAN: '1', DEX_PREFLIGHT_MIN_FREE_KIB: '0' }) });
const summary = (t, p, f, c = 0) => `echo "ℹ tests ${t}"; echo "ℹ pass ${p}"; echo "ℹ fail ${f}"; echo "ℹ cancelled ${c}"; echo "ℹ skipped 0"`;

test('a consistent all-pass summary with exit 0 passes', () => { const r = run(summary(5, 5, 0)); assert.equal(r.status, 0, r.stdout + r.stderr); });
test('a failing test fails the gate even though a grep-style filter would have succeeded', () => { const r = run(summary(5, 4, 1) + '; exit 1'); assert.equal(r.status, 1); assert.match(r.stdout, /FAIL\s+unit suite/); });
test('exit 0 with fail>0 in the summary still fails', () => { assert.equal(run(summary(5, 4, 1)).status, 1); });
test('a non-zero exit with an all-pass looking summary fails', () => { assert.equal(run(summary(5, 5, 0) + '; exit 3').status, 1); });
test('a truncated run with no summary fails', () => { assert.equal(run('echo partial output').status, 1); });
test('cancelled tests fail the gate', () => { assert.equal(run(summary(5, 5, 0, 1)).status, 1); });
test('zero tests is not a pass', () => { assert.equal(run(summary(0, 0, 0)).status, 1); });

test('matrix browser output is admitted only with passing cells and no blocked or failed cells', () => {
  const fs = require('node:fs'), os = require('node:os');
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'dex-gate-'));
  try {
    const stub = path.join(dir, 'timeout');
    fs.writeFileSync(stub, '#!/bin/sh\nprintf "%s\\n" "$DEX_GATE_FIXTURE"\n', { mode: 0o700 });
    for (const [output, expected] of [
      ['V2/1280x800/Create PASS ', 0],
      ['V2/1280x800/Create PASS \nV2/360x780/Edit Studio BLOCKED execution: timeout', 1],
      ['V2/1280x800/Create FAIL controls: unnamed', 1],
      ['no measured cells', 1],
    ]) {
      const result = spawnSync('bash', [SCRIPT], { encoding: 'utf8', env: {
        ...process.env, PATH: dir + path.delimiter + process.env.PATH,
        DEX_PREFLIGHT_SKIP_CHECK: '1', DEX_PREFLIGHT_UNIT_ONLY: '0',
        DEX_PREFLIGHT_UNIT_CMD: summary(1, 1, 0), DEX_PREFLIGHT_BROWSER: 'interaction-matrix',
        DEX_PREFLIGHT_MIN_FREE_KIB: '0', DEX_GATE_FIXTURE: output,
      } });
      assert.equal(result.status, expected, result.stdout + result.stderr);
    }
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});
