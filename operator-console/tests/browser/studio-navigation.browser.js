'use strict';
// Real rendered-button navigation contract for the normal V2 Studio profile.
// Run on a machine with Chrome installed: node tests/browser/studio-navigation.browser.js
const assert = require('node:assert/strict');
const { chromium } = require('playwright-core');
const { startServer, installModelSnapshots, launchBrowser, runner } = require('./helpers');
const { test, exitCode } = runner('studio-navigation');

(async () => {
  const server = process.env.DEX_TEST_BASE ? { base: process.env.DEX_TEST_BASE, stop() {} } : await startServer();
  let browser;
  try {
    browser = await launchBrowser(chromium);
    const context = await browser.newContext({ viewport: { width: 1440, height: 960 } });
    const page = await context.newPage();
    const errors = [];
    page.on('pageerror', error => errors.push(String(error)));
    await installModelSnapshots(page, server.base);
    await page.goto(server.base + '/dexdiffusion/', { waitUntil: 'domcontentloaded' });
    await page.waitForFunction(() => window.__dex && window.__dex.state.version === 2);

    const categories = [
      ['create', 'Create'], ['batch', 'Batch'], ['swap', 'Swap'], ['voice', 'Voice'], ['drama', 'Drama'],
      ['music', 'Music'], ['video', 'Video'], ['world', 'World'], ['3d', '3D'], ['library', 'Library'],
      ['edit', 'Edit'], ['enhance', 'Enhance'], ['models', 'Models'], ['system', 'System']
    ];
    await test('a clean normal profile lands on Create and exposes the exact 14 category destinations', async () => {
      assert.equal(await page.locator('[data-v="2"]').count(), 1);
      assert.equal(await page.locator('.studio-version-switch:visible').count(), 0);
      assert.equal(await page.locator('.studio-nav [data-studio-chip]').count(), 14);
      assert.equal(await page.locator('.studio-nav [data-category="create"]').getAttribute('data-active'), 'true');
    });

    await test('all 14 visible buttons navigate to their matching route; Swap stays unavailable', async () => {
      for (const [category, label] of categories) {
        const button = page.getByRole('button', { name: new RegExp('^' + label.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')) });
        await button.click();
        await page.waitForFunction(expected => window.__dex.state.screens[2] === expected, category === '3d' ? '3d' : category);
        assert.equal(await page.locator(`.studio-nav [data-category="${category}"]`).getAttribute('data-active'), 'true', `${label} is active after click`);
      }
      assert.match(await page.locator('[data-v="2"]').innerText(), /A Swap operation has not been defined and approved/);
    });

    await test('Video remains a reachable but non-executable destination', async () => {
      await page.getByRole('button', { name: /^Video/ }).click();
      const text = await page.locator('[data-v="2"]').innerText();
      assert.match(text, /Video generation is not implemented yet|Video generation is not available/i);
      assert.doesNotMatch(text, /Generate video/i);
    });
    assert.deepEqual(errors, []);
    await context.close();
  } finally {
    if (browser) await browser.close();
    await server.stop();
  }
  process.exit(exitCode());
})();
