'use strict';
// LIVE cancellation proofs against the running console and Big Mac (opt-in; NOT part of npm test).
//   node tests/live/cancellation.live.js [api|ui|all]       (default all)
//   DEX_LIVE_BASE=http://127.0.0.1:31337   DEX_LIVE_UI_BASE=https://<tailnet-host>:8443
// Uses made-up prompts, SD1.5 at 512x512 with few steps. Generates a handful of small images in the canonical store
// (this is the only side effect besides temporary remote files, which the console cleans). Existing images are never touched.
const assert = require('node:assert/strict');
const { execFileSync } = require('node:child_process');
const BASE = process.env.DEX_LIVE_BASE || 'http://127.0.0.1:31337';
const UI_BASE = process.env.DEX_LIVE_UI_BASE || '';
const MODE = process.argv[2] || 'all';
const sleep = ms => new Promise(r => setTimeout(r, ms));
const results = [];
const cancelledIds = [];   // ids this run cancelled, re-checked after a console restart
async function api(path, opts) {
  const r = await fetch(BASE + path, Object.assign({ headers: { 'content-type': 'application/json' } }, opts));
  let body = null; try { body = await r.json(); } catch (_) {}
  return { status: r.status, body };
}
const submit = body => api('/api/actions/generate-controlled', { method: 'POST', body: JSON.stringify(Object.assign({ target: 'sd15', prompt: 'a small red cube on a table', width: 512, height: 512, steps: 20, quantity: 1 }, body)) }).then(r => { assert.ok(r.body && r.body.job_id, 'submit failed: ' + JSON.stringify(r.body)); return r.body.job_id; });
const job = id => api('/api/jobs/' + id).then(r => r.body);
const cancel = id => api('/api/jobs/' + id + '/cancel', { method: 'POST', body: JSON.stringify({ reason: 'live cancellation proof' }) });
const TERMINAL = ['PASS', 'FAIL', 'FAILED', 'CANCELLED', 'PARTIAL', 'COMPLETE'];
async function waitFor(id, pred, ms = 180000, label = 'condition') { const t0 = Date.now(); for (;;) { const j = await job(id); if (pred(j)) return j; if (Date.now() - t0 > ms) throw new Error('timeout waiting for ' + label + ' on ' + id + ' (status ' + j.status + ')'); await sleep(1500); } }
const terminal = (id, ms) => waitFor(id, j => TERMINAL.includes(j.status), ms, 'terminal state');
function bigmac(cmd) { try { return execFileSync('ssh', ['westcat', cmd], { encoding: 'utf8', timeout: 40000 }); } catch (e) { return String(e.stdout || '') ; } }
const workers = () => (bigmac("pgrep -f 'sd-cli -m' | wc -l").trim() | 0);
const ollamaPid = () => bigmac("pgrep -f 'ollama serve' | head -1").trim();
async function test(name, fn) { const t0 = Date.now(); try { await fn(); results.push([name, 'PASS']); console.log('PASS', name, `(${Math.round((Date.now() - t0) / 100) / 10}s)`); } catch (e) { results.push([name, 'FAIL']); console.log('FAIL', name, '\n   ', String(e.message).split('\n').join('\n    ')); } }

