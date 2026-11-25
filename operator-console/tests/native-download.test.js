'use strict';
// The installed app's own navigation/download delegate (ImageGenApp.swift, unmodified) driven off screen against a
// synthetic Studio: every Download control must save its file and leave Studio where it was.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const http = require('node:http');
const cp = require('node:child_process');

const source = fs.readFileSync(path.resolve(__dirname, '../../native/macos/Image_Gen/ImageGenApp.swift'), 'utf8');
const harness = fs.readFileSync(path.join(__dirname, 'fixtures/native-download-harness.swift'), 'utf8');
const MAIN = '\nlet app = NSApplication.shared\n';
const PNG = Buffer.concat([Buffer.from('89504e470d0a1a0a', 'hex'), Buffer.from('synthetic-original parameters: kept'), Buffer.alloc(4096, 7)]);
const link = (href, name) => `(()=>{const a=document.createElement('a');a.href=${JSON.stringify(href)};a.setAttribute('download',${JSON.stringify(name || '')});document.body.appendChild(a);a.click();a.remove();})()`;

function serve() {
  const held = new Set();
  const server = http.createServer((req, res) => {
    const u = req.url;
    const attach = (body, name, type = 'image/png') => { res.writeHead(200, { 'Content-Type': type, 'Content-Length': body.length, 'Content-Disposition': `attachment; filename="${name}"` }); res.end(body); };
    if (u.startsWith('/dexdiffusion/')) { res.writeHead(200, { 'Content-Type': 'text/html' }); return res.end('<!doctype html><title>Studio</title><body>Studio<script>window.__ready=true</script>'); }
    if (u === '/api/images/one.png/export') return attach(PNG, 'one.png');
    if (u === '/api/images/one.png/export?metadata=1') return attach(Buffer.concat([PNG, Buffer.from('meta')]), 'one.png');
    if (u === '/api/images/plain.png') { res.writeHead(200, { 'Content-Type': 'image/png', 'Content-Length': PNG.length }); return res.end(PNG); }
    if (u === '/api/media/m1/download') return attach(Buffer.from('RIFFaudio'), 'm1.wav', 'audio/wav');
    if (u === '/api/chat/sessions/s1/export') return attach(Buffer.from('# chat'), 'chat.md', 'text/markdown');
    if (u === '/api/images/missing.png/export') { res.writeHead(404, { 'Content-Type': 'application/json' }); return res.end('{"error":"not found"}'); }
    if (u === '/api/images/broken.png/export' || u === '/api/images/slow.png/export') {
      res.writeHead(200, { 'Content-Type': 'image/png', 'Content-Length': 5000000, 'Content-Disposition': 'attachment; filename="partial.png"' });
      res.write(Buffer.alloc(200000, 1)); held.add(res);
      if (u.includes('broken')) setTimeout(() => res.destroy(), 300);
      return undefined;
    }
    res.writeHead(404); return res.end();
  });
  return new Promise(resolve => server.listen(0, '127.0.0.1', () => resolve({ port: server.address().port, close: () => { for (const r of held) r.destroy(); server.closeAllConnections(); server.close(); } })));
}

