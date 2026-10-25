'use strict';
// V2 parity rows 45-47 and 53: ACE-Step and Magenta music in V2, plus the two truthful unavailable boundaries (stems/mastering, video).
// Hermetic: worker states, generation and job APIs are fixtures shaped like the real ones; no inference is started.
// A real ACE-Step/Magenta generation is a separate, deliberate runtime check (recorded in the parity ledger), not part of this gate.
const assert = require('node:assert/strict');
const { chromium } = require('playwright-core');
const { startServer, installModelSnapshots, runner, launchBrowser, runCleanups, openStudio } = require('./helpers');

const { test, results, exitCode } = runner('v2-parity-music');
const json = (route, body, status = 200) => route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(body) });
const W = (id, label, kind, over) => Object.assign({ id, media_kind: kind, label, resource_class: 'heavy', dormant: false, architecture_available: true, remote_reachable: true, runtime_available: true, model_available: true, installed: true, enabled: true, proven: true, state: 'PROVEN', runtimePath: '$HOME/x/bin/python', modelPath: '/Volumes/x/model', capabilities: { generate: true, cancel_supported: true } }, over || {});
const baseWorkers = () => [
  W('ace-step', 'ACE-Step 1.5 (Turbo + 0.6B LM)', 'music'),
  W('magenta-rt', 'Magenta RealTime 2 (small)', 'music', { capabilities: { generate: true, cancel_supported: false, cancel_reason: 'Targeted termination of the remote Big Mac generator cannot be proven yet.' } }),
  W('ltx-video', 'LTX Video', 'video', { dormant: true, runtime_available: false, model_available: false, installed: false, enabled: false, proven: false, state: 'RUNTIME MISSING', activation: 'Not installed (video is out of scope).', capabilities: { generate: false, cancel_supported: false } })];

