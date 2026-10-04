'use strict';
// Shared helpers for the browser acceptance suite: tiny PNG encode/decode (no deps),
// server bootstrap on a private port, and hermetic API fixtures routed into the page.
const zlib = require('zlib');
const path = require('path');
const http = require('http');
const { spawn } = require('child_process');

const crcTable = (() => { const t = new Uint32Array(256); for (let n = 0; n < 256; n++) { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; t[n] = c >>> 0; } return t; })();
const crc32 = buf => { let c = 0xffffffff; for (const b of buf) c = crcTable[(c ^ b) & 0xff] ^ (c >>> 8); return (c ^ 0xffffffff) >>> 0; };
function chunk(type, data) {
  const len = Buffer.alloc(4); len.writeUInt32BE(data.length);
  const td = Buffer.concat([Buffer.from(type), data]);
  const crc = Buffer.alloc(4); crc.writeUInt32BE(crc32(td));
  return Buffer.concat([len, td, crc]);
}
// RGB PNG with a red marker top-left and a blue marker bottom-right so alignment is visible.
function makePng(w, h) {
  const raw = Buffer.alloc((w * 3 + 1) * h);
  for (let y = 0; y < h; y++) {
    raw[y * (w * 3 + 1)] = 0;
    for (let x = 0; x < w; x++) {
      const o = y * (w * 3 + 1) + 1 + x * 3;
      let r = 60 + ((x * 120) / w) | 0, g = 80 + ((y * 120) / h) | 0, b = 110;
      if (x < 16 && y < 16) { r = 255; g = 0; b = 0; }
      if (x >= w - 16 && y >= h - 16) { r = 0; g = 0; b = 255; }
      raw[o] = r; raw[o + 1] = g; raw[o + 2] = b;
    }
  }
  const ihdr = Buffer.alloc(13); ihdr.writeUInt32BE(w, 0); ihdr.writeUInt32BE(h, 4); ihdr[8] = 8; ihdr[9] = 2;
  return Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), chunk('IHDR', ihdr), chunk('IDAT', zlib.deflateSync(raw)), chunk('IEND', Buffer.alloc(0))]);
}
// Decode an 8-bit non-interlaced RGBA/RGB PNG (what canvas.toDataURL emits) → {w,h,data(RGBA)}.
function decodePng(buf) {
  let p = 8, w = 0, h = 0, ct = 0; const idat = [];
  while (p < buf.length) {
    const len = buf.readUInt32BE(p), type = buf.toString('latin1', p + 4, p + 8), d = buf.slice(p + 8, p + 8 + len);
    if (type === 'IHDR') { w = d.readUInt32BE(0); h = d.readUInt32BE(4); ct = d[9]; } else if (type === 'IDAT') idat.push(d);
    p += 12 + len;
  }
  const bpp = ct === 6 ? 4 : 3, raw = zlib.inflateSync(Buffer.concat(idat)), stride = w * bpp, out = Buffer.alloc(w * h * 4);
  const prev = Buffer.alloc(stride), cur = Buffer.alloc(stride);
  for (let y = 0; y < h; y++) {
    const f = raw[y * (stride + 1)]; raw.copy(cur, 0, y * (stride + 1) + 1, y * (stride + 1) + 1 + stride);
    for (let i = 0; i < stride; i++) {
      const a = i >= bpp ? cur[i - bpp] : 0, b = prev[i], c = i >= bpp ? prev[i - bpp] : 0;
      let add = 0;
      if (f === 1) add = a; else if (f === 2) add = b; else if (f === 3) add = (a + b) >> 1;
      else if (f === 4) { const pa = Math.abs(b - c), pb = Math.abs(a - c), pc = Math.abs(a + b - 2 * c); add = pa <= pb && pa <= pc ? a : pb <= pc ? b : c; }
      cur[i] = (cur[i] + add) & 255;
    }
    for (let x = 0; x < w; x++) { const o = (y * w + x) * 4; out[o] = cur[x * bpp]; out[o + 1] = cur[x * bpp + 1]; out[o + 2] = cur[x * bpp + 2]; out[o + 3] = bpp === 4 ? cur[x * bpp + 3] : 255; }
    cur.copy(prev);
  }
  return { w, h, data: out };
}

