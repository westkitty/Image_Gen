'use strict';
// Phase 4C: isolated automated-test safety mode. Proves, with fake transports only, that a console started for a test
// cannot act on Big Mac, a model selection, a service or Ollama, even when a browser fixture is missing.
// Nothing here may reach a real host: the only SSH target used is an RFC 2606 '.invalid' name, and it is refused
// before resolution anyway.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const net = require('node:net');
const http = require('node:http');
const util = require('node:util');
const { spawnSync, spawn: realSpawn } = require('node:child_process');
const T = require('../test-isolation');

const CONSOLE = path.join(__dirname, '..');
const WORKFLOW = path.join(CONSOLE, '..', 'sdcpp-workflow');
const NOWHERE = 'dex-isolation-test.invalid';
const INITIAL_TEST_PATH = process.env.PATH; // before this test installs its isolation PATH shim

test('classify: remote, service and workflow commands are refused; local tools are not', () => {
  const blocked = [
    ['ssh', ['-o', 'BatchMode=yes', NOWHERE, 'true']], ['/usr/bin/ssh', []], ['scp', []], ['rsync', []], ['sftp', []],
    ['launchctl', ['bootout']], ['tailscale', ['serve']], ['ollama', ['run', 'gemma3:4b']], ['osascript', []], ['pkill', []], ['killall', []],
    [path.join(WORKFLOW, 'bin', 'sdcpp-server-stop.sh'), []], [path.join(WORKFLOW, 'bin', 'sdcpp-secondary-slot.sh'), ['activate', 'sdxl-base']],
    ['bash', [path.join(WORKFLOW, 'bin', 'sdcpp-secondary-slot.sh'), 'activate']], ['bash', ['-c', `ssh ${NOWHERE} true`]],
    ['sh', ['-c', 'echo x && launchctl kickstart foo']], ['env', ['A=1', 'ssh', NOWHERE]], ['node', [path.join(CONSOLE, 'bin', 'local-engine-generate.js')]],
  ];
  for (const [f, a] of blocked) assert.ok(T.classify(f, a), JSON.stringify([f, a]));
  // runAction spawns 'bin/…' relative to the workflow root.
  assert.deepEqual(T.classify('bin/sdcpp-server-stop.sh', [], WORKFLOW), { command: 'sdcpp-workflow/bin/sdcpp-server-stop.sh', reason: 'workflow-script' });
  for (const [f, a] of [['ffmpeg', ['-i', 'x']], ['ffprobe', []], ['python3', ['-c', 'print(1)']], ['git', ['rev-parse', 'HEAD']], [process.execPath, ['-e', '1']], ['bash', ['-c', 'echo hello']], ['bin/x.sh', []]]) {
    assert.equal(T.classify(f, a, os.tmpdir()), null, JSON.stringify([f, a]));
  }
  assert.ok(T.classifyShell(`cd /tmp && ssh ${NOWHERE} 'rm -rf x'`));
  assert.equal(T.classifyShell('ffmpeg -i a.wav b.wav'), null);
});

test('outside isolated mode install() changes nothing (production)', () => {
  const r = spawnSync(process.execPath, ['-e', `
    const cp = require('child_process'); const before = [cp.spawn, cp.execFile, cp.execFileSync, cp.exec, cp.spawnSync, cp.fork, globalThis.fetch];
    const res = require(${JSON.stringify(path.join(CONSOLE, 'test-isolation.js'))}).install();
    const after = [cp.spawn, cp.execFile, cp.execFileSync, cp.exec, cp.spawnSync, cp.fork, globalThis.fetch];
    console.log(JSON.stringify({ res, same: before.every((f, i) => f === after[i]), path: process.env.PATH === ${JSON.stringify(process.env.PATH)} }));`],
  { env: Object.assign({}, process.env, { DEX_TEST_ISOLATION: '' }), encoding: 'utf8' });
  assert.equal(r.status, 0, r.stderr);
  assert.deepEqual(JSON.parse(r.stdout), { res: { enabled: false, installed: false }, same: true, path: true });
});

