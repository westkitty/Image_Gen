'use strict';
// SC-16..SC-19: Prompt matrix and Prompts from list in the Batch / Sweep workspace — controls, dry-run preview, request shape,
// plus the real server validators over HTTP. No image is generated (queue creation is intercepted).
const assert = require('node:assert/strict');
const { chromium } = require('playwright-core');
const { startServer, installModelSnapshots, installImageFixtures, runner, launchBrowser, runCleanups } = require('./helpers');

const FX = { 'fx-landscape.png': { w: 800, h: 500, meta: { operation: 'txt2img', target: 'sd15', seed: 1, steps: 20, cfg: 7, sampler: 'euler_a', scheduler: 'discrete', vae: 'auto', loras: [], gen_schema: 1, prompt_saved: false } } };
const { test, results, exitCode } = runner('prompt-matrix');

async function newPage(browser, base, prompt) {
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 } });
  const page = await ctx.newPage();
  const errors = [], plans = [], starts = [];
  page.on('pageerror', e => errors.push(String(e)));
  await installModelSnapshots(page, base);
  await installImageFixtures(page, FX);
  await page.route('**/api/extra-networks**', r => r.fulfill({ json: { loras: [], vaes: [], embeddings: { count: 0, items: [] } } }));
  await page.route('**/api/models/secondary/activate', r => r.fulfill({ json: { ok: true, activeSecondaryModel: 'sd15', modelState: {} } }));
  await page.route(/\/api\/prompt(matrix|lines)\/plan$/, r => { plans.push({ url: r.request().url(), body: r.request().postDataJSON() }); r.continue(); });
  await page.route(/\/api\/prompt(matrix|lines)$/, r => { starts.push({ url: r.request().url(), body: r.request().postDataJSON() }); r.fulfill({ status: 400, json: { error: 'intercepted by test' } }); });
  await page.goto(base + '/dexdiffusion/');
  await page.waitForFunction(() => window.__dex && __dex.state.modelTargets && __dex.state.modelTargets.length > 3 && __dex.state.capabilityData);
  await page.evaluate(p => { __dex.setState({ prompt: p, target: 'sd15' }); __dex.setScreen('batch'); }, prompt);
  await page.waitForSelector('[data-pmx-panel]');
  return { page, ctx, errors, plans, starts };
}
const m = (page, k) => page.locator('[data-pmx-field="' + k + '"]');
const l = (page, k) => page.locator('[data-plines-field="' + k + '"]');

