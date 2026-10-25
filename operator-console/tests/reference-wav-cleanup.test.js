'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const vm = require('node:vm');
const source = fs.readFileSync(path.join(__dirname, '../media-bridge.js'), 'utf8');
function harness(exec) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'dex-reference-cleanup-test-'));
  const start = source.indexOf('async function referenceToWav(');
  const end = source.indexOf('// ---- multi-item TTS', start);
  const convert = vm.runInNewContext(source.slice(start, end) + '\nreferenceToWav', {
    fs, path, os: {tmpdir: () => root},
    execP: async (cmd, args) => exec(args.at(-1)),
  });
  return {root, convert, close: () => fs.rmSync(root, {recursive:true,force:true})};
}

for (const scenario of ['ffmpeg-failed', 'missing-output', 'tiny-output', 'conversion-threw']) {
  test('reference conversion removes private scratch on ' + scenario, async () => {
    const h = harness(async output => {
      if (scenario !== 'missing-output') fs.writeFileSync(output, Buffer.alloc(scenario === 'tiny-output' ? 100 : 2048, 7));
      if (scenario === 'conversion-threw') throw new Error('fixture conversion failure');
      return {ok:scenario !== 'ffmpeg-failed'};
    });
    try {
      if (scenario === 'conversion-threw') await assert.rejects(h.convert({path:'/fixture/reference.wav'}), /fixture conversion failure/);
      else assert.equal(await h.convert({path:'/fixture/reference.wav'}), null);
      assert.deepEqual(fs.readdirSync(h.root), [], 'no partially converted private reference survives failure');
    } finally {h.close();}
  });
}

test('successful reference conversion transfers scratch ownership to its caller', async () => {
  const h = harness(async output => {fs.writeFileSync(output, Buffer.alloc(2048, 7)); return {ok:true};});
  try {
    const output = await h.convert({path:'/fixture/reference.wav'});
    assert.equal(fs.statSync(output).size, 2048);
    assert.equal(path.dirname(path.dirname(output)), h.root);
    assert.equal(fs.readdirSync(h.root).length, 1);
  } finally {h.close();}
});