// Everything below runs with the guard installed in this test process.
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'dex-isolation-unit-'));
const VIOL = path.join(dir, 'violations.jsonl');
process.env.DEX_TEST_ISOLATION = '1';
process.env.DEX_TEST_VIOLATIONS_FILE = VIOL;
fs.writeFileSync(VIOL, '');
const installed = T.install();
const cp = require('node:child_process');
const CANARY = 'ARGCANARY-' + Date.now();
const lastViolation = () => T.readViolations(VIOL).at(-1);

test('every child_process entry point refuses SSH and workflow scripts without launching anything', async () => {
  assert.equal(installed.enabled, true);
  // execFile with callback, the shape every remote helper uses.
  const r = await new Promise(res => { const c = cp.execFile('ssh', ['-o', 'BatchMode=yes', NOWHERE, CANARY], { encoding: 'utf8' }, (err, so, se) => res({ c, err, so, se })); });
  assert.equal(r.err.code, T.BLOCKED_EXIT);
  assert.equal(r.err.dexTestIsolation, true);
  assert.match(r.se, /DEX_TEST_ISOLATION: ssh is blocked/);
  assert.equal(r.c.pid, undefined, 'no process was started');
  // promisify(execFile) (asset3d-bridge, world-bridge) rejects with stdout/stderr like the real one.
  await assert.rejects(util.promisify(cp.execFile)('scp', ['-q', 'a', `${NOWHERE}:b`]), e => e.code === T.BLOCKED_EXIT && /scp is blocked/.test(String(e.stderr)));
  // spawn: a fake child that exits 97 with the refusal on stderr.
  const child = cp.spawn('bin/sdcpp-secondary-slot.sh', ['activate', 'sdxl-base'], { cwd: WORKFLOW });
  let err = ''; child.stderr.on('data', d => { err += d; });
  const [code] = await new Promise(res => child.on('close', (...a) => res(a)));
  assert.equal(code, T.BLOCKED_EXIT);
  assert.match(err, /sdcpp-secondary-slot\.sh is blocked/);
  assert.throws(() => cp.execFileSync('ssh', [NOWHERE, 'true']), e => e.status === T.BLOCKED_EXIT);
  assert.throws(() => cp.execSync(`ssh ${NOWHERE} true`), e => e.status === T.BLOCKED_EXIT);
  assert.equal(cp.spawnSync('launchctl', ['list']).status, T.BLOCKED_EXIT);
  const ex = await new Promise(res => cp.exec(`rsync -a x ${NOWHERE}:y`, (e) => res(e)));
  assert.equal(ex.code, T.BLOCKED_EXIT);
  assert.equal(cp.fork(path.join(CONSOLE, 'bin', 'local-engine-generate.js')).pid, undefined);
  // Records carry the command name and origin only, never arguments.
  const all = T.readViolations(VIOL);
  assert.ok(all.length >= 8);
  assert.ok(all.every(v => v.origin === 'background' && v.fatal === false));
  assert.ok(!fs.readFileSync(VIOL, 'utf8').includes(CANARY));
});

test('allowed local tools still run for real', () => {
  const r = cp.spawnSync(process.execPath, ['-e', 'process.stdout.write("local-ok")'], { encoding: 'utf8' });
  assert.equal(r.status, 0);
  assert.equal(r.stdout, 'local-ok');
  assert.equal(cp.execFileSync('sh', ['-c', 'echo shell-ok'], { encoding: 'utf8' }).trim(), 'shell-ok');
});

