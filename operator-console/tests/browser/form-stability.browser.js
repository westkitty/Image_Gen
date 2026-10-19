'use strict';
// Regression: background re-renders (polling, SSE snapshots, capability loads) used to rebuild the whole Concept A
// DOM and drop focus/caret from the field being typed in. The runtime now carries focus, caret and scroll across.
// A re-render storm is forced from the page via the mounted instance; nothing is generated.
const assert = require('node:assert/strict');
const { chromium } = require('playwright-core');
const { startServer, installModelSnapshots, runner, launchBrowser, runCleanups } = require('./helpers');

const { test, results, exitCode } = runner('form-stability');

async function open(page, base) {
  const errors = [];
  page.on('pageerror', e => errors.push(String(e)));
  await installModelSnapshots(page, base);
  await page.route('**/api/models/secondary/activate', route => route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ modelState: {} }) }));
  await page.goto(base + '/dexdiffusion/', { waitUntil: 'domcontentloaded' });
  if (!(await page.locator('.ca-shell').count())) await page.locator('[data-vbtn="4"]').click();
  await page.waitForSelector('.ca-shell');
  await page.locator('.ca-nav-item', { hasText: 'Create' }).click();
  await page.waitForSelector('.ca-shell[data-ca-module="generate"]');
  return errors;
}
// Re-render the whole app every `everyMs` until stopped; returns how many remounts of the prompt box it caused.
const startStorm = (page, everyMs = 25) => page.evaluate(ms => {
  const inst = window.DCRuntime.lastInstance;
  window.__storm = { n: 0, detached: 0, stop: false, first: document.querySelector('[data-dex-field="prompt"]') };
  const tick = () => {
    if (window.__storm.stop) return;
    inst.setState({ _stormTick: ++window.__storm.n });
    const ta = document.querySelector('[data-dex-field="prompt"]');
    if (ta !== window.__storm.first) { window.__storm.detached++; window.__storm.first = ta; }
    setTimeout(tick, ms);
  };
  tick();
}, everyMs);
const stopStorm = page => page.evaluate(() => { window.__storm.stop = true; return { renders: window.__storm.n, remounts: window.__storm.detached }; });

