'use strict';

const crypto = require('node:crypto');
const fs = require('node:fs');
const { spawn } = require('node:child_process');

const PRESETS = Object.freeze([
  ['face', 'Face', 'face', 'preserve identity, pose and expression; improve facial detail', 'available'],
  ['hands', 'Hands', 'hand', 'preserve hand pose; correct hand anatomy and fingers', 'available'],
  ['person', 'Person', 'person', 'preserve pose and scene composition; improve anatomy and clothing', 'available'],
  ['male-underwear', 'Male underwear', 'male underwear', 'refine underwear fabric and fit while preserving anatomy', 'unverified: open-vocabulary recognition'],
  ['underwear-hips', 'Underwear + hips', 'male underwear', 'refine underwear and adjacent hip region', 'unverified: open-vocabulary recognition'],
  ['groin', 'Groin', 'groin', 'refine the selected region while preserving anatomy and pose', 'unverified: open-vocabulary recognition'],
  ['visible-penis', 'Visible penis', 'visible penis', 'refine the selected region while preserving anatomy and pose', 'unverified: open-vocabulary recognition'],
  ['chest', 'Chest', 'chest', 'refine chest anatomy and clothing detail', 'unverified: open-vocabulary recognition'],
  ['buttocks', 'Buttocks', 'buttocks', 'refine anatomy and clothing while preserving pose', 'unverified: open-vocabulary recognition'],
  ['custom', 'Custom target', '', '', 'unverified: open-vocabulary recognition']
].map(([id, name, phrase, prompt, availability]) => Object.freeze({
  id, name, target: phrase, detector: ['face','hands','person'].includes(id) ? 'apple-vision' : 'auto',
  confidence: 0.3, mask: { padding: 0.2, feather: 8, expansion: 0 }, repairExpansion: 0,
  prompt, strength: 0.45, availability
})));

