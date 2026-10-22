'use strict';
// V2 parity rows 48-51 (3D assets, 3D viewer, World projects, World viewer). Hermetic: the console is a real isolated server,
// worker/job/project APIs and the artifacts are synthetic fixtures built here (a cube GLB and a point-cloud PLY). The viewers
// are the real pages; success means pixels on the canvas that react to camera input - never "the route opened".
const assert = require('node:assert/strict');
const { chromium } = require('playwright-core');
const { startServer, installModelSnapshots, decodePng, runner, launchBrowser, runCleanups, openStudio } = require('./helpers');

const { test, results, exitCode } = runner('v2-parity-3d-world');
const SRC = 'fixture-src1.png';

function makeGlb() {
  const pos = new Float32Array([-1,-1,-1, 1,-1,-1, 1,1,-1, -1,1,-1, -1,-1,1, 1,-1,1, 1,1,1, -1,1,1]);
  const idx = new Uint16Array([0,1,2, 0,2,3, 4,6,5, 4,7,6, 0,4,5, 0,5,1, 3,2,6, 3,6,7, 0,3,7, 0,7,4, 1,5,6, 1,6,2]);
  const bin = Buffer.concat([Buffer.from(pos.buffer), Buffer.from(idx.buffer)]);
  const json = { asset: { version: '2.0' }, scene: 0, scenes: [{ nodes: [0] }], nodes: [{ mesh: 0 }], meshes: [{ primitives: [{ attributes: { POSITION: 0 }, indices: 1 }] }],
    buffers: [{ byteLength: bin.length }], bufferViews: [{ buffer: 0, byteOffset: 0, byteLength: pos.byteLength }, { buffer: 0, byteOffset: pos.byteLength, byteLength: idx.byteLength }],
    accessors: [{ bufferView: 0, componentType: 5126, count: 8, type: 'VEC3', min: [-1,-1,-1], max: [1,1,1] }, { bufferView: 1, componentType: 5123, count: 36, type: 'SCALAR' }] };
  let j = Buffer.from(JSON.stringify(json)); while (j.length % 4) j = Buffer.concat([j, Buffer.from(' ')]);
  const total = 12 + 8 + j.length + 8 + bin.length, h = Buffer.alloc(12);
  h.write('glTF', 0, 'latin1'); h.writeUInt32LE(2, 4); h.writeUInt32LE(total, 8);
  const ch = (len, type) => { const b = Buffer.alloc(8); b.writeUInt32LE(len, 0); b.writeUInt32LE(type, 4); return b; };
  return Buffer.concat([h, ch(j.length, 0x4e4f534a), j, ch(bin.length, 0x004e4942), bin]);
}
function makePly() {   // the viewer's loader reads binary PLY: x y z (float32) + red green blue (uint8)
  const n = 600, head = Buffer.from(`ply\nformat binary_little_endian 1.0\nelement vertex ${n}\nproperty float x\nproperty float y\nproperty float z\nproperty uchar red\nproperty uchar green\nproperty uchar blue\nend_header\n`, 'latin1');
  const body = Buffer.alloc(n * 15);
  for (let i = 0; i < n; i++) { const a = i * 2.399963, y = 1 - (i / (n - 1)) * 2, r = Math.sqrt(1 - y * y), o = i * 15;
    body.writeFloatLE(Math.cos(a) * r * 2, o); body.writeFloatLE(y * 2, o + 4); body.writeFloatLE(Math.sin(a) * r * 2 - 4, o + 8);
    body[o + 12] = 40 + (i * 7) % 215; body[o + 13] = 80 + (i * 3) % 170; body[o + 14] = 255 - (i * 5) % 200; }
  return Buffer.concat([head, body]);
}
const GLB = makeGlb(), PLY = makePly();
const json = (route, body, status = 200) => route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(body) });

