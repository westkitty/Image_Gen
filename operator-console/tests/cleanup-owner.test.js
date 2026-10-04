'use strict';
const test = require('node:test'), assert = require('node:assert/strict'), fs = require('node:fs'), os = require('node:os'), path = require('node:path');
const { execFileSync } = require('node:child_process');
const C = require('../cleanup-owner'), M = require('../media'), B = require('../media-bridge');
const ownedPath = '$HOME/Library/Caches/DexDiffusion/tmp/dexmedia.TEST01';
test('exact ownership rejects traversal, arbitrary roots, descendants and command injection', () => {
  for (const p of [ownedPath+'/child',ownedPath+'/../canonical',ownedPath+';rm', '/tmp/dexmedia.TEST01','/Users/andrew/images_made/x']) assert.throws(()=>C.ownedRemoteResource('job','westcat',p));
  assert.throws(()=>C.ownedRemoteResource('job','other',ownedPath));
  assert.match(C.cleanupCommand(C.ownedRemoteResource('job','westcat',ownedPath)), /\[ ! -L/);
});
test('cleanup transport failure visible; terminal exact retry preserves canonical and unrelated fixture', async () => {
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'dex-cleanup-test-')), s=M.createJobStore(path.join(dir,'jobs.json'));
  const job=s.create({media_kind:'voice',worker_id:'kokoro',operation:'speech'}), resource=s.ownResource(job.job_id,'westcat',ownedPath);
  s.transition(job.job_id,'RUNNING');
  const canonical=path.join(dir,'canonical.wav'), unrelated=path.join(dir,'unrelated'); fs.writeFileSync(canonical,'canonical');fs.writeFileSync(unrelated,'unrelated');
  const ownedFixture=path.join(dir,'Library/Caches/DexDiffusion/tmp/dexmedia.TEST01'); fs.mkdirSync(ownedFixture,{recursive:true});fs.writeFileSync(path.join(ownedFixture,'owned'),'fixture');
  let fail=true, calls=[];
  const bridge=B.createMediaBridge({jobStore:s,arbiter:M.createResourceArbiter(),mediaStore:{},staging:{},evidenceFile:path.join(dir,'ev'),exec:async(cmd,args)=>{calls.push(args.join(' '));if(fail)throw Error('transport');return {ok:false,stdout:execFileSync('/bin/bash',['-c',args[args.length-1]],{env:{...process.env,HOME:dir},encoding:'utf8'})};}});
  assert.match((await bridge.reconcileCleanup(job.job_id,resource.resource_id)).error,/terminal/);assert.equal(calls.length,0);
  s.transition(job.job_id,'FAILED',{first_failed_gate:'generation',error:'test fixture'});
  assert.equal((await bridge.reconcileCleanup(job.job_id,resource.resource_id)).ok,false);assert.equal(bridge.inspectCleanup()[0].state,'failed');assert.equal(fs.existsSync(ownedFixture),true);
  fail=false;assert.equal((await bridge.reconcileCleanup(job.job_id,resource.resource_id)).ok,true);assert.equal(bridge.inspectCleanup()[0].receipt.in_band_verified,true);assert.equal(fs.existsSync(ownedFixture),false);
  assert.equal(fs.readFileSync(canonical,'utf8'),'canonical');assert.equal(fs.readFileSync(unrelated,'utf8'),'unrelated');
  assert.equal(s.get(job.job_id).status,'FAILED');assert.equal(s.get(job.job_id).owned_resources[0].attempts,2);
  const reloaded=M.createJobStore(path.join(dir,'jobs.json'));assert.equal(reloaded.get(job.job_id).owned_resources[0].state,'succeeded');
  assert.equal((await bridge.reconcileCleanup(job.job_id,'arbitrary')).ok,false);
  assert.ok(calls.every(c=>c.includes('dexmedia.TEST01')&&!c.includes(canonical)&&!c.includes(unrelated)));
});
test('startup reconciliation touches only tracked terminal resources, not untracked directory patterns', async()=>{
  const s=M.createJobStore(null),j=s.create({media_kind:'voice',operation:'x'});s.ownResource(j.job_id,'westcat',ownedPath);let calls=0;
  const b=B.createMediaBridge({jobStore:s,exec:async()=>{calls++;return{stdout:''}},evidenceFile:'/unused'});
  assert.equal((await b.sweepRemoteOrphans()).scope,'tracked-terminal-resources');assert.equal(calls,0);
});

test('pending cleanup survives restart as unknown and unverified success is rejected',()=>{
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'dex-cleanup-restart-')),file=path.join(dir,'jobs.json'),s=M.createJobStore(file),j=s.create({media_kind:'voice',operation:'x'});
  const r=s.ownResource(j.job_id,'westcat',ownedPath);
  assert.throws(()=>s.resourceReceipt(j.job_id,r.resource_id,{state:'succeeded'}),/in-band/);
  const loaded=M.createJobStore(file);
  assert.equal(loaded.get(j.job_id).status,'INTERRUPTED');assert.equal(loaded.get(j.job_id).owned_resources[0].state,'unknown');
});
