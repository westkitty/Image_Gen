'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const cp = require('node:child_process');

const root = path.resolve(__dirname, '../..');
const appSource = fs.readFileSync(path.join(root, 'native/macos/Image_Gen/ImageGenApp.swift'), 'utf8');
const fixture = path.join(__dirname, 'fixtures/startup-watchdog-policy.swift');

test('DD-03/DD-08 watchdog policy executes two progressing deferrals, then fails boundedly', t => {
  const version = cp.spawnSync('swiftc', ['--version'], { encoding: 'utf8' });
  if (version.error) return t.skip('Swift compiler unavailable');
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'dex-watchdog-test-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const start = appSource.indexOf('enum StartupWatchdogDecision');
  const end = appSource.indexOf('\nprivate final class WeakScriptMessageHandler', start);
  assert.ok(start >= 0 && end > start, 'native app must use the fixture-tested watchdog policy');
  const policy = path.join(dir, 'StartupWatchdogPolicy.swift');
  fs.writeFileSync(policy, appSource.slice(start, end) + '\n');
  const binary = path.join(dir, 'watchdog-policy-test');
  const compile = cp.spawnSync('swiftc', [policy, fixture, '-o', binary], { encoding: 'utf8', timeout: 15000 });
  assert.equal(compile.status, 0, compile.stderr);
  const result = cp.spawnSync(binary, [], { encoding: 'utf8', timeout: 3000 });
  assert.equal(result.status, 0, result.stderr); assert.match(result.stdout, /WATCHDOG_POLICY_PASS/);
});
