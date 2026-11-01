'use strict';
// Visual Chat retention control regression. No Ollama calls, no saved sessions,
// and no synthetic claim that a credential was actually authenticated.
const assert = require('node:assert/strict');
const { chromium } = require('playwright-core');
const { startServer, launchBrowser, openStudio, runCleanups } = require('./helpers');

(async () => {
  const srv = await startServer();
  const browser = await launchBrowser(chromium);
  try {
    for (const width of [390, 1080]) {
      const page = await browser.newPage({ viewport: { width, height: 844 } });
      const errors = [];
      page.on('pageerror', error => errors.push(error.message));
      await openStudio(page, srv.base + '/dexdiffusion/', { waitUntil: 'domcontentloaded' });
      await page.evaluate(() => window.__dex.setScreen('chat'));
      const temp = page.locator('[data-chat-mode="temporary"]');
      const saved = page.locator('[data-chat-mode="saved"]');
      await temp.waitFor({ timeout: 12000 });
      assert.equal(await temp.getAttribute('aria-pressed'), 'true');
      assert.equal(await saved.getAttribute('aria-pressed'), 'false');
      assert.equal(await saved.isDisabled(), true, 'saved mode requires authorized history unlock');
      assert.match(await page.locator('[data-chat-retention-description]').innerText(),
        /Temporary Chat is not written to saved history/);
      assert.equal(await page.evaluate(() => __dex.state.chatSaveNext), false);
      // Only simulate the already-tested authorization result: control state.
      await page.evaluate(() => __dex.setState({ chatSavedSessionsLoaded: true }));
      await saved.click();
      await page.waitForFunction(() => __dex.state.chatSaveNext === true &&
        document.querySelector('[data-chat-mode="saved"]')?.getAttribute('aria-pressed') === 'true',
        null, { timeout: 5000 });
      assert.equal(await saved.getAttribute('aria-pressed'), 'true');
      assert.equal(await page.evaluate(() => __dex.state.chatSaveNext), true);
      assert.match(await page.locator('[data-chat-retention-description]').innerText(), /Saved Chat is explicit opt-in/);
      await page.locator('[data-chat-new="true"]').click();
      await page.waitForFunction(() => __dex.state.chatSaveNext === false &&
        document.querySelector('[data-chat-mode="temporary"]')?.getAttribute('aria-pressed') === 'true',
        null, { timeout: 5000 });
      assert.equal(await temp.getAttribute('aria-pressed'), 'true', 'New temporary chat resets opt-in');
      assert.equal(await page.evaluate(() => __dex.state.chatSaveNext), false);
      await saved.click();
      await page.waitForFunction(() => __dex.state.chatSaveNext === true, null, { timeout: 5000 });
      await temp.click();
      await page.waitForFunction(() => __dex.state.chatSaveNext === false, null, { timeout: 5000 });
      assert.equal(await page.evaluate(() => __dex.state.chatSaveNext), false);
      await page.evaluate(() => __dex.setState({
        chatSessionMode: 'saved', chatSessionId: 'fixture-owned-session'
      }));
      await page.waitForFunction(() =>
        document.querySelector('[data-chat-mode="temporary"]')?.disabled === true &&
        document.querySelector('[data-chat-mode="saved"]')?.disabled === true,
        null, { timeout: 5000 });
      assert.equal(await temp.isDisabled(), true, 'cannot silently change active saved session mode');
      assert.equal(await saved.isDisabled(), true);
      const geometry = await page.evaluate(() => ({
        scrollWidth: document.documentElement.scrollWidth, viewportWidth: innerWidth
      }));
      assert.ok(geometry.scrollWidth <= geometry.viewportWidth,
        'Chat retention controls must not cause mobile overflow: ' + JSON.stringify(geometry));
      assert.deepEqual(errors, []);
      await page.close();
    }
    console.log('OMNI_CHAT_MODES_PASS: temporary-by-default, saved-opt-in, reset, active-session lock, 390px parity');
  } finally {
    await runCleanups();
  }
})().catch(async error => {
  console.error(error);
  await runCleanups();
  process.exitCode = 1;
});
