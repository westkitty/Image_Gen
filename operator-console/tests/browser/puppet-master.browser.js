'use strict';
// Puppet Master pose editor: standalone harness served from public/ on a private port. No console server, no network.
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const http = require('http');
const { chromium } = require('playwright-core');
const { decodePng, runner, launchBrowser, onCleanup, runCleanups } = require('./helpers');

const PUBLIC = path.join(__dirname, '..', '..', 'public');
const HARNESS = path.join(__dirname, 'fixtures', 'puppet-master-harness.html');
const TYPES = { '.js': 'text/javascript', '.html': 'text/html', '.css': 'text/css' };
const { test, results, exitCode } = runner('puppet-master', { totalMs: 120000 });

function startStatic() {
  const server = http.createServer((req, res) => {
    const url = new URL(req.url, 'http://x');
    if (url.pathname === '/favicon.ico') { res.statusCode = 204; return res.end(); }
    if (url.pathname === '/harness.html') { res.setHeader('content-type', 'text/html'); return res.end(fs.readFileSync(HARNESS)); }
    const file = path.join(PUBLIC, decodeURIComponent(url.pathname));
    if (!file.startsWith(PUBLIC + path.sep) || !fs.existsSync(file) || !fs.statSync(file).isFile()) { res.statusCode = 404; return res.end('nf'); }
    res.setHeader('content-type', TYPES[path.extname(file)] || 'application/octet-stream'); res.end(fs.readFileSync(file));
  });
  return new Promise(resolve => server.listen(0, '127.0.0.1', () => {
    onCleanup(() => new Promise(r => server.close(r)));
    resolve('http://127.0.0.1:' + server.address().port);
  }));
}

async function open(browser, base) {
  const ctx = await browser.newContext({ viewport: { width: 900, height: 900 } });
  const page = await ctx.newPage();
  const errors = [], foreign = [];
  page.on('pageerror', e => errors.push('pageerror: ' + e));
  page.on('console', m => { if (m.type() === 'error') errors.push('console: ' + m.text()); });
  page.on('request', r => { const u = r.url(); if (!u.startsWith(base) && !u.startsWith('data:') && !u.startsWith('blob:')) foreign.push(u); });
  await page.goto(base + '/harness.html');
  await page.waitForSelector('[data-puppet-canvas]');
  return { page, ctx, errors, foreign };
}
const pose = page => page.evaluate(() => __pm.getPose());
const joint = (p, pi, ji) => p.people[pi].keypoints[ji];

