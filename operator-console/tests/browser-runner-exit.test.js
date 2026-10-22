'use strict';
// The browser acceptance runner must never report success for a failed scenario, whether or not the suite
// passes an argument to exitCode() (nine suites historically called it bare and exited 0 on failures).
const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const helpers = path.join(__dirname, 'browser', 'helpers.js');
const run = body => spawnSync(process.execPath, ['-e', `
  const { runner } = require(${JSON.stringify(helpers)});
  const { test, exitCode } = runner('fixture');
  (async () => { ${body} })();
`], { encoding: 'utf8', timeout: 20000 });

test('a failing scenario yields a nonzero exit even when exitCode() is called bare', () => {
  const r = run(`await test('ok', async () => {}); await test('bad', async () => { throw new Error('deliberate'); }); process.exit(exitCode());`);
  assert.equal(r.status, 1, r.stdout + r.stderr);
  assert.match(r.stdout, /FAIL bad/);
});
test('a failing scenario cannot be masked by an explicit zero/false', () => {
  for (const arg of ['0', 'false', 'undefined']) {
    const r = run(`await test('bad', async () => { throw new Error('x'); }); process.exit(exitCode(${arg}));`);
    assert.equal(r.status, 1, arg);
  }
});
test('all-passing scenarios exit 0', () => {
  const r = run(`await test('a', async () => {}); await test('b', async () => {}); process.exit(exitCode());`);
  assert.equal(r.status, 0, r.stdout + r.stderr);
});
test('an explicit failure count still fails when no scenario was recorded', () => {
  const r = run(`process.exit(exitCode(2));`);
  assert.equal(r.status, 1);
});
test('an uncaught rejection exits nonzero', () => {
  const r = run(`await test('a', async () => {}); Promise.reject(new Error('boom')); await new Promise(r => setTimeout(r, 500));`);
  assert.notEqual(r.status, 0);
});
