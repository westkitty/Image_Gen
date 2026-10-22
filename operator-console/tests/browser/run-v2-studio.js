'use strict';
// Explicit V2 product acceptance. Legacy presentation is a separate comparison.
// A subset is reported as partial; a failed suite never becomes a passing gate.
const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const all = fs.readdirSync(__dirname).filter(n => n.endsWith('.browser.js') &&
  !/style|wildcard|concept-a-refinement|puppet-master/i.test(n)).map(n => n.replace('.browser.js', '')).sort();
const selected = process.env.DEX_V2_SUITES ? process.env.DEX_V2_SUITES.split(',') : all;
if (new Set(selected).size !== selected.length || !selected.length || selected.some(n => !all.includes(n))) throw new Error('Unknown V2 product suite');
const results = [];
for (const name of selected) {
  console.log('[v2-product] RUN ' + name);
  const r = spawnSync(process.execPath, [path.join(__dirname, name + '.browser.js')], {
    cwd: path.join(__dirname, '../..'), encoding: 'utf8', maxBuffer: 4 * 1024 * 1024,
    timeout: 600000, env: { ...process.env, DEX_MATRIX_SHELLS: '2' },
  });
  process.stdout.write(r.stdout || ''); process.stderr.write(r.stderr || '');
  const status = r.status === 0 && !r.error && !r.signal ? 'PASS' : 'FAIL';
  results.push({ suite: name, target: 2, status, exit: r.status, signal: r.signal, error: r.error?.message });
  console.log('[v2-product] ' + status + ' ' + name);
}
console.log('V2_PRODUCT_RESULTS ' + JSON.stringify({ target: 2, partial: selected.length !== all.length || !!process.env.DEX_MATRIX_SLICE, results }));
process.exitCode = results.some(r => r.status !== 'PASS') ? 1 : 0;
