'use strict';
// P11: header-verified checkpoint files on the Models screen (stubbed inspector) and LoRA-tag validation by the real server.
const assert = require('node:assert/strict');
const { chromium } = require('playwright-core');
const { startServer, installModelSnapshots, installImageFixtures, runner, launchBrowser, runCleanups } = require('./helpers');

const FX = { 'fx-landscape.png': { w: 800, h: 500, meta: { operation: 'txt2img', target: 'sd15', seed: 1, steps: 20, cfg: 7, sampler: 'euler_a', scheduler: 'discrete', vae: 'auto', loras: [], gen_schema: 1, prompt_saved: false } } };
const { test, results, exitCode } = runner('model-files');
const ITEMS = [
  { kind: 'checkpoint', id: 'a', path: '/Volumes/wc2tb/ImageGen/checkpoints/sdxl/sd_xl_base_1.0.safetensors', filename: 'sd_xl_base_1.0.safetensors', size_bytes: 6938078334, header: { arch: 'sdxl', embedded_vae: true, dtypes: { F16: 2515 }, truncated: false }, error: null, agreement: { state: 'match', byName: 'sdxl', byHeader: 'sdxl' } },
  { kind: 'checkpoint', id: 'b', path: '/x/b.safetensors', filename: 'mystery_sd15_thing.safetensors', size_bytes: 4000000000, header: { arch: 'sdxl', embedded_vae: false, dtypes: { F32: 9 }, truncated: false }, error: null, agreement: { state: 'mismatch', byName: 'sd15', byHeader: 'sdxl' } },
  { kind: 'checkpoint', id: 'c', path: '/x/c.safetensors', filename: 'broken.safetensors', size_bytes: 10, header: null, error: 'implausible header length 5', agreement: null },
];

async function newPage(browser, base, inspect) {
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 } });
  const page = await ctx.newPage();
  const errors = [], posts = [];
  page.on('pageerror', e => errors.push(String(e)));
  await installModelSnapshots(page, base);
  await installImageFixtures(page, FX);
  await page.route('**/api/extra-networks**', r => r.fulfill({ json: { loras: [], vaes: [], embeddings: { count: 0, items: [] } } }));
  await page.route('**/api/models/inspect', r => { posts.push(r.request().postDataJSON()); inspect(r); });
  await page.goto(base + '/dexdiffusion/');
  await page.waitForFunction(() => window.__dex && __dex.state.modelTargets && __dex.state.modelTargets.length > 3 && __dex.state.capabilityData);
  await page.evaluate(() => { __dex.setScreen('system'); const ca = __dex._ca(); ca.settingsTab = 'capabilities'; __dex.caSync(); });
  await page.waitForSelector('[data-file-verification]');
  return { page, ctx, errors, posts };
}

(async () => {
  const srv = process.env.DEX_TEST_BASE ? { base: process.env.DEX_TEST_BASE, stop() {} } : await startServer();
  const browser = await launchBrowser(chromium);
  try {
    await test('Verify files lists header facts and flags a name/header mismatch and unreadable files', async () => {
      const { page, ctx, errors, posts } = await newPage(browser, srv.base, r => r.fulfill({ json: { items: ITEMS } }));
      await page.click('[data-file-verification] button:has-text("Verify files")');
      await page.waitForSelector('[data-file-row]');
      assert.deepEqual(posts[0], { kind: 'checkpoint', refresh: false });
      const rows = await page.locator('[data-file-row]').allInnerTexts();
      assert.equal(rows.length, 3);
      assert.match(rows[0], /sd_xl_base_1\.0\.safetensors[\s\S]*sdxl \+ VAE[\s\S]*name and header agree/);
      assert.match(rows[1], /NAME SAYS sd15, HEADER sdxl/);
      assert.match(rows[2], /unreadable[\s\S]*implausible header length/);
      assert.deepEqual(errors, []);
      await page.click('[data-file-verification] button:has-text("Re-read")');
      for (let i = 0; i < 30 && posts.length < 2; i++) await page.waitForTimeout(100);
      assert.equal(posts[1].refresh, true);
      await ctx.close();
    });
    await test('an unreachable compute host is reported, not hidden', async () => {
      const { page, ctx } = await newPage(browser, srv.base, r => r.fulfill({ status: 502, json: { error: 'Could not reach the compute host to read headers: timeout' } }));
      await page.click('[data-file-verification] button:has-text("Verify files")');
      await page.waitForSelector('[data-file-error]');
      assert.match(await page.locator('[data-file-error]').innerText(), /Could not reach the compute host/);
      await ctx.close();
    });
    await test('server: LoRA tags are validated strictly by the real validators', async () => {
      const preview = async (target, prompt) => { const r = await fetch(srv.base + '/api/preview/generation', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ target, prompt, steps: 8, width: 512, height: 512, seed: 1, quantity: 1 }) }); return { s: r.status, j: await r.json() }; };
      assert.match((await preview('sdxl-photonic', 'a cat <lora:x:abc>')).j.error, /not a number/);
      assert.match((await preview('sdxl-photonic', 'a cat <lora:x:0.5:0.2>')).j.error, /separate text-encoder/);
      assert.match((await preview('sdxl-photonic', 'a cat <lyco:x:1>')).j.error, /literal prompt text/);
      assert.match((await preview('flux2-klein-4b', 'a cat <lora:x:0.8>')).j.error, /not supported by the FLUX\.2/);
      assert.equal((await preview('sdxl-photonic', 'a cat (fluffy:1.2)')).s, 200);
      const insp = await fetch(srv.base + '/api/models/inspect', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ kind: 'nonsense' }) });
      assert.equal(insp.status, 400);
    });
  } finally {
    await browser.close(); srv.stop && srv.stop();
    await runCleanups();
  }
  process.exitCode = exitCode(results.some(r => r[0] !== 'PASS'));
})().catch(async e => { console.error(e); await runCleanups(); process.exitCode = 2; });
