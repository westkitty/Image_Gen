'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const crypto = require('node:crypto');
const { EventEmitter } = require('node:events');
const { PassThrough } = require('node:stream');
const { execFileSync } = require('node:child_process');
const { ProviderRegistry, PRESETS, normalizeResult, validatePreset, validateModelManifest, createPresetStore, createOwlv2Detector } = require('../detailer-providers');

test('provider contract returns normalized detections with provenance and rejects malformed boxes', async () => {
  const r = new ProviderRegistry();
  r.register({ id:'fixture-detector', version:'1.2', kind:'open-vocabulary', backend:'fixture', detect:async (_image, opts) => ({ detections:[{ label:opts.target, confidence:.9, box:[.1,.2,.5,.8] }] }) });
  const out = await r.detect('fixture-detector', '/local/image', { target:'silver necklace' });
  assert.equal(out.detections[0].detector_id, 'fixture-detector');
  assert.equal(out.detections[0].label, 'silver necklace');
  assert.equal(out.detections[0].instance_id, 'fixture-detector-1');
  assert.throws(() => normalizeResult({ detections:[{ box:[-1,0,1,1], confidence:.7 }] }, { id:'x' }), /normalized box/);
});

test('provider errors and cancellation stay isolated from other providers', async () => {
  const r = new ProviderRegistry();
  r.register({ id:'failed-provider', available:false, reason:'weights unavailable', detect:async () => ({ detections:[] }) });
  await assert.rejects(r.detect('failed-provider', 'image'), e => e.code === 'provider_unavailable');
  await assert.rejects(r.detect('missing-provider', 'image'), e => e.code === 'provider_unavailable');
  const stop = new AbortController(); stop.abort();
  r.register({ id:'available-one', detect:async () => ({ detections:[] }) });
  await assert.rejects(r.detect('available-one', 'image', { signal:stop.signal }), e => e.code === 'cancelled');
});

test('built-in presets explicitly disclose unavailable specialist targets and preserve independent repair expansion', () => {
  assert.equal(PRESETS.length, 10);
  const underwear = PRESETS.find(p => p.id === 'underwear-hips');
  assert.match(underwear.availability, /unverified/);
  const p = validatePreset({ ...underwear, repairExpansion:32, target:'male underwear' });
  assert.equal(p.repairExpansion, 32);
  assert.equal(p.target, 'male underwear');
  assert.throws(() => validatePreset({ ...p, confidence:2 }), /Confidence/);
});

test('model registration requires provenance, supported format, regular file, and matching SHA-256', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'dex-model-reg-'));
  try {
    const file = path.join(dir, 'weights.onnx'); fs.writeFileSync(file, 'small fixture');
    const sha256 = crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');
    const manifest = { id:'fixture-model', format:'onnx', sha256, provenance:'authorized local fixture', license:'test-only', runtime:'onnxruntime', version:'1', outputSchema:'detections-v1' };
    assert.equal(validateModelManifest(manifest, file).verified, true);
    assert.throws(() => validateModelManifest({ ...manifest, sha256:'0'.repeat(64) }, file), /does not match/);
    assert.throws(() => validateModelManifest({ ...manifest, format:'pickle' }, file), /format/);
  } finally { fs.rmSync(dir, { recursive:true, force:true }); }
});

test('preset store persists custom presets and round-trips a schema-checked export', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'dex-preset-store-'));
  try {
    const store = createPresetStore(path.join(dir, 'detailer-presets.json'));
    const saved = store.save({ id:'necklace', name:'Necklace', target:'silver necklace', detector:'open-vocabulary', confidence:.42, repairExpansion:12, prompt:'preserve the chain' });
    assert.equal(saved.target, 'silver necklace');
    const exportText = store.export('necklace');
    const other = createPresetStore(path.join(dir, 'other.json'));
    assert.equal(other.import(exportText).id, 'necklace');
    assert.equal(other.list().length, PRESETS.length + 1);
    assert.throws(() => other.import('{"schema":"unknown"}'), /schema/);
    assert.equal(other.remove('necklace'), true);
    assert.equal(other.remove('necklace'), false);
    assert.throws(() => other.remove('face'), /Built-in/);
  } finally { fs.rmSync(dir, { recursive:true, force:true }); }
});

test('OWLv2 adapter keeps target text off argv, forces offline mode, and returns the provider result', async () => {
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'dex-owl-adapter-'));
  try {
    const python=path.join(dir,'python'), script=path.join(dir,'worker.py'), model=path.join(dir,'model');
    fs.writeFileSync(python,'');fs.writeFileSync(script,'');fs.mkdirSync(model);fs.writeFileSync(path.join(model,'config.json'),'{}');fs.writeFileSync(path.join(model,'model.safetensors'),'fixture');
    let captured;
    const detect=createOwlv2Detector({python,script,model,spawnWorker:(bin,args,opts)=>{
      const child=new EventEmitter();child.stdout=new PassThrough();child.stderr=new PassThrough();child.stdin=new PassThrough();let input='';child.stdin.on('data',b=>input+=b);child.stdin.on('end',()=>{captured={bin,args,opts,input};setImmediate(()=>{child.stdout.write(JSON.stringify({status:'ok',backend:'mps',detections:[]}));child.emit('close',0);});});return child;
    }});
    const result=await detect('/local/image',{target:'visible male anatomy',threshold:.2});
    assert.deepEqual(result.detections,[]);
    assert(!captured.args.includes('visible male anatomy'));
    assert.equal(JSON.parse(captured.input).target,'visible male anatomy');
    assert.equal(captured.opts.env.HF_HUB_OFFLINE,'1');
  } finally { fs.rmSync(dir,{recursive:true,force:true}); }
});

test('OWLv2 worker selects detections by default when the selected-instance list is empty', () => {
  const worker = path.join(__dirname, '..', 'bin', 'owlv2-detect.py');
  const code = `import importlib.util,json,sys; s=importlib.util.spec_from_file_location('owl',sys.argv[1]); m=importlib.util.module_from_spec(s); s.loader.exec_module(m); ds=[{'instance_id':'owlv2-1','box_pixels':[0,0,10,10]},{'instance_id':'owlv2-2','box_pixels':[0,0,20,20]}]; print(json.dumps({'default':[d['instance_id'] for d in m.choose_detections(ds,'largest','')],'explicit':[d['instance_id'] for d in m.choose_detections(ds,'all',['owlv2-1'])]}))`;
  const selected = JSON.parse(execFileSync('python3', ['-c', code, worker], { encoding: 'utf8' }));
  assert.deepEqual(selected, { default:['owlv2-2'], explicit:['owlv2-1'] });
});
