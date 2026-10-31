'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { localMediaWorker, safeMediaTransfer, localMediaExec, localMediaScript } = require('../media-bridge');

test('Big Mac runs its own voice worker locally; MacBook preserves remote transport', () => {
  assert.equal(localMediaWorker('westcat','bigmac'), true);
  assert.equal(localMediaWorker('westcat','bigmac.local'), true);
  assert.equal(localMediaWorker('westcat','MacBook-Air'), false);
  assert.equal(localMediaWorker('other-machine','bigmac'), false);
});

test('Local worker directory, private copy, verification and strict scope', async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(),'dexmedia-test-'));
  try {
    const dir=path.join(root,'dexmedia.abcXYZ');fs.mkdirSync(dir,{mode:0o700});
    const input=path.join(root,'original.wav');fs.writeFileSync(input,'unchanged audio bytes');
    const run=localMediaExec('westcat',root);
    const check=await run('ssh',['-o','BatchMode=yes','westcat',`test -d '${dir}' && echo DEXMEDIA_DIR=${dir}`]);
    assert.equal(check.ok,true);assert.match(check.stdout,/DEXMEDIA_DIR=/);
    const up=await run('scp',['-q',input,`westcat:${dir}/ref.wav`]);assert.equal(up.ok,true);
    assert.equal(fs.readFileSync(path.join(dir,'ref.wav'),'utf8'),'unchanged audio bytes');
    assert.equal((await run('scp',['-q',input,`westcat:${dir}/ref.wav`])).ok,false,'cannot overwrite');
    const dst=path.join(root,'downloaded.wav');
    assert.equal((await run('scp',['-q',`westcat:${dir}/ref.wav`,dst])).ok,true);
    assert.equal(fs.readFileSync(dst,'utf8'),'unchanged audio bytes');
    assert.equal((await run('scp',['-q',`westcat:${root}/outside`,dst])).ok,false);
    assert.equal(safeMediaTransfer(`westcat:${dir}/../../evil`,'westcat',root),null);
    assert.equal(safeMediaTransfer(`westcat:${dir}/ref.wav`,'westcat',root),path.join(dir,'ref.wav'));
  } finally {fs.rmSync(root,{recursive:true,force:true});}
});

test('Local script streams trusted in-band markers with no shell SSH dependency', async () => {
  const chunks=[];
  const out=await localMediaScript('westcat','printf "DEXMEDIA_PASS=1\\nDEXMEDIA_DONE\\n"',2000,x=>chunks.push(x));
  assert.match(out,/DEXMEDIA_PASS=1/); assert.match(chunks.join(''),/DEXMEDIA_DONE/);
});
