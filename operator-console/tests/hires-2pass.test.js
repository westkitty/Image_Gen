'use strict';
// OP-4A independent second-pass Hires: validation (explicit vs inherited, unsupported refused) and the real orchestration
// against stub workers that behave like the controlled generator (publishes when top-level) and sdcpp-img2img.sh.
const test = require('node:test'), assert = require('node:assert/strict');
const fs = require('node:fs'), os = require('node:os'), path = require('node:path');
const { execFileSync } = require('node:child_process');
const H = require('../hires-2pass');

const TARGETS = {
  sd15: { id: 'sd15', backend: 'sdcpp', defaultWidth: 512, defaultHeight: 512, defaultSteps: 20, defaultCfgScale: 7, defaultSampler: 'euler_a', defaultScheduler: 'discrete' },
  'sdxl-photonic': { id: 'sdxl-photonic', backend: 'sdcpp', defaultWidth: 768, defaultHeight: 768, defaultSteps: 30, defaultCfgScale: 6, defaultSampler: 'dpmpp2m', defaultScheduler: 'karras' },
  'flux2-klein-4b': { id: 'flux2-klein-4b', backend: 'mflux', defaultWidth: 512, defaultHeight: 512, defaultSteps: 4 },
  'flux-fp8': { id: 'flux-fp8', backend: 'sdcpp' },
};
const MODELS = { sd15: '/Volumes/wc2tb/ImageGen/checkpoints/sd15/v1-5-pruned-emaonly.safetensors', 'sdxl-photonic': '$HOME/sdcpp-staging/models/photonic_fusion_sdxl_finale_v1.safetensors', 'flux-fp8': '$HOME/sdcpp-staging/models/flux1-schnell-fp8.safetensors' };
const ctx = (base, baseSpec) => ({ base, baseSpec, targets: TARGETS, targetModels: MODELS, validateSampling: (s, { sampler }) => (['euler_a', 'dpmpp2m', 'heun', 'euler'].includes(sampler) ? null : `sampler ${sampler} unsupported`), canonical: x => String(x || '').toLowerCase() });

test('explicit second-pass values are used as given; unset ones are inherited and recorded as inherited', () => {
  const base = { prompt: 'a fox', negative_prompt: 'blurry', steps: 20, cfg_scale: 7, sampler: 'euler_a', scheduler: 'discrete', width: 512, height: 512 };
  const r = H.normalizeSecondPass({ prompt: 'a detailed fox, fur', target: 'sdxl-photonic', sampler: 'heun', denoise: 0.35, scale: 2 }, ctx(base, TARGETS.sd15));
  assert.ifError(r.error);
  assert.equal(r.opts.prompt, 'a detailed fox, fur'); assert.equal(r.opts.target, 'sdxl-photonic'); assert.equal(r.opts.sampler, 'heun');
  assert.equal(r.opts.modelPath, MODELS['sdxl-photonic'], 'checkpoint path is server-resolved from the target');
  assert.equal(r.opts.denoise, 0.35); assert.deepEqual([r.opts.width, r.opts.height], [1024, 1024]);
  assert.deepEqual(r.opts.inherited.sort(), ['cfg_scale', 'negative_prompt', 'scheduler', 'seed', 'steps', 'upscaler'].sort());
  assert.equal(r.opts.negative, 'blurry'); assert.equal(r.opts.scheduler, 'discrete');
});

test('unsupported second passes are refused with the reason, never silently substituted', () => {
  const base = { prompt: 'a fox', steps: 4, width: 512, height: 512 };
  assert.match(H.normalizeSecondPass({}, ctx(base, TARGETS['flux2-klein-4b'])).error, /MFLUX.*no img2img/);
  assert.match(H.normalizeSecondPass({ target: 'flux2-klein-4b' }, ctx(base, TARGETS.sd15)).error, /no img2img denoising path/);
  assert.match(H.normalizeSecondPass({ target: 'flux-fp8' }, ctx(base, TARGETS.sd15)).error, /no proven/);
  assert.match(H.normalizeSecondPass({ target: 'sd15', sampler: 'lms' }, ctx(base, TARGETS.sd15)).error, /sampler lms unsupported/);
  assert.match(H.normalizeSecondPass({ target: 'sd15', denoise: 1 }, ctx(base, TARGETS.sd15)).error, /0\.01-0\.99/);
  assert.match(H.normalizeSecondPass({ target: 'sd15', upscaler: 'esrgan' }, ctx(base, TARGETS.sd15)).error, /pixel-space/);
  assert.match(H.normalizeSecondPass({ target: 'sd15', scale: 2, width: 1024, height: 1024 }, ctx(base, TARGETS.sd15)).error, /either/);
  assert.match(H.normalizeSecondPass({ target: 'sd15', width: 256, height: 256 }, ctx(base, TARGETS.sd15)).error, /smaller/);
  assert.match(H.normalizeSecondPass({ target: 'sd15', bogus: 1 }, ctx(base, TARGETS.sd15)).error, /Unexpected/);
  // MFLUX base with an SDCPP second pass is fine and takes the second-pass target's defaults (recorded as inherited/default)
  const ok = H.normalizeSecondPass({ target: 'sd15' }, ctx(base, TARGETS['flux2-klein-4b']));
  assert.ifError(ok.error); assert.equal(ok.opts.sampler, 'euler_a');
});

