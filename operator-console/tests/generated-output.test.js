'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { execFileSync, spawnSync } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
test('generated frame validator rejects the observed solid-white failure and accepts image detail', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'dex-output-'));
  try {
    execFileSync('python3', ['-c', 'from PIL import Image; import sys; im=Image.new("RGB",(8,8),"white"); im.save(sys.argv[1]); im.putpixel((4,4),(120,30,10)); im.save(sys.argv[2])', path.join(dir,'white.png'), path.join(dir,'detail.png')]);
    const script = path.join(__dirname, '../bin/validate-generated-image.py');
    const rejected = spawnSync('python3', [script, path.join(dir,'white.png')], {encoding:'utf8'});
    assert.equal(rejected.status, 1); assert.match(rejected.stderr, /solid color/);
    assert.equal(spawnSync('python3', [script, path.join(dir,'detail.png')]).status, 0);
    assert.equal(spawnSync('python3', [script, path.join(dir,'absent.png')]).status, 1);
  } finally { fs.rmSync(dir, {recursive:true,force:true}); }
});
