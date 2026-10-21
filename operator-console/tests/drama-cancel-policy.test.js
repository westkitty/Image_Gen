'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const {dramaCancelCapability,requestDramaStop}=require('../drama-cancel-policy');
const record={operation:'drama-production',worker_id:'drama-producer',media_kind:'voice',status:'RUNNING'};
const owner={jobId:'job-d1',target:'drama-production'};
test('only exactly owned drama production advertises stop-after-current',()=>{
 assert.equal(dramaCancelCapability({record:{...record,operation:'speech'},active:owner}),null);
 assert.equal(dramaCancelCapability({record:{...record,worker_id:'kokoro'},active:owner}),null);
 const unowned=dramaCancelCapability({record,active:null});
 assert.equal(unowned.cancel_supported,false);
 assert.equal(dramaCancelCapability({record,active:{...owner,target:'other'}}).cancel_supported,false);
 const cap=dramaCancelCapability({record,active:owner});
 assert.equal(cap.cancel_supported,true);
 assert.equal(cap.cancel_scope,'stop-after-current');
});
test('a producer request is accepted but never presented as process-exit proof',()=>{
 const res=requestDramaStop({cancelByJob:()=>({ok:true,status:'cancelling'})},owner);
 assert.equal(res.ok,true);
 assert.equal(res.stop_after_current,true);
 assert.equal(res.verified,false);
});
test('unknown owner, missing producer and refused request never count as accepted',()=>{
 assert.equal(requestDramaStop({cancelByJob:()=>({ok:true})},{...owner,target:'other'}).ok,false);
 assert.equal(requestDramaStop(null,owner).ok,false);
 assert.equal(requestDramaStop({cancelByJob:()=>({ok:false})},owner).ok,false);
 assert.equal(requestDramaStop({cancelByJob:()=>undefined},owner).ok,false);
});
test('server binds this policy to the producer and to exact registration',()=>{
 const s=fs.readFileSync(path.join(__dirname,'../server.js'),'utf8');
 assert.match(s,/dramaCancelCapability\(\{\s*record,\s*active\s*\}\)/);
 assert.match(s,/requestDramaStop\(voiceModule\.producer,\s*active\)/);
 assert.match(s,/onJobStart:\s*id\s*=>\s*cancelManager\.registerActiveJob\(id,\s*\{\s*target:\s*'drama-production'\s*\}\)/);
});
