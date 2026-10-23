'use strict';
// bin/dexdiffusion status must never hang on a stuck dependency, and a dependency that times out must be reported as UNKNOWN —
// never as down, absent, "not configured" or stopped. Fake dependencies are put first on PATH (DEX_PATH_PREPEND, test-only).

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');
const { spawnSync } = require('node:child_process');

const ROOT = path.join(__dirname, '..', '..');
const BIN = path.join(ROOT, 'bin', 'dexdiffusion');
const UNREACHABLE = 'dexdiffusion-test-unreachable.invalid';

function alive(pid) { try { process.kill(pid, 0); return true; } catch { return false; } }

function fixture(t) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'dex-status-fakes-'));
  const bindir = path.join(dir, 'bin'); fs.mkdirSync(bindir);
  t.after(() => {
    // Process-scoped cleanup: only pids the fakes themselves recorded.
    for (const f of fs.readdirSync(dir).filter(n => n.endsWith('.pid'))) {
      const pid = Number(fs.readFileSync(path.join(dir, f), 'utf8').trim());
      if (pid > 1 && alive(pid)) { try { process.kill(pid, 'SIGKILL'); } catch {} }
    }
    fs.rmSync(dir, { recursive: true, force: true });
  });
  const hang = name => {
    // Records its own pid and a long-running child's pid, then blocks far longer than any probe bound.
    fs.writeFileSync(path.join(bindir, name), `#!/bin/sh\necho $$ > "${dir}/${name}.pid"\nsleep 600 &\necho $! > "${dir}/${name}.child.pid"\nwait\n`, { mode: 0o755 });
  };
  const script = (name, body) => fs.writeFileSync(path.join(bindir, name), `#!/bin/sh\n${body}\n`, { mode: 0o755 });
  const pids = name => ['', '.child'].map(s => Number(fs.readFileSync(path.join(dir, `${name}${s}.pid`), 'utf8').trim()));
  return { dir, bindir, hang, script, pids };
}

function status(fx, env = {}) {
  const started = Date.now();
  const r = spawnSync(BIN, ['status'], {
    encoding: 'utf8', timeout: 60000,
    env: { ...process.env, DEX_PORT: '1', DEX_SSH_TARGET: UNREACHABLE, DEX_PROBE_TIMEOUT: '1', DEX_PATH_PREPEND: fx.bindir, ...env },
  });
  return { out: r.stdout, code: r.status, seconds: (Date.now() - started) / 1000, stderr: r.stderr };
}

test('a hanging tailscale is bounded, reported unknown (not "not configured"), and its process group is reaped', t => {
  const fx = fixture(t); fx.hang('tailscale');
  const r = status(fx);
  assert.equal(r.code, 0, r.stderr);
  assert.ok(r.seconds < 25, `status returned in ${r.seconds}s`);
  assert.match(r.out, /tailnet:\s+unknown \(tailscale probe timed out\)/);
  assert.doesNotMatch(r.out, /tailnet:\s+not configured/);
  for (const pid of fx.pids('tailscale')) assert.equal(alive(pid), false, `fake tailscale process ${pid} was reaped`);
});

test('a hanging lsof reports the web status as UNKNOWN, never DOWN', t => {
  const fx = fixture(t); fx.hang('lsof');
  const r = status(fx);
  assert.equal(r.code, 0, r.stderr);
  assert.match(r.out, /status:\s+UNKNOWN \(port probe timed out\)/);
  assert.doesNotMatch(r.out, /status:\s+DOWN/);
  assert.match(r.out, /bind:\s+unknown \(probe timed out\)/);
  for (const pid of fx.pids('lsof')) assert.equal(alive(pid), false, `fake lsof process ${pid} was reaped`);
});

test('a hanging dock query reports the dock as UNKNOWN, never MISSING', t => {
  const fx = fixture(t); fx.hang('defaults');
  const r = status(fx);
  assert.equal(r.code, 0, r.stderr);
  assert.match(r.out, /dock:\s+UNKNOWN \(dock probe timed out\)/);
  assert.doesNotMatch(r.out, /dock:\s+MISSING/);
  for (const pid of fx.pids('defaults')) assert.equal(alive(pid), false, `fake defaults process ${pid} was reaped`);
});

test('a hanging ssh reports Big Mac as UNKNOWN, never DOWN', t => {
  const fx = fixture(t); fx.hang('ssh');
  const r = status(fx);
  assert.equal(r.code, 0, r.stderr);
  assert.match(r.out, new RegExp(`Big Mac:\\s+ssh ${UNREACHABLE.replace(/\./g, '\\.')} — UNKNOWN \\(probe timed out\\)`));
  assert.doesNotMatch(r.out, /Big Mac:.*— DOWN/);
  for (const pid of fx.pids('ssh')) assert.equal(alive(pid), false, `fake ssh process ${pid} was reaped`);
});

test('healthy dependencies keep their truthful results, and no GNU timeout is needed', t => {
  const fx = fixture(t);
  // A `timeout` that always fails: if the script depended on it, every bounded probe below would break.
  fx.script('timeout', 'exit 99');
  fx.script('tailscale', `cat <<'EOF'
{"Web":{"fake.ts.net:8443":{"Handlers":{"/":{"Proxy":"http://127.0.0.1:31337"}}}},"AllowFunnel":{}}
EOF`);
  fx.script('lsof', 'exit 1');   // nothing listening: genuinely down
  const r = status(fx);
  assert.equal(r.code, 0, r.stderr);
  assert.match(r.out, /tailnet:\s+https:\/\/fake\.ts\.net:8443\/dexdiffusion\//);
  assert.match(r.out, /serve:\s+tailnet-only/);
  assert.match(r.out, /status:\s+DOWN/);
  assert.match(r.out, /Big Mac:\s+ssh [^ ]+ — DOWN/);
});

test('the bound is enforced without an unbounded fallback', () => {
  const src = fs.readFileSync(BIN, 'utf8');
  assert.match(src, /command -v perl[^\n]*\|\| return 125/);   // no perl: the command is not run at all
  assert.doesNotMatch(src, /^\s*(?:[a-z_]+="\$\()?\s*timeout\s/m);
  for (const cmd of ['lsof', 'tailscale serve status', 'defaults read', 'ssh -o BatchMode']) {
    assert.match(src, new RegExp(`bounded [^\\n]*${cmd}`), `${cmd} runs under bounded()`);
  }
});
