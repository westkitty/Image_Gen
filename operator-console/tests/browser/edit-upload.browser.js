'use strict';
// PNG imports retain their exact bytes and canonical ID. JPEG stays temporary
// and passes its staging ID to Edit. Generation POSTs are intercepted.
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

    await test('a valid PNG becomes the exact canonical Edit source with its original bytes', async () => {
      const png = makePng(320, 192);
      await input().setInputFiles({ name: 'photo.png', mimeType: 'image/png', buffer: png });
      await page.waitForFunction(() => typeof __dex._ed().source?.imageId === 'string', null, { timeout: 15000 });
      const source = await page.evaluate(() => __dex._ed().source);
      assert.deepEqual([source.width, source.height], [320, 192]);
      const response = await fetch(srv.base + '/api/images/' + encodeURIComponent(source.imageId));
      assert.equal(response.status, 200);
      assert.deepEqual(Buffer.from(await response.arrayBuffer()), png);
      assert.ok((await toasts(page)).some(t => /PNG saved to Library and opened in Edit/.test(t)));
    });

    async function editRequest() {
      await page.evaluate(() => {
        const ed = __dex._ed();
        __dex.edSet({ op: 'img2img', state: { ...ed.state, prompt: 'a small red cube' } });
      });
      const previous = posts.length;
      const response = page.waitForResponse(r => new URL(r.url()).pathname === '/api/actions/img2img' && r.request().method() === 'POST');
      await page.locator('[data-run-edit]').click();
      assert.equal((await response).status(), 400, 'the test intercepted the inference request');
      assert.equal(posts.length, previous + 1);
      const body = posts.at(-1);
      for (const key of ['path', 'init_image_file', 'image_path']) assert.equal(body[key], undefined, 'no client path field ' + key);
      return body;
    }

    await test('Edit sends the exact canonical image ID for an imported PNG and retains the source on error', async () => {
      const id = await page.evaluate(() => __dex._ed().source.imageId);
      const body = await editRequest();
      assert.equal(body.image_id, id);
      assert.equal(body.staged_id, undefined);
      assert.equal(await page.evaluate(() => __dex._ed().source.imageId), id);
    });

    await test('pasting a JPEG uses temporary staging and Edit sends its exact staging ID', async () => {
      const confirm = dialog => dialog.accept();
      page.on('dialog', confirm);
      try {
        await page.evaluate(async () => {
          const canvas = document.createElement('canvas');
          canvas.width = 320; canvas.height = 192;
          const ctx = canvas.getContext('2d');
          ctx.fillStyle = '#add';
          ctx.fillRect(0, 0, canvas.width, canvas.height);
          const image = await new Promise(resolve => canvas.toBlob(resolve, 'image/jpeg'));
          const data = new DataTransfer();
          data.items.add(new File([image], 'photo.jpg', { type: 'image/jpeg' }));
          window.dispatchEvent(new ClipboardEvent('paste', { clipboardData: data, cancelable: true }));
        });
        await page.waitForFunction(() => __dex._ed().source?.staged === true, null, { timeout: 15000 });
      } finally { page.off('dialog', confirm); }
      const source = await page.evaluate(() => __dex._ed().source);
      assert.deepEqual([source.width, source.height], [320, 192]);
      assert.match(source.stagedId, /^stg-/);
      const body = await editRequest();
      assert.equal(body.staged_id, source.stagedId);
      assert.equal(body.image_id, undefined);
      assert.equal(await page.evaluate(() => __dex._ed().source.stagedId), source.stagedId);
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
      await page.route(/\/api\/(?:staging|library\/images\/import)(?:\?|$)/, r => {
        if (r.request().method() === 'POST') staged++;
        return r.fallback();
      });
      await input().evaluate(el => {
        const data = new DataTransfer();
        data.items.add(new File([new Uint8Array(26 * 1024 * 1024)], 'huge.png', { type: 'image/png' }));
        el.files = data.files;
        el.dispatchEvent(new Event('change', { bubbles: true }));
      });
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
      assert.ok(no.every(r => /text-to-image|runs on|single-file|Marked broken|missing|no .* worker|no .* path|not for this operation|not usable/i.test(r.text)), 'every unavailable row states its reason: ' + JSON.stringify(no.slice(0, 2)));
      await page.keyboard.press('Escape');
    });
    assert.deepEqual(errors, []);
    await ctx.close();
  } finally { await srv.stop(); }
  process.exit(exitCode());
})();
