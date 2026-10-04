
'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),os=require('node:os'),crypto=require('node:crypto');
const {spawnSync}=require('node:child_process');
const M=require('../media'),B=require('../media-bridge'),A=require('../voice-audio'),D=require('../drama'),C=require('../public/dexdiffusion/client-helpers');
const rootRepo=path.resolve(__dirname,'../..');
const canary='REV19-PRIVACY-CONTRACT-946273';
const records=[];
function record(boundary,policy,expected,data){ const found=JSON.stringify(data).includes(canary);assert.equal(found,expected==='EXPECTED RETENTION',boundary+' '+policy);records.push({boundary,policy,expected,canary_found:found,status:'PASS'}); }
for(const save of [false,true]) test('privacy persistence saving '+(save?'ON':'OFF')+' distinguishes intentional retention from non-retention',async t=>{
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'dex-privacy-contract-'));t.after(()=>fs.rmSync(root,{recursive:true,force:true}));
 const jobStore=M.createJobStore(path.join(root,'jobs.json'));
 const roots={image:root+'/img',voice:root+'/voice',music:root+'/music',video:root+'/video'};
 const mediaStore=M.createMediaStore({roots,registryFile:root+'/media.json'});mediaStore.ensureRoots();
 const samples=new Float32Array(2400);for(let i=0;i<samples.length;i++)samples[i]=0.2*Math.sin(i/10);
 const bytes=A.encodeWav({sampleRate:24000,channels:[samples]});const digest=crypto.createHash('sha256').update(bytes).digest('hex');
 const remoteDir='$HOME/Library/Caches/DexDiffusion/tmp/dexmedia.PRIVACY19';
 const bridge=B.createMediaBridge({jobStore,mediaStore,arbiter:M.createResourceArbiter(),staging:M.createStaging({root:root+'/staging'}),evidenceFile:root+'/evidence.json',
   exec:async(_cmd,args)=>{const a=args.join(' ');if(a.includes('mktemp -d'))return {ok:true,stdout:'DEXMEDIA_DIR='+remoteDir+'\n'};if(a.includes('rm -rf'))return {ok:true,stdout:'DEXMEDIA_CLEANED\n'};if(a.includes('/out/')){fs.writeFileSync(args.at(-1),bytes);return {ok:true,stdout:''};}return {ok:true,stdout:''};},
   sshRunFn:async()=>`DEXMEDIA_OUTPUT=${remoteDir}/out/out.wav\nDEXMEDIA_SHA256=${digest}\nDEXMEDIA_DURATION=0.1\nDEXMEDIA_SAMPLE_RATE=24000\nDEXMEDIA_CHANNELS=1\nDEXMEDIA_PASS\nDEXMEDIA_DONE\n`});
 const submitted=bridge.start('kokoro',{text:canary,voice:'af_heart'},{probe:{runtime_available:true,model_available:true},saveText:save});
 let job;for(let i=0;i<200;i++){job=jobStore.get(submitted.job_id);if(M.TERMINAL?.has(job.status)||['COMPLETE','FAILED'].includes(job.status))break;await new Promise(r=>setTimeout(r,5));}
 assert.equal(job.status,'COMPLETE');jobStore.flush();
 record('durable run/job metadata',save,save?'EXPECTED RETENTION':'EXPECTED REDACTION/NON-RETENTION',fs.readFileSync(root+'/jobs.json','utf8'));
 record('durable canonical media metadata',save,'EXPECTED REDACTION/NON-RETENTION',fs.readFileSync(root+'/media.json','utf8'));
 record('settings presets',save,save?'EXPECTED RETENTION':'EXPECTED REDACTION/NON-RETENTION',C.sanitizeRecipe({name:'owned',prompt:canary,negPrompt:canary},save));
 record('browser session serializer',save,save?'EXPECTED RETENTION':'EXPECTED REDACTION/NON-RETENTION',C.persistableSession({batchText:canary,editSourceId:'owned.png'},save));
 const store=D.createDramaStore({root:root+'/projects'});const script='NARRATOR: '+canary;const parsed=D.parseScript(script);const project=store.create({title:'owned',source_script:script,parsed});
 record('unsaved project filesystem',save,'EXPECTED REDACTION/NON-RETENTION',fs.readdirSync(root+'/projects'));
 store.save(project.id);
 record('explicitly saved project (intentional independent retention)',save,'EXPECTED RETENTION',fs.readFileSync(root+'/projects/'+project.id+'.json','utf8'));
 const py=`import json,runpy,sys\nn=runpy.run_path(sys.argv[1])\ns=json.load(sys.stdin)\nprint(n['scrub']('failure '+s,{'text':s}))`;
 const remote=spawnSync('python3',['-c',py,B.DRIVER_PATH],{input:JSON.stringify(canary),encoding:'utf8'});assert.equal(remote.status,0,remote.stderr);
 fs.writeFileSync(root+'/owned-remote.log',remote.stdout);record('owned remote worker log fixture (actual scrub function)',save,'EXPECTED REDACTION/NON-RETENTION',remote.stdout);
 const redactor=spawnSync('python3',[rootRepo+'/sdcpp-workflow/bin/redact_stream.py',canary],{input:'prompt: "'+canary+'"\nstep 1/2\n',encoding:'utf8'});assert.equal(redactor.status,0,redactor.stderr);
 fs.writeFileSync(root+'/owned-local.log',redactor.stdout);record('owned local streamed log fixture (actual redactor)',save,'EXPECTED REDACTION/NON-RETENTION',redactor.stdout);
});
test('historical exposure is an explicit preserved exception, not a clean-current claim',()=>{
 const paths=JSON.parse(fs.readFileSync(rootRepo+'/output/rev18/privacy-cleanup-final-remote.json','utf8')).matches.map(x=>x.path);assert.equal(paths.length,4);
 records.push({boundary:'historical pre-repair remote logs',expected:'HISTORICAL EXCEPTION',paths,action:'none',status:'PRESERVED'});
 if(process.env.DEX_EVIDENCE_DIR){fs.mkdirSync(process.env.DEX_EVIDENCE_DIR,{recursive:true});fs.writeFileSync(path.join(process.env.DEX_EVIDENCE_DIR,'privacy-contract.json'),JSON.stringify({schema:'dexdiffusion.privacy-contract.v1',scope:'deterministic owned fixtures; remote log functions simulated without remote generation; browser storage measured separately',records},null,2)+'\n');}
});
