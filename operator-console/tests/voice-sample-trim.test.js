'use strict';
const test=require('node:test');const assert=require('node:assert/strict');const fs=require('node:fs');const os=require('node:os');const path=require('node:path');
const A=require('../voice-audio');const {createProfileStore}=require('../voice-profiles');
const {spawnSync}=require('node:child_process');
function fixture(seconds=45){const sampleRate=24000,ch=new Float32Array(seconds*sampleRate);for(let i=0;i<ch.length;i++)ch[i]=Math.sin(2*Math.PI*(i<15*sampleRate?220:i<30*sampleRate?300:440)*i/sampleRate)*0.13;return A.encodeWav({sampleRate,channels:[ch]});}
function ffmpegIngest(source,sel){const root=fs.mkdtempSync(path.join(os.tmpdir(),'dex-trim-ffmpeg-'));const dest=path.join(root,'selected.wav');try{const args=['-v','error','-y','-i',source,...(sel?['-ss',String(sel.start),'-t',String(sel.end-sel.start)]:[]),'-ac','1','-ar','24000','-c:a','pcm_s16le',dest];const cmd=spawnSync('ffmpeg',args,{encoding:'utf8',timeout:30000});assert.equal(cmd.status,0,cmd.stderr);return fs.readFileSync(dest);}finally{fs.rmSync(root,{recursive:true,force:true});}}

test('A selected segment of a 45-second upload saves as a fresh 22-second voice sample; source remains untouched',async()=>{
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'dex-voice-trim-')),source=path.join(root,'original.wav');
 try{
  const original=fixture();fs.writeFileSync(source,original);
  const s=createProfileStore({root:path.join(root,'profiles'),ingest:ffmpegIngest});
  const id=s.create({name:'Synthetic test voice',type:'cloned'}).id;
  const added=await s.addSample(id,{srcPath:source,name:'selected',transcript:'These are the words in the selected excerpt.',trimStartSec:16,trimEndSec:38});
  assert.ok(Math.abs(added.sample.diagnostics.duration-22)<0.05,JSON.stringify(added.sample.diagnostics));
  assert.deepEqual(added.sample.trim,{start_sec:16,end_sec:38});
  assert.deepEqual(fs.readFileSync(source),original,'the uploaded source was never modified');
  assert.notDeepEqual(fs.readFileSync(s.samplePath(id,added.sample.id)),original,'the saved WAV is the cut, not the full source');
  const rec=A.parseWav(fs.readFileSync(s.samplePath(id,added.sample.id)));
  assert.ok(Math.abs(A.duration(rec)-22)<0.05);assert.equal(rec.sampleRate,24000);assert.equal(rec.channels.length,1);
 }finally{fs.rmSync(root,{recursive:true,force:true});}
});

test('Server rejects invalid, non-finite, and over-30-second selections before making a durable sample',async()=>{
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'dex-voice-invalid-')),source=path.join(root,'original.wav');
 try{
  fs.writeFileSync(source,fixture());const s=createProfileStore({root:path.join(root,'profiles'),ingest:ffmpegIngest});const id=s.create({name:'Validation',type:'cloned'}).id;
  for(const [start,end] of [[0,31],[3,3],[8,7],[-1,2],[1,NaN],[0,0.3],[0,'invalid']])await assert.rejects(s.addSample(id,{srcPath:source,trimStartSec:start,trimEndSec:end}),e=>e.status===400&&e.gate==='reference-invalid');
  assert.equal(s.get(id).samples.length,0);assert.ok(fs.existsSync(source));
 }finally{fs.rmSync(root,{recursive:true,force:true});}
});
