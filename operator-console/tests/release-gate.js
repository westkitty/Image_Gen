'use strict';
// Release / parity gate: `npm run test:release`.
// Runs syntax check, the full unit suite and EVERY browser suite in tests/browser serially (they share one Chrome
// and Big Mac, so they never run in parallel), then writes a machine-readable receipt. Each browser suite starts its own
// private-port server with an isolated DEX_STATE_DIR (tests/browser/helpers.js), so the live console's jobs, queues and
// media records are never read or rewritten. The interaction matrix writes into a fresh directory, never output/rev19.
//
//   DEX_RELEASE_PARTITION=unit|browser|all (default all)
//   DEX_RELEASE_ONLY=a,b    run only these browser suites (basename without .browser.js)
//   DEX_RELEASE_SKIP_UNIT=1 skip check + unit (browser only)
// Exit code 0 only if every step passed. Nothing here generates on Big Mac: suites stub activation/generation POSTs.
const { spawnSync } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');
const { resolveOutputDir, createOwnedWriter } = require('./browser/safe-output');

const CONSOLE = path.join(__dirname, '..');
const BROWSER_DIR = path.join(__dirname, 'browser');
const partition = process.env.DEX_RELEASE_PARTITION || (process.env.DEX_RELEASE_SKIP_UNIT === '1' ? 'browser' : 'all');
if (!['all', 'unit', 'browser'].includes(partition)) throw new Error('Invalid release partition: ' + partition);
const only = (process.env.DEX_RELEASE_ONLY || '').split(',').filter(Boolean);
const available = fs.readdirSync(BROWSER_DIR).filter(f => f.endsWith('.browser.js')).map(f => f.replace(/\.browser\.js$/, '')).sort();
const unknown = only.filter(name => !available.includes(name));
if (unknown.length) throw new Error('Unknown browser suites: ' + unknown.join(', '));
if (partition === 'unit' && only.length) throw new Error('Browser selection requires a browser partition');
const suites = partition === 'unit' ? [] : available.filter(name => !only.length || only.includes(name));
if (partition !== 'unit' && !suites.length) throw new Error('No browser suites selected');
const out = resolveOutputDir(process.env.DEX_RELEASE_OUTPUT_DIR, { label: 'release-gate' });
const writer = createOwnedWriter(out);
const steps = [];
const gitHead = spawnSync('git', ['rev-parse', 'HEAD'], { cwd: CONSOLE, encoding: 'utf8' }).stdout?.trim() || null;
const dirty = (spawnSync('git', ['status', '--porcelain', '--untracked-files=no'], { cwd: CONSOLE, encoding: 'utf8' }).stdout || '')
  .split('\n').filter(Boolean).length;

function writeReceipt(verdict) {
  return writer.write('release-gate.json', JSON.stringify({
    schema: 'dexdiffusion.release-gate.v1', at: new Date().toISOString(), gitHead, trackedFilesModified: dirty,
    scope: 'isolated syntax, unit and/or browser checks; no live inference',
    environment: { platform: process.platform, arch: process.arch, node: process.version },
    selection: { partition, unitAndSyntax: partition !== 'browser', browserSuites: suites },
    verdict, steps,
  }, null, 2) + '\n');
}
writeReceipt('INCOMPLETE');

function run(name, cmd, args, env = {}) {
  const t0 = Date.now();
  const logPath = writer.pathFor(name.replace(/[^a-z0-9.-]+/gi, '_') + '.log');
  const logFd = fs.openSync(logPath, 'w');
  let r;
  try {
    r = spawnSync(cmd, args, {
      cwd: CONSOLE,
      env: Object.assign({}, process.env, env),
      stdio: ['ignore', logFd, logFd],
    });
  } finally {
    fs.closeSync(logFd);
  }
  const log = fs.readFileSync(logPath, 'utf8');
  // Browser suites log "[suite +t] PASS|FAIL title"; the interaction matrix logs "<variant>/<size>/<screen> PASS|FAIL|BLOCKED".
  const pass = (log.match(/^\[[^\]]+\] PASS |^(?!\[)[^\n]*\/[^\n]*\/[^\n]* PASS\s*$/gm) || []).length;
  const fail = (log.match(/^\[[^\]]+\] FAIL |^(?!\[)[^\n]*\/[^\n]*\/[^\n]* (?:FAIL|BLOCKED)(?: [^\r\n]*)?$/gm) || []).length;
  const step = { name, status: r.status === 0 ? 'PASS' : 'FAIL', exit: r.status, signal: r.signal || null, seconds: Math.round((Date.now() - t0) / 100) / 10, log: logPath };
  const tally = /^(?:ℹ|#) tests (\d+)[\s\S]*?^(?:ℹ|#) pass (\d+)[\s\S]*?^(?:ℹ|#) fail (\d+)[\s\S]*?^(?:ℹ|#) skipped (\d+)/m.exec(log);
  if (tally) Object.assign(step, { tests: +tally[1], passed: +tally[2], failed: +tally[3], skipped: +tally[4] });
  else Object.assign(step, { passed: pass, failed: fail });
  if (name === 'unit') {
    step.failures = [...log.matchAll(/^not ok (\d+) - ([^\n]+)\r?\n([\s\S]*?)(?:^\s+\.\.\.$|(?=^# Subtest:))/gm)]
      .map(([, index, test, diagnostic]) => ({
        index: Number(index), test,
        location: /^\s+location:\s+(.+)$/m.exec(diagnostic)?.[1] || null,
        error: /^\s+error:\s+(.+)$/m.exec(diagnostic)?.[1]?.slice(0, 280) || null,
      }));
  }
  steps.push(step);
  writeReceipt('INCOMPLETE');
  if (step.status === 'FAIL' && process.env.CI === 'true') {
    if (step.failures?.length) for (const failure of step.failures) console.error(JSON.stringify({ unitFailure: failure }));
    const lines = log.trimEnd().split('\n');
    const first = lines.findIndex(line => /(?:^|\s)(?:FAIL|BLOCKED|not ok) /.test(line));
    const end = Math.max(0, lines.length - 42);
    if (first >= 0 && first < end) console.error(lines.slice(Math.max(0, first - 3), Math.min(end, first + 20)).join('\n').slice(0, 3500));
    console.error(lines.slice(end).join('\n').slice(-7000));
  }
  console.log(`${step.status.padEnd(4)} ${name}  (${step.seconds}s${step.tests != null ? `, ${step.passed}/${step.tests}` : `, pass ${step.passed} fail ${step.failed}`})`);
  return step;
}

if (partition !== 'browser') {
  run('check', process.execPath, ['--check', 'server.js']);
  run('unit', process.execPath, ['--test', '--test-reporter=tap', '--test-concurrency=1', ...fs.readdirSync(__dirname).filter(f => f.endsWith('.test.js')).map(f => path.join('tests', f))]);
}
for (const s of suites) {
  const env = { DEX_BROWSER_OUTPUT_DIR: path.join(out, s) };
  if (s === 'interaction-matrix') env.DEX_MATRIX_OUTPUT_DIR = path.join(out, s);
  run('browser:' + s, process.execPath, [path.join('tests', 'browser', s + '.browser.js')], env);
}

const verdict = steps.every(s => s.status === 'PASS') ? 'PASS' : 'FAIL';
const receiptPath = writeReceipt(verdict);
console.log(`\nRELEASE GATE ${verdict} — ${steps.filter(s => s.status === 'PASS').length}/${steps.length} steps. Receipt: ${receiptPath}`);
process.exit(verdict === 'PASS' ? 0 : 1);
