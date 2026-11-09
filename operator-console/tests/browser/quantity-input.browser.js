'use strict';
// Quantity must commit while the field is focused; the V2 DOM runtime maps onChange
// to native change (blur), which can lose the edit when an unrelated render occurs.
const assert = require('node:assert/strict');
const { chromium } = require('playwright-core');
const { startServer, installModelSnapshots, runner, launchBrowser, openStudio } = require('./helpers');
const { test, exitCode } = runner('quantity-input');

(async () => {
  const srv = process.env.DEX_TEST_BASE ? { base: process.env.DEX_TEST_BASE, stop() {} } : await startServer();
  const browser = await launchBrowser(chromium);
  try {
    const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 } });
    const page = await ctx.newPage();
    const errors = [];
    page.on('pageerror', e => errors.push(String(e)));
    await installModelSnapshots(page, srv.base);
    await openStudio(page, srv.base + '/dexdiffusion/');
    await page.waitForFunction(() => window.__dex && __dex._ws && __dex.state.capabilityData);
    await page.evaluate(() => { __dex.setScreen('create'); __dex.wsSet({ quantity: 8 }); });
    await page.locator('[data-studio-advanced]').evaluate(el => { el.open = true; });
    const quantity = page.locator('input[aria-label="Quantity"]');
    await quantity.waitFor({ state: 'visible' });

    await test('quantity edits commit before blur and survive unrelated re-renders', async () => {
      assert.equal(await quantity.inputValue(), '8');
      await quantity.fill('3');
      assert.equal(await page.evaluate(() => __dex._ws().quantity), '3', 'immediate state must not remain at 8');
      await page.evaluate(() => __dex.setState({ width: '640' }));
      await page.waitForTimeout(100);
      assert.equal(await quantity.inputValue(), '3', 'a background render must not restore the old value');
      await quantity.fill('12');
      assert.equal(await page.evaluate(() => __dex._ws().quantity), '12');
      assert.equal(await page.evaluate(() => __dex._createBody().quantity), 12, 'generation payload receives user selection');
    });

    await test('quantity remains selected after blur and reload', async () => {
      await quantity.press('Tab');
      assert.equal(await quantity.inputValue(), '12');
      assert.equal(await page.evaluate(() => JSON.parse(localStorage.getItem('dex_ws_session')).quantity), '12');
      await page.reload();
      await page.waitForFunction(() => window.__dex && __dex.state.capabilityData);
      await page.evaluate(() => __dex.setScreen('create'));
      await page.locator('[data-studio-advanced]').evaluate(el => { el.open = true; });
      assert.equal(await page.locator('input[aria-label="Quantity"]').inputValue(), '12');
      assert.equal(await page.evaluate(() => __dex._createBody().quantity), 12);
    });
    assert.deepEqual(errors, [], 'no browser errors');
    await ctx.close();
  } finally { await browser.close(); await srv.stop(); }
  process.exit(exitCode());
})().catch(e => { console.error(e.stack || e); process.exitCode = 1; });
