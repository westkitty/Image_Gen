'use strict';
// P03 acceptance: the Concept A Generate form exposes sampler, CLIP skip and VAE tiling, sends exactly
// those values to /api/actions/generate-controlled, and hides/explains them for MFLUX targets.
// The generation request is intercepted and refused, so this suite never runs inference.
const assert = require('node:assert/strict');
const { chromium } = require('playwright-core');
const { startServer, installModelSnapshots, runner, launchBrowser, runCleanups } = require('./helpers');

const { test, results, exitCode } = runner('generate-sampling');
const ENDPOINT = '**/api/actions/generate-controlled';

async function openGenerate(page, base) {
  const errors = [];
  page.on('pageerror', e => errors.push(String(e)));
  await installModelSnapshots(page, base);
  const bodies = [];
  // Selecting an SDCPP target would otherwise really switch Big Mac's secondary model slot.
  await page.route('**/api/models/secondary/activate', route => route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ modelState: {} }) }));
  await page.route(ENDPOINT, route => {
    bodies.push(JSON.parse(route.request().postData() || '{}'));
    route.fulfill({ status: 400, contentType: 'application/json', body: JSON.stringify({ error: 'intercepted by test' }) });
  });
  await page.goto(base + '/dexdiffusion/', { waitUntil: 'domcontentloaded' });
  if (!(await page.locator('.ca-shell').count())) await page.locator('[data-vbtn="4"]').click();
  await page.waitForSelector('.ca-shell');
  await page.locator('.ca-nav-item', { hasText: 'Generate' }).click();
  await page.waitForSelector('.ca-shell[data-ca-module="generate"]');
  await page.waitForTimeout(300);
  return { errors, bodies };
}

async function chooseTarget(page, id) {
  const select = page.locator('select', { has: page.locator(`option[value="${id}"]`) }).first();
  await select.waitFor({ state: 'visible' });
  await select.selectOption(id);
  await page.waitForTimeout(300);
}

async function generateOnce(page, bodies) {
  const before = bodies.length;
  await page.locator('.ca-generate-form textarea').first().fill('a red fox in snow');
  await page.locator('.ca-generate-form .ca-primary').click();
  for (let i = 0; i < 40 && bodies.length === before; i++) await page.waitForTimeout(100);
  assert.equal(bodies.length, before + 1, 'exactly one generation request was sent');
  return bodies[bodies.length - 1];
}

