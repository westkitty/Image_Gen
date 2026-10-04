
'use strict';
const test = require('node:test'), assert = require('node:assert/strict');
const fs = require('node:fs'), path = require('node:path'), os = require('node:os');
const { spawn } = require('node:child_process');
const { createDetector } = require('../detailer');
function seam(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'dex-detector-contract-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const image = path.join(root, 'owned.png'); fs.writeFileSync(image, 'owned input');
  let healthy = false; const workers = [];
  const detect = createDetector({ binary: '/bin/sh', attempts: 1, defaultTimeoutMs: 1000,
    spawnWorker: (_binary,args) => {
      const at=args.indexOf('--output-mask'); if(at>=0 && !healthy) fs.writeFileSync(args[at+1],'partial owned mask');
      const src = healthy ? `printf '%s\\n' '{"status":"ok","mode":"hand","detections":[],"detections_count":0}'` : `echo DEXDETAIL_STAGE=vision-begin >&2; read held;`;
      const c = spawn('/bin/sh', ['-c', src], { stdio: ['pipe','pipe','pipe'] }); workers.push(c); return c;
    } });
  return { root, image, detect, workers, healthy: () => { healthy = true; } };
}
test('safe detector stall is bounded, reaps only owned worker, produces no mask, then healthy retry succeeds', async t => {
  const s = seam(t), start = Date.now(), mask = path.join(s.root,'mask.png');
  await assert.rejects(s.detect(s.image,{mode:'hand',outputMask:mask}), e => e.code==='timeout' && e.worker_cleanup==='succeeded' && e.stage==='vision-begin');
  assert.ok(Date.now()-start < 2500); assert.equal(fs.existsSync(mask),false); assert.deepEqual(fs.readdirSync(s.root),['owned.png']);
  for(const c of s.workers) { assert.notEqual(c.signalCode,null); assert.throws(()=>process.kill(c.pid,0),/ESRCH/); }
  s.healthy(); const result = await s.detect(s.image,{mode:'hand'}); assert.equal(result.status,'ok'); assert.equal(result.attempts,1);
});
test('cancelled detector reaps its owned child and never auto-retries', async t => {
  const s = seam(t), controller = new AbortController();
  const pending = s.detect(s.image,{signal:controller.signal}); setTimeout(()=>controller.abort(),30);
  await assert.rejects(pending,e=>e.code==='cancelled' && e.worker_cleanup==='succeeded');
  assert.equal(s.workers.length,1); assert.throws(()=>process.kill(s.workers[0].pid,0),/ESRCH/);
});
test('detector unavailable and unreadable output use stable failure codes', async t => {
  const s=seam(t);
  const unavailable=createDetector({binary:process.execPath,spawnWorker:()=>{throw new Error('unavailable fixture');}});
  await assert.rejects(unavailable(s.image),e=>e.code==='unavailable');
  const bad=createDetector({binary:process.execPath,spawnWorker:()=>spawn(process.execPath,['-e',`console.log('invalid JSON')`])});
  await assert.rejects(bad(s.image),e=>e.code==='bad_output');
});