async function drive(t, swiftSource, steps) {
  if (process.platform !== 'darwin' || cp.spawnSync('swiftc', ['--version']).error) { t.skip('needs macOS WebKit and swiftc'); return null; }
  const at = swiftSource.lastIndexOf(MAIN);
  assert.ok(at > 0, 'the native app must keep its main block at the end');
  const dir = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'dex-native-dl-')));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const home = path.join(dir, 'home'), downloads = path.join(home, 'Downloads');
  fs.mkdirSync(downloads, { recursive: true }); fs.mkdirSync(path.join(dir, 'root/operator-console'), { recursive: true });
  const srv = await serve(); t.after(() => srv.close());
  const file = path.join(dir, 'main.swift');
  // Only the port differs from the shipped source, so the harness can never touch a real Studio.
  fs.writeFileSync(file, swiftSource.slice(0, at).replaceAll('31337', String(srv.port)) + harness);
  const built = cp.spawnSync('swiftc', ['-target', 'arm64-apple-macos12.0', '-framework', 'Cocoa', '-framework', 'WebKit', file, '-o', path.join(dir, 'h')], { encoding: 'utf8', timeout: 180000 });
  assert.equal(built.status, 0, built.stderr);
  const out = await new Promise(resolve => {
    const p = cp.spawn(path.join(dir, 'h'), [], { env: { ...process.env, CFFIXED_USER_HOME: home, DEX_HARNESS_HOME: home, IMAGE_GEN_ROOT: path.join(dir, 'root'), DEX_HARNESS_STEPS: JSON.stringify(steps) } });
    let s = ''; p.stdout.on('data', d => { s += d; }); p.on('close', code => resolve({ code, s }));
  });
  assert.equal(out.code, 0, out.s);
  const rows = Object.fromEntries(out.s.trim().split('\n').filter(l => l.startsWith('{')).map(l => { const r = JSON.parse(l); return [r.name, r]; }));
  return { rows, read: n => fs.readFileSync(path.join(downloads, n)), downloads };
}

test('every Download control saves its file and leaves Studio in place', async t => {
  const r = await drive(t, source, [
    { name: 'image', js: link('/api/images/one.png/export', 'one.png') },
    { name: 'again', js: link('/api/images/one.png/export', 'one.png') },
    { name: 'metadata', js: link('/api/images/one.png/export?metadata=1', 'one.png') },
    { name: 'plain', js: link('/api/images/plain.png', 'plain.png') },
    { name: 'media', js: link('/api/media/m1/download') },
    { name: 'attachment', js: "location.href='/api/chat/sessions/s1/export'" },
    { name: 'blob', js: "(()=>{const u=URL.createObjectURL(new Blob(['copy'],{type:'image/png'}));const a=document.createElement('a');a.href=u;a.download='copy.png';document.body.appendChild(a);a.click();a.remove();setTimeout(()=>URL.revokeObjectURL(u),1000);})()" },
    { name: 'missing', js: link('/api/images/missing.png/export', 'missing.png') },
    { name: 'broken', js: link('/api/images/broken.png/export', 'partial.png'), wait: '2500' },
    { name: 'cancel', js: link('/api/images/slow.png/export', 'partial.png'), cancel: '1' },
    { name: 'after', js: link('/api/images/one.png/export', 'one.png') },
    { name: 'navigate', js: "location.href='/dexdiffusion/?next'" },
    { name: 'closed', js: link('/api/images/one.png/export', 'one.png'), close: '1' },
  ]);
  if (!r) return;
  const added = Object.fromEntries(Object.entries(r.rows).map(([k, v]) => [k, v.added]));
  assert.deepEqual(added, { image: ['one.png'], again: ['one-2.png'], metadata: ['one-3.png'], plain: ['plain.png'], media: ['m1.wav'], attachment: ['chat.md'], blob: ['copy.png'], missing: [], broken: [], cancel: [], after: ['one-4.png'], navigate: [], closed: ['one-5.png'] }, JSON.stringify(r.rows, null, 1));
  for (const [k, v] of Object.entries(r.rows)) if (k !== 'navigate') assert.deepEqual([k, v.kept, v.path.replace(/\/$/, '')], [k, true, '/dexdiffusion']);
  assert.deepEqual([r.rows.navigate.kept, r.rows.navigate.query], [false, 'next'], 'ordinary navigation still navigates');
  for (const n of ['one.png', 'one-2.png', 'one-4.png', 'plain.png']) assert.ok(r.read(n).equals(PNG), n + ' is the original, byte for byte');
  assert.ok(r.read('one-3.png').equals(Buffer.concat([PNG, Buffer.from('meta')])));
  assert.equal(r.read('copy.png').toString(), 'copy');
  assert.match(r.rows.image.status, /Saved one\.png/);
  assert.match(r.rows.missing.status, /not saved.*404/i);
  assert.match(r.rows.broken.status, /not saved/i);
  assert.match(r.rows.cancel.status, /cancelled/i);
});