function harness({ secondPassFails = false } = {}) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'hires2-'));
  const wf = path.join(root, 'wf'), bin = path.join(wf, 'bin'), runs = path.join(wf, 'runs'), uploads = path.join(wf, 'mask-uploads'), canon = path.join(root, 'images_made');
  for (const d of [bin, runs, uploads, canon]) fs.mkdirSync(d, { recursive: true });
  const calls = path.join(root, 'calls.log');
  const mk = (name, body) => { fs.writeFileSync(path.join(bin, name), '#!/bin/bash\nset -euo pipefail\necho "' + name + ' $* DEX_TOP_PID=${DEX_TOP_PID:-none}" >> ' + JSON.stringify(calls) + '\n' + body, { mode: 0o755 }); };
  // controlled generator: top-level → publishes to the canonical dir (like pass_banner); prints CONTROLLED_OUTPUT_IMAGE.
  mk('stub-controlled.sh', `RUN=${runs}/20991231-000001-controlled-stub; mkdir -p "$RUN"; echo "SDCPP_RUN_ID: $(basename "$RUN")"
python3 -c 'import sys; from PIL import Image; Image.new("RGB",(512,512),(30,60,90)).save(sys.argv[1])' "$RUN/base.png"
if [ -z "\${DEX_TOP_PID:-}" ]; then mv "$RUN/base.png" ${canon}/base-canonical.png; echo "CONTROLLED_OUTPUT_IMAGE: ${canon}/base-canonical.png"; else echo "CONTROLLED_OUTPUT_IMAGE: $RUN/base.png"; fi
echo "runs/$(basename "$RUN")"; echo "==== PASS ===="\n`);
  mk('sdcpp-img2img.sh', secondPassFails ? 'echo "SDCPP_RUN_ID: 20991231-000002-img2img"\necho "First failed gate: remote-generate"\nexit 1\n'
    : `RUN=${runs}/20991231-000002-img2img; mkdir -p "$RUN"; echo "SDCPP_RUN_ID: $(basename "$RUN")"
INIT=""; while [ $# -gt 0 ]; do case "$1" in --init-img) INIT="$2"; shift 2;; *) shift;; esac; done
python3 -c 'import sys; from PIL import Image; Image.open(sys.argv[1]).save(sys.argv[2])' "$INIT" "$RUN/second-pass.png"
echo "loading model from '/stub/photonic_fusion_sdxl_finale_v1.safetensors'" > "$RUN/remote-stdout.log"; echo "Local PNG: $RUN/second-pass.png"; echo "==== PASS ===="\n`);
  const jobs = {}, metas = {}, index = {};
  const D = {
    WORKFLOW_ROOT: wf, RUNS_DIR: runs, MASK_UPLOADS_DIR: uploads, JOB_TIMEOUT_MS: 60000, jobs, jobSensitives: {},
    jobStore: { get: () => null, transition() {} },
    createJob: (action, summary, params) => { const id = 'hjob'; jobs[id] = { id, commandAction: action, status: 'queued', stdout: '', stderr: '', requestParams: params }; return id; },
    withLease: (id, start) => start(),
    normalizeControlledGenerationBody: b => { if ('dry_run' in b || 'second_pass' in b) throw new Error('strict normalizer: unexpected field'); return ({ target: b.target, prompt: b.prompt, negative_prompt: b.negative_prompt || '', steps: b.steps || 20, cfg_scale: 7, sampler: 'euler_a', scheduler: 'discrete', width: 512, height: 512, seed: b.seed, save_prompts: !!b.save_prompts }); },
    validateControlledGenerationParams: () => null, allControlledTargets: () => TARGETS, CONTROLLED_TARGET_BY_ID: TARGETS, TARGET_MODELS: MODELS,
    buildControlledArgs: (spec, p) => ['--target', spec.id, '--seed', String(p.seed)], controlledScriptFor: () => 'bin/stub-controlled.sh', resolveVaePath: () => null,
    canonicalForReportedPath: p => (p.startsWith(canon) ? { id: path.basename(p), path: p } : null),
    pngSize: p => { const [w, h] = execFileSync('python3', ['-c', 'import sys;from PIL import Image;print(*Image.open(sys.argv[1]).size)', p], { encoding: 'utf8' }).trim().split(' ').map(Number); return { width: w, height: h }; },
    imageMeta: { record: (id, m) => { metas[id] = m; } },
    imageStore: { imageUrl: id => '/api/images/' + id, readRunIndex: dir => index[dir] || [], resolveImage: id => (fs.existsSync(path.join(canon, id)) ? { id, path: path.join(canon, id) } : null) },
    EC: { canonicalSampler: s => s }, SDCLI_SAMPLER: { euler_a: 'euler_a', heun: 'heun', dpmpp2m: 'dpm++2m' }, canonicalSampler: s => s,
    validateSecondPassSampling: () => null, sanitizeRequestParams: p => p, redactSensitiveText: t => t, updateSequentialProgress: (j, p) => { j.progress = p; },
    finalizeJobImages: (job, out) => { for (const m of out.matchAll(/runs\/(20\d{6}-\d{6}-[a-z0-9-]+)/g)) { const dir = path.join(runs, m[1]); for (const f of fs.readdirSync(dir).filter(f => f.endsWith('.png'))) { const id = m[1] + '-' + f; fs.renameSync(path.join(dir, f), path.join(canon, id)); (index[dir] = index[dir] || []).push({ image_id: id }); } } },
    recordJobEvidence() {}, syncGenericTerminal() {}, runStamp: () => '20991231-000003',
  };
  const routes = {};
  H.mount({ post: (p, h) => { routes[p] = h; } }, D);
  const call = body => new Promise(resolve => { const res = { code: 200, status(c) { this.code = c; return this; }, json(j) { resolve({ code: this.code, body: j }); } }; routes['/api/actions/hires-2pass']({ body }, res); });
  const wait = async id => { for (let i = 0; i < 300 && !['PASS', 'FAIL', 'CANCELLED'].includes(jobs[id].status); i++) await new Promise(r => setTimeout(r, 50)); return jobs[id]; };
  return { root, canon, calls, call, wait, metas, jobs };
}