async function open(browser, base, { workers = baseWorkers(), viewport = { width: 1348, height: 900 } } = {}) {
  const page = await browser.newPage({ viewport });
  const errors = [], posts = []; page.on('pageerror', e => errors.push(String(e)));
  await installModelSnapshots(page, base);
  await page.route('**/api/workers', r => json(r, { workers, options: { kokoro_voices: [] } }));
  await page.route('**/api/media/generate', r => { posts.push(JSON.parse(r.request().postData())); json(r, { job_id: 'job-m1', status: 'QUEUED' }); });
  await page.route('**/api/generic-jobs/job-m1', r => json(r, { job_id: 'job-m1', status: 'COMPLETE', worker_id: 'fixture', artifacts: [], artifacts_detail: [] }));
  await page.route('**/api/library**', r => json(r, { items: [], counts: { image: 0, voice: 0, music: 0, video: 0 } }));
  await openStudio(page, base + '/dexdiffusion/', { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => window.__dex && __dex.state.version === 2 && __dex.state.modelTargets?.length > 3);
  await page.evaluate(() => __dex.setScreen('music'));
  await page.getByRole('button', { name: /ACE-Step · full songs/ }).waitFor();
  await page.waitForFunction(() => __dex._mws && __dex._mws().workers);
  return { page, errors, posts };
}
const tabs = page => page.locator('[data-scroll-pane]').first();

(async () => {
  const srv = process.env.DEX_TEST_BASE ? { base: process.env.DEX_TEST_BASE, stop() {} } : await startServer();
  const browser = await launchBrowser(chromium);
  try {
    await test('row 45/46: each engine shows only the controls it honours, with its real duration limits', async () => {
      const { page, errors } = await open(browser, srv.base);
      let t = await tabs(page).innerText();
      assert.match(t, /ACE-Step 1\.5 Turbo[\s\S]*10–240 s/); assert.match(t, /lyrics/i); assert.match(t, /Instrumental \(no vocals\)/i);
      for (const f of ['Style', 'Genre', 'Mood', 'Instrumentation', 'Seed', 'Vocal language']) assert.match(t, new RegExp(f, 'i'), f);
      const dur = () => page.locator('input[type="text"][inputmode="numeric"][placeholder="30"], input[type="text"][inputmode="numeric"][placeholder="8"]').first();
      assert.deepEqual(await dur().evaluate(e => [e.min, e.max]), ['10', '240']);
      await page.getByRole('button', { name: /Magenta RT · short loops/ }).click();
      await page.waitForFunction(() => /2–60 s/.test(document.body.innerText));
      t = await tabs(page).innerText();
      assert.match(t, /No lyrics, seed or reference/i);
      // The controls Magenta ignores stay visible but explained and inert: not clickable and not reachable by keyboard.
      const gated = page.locator('[data-not-used="true"]');
      assert.equal(await gated.count(), 1); assert.match(await gated.getAttribute('title'), /Not used by Magenta RealTime 2/);
      assert.equal(await gated.evaluate(e => e.inert), true, 'inert');
      assert.equal(await gated.locator('input,textarea,select,button').evaluateAll(els => els.every(e => e.matches(':disabled') || !!e.closest('[inert]'))), true);
      assert.deepEqual(await dur().evaluate(e => [e.min, e.max]), ['2', '60']);
      assert.equal(await page.locator('[data-worker-cancel-warning="magenta-rt"]').count(), 1, 'a worker that cannot be stopped says so before you start it');
      assert.deepEqual(errors, []);
      await page.close();
    });

    await test('row 45: ACE-Step sends exactly the song request (lyrics, style fields, seed, duration), and Instrumental drops the lyrics', async () => {
      const { page, errors, posts } = await open(browser, srv.base);
      await page.getByPlaceholder('e.g. dreamy synth-pop about a night drive').fill('dreamy synth-pop');
      await page.getByPlaceholder(/\[verse\]/).fill('[verse]\nla la');
      await page.getByPlaceholder('e.g. lo-fi').fill('lo-fi'); await page.getByPlaceholder('e.g. electronic').fill('electronic');
      await page.getByPlaceholder('e.g. wistful').fill('wistful'); await page.getByPlaceholder('e.g. piano, pads, 808').fill('piano');
      await page.locator('input[type="text"][inputmode="numeric"][placeholder="random"]').fill('7');
      await page.locator('input[type="text"][inputmode="numeric"][placeholder="30"]').fill('45');
      await page.getByRole('button', { name: 'Generate', exact: true }).click();
      for (let i = 0; i < 40 && !posts.length; i++) await page.waitForTimeout(100);
      const b = posts[0];
      assert.deepEqual({ k: b.media_kind, w: b.worker, o: b.operation, p: b.prompt, l: b.lyrics, i: b.instrumental, s: b.style, g: b.genre, m: b.mood, ins: b.instruments, d: Number(b.duration), seed: Number(b.seed), sp: b.save_prompts },
        { k: 'music', w: 'ace-step', o: 'song', p: 'dreamy synth-pop', l: '[verse]\nla la', i: false, s: 'lo-fi', g: 'electronic', m: 'wistful', ins: 'piano', d: 45, seed: 7, sp: false });
      // Instrumental: no lyrics are sent even though text was typed, and the control disappears.
      await page.evaluate(() => { __dex._mws().jobs = {}; __dex.mSet({ jobs: {} }); });
      await page.getByRole('checkbox', { name: /Instrumental/ }).check();
      await page.waitForFunction(() => !document.querySelector('textarea[placeholder^="[verse]"]'));
      await page.getByRole('button', { name: 'Generate', exact: true }).click();
      for (let i = 0; i < 40 && posts.length < 2; i++) await page.waitForTimeout(100);
      assert.equal(posts[1].instrumental, true); assert.equal(posts[1].lyrics, '');
      assert.deepEqual(errors, []);
      await page.close();
    });

    await test('row 46: Magenta sends prompt and duration only (no lyrics, seed, style or reference) and the default is the documented 8 s', async () => {
      const { page, errors, posts } = await open(browser, srv.base);
      await page.getByRole('button', { name: /Magenta RT · short loops/ }).click();
      await page.getByPlaceholder('e.g. dreamy synth-pop about a night drive').fill('a calm loop');
      await page.getByRole('button', { name: 'Generate', exact: true }).click();
      for (let i = 0; i < 40 && !posts.length; i++) await page.waitForTimeout(100);
      assert.deepEqual(posts[0], { save_prompts: false, media_kind: 'music', worker: 'magenta-rt', operation: 'music', prompt: 'a calm loop', duration: 8 });
      await page.evaluate(() => { __dex._mws().jobs = {}; __dex.mSet({ jobs: {} }); });
      await page.locator('input[type="text"][inputmode="numeric"][placeholder="8"]').fill('12');
      await page.getByRole('button', { name: 'Generate', exact: true }).click();
      for (let i = 0; i < 40 && posts.length < 2; i++) await page.waitForTimeout(100);
      assert.equal(Number(posts[1].duration), 12); assert.deepEqual(Object.keys(posts[1]).sort(), ['duration', 'media_kind', 'operation', 'prompt', 'save_prompts', 'worker']);
      assert.deepEqual(errors, []);
      await page.close();
    });

    for (const [name, over, label] of [
      ['a missing runtime', { runtime_available: false, enabled: false, proven: false, state: 'RUNTIME MISSING' }, /Runtime not installed/],
      ['a missing model', { model_available: false, enabled: false, proven: false }, /Model not installed/],
      ['an unreachable Big Mac', { remote_reachable: false, enabled: false }, /Big Mac unreachable/],
      ['an inaccessible model drive', { state: 'MODEL INACCESSIBLE (wc2tb)', enabled: false }, /Model drive inaccessible/],
    ]) {
      await test(`row 45: ${name} disables Generate with the reason and sends nothing`, async () => {
        const workers = baseWorkers(); Object.assign(workers[0], over);
        const { page, errors, posts } = await open(browser, srv.base, { workers });
        const btn = page.getByRole('button', { name: /^Generate/ }).first();
        assert.match(await btn.innerText(), label); assert.equal(await btn.isDisabled(), true);
        await btn.click({ force: true }).catch(() => {}); await page.waitForTimeout(300);
        assert.deepEqual(posts, []); assert.deepEqual(errors, []);
        await page.close();
      });
    }

    await test('row 45/46: the job is followed through queued, running and complete, and the finished artifact is playable and identified', async () => {
      const { page, errors, posts } = await open(browser, srv.base);
      let n = 0;
      await page.route('**/api/generic-jobs/job-m1', r => { n++; json(r, n < 2 ? { job_id: 'job-m1', status: 'QUEUED', waiting: { blocked_reason: 'Waiting for the heavy-compute lease' } }
        : n < 3 ? { job_id: 'job-m1', status: 'RUNNING', started_at: Date.now() } : { job_id: 'job-m1', worker_id: 'ace-step', status: 'COMPLETE', artifacts: ['x-song.wav'], artifacts_detail: [{ artifact_id: 'x-song.wav', url: '/api/media/x-song.wav', duration: 31.5, seed: 7, sha256: 'a'.repeat(64) }] }); });
      await page.route('**/api/media/x-song.wav', r => r.fulfill({ contentType: 'audio/wav', body: Buffer.alloc(64) }));
      await page.getByPlaceholder('e.g. dreamy synth-pop about a night drive').fill('song');
      await page.getByRole('button', { name: 'Generate', exact: true }).click();
      await page.waitForFunction(() => /Waiting for the heavy-compute lease/.test(document.body.innerText), null, { timeout: 8000 });
      await page.waitForFunction(() => /Generating on Big Mac/.test(document.body.innerText), null, { timeout: 8000 });
      await page.waitForFunction(() => /current job[\s\S]*complete/i.test(document.body.innerText), null, { timeout: 12000 });
      const t = await tabs(page).innerText();
      assert.match(t, /x-song\.wav/); assert.match(t, /seed 7/); assert.match(t, /sha256 aaaaaaaaaaaa…/);
      assert.equal(await page.locator('audio').count() > 0, true, 'an audio player is offered for the completed artifact');
      assert.deepEqual(errors, []);
      await page.close();
    });

    await test('row 45/46: a failed job names the failed gate, and a rejected request shows the server reason (never a fake success)', async () => {
      const { page, errors } = await open(browser, srv.base);
      await page.unroute('**/api/media/generate');
      await page.route('**/api/media/generate', r => json(r, { error: 'duration must be 10-240', gate: 'validation' }, 400));
      await page.getByRole('button', { name: 'Generate', exact: true }).click();
      await page.waitForFunction(() => __dex.state.toasts.some(t => /duration must be 10-240 · validation/.test(t.msg)), null, { timeout: 8000 });
      assert.equal(await page.locator('audio').count(), 0);
      await page.unroute('**/api/media/generate');
      await page.route('**/api/media/generate', r => json(r, { job_id: 'job-bad' }));
      await page.route('**/api/generic-jobs/job-bad', r => json(r, { job_id: 'job-bad', worker_id: 'ace-step', status: 'FAILED', first_failed_gate: 'remote-exit', error: 'worker exited 1', artifacts: [] }));
      await page.getByRole('button', { name: 'Generate', exact: true }).click();
      await page.getByRole('alert').filter({ hasText: 'Failed at gate remote-exit — worker exited 1' }).waitFor({ timeout: 8000 });
      assert.equal(await page.locator('audio').count(), 0, 'no artifact is shown for a failed job');
      assert.deepEqual(errors, []);
      await page.close();
    });

    await test('row 47: V2 Music offers no stems or mastering controls (truthful boundary, no dead buttons)', async () => {
      const { page, errors } = await open(browser, srv.base);
      for (const w of ['ace-step', 'magenta-rt']) {
        await page.evaluate(x => __dex.mSet({ musicWorker: x }), w);
        const ctl = await page.evaluate(() => [...document.querySelectorAll('[data-scroll-pane] button, [data-scroll-pane] [role=tab], [data-scroll-pane] a')].map(e => (e.innerText || e.getAttribute('aria-label') || '').trim()).filter(t => /stem|master/i.test(t)));
        assert.deepEqual(ctl, [], w + ' exposes no stems/mastering control');
      }
      await page.locator('[data-studio-help]').click();
      assert.match(await page.locator('[data-v2-drawer="help"]').innerText(), /Stems or Mastering unavailable|planned/i, 'Help states the boundary');
      assert.deepEqual(errors, []);
      await page.close();
    });

    await test('row 53: the V2 Video destination states video is not implemented, shows the missing runtime, and sends nothing', async () => {
      const { page, errors, posts } = await open(browser, srv.base);
      await page.evaluate(() => __dex.setScreen('video'));
      await page.waitForFunction(() => /not implemented yet/.test(document.body.innerText));
      const t = await tabs(page).innerText();
      assert.match(t, /nothing here generates or downloads anything/); assert.match(t, /RUNTIME MISSING/);
      const btn = page.getByRole('button', { name: /^Generate/ }).first();
      assert.equal(await btn.isDisabled(), true); await btn.click({ force: true }).catch(() => {}); await page.waitForTimeout(300);
      assert.deepEqual(posts, []);
      assert.deepEqual(errors, []);
      await page.close();
    });
  } finally {
    await runCleanups();
  }
  process.exitCode = exitCode(results.some(r => r[0] !== 'PASS'));
})().catch(async e => { console.error(e); await runCleanups(); process.exitCode = 2; });
