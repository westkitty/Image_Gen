'use strict';

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const test = require('node:test');
const assert = require('node:assert/strict');

const installer = path.resolve(__dirname, '../../scripts/install-macos-app.sh');

test('unsupported native installer arguments stop before any installer tool runs', t => {
  const fixture = fs.mkdtempSync(path.join(os.tmpdir(), 'dex-installer-args-'));
  t.after(() => fs.rmSync(fixture, { recursive: true, force: true }));
  const fixtureInstaller = path.join(fixture, 'install-macos-app.sh');
  fs.copyFileSync(installer, fixtureInstaller);
  const shimDir = path.join(fixture, 'bin');
  fs.mkdirSync(shimDir);
  const log = path.join(fixture, 'invocations.log');
  for (const name of ['dirname', 'git', 'shasum', 'cut', 'date', 'swiftc']) {
    const shim = path.join(shimDir, name);
    fs.writeFileSync(shim, `#!/bin/sh\nprintf '%s\\n' '${name}' >> '${log}'\nexit 97\n`, { mode: 0o755 });
  }

  for (const args of [['status'], ['unexpected'], ['status', 'extra']]) {
    const result = spawnSync('/bin/bash', [fixtureInstaller, ...args], {
      encoding: 'utf8',
      env: { ...process.env, PATH: `${shimDir}:/usr/bin:/bin` },
    });
    assert.equal(result.status, 2, `args ${args.join(' ')} should exit with usage error`);
    assert.match(result.stderr, /unsupported installer argument/);
    assert.match(result.stderr, /bin\/dexdiffusion status/);
  }

  assert.equal(fs.existsSync(log), false, 'no path, source, Git, build, or system command ran');
});