test('base and refined both survive in the canonical store, linked by parent and workflow; pass settings reach the worker', async () => {
  const h = harness();
  const r = await h.call({ target: 'sd15', prompt: 'a fox', seed: 42, save_prompts: false, second_pass: { prompt: 'a detailed fox', target: 'sdxl-photonic', sampler: 'heun', denoise: 0.4, scale: 2, upscaler: 'bicubic' } });
  assert.equal(r.code, 200, JSON.stringify(r.body));
  const job = await h.wait(r.body.job_id);
  assert.equal(job.status, 'PASS', job.stderr);
  const calls = fs.readFileSync(h.calls, 'utf8').trim().split('\n');
  assert.match(calls[0], /^stub-controlled\.sh .*DEX_TOP_PID=none$/, 'base pass runs top-level: published like any generation');
  assert.match(calls[1], /^sdcpp-img2img\.sh /);
  assert.match(calls[1], /--prompt a detailed fox/); assert.match(calls[1], /--sampler heun/); assert.match(calls[1], /--strength 0\.4/);
  assert.match(calls[1], /--width 1024 --height 1024/); assert.match(calls[1], /--model-path \$HOME\/sdcpp-staging\/models\/photonic_fusion_sdxl_finale_v1\.safetensors/);
  assert.doesNotMatch(calls[1], /DEX_TOP_PID=none/, 'second pass runs nested: published by the workflow, not by the worker');
  const files = fs.readdirSync(h.canon).sort();
  assert.deepEqual(files, ['20991231-000003-hires-2pass-hires-2pass.png', 'base-canonical.png']);
  const refinedId = files[0];
  assert.equal(h.metas[refinedId].parent, 'base-canonical.png');
  assert.equal(h.metas[refinedId].workflow_id, 'hjob'); assert.equal(h.metas['base-canonical.png'].workflow_id, 'hjob');
  assert.equal(h.metas[refinedId].target, 'sdxl-photonic'); assert.equal(h.metas[refinedId].second_pass.upscaler, 'bicubic');
  assert.equal(h.metas[refinedId].second_pass.model_loaded, 'photonic_fusion_sdxl_finale_v1.safetensors', 'the checkpoint the worker actually loaded is recorded');
  assert.equal(h.metas[refinedId].prompt, undefined, 'save_prompts=false: no prompt text in the record');
  assert.equal(h.metas['base-canonical.png'].prompt, undefined);
  assert.equal(job.results.length, 2); assert.equal(job.results[1].parentImageId, 'base-canonical.png');
  assert.equal((job.stdout.match(/SDCPP_RUN_ID:/g) || []).length, 2, 'both passes announce run ids for verified cancel');
  assert.deepEqual(fs.readdirSync(path.join(h.root, 'wf', 'mask-uploads')), [], 'temporary working copies are removed');
});