function waitHttp(url, ms = 20000) {
  const t0 = Date.now();
  return new Promise((resolve, reject) => {
    const tick = () => http.get(url, r => { r.resume(); resolve(); }).on('error', () => (Date.now() - t0 > ms ? reject(new Error('server did not start')) : setTimeout(tick, 300)));
    tick();
  });
}
// ── lifecycle: nothing a suite starts may outlive it ────────────────────────────────────────────────
const cleanups = [];
let cleaning = false;
function onCleanup(fn) { cleanups.push(fn); }
async function runCleanups() {
  if (cleaning) return; cleaning = true;
  for (const fn of cleanups.splice(0).reverse()) { try { await Promise.race([Promise.resolve(fn()), new Promise(r => setTimeout(r, 5000))]); } catch (_) {} }
}
for (const sig of ['SIGINT', 'SIGTERM', 'SIGHUP']) process.on(sig, () => { console.error(`\n[suite] ${sig} received — cleaning up`); runCleanups().then(() => process.exit(130)); });
process.on('uncaughtException', e => { console.error('[suite] uncaught:', e); runCleanups().then(() => process.exit(2)); });
process.on('unhandledRejection', e => { console.error('[suite] unhandled rejection:', e); runCleanups().then(() => process.exit(2)); });

// Test runner with phase trace, a per-test timeout and a global watchdog (so a stuck page never becomes a silent hang).
function runner(name, { testMs = Number(process.env.DEX_BROWSER_TEST_MS) || 120000, totalMs = Number(process.env.DEX_BROWSER_TIMEOUT_MS) || 300000 } = {}) {
  const T0 = Date.now(), results = [];
  let current = '(setup)';
  const stamp = () => `[${name} +${((Date.now() - T0) / 1000).toFixed(1)}s]`;
  const log = (...a) => console.log(stamp(), ...a);
  let aborted = false;
  const watchdog = setTimeout(() => {
    aborted = true;
    console.error(`${stamp()} WATCHDOG: suite exceeded ${Math.round(totalMs / 1000)} s; stuck in '${current}'. Aborting.`);
    runCleanups().then(() => process.exit(3));
  }, totalMs);
  watchdog.unref();
  const test = async (title, fn) => {
    if (process.env.DEX_BROWSER_TEST_FILTER && !title.includes(process.env.DEX_BROWSER_TEST_FILTER)) return;
    current = title; const t0 = Date.now(); log('START', title);
    let timer;
    try {
      await Promise.race([fn(), new Promise((_, rej) => { timer = setTimeout(() => rej(new Error(`test exceeded ${Math.round(testMs / 1000)} s`)), testMs); })]);
      results.push(['PASS', title, Date.now() - t0]); log('PASS', title, `(${Date.now() - t0} ms)`);
    } catch (e) {
      results.push(['FAIL', title, e.message]); log('FAIL', title, '\n   ', String(e.message).split('\n').slice(0, 5).join('\n    '));
    } finally { clearTimeout(timer); }
  };
  return { results, test, log, phase: p => { current = p; log('PHASE', p); }, exitCode: failed => (aborted ? 3 : failed ? 1 : 0) };
}

// Starts the console on a free private port. The server runs under a supervisor that kills it if this process dies.
async function startServer(preferred) {
  const net = require('net');
  const port = await new Promise((resolve, reject) => { const srv = net.createServer(); srv.listen(0, '127.0.0.1', () => { const p = srv.address().port; srv.close(() => resolve(p)); }); srv.on('error', reject); });
  const sup = spawn(process.execPath, [path.join(__dirname, 'server-supervisor.js'), String(process.pid), path.join(__dirname, '..', '..')], { env: Object.assign({}, process.env, { OPERATOR_CONSOLE_PORT: String(port) }), stdio: 'ignore' });
  const exited = new Promise(r => sup.on('exit', r));
  const stop = () => { try { sup.kill('SIGTERM'); } catch (_) {} return Promise.race([exited, new Promise(r => setTimeout(r, 6000))]); };
  onCleanup(stop);
  await waitHttp(`http://127.0.0.1:${port}/api/version`, 60000);
  return { base: `http://127.0.0.1:${port}`, stop };
}

