'use strict';
// P12: PNG Info upload -> parsed fields -> Send to Create, and the server's export / infotext routes round-trip.
const assert = require('node:assert/strict');
const zlib = require('node:zlib');
const { chromium } = require('playwright-core');
const PngText = require('../../png-text');
const { startServer, installModelSnapshots, installImageFixtures, runner, launchBrowser, runCleanups, openStudio } = require('./helpers');

const FX = { 'fx-landscape.png': { w: 800, h: 500, meta: { operation: 'txt2img', target: 'sd15', seed: 1, steps: 20, cfg: 7, sampler: 'euler_a', scheduler: 'discrete', vae: 'auto', loras: [], gen_schema: 1, prompt_saved: false } } };
const { test, results, exitCode } = runner('png-info');

function png(texts) {
  const c = (type, data) => { const len = Buffer.alloc(4); len.writeUInt32BE(data.length); const t = Buffer.from(type, 'latin1'); const crc = Buffer.alloc(4); crc.writeUInt32BE(PngText.crc32(Buffer.concat([t, data]))); return Buffer.concat([len, t, data, crc]); };
  const ihdr = Buffer.alloc(13); ihdr.writeUInt32BE(1, 0); ihdr.writeUInt32BE(1, 4); ihdr[8] = 8; ihdr[9] = 2;
  return Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), c('IHDR', ihdr), ...texts.map(([k, v]) => c('tEXt', Buffer.from(k + '\0' + v, 'latin1'))), c('IDAT', zlib.deflateSync(Buffer.from([0, 255, 0, 0]))), c('IEND', Buffer.alloc(0))]);
}
const A1111 = 'a red fox in snow\nNegative prompt: blurry\nSteps: 28, Sampler: Euler a, Schedule type: Karras, CFG scale: 6.5, Seed: 4242, Size: 640x384, Model hash: abcdef1234, Model: totally-unknown-model, Clip skip: 2, Variation seed: 7, Version: v1.6.0';

async function newPage(browser, base) {
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 } });
  const page = await ctx.newPage();
  const errors = [];
  page.on('pageerror', e => errors.push(String(e)));
  await installModelSnapshots(page, base);
  await installImageFixtures(page, FX);
  await page.route('**/api/extra-networks**', r => r.fulfill({ json: { loras: [], vaes: [], embeddings: { count: 0, items: [] } } }));
  await page.route('**/api/library/images**', r => r.fulfill({ json: { filter: 'all', total: 0, items: [] } }));
  await openStudio(page, base + '/dexdiffusion/');
  await page.waitForFunction(() => window.__dex && __dex.state.modelTargets && __dex.state.modelTargets.length > 3 && __dex.state.capabilityData);
  await page.evaluate(() => __dex.setScreen('library'));
  await page.waitForSelector('[data-pnginfo-panel]');
  return { page, ctx, errors };
}