async function pixels(page, sel = 'canvas') {
  const png = await page.locator(sel).first().screenshot();
  const { w, h, data } = decodePng(png);
  let lit = 0; const sig = [];
  for (let i = 0; i < data.length; i += 4) { if (Math.abs(data[i] - 5) + Math.abs(data[i + 1] - 7) + Math.abs(data[i + 2] - 11) > 30) lit++; }
  for (let y = 0; y < h; y += Math.max(1, Math.floor(h / 24))) for (let x = 0; x < w; x += Math.max(1, Math.floor(w / 32))) { const o = (y * w + x) * 4; sig.push(data[o], data[o + 1], data[o + 2]); }
  // Block-average luminance (48 x 32 cells): robust for sparse point clouds where a few pixels move.
  const grid = new Array(48 * 32).fill(0), cnt = new Array(48 * 32).fill(0);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) { const o = (y * w + x) * 4, cell = Math.min(31, Math.floor(y * 32 / h)) * 48 + Math.min(47, Math.floor(x * 48 / w)); grid[cell] += data[o] + data[o + 1] + data[o + 2]; cnt[cell]++; }
  for (let i = 0; i < grid.length; i++) grid[i] = grid[i] / Math.max(1, cnt[i]);
  return { lit, total: w * h, sig, grid };
}
const diff = (a, b) => a.sig.reduce((n, v, i) => n + (Math.abs(v - b.sig[i]) > 12 ? 1 : 0), 0);
const gdiff = (a, b) => a.grid.reduce((n, v, i) => n + (Math.abs(v - b.grid[i]) > 6 ? 1 : 0), 0);
async function status(page) { return (await page.locator('#asset-status, #world-status').first().innerText()).replace(/\s+/g, ' '); }

async function webglOk(browser) { const p = await browser.newPage(); const ok = await p.evaluate(() => { const c = document.createElement('canvas'); return !!(c.getContext('webgl2') || c.getContext('webgl')); }); await p.close(); return ok; }