test('PATH shim: a grandchild script that calls ssh gets the refusing stub, never the real client', () => {
  const script = path.join(dir, 'indirect.sh');
  fs.writeFileSync(script, `#!/bin/sh\nssh -o BatchMode=yes ${NOWHERE} true 2>/dev/null\necho "rc=$?"\ncommand -v ssh\n`, { mode: 0o755 });
  const r = cp.spawnSync('sh', [script], { encoding: 'utf8' });
  assert.match(r.stdout, /rc=97/);
  assert.match(r.stdout.trim().split('\n').pop(), /dex-test-isolation-.*\/ssh$/);
  assert.equal(lastViolation().kind, 'subprocess');
  assert.equal(lastViolation().command, 'ssh');
});

test('request context: a refusal caused by a state-changing request is fatal and names the route', async () => {
  await new Promise(resolve => T._als.run({ method: 'POST', path: '/api/models/secondary/activate' }, () => {
    cp.execFile(path.join(WORKFLOW, 'bin', 'sdcpp-server-stop.sh'), [], { cwd: WORKFLOW }, () => resolve());
  }));
  assert.deepEqual((({ command, reason, origin, fatal }) => ({ command, reason, origin, fatal }))(lastViolation()),
    { command: 'sdcpp-workflow/bin/sdcpp-server-stop.sh', reason: 'workflow-script', origin: 'POST /api/models/secondary/activate', fatal: true });
  T._als.run({ method: 'GET', path: '/api/doctor' }, () => cp.spawnSync('ssh', [NOWHERE, 'true']));
  assert.equal(lastViolation().fatal, false, 'a refused read probe is recorded but not fatal');
});

test('fetch guard: non-GET requests to the Ollama forward ports are refused locally', async () => {
  const r = await fetch('http://127.0.0.1:11436/api/version', { method: 'POST', body: '{}' });
  assert.equal(r.status, 423);
  assert.deepEqual(await r.json(), { error: 'Blocked in isolated test mode', gate: 'test-isolation' });
  assert.equal(lastViolation().reason, 'ollama-mutation');
});

test('route guard: Big Mac, model, service and Ollama routes answer 423 before any handler runs', async () => {
  const express = require('express');
  const app = express();
  app.use(T.middleware);
  app.use(express.json());
  const reached = [];
  app.post('/api/models/secondary/activate', (req, res) => { reached.push('activate'); res.json({ ok: true }); });
  app.post('/api/actions/server-stop', (req, res) => { reached.push('server-stop'); res.json({ ok: true }); });
  app.post('/api/ollama/enhance', (req, res) => { reached.push('enhance'); res.json({ ok: true }); });
  app.post('/api/recipes', (req, res) => { reached.push('recipes'); res.json({ ok: true }); });
  app.post('/api/actions/generate-controlled', (req, res) => {
    // An ordinary route whose handler would launch a workflow script: the process guard refuses it, fatally.
    const c = cp.spawn('bin/sdcpp-generate-controlled.sh', [], { cwd: WORKFLOW });
    c.on('close', code => res.status(500).json({ code }));
  });
  app.get('/api/assets', (req, res) => res.json({ ok: true }));
  const server = await new Promise(r => { const s = app.listen(0, '127.0.0.1', () => r(s)); });
  const base = `http://127.0.0.1:${server.address().port}`;
  const post = (p, body = {}) => fetch(base + p, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }).then(async r => ({ status: r.status, body: await r.json() }));
  try {
    for (const p of ['/api/models/secondary/activate', '/api/actions/server-stop', '/api/ollama/enhance']) {
      const r = await post(p, { target: 'sdxl-base' });
      assert.equal(r.status, 423, p);
      assert.equal(r.body.gate, 'test-isolation');
      assert.equal(r.body.route, 'POST ' + p);
      assert.equal(lastViolation().fatal, true);
    }
    assert.deepEqual(reached, [], 'no protected handler ran');
    assert.deepEqual(await post('/api/recipes', { name: 'x' }), { status: 200, body: { ok: true } }, 'ordinary local routes are untouched');
    assert.equal((await fetch(base + '/api/assets')).status, 200);
    const g = await post('/api/actions/generate-controlled', {});
    assert.deepEqual(g, { status: 500, body: { code: T.BLOCKED_EXIT } });
    assert.deepEqual((({ command, origin, fatal }) => ({ command, origin, fatal }))(lastViolation()), { command: 'sdcpp-workflow/bin/sdcpp-generate-controlled.sh', origin: 'POST /api/actions/generate-controlled', fatal: true });
  } finally { server.close(); }
});

