'use strict';
// Create controls: real pixel readout, Square/Landscape/Portrait/Swap, Default VAE shown unless overridden, settings guide.
const assert = require('node:assert/strict');
const { chromium } = require('playwright-core');
const { startServer, installModelSnapshots, runner, launchBrowser, openStudio } = require('./helpers');
const { test, exitCode } = runner('create-controls');

(async () => {
  const srv = process.env.DEX_TEST_BASE ? { base: process.env.DEX_TEST_BASE, stop() {} } : await startServer();
  const browser = await launchBrowser(chromium);
  try {
    const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 } });
    const page = await ctx.newPage();
    const errors = []; page.on('pageerror', e => errors.push(String(e)));
    await installModelSnapshots(page, srv.base);
    await page.route('**/api/extra-networks**', r => r.fulfill({ json: { loras: [], vaes: [{ name: 'fixture-vae', path: 'x' }], embeddings: { count: 0, items: [] } } }));
    await openStudio(page, srv.base + '/dexdiffusion/', { waitUntil: 'domcontentloaded' });
    await page.waitForFunction(() => window.__dex && __dex.state.version === 2 && __dex.state.capabilityData && __dex.state.modelTargets && __dex.state.modelTargets.length > 3);
    await page.evaluate(() => { __dex.setScreen('create'); __dex.setState({ target: 'sd15', width: '512', height: '768' }); });
    await page.locator('[data-studio-advanced]').evaluate(el => { el.open = true; });
    const size = () => page.locator('[data-dex-field="pixel-size"]').innerText();
    await test('actual pixel dimensions, megapixels and orientation are shown and follow the inputs', async () => {
      await page.waitForSelector('[data-dex-field="pixel-size"]');
      await page.waitForFunction(() => /512 × 768 px · 0\.39 MP · portrait/.test(document.querySelector('[data-dex-field="pixel-size"]').textContent));
      await page.evaluate(() => __dex.setState({ width: '832', height: '512' }));
      await page.waitForFunction(() => /832 × 512 px · 0\.43 MP · landscape/.test(document.querySelector('[data-dex-field="pixel-size"]').textContent));
    });
    await test('Swap, Square, Portrait and Landscape controls change the real width/height', async () => {
      await page.evaluate(() => __dex.setState({ width: '512', height: '768' }));
      await page.click('button:text-is("Swap W↔H")');
      await page.waitForFunction(() => __dex.state.width === '768' && __dex.state.height === '512');
      await page.click('button:text-is("Square")');
      await page.waitForFunction(() => __dex.state.width === __dex.state.height);
      const sq = await page.evaluate(() => +__dex.state.width); assert.ok(sq >= 256 && sq % 8 === 0, 'square side ' + sq);
      await page.click('button:text-is("Portrait")');
      await page.waitForFunction(() => +__dex.state.height > +__dex.state.width);
      await page.click('button:text-is("Landscape")');
      await page.waitForFunction(() => +__dex.state.width > +__dex.state.height);
      for (const k of ['width', 'height']) assert.equal((await page.evaluate(k2 => +__dex.state[k2], k)) % 8, 0, k + ' stays a multiple of 8');
    });
    await test('the VAE selection defaults to Default VAE (the override choice is covered in edit-workbench)', async () => {
      assert.equal(await page.evaluate(() => __dex.state.selectedVae), 'default');
      assert.match(await page.locator('[data-resources="create"]').innerText(), /Default VAE|default/i);
    });
    await test('the settings guide opens and carries the truthful High-Res Refine and Source preparation text', async () => {
      await page.locator('[data-dex-field="settings-guide"] summary').click();
      await page.waitForFunction(() => document.querySelector('[data-dex-field="settings-guide"]').open);
      const t = await page.locator('[data-dex-field="settings-guide"]').innerText();
      assert.match(t, /pixel space/); assert.match(t, /Just resize/); assert.match(t, /Default VAE/);
    });
    await test('selecting LUSTIFY! APEX V8 highlights its accelerator LoRAs; a chip applies the server recipe and Off restores settings', async () => {
      const { buildLoraCards } = require('../../extra-networks');
      const { routesFor } = require('../../lora-runtime-policy');
      const files = [['sdxl_lightning_4step_lora.safetensors', 'sdxl-base'], ['Hyper-SDXL-8steps-CFG-lora.safetensors', 'sdxl-base'], ['lcm_sdxl.safetensors', 'sdxl-base'], ['lcm_sd15.safetensors', 'sd15']];
      const cardsFor = target => buildLoraCards(files.map(([filename, proven]) => ({ id: filename.replace(/\.safetensors$/, ''), filename, full_path: '/fixture/' + filename,
        proof_status: 'PROVEN', proof_target_ids: [proven], proof_backend: 'sdcpp', proof_apply_modes: ['immediately'], metal_inference_status: 'FUNCTIONAL_METAL', metal_target_ids: [proven],
        production_routes: Array.from(new Set([proven, target])).flatMap(t => routesFor(t, filename)) })), target);
      await page.unroute('**/api/extra-networks**');
      await page.route('**/api/extra-networks**', r => r.fulfill({ json: { loras: cardsFor(new URL(r.request().url()).searchParams.get('target')), vaes: [], embeddings: { count: 0, items: [] } } }));
      await page.route('**/api/models/secondary/activate', r => r.fulfill({ json: { ok: true, activeSecondaryModel: 'sdxl-lustify', modelState: {} } }));
      const lustify = await page.evaluate(() => (__dex.state.modelTargets || []).find(t => t.id === 'sdxl-lustify'));
      assert.ok(lustify, 'sdxl-lustify is in the real capability catalogue');
      assert.equal(lustify.family, 'sdxl', 'capabilities expose the server-resolved family');
      await page.evaluate(() => __dex.onSelectTarget('sdxl-lustify', { quiet: true }));
      await page.waitForFunction(() => __dex.state.target === 'sdxl-lustify' && __dex.state.assetsTarget === 'sdxl-lustify');
      await page.evaluate(() => __dex.setState({ steps: 30, cfg: 5, sampler: 'dpm++2m', scheduler: 'karras', createLora: { enabled: false, selectedId: '' } }));
      await page.waitForSelector('[data-dex-field="open-lora-picker"][data-accelerators-available="3"]');
      await page.click('[data-dex-field="open-lora-picker"]');
      await page.waitForSelector('[data-dex-field="lora-accelerator-group"]');
      assert.match(await page.locator('[data-dex-field="lora-accelerator-group"]').innerText(), /ACCELERATION FOR LUSTIFY! APEX V8/i);
      const chips = await page.$$eval('[data-accelerator-chip]', els => els.map(e => e.getAttribute('data-accelerator-chip')).sort());
      assert.deepEqual(chips, ['Hyper-SDXL-8steps-CFG-lora', 'lcm_sdxl', 'sdxl_lightning_4step_lora']);
      assert.equal(await page.locator('[data-accelerator-unproven]').count(), 3, 'family-only routes are labelled unproven');
      const settings = () => page.evaluate(() => [+__dex.state.steps, +__dex.state.cfg, __dex.state.sampler, __dex.state.scheduler]);
      await page.click('[data-accelerator-chip="sdxl_lightning_4step_lora"]');
      await page.waitForSelector('[data-accelerator-chip="sdxl_lightning_4step_lora"][aria-pressed="true"]');
      assert.deepEqual(await settings(), [4, 0, 'euler', 'sgm_uniform']);
      await page.click('[data-accelerator-chip="lcm_sdxl"]');
      await page.waitForSelector('[data-accelerator-chip="lcm_sdxl"][data-accelerator-active="true"]');
      assert.deepEqual(await settings(), [4, 1.5, 'lcm', 'lcm']);
      await page.click('[data-dex-field="accelerator-off-btn"]');
      await page.waitForFunction(() => !__dex.state.createLora.enabled);
      assert.deepEqual(await settings(), [30, 5, 'dpm++2m', 'karras'], 'previous settings restored');
    });
    assert.deepEqual(errors, []);
    await ctx.close();
  } finally { await srv.stop(); }
  process.exit(exitCode());
})();
