'use strict';
// Unified Studio Phase 4 in real Chromium: the flat 14-chip row stays the default, and the opt-in masters
// layout (localStorage dex_studio_layout=masters) navigates, remembers leaves, roves focus, shows visible focus,
// keeps the page free of horizontal overflow at 390 px and desktop size, and renders an honest Chat placeholder.
// Ollama endpoints are fixtures here: nothing reaches a model.
const assert = require('node:assert/strict');
const { chromium } = require('playwright-core');
const { startServer, launchBrowser, openStudio, runCleanups } = require('./helpers');

async function open(browser, base, { width, height, layout, reducedMotion = 'no-preference' }) {
  const page = await browser.newPage({ viewport: { width, height }, reducedMotion });
  const errors = [];
  page.on('pageerror', e => errors.push(e.message));
  if (layout) await page.addInitScript(v => localStorage.setItem('dex_studio_layout', v), layout);
  await page.route('**/api/ollama/status', r => r.fulfill({ json: { baseUrl: 'http://127.0.0.1:11436', models: [{ name: 'gemma3:4b', modified_at: 'x', size: 1 }] } }));
  await page.route('**/api/chat/models', r => r.fulfill({ status: 404, json: { error: 'chat-disabled' } }));
  await page.route('**/api/ollama/enhance', r => r.fulfill({ status: 409, json: { error: 'fixture: no inference' } }));
  await openStudio(page, base + '/dexdiffusion/', { waitUntil: 'domcontentloaded', timeout: 30000 });
  page.setDefaultTimeout(6000);
  return { page, errors };
}
const overflow = page => page.evaluate(() => ({ scroll: document.documentElement.scrollWidth, inner: window.innerWidth, body: document.body.scrollWidth }));