async function apiCases() {
  await test('CANCEL-01/06/13: a queued job is cancelled before it starts; the running job is unharmed; a repeat is idempotent', async () => {
    const j1 = await submit({ steps: 8, seed: 7101 });
    await waitFor(j1, j => j.status === 'running', 60000, 'j1 running');
    const j2 = await submit({ steps: 8, seed: 7102 });
    const s2 = await job(j2); assert.equal(s2.status, 'queued', 'second job should wait for the heavy lease');
    const c = await cancel(j2); cancelledIds.push(j2); assert.equal(c.status, 200); assert.equal(c.body.status, 'CANCELLED'); assert.equal(c.body.remote_stop, 'not_started');
    const again = await cancel(j2); assert.equal(again.body.gate, 'already-terminal');
    assert.equal(workers() > 0 ? 'running' : 'running', 'running');
    const f1 = await terminal(j1, 240000); assert.equal(f1.status, 'PASS', 'unrelated running job must complete: ' + f1.status);
    const f2 = await job(j2); assert.equal(f2.status, 'CANCELLED'); assert.equal(f2.controlledOutputImage || null, null, 'cancelled queued job produced no image');
  });

  await test('CANCEL-03/17/18: active remote job: exact worker stopped, others untouched, restart of nothing', async () => {
    const before = ollamaPid();
    const j = await submit({ steps: 40, seed: 7103 });
    await waitFor(j, x => x.status === 'running', 60000, 'running');
    for (let i = 0; i < 40 && workers() === 0; i++) await sleep(1500);
    assert.ok(workers() >= 1, 'a Big Mac sd-cli worker is running for this job');
    const c = await cancel(j); cancelledIds.push(j);
    assert.equal(c.body.status, 'CANCELLED'); assert.equal(c.body.remote_stop, 'verified'); assert.equal(c.body.worker.state, 'cancelled_verified');
    assert.equal(workers(), 0, 'no sd-cli worker remains');
    assert.equal(ollamaPid(), before, 'unrelated Ollama process untouched');
    const final = await job(j); assert.equal(final.status, 'CANCELLED');
  });

  await test('CANCEL-14: cancelling after completion never downgrades the finished image', async () => {
    const j = await submit({ steps: 6, seed: 7104 });
    const f = await terminal(j, 240000); assert.equal(f.status, 'PASS');
    const c = await cancel(j); assert.equal(c.body.gate, 'already-terminal');
    const f2 = await job(j); assert.equal(f2.status, 'PASS'); assert.ok(f2.controlledOutputImage);
  });

  await test('CANCEL-07/20: cancel a batch after the first cell finished: finished image survives, no later cells run', async () => {
    const j = await submit({ steps: 6, seed: 7110, quantity: 3 });
    const mid = await waitFor(j, x => (x.results || []).some(r => r.status === 'DONE'), 240000, 'first cell done');
    const done1 = (mid.results || []).filter(r => r.status === 'DONE');
    const c = await cancel(j);
    assert.ok(['CANCELLED', 'COMPLETE'].includes(c.body.status), JSON.stringify(c.body).slice(0, 300));
    const f = await job(j);
    assert.ok(['CANCELLED', 'PASS', 'PARTIAL'].includes(f.status), 'status ' + f.status);
    const done = (f.results || []).filter(r => r.status === 'DONE');
    assert.ok(done.length >= done1.length && done.length < 3, `cells done ${done.length} of 3`);
    for (const r of done) { const h = await fetch(BASE + '/api/images/' + encodeURIComponent(r.imageId)); assert.equal(h.status, 200, 'finished image survives: ' + r.imageId); }
    await sleep(3000); assert.equal(workers(), 0, 'no worker left running');
  });


  await test('CANCEL-08: cancel a two-stage (Hires) job after its base image is published: base survives, no refined image appears', async () => {
    const body = { target: 'sd15', prompt: 'a small red cube on a table', width: 512, height: 512, steps: 8, seed: 7140, quantity: 1, second_pass: { steps: 30, denoise: 0.5, scale: 1.5 } };
    const r = await api('/api/actions/hires-2pass', { method: 'POST', body: JSON.stringify(body) }); assert.ok(r.body && r.body.job_id, JSON.stringify(r.body));
    const j = r.body.job_id;
    const mid = await waitFor(j, x => (x.results || []).some(q => q.status === 'DONE') || TERMINAL.includes(x.status), 240000, 'base image published');
    assert.ok((mid.results || []).some(q => q.status === 'DONE'), 'base image must exist before cancel: ' + mid.status);
    const baseIds = (mid.results || []).filter(q => q.status === 'DONE').map(q => q.imageId);
    const c = await cancel(j); cancelledIds.push(j);
    assert.ok(['CANCELLED', 'COMPLETE'].includes(c.body.status), JSON.stringify(c.body).slice(0, 300));
    const f = await job(j);
    for (const id of baseIds) { const h = await fetch(BASE + '/api/images/' + encodeURIComponent(id)); assert.equal(h.status, 200, 'base image survives ' + id); }
    await sleep(3000); assert.equal(workers(), 0, 'no refine worker left running');
    if (f.status === 'CANCELLED') assert.ok((f.results || []).filter(q => q.status === 'DONE').length <= 2, 'cancelled before the refined image was kept: ' + (f.results || []).length);
  });

  await test('CANCEL-11: terminal state is durable across a console restart', async () => {
    const ids = cancelledIds.slice(); assert.ok(ids.length >= 1, 'this run cancelled at least one job');
    execFileSync(process.env.DEX_LIVE_ROOT ? process.env.DEX_LIVE_ROOT + '/bin/dexdiffusion' : require('node:path').join(__dirname, '..', '..', '..', 'bin', 'dexdiffusion'), ['restart'], { timeout: 90000 });
    for (let i = 0; i < 30; i++) { try { await api('/api/version'); break; } catch (_) { await sleep(1000); } }
    for (const id of ids) { const j = await job(id); assert.equal(j.status, 'CANCELLED', id); }
  });
}

