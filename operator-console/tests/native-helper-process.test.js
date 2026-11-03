'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const cp = require('node:child_process');

const root = path.resolve(__dirname, '../..');
const helper = path.join(root, 'scripts/bounded-command.py');
const native = fs.readFileSync(path.join(root, 'native/macos/Image_Gen/ImageGenApp.swift'), 'utf8');

test('Swift wrapper routes shell work through the tested bounded process-group helper', () => {
  assert.match(native, /process\.executableURL = URL\(fileURLWithPath: "\/usr\/bin\/python3"\)/);
  assert.match(native, /scripts\/bounded-command\.py/);
  assert.match(native, /\.now\(\) \+ timeout \+ 2/);
});

test('DD-09 helper combines verbose output, bounds capture, and returns the child exit status', () => {
  const result = cp.spawnSync('/usr/bin/python3', [helper, '--timeout', '3', '--output-limit', '1024', '--', "printf 'out\\n'; printf 'err\\n' >&2; exit 7"], { encoding: 'utf8', timeout: 5000 });
  assert.equal(result.status, 7, result.stderr); assert.match(result.stdout, /out\nerr/);
  const verbose = cp.spawnSync('/usr/bin/python3', [helper, '--timeout', '3', '--output-limit', '1024', '--', "/usr/bin/python3 -c 'print(\"x\" * 10000)'"], { encoding: 'utf8', timeout: 5000 });
  assert.equal(verbose.status, 0, verbose.stderr); assert.ok(verbose.stdout.length < 1200); assert.match(verbose.stdout, /output truncated/);
});

test('DD-09 timeout kills the owned child process group and returns a bounded timeout result', async t => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'dex-helper-timeout-')); t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const pidFile = path.join(dir, 'child.pid');
  const command = `/bin/bash -c 'trap "" TERM; /bin/sleep 30 & echo $! > "${pidFile}"; wait'`;
  const result = cp.spawnSync('/usr/bin/python3', [helper, '--timeout', '0.25', '--output-limit', '1024', '--', command], { encoding: 'utf8', timeout: 5000 });
  assert.equal(result.status, 124, result.stderr); assert.match(result.stdout, /Timed out:/);
  const childPid = Number(fs.readFileSync(pidFile, 'utf8').trim()); assert.ok(childPid > 1);
  for (let i = 0; i < 20; i++) {
    try { process.kill(childPid, 0); } catch (error) { if (error.code === 'ESRCH') return; throw error; }
    await new Promise(resolve => setTimeout(resolve, 50));
  }
  assert.fail(`owned child ${childPid} still exists after timeout cleanup`);
});