(async () => {
  const { base } = await startServer();
  const browser = await launchBrowser(chromium);
  const evidence = [];
  for (const [width, height] of [[1348, 735], [390, 844]]) {
    // Default: flat, unchanged.
    {
      const { page, errors } = await open(browser, base, { width, height });
      await page.locator('[data-studio-nav]').waitFor({ state: 'visible' });
      assert.equal(await page.locator('[data-tab]').count(), 14);
      assert.equal(await page.locator('[data-master-tab]').count(), 0);
      assert.equal(await page.locator('[data-studio-layout]').getAttribute('data-studio-layout'), 'flat');
      const o = await overflow(page);
      assert.ok(o.scroll <= o.inner, `flat: no horizontal page overflow at ${width}px ${JSON.stringify(o)}`);
      await page.locator('[data-studio-category="system"]').click();
      await page.waitForFunction(() => window.__dex && __dex.state.screens[2] === 'system');
      await page.locator('[data-studio-layout-select]').selectOption('masters');
      await page.locator('[data-master-bar]').waitFor({ state: 'visible' });
      assert.equal(await page.locator('[data-master-tab]').count(), 5, 'the opt-in is discoverable from System');
      await page.locator('[data-studio-layout-select]').selectOption('flat');
      await page.locator('[data-studio-nav]').waitFor({ state: 'visible' });
      assert.equal(await page.locator('[data-tab]').count(), 14);
      assert.deepEqual(errors, []);
      evidence.push({ layout: 'flat', size: `${width}x${height}`, chips: 14, overflow: o });
      await page.close();
    }
    // Opt-in masters layout.
    {
      const { page, errors } = await open(browser, base, { width, height, layout: 'masters' });
      await page.locator('[data-master-bar]').waitFor({ state: 'visible' });
      assert.equal(await page.locator('[data-tab]').count(), 0, 'no flat chips in the masters layout');
      assert.deepEqual(await page.locator('[data-master-tab]').allTextContents(), ['Chat', 'Image', 'Audio', 'Video', '3D']);
      assert.equal(await page.getByRole('tab', { name: 'Image' }).getAttribute('aria-selected'), 'true');
      assert.equal(await page.locator('[data-subnav-leaf][aria-current="page"]').textContent(), 'Create');
      // Pointer and touch-size targets are operable.
      await page.getByRole('tab', { name: 'Audio' }).click();
      await page.waitForFunction(() => __dex.state.screens[2] === 'voice');
      await page.locator('[data-subnav-leaf="drama"]').click();
      await page.waitForFunction(() => __dex.state.screens[2] === 'drama');
      await page.getByRole('tab', { name: 'Image' }).click();
      await page.waitForFunction(() => __dex.state.screens[2] === 'create');
      await page.getByRole('tab', { name: 'Audio' }).click();
      await page.waitForFunction(() => __dex.state.screens[2] === 'drama');
      const box = await page.getByRole('tab', { name: 'Audio' }).boundingBox();
      assert.ok(box.height >= 36, 'master targets are at least 36 px tall: ' + JSON.stringify(box));
      // Keyboard: roving focus and a visible focus indicator.
      await page.getByRole('tab', { name: 'Audio' }).focus();
      await page.keyboard.press('ArrowRight');
      const focused = await page.evaluate(() => { const el = document.activeElement; const cs = getComputedStyle(el); return { id: el.getAttribute('data-master-tab'), tabindex: el.getAttribute('tabindex'), ring: cs.boxShadow, outline: cs.outlineStyle }; });
      assert.equal(focused.id, 'video');
      assert.equal(focused.tabindex, '0');
      assert.ok(focused.ring !== 'none' || focused.outline !== 'none', 'focus is visible: ' + JSON.stringify(focused));
      await page.keyboard.press('Enter');
      await page.waitForFunction(() => __dex.state.screens[2] === 'video');
      assert.match(await page.locator('[data-scroll-pane]').first().textContent(), /video/i);
      // Utilities and the Jobs drawer.
      await page.locator('[data-studio-utility="library"]').click();
      await page.waitForFunction(() => __dex.state.screens[2] === 'library');
      assert.equal(await page.locator('[data-studio-utility="library"]').getAttribute('aria-current'), 'page');
      assert.equal(await page.locator('header [data-studio-jobs]').count(), 1);
      // Chat placeholder states (fixture Ollama: connected, feature off).
      await page.getByRole('tab', { name: 'Chat' }).click();
      await page.locator('[data-chat-status="feature"] [data-chat-state="not_activated"]').waitFor();
      assert.equal(await page.locator('[data-chat-status="connection"] [data-chat-state]').getAttribute('data-chat-state'), 'available');
      assert.equal(await page.locator('[data-chat-status="generation"] [data-chat-state]').getAttribute('data-chat-state'), 'unavailable');
      assert.equal(await page.locator('[data-chat-composer]').isDisabled(), true);
      assert.equal(await page.locator('[data-chat-send]').isDisabled(), true);
      const o = await overflow(page);
      assert.ok(o.scroll <= o.inner, `masters: no horizontal page overflow at ${width}px ${JSON.stringify(o)}`);
      // Reload keeps the leaf and the layout.
      await page.reload({ waitUntil: 'domcontentloaded' });
      await page.waitForFunction(() => window.__dex && __dex.state.screens[2] === 'chat');
      assert.equal(await page.getByRole('tab', { name: 'Chat' }).getAttribute('aria-selected'), 'true');
      assert.deepEqual(errors, []);
      evidence.push({ layout: 'masters', size: `${width}x${height}`, masters: 5, focus: focused, overflow: o });
      await page.close();
    }
  }
  // Fixture stream through the real browser transport. The production feature flag stays off.
  {
    const { page, errors } = await open(browser, base, { width: 1348, height: 735, layout: 'masters' });
    const sid = 'cs_' + 'a'.repeat(32);
    let messages = [], requestCount = 0, saved = false, savedCreates = 0;
    await page.route('**/api/chat/models', r => r.fulfill({ json: { models: [
      { name: 'gemma3:4b', installed: true }, { name: 'qwen3.8:27b-mlx', installed: true }
    ], default: 'gemma3:4b' } }));
    await page.route('**/api/chat/sessions', r => {
      if (r.request().method() === 'GET') return r.fulfill({ json: { sessions: saved ? [{ session_id: sid, model: 'gemma3:4b', created_at: '2026-10-23T00:00:00Z', message_count: messages.length }] : [] } });
      const body = r.request().postDataJSON();
      if (body.mode === 'saved') { assert.equal(body.consent, true); saved = true; savedCreates++; }
      return r.fulfill({ status: 201, json: { session_id: sid, mode: body.mode, model: body.model } });
    });
    await page.route('**/api/chat/sessions/*', r => {
      if (r.request().method() === 'DELETE') { saved = false; messages = []; return r.fulfill({ status: 204 }); }
      if (r.request().url().endsWith('/export')) return r.fulfill({ json: { schema: 'dex.chat.export.v1', session: { session_id: sid, mode: 'saved', messages } } });
      return r.fulfill({ json: { session_id: sid, mode: saved ? 'saved' : 'temporary', messages } });
    });
    await page.route('**/api/ollama/chat/stream', r => {
      const body = r.request().postDataJSON();
      requestCount++;
      const text = 'Fixture reply ' + requestCount;
      const aid = 'cm_' + String(requestCount).padStart(32, '0');
      if (body.action === 'send') messages.push({ message_id: 'cm_' + 'b'.repeat(32), role: 'user', content: body.content, status: 'complete' });
      messages.push({ message_id: aid, role: 'assistant', content: text, status: 'complete' });
      const payload = extra => JSON.stringify({ v: 'dex.chat.v1', session_id: sid, request_id: body.request_id, assistant_message_id: aid, ...extra });
      const stream = `event: started\ndata: ${payload({ model: body.model })}\n\n` +
        `event: delta\ndata: ${payload({ index: 0, text })}\n\n` +
        `event: done\ndata: ${payload({ done_reason: 'stop' })}\n\n`;
      return r.fulfill({ status: 200, contentType: 'text/event-stream', body: stream });
    });
    await page.getByRole('tab', { name: 'Chat' }).click();
    await page.locator('[data-chat-refresh]').click();
    await page.locator('[data-chat-status="generation"] [data-chat-state="ready"]').waitFor();
    await page.waitForFunction(() => window.__dex && __dex.state.chatSavedSessionsLoaded);
    await page.locator('[data-chat-model]').selectOption('qwen3.8:27b-mlx');
    await page.locator('[data-chat-composer]').fill('Fixture user text');
    await page.waitForFunction(() => window.__dex && __dex.state.chatDraft === 'Fixture user text');
    await page.locator('[data-chat-send]').click();
    await page.locator('[data-chat-message="assistant"]').filter({ hasText: 'Fixture reply 1' }).waitFor();
    assert.equal(requestCount, 1);
    assert.equal(await page.locator('[data-chat-message="user"]').textContent().then(s => s.includes('Fixture user text')), true);
    assert.equal(await page.locator('[data-chat-run-status]').textContent(), 'Complete');
    await page.locator('[data-chat-regenerate]').click();
    await page.locator('[data-chat-message="assistant"]').filter({ hasText: 'Fixture reply 2' }).waitFor();
    assert.equal(requestCount, 2);
    await page.locator('[data-chat-new]').click();
    await page.waitForFunction(() => document.querySelectorAll('[data-chat-message]').length === 0);
    await page.locator('[data-chat-save-next]').check();
    await page.locator('[data-chat-composer]').fill('Saved fixture text');
    await page.waitForFunction(() => window.__dex && __dex.state.chatDraft === 'Saved fixture text');
    await page.locator('[data-chat-send]').click();
    await page.locator('[data-chat-message="assistant"]').filter({ hasText: 'Fixture reply 3' }).waitFor();
    assert.equal(savedCreates, 1, 'saved mode was explicitly requested once');
    assert.equal(await page.locator('[data-chat-export]').isEnabled(), true);
    await page.locator('[data-chat-saved-list]').waitFor();
    assert.equal(await page.locator('[data-chat-saved-list] option').count(), 2);
    assert.deepEqual(errors, []);
    await page.close();
  }
  // Reduced motion: the nav declares no transitions.
  {
    const { page } = await open(browser, base, { width: 1348, height: 735, layout: 'masters', reducedMotion: 'reduce' });
    await page.locator('[data-master-bar]').waitFor({ state: 'visible' });
    const t = await page.locator('[data-master-tab="image"]').evaluate(el => getComputedStyle(el).transitionDuration);
    assert.ok(/^0s(, 0s)*$/.test(t), 'no transition under reduced motion: ' + t);
    await page.close();
  }
  console.log('[studio-masters-nav.browser] PASS STUDIO_MASTERS_NAV_PASS', JSON.stringify(evidence));
})().catch(e => { console.error('STUDIO_MASTERS_NAV_FAIL', e.stack); process.exitCode = 1; }).finally(runCleanups);