(async () => {
  const srv = process.env.DEX_TEST_BASE ? { base: process.env.DEX_TEST_BASE, stop() {} } : await startServer();
  const browser = await launchBrowser(chromium);
  try {
    await test('matrix: Check asks the real server and lists the 8 exact cells; options are sent', async () => {
      const { page, ctx, errors, plans } = await newPage(browser, srv.base, 'a cat | red hat | blue scarf | sunset');
      assert.match(await m(page, 'unavailable').innerText(), /Not available/);
      await m(page, 'put-at-start').check();
      await page.click('[data-pmx-panel] button:has-text("Check matrix")');
      await page.waitForSelector('[data-pmx-field="plan"]');
      const text = await m(page, 'plan').innerText();
      assert.match(text, /8 cells · 4 × 2/);   // A1111 draw_prompt_matrix: ceil(3/2) = 2 parts across -> 4 columns
      assert.match(text, /1\. a cat/);
      assert.match(text, /8\. red hat, blue scarf, sunset, a cat/);
      assert.equal(await page.locator('[data-pmx-field="cells"] [data-cell]').count(), 8);
      assert.equal(plans.length, 1); assert.match(plans[0].url, /\/api\/promptmatrix\/plan$/);
      assert.equal(plans[0].body.put_at_start, true); assert.equal(plans[0].body.target, 'positive'); assert.equal(plans[0].body.joiner, 'comma');
      assert.equal(plans[0].body.settings.prompt, 'a cat | red hat | blue scarf | sunset');
      assert.deepEqual(errors, []);
      await ctx.close();
    });
    await test('matrix: a prompt without | is refused with the reason and nothing is started; a valid one starts', async () => {
      const { page, ctx, starts } = await newPage(browser, srv.base, 'a plain cat');
      await page.click('[data-pmx-panel] button:has-text("Start matrix")');
      await page.waitForSelector('[data-pmx-field="error"]');
      assert.match(await m(page, 'error').innerText(), /Add at least one "\|"/);
      assert.equal(starts.length, 0);
      await page.evaluate(() => __dex.setState({ prompt: 'a cat | red hat' }));
      await m(page, 'different-seeds').check();
      await page.click('[data-pmx-panel] button:has-text("Start matrix")');
      for (let i = 0; i < 30 && !starts.length; i++) await page.waitForTimeout(100);
      assert.equal(starts.length, 1); assert.match(starts[0].url, /\/api\/promptmatrix$/);
      assert.equal(starts[0].body.different_seeds, true);
      await ctx.close();
    });
    await test('lines: dry run shows the exact normalised jobs; a bad line is refused with its number', async () => {
      const { page, ctx, plans, starts } = await newPage(browser, srv.base, 'base prompt');
      assert.match(await l(page, 'unavailable').innerText(), /--sd_model/);
      await l(page, 'text').fill('a red cat\n\n--prompt "a blue dog" --steps 12 --seed 5 --sampler_name "Euler a" --negative_prompt "ugly"\n--steps 9');
      await page.click('[data-plines-panel] button:has-text("Dry run")');
      await page.waitForSelector('[data-plines-field="plan"]');
      const text = await l(page, 'plan').innerText();
      assert.match(text, /3 prompts · 1 blank lines skipped/);
      assert.match(text, /1\. Line 1 · a red cat base prompt/, 'A1111 inserts a line at the start of a non-empty Create prompt');
      assert.match(text, /2\. Line 3 · a blue dog base prompt\s+negative: ugly\s+\d+×\d+ · 12 steps .*euler_a · seed 5/);
      assert.match(text, /3\. Line 4 · base prompt/, 'a flag-only line uses the Create prompt');
      assert.equal(plans[0].body.text.split('\n').length, 4);
      await l(page, 'text').fill('fine\n--prompt x --bogus 1');
      await page.click('[data-plines-panel] button:has-text("Start list")');
      await page.waitForSelector('[data-plines-field="error"]');
      assert.match(await l(page, 'error').innerText(), /^Line 2: unknown flag --bogus/);
      assert.equal(starts.length, 0);
      await l(page, 'text').fill('one\ntwo');
      await l(page, 'iterate-seed').check();
      await page.click('[data-plines-panel] button:has-text("Start list")');
      for (let i = 0; i < 30 && !starts.length; i++) await page.waitForTimeout(100);
      assert.equal(starts.length, 1); assert.match(starts[0].url, /\/api\/promptlines$/); assert.equal(starts[0].body.iterate_seed, true);
      await ctx.close();
    });
    await test('server: matrix and list validators, gating, caps, seeds and confirmation over HTTP', async () => {
      const post = async (url, body) => { const r = await fetch(srv.base + url, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) }); return { s: r.status, j: await r.json() }; };
      const st = { target: 'sd15', prompt: 'a cat | red hat | blue scarf', steps: 20, width: 512, height: 512, seed: 7, quantity: 1 };
      const ok = await post('/api/promptmatrix/plan', { settings: st });
      assert.equal(ok.s, 200, JSON.stringify(ok.j)); assert.equal(ok.j.total, 4); assert.deepEqual(ok.j.dims, [2, 2, 1]); assert.equal(ok.j.fixedSeed, 7);
      assert.equal(ok.j.cells[3].prompt, 'a cat, red hat, blue scarf'); assert.equal(ok.j.cells[3].job.seed, 7); assert.equal(ok.j.cells[3].job.steps, 20);
      assert.deepEqual(ok.j.axes[0].values, ['base only', 'red hat']);
      const diff = await post('/api/promptmatrix/plan', { settings: st, different_seeds: true });
      assert.deepEqual(diff.j.cells.map(c => c.job.seed), [7, 8, 9, 10]);
      const none = await post('/api/promptmatrix/plan', { settings: { ...st, prompt: 'no bars here' } });
      assert.equal(none.s, 400); assert.match(none.j.error, /at least one "\|"/);
      const big = await post('/api/promptmatrix/plan', { settings: { ...st, prompt: 'b | 1 | 2 | 3 | 4 | 5 | 6 | 7' } });
      assert.equal(big.s, 400); assert.match(big.j.error, /limit is 6 parts/);
      const flux = await post('/api/promptmatrix/plan', { settings: { ...st, target: 'flux2-klein-4b', prompt: 'a | b' , negative_prompt: 'x | y' }, target: 'negative' });
      assert.equal(flux.s, 400); assert.match(flux.j.error, /does not use a negative prompt/);
      const negOk = await post('/api/promptmatrix/plan', { settings: { ...st, prompt: 'a cat', negative_prompt: 'ugly | blurry' }, target: 'negative' });
      assert.equal(negOk.s, 200); assert.deepEqual(negOk.j.cells.map(c => c.negative_prompt), ['ugly', 'ugly, blurry']);
      const rnd = await post('/api/promptmatrix/plan', { settings: { ...st, seed: -1 } });
      assert.ok(Number.isInteger(rnd.j.fixedSeed) && rnd.j.fixedSeed >= 0);
      assert.equal((await post('/api/promptmatrix/plan', { settings: { ...st, seed: -1 }, keep_random_seed: true })).j.fixedSeed, null);
      const noPrompt = await post('/api/promptmatrix/plan', { settings: { ...st, prompt: '' } });
      assert.equal(noPrompt.s, 400); assert.match(noPrompt.j.error, /Enter a prompt/);
      // large confirmation: 5 parts = 32 cells > the large-request threshold
      const large = await post('/api/promptmatrix', { settings: { ...st, prompt: 'b | 1 | 2 | 3 | 4 | 5' } });
      assert.equal(large.s, 409); assert.equal(large.j.needs_confirmation, true);

      const lst = { target: 'sd15', prompt: '', steps: 20, width: 512, height: 512, seed: 3, quantity: 1 };
      const lp = await post('/api/promptlines/plan', { settings: lst, text: 'a cat\n\n--prompt "a dog" --steps 9 --cfg_scale 6 --sampler_name "Euler a" --width 640 --height 448 --negative_prompt "ugly"' });
      assert.equal(lp.s, 200, JSON.stringify(lp.j)); assert.equal(lp.j.total, 2); assert.equal(lp.j.skipped, 1);
      assert.deepEqual([lp.j.cells[1].job.steps, lp.j.cells[1].job.cfg_scale, lp.j.cells[1].job.width, lp.j.cells[1].job.height, lp.j.cells[1].job.sampler, lp.j.cells[1].job.negative_prompt], [9, 6, 640, 448, 'euler_a', 'ugly']);
      assert.equal(lp.j.cells[0].job.steps, 20); assert.equal(lp.j.cells[0].job.seed, 3);
      const it = await post('/api/promptlines/plan', { settings: lst, text: 'a\nb\nc', iterate_seed: true });
      assert.deepEqual(it.j.cells.map(c => c.job.seed), [3, 4, 5]);
      const badLine = await post('/api/promptlines/plan', { settings: lst, text: 'ok\n--prompt x --steps nine' });
      assert.equal(badLine.s, 400); assert.match(badLine.j.error, /^Line 2: --steps "nine" is not a whole number/);
      const badCell = await post('/api/promptlines/plan', { settings: lst, text: 'ok\n--prompt x --width 100' });
      assert.equal(badCell.s, 400); assert.match(badCell.j.error, /^Line 2: Width must be a multiple of 8/);
      const fluxCfg = await post('/api/promptlines/plan', { settings: { ...lst, target: 'flux2-klein-4b' }, text: '--prompt x --cfg_scale 5' });
      assert.equal(fluxCfg.s, 400); assert.match(fluxCfg.j.error, /^Line 1: --cfg_scale is refused/);
      const empty = await post('/api/promptlines/plan', { settings: lst, text: '\n \n' });
      assert.equal(empty.s, 400); assert.match(empty.j.error, /at least one prompt/);
      const many = await post('/api/promptlines/plan', { settings: lst, text: Array.from({ length: 65 }, (_, i) => 'p' + i).join('\n') });
      assert.equal(many.s, 400); assert.match(many.j.error, /limit is 64/);
      const lbig = await post('/api/promptlines', { settings: lst, text: Array.from({ length: 13 }, (_, i) => 'p' + i).join('\n') });
      assert.equal(lbig.s, 409); assert.equal(lbig.j.needs_confirmation, true);
      const nogrid = await post('/api/xyz/does-not-exist/grid', {});
      assert.equal(nogrid.s, 404);
    });
  } finally {
    await browser.close(); srv.stop && srv.stop();
    await runCleanups();
  }
  process.exitCode = exitCode(results.some(r => r[0] !== 'PASS'));
})().catch(async e => { console.error(e); await runCleanups(); process.exitCode = 2; });
