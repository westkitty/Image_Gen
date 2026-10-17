'use strict';
// Composer: one "N / limit" counter, any number of wildcard chips, reorder, and move between positive and negative.
// Uses synthetic wildcard names only.
const assert = require('node:assert/strict');
const { chromium } = require('playwright-core');
const { startServer, installModelSnapshots, runner, launchBrowser } = require('./helpers');
const { test, exitCode } = runner('wildcard-placement');

(async () => {
  const srv = process.env.DEX_TEST_BASE ? { base: process.env.DEX_TEST_BASE, stop() {} } : await startServer();
  const browser = await launchBrowser(chromium);
  try {
    const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 } });
    const page = await ctx.newPage();
    const errors = []; page.on('pageerror', e => errors.push(String(e)));
    await installModelSnapshots(page, srv.base);
    await page.route('**/api/extra-networks**', r => r.fulfill({ json: { loras: [], vaes: [], embeddings: { count: 0, items: [] } } }));
    await page.goto(srv.base + '/dexdiffusion/');
    await page.waitForFunction(() => window.__dex && __dex.state.modelTargets && __dex.state.modelTargets.length > 3 && __dex.state.capabilityData);
    await page.evaluate(() => __dex.setScreen('create'));
    const prompts = () => page.evaluate(() => ({ p: __dex.state.prompt, n: __dex.state.negPrompt }));
    await page.evaluate(() => __dex.setState({ prompt: 'one __aa__ two __bb__ three __cc__ four __dd__', negPrompt: 'blurry' }));

    await test('four wildcards are all shown; one compact counter in N / limit form', async () => {
      await page.waitForFunction(() => document.querySelectorAll('[data-wildcard-chip="positive"]').length === 4);
      const c = await page.locator('[data-prompt-counter]:visible').allInnerTexts();
      assert.equal(c.length, 1, 'exactly one visible counter');
      assert.match(c[0], /^\d+ \/ 1000$/);
      await page.fill('[data-dex-field="prompt"]', 'hello');
      await page.waitForFunction(() => document.querySelector('[data-prompt-counter]').textContent === '5 / 1000');
    });
    await test('reorder moves only the tokens and keeps surrounding text', async () => {
      await page.evaluate(() => __dex.setState({ prompt: 'one __aa__ two __bb__ three __cc__ four __dd__', negPrompt: 'blurry' }));
      await page.waitForFunction(() => document.querySelectorAll('[data-wildcard-chip="positive"]').length === 4);
      await page.click('button[aria-label="Move __cc__ earlier"]');
      assert.equal((await prompts()).p, 'one __aa__ two __cc__ three __bb__ four __dd__');
      await page.click('button[aria-label="Move __aa__ later"]');
      assert.equal((await prompts()).p, 'one __cc__ two __aa__ three __bb__ four __dd__');
      await page.waitForFunction(() => document.querySelector('button[aria-label="Move __cc__ earlier"]') && document.querySelector('button[aria-label="Move __cc__ earlier"]').disabled, null, { timeout: 5000 });
    });
    await test('move to the negative prompt and back', async () => {
      await page.click('button[aria-label="Move __aa__ to the negative prompt"]');
      let s = await prompts();
      assert.equal(s.p, 'one __cc__ two three __bb__ four __dd__');
      assert.equal(s.n, 'blurry, __aa__');
      await page.waitForSelector('[data-wildcard-chip="negative"]');
      await page.click('button[aria-label="Move __aa__ to the prompt"]');
      s = await prompts();
      assert.equal(s.n, 'blurry'); assert.match(s.p, /__aa__/);
    });
    assert.deepEqual(errors, []);
    await ctx.close();
  } finally { await srv.stop(); }
  process.exit(exitCode());
})();