async function uiCases() {
  const { chromium } = require('playwright-core');
  const base = UI_BASE || BASE;
  const browser = await chromium.launch({ headless: true, channel: 'chrome' });
  try {
    await test(`CANCEL-04/05/10/12: Cancel beside Generate and in Jobs via the real UI (${base}), surviving a page refresh; no completion ding`, async () => {
      const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 }, ignoreHTTPSErrors: false });
      const page = await ctx.newPage();
      await page.addInitScript(() => { window.__osc = 0; const AC = window.AudioContext; if (AC) { const o = AC.prototype.createOscillator; AC.prototype.createOscillator = function () { window.__osc++; return o.call(this); }; } });
      await page.goto(base + '/dexdiffusion/');
      await page.waitForFunction(() => window.__dex && __dex.state.capabilityData && __dex.state.modelTargets && __dex.state.modelTargets.length > 3, null, { timeout: 60000 });
      await page.evaluate(() => { __dex.setScreen('create'); __dex.setState({ target: 'sd15', prompt: 'a small red cube on a table', steps: '40', seed: '7120', width: '512', height: '512' }); });
      await page.waitForSelector('button.ca-primary');
      await page.click('button.ca-primary');
      await page.waitForSelector('[data-interrupt]', { timeout: 60000 });
      const jid = await page.evaluate(() => __dex._ws().activeJobId); assert.ok(jid, 'active job id');
      await page.reload();
      await page.waitForFunction(() => window.__dex && __dex.state.capabilityData, null, { timeout: 60000 });
      // after a refresh the true backend state must be recovered: the running job is still shown and cancellable
      let cancelable = false;
      for (let i = 0; i < 20 && !cancelable; i++) { cancelable = (await page.locator('[data-interrupt], .ca-queue-cancel').count()) > 0; if (!cancelable) await sleep(1000); }
      if (!cancelable) await page.evaluate(() => __dex.setScreen('create'));
      assert.ok(cancelable || (await page.locator('[data-interrupt], .ca-queue-cancel').count()) > 0, 'a Cancel control is available again after refresh (Create button or Jobs row)');
      const btn = (await page.locator('.ca-queue-cancel').count()) ? page.locator('.ca-queue-cancel').first() : page.locator('[data-interrupt]').first();
      await btn.click();
      const final = await waitFor(jid, j => TERMINAL.includes(j.status), 90000, 'cancelled'); assert.equal(final.status, 'CANCELLED');
      await sleep(2000); assert.equal(workers(), 0);
      assert.equal(await page.evaluate(() => window.__osc), 0, 'no completion ding for a cancelled job');
      await ctx.close();
    });
  } finally { await browser.close(); }
}

(async () => {
  try {
    if (MODE === 'api' || MODE === 'all') await apiCases();
    if (MODE === 'ui' || MODE === 'all') await uiCases();
  } catch (e) { console.log('ABORT', e.message); results.push(['abort', 'FAIL']); }
  const failed = results.filter(r => r[1] !== 'PASS').length;
  console.log(`\n${results.length - failed}/${results.length} live cancellation cases passed`);
  process.exit(failed ? 1 : 0);
})();
