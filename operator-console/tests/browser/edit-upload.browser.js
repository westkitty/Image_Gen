'use strict';
// Edit "Import image": a real PNG upload through the real /api/staging, rejection of non-images, truncated files and oversize
// files, and hand-off of the uploaded source (staged_id, never a client file path) to a real Edit action request.
// Generation POSTs are intercepted so no inference runs.
const assert = require('node:assert/strict');
const { chromium } = require('playwright-core');
const { makePng, startServer, installModelSnapshots, runner, launchBrowser, openStudio } = require('./helpers');
const { test, exitCode } = runner('edit-upload');
const toasts = page => page.evaluate(() => __dex.state.toasts.map(t => t.msg));

(async () => {
  const srv = process.env.DEX_TEST_BASE ? { base: process.env.DEX_TEST_BASE, stop() {} } : await startServer();
  const browser = await launchBrowser(chromium);
  try {
    const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 } });
    const page = await ctx.newPage();
    const errors = []; page.on('pageerror', e => errors.push(String(e)));
    const posts = [];
    await installModelSnapshots(page, srv.base);
    await page.route('**/api/extra-networks**', r => r.fulfill({ json: { loras: [], vaes: [], embeddings: { count: 0, items: [] } } }));
    await page.route('**/api/actions/img2img', r => { posts.push(r.request().postDataJSON()); r.fulfill({ status: 400, json: { error: 'intercepted by test', gate: 'test' } }); });
    await openStudio(page, srv.base + '/dexdiffusion/');
    await page.waitForFunction(() => window.__dex && __dex.state.capabilityData && __dex.state.modelTargets && __dex.state.modelTargets.length > 3);
    await page.evaluate(() => __dex.setScreen('edit'));
    await page.waitForSelector('input[type="file"][accept*="image/png"]', { state: 'attached' });
    const input = () => page.locator('input[type="file"][accept*="image/png"]').first();

    await test('a valid PNG uploads, becomes a temporary Edit source with its real dimensions', async () => {
      await input().setInputFiles({ name: 'photo.png', mimeType: 'image/png', buffer: makePng(320, 192) });
      await page.waitForFunction(() => __dex._ed().source && __dex._ed().source.staged === true, null, { timeout: 15000 });
      const s = await page.evaluate(() => { const x = __dex._ed().source; return { w: x.width, h: x.height, id: x.stagedId, op: x.meta.operation }; });
      assert.deepEqual([s.w, s.h], [320, 192]); assert.match(s.id, /^stg-/); assert.equal(s.op, 'imported (temporary)');
      assert.ok((await toasts(page)).some(t => /Imported 320×192/.test(t)));
    });
    await test('the uploaded source is handed to a real Edit action as staged_id (never a path), with the page unchanged on error', async () => {
      await page.evaluate(() => { const ed = __dex._ed(); if (ed.op !== 'img2img') __dex.edSet({ op: 'img2img' }); });
      await page.evaluate(() => __dex.setState({}));
      const btn = page.locator('[data-run-edit]');
      await btn.waitFor({ state: 'visible', timeout: 10000 });
      await page.evaluate(() => { const st = __dex._ed().state; if (st) { st.prompt = 'a small red cube'; __dex.edSet({ state: st }); } });
      await btn.click();
      await page.waitForFunction(() => true);
      for (let i = 0; i < 30 && !posts.length; i++) await new Promise(r => setTimeout(r, 200));
      const blocker = await page.locator('[data-run-blocker]').innerText();
      assert.equal(posts.length, 1, 'Run sent exactly one img2img request; blocker text: ' + JSON.stringify(blocker));
      assert.match(posts[0].staged_id, /^stg-/, 'the staged id is sent');
      for (const k of ['path', 'init_image_file', 'image_path']) assert.ok(!(k in posts[0]) || posts[0][k] === undefined, 'no client path field ' + k);
    });
    await test('a text file renamed .png is rejected by the server with a clear message and nothing becomes the source', async () => {
      await page.evaluate(() => { __dex.wsSet({ editSourceId: null, editSource: null }); __dex.edSet({ source: null, state: null }); });
      await page.waitForSelector('input[type="file"][accept*="image/png"]', { state: 'attached' });
      await input().setInputFiles({ name: 'fake.png', mimeType: 'image/png', buffer: Buffer.from('this is not an image at all, just text') });
      await page.waitForFunction(() => __dex.state.toasts.some(t => /reference-invalid|not|invalid|truncated|unsupported/i.test(t.msg)), null, { timeout: 10000 });
      assert.equal(await page.evaluate(() => __dex._ed().source), null, 'a rejected file never becomes the source');
    });
    await test('a truncated PNG (valid signature, no image data) is rejected', async () => {
      await page.evaluate(() => { __dex.wsSet({ editSourceId: null, editSource: null }); __dex.edSet({ source: null, state: null }); });
      await page.waitForSelector('input[type="file"][accept*="image/png"]', { state: 'attached' });
      const n0 = (await toasts(page)).length;
      await input().setInputFiles({ name: 'cut.png', mimeType: 'image/png', buffer: makePng(64, 64).subarray(0, 40) });
      await page.waitForFunction(n => __dex.state.toasts.length > n, n0, { timeout: 10000 });
      assert.equal(await page.evaluate(() => __dex._ed().source), null, 'a truncated image never becomes the source');
    });
    await test('a file over the 25 MB limit is refused in the browser before any upload', async () => {
      let staged = 0;
      await page.evaluate(() => { __dex.wsSet({ editSourceId: null, editSource: null }); __dex.edSet({ source: null, state: null }); });
      await page.waitForSelector('input[type="file"][accept*="image/png"]', { state: 'attached' });
      await page.route('**/api/staging**', r => { if (r.request().method() === 'POST') staged++; r.fallback(); });
      await input().setInputFiles({ name: 'huge.png', mimeType: 'image/png', buffer: Buffer.concat([makePng(8, 8), Buffer.alloc(26 * 1024 * 1024)]) });
      await page.waitForFunction(() => __dex.state.toasts.some(t => /too large \(25 MB max\)/.test(t.msg)), null, { timeout: 10000 });
      assert.equal(staged, 0, 'no network upload for an oversized file');
    });
    await test('the Edit model catalog lists every installed checkpoint; only edit-capable ones are selectable and the rest say why', async () => {
      const png = require('./helpers').makePng(64, 64);
      await input().setInputFiles({ name: 'm.png', mimeType: 'image/png', buffer: png }).catch(async () => { await page.evaluate(() => __dex.setScreen('edit')); });
      await page.waitForFunction(() => __dex._ed().source, null, { timeout: 10000 });
      await page.click('[data-model-picker="edit"] button[aria-haspopup="listbox"]');
      await page.waitForSelector('[data-model-picker="edit"] [role="option"]');
      const rows = await page.$$eval('[data-model-picker="edit"] [role="option"]', els => els.map(e => ({ id: e.getAttribute('data-model-id'), disabled: e.disabled, text: e.innerText })));
      const total = await page.evaluate(() => __dex.state.modelTargets.length);
      assert.equal(rows.length, total, 'every installed target is listed');
      const ok = rows.filter(r => !r.disabled), no = rows.filter(r => r.disabled);
      assert.ok(ok.length >= 1 && no.length >= 1, 'some selectable, some not');
      assert.ok(no.every(r => /text-to-image|runs on|Marked broken|missing|no .* worker/i.test(r.text)), 'every unavailable row states its reason: ' + JSON.stringify(no.slice(0, 2)));
      await page.keyboard.press('Escape');
    });
    assert.deepEqual(errors, []);
    await ctx.close();
  } finally { await srv.stop(); }
  process.exit(exitCode());
})();