class ProviderRegistry {
  #providers = new Map();
  register(provider) {
    if (!provider || !/^[a-z][a-z0-9-]{1,63}$/.test(provider.id) || typeof provider.detect !== 'function')
      throw new TypeError('Provider requires a safe id and detect(image, options) function');
    if (this.#providers.has(provider.id)) throw new Error(`Detector provider already registered: ${provider.id}`);
    this.#providers.set(provider.id, Object.freeze({ ...provider }));
    return () => this.#providers.delete(provider.id);
  }
  get(id) { return this.#providers.get(id) || null; }
  list() { return [...this.#providers.values()].map(p => ({ id:p.id, version:p.version || 'unknown', kind:p.kind || 'specialist', available:p.available !== false, reason:p.reason || null })); }
  async detect(id, image, options = {}) {
    const provider = this.get(id);
    if (!provider || provider.available === false) throw Object.assign(new Error(provider?.reason || `Detector unavailable: ${id}`), { code:'provider_unavailable' });
    if (options.signal?.aborted) throw Object.assign(new Error('Detection cancelled'), { code:'cancelled' });
    const result = await provider.detect(image, options);
    return normalizeResult(result, { id, version:provider.version || 'unknown', backend:provider.backend || 'unknown' });
  }
}

function normalizeResult(result, provider) {
  if (!result || !Array.isArray(result.detections)) throw new TypeError('Detector returned an invalid result schema');
  const detections = result.detections.map((d, i) => {
    const box = d.box_normalized || d.box;
    if (!Array.isArray(box) || box.length !== 4 || box.some(n => !Number.isFinite(n)) || box[0] < 0 || box[1] < 0 || box[2] > 1 || box[3] > 1 || box[2] < box[0] || box[3] < box[1])
      throw new TypeError(`Detector returned an invalid normalized box at detection ${i}`);
    if (!Number.isFinite(Number(d.confidence)) || Number(d.confidence) < 0 || Number(d.confidence) > 1) throw new TypeError(`Detector returned invalid confidence at detection ${i}`);
    return { ...d, instance_id:String(d.instance_id || `${provider.id}-${i+1}`), label:String(d.label || 'target'), confidence:Number(d.confidence), box_normalized:box, box_pixels:d.box_pixels || null, mask:d.mask || null, detector_id:provider.id, detector_version:provider.version, backend:result.backend || provider.backend };
  });
  return { ...result, provider, detections };
}

function validatePreset(p) {
  if (!p || typeof p !== 'object' || Array.isArray(p)) throw new TypeError('Preset must be an object');
  const id = String(p.id || '');
  if (!/^[a-z0-9][a-z0-9-]{0,63}$/.test(id)) throw new TypeError('Preset id must use lowercase letters, digits and hyphens');
  if (typeof p.name !== 'string' || !p.name.trim() || p.name.length > 80) throw new TypeError('Preset name must be 1..80 characters');
  const target = String(p.target || '');
  if (target.length > 240) throw new TypeError('Target phrase is too long');
  const confidence = Number(p.confidence ?? 0.3), strength = Number(p.strength ?? 0.45);
  if (!Number.isFinite(confidence) || confidence < 0 || confidence > 1) throw new TypeError('Confidence must be between 0 and 1');
  if (!Number.isFinite(strength) || strength < 0.1 || strength > 0.8) throw new TypeError('Strength must be between 0.1 and 0.8');
  const mask = p.mask || {};
  for (const k of ['padding','feather','expansion']) if (mask[k] !== undefined && (!Number.isFinite(Number(mask[k])) || Math.abs(Number(mask[k])) > 256)) throw new TypeError(`Invalid mask ${k}`);
  if (p.repairExpansion !== undefined && (!Number.isFinite(Number(p.repairExpansion)) || Math.abs(Number(p.repairExpansion)) > 1024)) throw new TypeError('Invalid repair expansion');
  if (p.prompt !== undefined && (typeof p.prompt !== 'string' || p.prompt.length > 4000)) throw new TypeError('Prompt must be text up to 4000 characters');
  return { ...p, id, name:p.name.trim(), target, confidence, strength, mask:{ padding:0.2, feather:8, expansion:0, ...mask }, repairExpansion:Number(p.repairExpansion || 0), prompt:p.prompt || '' };
}

function validateModelManifest(manifest, modelPath, { sha256 } = {}) {
  if (!manifest || !['coreml','onnx','safetensors'].includes(manifest.format)) throw new TypeError('Model format must be Core ML, ONNX or SafeTensors');
  if (typeof manifest.id !== 'string' || !/^[a-z0-9][a-z0-9-]{1,63}$/.test(manifest.id)) throw new TypeError('Invalid model id');
  if (!manifest.provenance || !manifest.license || !manifest.runtime || !manifest.version || !manifest.outputSchema) throw new TypeError('Model provenance, license, runtime, version and output schema are required');
  const st = fs.lstatSync(modelPath);
  if (!st.isFile() || st.isSymbolicLink()) throw new TypeError('Model must be a regular file, not a symlink');
  let actual = sha256;
  if (!actual) {
    const hash = crypto.createHash('sha256'), fd = fs.openSync(modelPath, 'r'), chunk = Buffer.allocUnsafe(1024 * 1024);
    try { let n; while ((n = fs.readSync(fd, chunk, 0, chunk.length, null)) > 0) hash.update(chunk.subarray(0, n)); }
    finally { fs.closeSync(fd); }
    actual = hash.digest('hex');
  }
  if (!/^[a-f0-9]{64}$/i.test(manifest.sha256 || '') || actual.toLowerCase() !== manifest.sha256.toLowerCase()) throw new TypeError('Model SHA-256 does not match its manifest');
  return Object.freeze({ ...manifest, sha256:actual.toLowerCase(), path:modelPath, verified:true });
}

function createPresetStore(file) {
  function read() {
    try {
      const raw = JSON.parse(fs.readFileSync(file, 'utf8'));
      if (!Array.isArray(raw)) return [];
      return raw.map(validatePreset);
    } catch (e) { if (e.code === 'ENOENT') return []; throw new Error(`Detailer preset store is invalid: ${e.message}`); }
  }
  function write(items) {
    const dir = require('node:path').dirname(file); fs.mkdirSync(dir, { recursive:true });
    const tmp = `${file}.tmp-${process.pid}-${crypto.randomBytes(4).toString('hex')}`;
    try { fs.writeFileSync(tmp, JSON.stringify(items, null, 2), { mode:0o600, flag:'wx' }); fs.renameSync(tmp, file); }
    finally { try { fs.unlinkSync(tmp); } catch (_) {} }
  }
  return {
    list() { return [...PRESETS, ...read()]; },
    save(preset) { const p = validatePreset(preset); if (PRESETS.some(x => x.id === p.id)) throw new Error('Built-in presets cannot be overwritten'); const items = read(); const i = items.findIndex(x => x.id === p.id); if (i < 0) items.push(p); else items[i] = p; write(items); return p; },
    remove(id) { if (PRESETS.some(x => x.id === id)) throw new Error('Built-in presets cannot be deleted'); const items = read(), next = items.filter(x => x.id !== id); if (items.length === next.length) return false; write(next); return true; },
    export(id) { const p = this.list().find(x => x.id === id); if (!p) return null; return JSON.stringify({ schema:'dexdiffusion-detailer-preset-v1', preset:p }, null, 2); },
    import(text) { const b = JSON.parse(text); if (b?.schema !== 'dexdiffusion-detailer-preset-v1') throw new TypeError('Unsupported detailer preset export schema'); return this.save(b.preset); }
  };
}

function createOwlv2Detector({ python, script, model, timeoutMs = 90000, spawnWorker = spawn } = {}) {
  const available = () => !!(python && script && model && fs.existsSync(python) && fs.existsSync(script) && fs.existsSync(`${model}/config.json`) && fs.existsSync(`${model}/model.safetensors`));
  return (imagePath, options = {}) => new Promise((resolve, reject) => {
    if (!available()) return reject(Object.assign(new Error('OWLv2 local runtime or model files are unavailable.'), { code:'provider_unavailable', status:503 }));
    const args = [script,'--image',imagePath,'--model',model,'--request-stdin'];
    let child, stdout='', stderr='', settled=false, timer;
    const finish=(fn,value)=>{ if(settled)return; settled=true; clearTimeout(timer); options.signal?.removeEventListener('abort',abort); fn(value); };
    const abort=()=>{ try { child?.kill('SIGKILL'); } catch (_) {} finish(reject,Object.assign(new Error('OWLv2 detection cancelled.'),{code:'cancelled',status:499})); };
    if(options.signal?.aborted) return abort();
    try { child=spawnWorker(python,args,{stdio:['pipe','pipe','pipe'],env:{...process.env,HF_HUB_OFFLINE:'1',TRANSFORMERS_OFFLINE:'1',TOKENIZERS_PARALLELISM:'false'}}); }
    catch(e) { return finish(reject,Object.assign(new Error(`Could not start OWLv2: ${e.message}`),{code:'unavailable',status:503})); }
    options.signal?.addEventListener('abort',abort,{once:true});
    child.stdin.end(JSON.stringify({target:String(options.target||''),threshold:options.threshold??.25,padding:options.padding??.2,feather:options.feather??8,dilate:options.dilate??0,repair_expansion:options.repairExpansion??0,target_selection:options.targetSelection==='all'?'all':'largest',selected_instances:options.selectedInstances||[],manual_corrections:options.manualCorrections||[],mask_output:options.outputMask||null}));
    timer=setTimeout(()=>{ try{child.kill('SIGKILL');}catch(_){} finish(reject,Object.assign(new Error('OWLv2 detector timed out.'),{code:'timeout',status:504})); },timeoutMs);
    child.stdout.on('data',d=>{stdout+=d; if(stdout.length>2e6){try{child.kill('SIGKILL')}catch(_){}finish(reject,Object.assign(new Error('OWLv2 output exceeded limit.'),{code:'bad_output',status:500}));}});
    child.stderr.on('data',d=>{stderr=(stderr+d).slice(-16000);});
    child.on('error',e=>finish(reject,Object.assign(new Error(`Could not start OWLv2: ${e.message}`),{code:'unavailable',status:503})));
    child.on('close',code=>{
      if(settled)return;
      if(code!==0)return finish(reject,Object.assign(new Error(`OWLv2 failed: ${stderr.split('\n').filter(Boolean).slice(-2).join(' ').slice(0,600)}`),{code:'provider_failed',status:500}));
      try { finish(resolve,JSON.parse(stdout.trim())); }
      catch (_) { finish(reject,Object.assign(new Error('OWLv2 returned invalid JSON.'),{code:'bad_output',status:500})); }
    });
  });
}

module.exports = { ProviderRegistry, PRESETS, normalizeResult, validatePreset, validateModelManifest, createPresetStore, createOwlv2Detector };