// Read-only real catalogue fixture, captured once per suite/base. UI tests do
// not test bootstrap network latency; no target or availability is invented.
const modelSnapshots = new Map();
async function installModelSnapshots(page, base) {
  if (!modelSnapshots.has(base)) modelSnapshots.set(base, Promise.all(['/api/capabilities','/api/models'].map(async endpoint => {
    const res = await fetch(base + endpoint, { signal: AbortSignal.timeout(60000) });
    if (!res.ok) throw new Error('model fixture HTTP ' + res.status + ' at ' + endpoint);
    const body = await res.text(), data = JSON.parse(body);
    if (endpoint === '/api/capabilities' && (data.modelTargets || data.controlledTargets || []).length <= 3) throw new Error('model fixture catalogue incomplete');
    return { endpoint, body, status: res.status, captured_at: new Date().toISOString() };
  })));
  const snapshots = await modelSnapshots.get(base);
  for (const item of snapshots) await page.route('**' + item.endpoint, route => route.request().method() === 'GET'
    ? route.fulfill({ status:item.status, contentType:'application/json', body:item.body }) : route.fallback());
  if (process.env.DEX_BROWSER_OUTPUT_DIR) {
    const fs = require('fs'), crypto = require('crypto'); fs.mkdirSync(process.env.DEX_BROWSER_OUTPUT_DIR,{recursive:true});
    fs.writeFileSync(path.join(process.env.DEX_BROWSER_OUTPUT_DIR,'model-bootstrap-snapshot.json'),JSON.stringify({scope:'real read-only catalogue fixture; bootstrap network latency not certified',snapshots:snapshots.map(({endpoint,body,status,captured_at})=>({endpoint,status,captured_at,bytes:Buffer.byteLength(body),sha256:crypto.createHash('sha256').update(body).digest('hex')}))},null,2)+'\n');
  }
}

// Launches Chrome through playwright and guarantees it is closed on any exit path.
async function launchBrowser(chromium) {
  const browser = await chromium.launch(Object.assign({ headless: true, args: ['--disable-gpu'], timeout: 180000 }, process.env.DEX_BROWSER_PATH
    ? { executablePath: process.env.DEX_BROWSER_PATH } : { channel: 'chrome' }));
  onCleanup(() => browser.close());
  return browser;
}

// Fixture images: id → { w, h, meta }. The route layer serves /api/images/:id and /meta for them.
function installImageFixtures(page, fixtures) {
  return page.route(/\/api\/images\/[^/]+(\/meta)?$/, async route => {
    const url = new URL(route.request().url());
    const m = /\/api\/images\/([^/]+?)(\/meta)?$/.exec(url.pathname);
    const id = decodeURIComponent(m[1]), fx = fixtures[id];
    if (!fx) return route.fallback();
    if (m[2]) {
      const { recall } = require('./recall-for-test');
      return route.fulfill({ json: { id, url: '/api/images/' + encodeURIComponent(id), path: '/x/' + id, width: fx.w, height: fx.h, runId: 'fx-run', keeper: false, meta: fx.meta, parent: fx.parent || null, children: [], ancestors: [], recall: recall({ id, width: fx.w, height: fx.h, meta: fx.meta }) } });
    }
    return route.fulfill({ contentType: 'image/png', body: makePng(fx.w, fx.h) });
  });
}

// 16-bit mono WAV (sine) for upload fixtures.
function makeWav(sec = 5, hz = 220, rate = 24000, amp = 0.4) {
  const n = Math.round(sec * rate), data = Buffer.alloc(n * 2);
  for (let i = 0; i < n; i++) data.writeInt16LE(Math.round(amp * 32767 * Math.sin(2 * Math.PI * hz * i / rate)), i * 2);
  const h = Buffer.alloc(44);
  h.write('RIFF', 0); h.writeUInt32LE(36 + data.length, 4); h.write('WAVE', 8); h.write('fmt ', 12); h.writeUInt32LE(16, 16); h.writeUInt16LE(1, 20); h.writeUInt16LE(1, 22);
  h.writeUInt32LE(rate, 24); h.writeUInt32LE(rate * 2, 28); h.writeUInt16LE(2, 32); h.writeUInt16LE(16, 34); h.write('data', 36); h.writeUInt32LE(data.length, 40);
  return Buffer.concat([h, data]);
}

module.exports = { makePng, decodePng, makeWav, startServer, installModelSnapshots, installImageFixtures, runner, launchBrowser, onCleanup, runCleanups };
