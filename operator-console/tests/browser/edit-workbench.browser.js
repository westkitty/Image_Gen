'use strict';
// Browser acceptance for the Edit workbench, Create resources/model picker/presets and the
// fullscreen viewer. Real Chrome (playwright-core), real UI code, hermetic image/job fixtures.
//   node tests/browser/edit-workbench.browser.js            (starts its own server on :31911)
//   DEX_TEST_BASE=http://127.0.0.1:31337 node …            (use a running console)
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const { chromium } = require('playwright-core');
const { makePng, decodePng, startServer, installModelSnapshots, installImageFixtures, runner, launchBrowser, runCleanups } = require('./helpers');

const OUT = process.env.DEX_BROWSER_OUTPUT_DIR || path.join(__dirname, '..', '..', '..', 'output', 'playwright');
fs.mkdirSync(OUT, { recursive: true });

const FX = {
  'fx-landscape.png': { w: 800, h: 500, meta: { operation: 'txt2img', target: 'sdxl-base', seed: 1111, steps: 31, cfg: 5.5, sampler: 'dpmpp2m', scheduler: 'karras', vae: 'auto', preset: 'quality', loras: [{ name: 'style_a', weight: 0.7 }, { name: 'bad_lora', weight: 1 }], gen_schema: 1, prompt_saved: false } },
  'fx-portrait.png': { w: 400, h: 800, meta: { operation: 'txt2img', target: 'sd15', seed: 2222, steps: 17, cfg: 8, sampler: 'euler_a', scheduler: 'discrete', vae: 'auto', loras: [], gen_schema: 1, prompt_saved: true, prompt: 'a saved prompt', negative_prompt: 'saved negative' } },
  'fx-square.png': { w: 512, h: 512, meta: { operation: 'txt2img', target: 'sd15', seed: 3333, steps: 20, cfg: 7, sampler: 'euler_a', scheduler: 'discrete', vae: 'auto', loras: [], gen_schema: 1, prompt_saved: false } },
  'fx-out.png': { w: 800, h: 500, meta: { operation: 'img2img', target: 'sdxl-base', seed: 1111, steps: 31, cfg: 5.5, gen_schema: 1, prompt_saved: false, parent: 'fx-landscape.png' } },
};
const CATALOG = [
  { id: 'l1', name: 'style_a', filename: 'style_a.safetensors', family: 'sdxl', compatibility: 'Compatible', default_weight: 0.8, trigger_words: ['stylea'] },
  { id: 'l2', name: 'bad_lora', filename: 'bad_lora.safetensors', family: 'pony', compatibility: 'Incompatible', default_weight: 1, trigger_words: [] },
  { id: 'l3', name: 'extra', filename: 'extra.safetensors', family: 'sdxl', compatibility: 'Compatible', default_weight: 0.5, trigger_words: [] },
];

async function newPage(browser, base, { width = 1280, height = 900, legacyRecipes } = {}) {
  const ctx = await browser.newContext({ viewport: { width, height } });
  const page = await ctx.newPage();
  await installModelSnapshots(page, base);
  const errors = [];
  page.on('pageerror', e => errors.push(String(e)));
  if (legacyRecipes) await page.addInitScript(r => { localStorage.setItem('dex_favorite_presets', JSON.stringify(r)); }, legacyRecipes);
  await installImageFixtures(page, FX);
  const posts = [];
  const mock = { jobStep: 0, jobMode: 'ok', postMode: 'ok', posts };
  await page.route('**/api/extra-networks**', r => r.fulfill({ json: { loras: CATALOG, vaes: [], embeddings: { count: 0, items: [] } } }));
  await page.route('**/api/models/secondary/activate', async r => { posts.push({ url: 'activate', body: r.request().postDataJSON() }); r.fulfill({ json: { ok: true, activeSecondaryModel: r.request().postDataJSON().target, modelState: { activeSecondaryModel: r.request().postDataJSON().target } } }); });
  await page.route('**/api/actions/{img2img,inpaint,outpaint}', async r => {
    const u = new URL(r.request().url()); posts.push({ url: u.pathname, body: r.request().postDataJSON() });
    if (mock.postMode === 'fail') return r.fulfill({ status: 500, json: { error: 'boom from backend', gate: 'test-gate' } });
    mock.jobStep = 0; r.fulfill({ json: { job_id: 'job-1', status: 'queued' } });
  });
  await page.route('**/api/jobs/job-1', async r => {
    if (mock.jobMode === 'drop') return r.abort();
    const n = mock.jobStep++;
    const steps = [
      { status: 'queued', stage: { key: 'waiting-bigmac', label: 'Waiting for Big Mac — sd15 owns heavy compute', percent: null, determinate: false }, resource: { waiting: true, position: 1 } },
      { status: 'running', stage: { key: 'uploading', label: 'Uploading source image to Big Mac', percent: null, determinate: false } },
      { status: 'running', stage: { key: 'sampling', label: 'Sampling step 3/10', percent: 30, determinate: true, step: 3, total: 10 } },
      { status: 'running', stage: { key: 'sampling', label: 'Sampling step 8/10', percent: 80, determinate: true, step: 8, total: 10 } },
    ];
    if (n < steps.length) return r.fulfill({ json: Object.assign({ id: 'job-1' }, steps[n]) });
    r.fulfill({ json: { id: 'job-1', status: 'PASS', stage: { key: 'complete', label: 'Complete', percent: 100, determinate: true }, results: [{ index: 0, status: 'DONE', imageId: 'fx-out.png', imageUrl: '/api/images/fx-out.png', seed: 1111, target: 'sdxl-base', width: 800, height: 500 }] } });
  });
  await page.route('**/api/library/images**', r => r.fulfill({ json: { filter: 'all', total: 2, items: ['fx-landscape.png', 'fx-portrait.png'].map(id => ({ id, url: '/api/images/' + id, width: FX[id].w, height: FX[id].h, keeper: false, meta: FX[id].meta, runId: 'fx', parent: null, children: [], ancestors: [] })) } }));
  await page.goto(base + '/dexdiffusion/');
  await page.waitForFunction(() => window.__dex && __dex.state.modelTargets && __dex.state.modelTargets.length > 3 && __dex.state.capabilityData);
  return { page, ctx, errors, mock, posts };
}
const openEdit = async (page, id, op) => {
  const ok = await page.evaluate(([i, o]) => __dex.openImageInEdit(i, o), [id, op]);
  assert.ok(ok, 'openImageInEdit returned false');
  // The owner promise finishes before the queued DOM commit. An existing
  // workbench can still contain handlers bound to the prior operation state.
  await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
  await page.waitForFunction(([i,o]) => __dex.ed && !__dex.ed.loading && __dex.ed.op === o && __dex.ed.source?.imageId === i
    && document.querySelector('[data-edit-workbench] [data-op="' + o + '"][aria-selected="true"]')
    && document.querySelector('[data-edit-workbench] [data-presets="' + o + '"]')
    && document.querySelector('[data-edit-source] img[data-fullscreen-image-id="' + i + '"]'), [id,op]);
};
const clickRun = async (page, text = 'a test prompt') => { await page.click('[data-edit-prompt]'); await page.fill('[data-edit-prompt]', text); await page.click('[data-run-edit]'); };