// ── The real server.js in isolated mode (as the browser harness starts it) ────────────────────────
const freePort = () => new Promise((resolve, reject) => { const s = net.createServer(); s.listen(0, '127.0.0.1', () => { const p = s.address().port; s.close(() => resolve(p)); }); s.on('error', reject); });
async function boot(extraEnv) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'dex-isolation-server-'));
  for (const d of ['state', 'images', 'media', 'bin']) fs.mkdirSync(path.join(root, d));
  // Belt and braces for this test: even the server's own PATH starts with a refusing ssh.
  fs.writeFileSync(path.join(root, 'bin', 'ssh'), '#!/bin/sh\nexit 255\n', { mode: 0o755 });
  // The non-isolated /api/version negative control must not invoke a real local Ollama.
  fs.writeFileSync(path.join(root, 'bin', 'ollama'), '#!/bin/sh\nexit 127\n', { mode: 0o755 });
  const port = await freePort();
  const violations = path.join(root, 'violations.jsonl'); fs.writeFileSync(violations, '');
  const env = Object.assign({}, process.env, {
    PATH: path.join(root, 'bin') + path.delimiter + (extraEnv.DEX_TEST_ISOLATION === '' ? INITIAL_TEST_PATH : process.env.PATH), OPERATOR_CONSOLE_PORT: String(port), OLLAMA_BASE_URL: 'http://127.0.0.1:9',
    DEX_STATE_DIR: path.join(root, 'state'), DEX_IMAGES_ROOT_OVERRIDE: path.join(root, 'images'), DEX_MEDIA_ROOT_OVERRIDE: path.join(root, 'media'),
    DEX_TEST_VIOLATIONS_FILE: violations,
  }, extraEnv);
  const child = realSpawn(process.execPath, ['server.js'], { cwd: CONSOLE, env, stdio: ['ignore', 'pipe', 'pipe'] });
  let out = ''; child.stdout.on('data', c => { out += c; }); child.stderr.on('data', c => { out += c; });
  const t0 = Date.now();
  for (;;) {
    try { const r = await fetch(`http://127.0.0.1:${port}/api/version`); if (r.ok) break; } catch (_) {}
    if (child.exitCode !== null || Date.now() - t0 > 60000) throw new Error('server did not start: ' + out.slice(-1500));
    await new Promise(r => setTimeout(r, 100));
  }
  const runsBefore = fs.existsSync(path.join(WORKFLOW, 'runs')) ? fs.readdirSync(path.join(WORKFLOW, 'runs')) : [];
  const stop = async () => { child.kill('SIGTERM'); await new Promise(r => setTimeout(r, 300)); fs.rmSync(root, { recursive: true, force: true }); };
  return { base: `http://127.0.0.1:${port}`, violations, runsBefore, stop, output: () => out };
}

test('real server in isolated mode: the incident request is refused with no script run and a fatal record', { timeout: 120000 }, async () => {
  const s = await boot({ DEX_TEST_ISOLATION: '1' });
  try {
    const ver = await fetch(s.base + '/api/version').then(r => r.json());
    assert.equal(ver.testIsolation, true);
    const r = await fetch(s.base + '/api/models/secondary/activate', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ target: 'sdxl-base' }) });
    assert.equal(r.status, 423);
    assert.deepEqual(await r.json(), { error: 'Blocked in isolated test mode: this request would act on Big Mac, a model selection, a service or Ollama. Use a browser fixture.', gate: 'test-isolation', route: 'POST /api/models/secondary/activate' });
    const stop = await fetch(s.base + '/api/actions/server-stop', { method: 'POST' });
    assert.equal(stop.status, 423);
    const fatal = T.readViolations(s.violations).filter(v => v.fatal);
    assert.deepEqual(fatal.map(v => v.command), ['POST /api/models/secondary/activate', 'POST /api/actions/server-stop']);
    const runsAfter = fs.existsSync(path.join(WORKFLOW, 'runs')) ? fs.readdirSync(path.join(WORKFLOW, 'runs')) : [];
    assert.deepEqual(runsAfter.filter(x => !s.runsBefore.includes(x)), [], 'no server-stop (or any) run was created');
    assert.equal((await fetch(s.base + '/api/capabilities')).status, 200, 'read-only routes still work');
  } finally { await s.stop(); }
});