(async () => {
  const srv = process.env.DEX_TEST_BASE ? { base: process.env.DEX_TEST_BASE, stop() {} } : await startServer();
  const browser = await launchBrowser(chromium);
  try {
    const gl = await webglOk(browser);
    await test('environment: the browser provides WebGL, so the viewers are verified by pixels (not by their error path)', async () => { assert.equal(gl, true, 'WebGL is unavailable in this browser'); });

    await test('row 49: the 3D viewer renders a GLB, orbits on drag, zooms on wheel and Reset restores the view', async () => {
      const page = await browser.newPage({ viewport: { width: 900, height: 640 } });
      const errors = []; page.on('pageerror', e => errors.push(String(e)));
      await page.route('**/api/media/syn-cube.glb', r => r.fulfill({ contentType: 'model/gltf-binary', body: GLB }));
      await page.goto(srv.base + '/dexdiffusion/asset3d-viewer.html?artifact=syn-cube.glb', { waitUntil: 'domcontentloaded' });
      await page.waitForFunction(() => /8 vertices/.test(document.querySelector('#asset-status').innerText), null, { timeout: 15000 });
      assert.match(await status(page), /syn-cube\.glb · 8 vertices · GLB mesh/);
      await page.waitForTimeout(400);
      const a = await pixels(page); assert.ok(a.lit > a.total * 0.01, `the mesh is drawn (${a.lit} lit px)`);
      const box = await page.locator('canvas').boundingBox(), cx = box.x + box.width / 2, cy = box.y + box.height / 2;
      await page.mouse.move(cx, cy); await page.mouse.down(); await page.mouse.move(cx + 140, cy + 40, { steps: 8 }); await page.mouse.up(); await page.waitForTimeout(300);
      const b = await pixels(page); assert.ok(diff(a, b) > 8, 'dragging orbits the camera');
      await page.mouse.move(cx, cy); await page.mouse.wheel(0, -600); await page.waitForTimeout(300);
      const c = await pixels(page); assert.ok(diff(b, c) > 4 || c.lit !== b.lit, 'the wheel zooms');
      await page.locator('#asset-reset').click(); await page.waitForTimeout(400);
      const d = await pixels(page); assert.ok(diff(a, d) <= 6, 'Reset camera restores the initial view (' + diff(a, d) + ' differing samples)');
      assert.deepEqual(errors, []);
      await page.close();
    });

    for (const [name, handler, expect] of [
      ['a corrupt header', r => r.fulfill({ contentType: 'model/gltf-binary', body: Buffer.concat([Buffer.from('glTX'), GLB.subarray(4)]) }), /invalid GLB header/],
      ['a truncated file', r => r.fulfill({ contentType: 'model/gltf-binary', body: GLB.subarray(0, 60) }), /invalid GLB header or length/],
      ['an empty file', r => r.fulfill({ contentType: 'model/gltf-binary', body: Buffer.alloc(0) }), /invalid GLB header/],
      ['a non-GLB file', r => r.fulfill({ contentType: 'text/plain', body: 'this is not a model' }), /invalid GLB header/],
      ['a missing artifact', r => r.fulfill({ status: 404, contentType: 'application/json', body: '{"error":"not found"}' }), /artifact request failed \(404\)/],
    ]) {
      await test(`row 49: ${name} is refused with a visible reason and nothing is drawn`, async () => {
        const page = await browser.newPage({ viewport: { width: 700, height: 500 } });
        await page.route('**/api/media/bad.glb', handler);
        await page.goto(srv.base + '/dexdiffusion/asset3d-viewer.html?artifact=bad.glb', { waitUntil: 'domcontentloaded' });
        await page.waitForFunction(() => /unavailable/.test(document.querySelector('#asset-status').innerText), null, { timeout: 10000 });
        const t = await status(page); assert.match(t, /3D preview unavailable/); assert.match(t, expect);
        await page.addStyleTag({ content: '.panel,#asset-status,#asset-help,#world-hud{visibility:hidden!important}' });   // judge the canvas, not the HUD
        const px = await pixels(page); assert.ok(px.lit < px.total * 0.002, `no model pixels are shown (${px.lit} lit px)`);
        await page.close();
      });
    }

    await test('row 48: V2 3D requires an explicit source, sends exact requests per mode, tracks the job and exposes viewer/Blender', async () => {
      const page = await browser.newPage({ viewport: { width: 1348, height: 900 } });
      const errors = []; page.on('pageerror', e => errors.push(String(e)));
      const reqs = []; let popup = null;
      await installModelSnapshots(page, srv.base);
      await page.route('**/api/3d/workers', r => json(r, { engine: { id: 'hunyuan3d-swift', label: 'Hunyuan3D Swift / MLX', blender: { available: true } }, remote: { reachable: true, identity: 'bigmac@bigmac', runtime: true }, modes: { quickGeometry: { status: 'PROVEN' }, mesh: { status: 'PROVEN' }, textured: { status: 'UNAVAILABLE' }, pbr: { status: 'DISABLED' } } }));
      await page.route('**/api/world/projects', r => { if (r.request().method() === 'POST') { reqs.push(['world', JSON.parse(r.request().postData())]); return json(r, { id: 'wp-syn1', mode: 'quick3d', status: 'QUEUED', job_id: 'job-q3d' }); } return json(r, { projects: [] }); });
      await page.route('**/api/3d/jobs', r => { reqs.push(['3d', JSON.parse(r.request().postData())]); json(r, { job_id: 'job-mesh', status: 'QUEUED', mode: 'mesh' }); });
      let polls = 0;
      await page.route('**/api/generic-jobs/**', r => { polls++; json(r, { job_id: 'job-mesh', status: polls > 1 ? 'COMPLETE' : 'RUNNING', mode: 'mesh', worker_id: 'hunyuan3d', artifacts_detail: polls > 1 ? [{ artifact_id: 'syn-cube.glb', url: '/api/media/syn-cube.glb', kind: 'world' }] : [] }); });
      await page.route('**/api/3d/open-in-blender', r => { reqs.push(['blender', JSON.parse(r.request().postData())]); json(r, { ok: true }); });
      await openStudio(page, srv.base + '/dexdiffusion/', { waitUntil: 'domcontentloaded' });
      await page.waitForFunction(() => window.__dex && __dex.state.version === 2 && __dex.state.modelTargets?.length > 3);
      await page.evaluate(() => __dex.setScreen('3d'));
      await page.getByText('Required. 3D uses exactly the image you choose').waitFor();
      assert.match(await page.locator('body').innerText(), /PBR: disabled/);
      await page.getByRole('button', { name: /Mesh/ }).first().click();
      await page.waitForTimeout(500);
      assert.deepEqual(reqs, [], 'no request is sent without an explicit source image');
      await page.evaluate(id => __dex.setState({ asset3dSourceArtifact: id }), SRC);
      await page.getByRole('button', { name: /Mesh/ }).first().click();
      await page.waitForFunction(() => /Latest 3D job · COMPLETE/.test(document.body.innerText), null, { timeout: 15000 });
      assert.deepEqual(reqs.slice(0, 1), [['3d', { mode: 'mesh', sourceArtifactId: SRC }]], 'exact mesh request');
      const pagePromise = page.context().waitForEvent('page');
      await page.getByRole('button', { name: 'Open 3D preview' }).click();
      popup = await pagePromise; assert.match(popup.url(), /asset3d-viewer\.html\?artifact=syn-cube\.glb/); await popup.close();
      // Export: the Download GLB action delivers a structurally valid GLB (header, version, declared length, JSON + BIN chunks).
      await page.route('**/api/media/syn-cube.glb/download', r => r.fulfill({ contentType: 'model/gltf-binary', headers: { 'content-disposition': 'attachment; filename="syn-cube.glb"' }, body: GLB }));
      const dl = page.waitForEvent('download');
      await page.getByText('Download GLB').click();
      const file = await (await dl).createReadStream(); const chunks = []; for await (const c of file) chunks.push(c); const got = Buffer.concat(chunks);
      assert.equal(got.subarray(0, 4).toString('latin1'), 'glTF'); assert.equal(got.readUInt32LE(4), 2); assert.equal(got.readUInt32LE(8), got.length, 'declared length equals the file size');
      assert.equal(got.readUInt32LE(16), 0x4e4f534a, 'first chunk is JSON'); assert.ok(JSON.parse(got.subarray(20, 20 + got.readUInt32LE(12)).toString()).meshes.length >= 1);
      await page.getByRole('button', { name: 'Open in Blender' }).click();
      await page.waitForFunction(() => __dex.state.toasts.some(t => /Opened in Blender/.test(t.msg)));
      assert.deepEqual(reqs.at(-1), ['blender', { artifact_id: 'syn-cube.glb' }]);
      await page.getByRole('button', { name: /Quick Geometry/ }).first().click();
      for (let i = 0; i < 40 && !reqs.some(r => r[0] === 'world'); i++) await page.waitForTimeout(100);
      assert.deepEqual(reqs.find(r => r[0] === 'world'), ['world', { mode: 'quick3d', sourceArtifactId: SRC, parameters: { seed: 42 } }], 'Quick Geometry is a World quick3d project request');
      assert.deepEqual(errors, []);
      await page.close();
    });

    await test('row 50: V2 World lists real project states, needs an explicit source, sends exact requests and Retry re-submits a failed project', async () => {
      const page = await browser.newPage({ viewport: { width: 1348, height: 900 } });
      const errors = []; page.on('pageerror', e => errors.push(String(e)));
      const reqs = []; let list = [
        { id: 'wp-ok', mode: 'quick3d', status: 'COMPLETE', currentStage: 'viewer', sourceArtifactId: SRC, artifacts: { finalPly: { artifact_id: 'syn.ply', url: '/api/media/syn.ply', bytes: PLY.length } } },
        { id: 'wp-bad', mode: 'complete360', status: 'FAILED', currentStage: 'panorama', sourceArtifactId: SRC, failure: { stage: 'panorama', error: 'worker exit 1' }, artifacts: {} },
        { id: 'wp-wait', mode: 'quick3d', status: 'QUEUED', currentStage: 'queued', sourceArtifactId: SRC, artifacts: {} }];
      let gets = 0;
      await installModelSnapshots(page, srv.base);
      await page.route('**/api/world/workers', r => json(r, { assets: { reachable: true }, workers: [{ id: 'sharp-reconstruct', label: 'Apple SHARP', status: 'PROVEN' }, { id: 'flux2-world-completion', label: 'FLUX.2 completion', status: 'PROVEN' }] }));
      await page.route(/\/api\/world\/projects$/, r => { if (r.request().method() === 'POST') { reqs.push(['post', JSON.parse(r.request().postData())]); return json(r, { id: 'wp-new', mode: JSON.parse(r.request().postData()).mode, status: 'QUEUED' }, 202); } gets++; return json(r, { projects: list }); });
      await openStudio(page, srv.base + '/dexdiffusion/', { waitUntil: 'domcontentloaded' });
      await page.waitForFunction(() => window.__dex && __dex.state.version === 2 && __dex.state.modelTargets?.length > 3);
      await page.evaluate(() => __dex.setScreen('world'));
      await page.getByText('wp-bad').first().waitFor();
      const t = await page.locator('[data-scroll-pane]').first().innerText();
      assert.match(t, /quick3d · wp-ok[\s\S]*COMPLETE/); assert.match(t, /complete360 · wp-bad[\s\S]*FAILED/); assert.match(t, /panorama: worker exit 1/, 'the failing stage and error are shown');
      assert.match(t, /Apple SHARP: PROVEN/);
      assert.equal(await page.getByRole('button', { name: 'Open Focus' }).count(), 1, 'only the project with a final artifact can be opened');
      await page.getByRole('button', { name: 'Make 3D' }).click(); await page.waitForTimeout(500);
      assert.deepEqual(reqs, [], 'no source -> no request');
      await page.evaluate(id => __dex.setState({ worldSourceArtifact: id }), SRC);
      await page.getByRole('button', { name: 'Make 3D' }).click();
      for (let i = 0; i < 40 && reqs.length < 1; i++) await page.waitForTimeout(100);
      assert.deepEqual(reqs[0], ['post', { mode: 'quick3d', sourceArtifactId: SRC, parameters: { seed: 42 } }]);
      await page.getByRole('button', { name: 'Make World' }).click();
      for (let i = 0; i < 40 && reqs.length < 2; i++) await page.waitForTimeout(100);
      assert.deepEqual(reqs[1], ['post', { mode: 'complete360', sourceArtifactId: SRC, parameters: { seed: 42 } }]);
      // Reload re-reads the durable project list (a project added meanwhile appears).
      list = list.concat([{ id: 'wp-later', mode: 'quick3d', status: 'COMPLETE', currentStage: 'viewer', sourceArtifactId: SRC, artifacts: {} }]);
      const before = gets; await page.getByRole('button', { name: 'Reload' }).click();
      await page.getByText('wp-later').waitFor(); assert.ok(gets > before);
      // Retry on a FAILED project re-submits the same mode and the same source image (a new project request).
      const n = reqs.length; await page.getByRole('button', { name: 'Retry' }).click();
      for (let i = 0; i < 40 && reqs.length === n; i++) await page.waitForTimeout(100);
      assert.deepEqual(reqs[n], ['post', { mode: 'complete360', sourceArtifactId: SRC, parameters: { seed: 42 } }]);
      const pop = page.context().waitForEvent('page'); await page.getByRole('button', { name: 'Open Focus' }).click();
      const v = await pop; assert.match(v.url(), /world-viewer\.html\?project=wp-ok/); await v.close();
      assert.deepEqual(errors, []);
      await page.close();
    });

    await test('row 51: the World viewer renders the project point cloud, moves with W/drag, resets, and records that it was opened', async () => {
      const page = await browser.newPage({ viewport: { width: 900, height: 640 } });
      const errors = []; page.on('pageerror', e => errors.push(String(e))); const patches = [];
      await page.route('**/api/world/projects/wp-ok', r => { if (r.request().method() === 'PATCH') { patches.push(JSON.parse(r.request().postData())); return json(r, { ok: true }); } json(r, { id: 'wp-ok', mode: 'quick3d', status: 'COMPLETE', artifacts: { finalPly: { artifact_id: 'syn.ply', url: '/api/media/syn.ply', bytes: PLY.length } } }); });
      await page.route('**/api/media/syn.ply', r => r.fulfill({ contentType: 'application/vnd.ply', body: PLY }));
      await page.goto(srv.base + '/dexdiffusion/world-viewer.html?project=wp-ok', { waitUntil: 'domcontentloaded' });
      await page.waitForFunction(() => /Quick 3D World/.test(document.querySelector('#world-status').innerText), null, { timeout: 15000 });
      assert.match(await status(page), /Quick 3D World[\s\S]*600 vertices · displaying 600 points/, 'the viewer reports exactly what it loaded');
      await page.addStyleTag({ content: '#world-hud{visibility:hidden!important}' });
      await page.waitForTimeout(500);
      const a = await pixels(page, '#world-canvas'); assert.ok(a.lit > a.total * 0.002, `the point cloud is drawn (${a.lit} lit px)`);
      await page.keyboard.down('w'); await page.waitForTimeout(700); await page.keyboard.up('w'); await page.waitForTimeout(200);
      const b = await pixels(page, '#world-canvas'); assert.ok(gdiff(a, b) > 3, 'W moves the camera (' + gdiff(a, b) + ' changed cells)');
      const box = await page.locator('#world-canvas').boundingBox();
      await page.mouse.move(box.x + 300, box.y + 300); await page.mouse.down(); await page.mouse.move(box.x + 420, box.y + 300, { steps: 6 }); await page.mouse.up(); await page.waitForTimeout(250);
      const c = await pixels(page, '#world-canvas'); assert.ok(gdiff(b, c) > 3, 'dragging looks around (' + gdiff(b, c) + ' changed cells)');
      await page.keyboard.press('r'); await page.waitForTimeout(400);
      const d = await pixels(page, '#world-canvas'); assert.ok(gdiff(a, d) <= 2, 'R resets the camera (' + gdiff(a, d) + ' differing cells vs the first view)');
      assert.deepEqual(patches, [{ viewerState: { opened: true, lastArtifactId: 'syn.ply' } }], 'the viewer records opening, and only that');
      assert.deepEqual(errors, []);
      await page.close();
    });

    for (const [name, route, expect] of [
      ['an unknown project', r => json(r, { error: 'project not found' }, 404), /project not found/],
      ['a project without a viewer artifact', r => json(r, { id: 'wp-x', mode: 'quick3d', status: 'FAILED', artifacts: {} }), /no viewer-ready PLY artifact/],
    ]) {
      await test(`row 51: ${name} is reported plainly instead of an empty scene`, async () => {
        const page = await browser.newPage({ viewport: { width: 700, height: 500 } });
        await page.route('**/api/world/projects/wp-x', route);
        await page.goto(srv.base + '/dexdiffusion/world-viewer.html?project=wp-x', { waitUntil: 'domcontentloaded' });
        await page.waitForFunction(() => /unavailable/.test(document.querySelector('#world-status').innerText), null, { timeout: 10000 });
        const t = await status(page); assert.match(t, /World Focus unavailable/); assert.match(t, expect);
        await page.close();
      });
    }

    await test('row 51: a corrupt PLY does not leave a blank scene without explanation', async () => {
      const page = await browser.newPage({ viewport: { width: 700, height: 500 } });
      await page.route('**/api/world/projects/wp-ok', r => r.request().method() === 'PATCH' ? json(r, {}) : json(r, { id: 'wp-ok', mode: 'quick3d', status: 'COMPLETE', artifacts: { finalPly: { artifact_id: 'bad.ply', url: '/api/media/bad.ply' } } }));
      await page.route('**/api/media/bad.ply', r => r.fulfill({ contentType: 'application/vnd.ply', body: 'not a ply file' }));
      await page.goto(srv.base + '/dexdiffusion/world-viewer.html?project=wp-ok', { waitUntil: 'domcontentloaded' });
      await page.waitForFunction(() => /unavailable/.test(document.querySelector('#world-status').innerText), null, { timeout: 10000 });
      assert.match(await status(page), /World Focus unavailable/);
      await page.close();
    });
  } finally {
    await runCleanups();
  }
  process.exitCode = exitCode(results.some(r => r[0] !== 'PASS'));
})().catch(async e => { console.error(e); await runCleanups(); process.exitCode = 2; });
