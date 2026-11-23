'use strict';
// Visual Chat retention control regression. No Ollama calls, no saved sessions,
// and no synthetic claim that a credential was actually authenticated.
const assert = require('node:assert/strict');
const { chromium } = require('playwright-core');
const { startServer, launchBrowser, openStudio, runCleanups } = require('./helpers');
const { resolveOutputDir, createOwnedWriter } = require('./safe-output');
const OUT = resolveOutputDir(process.env.DEX_BROWSER_OUTPUT_DIR, { label: 'chat' });
const WRITER = createOwnedWriter(OUT);
const outPath = n => WRITER.pathFor(n);

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

    // Verify storage permission diagnostics, History sub-tab modal opening, Cmd/Ctrl+Enter send, and desktop/mobile renders.
    {
      const page = await browser.newPage({ viewport: { width: 1280, height: 860 } });
      const errors = [];
      page.on('pageerror', error => errors.push(error.message));
      await page.route('**/api/ollama/status', r => r.fulfill({ json: { baseUrl: 'http://127.0.0.1:11434', models: [] } }));
      await page.route('**/api/chat/models', r => r.fulfill({
        json: {
          models: [{ name: 'gemma3:4b', label: 'gemma3:4b', class: 'light', installed: false }],
          default: 'gemma3:4b',
          base_loopback: true,
          storage_error: {
            code: 'ollama-storage-permission-denied',
            message: 'Ollama cannot read its model storage (macOS Removable Volumes permission denied on Big Mac).',
            detail: 'open /Volumes/wc2tb/DexDiffusion/models/ollama/manifests-v2/ollama.com/library/gemma3/4b: operation not permitted',
          },
        },
      }));
      await openStudio(page, srv.base + '/dexdiffusion/', { waitUntil: 'domcontentloaded' });
      await page.evaluate(() => window.__dex.setScreen('chat'));
      await page.locator('[data-chat-refresh]').click();
      await page.locator('[data-chat-storage-error="true"]').waitFor({ timeout: 10000 });
      assert.match(await page.locator('[data-chat-status="true"]').innerText(), /Storage blocked/);
      assert.match(await page.locator('[data-chat-storage-error="true"]').innerText(), /Removable Volumes permission denied/);
      assert.equal(await page.locator('[data-chat-composer]').isDisabled(), true);
      await page.screenshot({ path: outPath('chat-storage-blocked.png') });

      // Clicking History sub-tab opens chat-settings modal.
      await page.locator('[data-subnav-leaf="history"]').click();
      await page.locator('[data-dex-modal="chat-settings"]').waitFor({ timeout: 5000 });
      await page.keyboard.press('Escape');
      await page.locator('[data-dex-modal="chat-settings"]').waitFor({ state: 'detached' });

      // Switch route mocks to ready model + conversation fixture and test Control+Enter send + responsive layouts.
      await page.unroute('**/api/chat/models');
      await page.route('**/api/chat/models', r => r.fulfill({
        json: { models: [{ name: 'gemma3:4b', label: 'gemma3:4b', class: 'light', installed: true }], default: 'gemma3:4b', base_loopback: true },
      }));
      const sid = 'cs_' + 'c'.repeat(32);
      const messages = [];
      await page.route('**/api/chat/sessions', r => r.fulfill({ status: 201, json: { session_id: sid, mode: 'temporary', model: 'gemma3:4b' } }));
      await page.route('**/api/chat/sessions/*', r => r.fulfill({ json: { session_id: sid, mode: 'temporary', model: 'gemma3:4b', messages } }));
      await page.route('**/api/ollama/chat/stream', r => {
        const body = r.request().postDataJSON();
        const aid = 'cm_' + 'd'.repeat(32);
        messages.push({ message_id: 'cm_' + 'e'.repeat(32), role: 'user', content: body.content, status: 'complete' });
        messages.push({ message_id: aid, role: 'assistant', content: 'Ready reply from Control+Enter.', status: 'complete' });
        const p = extra => JSON.stringify({ v: 'dex.chat.v1', session_id: sid, request_id: body.request_id, assistant_message_id: aid, ...extra });
        return r.fulfill({
          status: 200,
          contentType: 'text/event-stream',
          body: `event: started\ndata: ${p({ model: body.model })}\n\nevent: delta\ndata: ${p({ index: 0, text: 'Ready reply from Control+Enter.' })}\n\nevent: done\ndata: ${p({ done_reason: 'stop' })}\n\n`,
        });
      });
      await page.locator('[data-chat-refresh]').click();
      await page.locator('[data-chat-status="generation"] [data-chat-state="ready"]').waitFor({ timeout: 5000 });
      await page.locator('[data-chat-starter]').first().click();
      await page.waitForFunction(() => (__dex.state.chatDraft || '').length > 10);
      await page.locator('[data-chat-composer]').fill('Hello via Control+Enter');
      await page.locator('[data-chat-composer]').press('Control+Enter');
      await page.locator('[data-chat-message="assistant"]').filter({ hasText: 'Ready reply from Control+Enter.' }).waitFor({ timeout: 8000 });
      const desktopGeo = await page.evaluate(() => ({ scrollWidth: document.documentElement.scrollWidth, viewportWidth: innerWidth }));
      assert.ok(desktopGeo.scrollWidth <= desktopGeo.viewportWidth, 'Desktop overflow: ' + JSON.stringify(desktopGeo));
      await page.screenshot({ path: outPath('chat-ready-desktop.png') });

      await page.setViewportSize({ width: 390, height: 844 });
      await page.waitForTimeout(250);
      const mobileGeo = await page.evaluate(() => ({ scrollWidth: document.documentElement.scrollWidth, viewportWidth: innerWidth }));
      assert.ok(mobileGeo.scrollWidth <= mobileGeo.viewportWidth, 'Mobile 390px overflow: ' + JSON.stringify(mobileGeo));
      await page.screenshot({ path: outPath('chat-ready-mobile.png') });
      assert.deepEqual(errors, []);
      await page.close();
    }
    console.log('OMNI_CHAT_MODES_PASS: temporary-by-default, saved-opt-in, reset, active-session lock, storage-error-banner, history-subtab, ctrl-enter, 390px+1280px parity | OUT=' + OUT);
  } finally {
    await runCleanups();
  }
})().catch(async error => {
  console.error(error);
  await runCleanups();
  process.exitCode = 1;
});