(async () => {
  const base = await startStatic();
  const browser = await launchBrowser(chromium);
  try {
    await test('notice is visible and says no ControlNet is installed', async () => {
      const { page, ctx, errors, foreign } = await open(browser, base);
      const text = await page.locator('[data-puppet-notice]').innerText();
      assert.match(text, /Pose authoring only — no ControlNet model is installed, so poses cannot yet condition generation\./);
      assert.equal(await page.locator('iframe').count(), 0);
      assert.deepEqual(errors, []); assert.deepEqual(foreign, []);
      await ctx.close();
    });

    await test('pointer drag moves a joint; undo and redo restore it', async () => {
      const { page, ctx, errors } = await open(browser, base);
      const before = joint(await pose(page), 0, 4);                       // r_wrist
      const from = await page.evaluate(() => __pm.jointClientPoint(0, 4));
      await page.mouse.move(from.x, from.y); await page.mouse.down();
      await page.mouse.move(from.x + 40, from.y - 30, { steps: 6 }); await page.mouse.up();
      const after = joint(await pose(page), 0, 4);
      assert.ok(Math.abs(after[0] - (before[0] + 40)) < 3 && Math.abs(after[1] - (before[1] - 30)) < 3, JSON.stringify({ before, after }));
      await page.click('[data-puppet-action="undo"]');
      assert.deepEqual(joint(await pose(page), 0, 4), before);
      await page.click('[data-puppet-action="redo"]');
      assert.deepEqual(joint(await pose(page), 0, 4), after);
      assert.deepEqual(errors, []);
      await ctx.close();
    });

    await test('keyboard: Tab cycles joints, arrows move 1px, Shift+arrows 10px, V hides', async () => {
      const { page, ctx, errors } = await open(browser, base);
      await page.focus('[data-puppet-canvas]');
      assert.equal(await page.getAttribute('[data-puppet-canvas]', 'data-sel'), '0:0');
      await page.keyboard.press('Tab');
      assert.equal(await page.getAttribute('[data-puppet-canvas]', 'data-sel'), '0:1', 'Tab selects the neck');
      const n0 = joint(await pose(page), 0, 1);
      await page.keyboard.press('ArrowRight');
      const n1 = joint(await pose(page), 0, 1);
      assert.ok(Math.abs(n1[0] - n0[0] - 1) < 1e-6 && n1[1] === n0[1]);
      await page.keyboard.press('Shift+ArrowDown');
      const n2 = joint(await pose(page), 0, 1);
      assert.ok(Math.abs(n2[1] - n1[1] - 10) < 1e-6);
      await page.keyboard.press('Shift+Tab');
      assert.equal(await page.getAttribute('[data-puppet-canvas]', 'data-sel'), '0:0');
      await page.keyboard.press('v');
      assert.equal(joint(await pose(page), 0, 0), null, 'nose hidden');
      assert.match(await page.locator('[data-puppet-status]').innerText(), /nose: hidden/);
      await page.keyboard.press('v');
      assert.ok(joint(await pose(page), 0, 0));
      await page.evaluate(() => { for (let i = 0; i < 6; i++) __pm.undo(); });          // more than the history holds: must be harmless
      assert.equal(await page.locator('[data-puppet-action="undo"]').isDisabled(), true);
      assert.deepEqual(joint(await pose(page), 0, 1), n0, 'undo returns the neck to its start');
      assert.deepEqual(errors, []);
      await ctx.close();
    });

    await test('mirror, add/remove person, plan selector and non-openpose labelling', async () => {
      const { page, ctx, errors } = await open(browser, base);
      const p0 = await pose(page);
      await page.click('[data-puppet-action="mirror-all"]');
      const p1 = await pose(page);
      assert.ok(Math.abs(joint(p1, 0, 4)[0] - (512 - joint(p0, 0, 7)[0])) < 1e-6, 'r_wrist takes mirrored l_wrist');
      await page.click('[data-puppet-action="add-person"]');
      assert.equal((await pose(page)).people.length, 2);
      await page.click('[data-puppet-action="remove-person"]');
      assert.equal((await pose(page)).people.length, 1);
      await page.selectOption('[data-puppet-field="plan"]', 'quadruped');
      assert.equal((await pose(page)).plan, 'quadruped');
      assert.match(await page.locator('[data-puppet-plan-note]').innerText(), /does NOT understand it/);
      await page.click('[data-puppet-action="export-json"]');
      await page.waitForFunction(() => window.__exports.length === 1);
      const ex = await page.evaluate(() => window.__exports[0]);
      assert.equal(ex.openpose, false);
      const doc = JSON.parse(ex.jsonText);
      assert.equal(doc.format, 'dexdiffusion-pose'); assert.equal(doc.openpose_compatible, false); assert.equal(doc.plan, 'quadruped');
      assert.equal(doc.people[0].pose_keypoints_2d, undefined, 'not an OpenPose document');
      assert.deepEqual(errors, []);
      await ctx.close();
    });

    await test('exported PNG decodes at the canvas size with skeleton pixels at the neck; JSON is OpenPose', async () => {
      const { page, ctx, errors, foreign } = await open(browser, base);
      const neck = joint(await pose(page), 0, 1);
      await page.click('[data-puppet-action="export-png"]');
      await page.waitForFunction(() => window.__exports.length === 1);
      const ex = await page.evaluate(() => window.__exports[0]);
      assert.equal(ex.pngType, 'image/png'); assert.equal(ex.openpose, true);
      const img = decodePng(Buffer.from(ex.pngB64, 'base64'));
      assert.equal(img.w, 512); assert.equal(img.h, 512);
      const px = (x, y) => { const o = (Math.round(y) * img.w + Math.round(x)) * 4; return [img.data[o], img.data[o + 1], img.data[o + 2]]; };
      const n = px(neck[0], neck[1]);
      assert.ok(n[0] + n[1] + n[2] > 100, 'neck pixel is not black: ' + n);
      assert.deepEqual(px(2, 2), [0, 0, 0], 'background is black');
      assert.deepEqual(n, [255, 85, 0], 'neck joint is colour 1 of the ControlNet palette');
      const doc = JSON.parse(ex.jsonText);
      assert.equal(doc.version, 1.3); assert.equal(doc.canvas_width, 512); assert.equal(doc.canvas_height, 512);
      assert.equal(doc.people.length, 1); assert.equal(doc.people[0].pose_keypoints_2d.length, 54);
      assert.ok(Math.abs(doc.people[0].pose_keypoints_2d[3] - neck[0]) < 1e-6);
      assert.deepEqual(errors, []); assert.deepEqual(foreign, [], 'no requests outside the local origin');
      await ctx.close();
    });

    await test('reference background accepts only data:/blob: URLs and never reaches the export', async () => {
      const { page, ctx, errors, foreign } = await open(browser, base);
      assert.equal(await page.evaluate(() => __pm.setBackground('https://example.com/x.png')), false);
      assert.match(await page.locator('[data-puppet-error]').innerText(), /data: or blob:/);
      const ok = await page.evaluate(() => {
        const c = document.createElement('canvas'); c.width = c.height = 8; const g = c.getContext('2d'); g.fillStyle = '#fff'; g.fillRect(0, 0, 8, 8);
        return __pm.setBackground(c.toDataURL('image/png'));
      });
      assert.equal(ok, true);
      await page.waitForTimeout(300);
      const out = await page.evaluate(() => Array.from(document.querySelector('[data-puppet-canvas]').getContext('2d').getImageData(2, 2, 1, 1).data));
      assert.ok(out[0] > 60, 'display shows the reference');
      await page.click('[data-puppet-action="export-png"]');
      await page.waitForFunction(() => window.__exports.length === 1);
      const img = decodePng(Buffer.from(await page.evaluate(() => window.__exports[0].pngB64), 'base64'));
      assert.deepEqual(Array.from(img.data.slice(0, 3)), [0, 0, 0], 'export stays black behind the skeleton');
      assert.deepEqual(errors, []); assert.deepEqual(foreign, []);
      await ctx.close();
    });
  } finally {
    await runCleanups();
  }
  process.exitCode = exitCode(results.some(r => r[0] !== 'PASS'));
})().catch(async e => { console.error(e); await runCleanups(); process.exitCode = 2; });
