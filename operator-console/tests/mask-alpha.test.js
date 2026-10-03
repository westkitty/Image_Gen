
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const vm = require('node:vm');
const { spawnSync } = require('node:child_process');

test('rejected staged edit source is removed while successful job source stays owned by the job', () => {
  const source = fs.readFileSync(path.join(__dirname, '..', 'server.js'), 'utf8');
  const helper = source.slice(source.indexOf('function cleanupRejectedSource('), source.indexOf('function resolveImageSource('));
  const removed = [];
  const clean = vm.runInNewContext(helper + '; cleanupRejectedSource', { fs: { unlinkSync: file => removed.push(file) } });
  for (const statusCode of [400, 409, 500, 200]) {
    let finish;
    clean({ statusCode, once: (event, fn) => { assert.equal(event, 'finish'); finish = fn; } }, { temp: 'owned-' + statusCode });
    assert.equal(removed.includes('owned-' + statusCode), false);
    finish();
  }
  assert.deepEqual(removed, ['owned-400', 'owned-409', 'owned-500']);
  clean({ once: () => assert.fail('canonical source must not acquire cleanup') }, { path: 'canonical.png' });
});

test('actual inpaint conversion preserves alpha falloff, detects coverage and rejects blank masks', () => {
  const source = fs.readFileSync(path.join(__dirname, '..', 'server.js'), 'utf8');
  const block = source.slice(source.indexOf('  const MASK_PY = ['));
  const array = block.slice(block.indexOf('['), block.indexOf("].join('\\n');") + 1);
  const script = vm.runInNewContext(array).join('\n');
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'dex-mask-alpha-'));
  try {
    const raw = path.join(dir, 'raw.png'), out = path.join(dir, 'mask.png');
    const fixture = spawnSync('python3', ['-c', 'from PIL import Image; import sys; im=Image.new("RGBA",(5,1)); im.putdata([(255,255,255,a) for a in [0,1,64,128,255]]); im.save(sys.argv[1])', raw], { encoding: 'utf8' });
    assert.equal(fixture.status, 0, fixture.stderr);
    const converted = spawnSync('python3', ['-c', script, raw, out], { encoding: 'utf8' });
    assert.equal(converted.status, 0, converted.stderr);
    assert.match(converted.stdout, /ok 0\.80000 5 1/);
    const inspect = spawnSync('python3', ['-c', 'from PIL import Image; import sys,json; im=Image.open(sys.argv[1]); print(json.dumps([im.mode,list(im.getdata())]))', out], { encoding: 'utf8' });
    assert.deepEqual(JSON.parse(inspect.stdout), ['L', [0,1,64,128,255]]);
    spawnSync('python3', ['-c', 'from PIL import Image; import sys; Image.new("RGBA",(5,1),(255,255,255,0)).save(sys.argv[1])', raw]);
    const blank = spawnSync('python3', ['-c', script, raw, out], { encoding: 'utf8' });
    assert.equal(blank.status, 0, blank.stderr); assert.equal(blank.stdout.trim(), 'blank');
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});