test('a failed refinement does not destroy the completed base image', async () => {
  const h = harness({ secondPassFails: true });
  const r = await h.call({ target: 'sd15', prompt: 'a fox', seed: 1, second_pass: { target: 'sd15' } });
  const job = await h.wait(r.body.job_id);
  assert.equal(job.status, 'FAIL'); assert.equal(job.firstFailedGate, 'second-pass');
  assert.match(job.stderr, /base image base-canonical\.png is complete and kept/);
  assert.deepEqual(fs.readdirSync(h.canon), ['base-canonical.png']);
  assert.equal(job.results.length, 1); assert.equal(job.results[0].pass, 'base');
});

test('in-engine hires fields cannot be mixed in; a dry run validates without starting anything', async () => {
  const h = harness();
  let r = await h.call({ target: 'sd15', prompt: 'x', hires_scale: 1.5, second_pass: { target: 'sd15' } });
  assert.equal(r.code, 400); assert.match(r.body.error, /cannot be combined/);
  r = await h.call({ target: 'sd15', prompt: 'x', dry_run: true, second_pass: { target: 'sdxl-photonic', scale: 1.5 } });
  assert.equal(r.code, 200); assert.equal(r.body.second_pass.width, 768); assert.equal(r.body.second_pass.modelPath, undefined, 'no checkpoint path is returned to the client');
  assert.equal(Object.keys(h.jobs).length, 0);
});

test('the image-meta store keeps the workflow links and pass settings (and still drops unsaved prompt text)', () => {
  const W = require('../workstation');
  const f = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'meta-')), 'image-meta.json');
  const store = W.createImageMetaStore(f);
  store.record('r.png', { operation: 'hires-2pass', parent: 'b.png', workflow_id: 'job1', workflow: 'hires-2pass', pass: 'second', second_pass: { upscaler: 'lanczos', inherited: ['seed'] }, prompt_saved: false, prompt: 'secret' });
  store.record('l.png', { operation: 'loopback', script: { kind: 'loopback', loops: 2 }, loopback: { strengths: [0.5, 0.3] } });
  const r = JSON.parse(fs.readFileSync(f, 'utf8')).images;
  assert.equal(r['r.png'].workflow_id, 'job1'); assert.equal(r['r.png'].pass, 'second'); assert.deepEqual(r['r.png'].second_pass.inherited, ['seed']);
  assert.equal(r['r.png'].prompt, undefined);
  assert.deepEqual(r['l.png'].loopback.strengths, [0.5, 0.3]); assert.equal(r['l.png'].script.loops, 2);
});

test('hires geometry follows A1111: resize-to with another aspect covers then centre-crops; same aspect or scale mode does not crop', () => {
  const { hiresGeometry } = require('../hires-2pass.js');
  assert.deepEqual(hiresGeometry(512, 512, 1024, 768, true), { upscaleTo: { width: 1024, height: 1024 }, crop: { x: 0, y: 128, width: 1024, height: 768 } });
  assert.deepEqual(hiresGeometry(512, 512, 768, 576, true), { upscaleTo: { width: 768, height: 768 }, crop: { x: 0, y: 96, width: 768, height: 576 } });
  assert.deepEqual(hiresGeometry(768, 512, 1024, 1024, true).crop, { x: 256, y: 0, width: 1024, height: 1024 });
  assert.deepEqual(hiresGeometry(512, 512, 768, 768, true), { upscaleTo: { width: 768, height: 768 }, crop: null });
  assert.deepEqual(hiresGeometry(512, 768, 768, 1152, false), { upscaleTo: { width: 768, height: 1152 }, crop: null });
});
