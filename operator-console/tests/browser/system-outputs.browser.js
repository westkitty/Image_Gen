'use strict';
// System "Where outputs go" pull-down, and the prompt syntax note living in the Prompt Builder pop-up.
const assert = require('node:assert/strict');
const { chromium } = require('playwright-core');
const { startServer, installModelSnapshots, runner, launchBrowser, openStudio } = require('./helpers');
const { results, test, exitCode } = runner('system-outputs');

(async () => {
  const srv = await startServer();
  const browser = await launchBrowser(chromium);
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 } });
  await ctx.grantPermissions(['clipboard-read', 'clipboard-write']);
  const page = await ctx.newPage();
  const errors = []; page.on('pageerror', e => errors.push(String(e)));
  await installModelSnapshots(page, srv.base);
  const AUDIO = '/Volumes/wc2tb/DexDiffusion/output/audio';
  const outputs = [
    { id: 'images', label: 'Images', device: 'MacBook', path: '/Users/andrew/images_made' },
    { id: 'audio', label: 'Audio', device: 'WC2TB', path: AUDIO, share: 'smb://100.67.12.66/wc2tb/DexDiffusion/output/audio' },
  ];
  await page.route('**/api/system-info', async r => {
    const res = await r.fetch(); const json = await res.json();
    json.storage = Object.assign({}, json.storage, { outputs });
    r.fulfill({ response: res, json });
  });
  try {
    await openStudio(page, srv.base);

    await test('the prompt syntax note is in the pop-up; the token count stays under the prompt', async () => {
      assert.equal(await page.locator('[data-dex-field="prompt-syntax-help"]').count(), 0);
      const main = page.locator('[data-dex-field="token-count"]').first();
      assert.match(await main.innerText(), /Token count/);
      const promptBox = await page.locator('dex-prompt-field[data-dex-field="prompt"]').boundingBox();
      const tokenBox = await main.boundingBox();
      assert.ok(tokenBox.y >= promptBox.y + promptBox.height, 'token count is below the prompt box');
      assert.ok(Math.abs(tokenBox.x - promptBox.x) < 12, 'token count is at the left of the prompt box');
      await page.evaluate(() => __dex.openPromptBuilder({ field: 'prompt', tab: 'wildcards' }));
      assert.match(await page.locator('[data-dex-field="prompt-syntax-help"]').innerText(), /Supported|plain language/);
      assert.match(await page.locator('[data-pb-field="construct"] ~ [data-dex-field="token-count"]').innerText(), /Token count/);
      await page.keyboard.press('Escape');
    });

    await test('System lists where outputs go, copies paths, and stays open across a refresh', async () => {
      await page.evaluate(async () => { await __dex.loadSystemInfo(); __dex.setScreen('system'); });
      const panel = page.locator('[data-output-locations]:visible').first();
      await panel.locator('summary').click();
      assert.equal(await panel.locator('[data-output-path="audio"]').innerText(), AUDIO);
      await panel.locator('[data-output-location="audio"] button', { hasText: 'Copy path' }).click();
      await page.waitForFunction(p => navigator.clipboard.readText().then(t => t === p), AUDIO);
      await panel.locator('[data-output-location="audio"] button', { hasText: 'Copy network link' }).click();
      await page.waitForFunction(() => navigator.clipboard.readText().then(t => t.startsWith('smb://')));
      await page.evaluate(() => __dex.loadSystemInfo());
      await page.waitForTimeout(200);
      assert.equal(await page.locator('[data-output-locations]:visible').first().evaluate(d => d.open), true);
    });

    await test('Open in Finder: the app uses its bridge; a browser explains a MacBook folder and copies its path', async () => {
      const panel = page.locator('[data-output-locations]:visible').first();
      await panel.locator('[data-output-location="images"] button', { hasText: 'Open in Finder' }).click();
      await page.waitForFunction(() => navigator.clipboard.readText().then(t => t === '/Users/andrew/images_made'));
      await page.getByText(/A browser cannot open this MacBook folder/).first().waitFor();
      const sent = await page.evaluate(async path => {
        const messages = [];
        window.__dexNativeWrapper = true;
        window.webkit = { messageHandlers: { dexOutputFolder: { postMessage: async m => { messages.push(m); return 'opened'; } } } };
        await __dex.openOutputFolder({ label: 'Audio', path });
        return messages;
      }, AUDIO);
      assert.deepEqual(sent, [{ path: AUDIO }]);
      assert.deepEqual(errors, []);
    });
  } finally {
    await browser.close(); await srv.stop();
  }
  process.exit(exitCode(results.some(result => result[0] === 'FAIL')));
})();