(async () => {
  const srv = process.env.DEX_TEST_BASE ? { base: process.env.DEX_TEST_BASE, stop() {} } : await startServer({ seedCanonicalImage: { id: 'fixture-canonical.png', width: 32, height: 24, recordIdentity: true } });
  const browser = await launchBrowser(chromium);
  try {
    await test('uploading an A1111 PNG lists every field with its state and Send to Create restores the supported ones', async () => {
      const { page, ctx, errors } = await newPage(browser, srv.base);
      await page.setInputFiles('[data-pnginfo-file]', { name: 'fox.png', mimeType: 'image/png', buffer: png([['parameters', A1111]]) });
      await page.waitForSelector('[data-pnginfo-result="a1111"]');
      const state = k => page.locator('[data-pnginfo-field="' + k + '"]').getAttribute('data-state');
      assert.equal(await state('Steps'), 'restorable'); assert.equal(await state('Sampler'), 'restorable');
      assert.equal(await state('Variation seed'), 'unavailable'); assert.equal(await state('Model hash'), 'unverified'); assert.equal(await state('Model'), 'unverified');
      assert.match(await page.locator('[data-pnginfo-field="Variation seed"]').innerText(), /not supported by the installed sd-cli/);
      assert.match(await page.locator('[data-pnginfo-result]').innerText(), /not an installed target/);
      await page.click('[data-pnginfo-panel] button:has-text("Send to Create")');
      await page.waitForFunction(() => __dex.state.seed === '4242');
      const st = await page.evaluate(() => { const s = __dex.state; return { steps: +s.steps, cfg: +s.cfg, w: +s.width, h: +s.height, sampler: s.sampler, scheduler: s.scheduler, clip: +s.clipSkip, prompt: s.prompt, neg: s.negPrompt, screen: s.screens[s.version] }; });
      assert.deepEqual(st, { steps: 28, cfg: 6.5, w: 640, h: 384, sampler: 'euler_a', scheduler: 'karras', clip: 2, prompt: 'a red fox in snow', neg: 'blurry', screen: 'create' });
      assert.deepEqual(errors, []);
      await ctx.close();
    });
    await test('a PNG without metadata, a ComfyUI PNG and a non-PNG are each explained', async () => {
      const { page, ctx } = await newPage(browser, srv.base);
      await page.setInputFiles('[data-pnginfo-file]', { name: 'plain.png', mimeType: 'image/png', buffer: png([]) });
      await page.waitForSelector('[data-pnginfo-result="none"]');
      assert.match(await page.locator('[data-pnginfo-result]').innerText(), /No generation metadata found/);
      await page.setInputFiles('[data-pnginfo-file]', { name: 'comfy.png', mimeType: 'image/png', buffer: png([['prompt', '{"3":{}}'], ['workflow', '{}']]) });
      await page.waitForSelector('[data-pnginfo-result="comfyui"]');
      assert.match(await page.locator('[data-pnginfo-result]').innerText(), /not converted/);
      await page.setInputFiles('[data-pnginfo-file]', { name: 'x.png', mimeType: 'image/png', buffer: Buffer.from('GIF89a not a png') });
      await page.waitForSelector('[data-pnginfo-error]');
      assert.match(await page.locator('[data-pnginfo-error]').innerText(), /Not a PNG/);
      await ctx.close();
    });
    await test('server: export with metadata embeds the same infotext the infotext route returns; plain export is byte-identical', async () => {
      const lib = await (await fetch(srv.base + '/api/library/images?filter=all')).json();
      const pick = lib.items.find(it => it.meta && it.meta.steps && it.meta.target && /\.png$/i.test(it.id));
      assert.ok(pick, 'the library has at least one image with recorded settings');
      const id = encodeURIComponent(pick.id);
      const info = await fetch(srv.base + '/api/images/' + id + '/infotext');
      assert.equal(info.status, 200);
      const text = await info.text();
      assert.match(text, /Steps: \d+/); assert.match(text, /Version: DexDiffusion/);
      const exp = await fetch(srv.base + '/api/images/' + id + '/export?metadata=1');
      assert.equal(exp.status, 200);
      const buf = Buffer.from(await exp.arrayBuffer());
      const embedded = PngText.readTextChunks(buf).filter(c => c.key === 'parameters');
      assert.equal(embedded.length, 1, 'any pre-existing parameters chunk is replaced, never duplicated');
      assert.equal(embedded[0].text, text);
      const plain = Buffer.from(await (await fetch(srv.base + '/api/images/' + id + '/export')).arrayBuffer());
      const orig = Buffer.from(await (await fetch(srv.base + '/api/images/' + id)).arrayBuffer());
      assert.ok(plain.equals(orig), 'plain export is the canonical file, unchanged');
      // images made with prompt saving on may already carry sd-cli's own `parameters` chunk: the plain export must not change that
      assert.deepEqual(PngText.readTextChunks(plain), PngText.readTextChunks(orig));
      // privacy: without ?prompt=0 the prompt is only present if it was saved; with prompt=0 it never is
      const noPrompt = await (await fetch(srv.base + '/api/images/' + id + '/infotext?prompt=0')).text();
      assert.doesNotMatch(noPrompt, /Negative prompt:/);
      // the exported file reads back through PNG Info and restores the same steps
      const r = await fetch(srv.base + '/api/pnginfo', { method: 'POST', headers: { 'content-type': 'image/png' }, body: buf });
      const j = await r.json();
      assert.equal(j.source, 'a1111'); assert.equal(j.create.settings.steps, pick.meta.steps);
      assert.equal((await fetch(srv.base + '/api/images/nope.png/export?metadata=1')).status, 404);
      assert.equal((await fetch(srv.base + '/api/pnginfo', { method: 'POST', headers: { 'content-type': 'image/png' }, body: Buffer.alloc(0) })).status, 400);
    });
  } finally {
    await browser.close(); srv.stop && srv.stop();
    await runCleanups();
  }
  process.exitCode = exitCode(results.some(r => r[0] !== 'PASS'));
})().catch(async e => { console.error(e); await runCleanups(); process.exitCode = 2; });