const { results, test, phase, exitCode } = runner('edit-workbench');

(async () => {
  const srv = process.env.DEX_TEST_BASE ? { base: process.env.DEX_TEST_BASE, stop() {} } : await startServer(31911);
  const browser = await launchBrowser(chromium);
  try {
    await test('provenance: Edit carries the SELECTED image\'s parameters, not the Create form', async () => {
      const { page, ctx, errors } = await newPage(browser, srv.base);
      await page.evaluate(() => __dex.setState({ steps: 99, cfg: 21, seed: '424242', width: 1024, height: 768, prompt: 'CREATE-FORM-PROMPT', negPrompt: 'CREATE-NEG', scheduler: 'exponential', target: 'flux2-klein-4b' }));
      await openEdit(page, 'fx-landscape.png', 'img2img');
      const st = await page.evaluate(() => JSON.parse(JSON.stringify(__dex.ed.state)));
      assert.equal(st.sourceImageId, 'fx-landscape.png');
      assert.deepEqual([st.params.seed, st.params.steps, st.params.cfg, st.params.sampler, st.params.scheduler, st.params.vae, st.params.preset], [1111, 31, 5.5, 'dpmpp2m', 'karras', 'auto', 'quality']);
      assert.equal(st.editModel, 'sdxl-base');
      assert.deepEqual(st.loras.map(l => [l.name, l.weight]), [['style_a', 0.7], ['bad_lora', 1]]);
      assert.equal(st.prompt, ''); assert.notEqual(st.prompt, 'CREATE-FORM-PROMPT');
      const banner = await page.innerText('[data-recall-banner]');
      assert.match(banner, /seed 1111/); assert.match(banner, /steps 31/); assert.match(banner, /Source prompt unavailable — prompt saving was off/);
      assert.equal(await page.inputValue('[data-edit-prompt]'), '');
      assert.equal(await page.evaluate(() => __dex.state.prompt), 'CREATE-FORM-PROMPT', 'Create form untouched');
      await page.screenshot({ path: path.join(OUT, 'edit-recall-compact.png') });
      assert.deepEqual(errors, []); await ctx.close();
    });

    await test('privacy on: stored prompt is recalled; different image → its own values', async () => {
      const { page, ctx } = await newPage(browser, srv.base);
      await openEdit(page, 'fx-portrait.png', 'img2img');
      assert.equal(await page.inputValue('[data-edit-prompt]'), 'a saved prompt');
      assert.equal(await page.inputValue('[data-edit-negative]'), 'saved negative');
      assert.equal(await page.evaluate(() => __dex.ed.state.params.seed), 2222);
      await ctx.close();
    });

    await test('img2img: real click sends the request, shows queue/wait/real step progress, resolves the canonical result', async () => {
      const { page, ctx, mock, posts } = await newPage(browser, srv.base);
      await openEdit(page, 'fx-landscape.png', 'img2img');
      await page.evaluate(() => {
        window.__editProgressSeen = [];
        window.__editProgressObserver = new MutationObserver(() => {
          const node = document.querySelector('[data-edit-progress]');
          if (node) window.__editProgressSeen.push(node.innerText.split('\n')[0]);
        });
        window.__editProgressObserver.observe(document.body, { childList: true, subtree: true, characterData: true });
      });
      await clickRun(page);
      await page.waitForSelector('[data-edit-results] img[data-fullscreen]');
      const all = await page.evaluate(() => { window.__editProgressObserver.disconnect(); return [...new Set(window.__editProgressSeen)].join(' || '); });
      assert.match(all, /Waiting for Big Mac/); assert.match(all, /Uploading source image/); assert.match(all, /Sampling step 3\/10/);
      const req = posts.find(p => p.url === '/api/actions/img2img').body;
      assert.equal(posts[0].url, 'activate', 'edit model switched before submit'); assert.equal(posts[0].body.target, 'sdxl-base');
      assert.deepEqual([req.image_id, req.prompt, req.steps, req.cfg_scale, req.seed, req.sampler, req.scheduler, req.strength], ['fx-landscape.png', 'a test prompt', 31, 5.5, 1111, 'dpmpp2m', 'karras', 0.75]);
      assert.deepEqual(req.loras, [{ name: 'style_a', weight: 0.7 }], 'incompatible LoRA held back, compatible one sent structurally');
      assert.ok(!/<lora:/.test(req.prompt), 'no lora tags in the visible prompt');
      assert.match(await page.innerText('[data-edit-run]'), /Complete in/);
      await ctx.close();
    });

    await test('failures are visible with stage + actual error; polling loss offers a safe retry', async () => {
      const { page, ctx, mock } = await newPage(browser, srv.base);
      await openEdit(page, 'fx-square.png', 'img2img');
      mock.postMode = 'fail'; await clickRun(page);
      await page.waitForSelector('[data-edit-error]');
      let t = await page.innerText('[data-edit-error]');
      assert.match(t, /failed at stage: request/); assert.match(t, /boom from backend/); assert.match(t, /test-gate/);
      mock.postMode = 'ok'; mock.jobMode = 'drop';
      await page.click('[data-edit-error] button:has-text("Retry")');
      await page.waitForSelector('[data-edit-error]:has-text("polling")', { timeout: 20000 });
      t = await page.innerText('[data-edit-error]'); assert.match(t, /Lost contact/);
      mock.jobMode = 'ok'; mock.jobStep = 0;
      await page.click('button:has-text("Retry status check")');
      await page.waitForSelector('[data-edit-results]', { timeout: 20000 });
      await ctx.close();
    });

    await test('Run never fails silently: blocked state explains itself and click surfaces the reason', async () => {
      const { page, ctx, posts } = await newPage(browser, srv.base);
      await openEdit(page, 'fx-landscape.png', 'img2img');
      assert.match(await page.innerText('[data-run-blocker]'), /Enter a prompt — Source prompt unavailable/);
      await page.click('[data-run-edit]', { force: true }); // aria-disabled but still clickable for the user
      await page.waitForFunction(() => /✗ Enter a prompt/.test(document.querySelector('[data-run-blocker]').innerText));
      assert.equal(posts.length, 0);
      await ctx.close();
    });

    for (const fx of ['fx-square.png', 'fx-landscape.png', 'fx-portrait.png']) {
      await test(`inpaint alignment (${fx}): full image at Fit, strokes land on intended source pixels, zoom/pan keep them, backend mask matches`, async () => {
        const { page, ctx, posts } = await newPage(browser, srv.base);
        await openEdit(page, fx, 'inpaint');
        const { w, h } = { w: FX[fx].w, h: FX[fx].h };
        await page.locator('[data-mask-viewport]').scrollIntoViewIfNeeded();
        const geo = async () => page.evaluate(() => { const vp = document.querySelector('[data-mask-viewport]').getBoundingClientRect(), im = document.querySelector('[data-mask-viewport] img').getBoundingClientRect(); return { vp: { x: vp.x, y: vp.y, w: vp.width, h: vp.height }, im: { x: im.x, y: im.y, w: im.width, h: im.height }, view: __dex._mask.view }; });
        let g = await geo();
        assert.ok(g.im.x >= g.vp.x - 1 && g.im.y >= g.vp.y - 1 && g.im.x + g.im.w <= g.vp.x + g.vp.w + 1 && g.im.y + g.im.h <= g.vp.y + g.vp.h + 1, 'whole image visible at Fit (nothing cropped)');
        assert.ok(Math.abs(g.im.w / g.im.h - w / h) < 0.01, 'image keeps its own aspect ratio');
        await page.getByRole('button', { name: '100%', exact: true }).click();
        g = await geo();
        assert.ok(Math.abs(g.im.w - w) < 1 && Math.abs(g.im.h - h) < 1, '100% uses actual pixels even when Fit enlarges a small source');
        await page.getByRole('button', { name: 'Fit', exact: true }).click();
        const paint = async (ix, iy) => { // drag a short stroke starting at image pixel (ix,iy)
          await page.locator('[data-mask-viewport]').scrollIntoViewIfNeeded();
          const gg = await geo(); const s = gg.im.w / w;
          const sx = gg.im.x + ix * s, sy = gg.im.y + iy * s;
          await page.mouse.move(sx, sy); await page.mouse.down(); await page.mouse.move(sx + 6, sy + 6, { steps: 3 }); await page.mouse.up();
        };
        await page.evaluate(() => __dex.edQuiet({ brush: { mode: 'paint', size: 12 } }));
        await paint(10, 10);                                  // near top-left corner
        const px = (x, y) => page.evaluate(([a, b]) => __dex._mask.ctx.getImageData(a, b, 1, 1).data[3], [x, y]);
        assert.ok((await px(10, 10)) > 0, 'corner stroke at intended pixel'); assert.equal(await px(Math.floor(w / 2), Math.floor(h / 2)), 0);
        // zoom 4x + pan, then paint near the bottom-right corner of the source
        await page.evaluate(() => { const m = __dex._mask; m.zoomBy(4); m.view = DexEdit.clampPan(Object.assign({}, m.view, { panX: -99999, panY: -99999 })); m.apply(); });
        g = await geo(); assert.ok(g.view.zoom === 4);
        await paint(w - 14, h - 14);
        assert.ok((await px(w - 14, h - 14)) > 0, 'stroke after zoom+pan lands on the same intended pixel');
        await page.evaluate(() => __dex._mask.fit());
        g = await geo(); assert.ok(g.im.x >= g.vp.x - 1 && g.im.x + g.im.w <= g.vp.x + g.vp.w + 1, 'Fit restores the whole image');
        await clickRun(page);
        await page.waitForSelector('[data-edit-progress], [data-edit-results]');
        const req = posts.find(p => p.url === '/api/actions/inpaint').body;
        const mask = decodePng(Buffer.from(req.mask_data.split(',')[1], 'base64'));
        assert.deepEqual([mask.w, mask.h], [w, h], 'mask sent at the source image dimensions');
        const a = (x, y) => mask.data[(y * mask.w + x) * 4 + 3];
        assert.ok(a(10, 10) > 0 && a(w - 14, h - 14) > 0 && a(Math.floor(w / 2), Math.floor(h / 2)) === 0);
        await page.screenshot({ path: path.join(OUT, `inpaint-${fx.replace('.png', '')}.png`) });
        await ctx.close();
      });
    }

    await test('fullscreen: sources/results/library open the viewer; Esc closes; inpaint canvas never does', async () => {
      const { page, ctx } = await newPage(browser, srv.base);
      await openEdit(page, 'fx-square.png', 'img2img');
      await page.click('[data-edit-source] img');
      await page.waitForSelector('[data-lightbox]'); assert.ok(await page.$('[data-lightbox] [aria-label="Close fullscreen image"]'));
      await page.keyboard.press('Escape'); assert.equal(await page.$('[data-lightbox]'), null);
      await page.click('[data-op="inpaint"]'); await page.waitForSelector('[data-mask-viewport]');
      await page.locator('[data-mask-viewport]').scrollIntoViewIfNeeded();
      const b = await page.locator('[data-mask-viewport]').boundingBox();
      await page.mouse.click(b.x + b.width / 2, b.y + b.height / 2);
      assert.equal(await page.$('[data-lightbox]'), null, 'painting click must not open fullscreen');
      assert.ok((await page.evaluate(() => __dex.ed.maskInfo && __dex.ed.maskInfo.coverage)) > 0, 'but it painted');
      // library thumbnail
      await page.evaluate(() => __dex.setScreen('library')); await page.waitForSelector('[data-lib-thumb] img');
      await page.click('[data-lib-thumb="fx-landscape.png"] img'); await page.waitForSelector('[data-lightbox]');
      assert.ok((await page.innerText('[data-lightbox]')).includes('→ Inpaint'), 'viewer offers Edit actions for this exact image');
      await page.click('[data-lightbox] button:has-text("→ Inpaint")');
      await page.waitForSelector('[data-edit-source]'); assert.equal(await page.evaluate(() => __dex.ed.source.imageId), 'fx-landscape.png');
      assert.equal(await page.evaluate(() => __dex.ed.state.params.seed), 1111, 'Library → Edit carries that image\'s own record');
      await ctx.close();
    });

    await test('Create output hero image opens fullscreen', async () => {
      const { page, ctx } = await newPage(browser, srv.base);
      await page.evaluate(() => { __dex.setScreen('create'); __dex.wsSet({ results: [0, 1].map(i => ({ index: i, status: 'DONE', imageId: i ? 'fx-square.png' : 'fx-landscape.png', imageUrl: '/api/images/' + (i ? 'fx-square.png' : 'fx-landscape.png'), seed: 5 + i, target: 'sd15', width: 512, height: 512 })), activeIndex: 0 }); __dex.setState({ jobStatus: 'complete', currentImageSrc: '/api/images/fx-landscape.png' }); });
      await page.waitForSelector('img[alt="Hero result"]');
      await page.click('img[alt="Hero result"]'); await page.waitForSelector('[data-lightbox]');
      await page.keyboard.press('Escape'); assert.equal(await page.$('[data-lightbox]'), null);
      await ctx.close();
    });

    await test('Detailer: preview/run use the selected targets, empty result is explained, stale preview is dropped, mask goes to inpaint untouched', async () => {
      const { page, ctx, errors, posts } = await newPage(browser, srv.base);
      const detCalls = [];
      let emptyNext = false;
      const PIXEL = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYGD4DwABBAEAHnOcQAAAAABJRU5ErkJggg==';
      await page.route('**/api/detailer/mask-preview', async r => {
        const body = r.request().postDataJSON(); detCalls.push(body);
        if (emptyNext) return r.fulfill({ json: { status: 'ok', empty: true, mask_preview: null, detections: [], message: 'No hand was found in this image (nothing met the detection threshold and size limits).' } });
        r.fulfill({ json: { status: 'ok', empty: false, mask_preview: PIXEL, detections: [{ class: 'face' }, { class: 'face' }], detections_count: 2, mask: { coverage: 0.0421, width: 800, height: 500 } } });
      });
      await page.evaluate(() => { __dex.setScreen('create'); __dex.wsSet({ results: [{ index: 0, status: 'DONE', imageId: 'fx-landscape.png', imageUrl: '/api/images/fx-landscape.png', seed: 1111, target: 'sdxl-base', width: 800, height: 500 }], activeIndex: 0 }); __dex.setState({ jobStatus: 'complete', currentImageSrc: '/api/images/fx-landscape.png' }); });
      await page.waitForSelector('img[alt="Hero result"]');
      await page.evaluate(() => __dex.setScreen('library'));
      await page.getByRole('button', { name: 'Select fx-landscape.png for details', exact: true }).first().click();
      await page.getByRole('button', { name: 'Detailer', exact: true }).click();
      await page.waitForSelector('text=Native Vision Detailer');
      // 1. empty detection is explained in the modal, never silent
      await page.click('button:has-text("Hand")'); emptyNext = true;
      await page.click('button:has-text("Preview Mask")');
      await page.locator('[data-detailer-note]', { hasText: /No hand was found/ }).waitFor();
      assert.equal(await page.locator('img[alt="Mask preview"]').count(), 0, 'no mask is shown for an empty result');
      // 2. targets toggle + grow/shrink reach the request; success shows the count and coverage
      emptyNext = false;
      await page.click('button:has-text("Face")');
      await page.click('button:has-text("All (up to 5)")');
      await page.click('button:has-text("Preview Mask")');
      await page.waitForSelector('img[alt="Mask preview"]');
      const last = detCalls[detCalls.length - 1];
      assert.deepEqual([last.mode, last.targetSelection, last.image_id], ['face', 'all', 'fx-landscape.png']);
      assert.match(await page.innerText('[data-detailer-note]'), /2 target\(s\) selected · 4\.2% of the image/);
      // 3. changing any option drops the now-stale preview
      await page.evaluate(() => { const r = document.querySelector('input[type=range][max="0.90"]'); r.value = '0.5'; r.dispatchEvent(new Event('change', { bubbles: true })); });
      await page.waitForFunction(() => !document.querySelector('img[alt="Mask preview"]'));
      // 4. Run sends the detector's mask UNCHANGED to inpaint (no client-side repaint / no full-mask flag)
      await page.route('**/api/actions/inpaint', r => { posts.push({ url: '/api/actions/inpaint', body: r.request().postDataJSON() }); r.fulfill({ status: 500, json: { error: 'stop here' } }); });
      await page.click('button:has-text("Run Detailer")');
      await page.waitForFunction(() => document.querySelector('[data-detailer-note]') && /Detailer failed: stop here/.test(document.querySelector('[data-detailer-note]').innerText));
      const sent = posts.filter(p => p.url === '/api/actions/inpaint').pop().body;
      assert.equal(sent.mask_data, PIXEL); assert.equal(sent.operation, 'detailer'); assert.equal(sent.detailed_from, 'fx-landscape.png');
      assert.equal(sent.confirm_full_mask, undefined);
      assert.deepEqual(errors, []);
      await ctx.close();
    });

    await test('every screen renders in all three shell layouts without script errors (incl. Drama/Voice/Edit)', async () => {
      const { page, ctx, errors } = await newPage(browser, srv.base);
      for (const v of [1, 2, 3]) {
        await page.evaluate(n => __dex.setVersion(n), v);
        for (const s of ['create', 'batch', 'voice', 'music', 'video', 'drama', 'library', 'edit', 'enhance', 'models', 'system']) {
          await page.evaluate(x => __dex.setScreen(x), s); await page.waitForTimeout(120);
          const bad = await page.evaluate(() => document.documentElement.scrollWidth - innerWidth);
          assert.ok(bad <= 1, `v${v}/${s} overflows by ${bad}px`);
          // accessibility: every visible form control has an accessible name (a11y.js names sibling-labelled controls)
          const unnamed = () => page.evaluate(() => [...document.querySelectorAll('input:not([type=hidden]):not([type=button]):not([type=submit]):not([type=file]),select,textarea')].filter(el => { const r = el.getBoundingClientRect(); return r.width && !(el.getAttribute('aria-label') || el.getAttribute('aria-labelledby') || el.title || el.placeholder || el.closest('label') || (el.id && document.querySelector(`label[for="${el.id}"]`))); }).map(el => el.tagName + ':' + (el.closest('div') || {}).innerText.slice(0, 30)));
          await page.waitForFunction(() => !window.DexA11y || true).catch(() => {});
          let un = await unnamed(); for (let i = 0; i < 8 && un.length; i++) { await page.waitForTimeout(100); un = await unnamed(); }
          assert.deepEqual(un, [], `v${v}/${s} has unnamed form controls`);
        }
      }
      assert.deepEqual(errors, []); await ctx.close();
    });

    await test('both Edit layouts render the SAME state; preference persists', async () => {
      const { page, ctx } = await newPage(browser, srv.base);
      await openEdit(page, 'fx-portrait.png', 'img2img');
      await page.evaluate(() => { __dex.ed.state.params.steps = 44; });
      await page.click('[data-layout="studio"]'); await page.waitForSelector('[data-edit-workbench="studio"]');
      assert.equal(await page.evaluate(() => __dex.ed.state.params.steps), 44);
      assert.equal(await page.inputValue('[data-edit-prompt]'), 'a saved prompt');
      assert.equal(await page.evaluate(() => localStorage.getItem('dex_edit_layout')), 'studio');
      await page.screenshot({ path: path.join(OUT, 'edit-studio.png') });
      await page.reload(); await page.waitForFunction(() => window.__dex && __dex.ed);
      assert.equal(await page.evaluate(() => __dex.ed.layout), 'studio');
      await ctx.close();
    });

    await test('resources: LoRAs visible in Create and Edit, weight changes are structured, incompatible ones excluded', async () => {
      const { page, ctx } = await newPage(browser, srv.base);
      await page.evaluate(() => __dex.onSelectTarget('sd15', { quiet: true })); await page.waitForTimeout(300);
      await page.evaluate(() => { __dex.setCreateLoras(() => [{ name: 'style_a', weight: 0.8 }, { name: 'bad_lora', weight: 1 }]); __dex.setState({ prompt: 'x' }); });
      await page.waitForSelector('[data-resources="create"] [data-lora="style_a"]');
      assert.match(await page.innerText('[data-resources="create"]'), /incompatible/i);
      const body = await page.evaluate(() => __dex._createBody({}));
      assert.deepEqual(body.loras, [{ name: 'style_a', weight: 0.8 }]);
      await openEdit(page, 'fx-landscape.png', 'img2img');
      await page.waitForSelector('[data-resources="edit"] [data-lora="style_a"]');
      const w = await page.inputValue('[data-resources="edit"] [data-lora="style_a"] input[type=range]'); assert.equal(Number(w), 0.7);
      await ctx.close();
    });

    await test('model picker: concise, grouped, searchable', async () => {
      const { page, ctx } = await newPage(browser, srv.base);
      await page.evaluate(() => __dex.setScreen('create'));
      await page.waitForSelector('[data-model-picker="create"] button');
      const trig = await page.innerText('[data-model-picker="create"] > button'); assert.ok(trig.length < 80);
      await page.click('[data-model-picker="create"] > button');
      const total = await page.$$eval('[data-model-picker="create"] [role=option]', e => e.length); assert.ok(total >= 10);
      assert.ok((await page.innerText('[data-model-picker="create"] [role=listbox]')).includes('SDXL'));
      await page.fill('[data-model-picker="create"] input[type=search]', 'pony');
      const filtered = await page.$$eval('[data-model-picker="create"] [role=option]', e => e.map(x => x.innerText));
      assert.ok(filtered.length >= 1 && filtered.length < total && filtered.every(t => /pony/i.test(t)), 'search filters');
      await page.screenshot({ path: path.join(OUT, 'model-picker.png') });
      await ctx.close();
    });

    await test('presets: per-operation, versioned, privacy-aware, legacy migrated', async () => {
      const { page, ctx } = await newPage(browser, srv.base, { legacyRecipes: [{ id: '1', name: 'Old', target: 'sd15', steps: 20, cfg: 7, prompt: 'SECRET-OLD', negPrompt: 'n' }] });
      const migrated = await page.evaluate(() => JSON.parse(localStorage.getItem('dex_favorite_presets')));
      assert.equal(migrated[0].v, 2); assert.equal(migrated[0].mode, 'create'); assert.equal(migrated[0].prompt, undefined, 'prompt scrubbed (saving off)');
      await openEdit(page, 'fx-portrait.png', 'img2img');
      await page.click('[data-section="presets"] summary');
      await page.fill('[data-presets="img2img"] input[aria-label="New preset name"]', 'My i2i');
      await page.click('[data-presets="img2img"] button:has-text("Save preset")');
      const list = await page.evaluate(() => JSON.parse(localStorage.getItem('dex_favorite_presets')));
      const mine = list.find(r => r.name === 'My i2i'); assert.ok(mine);
      assert.deepEqual([mine.v, mine.mode, mine.steps, mine.prompt, mine.promptSaved, mine.imageId, mine.sourceId], [2, 'img2img', 17, undefined, false, undefined, undefined]);
      assert.ok(!JSON.stringify(list).includes('a saved prompt'), 'privacy off: no prompt text in any preset');
      for (const mode of ['inpaint', 'outpaint']) {
        await openEdit(page, 'fx-portrait.png', mode);
        await page.getByRole('spinbutton', { name: 'Steps', exact: true }).fill('23');
        await page.waitForFunction(() => __dex.ed.state.params.steps === '23');
        if (await page.locator('[data-section="presets"]').getAttribute('open') === null) await page.click('[data-section="presets"] summary');
        await page.fill(`[data-presets="${mode}"] input[aria-label="New preset name"]`, 'Closure ' + mode);
        await page.click(`[data-presets="${mode}"] button:has-text("Save preset")`);
        const saved = await page.evaluate(m => JSON.parse(localStorage.getItem('dex_favorite_presets')).find(r => r.name === 'Closure ' + m), mode);
        assert.equal(saved.mode, mode); assert.equal(saved.steps, '23');
        assert.equal(saved.prompt, undefined); assert.equal(saved.promptSaved, false);
        await page.getByRole('spinbutton', { name: 'Steps', exact: true }).fill('9');
        await page.selectOption(`[data-presets="${mode}"] select[aria-label="Saved presets"]`, saved.id);
        await page.waitForFunction(() => __dex.ed.state.params.steps === '23' && Array.from(document.querySelectorAll('[data-edit-workbench] label')).find(el => el.querySelector('span')?.textContent === 'Steps')?.querySelector('input')?.value === '23');
        assert.equal(await page.getByRole('spinbutton', { name: 'Steps', exact: true }).inputValue(), '23', mode + ' round trip');
      }
      await ctx.close();
    });

    await test('saving off: both browser storage areas exclude current edit prompt and negative after preset save and reload', async () => {
      const { page, ctx } = await newPage(browser, srv.base);
      const canaries = ['REV18-STORAGE-PROMPT-718', 'REV18-STORAGE-NEGATIVE-719'];
      await openEdit(page, 'fx-square.png', 'inpaint');
      await page.fill('[data-edit-prompt]', canaries[0]);
      await page.fill('[data-edit-negative]', canaries[1]);
      await page.click('[data-section="presets"] summary');
      await page.fill('[data-presets="inpaint"] input[aria-label="New preset name"]', 'Closure storage fixture');
      await page.click('[data-presets="inpaint"] button:has-text("Save preset")');
      const inspect = () => page.evaluate(() => ({
        local: Object.fromEntries(Object.keys(localStorage).map(k => [k, localStorage.getItem(k)])),
        session: Object.fromEntries(Object.keys(sessionStorage).map(k => [k, sessionStorage.getItem(k)])),
      }));
      for (const phase of ['before reload', 'after reload']) {
        if (phase === 'after reload') { await page.reload(); await page.waitForFunction(() => window.__dex && __dex.ed); }
        const storage = await inspect();
        for (const text of canaries) assert.ok(!JSON.stringify(storage).includes(text), phase + ': no private text in either storage area');
        assert.ok(storage.local.dex_favorite_presets.includes('Closure storage fixture'), 'positive storage control: preset persisted');
      }
      await ctx.close();
    });

    await test('saving ON: actual browser storage retains explicitly saved preset text after reload, sessionStorage remains unused', async () => {
      const { page, ctx } = await newPage(browser, srv.base);
      const canary = 'REV19-STORAGE-ON-92641';
      try {
        await page.evaluate(() => { __dex.setState({savePrompts:true}); localStorage.setItem('dex_save_prompts','true'); });
        await openEdit(page,'fx-square.png','inpaint');
        await page.fill('[data-edit-prompt]',canary); await page.fill('[data-edit-negative]',canary);
        await page.click('[data-section="presets"] summary');
        await page.fill('[data-presets="inpaint"] input[aria-label="New preset name"]','Rev19 retained preset');
        await page.click('[data-presets="inpaint"] button:has-text("Save preset")');
        for(const reload of [false,true]) {
          if(reload){await page.reload();await page.waitForFunction(()=>window.__dex && __dex.ed);}
          const storage=await page.evaluate(()=>({local:Object.fromEntries(Object.keys(localStorage).map(k=>[k,localStorage.getItem(k)])),session:Object.fromEntries(Object.keys(sessionStorage).map(k=>[k,sessionStorage.getItem(k)]))}));
          assert.ok(storage.local.dex_favorite_presets.includes(canary),'expected retention only in saved preset');
          assert.ok(!JSON.stringify(storage.session).includes(canary),'sessionStorage unused for private text');
        }
      } finally { await ctx.close(); }
    });

    await test('Detailer dialog traps focus, closes with Escape, and restores the opener', async () => {
      const { page, ctx } = await newPage(browser, srv.base);
      await page.evaluate(() => __dex.setScreen('library'));
      await page.getByRole('button', { name: 'Select fx-landscape.png for details', exact: true }).first().click();
      await page.getByRole('button', { name: 'Detailer', exact: true }).click();
      await page.waitForSelector('[data-detailer-dialog]');
      await page.waitForFunction(() => document.querySelector('[data-detailer-dialog]').contains(document.activeElement));
      await page.getByRole('button', { name: 'Close', exact: true }).press('Shift+Tab');
      assert.equal(await page.evaluate(() => document.activeElement.textContent), 'Run Detailer');
      await page.getByRole('button', { name: 'Run Detailer', exact: true }).press('Tab');
      assert.equal(await page.evaluate(() => document.activeElement.textContent), 'Close');
      await page.getByRole('button', { name: 'Close', exact: true }).press('Escape');
      await page.waitForSelector('[data-detailer-dialog]', { state: 'detached' });
      assert.equal(await page.locator('[data-detailer-dialog]').count(), 0);
      await ctx.close();
    });

    await test('safe owned detector stall shows terminal timeout, no mask/job, and healthy retry retains image/options', async () => {
      const { createDetector } = require('../../detailer');
      const { spawn } = require('node:child_process');
      const os = require('node:os');
      const owned = fs.mkdtempSync(path.join(os.tmpdir(), 'dex-detector-browser-'));
      const input = path.join(owned, 'source.png'); fs.writeFileSync(input, makePng(8, 8));
      const { page, ctx, posts } = await newPage(browser, srv.base);
      const workers = []; let healthy = false;
      const detect = createDetector({ binary: '/bin/sh', attempts: 1, defaultTimeoutMs: 1000,
        spawnWorker: () => {
          const code = healthy ? `printf '%s\\n' '{"status":"ok","detections":[{"class":"hand"}]}'` : `echo DEXDETAIL_STAGE=vision-begin >&2; read held;`;
          const c = spawn('/bin/sh', ['-c', code]); workers.push(c); return c;
        } });
      try {
        await page.route('**/api/detailer/mask-preview', async r => {
          try { const result = await detect(input, { mode: 'hand' }); await r.fulfill({ json: { ...result, mask_preview: 'data:image/png;base64,' + makePng(8,8).toString('base64') } }); }
          catch(e) { await r.fulfill({ status: e.status, json: { code:e.code,error:e.message } }); }
        });
        await page.evaluate(() => __dex.setScreen('library'));
        await page.getByRole('button',{name:'Select fx-landscape.png for details',exact:true}).first().click();
        await page.getByRole('button',{name:'Detailer',exact:true}).click();
        await page.getByRole('button',{name:'Hand (Derived ROI)',exact:true}).click();
        await page.getByRole('button',{name:'Preview Mask',exact:true}).click();
        await page.waitForFunction(() => !__dex.ws.detailer.loading && /did not finish/.test(__dex.ws.detailer.note));
        assert.match(await page.locator('[data-detailer-dialog]').innerText(),/did not finish/);
        assert.equal(await page.evaluate(() => __dex.ws.detailer.maskPreview), null);
        assert.equal(posts.filter(p=>p.url==='/api/actions/inpaint').length,0);
        for(const c of workers) assert.throws(()=>process.kill(c.pid,0),/ESRCH/);
        const before = await page.evaluate(() => __dex.detailerPayload(__dex.ws.detailer));
        healthy = true;
        await page.getByRole('button',{name:'Preview Mask',exact:true}).click();
        await page.waitForFunction(() => !__dex.ws.detailer.loading && !!__dex.ws.detailer.maskPreview);
        assert.deepEqual(await page.evaluate(() => __dex.detailerPayload(__dex.ws.detailer)), before);
      } finally { await ctx.close(); fs.rmSync(owned,{recursive:true,force:true}); }
    });

    await test('Detailer keeps truthful job progress visible until the canonical result is ready', async () => {
      const { page, ctx } = await newPage(browser, srv.base);
      await page.route('**/api/detailer/mask-preview', r => r.fulfill({ json: { mask_preview: 'data:image/png;base64,' + makePng(800,500).toString('base64'), detections: [{ class: 'face' }] } }));
      await page.evaluate(() => __dex.setScreen('library'));
      await page.getByRole('button', { name: 'Select fx-landscape.png for details', exact: true }).first().click();
      await page.getByRole('button', { name: 'Detailer', exact: true }).click();
      await page.getByRole('button', { name: 'Run Detailer', exact: true }).click();
      await page.waitForFunction(() => /Sampling step 3\/10/.test(document.querySelector('[data-detailer-note]')?.textContent || ''));
      assert.equal(await page.locator('[data-detailer-dialog]').count(), 1);
      await page.waitForFunction(() => !document.querySelector('[data-detailer-dialog]'));
      await page.waitForSelector('img[alt="Hero result"]');
      await ctx.close();
    });

    for (const width of [375, 768, 1280]) {
      await test(`responsive @${width}px: no horizontal overflow on Create/Edit/Library`, async () => {
        const { page, ctx } = await newPage(browser, srv.base, { width, height: width < 800 ? 812 : 900 });
        for (const screen of ['create', 'edit', 'library']) {
          if (screen === 'edit') await openEdit(page, 'fx-landscape.png', 'inpaint'); else await page.evaluate(s => __dex.setScreen(s), screen);
          await page.waitForTimeout(250);
          const o = await page.evaluate(() => { const bad = []; document.querySelectorAll('[data-scroll-pane]').forEach(p => { if (p.scrollWidth > p.clientWidth + 1) bad.push('pane ' + p.scrollWidth + '>' + p.clientWidth); }); return { doc: document.documentElement.scrollWidth - innerWidth, bad }; });
          assert.ok(o.doc <= 1 && !o.bad.length, `${screen}: ${JSON.stringify(o)}`);
          if (screen === 'edit') await page.screenshot({ path: path.join(OUT, `edit-${width}.png`) });
        }
        await ctx.close();
      });
    }
  } finally { await browser.close(); await srv.stop(); }
  const failed = results.filter(r => r[0] === 'FAIL');
  console.log(`\n${results.length - failed.length}/${results.length} browser checks passed`);
  fs.writeFileSync(path.join(OUT, 'edit-workbench-results.json'), JSON.stringify(results, null, 1));
  process.exit(exitCode(failed.length));
})().catch(e => { console.error(e); runCleanups().then(() => process.exit(2)); });
