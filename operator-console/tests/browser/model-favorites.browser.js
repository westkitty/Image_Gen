'use strict';
// Model picker: several favourites at once, persisted across reload, a Favorites filter, and a distinct icon per model.
const assert = require('node:assert/strict');
const { chromium } = require('playwright-core');
const { startServer, installModelSnapshots, runner, launchBrowser, openStudio } = require('./helpers');
const { test, exitCode } = runner('model-favorites');

(async () => {
  const srv = process.env.DEX_TEST_BASE ? { base: process.env.DEX_TEST_BASE, stop() {} } : await startServer();
  const browser = await launchBrowser(chromium);
  try {
    const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 } });
    const page = await ctx.newPage();
    const errors = []; page.on('pageerror', e => errors.push(String(e)));
    await installModelSnapshots(page, srv.base);
    await page.route('**/api/extra-networks**', r => r.fulfill({ json: { loras: [], vaes: [], embeddings: { count: 0, items: [] } } }));
    const boot = async () => {
      await openStudio(page, srv.base + '/dexdiffusion/');
      await page.waitForFunction(() => window.__dex && __dex.state.modelTargets && __dex.state.modelTargets.length > 3 && __dex.state.capabilityData);
      await page.evaluate(() => __dex.setScreen('create'));
      await page.click('[data-model-picker="create"] button[aria-haspopup="listbox"]');
      await page.waitForSelector('[data-model-fav]');
    };
    await boot();
    const ids = await page.$$eval('[data-model-fav]', els => els.map(e => e.getAttribute('data-model-fav')));
    assert.ok(ids.length >= 2, 'at least two models listed');
    await test('two favourites can be set at once; each model has its own icon', async () => {
      await page.evaluate(() => localStorage.removeItem('dexdiffusion.model.favorites.v1'));
      await page.click(`[data-model-fav="${ids[0]}"]`); await page.click(`[data-model-fav="${ids[1]}"]`);
      assert.equal(await page.locator(`[data-model-fav="${ids[0]}"]`).getAttribute('aria-pressed'), 'true');
      assert.equal(await page.locator(`[data-model-fav="${ids[1]}"]`).getAttribute('aria-pressed'), 'true');
      assert.ok(await page.locator('[data-model-icon]').count() >= 2);
      assert.equal(new Set(await page.$$eval('[data-model-icon]', e => e.map(x => x.getAttribute('data-model-icon')))).size, await page.locator('[data-model-icon]').count(), 'one icon per model id');
    });
    await test('Favorites filter shows only starred models and survives reload', async () => {
      await page.click('button:has-text("★ Favorites")');
      assert.deepEqual((await page.$$eval('[data-model-fav]', e => e.map(x => x.getAttribute('data-model-fav')))).sort(), [ids[0], ids[1]].sort());
      await boot();
      assert.equal(await page.locator(`[data-model-fav="${ids[0]}"]`).getAttribute('aria-pressed'), 'true');
      await page.click(`[data-model-fav="${ids[0]}"]`);
      assert.equal(await page.locator(`[data-model-fav="${ids[0]}"]`).getAttribute('aria-pressed'), 'false');
      assert.equal(await page.locator(`[data-model-fav="${ids[1]}"]`).getAttribute('aria-pressed'), 'true');
    });
    assert.deepEqual(errors, []);
    await ctx.close();
  } finally { await srv.stop(); }
  process.exit(exitCode());
})();
