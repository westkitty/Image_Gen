'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const crypto = require('crypto');
const { createImageStore } = require('../image-store');
const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAIAAAACCAIAAAD91JpzAAAAEklEQVR4nGMU0QhgYGBgYgADAAZ+AJD85S7OAAAAAElFTkSuQmCC', 'base64');
function fixture(t, fault, { owner = false } = {}) {
  const base = fs.mkdtempSync(path.join(os.tmpdir(), 'dex-publication-'));
  t.after(() => fs.rmSync(base, { recursive: true, force: true }));
  const run = path.join(base, 'runs', 'owned-run'); fs.mkdirSync(run, { recursive: true });
  if (owner) fs.writeFileSync(path.join(run, 'job-owner.json'), JSON.stringify({ schema: 'dexdiffusion.run_owner.v1', job_id: '11111111-1111-4111-8111-111111111111', run_id: 'owned-run' }));
  const store = createImageStore({ root: path.join(base, 'images'), runsRoot: path.join(base, 'runs'), fault });
  const src = path.join(run, 'sample.png'); fs.writeFileSync(src, PNG);
  return { base, run, store, src };
}
for (const point of ['before-transfer','after-transfer','after-validation','before-publication','after-publication','before-metadata']) {
  test('publication interruption: ' + point, t => {
    const { run, store, src } = fixture(t, p => { if (p === point) throw new Error('owned fault'); });
    assert.throws(() => store.finalizeRun(run), /owned fault/);
    assert.ok(fs.existsSync(src)); assert.deepEqual(store.readRunIndex(run), []);
    assert.deepEqual(fs.readdirSync(store.root), []);
  });
}
test('truncated/signature-only PNG cannot become canonical', t => {
  const { run, store, src } = fixture(t); fs.writeFileSync(src, PNG.subarray(0, 24));
  assert.throws(() => store.finalizeRun(run), /image-format-invalid/);
  assert.ok(fs.existsSync(src)); assert.deepEqual(fs.readdirSync(store.root), []);
});
test('real metadata rename failure rolls back new links, preserves source and old index', t => {
  const { run, store, src } = fixture(t);
  fs.mkdirSync(path.join(run, 'canonical-images.json'));
  assert.throws(() => store.finalizeRun(run));
  assert.ok(fs.existsSync(src)); assert.deepEqual(fs.readdirSync(store.root), []);
  assert.ok(fs.statSync(path.join(run, 'canonical-images.json')).isDirectory());
});
test('collision, successful digest and pending visibility do not overwrite unrelated image', t => {
  const { run, store, src } = fixture(t);
  store.ensureRoot(); const occupied = path.join(store.root, 'owned-run-sample.png'); fs.writeFileSync(occupied, 'unrelated');
  const [entry] = store.finalizeRun(run);
  assert.equal(entry.image_id, 'owned-run-sample-2.png'); assert.equal(fs.readFileSync(occupied, 'utf8'), 'unrelated');
  assert.equal(entry.sha256, crypto.createHash('sha256').update(PNG).digest('hex'));
  assert.ok(store.resolveImage(entry.image_id)); assert.ok(!fs.existsSync(src));
  const journal = path.join(store.root, '.pending-owned.json'); fs.writeFileSync(journal, JSON.stringify({ image_ids: [entry.image_id] }));
  assert.equal(store.resolveImage(entry.image_id), null); assert.equal(store.inspectIntegrity({ runsRoot: path.dirname(run) }).counts.pending, 1);
});
test('job-owned publication journal stays recoverable until its exact durable receipt is acknowledged', t => {
  const { run, store } = fixture(t, undefined, { owner: true });
  const [entry] = store.finalizeRun(run);
  const journal = fs.readdirSync(store.root).find(n => /^\.pending-.*\.json$/.test(n));
  assert.ok(journal);
  assert.equal(JSON.parse(fs.readFileSync(path.join(store.root, journal), 'utf8')).phase, 'run-index-committed');
  assert.equal(store.resolveImage(entry.image_id).id, entry.image_id, 'index-committed bytes are visible while API receipt is pending');
  assert.equal(store.acknowledgePublication('22222222-2222-4222-8222-222222222222', [entry.image_id]).acknowledged, 0);
  assert.ok(fs.existsSync(path.join(store.root, journal)), 'wrong job cannot close the publication journal');
  const acknowledged = store.acknowledgePublication('11111111-1111-4111-8111-111111111111', [entry.image_id]);
  assert.equal(acknowledged.acknowledged, 1);
  assert.equal(fs.existsSync(path.join(store.root, journal)), false);
});
test('owned transformed canonical copy preserves original on metadata failure', t => {
  const { run, store } = fixture(t); const [entry] = store.finalizeRun(run);
  const failing = createImageStore({ root: store.root, fault: p => { if (p === 'before-metadata') throw new Error('owned transform fault'); } });
  assert.throws(() => failing.replacePublishedImage(run, entry.image_id, f => fs.appendFileSync(f, 'new')), /owned transform fault/);
  assert.deepEqual(fs.readFileSync(entry.image_path), PNG); assert.equal(store.readRunIndex(run)[0].sha256, entry.sha256);
  assert.deepEqual(fs.readdirSync(store.root), [entry.image_id]);
});
test('read-only inventory identifies exactly owned missing/orphan/digest/duplicate/broken references without repair', t => {
  const { base, run, store } = fixture(t); const [entry] = store.finalizeRun(run);
  fs.writeFileSync(path.join(store.root, 'orphan.png'), PNG);
  const missing = { ...entry, image_id: 'historical-missing.png', image_path: path.join(store.root, 'historical-missing.png'), run_file: 'missing.png' };
  const index = path.join(run, 'canonical-images.json');
  fs.writeFileSync(index, JSON.stringify({ images: [entry, entry, missing, { image_id: '../escape.png' }] }));
  const before = fs.readFileSync(index); const bytes = fs.readFileSync(entry.image_path);
  let report = store.inspectIntegrity({ runsRoot: path.dirname(run) });
  assert.equal(report.counts.missing, 1); assert.equal(report.counts.orphan, 1); assert.equal(report.counts.broken, 1); assert.equal(report.counts.duplicate, 1);
  assert.equal(report.records.find(r => r.state === 'missing').image_id, 'historical-missing.png');
  assert.deepEqual(fs.readFileSync(index), before); assert.deepEqual(fs.readFileSync(entry.image_path), bytes);
  assert.ok(!fs.existsSync(missing.image_path)); assert.ok(!fs.existsSync(path.join(base, 'escape.png')));
  fs.appendFileSync(entry.image_path, 'changed'); report = store.inspectIntegrity({ runsRoot: path.dirname(run) });
  assert.equal(report.counts['digest-mismatch'], 1);
});

