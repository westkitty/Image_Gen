'use strict';
// LIVE end-to-end Enhance journey through the real UI against the real local model on Big Mac (opt-in; NOT part of npm test).
//   OLLAMA_BASE_URL=http://127.0.0.1:11436 node tests/live/enhance.live.js     (default: the project endpoint)
// Runs an ISOLATED console on a private port (so it never touches live jobs) wired to the given Ollama endpoint. Synthetic prompt only.
const assert = require('node:assert/strict');
const { chromium } = require('playwright-core');
process.env.OLLAMA_BASE_URL = process.env.OLLAMA_BASE_URL || 'http://127.0.0.1:11436';
const { startServer, installModelSnapshots, runner, launchBrowser } = require('../browser/helpers');
const { test, exitCode } = runner('enhance-live', { testMs: 240000, totalMs: 600000 });
const ORIGINAL = 'a red cube on a table';

(async () => {
  const srv = await startServer();
  const browser = await launchBrowser(chromium);
  try {
    const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 } });
    const page = await ctx.newPage();
    const errors = []; page.on('pageerror', e => errors.push(String(e)));
    await installModelSnapshots(page, srv.base);
    await page.route('**/api/extra-networks**', r => r.fulfill({ json: { loras: [], vaes: [], embeddings: { count: 0, items: [] } } }));
    await page.goto(srv.base + '/dexdiffusion/');
    await page.waitForFunction(() => window.__dex && __dex.state.capabilityData && __dex.state.modelTargets && __dex.state.modelTargets.length > 3);
    await page.evaluate(p => { __dex.setScreen('create'); __dex.setState({ target: 'sd15', prompt: p }); }, ORIGINAL);
    const enhanceBtn = page.locator('[data-enhance]').first();
    await test('the app sees the local model online (real status probe)', async () => {
      await page.waitForFunction(() => __dex.state.ollamaOnline === true, null, { timeout: 30000 }).catch(() => {});
      const st = await page.evaluate(() => ({ online: __dex.state.ollamaOnline, model: __dex.state.ollamaModel }));
      assert.equal(st.online, true, 'Enhance is offline: ' + JSON.stringify(st));
    });
    await test('Enhance returns a reviewed result from the real model; the original is preserved until Apply', async () => {
      await enhanceBtn.click();
      assert.match(await enhanceBtn.innerText(), /Cancel enhance/, 'progress is visible while the model works');
      await page.waitForFunction(() => !!(__dex.state.enhancementResult && __dex.state.enhancementResult.enhanced), null, { timeout: 120000 });
      const r = await page.evaluate(() => ({ prompt: __dex.state.prompt, res: __dex.state.enhancementResult }));
      assert.equal(r.prompt, ORIGINAL, 'the editor text is untouched before the user accepts');
      assert.equal(r.res.original, ORIGINAL); assert.ok(r.res.enhanced && r.res.enhanced !== ORIGINAL && r.res.enhanced.length > 10);
      const visible = await page.locator('text=Prompt Enhancement Review').count(); assert.ok(visible >= 1, 'review box is visible');
      assert.match(await page.locator('body').innerText(), new RegExp(r.res.enhanced.slice(0, 20).replace(/[.*+?^${}()|[\]\\]/g, '\\$&')), 'enhanced text is shown to the user');
    });
    await test('Apply replaces the prompt and Undo restores the exact original', async () => {
      await page.click('button:text-is("Apply Enhancement")');
      await page.waitForFunction(o => __dex.state.prompt !== o && __dex.state.previousPrompt === o, ORIGINAL);
      await page.click('button:has-text("Undo Enhance")');
      await page.waitForFunction(o => __dex.state.prompt === o, ORIGINAL);
    });
    await test('Cancel while the model is working returns control, leaves the prompt alone and shows no result', async () => {
      await enhanceBtn.click();
      await page.waitForFunction(() => __dex.state.enhancingPrompt === true);
      await enhanceBtn.click();
      await page.waitForFunction(() => __dex.state.enhancingPrompt === false && __dex.state.toasts.some(t => /Enhance cancelled/.test(t.msg)), null, { timeout: 10000 });
      assert.equal(await page.evaluate(() => __dex.state.prompt), ORIGINAL);
      assert.equal(await page.evaluate(() => !!__dex.state.enhancementResult), false);
    });
    assert.deepEqual(errors, []);
    await ctx.close();
  } finally { await srv.stop(); }
  process.exit(exitCode());
})();
