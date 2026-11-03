'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const { createPublicationOutbox } = require('../publication-outbox');
const CLI = path.join(__dirname, '../bin/canonicalize-image.js');
const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAIAAAACCAIAAAD91JpzAAAAEklEQVR4nGMU0QhgYGBgYgADAAZ+AJD85S7OAAAAAElFTkSuQmCC', 'base64');

function fixture(t, dataRoot) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'dex-cli-outbox-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const runs = path.join(root, 'runs');
  const run = path.join(runs, 'owned-run');
  const images = path.join(root, 'images');
  const state = path.join(root, 'state');
  fs.mkdirSync(run, { recursive: true });
  fs.writeFileSync(path.join(run, 'job-owner.json'), JSON.stringify({
    schema: 'dexdiffusion.run_owner.v1',
    job_id: '22222222-2222-4222-8222-222222222222',
    run_id: 'owned-run'
  }));
  fs.writeFileSync(path.join(run, 'sample.png'), PNG);
  const env = { ...process.env, DEX_DATA_ROOT: dataRoot ? root : '',
    DEX_DATA_ROOT_MOUNT: '', DEX_IMAGES_ROOT_OVERRIDE: images,
    DEX_RUNS_DIR: runs, DEX_STATE_DIR: state };
  return { root, run, images, state, env };
}

test('Big Mac worker CLI durably records MacBook-pull intent with canonical bytes', t => {
  const f = fixture(t, true);
  const r = spawnSync(process.execPath, [CLI, f.run], { env: f.env, encoding: 'utf8', timeout: 10000 });
  assert.equal(r.status, 0, r.stderr);
  const index = JSON.parse(fs.readFileSync(path.join(f.run, 'canonical-images.json'), 'utf8'));
  assert.equal(index.images.length, 1);
  const image = index.images[0];
  assert.deepEqual(image.publication, { state: 'PUBLICATION_PENDING', protocol: 'macbook-pull-v1' });
  const outbox = createPublicationOutbox(path.join(f.state, 'publications')).all();
  assert.equal(outbox.length, 1);
  assert.equal(outbox[0].state, 'PUBLICATION_PENDING');
  assert.equal(outbox[0].image_id, image.image_id);
  assert.equal(outbox[0].sha256, image.sha256);
  assert.deepEqual(fs.readFileSync(path.join(f.images, image.image_id)), PNG);
  const again = spawnSync(process.execPath, [CLI, f.run], { env: f.env, encoding: 'utf8', timeout: 10000 });
  assert.equal(again.status, 0, again.stderr);
  assert.equal(createPublicationOutbox(path.join(f.state, 'publications')).all().length, 1);
});

test('legacy direct CLI with no external data root retains local-only publication', t => {
  const f = fixture(t, false);
  const r = spawnSync(process.execPath, [CLI, f.run], { env: f.env, encoding: 'utf8', timeout: 10000 });
  assert.equal(r.status, 0, r.stderr);
  const index = JSON.parse(fs.readFileSync(path.join(f.run, 'canonical-images.json'), 'utf8'));
  assert.equal(index.images.length, 1);
  assert.equal(index.images[0].publication, undefined);
  assert.equal(fs.existsSync(path.join(f.state, 'publications')), false);
});
