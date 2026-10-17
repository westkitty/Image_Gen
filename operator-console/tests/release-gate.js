'use strict';
// Release / parity gate: `npm run test:release`.
// Runs syntax check, the full unit suite and EVERY browser suite in tests/browser serially (they share one Chrome
// and Big Mac, so they never run in parallel), then writes a machine-readable receipt. Each browser suite starts its own
// private-port server with an isolated DEX_STATE_DIR (tests/browser/helpers.js), so the live console's jobs, queues and
// media records are never read or rewritten. The interaction matrix writes into a fresh directory, never output/rev19.
//
//   DEX_RELEASE_ONLY=a,b    run only these browser suites (basename without .browser.js)
//   DEX_RELEASE_SKIP_UNIT=1 skip check + unit (browser only)
// Exit code 0 only if every step passed. Nothing here generates on Big Mac: suites stub activation/generation POSTs.
const { spawnSync } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');
const { resolveOutputDir, createOwnedWriter } = require('./browser/safe-output');

const CONSOLE = path.join(__dirname, '..');
const BROWSER_DIR = path.join(__dirname, 'browser');
const only = (process.env.DEX_RELEASE_ONLY || '').split(',').filter(Boolean);
const suites = fs.readdirSync(BROWSER_DIR).filter(f => f.endsWith('.browser.js')).map(f => f.replace(/\.browser\.js$/, ''))
  .filter(s => !only.length || only.includes(s)).sort();
const out = resolveOutputDir(process.env.DEX_RELEASE_OUTPUT_DIR, { label: 'release-gate' });
const writer = createOwnedWriter(out);
const steps = [];

function run(name, cmd, args, env = {}) {
  const t0 = Date.now();
  const r = spawnSync(cmd, args, { cwd: CONSOLE, env: Object.assign({}, process.env, env), encoding: 'utf8', maxBuffer: 256 * 1024 * 1024 });
  const log = (r.stdout || '') + (r.stderr || '');
  const logPath = writer.write(name.replace(/[^a-z0-9.-]+/gi, '_') + '.log', log);
  // Browser suites log "[suite +t] PASS|FAIL title"; the interaction matrix logs "<variant>/<size>/<screen> PASS|FAIL|BLOCKED".
  const pass = (log.match(/^\[[^\]]+\] PASS |^(?!\[)[^\n]*\/[^\n]*\/[^\n]* PASS\s*$/gm) || []).length;
  const fail = (log.match(/^\[[^\]]+\] FAIL |^(?!\[)[^\n]*\/[^\n]*\/[^\n]* (?:FAIL|BLOCKED)\s*$/gm) || []).length;
  const step = { name, status: r.status === 0 ? 'PASS' : 'FAIL', exit: r.status, signal: r.signal || null, seconds: Math.round((Date.now() - t0) / 100) / 10, log: logPath };
  const tally = /ℹ tests (\d+)[\s\S]*?ℹ pass (\d+)[\s\S]*?ℹ fail (\d+)/.exec(log);
  if (tally) Object.assign(step, { tests: +tally[1], passed: +tally[2], failed: +tally[3] });
  else Object.assign(step, { passed: pass, failed: fail });
  steps.push(step);
  console.log(`${step.status.padEnd(4)} ${name}  (${step.seconds}s${step.tests != null ? `, ${step.passed}/${step.tests}` : `, pass ${step.passed} fail ${step.failed}`})`);
  return step;
}

if (process.env.DEX_RELEASE_SKIP_UNIT !== '1') {
  run('check', process.execPath, ['--check', 'server.js']);
  run('unit', process.execPath, ['--test', ...fs.readdirSync(__dirname).filter(f => f.endsWith('.test.js')).map(f => path.join('tests', f))]);
}
for (const s of suites) {
  const env = { DEX_BROWSER_OUTPUT_DIR: path.join(out, s) };
  if (s === 'interaction-matrix') env.DEX_MATRIX_OUTPUT_DIR = path.join(out, s);
  run('browser:' + s, process.execPath, [path.join('tests', 'browser', s + '.browser.js')], env);
}

let gitHead = null;
try { gitHead = spawnSync('git', ['rev-parse', 'HEAD'], { cwd: CONSOLE, encoding: 'utf8' }).stdout.trim(); } catch (_) {}
const dirty = spawnSync('git', ['status', '--porcelain', '--untracked-files=no'], { cwd: CONSOLE, encoding: 'utf8' }).stdout.trim().split('\n').filter(Boolean).length;
const receipt = {
  schema: 'dexdiffusion.release-gate.v1', at: new Date().toISOString(), gitHead, trackedFilesModified: dirty,
  scope: 'syntax + unit + every tests/browser/*.browser.js suite; mocked/static/browser only — NOT live inference proof',
  verdict: steps.every(s => s.status === 'PASS') ? 'PASS' : 'FAIL', steps,
};
const receiptPath = writer.write('release-gate.json', JSON.stringify(receipt, null, 2) + '\n');
console.log(`\nRELEASE GATE ${receipt.verdict} — ${steps.filter(s => s.status === 'PASS').length}/${steps.length} steps. Receipt: ${receiptPath}`);
process.exit(receipt.verdict === 'PASS' ? 0 : 1);