test('integrity treats absent paths as historical information even when dated cohorts overlap', t => {
  const { store } = fixture(t); store.ensureRoot();
  const validId = '20261004-120000-controlled-flux2-klein-4b.png';
  fs.writeFileSync(path.join(store.root, validId), PNG);
  const historicalId = '20261003-010000-controlled-flux2-klein-4b.png';
  const refs = [
    { image_id: validId, image_path: path.join(store.root, validId), run_id: '20261004-120000-controlled-flux2-klein-4b' },
    { image_id: historicalId, image_path: path.join(store.root, historicalId), run_id: '20261003-010000-controlled-flux2-klein-4b' }
  ];
  let report = store.inspectIntegrity({ references: refs });
  assert.equal(report.classification.current_problems, 0);
  assert.equal(report.classification.historical_missing_references, 1);
  assert.equal(report.records.find(r => r.image_id === historicalId).missing_classification, 'historical-missing-reference');

  const overlappingId = '20261005-010000-controlled-flux2-klein-4b.png';
  refs.push({ image_id: overlappingId, image_path: path.join(store.root, overlappingId), run_id: '20261005-010000-controlled-flux2-klein-4b' });
  report = store.inspectIntegrity({ references: refs });
  assert.equal(report.classification.current_problems, 0);
  assert.equal(report.classification.historical_missing_references, 2);
  assert.ok(report.records.filter(r => r.state === 'missing').every(r => r.missing_classification === 'historical-missing-reference'));
});

