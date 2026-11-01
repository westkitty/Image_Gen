'use strict';
// Byte-verified import provenance recovery in an isolated server. No model work.
const fs = require('node:fs');
const path = require('node:path');
const assert = require('node:assert/strict');
const { createHash } = require('node:crypto');
const { startServer, makePng, runCleanups, onCleanup, openStudio, launchBrowser } = require('./helpers');
(async () => {
  const srv = await startServer();
  const ownedRuns = new Set();
  const runs = path.resolve(__dirname, '../../../sdcpp-workflow/runs');
  onCleanup(() => {
    for (const id of ownedRuns) {
      if (/^20\d{6}-\d{6}-import-[a-f0-9]{10}$/.test(id)) {
        const dir = path.join(runs, id);
        if (path.dirname(dir) === runs) fs.rmSync(dir, { recursive: true, force: true });
      }
    }
  });
  const base = srv.base;
  const png = makePng(72, 54);
  const digest = bytes => createHash('sha256').update(bytes).digest('hex');
  async function importPng(name) {
    const res = await fetch(base + '/api/library/images/import?name=' + encodeURIComponent(name),
      { method: 'POST', headers: { 'content-type': 'image/png' }, body: png });
    const data = await res.json();
    assert.equal(res.status, 201, JSON.stringify(data));
    ownedRuns.add(data.runId);
    return data;
  }
  const imported = await importPng('Original Unrecoverable Name.png');
  const metaFile = path.join(srv.stateDir, 'image-meta.json');
  const store = JSON.parse(fs.readFileSync(metaFile, 'utf8'));
  delete store.images[imported.id];  // Simulate the failed metadata write; canonical bytes still exist.
  fs.writeFileSync(metaFile, JSON.stringify(store));
  const repaired = await fetch(base + '/api/library/images/' + encodeURIComponent(imported.id) +
    '/repair-provenance', { method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ original_name: 'FAKE_NAME_INJECTION.png', path: '/private/nope' }) });
  const result = await repaired.json();
  assert.equal(repaired.status, 200, JSON.stringify(result));
  assert.equal(result.metadata_status, 'partially-recovered');
  assert.equal(result.original_name_status, 'not-recoverable');
  const updated = JSON.parse(fs.readFileSync(metaFile, 'utf8')).images[imported.id];
  assert.equal(updated.operation, 'import');
  assert.equal(updated.source_kind, 'user-upload');
  assert.equal(updated.runId, imported.runId);
  assert.equal(updated.width, 72);
  assert.equal(updated.height, 54);
  assert.equal(Object.hasOwn(updated, 'original_name'), false);
  assert.doesNotMatch(JSON.stringify(updated), /FAKE_NAME_INJECTION|\/private\/nope/);
  const currentBytes = Buffer.from(await (await fetch(base + '/api/images/' + encodeURIComponent(imported.id))).arrayBuffer());
  assert.equal(digest(currentBytes), digest(png), 'provenance repair cannot modify canonical media');
  const replay = await fetch(base + '/api/library/images/' + encodeURIComponent(imported.id) +
    '/repair-provenance', { method: 'POST' });
  assert.equal((await replay.json()).metadata_status, 'recorded');
  const tampered = await importPng('tampered-case.png');
  const badStore = JSON.parse(fs.readFileSync(metaFile, 'utf8'));
  delete badStore.images[tampered.id];
  fs.writeFileSync(metaFile, JSON.stringify(badStore));
  const image = path.join(srv.stateDir, 'images', tampered.id);
  fs.writeFileSync(image, makePng(71, 54)); // valid PNG, but not original SHA
  const denied = await fetch(base + '/api/library/images/' + encodeURIComponent(tampered.id) +
    '/repair-provenance', { method: 'POST' });
  assert.equal(denied.status, 409, 'tampered canonical bytes must fail closed');
  assert.equal((await denied.json()).gate, 'import-provenance-identity');
  assert.equal(Object.hasOwn(JSON.parse(fs.readFileSync(metaFile, 'utf8')).images, tampered.id), false);
  const alien = await fetch(base + '/api/library/images/non-existent.png/repair-provenance', { method: 'POST' });
  assert.equal(alien.status, 404);
  // Exercise the actual Studio recovery button after an import's metadata write
  // was reported degraded. The browser uses an explicit canonical image ID.
  const uiImport = await importPng('Recover from Studio.png');
  const uiStore = JSON.parse(fs.readFileSync(metaFile, 'utf8'));
  delete uiStore.images[uiImport.id];
  fs.writeFileSync(metaFile, JSON.stringify(uiStore));
  const { chromium } = require('playwright-core');
  const browser = await launchBrowser(chromium);
  const page = await browser.newPage({ viewport: { width: 390, height: 844 } });
  const errors = [];
  page.on('pageerror', e => errors.push(e.message));
  await openStudio(page, base + '/dexdiffusion/', { waitUntil: 'domcontentloaded' });
  await page.evaluate(() => __dex.setScreen('3d'));
  await page.getByRole('combobox', { name: '3D source image' }).selectOption(uiImport.id);
  await page.evaluate(id => __dex.setState({ sourceImportMetadataPendingId: id }), uiImport.id);
  const button = page.locator('[data-source-repair-provenance="3d"]');
  await button.waitFor({ timeout: 10000 });
  await button.click();
  await page.waitForFunction(id => __dex.state.sourceImportMetadataPendingId === '' &&
    !__dex.state.sourceImportMetadataRepairing, uiImport.id, { timeout: 15000 });
  const uiRecorded = JSON.parse(fs.readFileSync(metaFile, 'utf8')).images[uiImport.id];
  assert.equal(uiRecorded.runId, uiImport.runId);
  assert.equal(uiRecorded.original_name, undefined);
  assert.deepEqual(errors, []);
  await page.close();
  console.log('OMNI_IMPORT_RECOVERY_PASS verifiedSha=' + digest(png));
  await runCleanups();
})().catch(async error => { console.error(error); await runCleanups(); process.exitCode = 1; });
