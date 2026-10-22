'use strict';
// V2 parity rows 8, 9 and 30 against the REAL isolated console: seeded canonical images carry recorded settings and
// identity (see helpers seedCanonicalImages), so filtering, sorting, integrity gating and persistence are the server's own.
const assert = require('node:assert/strict');
const { chromium } = require('playwright-core');
const { startServer, installModelSnapshots, runner, launchBrowser, runCleanups, openStudio } = require('./helpers');

const { test, results, exitCode } = runner('v2-parity-library-flow');
const mk = (n, meta, extra) => Object.assign({ id: `fixture-${n}.png`, width: 40, height: 30, meta }, extra);
const SEED = [
  mk('a1', { target: 'sd15', operation: 'txt2img', seed: 11, steps: 20, cfg: 7, sampler: 'euler_a' }),
  mk('b2', { target: 'flux2-klein-4b', operation: 'txt2img', seed: 22, steps: 8, backend: 'mflux' }),
  mk('c3', { target: 'sd15', operation: 'img2img', seed: 33, steps: 25, cfg: 6, sampler: 'heun', keeper: true }),
  mk('d4', { target: 'sd15', operation: 'inpaint', seed: 44, steps: 18, cfg: 7, sampler: 'euler' }),
];
const GRID = '[data-lib-grid]';
const ids = page => page.locator(GRID + ' [data-lib-thumb]').evaluateAll(els => els.map(e => e.getAttribute('data-lib-thumb')));
const short = a => a.map(x => x.replace('fixture-', '').replace('.png', ''));

