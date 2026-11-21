'use strict';
// Emergency rollback variant (baseline 39534f2 API).
// Run the real, non-DEX_TEST_ISOLATION backend with only test-owned data.
// A loopback canary replaces the MacBook endpoint and records any HTTP contact.
// No external models, real MacBook endpoint, installed services or production data are used.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const net = require('node:net');
const http = require('node:http');
const crypto = require('node:crypto');
const { spawn, spawnSync } = require('node:child_process');
const { makePng } = require('./browser/helpers');
const root = path.resolve(process.env.DEX_FALLBACK_TEST_ROOT || path.join(__dirname, '../..'));
const consoleRoot = path.join(root, 'operator-console');
const node = process.execPath;
const imageValidationPython = '/Users/bigmac/Library/Caches/DexDiffusion/mflux/venv/bin/python';
function sourceEnv(extra) {
  const env = { ...process.env };
  for (const key of Object.keys(env)) {
    if (key.startsWith('DEX_') || key.startsWith('OPERATOR_CONSOLE_')) delete env[key];
  }
  delete env.NODE_OPTIONS;
  return { ...env, ...extra };
}
const delay = ms => new Promise(resolve => setTimeout(resolve, ms));
function json(url) {
  return fetch(url, { signal: AbortSignal.timeout(3500) }).then(async r => {
    assert.equal(r.status, 200, url);
    return r.json();
  });
}
async function unusedPort() {
  const server = net.createServer();
  await new Promise((resolve, reject) => server.once('error', reject).listen(0, '127.0.0.1', resolve));
  const port = server.address().port;
  await new Promise(resolve => server.close(resolve));
  return port;
}
async function canary() {
  const requests = [];
  const manifest = { images: {} };
  const server = http.createServer((req, res) => {
    requests.push(req.method + ' ' + req.url);
    res.writeHead(200, { 'content-type': 'application/json' });
    res.end(JSON.stringify(manifest));
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  return { requests, manifest, port: server.address().port, close: () => new Promise(resolve => server.close(resolve)) };
}
async function boot(mode, state, canaryPort, t) {
  const port = await unusedPort();
  const env = sourceEnv({
    DEX_STORAGE_MODE: mode,
    DEX_DATA_ROOT: state,
    DEX_IMAGES_ROOT_OVERRIDE: path.join(state, 'images'),
    DEX_LOCAL_ENGINE_BRIDGE: '0',
    DEX_MACBOOK_IMAGES_URL: 'http://127.0.0.1:' + canaryPort,
    OPERATOR_CONSOLE_PORT: String(port),
    DEX_IMAGE_VALIDATION_PYTHON: imageValidationPython,
  });
  const child = spawn(node, ['server.js'], {
    cwd: consoleRoot, env, detached: true, stdio: 'ignore',
  });
  const stop = async () => {
    if (child.exitCode !== null || child.signalCode !== null) return;
    const exited = new Promise(resolve => child.once('exit', resolve));
    try { process.kill(-child.pid, 'SIGTERM'); } catch (err) { if (err.code !== 'ESRCH') throw err; }
    await Promise.race([exited, delay(2500)]);
    if (child.exitCode === null && child.signalCode === null) {
      try { process.kill(-child.pid, 'SIGKILL'); } catch (err) { if (err.code !== 'ESRCH') throw err; }
      await Promise.race([exited, delay(1000)]);
    }
    assert.notEqual(child.exitCode === null && child.signalCode === null, true, 'test-owned backend terminated');
  };
  t.after(stop);
  const endpoint = 'http://127.0.0.1:' + port;
  const deadline = Date.now() + 14000;
  let version;
  while (Date.now() < deadline) {
    assert.equal(child.exitCode, null, 'test-owned backend exited early');
    try { version = await json(endpoint + '/api/version'); break; }
    catch (_) { await delay(150); }
  }
  assert.ok(version, 'non-isolated backend started on private port');
  assert.equal(version.pid, child.pid);
  assert.equal(version.storage.mode, mode);
  assert.equal(version.storage.root, state);
  assert.equal(version.bind, endpoint);
  return { endpoint, version, stop };
}
function publishWithCLI(state, mode) {
  const runs = path.join(state, 'runs');
  const run = path.join(runs, '20261121-100100-controlled-sd15');
  fs.mkdirSync(run, { recursive: true });
  const src = path.join(state, 'fixture-input.png');
  const png = makePng(48, 32);
  fs.writeFileSync(src, png);
  const env = sourceEnv({
    DEX_STORAGE_MODE: mode,
    DEX_DATA_ROOT: state,
    DEX_IMAGES_ROOT_OVERRIDE: path.join(state, 'images'),
    DEX_IMAGE_VALIDATION_PYTHON: imageValidationPython,
  });
  const result = spawnSync(node, [path.join(consoleRoot, 'bin/canonicalize-image.js'),
    '--source', src, '--run-dir', run, '--run-file', 'fixture-input.png', '--seed', '42'],
  { cwd: consoleRoot, env, timeout: 12000, encoding: 'utf8' });
  assert.equal(result.status, 0, result.stdout + result.stderr);
  const match = result.stdout.match(/CANONICAL_RECORD: ([^\n]+)/);
  assert.ok(match, result.stdout);
  const record = JSON.parse(match[1]);
  const output = path.join(state, 'images', record.image_id);
  const data = fs.readFileSync(output);
  assert.equal(crypto.createHash('sha256').update(data).digest('hex'),
    crypto.createHash('sha256').update(png).digest('hex'));
  return { record, output };
}
// Baseline 39534f2 exposes createJobImageStore (not the candidate's
// createJobPublication), so exercise its real publishFiles path directly.
function publishWithEngineStore(state, mode) {
  const { createJobImageStore } = require(path.join(consoleRoot, 'bin/local-engine-generate.js'));
  const run = path.join(state, 'runs', '20261121-100200-engine-' + mode);
  fs.mkdirSync(run, { recursive: true });
  const src = path.join(state, 'engine-input-' + mode + '.png');
  const png = makePng(40, 24);
  fs.writeFileSync(src, png);
  const prior = process.env.DEX_IMAGE_VALIDATION_PYTHON;
  process.env.DEX_IMAGE_VALIDATION_PYTHON = imageValidationPython;
  try {
    const store = createJobImageStore({ DEX_DATA_ROOT: state, DEX_STORAGE_MODE: mode,
      DEX_IMAGES_ROOT_OVERRIDE: path.join(state, 'images') }, 'bigmac');
    const [entry] = store.publishFiles([{ src, runId: path.basename(run), runFile: 'controlled-engine.png', seed: 7 }], run);
    assert.ok(entry && fs.existsSync(path.join(state, 'images', entry.image_id)), 'engine store retains local image bytes');
    assert.deepEqual(fs.readFileSync(path.join(state, 'images', entry.image_id)), png);
    return entry;
  } finally {
    if (prior === undefined) delete process.env.DEX_IMAGE_VALIDATION_PYTHON;
    else process.env.DEX_IMAGE_VALIDATION_PYTHON = prior;
  }
}
test('real non-isolated internal fallback suppresses all MacBook contact, publication and verified-image cleanup', { timeout: 30000 }, async t => {
  if (os.hostname().toLowerCase() !== 'bigmac') return t.skip('Big Mac runtime contract');
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'dex-fallback-no-macbook-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const c = await canary();
  t.after(() => c.close());
  const state = path.join(dir, 'data');
  for (const part of ['runs', 'state', 'images']) fs.mkdirSync(path.join(state, part), { recursive: true });
  const original = publishWithCLI(state, 'internal-fallback');
  assert.equal(original.record.publication, undefined, 'CLI producer must not offer MacBook publication');
  // Preserve inherited publication evidence without allowing the fallback
  // backend to submit it or cleanup old files merely because a MacBook claims them.
  const { createPublicationOutbox } = require(path.join(consoleRoot, 'publication-outbox.js'));
  const outbox = createPublicationOutbox(path.join(state, 'state/publications'));
  const pending = outbox.create(original.record, original.output);
  const archivedName = 'archived-fallback-proof.png';
  const archivedPath = path.join(state, 'images', archivedName);
  fs.copyFileSync(original.output, archivedPath);
  fs.utimesSync(archivedPath, new Date(Date.now() - 3600000), new Date(Date.now() - 3600000));
  const digest = crypto.createHash('sha256').update(fs.readFileSync(archivedPath)).digest('hex');
  const archivedRecord = outbox.create({ ...original.record, image_id: archivedName,
    run_file: archivedName }, archivedPath);
  outbox.update(archivedName, { state: 'CANONICAL_VERIFIED' });
  c.manifest.images[archivedName] = { bytes: fs.statSync(archivedPath).size, sha256: digest };
  const archivalBefore = outbox.read(archivedName);
  const pendingBefore = outbox.read(original.record.image_id);
  const engineEntry = publishWithEngineStore(state, 'internal-fallback');
  assert.equal(engineEntry.publication, undefined, 'local-engine producer must not mark MacBook publication');
  assert.equal(fs.readdirSync(path.join(state, 'state/publications')).length, 2,
    'local-engine producer must not write outbox receipts');
  const server = await boot('internal-fallback', state, c.port, t);
  const pub = await json(server.endpoint + '/api/publications/status');
  assert.equal(pub.enabled, false, 'fallback must never enable MacBook publication');
  assert.equal(pub.pending, 0);
  assert.equal(pub.suspended, 1, 'inherited pending receipt must stay suspended, not published');
  const queue = await json(server.endpoint + '/api/publications/pending');
  assert.deepEqual(queue.items, []);
  const studio = await fetch(server.endpoint + '/dexdiffusion/');
  assert.equal(studio.status, 200);
  const studioHtml = await studio.text();
  assert.match(studioHtml, /DexDiffusion/);
  const caps = await json(server.endpoint + '/api/capabilities');
  const ids = caps.modelTargets.map(x => x.id).sort();
  assert.deepEqual(ids, ['flux-fp8', 'flux2-klein-4b', 'sdxl-photonic']);
  const info = await json(server.endpoint + '/api/system-info');
  assert.equal(info.storage.publication, 'suspended-internal-fallback');
  assert.ok(info.storage.outputs.some(x => x.path === path.join(state, 'images')));
  assert.equal(await (await fetch(server.endpoint + '/api/publications/non-existent/ack', { method: 'POST',
    headers: {'content-type': 'application/json'}, body: '{}' })).status, 404);
  await delay(650);
  assert.deepEqual(c.requests, [], 'no HTTP call may reach the supplied MacBook canary');
  assert.deepEqual(fs.readFileSync(original.output), makePng(48,32), 'no cleanup may remove or rewrite local bytes');
  assert.ok(fs.existsSync(archivedPath), 'old confirmed local bytes must not be removed by fallback');
  assert.equal(crypto.createHash('sha256').update(fs.readFileSync(archivedPath)).digest('hex'), digest);
  assert.deepEqual(outbox.read(original.record.image_id), pendingBefore,
    'pending inherited outbox record must not be mutated');
  assert.deepEqual(outbox.read(archivedName), archivalBefore,
    'verified inherited outbox record must not be mutated');
  assert.equal(fs.readdirSync(path.join(state,'state/publications')).length, 2,
    'fallback creates no additional outbox records');
  await server.stop();
  console.log('ROLLBACK_FALLBACK_REAL_SERVER_PASS mode=internal-fallback modelCount=3 canaryRequests=0 publication=false');
});
test('real non-isolated external mode keeps MacBook publication enabled and both image producers', { timeout: 30000 }, async t => {
  if (os.hostname().toLowerCase() !== 'bigmac') return t.skip('Big Mac runtime contract');
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'dex-external-publisher-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const c = await canary();
  t.after(() => c.close());
  const state = path.join(dir, 'data');
  for (const part of ['runs', 'state', 'images']) fs.mkdirSync(path.join(state, part), { recursive: true });
  const original = publishWithCLI(state, 'external');
  assert.equal(original.record.publication.protocol, 'macbook-pull-v1');
  const engineEntry = publishWithEngineStore(state, 'external');
  assert.equal(engineEntry.publication.protocol, 'macbook-pull-v1', 'external engine producer must retain outbox integration');
  const { createPublicationOutbox } = require(path.join(consoleRoot, 'publication-outbox.js'));
  assert.equal(createPublicationOutbox(path.join(state, 'state/publications')).read(engineEntry.image_id).state, 'PUBLICATION_PENDING');
  const server = await boot('external', state, c.port, t);
  const pub = await json(server.endpoint + '/api/publications/status');
  assert.equal(pub.enabled, true, 'external mode retains cross-host publication');
  assert.ok(pub.pending >= 1, 'CLI-published image remains pending until exact MacBook ACK');
  const until = Date.now() + 3000;
  while (c.requests.length === 0 && Date.now() < until) await delay(100);
  assert.ok(c.requests.includes('GET /manifest'), 'external mode must still request canary manifest');
  assert.ok(fs.existsSync(original.output), 'no cleanup without verified MacBook receipt');
  await server.stop();
  console.log('ROLLBACK_EXTERNAL_REAL_SERVER_PASS mode=external canaryManifest=true publication=true');
});
