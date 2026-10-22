'use strict';
// Regression gate for fixture scratch that must never accumulate between runs.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const required = [
  'media-finalize-large.test.js',
  'portable-archive.test.js',
  'drama-mixer.test.js',
  'voice-bank.test.js',
  'drama-service-incremental.test.js',
  'drama-master.test.js',
  'drama-service.test.js',
  'derived-store.test.js',
  'drama-render.test.js',
  'voice-production.test.js',
  'helpers/fake-bigmac.js'
];

test('known scratch creators register every new directory for cleanup', () => {
  for (const relative of required) {
    const content = fs.readFileSync(path.join(__dirname, relative), 'utf8');
    const creators = (content.match(/fs\.mkdtempSync\s*\(/g) || []).length;
    const tracked = (content.match(/trackScratch\s*\(\s*fs\.mkdtempSync\s*\(/g) || []).length;
    assert.ok(creators > 0, relative + ' no longer contains the expected fixture');
    assert.equal(tracked, creators, relative + ' creates untracked scratch directories');
  }
});

test('owned scratch fixture is removed when its process explicitly exits', () => {
  const script = [
    "const fs = require('node:fs'), os = require('node:os'), path = require('node:path');",
    "const { trackScratch } = require('./tests/helpers/owned-scratch');",
    "const dir = trackScratch(fs.mkdtempSync(path.join(os.tmpdir(), 'dex-scratch-selftest-')));",
    "process.stdout.write(dir + '\\n');",
    'process.exit(0);'
  ].join('\n');
  const result = spawnSync(process.execPath, ['-e', script], {
    cwd: path.join(__dirname, '..'), encoding: 'utf8', timeout: 10000
  });
  assert.equal(result.status, 0, result.stderr);
  const dir = result.stdout.trim();
  assert.match(path.basename(dir), /^dex-scratch-selftest-/);
  assert.equal(fs.existsSync(dir), false, 'child exit left an owned scratch directory');
});

test('browser suites register an exit fallback for only their own state directories', () => {
  const helper = fs.readFileSync(path.join(__dirname, 'browser', 'helpers.js'), 'utf8');
  assert.match(helper, /ownedSuiteDirs/);
  assert.match(helper, /process\.on\(['"]exit['"]/);
  assert.match(helper, /ownedSuiteDirs\.add\(dir\)/);
});

test('release preflight cannot recursively delete unrelated dex temp directories', () => {
  const script = fs.readFileSync(path.join(__dirname, '..', '..', 'scripts', 'release-preflight.sh'), 'utf8');
  assert.doesNotMatch(script, /-exec\s+rm\s+-rf/);
});

test('release preflight excludes protected Style and wildcard unit files', () => {
  const script = fs.readFileSync(path.join(__dirname, '..', '..', 'scripts', 'release-preflight.sh'), 'utf8');
  assert.match(script, /! -iname '\*style\*'/);
  assert.match(script, /! -iname '\*wildcard\*'/);
});

test('release preflight reserves disk space and bounds unit-test concurrency', () => {
  const script = fs.readFileSync(path.join(__dirname, '..', '..', 'scripts', 'release-preflight.sh'), 'utf8');
  assert.match(script, /DEX_PREFLIGHT_MIN_FREE_KIB/);
  const concurrency = script.match(/--test-concurrency=(\d+)/);
  assert.ok(concurrency, 'the release unit runner must set an explicit concurrency bound');
  assert.ok(Number(concurrency[1]) >= 1 && Number(concurrency[1]) <= 2, 'one or two test files may run; unbounded parallelism is refused');
});

test('release preflight blocks insufficient disk before launching tests', () => {
  const script = path.join(__dirname, '..', '..', 'scripts', 'release-preflight.sh');
  const result = spawnSync('/bin/bash', [script], {
    cwd: path.join(__dirname, '..'),
    env: { ...process.env, DEX_PREFLIGHT_MIN_FREE_KIB: '9999999999', DEX_PREFLIGHT_UNIT_CMD: 'echo SHOULD_NOT_RUN' },
    encoding: 'utf8', timeout: 10000
  });
  assert.equal(result.status, 2, result.stderr);
  assert.match(result.stdout, /disk reserve/);
  assert.doesNotMatch(result.stdout, /SHOULD_NOT_RUN/);
});

test('release preflight isolates and removes its own per-step scratch root', t => {
  const os = require('node:os');
  const own = fs.mkdtempSync(path.join(os.tmpdir(), 'dex-preflight-scope-test-'));
  t.after(() => fs.rmSync(own, { recursive: true, force: true }));
  const marker = path.join(own, 'selected-temp-root.txt');
  const script = path.join(__dirname, '..', '..', 'scripts', 'release-preflight.sh');
  const fakeUnit = [
    'printf "%s" "$TMPDIR" > "$DEX_TEST_MARKER"',
    "printf 'ℹ tests 1\\nℹ pass 1\\nℹ fail 0\\nℹ cancelled 0\\nℹ skipped 0\\n'"
  ].join('; ');
  const result = spawnSync('/bin/bash', [script], {
    cwd: path.join(__dirname, '..'),
    env: { ...process.env, DEX_PREFLIGHT_UNIT_CMD: fakeUnit, DEX_PREFLIGHT_SKIP_CHECK: '1',
      DEX_PREFLIGHT_UNIT_ONLY: '1', DEX_PREFLIGHT_MIN_FREE_KIB: '0', DEX_TEST_MARKER: marker },
    encoding: 'utf8', timeout: 12000
  });
  assert.equal(result.status, 0, result.stdout + result.stderr);
  const scratch = fs.readFileSync(marker, 'utf8');
  assert.match(path.basename(scratch), /^scratch-unit$/);
  assert.equal(fs.existsSync(scratch), false, 'preflight left its run-owned scratch directory');
});

test('release preflight excludes protected wildcard browser suites', () => {
  const script = fs.readFileSync(path.join(__dirname, '..', '..', 'scripts', 'release-preflight.sh'), 'utf8');
  assert.match(script, /grep -Evi 'style\|wildcard'/);
  assert.match(script, /\*\[Ww\]\[Ii\]\[Ll\]\[Dd\]\[Cc\]\[Aa\]\[Rr\]\[Dd\]\*/);
});

test('preflight SIGTERM stops its own unit child and reclaims owned scratch', { timeout: 12000 }, async t => {
  const { spawn } = require('node:child_process');
  const os = require('node:os');
  const { setTimeout: delay } = require('node:timers/promises');
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'dex-preflight-signal-test-'));
  const childPidFile = path.join(root, 'unit-child.pid');
  let unitPid = 0;
  const script = path.resolve(__dirname, '..', '..', 'scripts', 'release-preflight.sh');
  const proc = spawn('/bin/bash', [script], {
    cwd: path.join(__dirname, '..'),
    env: {
      ...process.env, TMPDIR: root, DEX_PREFLIGHT_SKIP_CHECK: '1',
      DEX_PREFLIGHT_UNIT_ONLY: '1', DEX_PREFLIGHT_MIN_FREE_KIB: '0',
      DEX_CHILD_PIDFILE: childPidFile,
      DEX_PREFLIGHT_UNIT_CMD: 'printf "%s" "$$" > "$DEX_CHILD_PIDFILE"; exec sleep 30'
    }, stdio: 'ignore'
  });
  t.after(() => {
    if (unitPid) { try { process.kill(unitPid, 'SIGTERM'); } catch (_) {} }
    if (proc.exitCode === null && proc.signalCode === null) { try { proc.kill('SIGTERM'); } catch (_) {} }
    fs.rmSync(root, { recursive: true, force: true });
  });
  const exited = new Promise(resolve => proc.once('exit', (code, signal) => resolve({ code, signal })));
  for (let i = 0; i < 100 && !fs.existsSync(childPidFile); i++) await delay(40);
  assert.ok(fs.existsSync(childPidFile), 'preflight never started its owned unit child');
  unitPid = Number(fs.readFileSync(childPidFile, 'utf8'));
  assert.ok(Number.isSafeInteger(unitPid) && unitPid > 0);
  proc.kill('SIGTERM');
  await Promise.race([exited, delay(3000).then(() => { throw new Error('preflight ignored SIGTERM'); })]);
  await delay(100);
  let running = false;
  try { process.kill(unitPid, 0); running = true; } catch (err) { if (err.code !== 'ESRCH') throw err; }
  assert.equal(running, false, 'preflight orphaned its unit child after SIGTERM');
  const runs = fs.readdirSync(root).filter(name => name.startsWith('dex-preflight-'));
  assert.equal(runs.length, 1);
  assert.equal(fs.existsSync(path.join(root, runs[0], 'scratch-unit')), false, 'owned scratch survived SIGTERM');
});
