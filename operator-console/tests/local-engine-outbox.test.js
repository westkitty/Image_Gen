'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const crypto = require('node:crypto');
const { createJobImageStore } = require('../bin/local-engine-generate');
const { createPublicationOutbox } = require('../publication-outbox');
const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAIAAAACCAIAAAD91JpzAAAAEklEQVR4nGMU0QhgYGBgYgADAAZ+AJD85S7OAAAAAElFTkSuQmCC', 'base64');

function publish(t, host) {
  const base = fs.mkdtempSync(path.join(os.tmpdir(),'dex-local-outbox-'));
  t.after(() => fs.rmSync(base,{recursive:true,force:true}));
  const run = path.join(base,'runs','owned-run');
  fs.mkdirSync(run,{recursive:true});
  fs.writeFileSync(path.join(run,'job-owner.json'),JSON.stringify({
    schema:'dexdiffusion.run_owner.v1',
    run_id:'owned-run',
    job_id:'33333333-3333-4333-8333-333333333333'
  }));
  const src=path.join(run,'sample.png'); fs.writeFileSync(src,PNG);
  const env={ ...process.env, DEX_DATA_ROOT:base, DEX_RUNS_DIR:path.join(base,'runs'),
    DEX_STATE_DIR:path.join(base,'state'), DEX_IMAGES_ROOT_OVERRIDE:path.join(base,'images'), DEX_DATA_ROOT_MOUNT:'' };
  const store=createJobImageStore(env,host);
  const [entry]=store.finalizeRun(run);
  const outbox=createPublicationOutbox(path.join(base,'state','publications')).all();
  return { entry, outbox, store, base };
}

test('Big Mac direct engine publication registers a verified durable outbox record',t => {
  const {entry,outbox,store} = publish(t,'bigmac');
  assert.deepEqual(entry.publication,{state:'PUBLICATION_PENDING',protocol:'macbook-pull-v1'});
  assert.equal(outbox.length,1);
  assert.equal(outbox[0].state,'PUBLICATION_PENDING');
  assert.equal(outbox[0].image_id,entry.image_id);
  assert.equal(outbox[0].expected_bytes,PNG.length);
  assert.equal(outbox[0].sha256,crypto.createHash('sha256').update(PNG).digest('hex'));
  assert.ok(store.resolveImage(entry.image_id));
});

test('non-Big Mac local publication never silently creates a cross-host record',t => {
  const {entry,outbox}=publish(t,'MacBook-Air.local');
  assert.equal(entry.publication,undefined);
  assert.equal(outbox.length,0);
});
