'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');
const { spawnSync } = require('node:child_process');

const SCRIPT = path.join(__dirname, '..', '..', 'sdcpp-workflow', 'bin', 'xyz-grid.py');
const py = (code) => spawnSync('python3', ['-c', code], { encoding: 'utf8' });

test('xyz-grid.py: layout, colours land in the right tile, one PNG per Z, missing cell marked', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'xyzgrid-'));
  const mk = py(`from PIL import Image\nfor n,c in {'r':(255,0,0),'g':(0,255,0),'b':(0,0,255)}.items(): Image.new('RGB',(40,30),c).save(${JSON.stringify(dir)}+'/'+n+'.png')`);
  assert.equal(mk.status, 0, mk.stderr);
  const cells = [];
  // 2 (x) x 2 (y) x 2 (z); iz=1,iy=1,ix=1 deliberately missing
  const colour = { '0,0,0': 'r', '1,0,0': 'g', '0,1,0': 'b', '1,1,0': 'r', '0,0,1': 'g', '1,0,1': 'b', '0,1,1': 'r' };
  for (const [k, n] of Object.entries(colour)) { const [ix, iy, iz] = k.split(',').map(Number); cells.push({ path: path.join(dir, n + '.png'), ix, iy, iz }); }
  const spec = { out_dir: dir, dims: [2, 2, 2], axes: [{ label: 'Steps', values: ['10', '20'] }, { label: 'CFG scale', values: ['5', '7'] }, { label: 'Seed', values: ['1', '2'] }], cells, legend: false, margin: 4 };
  fs.writeFileSync(path.join(dir, 'spec.json'), JSON.stringify(spec));
  const r = spawnSync('python3', [SCRIPT, path.join(dir, 'spec.json')], { encoding: 'utf8' });
  assert.equal(r.status, 0, r.stderr);
  assert.deepEqual(JSON.parse(r.stdout).files, ['xyz-grid-z1.png', 'xyz-grid-z2.png']);
  const probe = py(`from PIL import Image\nim=Image.open(${JSON.stringify(path.join(dir, 'xyz-grid-z1.png'))})\nprint(im.size, im.getpixel((10,10)), im.getpixel((40+4+10,10)), im.getpixel((10,30+4+10)))\nim2=Image.open(${JSON.stringify(path.join(dir, 'xyz-grid-z2.png'))})\nprint(im2.getpixel((44+30,34+25)))`);
  assert.equal(probe.status, 0, probe.stderr);
  assert.equal(probe.stdout.trim(), '(84, 64) (255, 0, 0) (0, 255, 0) (0, 0, 255)\n(255, 255, 255)');
  fs.rmSync(dir, { recursive: true, force: true });
});

test('xyz-grid.py: legends add header row, left column and a Z title; sizes grow accordingly', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'xyzgrid-'));
  py(`from PIL import Image\nImage.new('RGB',(64,64),(9,9,9)).save(${JSON.stringify(dir)}+'/a.png')`);
  const spec = { out_dir: dir, dims: [2, 1, 1], axes: [{ label: 'Steps', values: ['10', '20'] }, null, null], cells: [0, 1].map(ix => ({ path: path.join(dir, 'a.png'), ix, iy: 0, iz: 0 })), legend: true, margin: 0 };
  fs.writeFileSync(path.join(dir, 's.json'), JSON.stringify(spec));
  assert.equal(spawnSync('python3', [SCRIPT, path.join(dir, 's.json')]).status, 0);
  const sz = py(`from PIL import Image;print(Image.open(${JSON.stringify(path.join(dir, 'xyz-grid.png'))}).size)`).stdout.trim();
  const [w, h] = sz.replace(/[()]/g, '').split(',').map(Number);
  assert.equal(w, 128); assert.ok(h > 64, 'header row added');
  fs.rmSync(dir, { recursive: true, force: true });
});
