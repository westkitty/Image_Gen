'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');
const { buildControlledArgs, nativeBatchEligible, NATIVE_BATCH_MAX } = require('../controlled-args');
const { createImageStore } = require('../image-store');
const { capabilityForJob, CAPABILITIES } = require('../capabilities');

const SCRIPT = fs.readFileSync(path.join(__dirname, '..', '..', 'sdcpp-workflow', 'bin', 'sdcpp-controlled-generate.sh'), 'utf8');
const SERVER = fs.readFileSync(path.join(__dirname, '..', 'server.js'), 'utf8');
const PNG = Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), Buffer.alloc(32, 1)]);
const sd15 = { id: 'sd15', backend: 'sdcpp' };
const flux = { id: 'flux2-klein-4b', backend: 'mflux' };

test('native batch: SDCPP 2-16 only; MFLUX always sequential; env kill-switch', () => {
  assert.equal(nativeBatchEligible(sd15, 1), false);
  assert.equal(nativeBatchEligible(sd15, 3), true);
  assert.equal(nativeBatchEligible(sd15, NATIVE_BATCH_MAX), true);
  assert.equal(nativeBatchEligible(sd15, NATIVE_BATCH_MAX + 1), false, 'larger quantities fall back to sequential');
  assert.equal(nativeBatchEligible(flux, 3), false);
  assert.equal(nativeBatchEligible(sd15, 3, { DEX_NATIVE_BATCH: '0' }), false);
});

test('native batch command construction: --batch-count with the base seed; never for MFLUX', () => {
  const p = { target: 'sd15', prompt: 'p', width: 512, height: 512, steps: 4, save_prompts: false };
  const a = buildControlledArgs(sd15, p, { seedValue: 1000, batchCount: 3 });
  assert.deepEqual(a.slice(a.indexOf('--seed'), a.indexOf('--seed') + 2), ['--seed', '1000']);
  assert.deepEqual(a.slice(a.indexOf('--batch-count'), a.indexOf('--batch-count') + 2), ['--batch-count', '3']);
  assert.ok(!buildControlledArgs(sd15, p, { seedValue: 1, batchCount: 1 }).includes('--batch-count'));
  assert.ok(!buildControlledArgs(flux, p, { seedValue: 1, batchCount: 3 }).includes('--batch-count'));
});

test('High-Res Refine args are SDCPP-only and distinct from resize/ESRGAN', () => {
  const p = { target: 'sd15', prompt: 'p', hires_scale: 2, hires_steps: 8, hires_denoise: 0.45, hires_upscaler: 'Latent', save_prompts: false };
  const a = buildControlledArgs(sd15, p, { seedValue: 1 });
  assert.deepEqual(a.slice(a.indexOf('--hires-scale'), a.indexOf('--hires-scale') + 8),
    ['--hires-scale', '2', '--hires-steps', '8', '--hires-denoise', '0.45', '--hires-upscaler', 'Latent']);
  assert.ok(!buildControlledArgs(flux, p, { seedValue: 1 }).includes('--hires-scale'));
  assert.match(SCRIPT, /--hires --hires-scale \$ARG_HIRES_SCALE --hires-steps \$ARG_HIRES_STEPS --hires-denoising-strength \$ARG_HIRES_DENOISE/);
});

