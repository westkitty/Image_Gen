'use strict';
// V2 parity rows 12 (prompt-style management), 1 (Dexter artwork) and 52 (System / privacy / preferences), against a real
// isolated console. The style store is the test server's own state directory; nothing touches the user's styles.
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const { chromium } = require('playwright-core');
const { startServer, installModelSnapshots, runner, launchBrowser, runCleanups, openStudio } = require('./helpers');

const { test, results, exitCode } = runner('v2-parity-prompt-assets');
// SHA-256 of the approved Dexter artwork V2 shows (header avatar and idle canvas). A change here is a deliberate art change.
const ART = { 'grok_image_1775518225931.jpg': '5e78922ccfabcf36cb9c69188df519e4d8d567f074e1f5f2971dcc20bc8cd507', 'grok_image_1775518196500.jpg': 'f6dd4454db477c17c311f4f73bbdf59f9b47ccf8dc78fbcacbc59f081eea3486' };

async function open(page, base, screen = 'create') {
  const errors = [];
  page.on('pageerror', e => errors.push(String(e)));
  await installModelSnapshots(page, base);
  await page.route('**/api/extra-networks**', r => r.fulfill({ json: { loras: [], vaes: [], embeddings: { count: 0, items: [] } } }));
  await openStudio(page, base + '/dexdiffusion/', { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => window.__dex && __dex.state.version === 2 && __dex.state.modelTargets && __dex.state.modelTargets.length > 3);
  if (screen !== 'create') await page.evaluate(s => __dex.setScreen(s), screen);
  return errors;
}
const clearStyles = async base => { for (const x of (await (await fetch(base + '/api/styles')).json()).styles) await fetch(base + '/api/styles/' + encodeURIComponent(x.id), { method: 'DELETE' }); };
async function openStyles(page) {
  // The style list loads once when Create first renders and repaints the form; wait for it before touching the panel.
  await page.waitForFunction(() => window.__dex && __dex._sty && __dex._sty().loaded, null, { timeout: 15000 });
  await page.locator('[data-studio-advanced]').evaluate(el => { el.open = true; });
  const panel = page.locator('[data-dex-field="styles-panel"]');
  await panel.scrollIntoViewIfNeeded();
  if (!(await panel.evaluate(e => e.open))) await panel.locator(':scope > summary').click();
  await page.waitForFunction(() => document.querySelector('[data-dex-field="style-new"]'));
  return panel;
}
async function saveStyle(page, name, prompt, negative) {
  await page.locator('[data-dex-field="style-new"]').click();
  await page.locator('[data-dex-field="style-name"]').fill(name);
  await page.locator('[data-dex-field="style-prompt"]').fill(prompt);
  if (negative != null) await page.locator('[data-dex-field="style-negative_prompt"]').fill(negative);
  await page.locator('[data-dex-field="style-save"]').click();
  await page.locator('[data-style-id]', { hasText: name }).waitFor();
}

(async () => {
  const srv = process.env.DEX_TEST_BASE ? { base: process.env.DEX_TEST_BASE, stop() {} } : await startServer();
  const browser = await launchBrowser(chromium);
  try {
    await test('row 12: create, order, preview, apply, edit, persist and delete prompt styles in V2 Create', async () => {
      await clearStyles(srv.base);
      const page = await browser.newPage({ viewport: { width: 1348, height: 900 } });
      const errors = await open(page, srv.base);
      await page.getByRole('textbox', { name: 'Describe your image', exact: true }).fill('a red fox');
      const panel = await openStyles(page);
      await page.waitForFunction(() => /No styles yet/.test(document.querySelector('[data-dex-field="styles-empty"]')?.innerText || ''), null, { timeout: 10000 });
      await saveStyle(page, 'ZZ Cinematic', '{prompt}, cinematic lighting', 'blurry');
      await saveStyle(page, 'ZZ Grain', '{prompt}, film grain', null);
      // Select both (list order = application order), preview shows the exact composed text, nothing is queued.
      for (const n of ['ZZ Cinematic', 'ZZ Grain']) await page.locator('[data-style-id]', { hasText: n }).locator('[data-dex-field="style-check"]').check();
      await page.locator('[data-dex-field="style-preview-button"]').click();
      await page.locator('[data-dex-field="style-preview-prompt"]').waitFor();
      assert.equal((await page.locator('[data-dex-field="style-preview-prompt"]').innerText()).trim(), 'a red fox, cinematic lighting, film grain');
      assert.equal((await page.locator('[data-dex-field="style-preview-negative"]').innerText()).trim(), 'blurry');
      assert.equal(await page.evaluate(() => __dex.state.prompt), 'a red fox', 'Preview does not edit the prompt');
      await page.locator('[data-dex-field="style-apply"]').click();
      await page.waitForFunction(() => __dex.state.prompt === 'a red fox, cinematic lighting, film grain');
      assert.equal(await page.evaluate(() => __dex.state.negPrompt), 'blurry');
      // Edit / rename.
      await page.locator('[data-style-id]', { hasText: 'ZZ Grain' }).locator('[data-dex-field="style-edit"]').click();
      await page.locator('[data-dex-field="style-name"]').fill('ZZ Grainy');
      await page.locator('[data-dex-field="style-save"]').click();
      await page.locator('[data-style-id]', { hasText: 'ZZ Grainy' }).waitFor();
      // Persisted by the server, restored after a reload.
      const listed = (await (await fetch(srv.base + '/api/styles')).json()).styles.map(x => x.name).sort();
      assert.deepEqual(listed, ['ZZ Cinematic', 'ZZ Grainy']);
      await page.reload({ waitUntil: 'domcontentloaded' });
      await page.waitForFunction(() => window.__dex && __dex.state.version === 2 && __dex.state.modelTargets?.length > 3);
      await openStyles(page);
      await page.waitForFunction(() => document.querySelectorAll('[data-style-id]').length === 2);
      // Delete (the app confirms first).
      page.once('dialog', d => d.accept());
      await page.locator('[data-style-id]', { hasText: 'ZZ Grainy' }).locator('[data-dex-field="style-delete"]').click();
      await page.waitForFunction(() => document.querySelectorAll('[data-style-id]').length === 1);
      page.once('dialog', d => d.accept());
      await page.locator('[data-style-id]', { hasText: 'ZZ Cinematic' }).locator('[data-dex-field="style-delete"]').click();
      await page.locator('[data-dex-field="styles-empty"]').waitFor();
      assert.deepEqual((await (await fetch(srv.base + '/api/styles')).json()).styles, []);
      assert.deepEqual(errors, []);
      await page.close();
    });

    await test('row 12: an invalid style is refused with a visible reason and nothing is stored', async () => {
      await clearStyles(srv.base);
      const page = await browser.newPage({ viewport: { width: 1348, height: 900 } });
      const errors = await open(page, srv.base);
      await openStyles(page);
      await page.locator('[data-dex-field="style-new"]').click();
      await page.locator('[data-dex-field="style-save"]').click();
      await page.locator('[data-dex-field="style-error"]').waitFor();
      assert.ok((await page.locator('[data-dex-field="style-error"]').innerText()).length > 3);
      assert.deepEqual((await (await fetch(srv.base + '/api/styles')).json()).styles, []);
      assert.deepEqual(errors, []);
      await page.close();
    });

    await test('row 1: the approved Dexter artwork is served unchanged and renders in V2 at desktop and mobile sizes', async () => {
      for (const [w, h] of [[1348, 735], [390, 844]]) {
        const page = await browser.newPage({ viewport: { width: w, height: h } });
        const errors = await open(page, srv.base);
        const probe = () => page.evaluate(() => [...document.querySelectorAll('img')].filter(i => /grok_image_/.test(i.src)).map(i => ({ f: i.src.split('/').pop(), ok: i.complete && i.naturalWidth > 0, shown: !!(i.offsetWidth && i.offsetHeight) })));
        await page.waitForFunction(() => { const a = [...document.querySelectorAll('img')].filter(i => /grok_image_/.test(i.src)); return a.length && a.every(i => i.complete); }, null, { timeout: 10000 });
        const imgs = await probe();
        assert.ok(imgs.length >= 1 && imgs.every(i => i.ok), `Dexter images load at ${w}x${h}: ${JSON.stringify(imgs)}`);
        assert.ok(imgs.some(i => i.shown), `a Dexter image is visible at ${w}x${h}`);
        assert.deepEqual(errors, []);
        await page.close();
      }
      for (const [f, sha] of Object.entries(ART)) {
        const r = await fetch(srv.base + '/dexdiffusion/uploads/' + f);
        assert.equal(r.status, 200, f); assert.match(r.headers.get('content-type') || '', /image\/jpeg/);
        assert.equal(crypto.createHash('sha256').update(Buffer.from(await r.arrayBuffer())).digest('hex'), sha, f + ' is the approved artwork');
      }
    });

    await test('row 52: System shows worker health, access/bind, storage and launcher truth (an uninstalled runtime is reported as missing)', async () => {
      const page = await browser.newPage({ viewport: { width: 1348, height: 900 } });
      const errors = await open(page, srv.base, 'system');
      await page.waitForFunction(() => /Backend bind/.test(document.body.innerText) && /WORKERS/.test(document.body.innerText), null, { timeout: 15000 });
      const t = await page.locator('[data-scroll-pane]').first().innerText();
      assert.match(t, /Run Doctor/); assert.match(t, /Backend bind\s*127\.0\.0\.1:\d+/, 'bound to loopback only');
      assert.match(t, /Generated images\s*\/Users\/andrew\/images_made/); assert.match(t, /Final images are stored on the MacBook only/);
      assert.match(t, /Heavy compute:[\s\S]*capacity 1/); assert.match(t, /LTX Video[\s\S]*RUNTIME MISSING/, 'a missing runtime is not shown as ready');
      assert.match(t, /DexDiffusion\.app/);
      assert.deepEqual(errors, []);
      await page.close();
    });

    await test('row 52: the prompt-privacy preference defaults off, persists, and is what a request would send', async () => {
      const page = await browser.newPage({ viewport: { width: 1348, height: 900 } });
      const errors = await open(page, srv.base, 'system');
      assert.equal(await page.evaluate(() => __dex.state.savePrompts), false, 'default is params-only');
      const box = page.locator('input[type="checkbox"]').filter({ has: page.locator('xpath=.') }).first();
      const cb = page.locator('label', { hasText: /prompt/i }).locator('input[type="checkbox"]').first();
      await cb.check();
      await page.waitForFunction(() => __dex.state.savePrompts === true && localStorage.getItem('dex_save_prompts') === 'true');
      assert.equal(await page.evaluate(() => __dex.currentParams().save_prompts), true);
      await page.reload({ waitUntil: 'domcontentloaded' });
      await page.waitForFunction(() => window.__dex && __dex.state.version === 2);
      assert.equal(await page.evaluate(() => __dex.state.savePrompts), true, 'preference survives a reload');
      await page.evaluate(() => __dex.setScreen('system'));
      await page.locator('label', { hasText: /prompt/i }).locator('input[type="checkbox"]').first().uncheck();
      await page.waitForFunction(() => __dex.state.savePrompts === false && localStorage.getItem('dex_save_prompts') === 'false');
      assert.deepEqual(errors, []);
      await page.close();
    });
  } finally {
    await runCleanups();
  }
  process.exitCode = exitCode(results.some(r => r[0] !== 'PASS'));
})().catch(async e => { console.error(e); await runCleanups(); process.exitCode = 2; });