async function open(page, base) {
  const errors = [];
  page.on('pageerror', e => errors.push(String(e)));
  await installModelSnapshots(page, base);
  await page.route('**/api/extra-networks**', r => r.fulfill({ json: { loras: [], vaes: [], embeddings: { count: 0, items: [] } } }));
  await openStudio(page, base + '/dexdiffusion/', { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => window.__dex && __dex.state.version === 2 && __dex.state.modelTargets && __dex.state.modelTargets.length > 3);
  await page.evaluate(() => __dex.setScreen('library'));
  await page.waitForFunction(() => document.querySelectorAll('[data-lib-grid] [data-lib-thumb]').length > 0, null, { timeout: 15000 });
  return errors;
}
// Library has two filter rows (mixed-media kinds, then image filters); the image filters sit in the panel with the grid controls.
const clickFilter = async (page, label) => { await page.locator('[data-lib-controls]').locator('xpath=ancestor::div[1]').getByRole('button', { name: label, exact: true }).click(); await page.waitForTimeout(500); };

(async () => {
  const srv = process.env.DEX_TEST_BASE ? { base: process.env.DEX_TEST_BASE, stop() {} } : await startServer({ seedCanonicalImages: SEED });
  const browser = await launchBrowser(chromium);
  try {
    await test('row 30: filters, sort and empty states return exactly the matching canonical images', async () => {
      const page = await browser.newPage({ viewport: { width: 1348, height: 900 } });
      const errors = await open(page, srv.base);
      assert.deepEqual(short(await ids(page)), ['d4', 'c3', 'b2', 'a1'], 'newest first by default');
      await clickFilter(page, '★ Keepers');
      assert.deepEqual(short(await ids(page)), ['c3']);
      await clickFilter(page, 'SD1.5');
      assert.deepEqual(short(await ids(page)).sort(), ['a1', 'c3', 'd4']);
      await clickFilter(page, 'FLUX');
      assert.deepEqual(short(await ids(page)), ['b2']);
      await clickFilter(page, 'Img2Img');
      assert.deepEqual(short(await ids(page)), ['c3']);
      await clickFilter(page, 'Outpaint');
      assert.deepEqual(await ids(page), []);
      assert.match(await page.locator('body').innerText(), /No images for this filter/);
      await clickFilter(page, 'All');
      await page.locator('[data-lib-control="sort"]').selectOption('asc');
      await page.waitForFunction(() => [...document.querySelectorAll('[data-lib-grid] [data-lib-thumb]')][0]?.getAttribute('data-lib-thumb') === 'fixture-a1.png');
      assert.deepEqual(short(await ids(page)), ['a1', 'b2', 'c3', 'd4'], 'oldest first reverses the order');
      assert.deepEqual(errors, []);
      await page.close();
    });

    await test('row 30: a selected image stays selected when the sort changes; the run filter narrows the loaded runs', async () => {
      const page = await browser.newPage({ viewport: { width: 1348, height: 900 } });
      const errors = await open(page, srv.base);
      await page.locator(GRID).getByRole('button', { name: 'Select fixture-c3.png for details' }).click();
      await page.locator('[data-library-generation-metadata="fixture-c3.png"]').waitFor();
      await page.locator('[data-lib-control="sort"]').selectOption('asc');
      await page.waitForTimeout(600);
      assert.equal(await page.locator('[data-library-generation-metadata="fixture-c3.png"]').count(), 1, 'selection persists across a sort change');
      assert.equal(await page.evaluate(() => __dex._ws().lib.selectedId), 'fixture-c3.png');
      assert.deepEqual(errors, []);
      await page.close();
    });

    await test('row 9: details show the recorded generation settings truthfully (no invented prompt, "LoRA none recorded")', async () => {
      const page = await browser.newPage({ viewport: { width: 1348, height: 900 } });
      const errors = await open(page, srv.base);
      await page.locator(GRID).getByRole('button', { name: 'Select fixture-c3.png for details' }).click();
      const meta = page.locator('[data-library-generation-metadata="fixture-c3.png"]'); await meta.waitFor();
      const t = await meta.innerText();
      for (const re of [/checkpoint sd15/, /seed 33/, /25 steps/, /sampler heun/, /CFG 6/, /LoRA none recorded/]) assert.match(t, re);
      assert.doesNotMatch(await page.locator('body').innerText(), /Negative prompt:/);
      assert.deepEqual(errors, []);
      await page.close();
    });

    await test('row 8/9: Reuse Settings restores recorded settings into Create and says the prompt was never saved', async () => {
      const page = await browser.newPage({ viewport: { width: 1348, height: 900 } });
      const errors = await open(page, srv.base);
      await page.locator(GRID).getByRole('button', { name: 'Select fixture-c3.png for details' }).click();
      await page.locator('[data-library-generation-metadata="fixture-c3.png"]').waitFor();
      await page.locator('summary', { hasText: 'More image actions' }).click();
      await page.getByRole('button', { name: 'Reuse Settings', exact: true }).click();
      await page.waitForFunction(() => __dex.state.toasts.some(t => /prompt was not saved/.test(t.msg)), null, { timeout: 8000 });
      await page.waitForFunction(() => __dex.state.screens[2] === 'create' && /^sd15/.test(__dex.state.target) && String(__dex.state.steps) === '25').catch(async () => { throw new Error('Reuse Settings result: ' + JSON.stringify(await page.evaluate(() => ({ screen: __dex.state.screens[2], target: __dex.state.target, steps: __dex.state.steps, seed: __dex.state.seed, sampler: __dex.state.sampler, toasts: __dex.state.toasts.map(t => t.msg) })))); });
      const st = await page.evaluate(() => ({ seed: String(__dex.state.seed), sampler: __dex.state.sampler, cfg: String(__dex.state.cfg), prompt: __dex.state.prompt }));
      assert.equal(st.seed, '33'); assert.equal(st.sampler, 'heun'); assert.equal(st.cfg, '6'); assert.equal(st.prompt || '', '', 'a prompt that was not saved is not invented');
      assert.deepEqual(errors, []);
      await page.close();
    });

    await test('row 9: Keeper is written by the server and survives a reload', async () => {
      const page = await browser.newPage({ viewport: { width: 1348, height: 900 } });
      const errors = await open(page, srv.base);
      await page.locator(GRID).getByRole('button', { name: 'Select fixture-a1.png for details' }).click();
      await page.locator('[data-library-generation-metadata="fixture-a1.png"]').waitFor();
      await page.locator('summary', { hasText: 'More image actions' }).click();
      await page.getByRole('button', { name: /☆ Keeper/ }).click();
      await page.waitForFunction(async () => (await (await fetch('/api/library/images?filter=keepers')).json()).items.some(i => i.id === 'fixture-a1.png'));
      await page.reload({ waitUntil: 'domcontentloaded' });
      await page.waitForFunction(() => window.__dex && __dex.state.version === 2 && __dex.state.modelTargets?.length > 3);
      await page.evaluate(() => __dex.setScreen('library'));
      await page.waitForFunction(() => document.querySelectorAll('[data-lib-grid] [data-lib-thumb]').length > 0);
      await clickFilter(page, '★ Keepers');
      assert.deepEqual(short(await ids(page)).sort(), ['a1', 'c3']);
      assert.deepEqual(errors, []);
      await page.close();
    });

    await test('row 9: a library image continues into Edit, Enhance, 3D and World as the same canonical asset', async () => {
      const page = await browser.newPage({ viewport: { width: 1348, height: 900 } });
      const errors = await open(page, srv.base);
      const select = async () => { await page.evaluate(() => __dex.setScreen('library')); await page.waitForFunction(() => document.querySelectorAll('[data-lib-grid] [data-lib-thumb]').length > 0); await page.locator(GRID).getByRole('button', { name: 'Select fixture-b2.png for details' }).click(); await page.locator('[data-library-primary-actions="fixture-b2.png"]').waitFor(); };
      await select();
      await page.locator('[data-library-primary-actions] button', { hasText: /^Enhance$/ }).click();
      await page.waitForFunction(() => __dex.state.screens[2] === 'enhance' && __dex._ws().enhSourceId === 'fixture-b2.png');
      await select();
      await page.locator('[data-library-primary-actions] button', { hasText: /^Use for 3D$/ }).click();
      await page.waitForFunction(() => __dex.state.screens[2] === '3d' && __dex.state.asset3dSourceArtifact === 'fixture-b2.png');
      await select();
      await page.locator('[data-library-primary-actions] button', { hasText: /^Use for World$/ }).click();
      await page.waitForFunction(() => __dex.state.screens[2] === 'world' && __dex.state.worldSourceArtifact === 'fixture-b2.png');
      await select();
      const edit = page.locator('[data-library-primary-actions] button', { hasText: /^Edit$/ });
      if (await edit.count()) { await edit.click(); await page.waitForFunction(() => __dex.state.screens[2] === 'edit'); }
      assert.deepEqual(errors, []);
      await page.close();
    });

    await test('row 8: a durable Drama project is listed after a reload and reopens with its script and scenes', async () => {
      const page = await browser.newPage({ viewport: { width: 1348, height: 900 } });
      const SCRIPT = 'INT. WAREHOUSE - NIGHT\nTIGER: I warned you about the lamp.\nCODEC: I know that already.\n\nEXT. ROOFTOP - DAWN\nNARRATOR: And so it ended.';
      const made = await (await fetch(srv.base + '/api/drama/projects', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ title: 'ZZ Resume Project', script: SCRIPT }) })).json();
      assert.ok(made.project && made.project.id, 'the project was stored by the server');
      try {
        const errors = await open(page, srv.base);
        await page.evaluate(() => __dex.setScreen('drama'));
        const pick = page.getByLabel('Open project');
        await pick.waitFor();
        await page.waitForFunction(id => [...document.querySelectorAll('select[aria-label="Open project"] option')].some(o => o.value === id), made.project.id, { timeout: 15000 });
        await pick.selectOption(made.project.id);
        await page.waitForFunction(id => __dex.dm && __dex.dm.current && __dex.dm.current.id === id, made.project.id, { timeout: 15000 });
        assert.equal(await page.evaluate(() => __dex.dm.current.title), 'ZZ Resume Project');
        assert.equal(await page.evaluate(() => (__dex.dm.current.scenes || []).length), 2, 'both scenes are restored');
        assert.match(await page.locator('body').innerText(), /ZZ Resume Project/);
        // After a full reload the project is still listed and reopens (state lives on the server, not in the page).
        await page.reload({ waitUntil: 'domcontentloaded' });
        await page.waitForFunction(() => window.__dex && __dex.state.version === 2 && __dex.state.modelTargets?.length > 3);
        await page.evaluate(() => __dex.setScreen('drama'));
        await page.waitForFunction(id => [...document.querySelectorAll('select[aria-label="Open project"] option')].some(o => o.value === id), made.project.id, { timeout: 15000 });
        await page.getByLabel('Open project').selectOption(made.project.id);
        await page.waitForFunction(id => __dex.dm && __dex.dm.current && __dex.dm.current.id === id, made.project.id, { timeout: 15000 });
        assert.deepEqual(errors, []);
      } finally {
        await fetch(srv.base + '/api/drama/projects/' + made.project.id, { method: 'DELETE' }).catch(() => {});
        await page.close();
      }
    });
  } finally {
    await runCleanups();
  }
  process.exitCode = exitCode(results.some(r => r[0] !== 'PASS'));
})().catch(async e => { console.error(e); await runCleanups(); process.exitCode = 2; });