test('script: native batch enumerates every output, registers each for Big Mac cleanup, records per-output seeds', () => {
  assert.match(SCRIPT, /REMOTE_OUT_ARG="\$REMOTE_RUN_DIR\/controlled-\$ARG_TARGET-b%02d\.png"/);
  assert.match(SCRIPT, /register_remote_ephemeral "\$\{BATCH_REMOTE_PNGS\[@\]\}"/);
  assert.match(SCRIPT, /verify_png "\$lp" "Native batch PNG/);
  assert.match(SCRIPT, /\$\(\(SEED_VALUE \+ bi\)\)/);
  assert.match(SCRIPT, /CONTROLLED_BATCH_IMAGE: %s/);
  // server/tunnel path is bypassed when native extras are requested
  assert.match(SCRIPT, /\[ "\$ARG_BATCH_COUNT" = "1" \] && \[ -z "\$ARG_HIRES_SCALE" \]/);
});

test('native batch outputs canonicalize independently with their own seeds (no collision/overwrite)', () => {
  const base = fs.mkdtempSync(path.join(os.tmpdir(), 'dex-nb-'));
  const store = createImageStore({ root: path.join(base, 'images_made') });
  const runDir = path.join(base, 'runs', '20260926-100000-controlled-sd15');
  fs.mkdirSync(runDir, { recursive: true });
  const names = ['controlled-sd15-b00.png', 'controlled-sd15-b01.png', 'controlled-sd15-b02.png'];
  names.forEach((n, i) => fs.writeFileSync(path.join(runDir, n), Buffer.concat([PNG, Buffer.from([i])])));
  fs.writeFileSync(path.join(runDir, 'controlled-manifest.json'), JSON.stringify({ seed_label: '1000' }));
  fs.writeFileSync(path.join(runDir, 'controlled-extras.json'), JSON.stringify({ output_seeds: { [names[0]]: 1000, [names[1]]: 1001, [names[2]]: 1002 } }));
  const adopted = store.finalizeRun(runDir);
  assert.equal(adopted.length, 3);
  assert.deepEqual(adopted.map(e => e.seed), ['1000', '1001', '1002']);
  assert.deepEqual(adopted.map(e => e.image_id), [
    '20260926-100000-controlled-sd15-s1000-controlled-sd15-b00.png',
    '20260926-100000-controlled-sd15-s1001-controlled-sd15-b01.png',
    '20260926-100000-controlled-sd15-s1002-controlled-sd15-b02.png',
  ]);
  assert.equal(new Set(adopted.map(e => fs.readFileSync(e.image_path).at(-1))).size, 3, 'three distinct files');
  assert.deepEqual(fs.readdirSync(runDir).filter(f => f.endsWith('.png')), [], 'run dir keeps no image bytes');
});

test('server falls back to sequential when the native command cannot be built', () => {
  assert.match(SERVER, /native && \(gate === 'command' \|\| gate === 'sd-cli-help'\)/);
  assert.match(SERVER, /runControlledSequential\(jobId, spec, params, quantity, \{ \.\.\.opts, native: false/);
});

test('explicit capability ids (native batch, High-Res Refine) never swallow ordinary txt2img evidence', () => {
  const plain = capabilityForJob({ commandAction: 'controlled-generate', controlledTarget: 'sd15' }, 'sdcpp');
  assert.equal(plain.id, 'txt2img-sdcpp');
  assert.equal(capabilityForJob({ commandAction: 'controlled-generate', capabilityId: 'quantity-native-batch' }, 'sdcpp').id, 'quantity-native-batch');
  assert.equal(capabilityForJob({ commandAction: 'controlled-generate', capabilityId: 'hires-refine' }, 'sdcpp').id, 'hires-refine');
  const cn = CAPABILITIES.find(c => c.id === 'controlnet');
  assert.equal(cn.implemented, false);
  assert.match(cn.reason, /ENGINE SUPPORTED — MODEL ASSET MISSING/);
});

test('full-mask guard and blank-mask rejection are both enforced server-side', () => {
  assert.match(SERVER, /Mask has no painted pixels/);
  assert.match(SERVER, /coverage >= FULL_MASK_COVERAGE && body\.confirm_full_mask !== true/);
  assert.match(SERVER, /The entire image is masked\. This will regenerate nearly everything\./);
});

test('outpaint/inpaint composite restores the source; outpaint never stretches it', () => {
  assert.match(SERVER, /if len\(sys\.argv\) > 7 and sys\.argv\[7\] == "fit" and s\.size != o\.size/);
  assert.match(SERVER, /outpaintComposite: \{ src: src\.path, mask: maskPath, left: plan\.left, top: plan\.top \}/);
  assert.match(SERVER, /outpaintComposite = \{ src: initImgPath, mask: maskPath, left: 0, top: 0, blur: 4, fit: true \}/);
  // composite runs after canonicalization (the script adopts its own PNG)
  assert.match(SERVER, /finalizeJobImages\(job, out\);\n    if \(job\.outpaintComposite && job\.status === 'PASS'\) compositeOutpaint\(job, out\);/);
});

test('durable queue state lives in the gitignored runtime state dir', () => {
  assert.match(SERVER, /file: path\.join\(STATE_DIR, 'queues\.json'\)/);
});