test('process death after link leaves explicit hidden pending publication, never completed metadata', t => {
  const { run, store } = fixture(t);
  const child = require('child_process').spawnSync(process.execPath, ['-e', `const {createImageStore}=require(${JSON.stringify(path.resolve(__dirname, '../image-store'))});createImageStore({root:process.argv[1],fault:p=>{if(p==='after-publication')process.exit(73)}}).finalizeRun(process.argv[2])`, store.root, run], { timeout: 30000 });
  assert.equal(child.status, 73);
  const published = fs.readdirSync(store.root).find(n => !n.startsWith('.'));
  assert.ok(published); assert.equal(store.resolveImage(published), null);
  assert.deepEqual(store.readRunIndex(run), []);
  assert.equal(store.inspectIntegrity({ runsRoot: path.dirname(run) }).counts.pending, 1);
});

test('restart reconciliation repairs only the exact job-owned publication after death between link and run index', t => {
  const { run, store, src } = fixture(t, undefined, { owner: true });
  const child = require('child_process').spawnSync(process.execPath, ['-e', `const {createImageStore}=require(${JSON.stringify(path.resolve(__dirname, '../image-store'))});createImageStore({root:process.argv[1],runsRoot:process.argv[2],fault:p=>{if(p==='after-publication')process.exit(73)}}).finalizeRun(process.argv[3])`, store.root, path.dirname(run), run], { timeout: 30000 });
  assert.equal(child.status, 73);
  assert.equal(typeof store.recoverPendingPublications, 'function');
  const recovered = store.recoverPendingPublications();
  assert.equal(recovered.repaired, 1);
  const [entry] = store.readRunIndex(run);
  assert.equal(entry.job_id, '11111111-1111-4111-8111-111111111111');
  assert.equal(entry.run_id, 'owned-run');
  assert.equal(entry.run_file, 'sample.png');
  assert.equal(store.resolveImage(entry.image_id).id, entry.image_id);
  assert.ok(fs.existsSync(src), 'recovery preserves the crash-time source until separate run cleanup');
  assert.equal(fs.readdirSync(store.root).some(n => /^\.pending-.*\.json$/.test(n)), false);
});

test('interruption after metadata commit preserves visible canonical bytes and a receipt-recovery journal', t => {
  const { run, store } = fixture(t, point => { if (point === 'after-metadata') throw new Error('post-commit interruption'); });
  assert.throws(() => store.finalizeRun(run), /post-commit interruption/);
  const [entry] = store.readRunIndex(run); assert.ok(entry);
  assert.deepEqual(fs.readFileSync(entry.image_path), PNG);
  assert.equal(store.resolveImage(entry.image_id).id, entry.image_id);
  assert.equal(store.inspectIntegrity({ runsRoot: path.dirname(run) }).counts.pending, 0);
});
test('pending identity never hides a collision belonging to another inode', t => {
  const { store } = fixture(t); store.ensureRoot();
  fs.writeFileSync(path.join(store.root, 'unrelated.png'), PNG);
  fs.writeFileSync(path.join(store.root, '.pending-race.json'), JSON.stringify({ image_ids: ['unrelated.png'], image_records: [{image_id:'unrelated.png',device:999,inode:999}] }));
  assert.ok(store.resolveImage('unrelated.png'));
});
test('direct source CLI uses the same validated publication boundary', t => {
  const { run, store, src } = fixture(t);
  const result = require('child_process').spawnSync(process.execPath, [path.resolve(__dirname, '../bin/canonicalize-image.js'), '--source', src, '--run-dir', run, '--run-file', 'source.png', '--seed', '42'], { env: { ...process.env, DEX_IMAGES_ROOT_OVERRIDE: store.root }, encoding: 'utf8', timeout: 30000 });
  assert.equal(result.status, 0, result.stderr);
  const entry = JSON.parse(result.stdout.match(/CANONICAL_RECORD: (.+)/)[1]);
  assert.equal(entry.seed, '42'); assert.equal(entry.run_file, 'source.png'); assert.ok(store.resolveImage(entry.image_id));
  assert.equal(store.readRunIndex(run)[0].sha256, entry.sha256);
});
test('successful owned transform atomically updates canonical digest and cleans its backup', t => {
  const { run, store } = fixture(t); const [original] = store.finalizeRun(run);
  const updated = store.replacePublishedImage(run, original.image_id, f => fs.appendFileSync(f, 'new'));
  assert.notEqual(updated.sha256, original.sha256);
  assert.equal(store.readRunIndex(run)[0].sha256, updated.sha256);
  assert.equal(crypto.createHash('sha256').update(fs.readFileSync(updated.image_path)).digest('hex'), updated.sha256);
  assert.equal(store.inspectIntegrity({ runsRoot: path.dirname(run) }).counts.valid, 1);
  assert.deepEqual(fs.readdirSync(store.root), [original.image_id]);
});