(async () => {
  const srv = process.env.DEX_TEST_BASE ? { base: process.env.DEX_TEST_BASE, stop() {} } : await startServer();
  const browser = await launchBrowser(chromium);
  try {
    await test('SDCPP target shows sampler, CLIP skip and tiling and sends the chosen values', async () => {
      const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
      const { errors, bodies } = await openGenerate(page, srv.base);
      await chooseTarget(page, 'sdxl-base');
      const sampler = page.locator('[data-dex-field="sampler"]');
      await sampler.waitFor({ state: 'visible' });
      assert.equal(await sampler.count(), 1);
      assert.deepEqual(await sampler.locator('option').evaluateAll(o => o.map(x => x.value)),
        ['euler_a', 'euler', 'heun', 'dpm2', 'dpmpp2s_a', 'dpmpp2m', 'dpmpp2mv2', 'ipndm', 'ipndm_v', 'lcm', 'ddim_trailing', 'tcd', 'res_multistep', 'res_2s', 'er_sde', 'euler_cfg_pp', 'euler_a_cfg_pp']);
      assert.equal(await page.locator('[data-dex-field="sampling-note"]').count(), 0);
      await sampler.selectOption('heun');
      await page.locator('[data-dex-field="clip-skip"]').fill('2');
      await page.locator('[data-dex-field="tiling"]').check();
      const body = await generateOnce(page, bodies);
      assert.equal(body.target, 'sdxl-base');
      assert.equal(body.sampler, 'heun');
      assert.equal(body.clip_skip, 2);
      assert.equal(body.tiling, true);
      assert.deepEqual(errors, []);
      await page.close();
    });

    await test('two different samplers produce two different requests; defaults add no clip skip or tiling', async () => {
      const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
      const { errors, bodies } = await openGenerate(page, srv.base);
      await chooseTarget(page, 'sdxl-base');
      await page.locator('[data-dex-field="sampler"]').selectOption('euler_a');
      const a = await generateOnce(page, bodies);
      await page.locator('[data-dex-field="sampler"]').selectOption('dpmpp2m');
      const b = await generateOnce(page, bodies);
      assert.equal(a.sampler, 'euler_a');
      assert.equal(b.sampler, 'dpmpp2m');
      for (const body of [a, b]) {
        assert.equal('clip_skip' in body, false);
        assert.equal('tiling' in body, false);
      }
      assert.deepEqual(errors, []);
      await page.close();
    });

    await test('a target default such as dpm++2m is shown and sent as its canonical id', async () => {
      const caps = await (await fetch(srv.base + '/api/capabilities')).json();
      const t = (caps.modelTargets || []).find(x => x.backend !== 'mflux' && x.defaultSampler === 'dpm++2m');
      assert.ok(t, 'a target whose default sampler is spelled dpm++2m exists in the catalogue');
      const capOf = id => (caps.modelTargets.find(x => x.id === id) || {}).capabilities || {};
      for (const id of ['flux2-klein-4b', 'flux-fp8']) assert.deepEqual([capOf(id).sampler, capOf(id).clipSkip, capOf(id).tiling], [false, false, false], id);
      assert.deepEqual([capOf(t.id).sampler, capOf(t.id).clipSkip, capOf(t.id).tiling], [true, true, true], t.id);
      const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
      const { errors, bodies } = await openGenerate(page, srv.base);
      await chooseTarget(page, t.id);
      const sampler = page.locator('[data-dex-field="sampler"]');
      await sampler.waitFor({ state: 'visible' });
      assert.equal(await sampler.inputValue(), 'dpmpp2m');
      const body = await generateOnce(page, bodies);
      assert.equal(body.target, t.id);
      assert.equal(body.sampler, 'dpmpp2m');
      assert.deepEqual(errors, []);
      await page.close();
    });

    await test('MFLUX target hides the controls, explains why, and sends no sampling fields', async () => {
      const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
      const { errors, bodies } = await openGenerate(page, srv.base);
      await chooseTarget(page, 'flux2-klein-4b');
      assert.equal(await page.locator('[data-dex-field="sampler"]').count(), 0);
      assert.equal(await page.locator('[data-dex-field="clip-skip"]').count(), 0);
      assert.equal(await page.locator('[data-dex-field="tiling"]').count(), 0);
      assert.match(await page.locator('[data-dex-field="sampling-note"]').innerText(), /fixed flow-match Euler/);
      const body = await generateOnce(page, bodies);
      for (const k of ['sampler', 'clip_skip', 'tiling']) assert.equal(k in body, false, k);
      assert.deepEqual(errors, []);
      await page.close();
    });

    await test('inspector shows the effective sampler, CLIP skip and tiling and follows the controls', async () => {
      const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
      const { errors } = await openGenerate(page, srv.base);
      await chooseTarget(page, 'sdxl-base');
      await page.locator('[data-dex-field="sampler"]').selectOption('heun');
      await page.locator('[data-dex-field="clip-skip"]').fill('2');
      await page.locator('[data-dex-field="tiling"]').check();
      await page.waitForTimeout(400);
      const text = await page.locator('.ca-inspector').innerText();
      assert.match(text, /Sampler\s*heun/i);
      assert.match(text, /CLIP skip \/ tiling\s*2 \/ VAE tiling on/i);
      await chooseTarget(page, 'flux2-klein-4b');
      await page.waitForTimeout(400);
      const klein = await page.locator('.ca-inspector').innerText();
      assert.match(klein, /Fixed \(flow-match Euler\)/);
      assert.match(klein, /Not available for this target/);
      assert.deepEqual(errors, []);
      await page.close();
    });

    await test('legacy V1-V3 sampler selects offer only supported ids and no unsupported A1111 aliases', async () => {
      for (const v of ['1', '2', '3']) {
        const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
        const { errors, bodies } = await openGenerate(page, srv.base);
        await page.locator(`[data-vbtn="${v}"]`).click();
        await page.waitForTimeout(600);
        const lists = await page.evaluate(() => [...document.querySelectorAll('select')]
          .filter(s => [...s.options].some(o => o.value === 'euler_a'))
          .map(s => ({ values: [...s.options].map(o => o.value), visible: !!s.offsetParent })));
        assert.ok(lists.length >= 1, 'legacy sampler select present in V' + v);
        for (const l of lists) {
          assert.deepEqual(l.values, ['euler_a', 'euler', 'heun', 'dpm2', 'dpmpp2s_a', 'dpmpp2m', 'dpmpp2mv2', 'ipndm', 'ipndm_v', 'lcm']);
          assert.equal(l.values.some(x => /sde|\+/.test(x)), false);
        }
        assert.deepEqual(errors, []);
        await page.close();
      }
    });

    await test('Preview request shows the same effective request and worker command that Generate sends', async () => {
      const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
      const { errors, bodies } = await openGenerate(page, srv.base);
      await chooseTarget(page, 'sdxl-base');
      await page.locator('.ca-generate-form textarea').first().fill('a secret fox prompt');
      await page.locator('[data-dex-field="sampler"]').selectOption('heun');
      await page.locator('[data-dex-field="clip-skip"]').fill('2');
      await page.locator('[data-dex-field="tiling"]').check();
      await page.locator('[data-dex-field="preview-button"]').click();
      await page.locator('[data-dex-field="preview-command"]').waitFor({ state: 'visible' });
      const command = await page.locator('[data-dex-field="preview-command"]').innerText();
      const json = JSON.parse(await page.locator('[data-dex-field="preview-json"]').innerText());
      assert.match(command, /sdcpp-controlled-generate\.sh/);
      assert.match(command, /--sampler heun/);
      assert.match(command, /--clip-skip 2/);
      assert.match(command, /--tiling/);
      assert.doesNotMatch(command, /secret fox/, 'command preview redacts the prompt');
      const sent = await generateOnce(page, bodies);
      for (const k of ['target', 'steps', 'width', 'height', 'sampler', 'clip_skip', 'tiling']) assert.equal(String(json[k]), String(sent[k]), k);
      assert.deepEqual(errors, []);
      await page.close();
    });

    await test('Preview request for MFLUX names the MFLUX worker and carries no SD-only flags; invalid input is rejected visibly', async () => {
      const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
      const { errors } = await openGenerate(page, srv.base);
      await chooseTarget(page, 'flux2-klein-4b');
      await page.locator('[data-dex-field="preview-button"]').click();
      await page.locator('[data-dex-field="preview-error"]').waitFor({ state: 'visible' });
      assert.match(await page.locator('[data-dex-field="preview-error"]').innerText(), /Invalid prompt/);
      await page.locator('.ca-generate-form textarea').first().fill('a red fox');
      await page.locator('[data-dex-field="preview-button"]').click();
      await page.locator('[data-dex-field="preview-command"]').waitFor({ state: 'visible' });
      const command = await page.locator('[data-dex-field="preview-command"]').innerText();
      assert.match(command, /mflux-controlled-generate\.sh/);
      for (const f of ['--sampler', '--clip-skip', '--tiling', '--cfg', '--scheduler', '--negative-prompt', '--vae']) assert.equal(command.includes(f), false, f);
      assert.deepEqual(errors, []);
      await page.close();
    });

    await test('Advanced sampling: eta follows the sampler, RNG is sent, unavailable options are listed, MFLUX hides it all', async () => {
      const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
      const { errors, bodies } = await openGenerate(page, srv.base);
      await chooseTarget(page, 'sdxl-base');
      await page.locator('[data-dex-field="advanced-sampling"] > summary').click();
      const eta = page.locator('[data-dex-field="eta"]');
      await eta.waitFor({ state: 'visible' });
      await page.locator('[data-dex-field="sampler"]').selectOption('heun');
      await page.waitForTimeout(300);
      assert.equal(await eta.isDisabled(), true, 'eta is disabled for a sampler it does not affect');
      assert.match(await page.locator('[data-dex-field="eta-note"]').innerText(), /no effect with the heun sampler/);
      await page.locator('[data-dex-field="sampler"]').selectOption('euler_a');
      await page.waitForTimeout(300);
      assert.equal(await page.locator('[data-dex-field="eta"]').isDisabled(), false);
      await page.locator('[data-dex-field="eta"]').fill('0.4');
      await page.locator('[data-dex-field="rng"]').selectOption('cpu');
      const sent = await generateOnce(page, bodies);
      assert.equal(sent.sampler, 'euler_a'); assert.equal(sent.eta, 0.4); assert.equal(sent.rng, 'cpu');
      // Switch to a sampler eta does not affect: the stale value is NOT sent.
      await page.locator('[data-dex-field="sampler"]').selectOption('dpmpp2m');
      const sent2 = await generateOnce(page, bodies);
      assert.equal('eta' in sent2, false, 'eta is not sent for a sampler it does not affect');
      assert.equal(sent2.rng, 'cpu');
      const text = await page.locator('[data-dex-field="unavailable-sampling"]').innerText();
      for (const w of ['variation seed', 'seed resize', 'UniPC', 'beta schedule']) assert.match(text, new RegExp(w, 'i'), w);
      await chooseTarget(page, 'flux2-klein-4b');
      await page.waitForTimeout(400);
      assert.equal(await page.locator('[data-dex-field="advanced-sampling"]').count(), 0);
      const sentK = await generateOnce(page, bodies);
      for (const k of ['eta', 'rng']) assert.equal(k in sentK, false, k);
      assert.deepEqual(errors, []);
      await page.close();
    });

    await test('server accepts eta/rng/new samplers/kl_optimal end to end (preview uses the real validator) and rejects bad combinations', async () => {
      const post = async body => {
        const r = await fetch(srv.base + '/api/preview/generation', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(Object.assign({ job_type: 'txt2img', target: 'sdxl-base', prompt: 'a fox', steps: 10 }, body)) });
        return { status: r.status, data: await r.json() };
      };
      let r = await post({ sampler: 'euler_a', eta: 0.4, rng: 'cpu', scheduler: 'kl_optimal' });
      assert.equal(r.status, 200, JSON.stringify(r.data));
      const argv = r.data.preview.argv;
      for (const [flag, val] of [['--sampler', 'euler_a'], ['--eta', '0.4'], ['--rng', 'cpu'], ['--scheduler', 'kl_optimal']]) assert.equal(argv[argv.indexOf(flag) + 1], val, flag);
      for (const s of ['ddim_trailing', 'tcd', 'res_multistep', 'res_2s', 'er_sde', 'euler_cfg_pp', 'euler_a_cfg_pp']) assert.equal((await post({ sampler: s })).status, 200, s);
      assert.match((await post({ sampler: 'heun', eta: 0.5 })).data.error, /eta has no effect with the heun/);
      assert.match((await post({ eta: 9 })).data.error, /Invalid eta/);
      assert.match((await post({ rng: 'gpu' })).data.error, /Unknown noise RNG/);
      assert.match((await post({ target: 'flux2-klein-4b', steps: 4, eta: 1 })).data.error, /no noise multiplier/);
    });

    await test('scheduler list comes from the shared choices and includes KL optimal', async () => {
      const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
      const { errors, bodies } = await openGenerate(page, srv.base);
      await chooseTarget(page, 'sdxl-base');
      const sched = page.locator('select', { has: page.locator('option[value="kl_optimal"]') }).first();
      await sched.waitFor({ state: 'visible' });
      assert.deepEqual(await sched.locator('option').evaluateAll(o => o.map(x => x.value)), ['discrete', 'karras', 'exponential', 'ays', 'sgm_uniform', 'simple', 'kl_optimal']);
      await sched.selectOption('kl_optimal');
      assert.equal((await generateOnce(page, bodies)).scheduler, 'kl_optimal');
      assert.deepEqual(errors, []);
      await page.close();
    });

    await test('controls remain usable at 390x844', async () => {
      const page = await browser.newPage({ viewport: { width: 390, height: 844 } });
      const { errors } = await openGenerate(page, srv.base);
      await chooseTarget(page, 'sdxl-base');
      await page.locator('[data-dex-field="sampler"]').waitFor({ state: 'attached' });
      await page.waitForTimeout(600);
      const box = await page.evaluate(() => { const e = document.querySelector('[data-dex-field="sampler"]'); if (!e) return null; const r = e.getBoundingClientRect(); return { x: r.x, width: r.width }; });
      assert.ok(box && box.width > 80 && box.x >= 0 && box.x + box.width <= 390 + 1, 'sampler select fits the viewport: ' + JSON.stringify(box));
      assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1), true, 'no horizontal overflow');
      assert.deepEqual(errors, []);
      await page.close();
    });
  } finally {
    await runCleanups();
  }
  process.exitCode = exitCode(results.some(r => r[0] !== 'PASS'));
})().catch(async e => { console.error(e); await runCleanups(); process.exitCode = 2; });