(async () => {
  const srv = process.env.DEX_TEST_BASE ? { base: process.env.DEX_TEST_BASE, stop() {} } : await startServer();
  const browser = await launchBrowser(chromium);
  try {
    await test('typing in the prompt box survives a continuous re-render storm: no lost keys, focus kept', async () => {
      const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
      const errors = await open(page, srv.base);
      const box = page.locator('[data-dex-field="prompt"]');
      await box.click();
      await startStorm(page);
      const text = 'a red fox sitting in a snowy forest at golden hour';
      await page.keyboard.type(text, { delay: 15 });
      const stats = await stopStorm(page);
      assert.ok(stats.remounts >= 5, 'the storm really remounted the prompt box: ' + JSON.stringify(stats));
      assert.equal(await page.evaluate(() => document.activeElement === document.querySelector('[data-dex-field="prompt"]')), true, 'focus retained');
      assert.equal(await page.locator('[data-dex-field="prompt"]').inputValue(), text);
      assert.deepEqual(errors, []);
      await page.close();
    });

    await test('the caret stays where the user put it while the form is rebuilt', async () => {
      const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
      const errors = await open(page, srv.base);
      await page.locator('[data-dex-field="prompt"]').click();
      await page.keyboard.type('hello world');
      for (let i = 0; i < 5; i++) await page.keyboard.press('ArrowLeft');
      await startStorm(page);
      await page.waitForTimeout(300);
      await page.keyboard.type('X', { delay: 15 });
      await page.keyboard.type('Y', { delay: 15 });
      const stats = await stopStorm(page);
      assert.ok(stats.remounts >= 5, JSON.stringify(stats));
      assert.equal(await page.locator('[data-dex-field="prompt"]').inputValue(), 'hello XYworld');
      assert.deepEqual(errors, []);
      await page.close();
    });

    await test('other fields keep focus too: negative prompt text and numeric inputs', async () => {
      const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
      const errors = await open(page, srv.base);
      const sel = page.locator('select', { has: page.locator('option[value="sdxl-base"]') }).first();
      await sel.selectOption('sdxl-base');
      await page.waitForTimeout(800);
      await page.locator('[data-dex-field="negative-prompt"]').click();
      await startStorm(page);
      await page.keyboard.type('blurry, low quality', { delay: 15 });
      // Keep the storm running for a measured number of renders, not a CPU-dependent typing duration.
      await page.waitForFunction(() => window.__storm && window.__storm.n >= 10, null, { timeout: 7000 });
      const s1 = await stopStorm(page);
      assert.ok(s1.renders >= 10, JSON.stringify(s1));
      assert.equal(await page.locator('[data-dex-field="negative-prompt"]').inputValue(), 'blurry, low quality');
      await page.locator('[data-dex-field="clip-skip"]').click();   // click first: elements cannot be clicked mid-storm
      await startStorm(page);
      await page.keyboard.type('2', { delay: 15 });
      // Measure the required rerenders, independent of machine speed.
      await page.waitForFunction(() => window.__storm && window.__storm.n >= 5, null, { timeout: 7000 });
      const s2 = await stopStorm(page);
      assert.ok(s2.renders >= 5, JSON.stringify(s2));
      assert.equal(await page.locator('[data-dex-field="clip-skip"]').inputValue(), '2');
      assert.equal(await page.evaluate(() => document.activeElement && document.activeElement.getAttribute('data-dex-field')), 'clip-skip');
      assert.deepEqual(errors, []);
      await page.close();
    });

    await test('a persistent Node widget (the model picker) keeps keyboard focus across re-renders', async () => {
      const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
      const errors = [];
      page.on('pageerror', e => errors.push(String(e)));
      await installModelSnapshots(page, srv.base);
      await page.route('**/api/models/secondary/activate', route => route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ modelState: {} }) }));
      await page.goto(srv.base + '/dexdiffusion/', { waitUntil: 'domcontentloaded' });
      await page.waitForSelector('.ca-shell, [data-vbtn]');
      await page.locator('[data-vbtn="1"]').click();
      await page.waitForSelector('[data-model-picker="create"] > button');
      await page.waitForTimeout(1500);
      await page.locator('[data-model-picker="create"] > button').focus();
      const same = await page.evaluate(() => { window.__trigger = document.querySelector('[data-model-picker="create"] > button'); return document.activeElement === window.__trigger; });
      assert.equal(same, true, 'trigger focused before the storm');
      await startStorm(page, 40);
      await page.waitForTimeout(500);
      const stats = await stopStorm(page);
      assert.ok(stats.renders >= 5, JSON.stringify(stats));
      const after = await page.evaluate(() => ({ sameNode: document.querySelector('[data-model-picker="create"] > button') === window.__trigger, focused: document.activeElement === window.__trigger }));
      assert.equal(after.sameNode, true, 'the widget node itself survives re-renders');
      assert.equal(after.focused, true, 'and keeps focus');
      assert.deepEqual(errors, []);
      await page.close();
    });

    await test('typing straight after load and after a target switch keeps focus (the original startup churn)', async () => {
      for (let round = 0; round < 3; round++) {
        const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
        const errors = await open(page, srv.base);
        await page.locator('select', { has: page.locator('option[value="flux2-klein-4b"]') }).first().selectOption('flux2-klein-4b');
        await page.locator('[data-dex-field="prompt"]').click();
        await page.keyboard.type('a red fox (snowy:1.4) forest at dawn', { delay: 20 });
        await page.waitForTimeout(150);
        assert.equal(await page.locator('[data-dex-field="prompt"]').inputValue(), 'a red fox (snowy:1.4) forest at dawn', 'round ' + round);
        assert.equal(await page.evaluate(() => document.activeElement === document.querySelector('[data-dex-field="prompt"]')), true, 'focus round ' + round);
        assert.deepEqual(errors, []);
        await page.close();
      }
    });
  } finally {
    await runCleanups();
  }
  process.exitCode = exitCode(results.some(r => r[0] !== 'PASS'));
})().catch(async e => { console.error(e); await runCleanups(); process.exitCode = 2; });