// Regression: inpaint/outpaint strip PNG metadata AFTER publication (replacePublishedImage). The job's pending journal kept
// the pre-strip digest/inode, so its receipt could never be acknowledged and every console restart left heavy compute BLOCKED
// ("canonical publication recovery unresolved").
const OWNER_JOB = '11111111-1111-4111-8111-111111111111';
test('an owned transform keeps the job journal truthful so the receipt can still be acknowledged', t => {
  const { run, store } = fixture(t, undefined, { owner: true });
  const [original] = store.finalizeRun(run);
  assert.equal(fs.readdirSync(store.root).filter(n => n.startsWith('.pending-')).length, 1, 'job-owned journal awaits its receipt');
  const updated = store.replacePublishedImage(run, original.image_id, f => fs.appendFileSync(f, 'new'));
  const journal = JSON.parse(fs.readFileSync(path.join(store.root, fs.readdirSync(store.root).find(n => n.startsWith('.pending-'))), 'utf8'));
  assert.equal(journal.entries[0].sha256, updated.sha256);
  assert.equal(journal.image_records[0].inode, fs.statSync(updated.image_path).ino);
  const ack = store.acknowledgePublication(OWNER_JOB, [original.image_id]);
  assert.equal(ack.acknowledged, 1, JSON.stringify(ack)); assert.deepEqual(ack.unresolved, []);
  assert.equal(fs.readdirSync(store.root).filter(n => n.startsWith('.pending-')).length, 0);
});
test('restart recovery accepts a post-publication transform that the run index vouches for, and clears the stale journal', t => {
  const { run, store } = fixture(t, undefined, { owner: true });
  const [original] = store.finalizeRun(run);
  const jpath = path.join(store.root, fs.readdirSync(store.root).find(n => n.startsWith('.pending-')));
  const stale = fs.readFileSync(jpath, 'utf8');
  const updated = store.replacePublishedImage(run, original.image_id, f => fs.appendFileSync(f, 'new'));
  fs.writeFileSync(jpath, stale);   // reproduce the pre-fix state: journal still holds the old digest and inode
  const r = store.recoverPendingPublications();
  assert.deepEqual(r.unresolved, [], JSON.stringify(r)); assert.equal(r.repaired, 1);
  assert.equal(fs.readdirSync(store.root).filter(n => n.startsWith('.pending-')).length, 0);
  assert.equal(store.readRunIndex(run)[0].sha256, updated.sha256);
});
test('recovery still refuses a journal whose file digest is NOT vouched for by the run index', t => {
  const { run, store } = fixture(t, undefined, { owner: true });
  const [original] = store.finalizeRun(run);
  fs.appendFileSync(original.image_path, 'tamper'); // file changed without any committed index update
  const r = store.recoverPendingPublications();
  assert.equal(r.unresolved.length, 1);
});
