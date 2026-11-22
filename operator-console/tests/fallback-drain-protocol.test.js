'use strict';
// Fallback v2: the real internal-fallback backend speaks the owner drain protocol
// (DEX_BACKEND_CONTROL) so its EngineHost owner never has to stop it unsealed.
// Private port, private data root, private control directory; nothing else is touched.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const net = require('node:net');
const http = require('node:http');
const { spawn } = require('node:child_process');
const consoleRoot = path.resolve(process.env.DEX_FALLBACK_TEST_ROOT || path.join(__dirname, '../..'), 'operator-console');
const delay = ms => new Promise(resolve => setTimeout(resolve, ms));

async function unusedPort() {
  const server = net.createServer();
  await new Promise((resolve, reject) => server.once('error', reject).listen(0, '127.0.0.1', resolve));
  const port = server.address().port;
  await new Promise(resolve => server.close(resolve));
  return port;
}
function seal(control) {
  try { return fs.readFileSync(path.join(control, 'idle'), 'utf8'); } catch (_) { return null; }
}
async function until(predicate, ms, what) {
  const deadline = Date.now() + ms;
  while (Date.now() < deadline) { if (await predicate()) return; await delay(100); }
  assert.fail('timed out waiting for ' + what);
}
async function status(url) {
  try { const r = await fetch(url, { signal: AbortSignal.timeout(3000) }); await r.arrayBuffer(); return r.status; }
  catch (_) { return null; }
}

async function boot(t) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'dex-fallback-drain-'));
  const state = path.join(dir, 'root');
  const control = path.join(dir, 'control');
  fs.mkdirSync(state, { mode: 0o700 });
  fs.mkdirSync(control, { mode: 0o700 });
  const port = await unusedPort();
  const env = { PATH: process.env.PATH, HOME: dir, DEX_STORAGE_MODE: 'internal-fallback', DEX_DATA_ROOT: state,
    DEX_IMAGES_ROOT_OVERRIDE: path.join(state, 'images'), DEX_LOCAL_ENGINE_BRIDGE: '0', DEX_CHAT_ENABLED: '0',
    OPERATOR_CONSOLE_PORT: String(port), DEX_BACKEND_CONTROL: control };
  const child = spawn(process.execPath, ['server.js'], { cwd: consoleRoot, env, detached: true, stdio: 'ignore' });
  t.after(async () => {
    if (child.exitCode === null && child.signalCode === null) {
      const exited = new Promise(resolve => child.once('exit', resolve));
      try { process.kill(-child.pid, 'SIGTERM'); } catch (_) {}
      await Promise.race([exited, delay(4000)]);
      if (child.exitCode === null && child.signalCode === null) try { process.kill(-child.pid, 'SIGKILL'); } catch (_) {}
    }
    fs.rmSync(dir, { recursive: true, force: true });
  });
  const base = 'http://127.0.0.1:' + port;
  await until(async () => { assert.equal(child.exitCode, null, 'fallback exited early'); return await status(base + '/api/version') === 200; },
    20000, 'fallback to listen');
  return { base, control, child };
}

test('fallback v2 seals idle for its own pid, fences on drain and reopens when the drain is withdrawn', async t => {
  const { base, control, child } = await boot(t);
  await until(() => seal(control) === `${child.pid} idle\n`, 8000, 'idle seal');
  fs.writeFileSync(path.join(control, 'drain'), '', { mode: 0o600 });
  await until(() => seal(control) === `${child.pid} drained\n`, 8000, 'drained seal');
  assert.equal(await status(base + '/api/version'), 503, 'admission is fenced while draining');
  assert.equal(await status(base + '/api/jobs'), 503);
  fs.unlinkSync(path.join(control, 'drain'));
  await until(async () => await status(base + '/api/version') === 200, 8000, 'admission to reopen');
  await until(() => seal(control) === `${child.pid} idle\n`, 8000, 'idle seal after withdrawal');
});

test('fallback v2 never seals drained while a request it admitted is still in flight', async t => {
  const { base, control, child } = await boot(t);
  await until(() => seal(control) === `${child.pid} idle\n`, 8000, 'idle seal');
  const stream = http.get(base + '/api/events');
  await new Promise((resolve, reject) => stream.once('response', resolve).once('error', reject));
  await until(() => seal(control) === null, 4000, 'seal to be withdrawn by the in-flight request');
  fs.writeFileSync(path.join(control, 'drain'), '', { mode: 0o600 });
  await delay(2000);
  assert.equal(seal(control), null, 'an admitted request blocks the drained seal');
  stream.destroy();
  await until(() => seal(control) === `${child.pid} drained\n`, 8000, 'drained seal once the request finished');
});