test('real server without the flag: /api/version keeps its production shape (no test field)', { timeout: 120000 }, async () => {
  const s = await boot({ DEX_TEST_ISOLATION: '' });
  try {
    const ver = await fetch(s.base + '/api/version').then(r => r.json());
    assert.equal('testIsolation' in ver, false);
    const unexpected = T.readViolations(s.violations);
    assert.equal(unexpected.length, 0, 'non-isolated server must not record test violations: ' + JSON.stringify(unexpected));
  } finally { await s.stop(); }
});

test('harness: a suite that omits the activation fixture fails, while a read-only suite passes', { timeout: 180000 }, () => {
  const run = mode => {
    const env = Object.assign({}, process.env, { OLLAMA_BASE_URL: 'http://127.0.0.1:9' });
    delete env.DEX_TEST_ISOLATION; delete env.DEX_TEST_VIOLATIONS_FILE;   // the harness must set them itself
    return spawnSync(process.execPath, [path.join(__dirname, 'fixtures', 'isolation-suite-probe.js'), mode], { cwd: CONSOLE, env, encoding: 'utf8', timeout: 150000 });
  };
  const omit = run('omit');
  assert.match(omit.stdout, /PROBE_STATUS 423 .*"gate":"test-isolation"/, omit.stdout + omit.stderr);
  assert.match(omit.stdout, /PROBE_FATAL 1/);
  assert.match(omit.stderr, /SUITE FAILED: 1 request-caused remote\/model\/service operation\(s\) were refused/);
  assert.match(omit.stderr, /"origin":"POST \/api\/models\/secondary\/activate"/);
  assert.equal(omit.status, 1, 'the omitted fixture is an observable failure');
  const read = run('read');
  assert.match(read.stdout, /PROBE_STATUS 200/);
  assert.equal(read.status, 0, read.stderr.slice(-800));
});

test('isolated mode replaces the SSH asset probe with a labelled simulation (no host is contacted)', () => {
  const p = T.simulatedAssetProbe({ targetModels: { a: '/x/a.safetensors', b: '/x/a.safetensors' }, dormantKeys: ['kokoro:runtime:python', 'ltx-video:runtime:python', 'ltx-video:model:weights'], unbridgedWorkerIds: ['ltx-video'] });
  assert.equal(p.simulated, 'test-isolation');
  assert.equal(p.identity, 'fixture@isolated-test');
  assert.deepEqual(p.models, { '/x/a.safetensors': true });
  assert.deepEqual(p.dormant, { 'kokoro:runtime:python': true, 'ltx-video:runtime:python': false, 'ltx-video:model:weights': false }, 'a worker with no execution bridge is never simulated as installed');
  // Deterministic: the same input gives the same probe.
  assert.deepEqual(T.simulatedAssetProbe({ dormantKeys: ['a:b'] }), T.simulatedAssetProbe({ dormantKeys: ['a:b'] }));
  assert.equal(p.activeSecondaryModel, null, 'never reports a real secondary-slot state');
  const server = fs.readFileSync(path.join(CONSOLE, 'server.js'), 'utf8');
  assert.match(server, /TestIsolation\.enabled\(\)\s*\? TestIsolation\.simulatedAssetProbe\(/);
});
