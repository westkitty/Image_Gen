'use strict';
// Multi-pass scripts (script-chains.js) driven against STUB worker scripts: no Big Mac, no model. The stubs behave like
// bin/sdcpp-img2img.sh / sdcpp-inpaint.sh (announce SDCPP_RUN_ID, write a PNG into their own run folder, print
// "Local PNG:"), so the real chain code, the real geometry tools and the publication contract are exercised.
const test = require('node:test'), assert = require('node:assert/strict');
const fs = require('node:fs'), os = require('node:os'), path = require('node:path');
const { execFileSync } = require('node:child_process');
const C = require('../script-chains');

const PIL = (code, ...args) => execFileSync('python3', ['-c', code, ...args], { encoding: 'utf8' });

function harness() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'chains-'));
  const wf = path.join(root, 'wf'), bin = path.join(wf, 'bin'), runs = path.join(wf, 'runs'), uploads = path.join(wf, 'mask-uploads');
  for (const d of [bin, runs, uploads]) fs.mkdirSync(d, { recursive: true });
  const calls = path.join(root, 'calls.log');
  // Stub worker: records its args, copies --init-img (optionally tinted where --mask is white) into a fresh run folder.
  const stub = `#!/bin/bash
set -euo pipefail
for a in "$@"; do [ -n "$a" ] || { echo "empty argument (the real workers parse with \${2:?})" >&2; exit 9; }; done
echo "$*" >> ${JSON.stringify(calls)}
INIT=""; MASK=""; NAME=out
while [ $# -gt 0 ]; do case "$1" in --init-img) INIT="$2"; shift 2;; --mask) MASK="$2"; shift 2;; --out-name) NAME="$2"; shift 2;; *) shift;; esac; done
RUN="${runs}/20991231-$(date +%H%M%S)-$RANDOM-stub"; mkdir -p "$RUN"
echo "SDCPP_RUN_ID: $(basename "$RUN")"
python3 -c 'import sys
from PIL import Image
im=Image.open(sys.argv[1]).convert("RGB")
if sys.argv[3]:
    m=Image.open(sys.argv[3]).convert("L"); im=Image.composite(Image.new("RGB",im.size,(255,0,255)),im,m)
im.save(sys.argv[2])' "$INIT" "$RUN/$NAME.png" "$MASK"
# Like sdcpp-lib.sh pass_banner: a TOP-LEVEL run publishes (moves) its image to the canonical store; a nested one leaves it.
if [ -z "\${DEX_TOP_PID:-}" ]; then mkdir -p ${JSON.stringify(path.join(root, 'canonical'))}; mv "$RUN/$NAME.png" ${JSON.stringify(path.join(root, 'canonical'))}/; echo "CANONICAL_IMAGE: published"; fi
echo "Local PNG: $RUN/$NAME.png"
echo "==== PASS ===="
`;
  for (const s of ['sdcpp-img2img.sh', 'sdcpp-inpaint.sh']) { fs.writeFileSync(path.join(bin, s), stub); fs.chmodSync(path.join(bin, s), 0o755); }
  const src = path.join(root, 'src.png');
  PIL('from PIL import Image\nim=Image.new("RGB",(512,512),(10,120,200))\nfor x in range(64):\n  for y in range(64): im.putpixel((x,y),(250,250,0))\nim.save(__import__("sys").argv[1])', src);
  const jobs = {}, routes = {}, published = [];
  const deps = {
    WORKFLOW_ROOT: wf, RUNS_DIR: runs, MASK_UPLOADS_DIR: uploads, JOB_TIMEOUT_MS: 120000, jobs, jobSensitives: {},
    jobStore: { get: () => null, transition() {} },
    createJob: (action, summary, params) => { const id = 'job-' + Object.keys(jobs).length; jobs[id] = { id, commandAction: action, status: 'queued', stdout: '', stderr: '', requestParams: params }; return id; },
    withLease: (id, start) => start(),
    resolveImageSource: () => ({ imageId: 'src.png', path: src }), resolveEditResources: () => null,
    pngSize: p => { const [w, h] = PIL('import sys\nfrom PIL import Image\nprint(*Image.open(sys.argv[1]).size)', p).trim().split(' ').map(Number); return { width: w, height: h }; },
    normalizeGenerationBody: b => ({ prompt: b.prompt || 'p', negative_prompt: '', steps: b.steps || 4, cfg_scale: 7, sampler: 'euler_a', seed: b.seed, save_prompts: false, width: b.width, height: b.height }),
    validateGenerationParams: () => null, sanitizeRequestParams: p => p, editGenRecord: (b, p, x) => x,
    redactSensitiveText: t => t, updateSequentialProgress: (job, patch) => { job.progress = { ...job.progress, ...patch }; },
    finalizeJobImages: (job, out) => { for (const m of out.matchAll(/runs\/(20\d{6}-\d{6}-[a-z0-9-]+)/g)) published.push(m[1]); },
    recordEditResults() {}, recordJobEvidence() {}, syncGenericTerminal() {},
    runStamp: () => '20991231-235959',
  };
  C.mount({ post: (p, h) => { routes[p] = h; } }, deps);
  const call = (kind, body) => new Promise(resolve => {
    const res = { code: 200, status(c) { this.code = c; return this; }, json(j) { resolve({ code: this.code, body: j }); } };
    routes['/api/scripts/' + kind]({ body }, res);
  });
  const wait = async id => { for (let i = 0; i < 600 && !['PASS', 'FAIL', 'CANCELLED'].includes(jobs[id].status); i++) await new Promise(r => setTimeout(r, 100)); return jobs[id]; };
  const canonicalDir = path.join(root, 'canonical');
  const passes = () => (fs.existsSync(calls) ? fs.readFileSync(calls, 'utf8').trim().split('\n').filter(Boolean) : []);
  return { root, runs, uploads, call, wait, passes, published, jobs, canonicalDir };
}

test('loopback denoising curve is loopback.py calculate_denoising_strength', () => {
  assert.deepEqual(C.loopbackStrengths(1, 0.5, 0.1, 'Linear'), [0.5]);
  const lin = C.loopbackStrengths(5, 0.6, 0.2, 'Linear');
  assert.equal(lin[0], 0.6); assert.ok(Math.abs(lin[4] - 0.2) < 1e-12); assert.ok(Math.abs(lin[2] - 0.4) < 1e-12);
  const ag = C.loopbackStrengths(3, 0.4, 0.8, 'Aggressive'), lz = C.loopbackStrengths(3, 0.4, 0.8, 'Lazy');
  assert.ok(Math.abs(ag[1] - (0.4 + 0.4 * Math.sin(Math.PI / 4))) < 1e-12);
  assert.ok(Math.abs(lz[1] - (0.4 + 0.4 * (1 - Math.cos(Math.PI / 4)))) < 1e-12);
  assert.equal(C.clampStrength(0), 0.01); assert.equal(C.clampStrength(1), 0.99);
});

test('validation: ranges, unavailable interrogation and Real-ESRGAN pre-upscale, latent masked content', () => {
  const src = { width: 512, height: 512 };
  assert.match(C.normalizeScript('loopback', { loops: 0 }, src).error, /loops/);
  assert.match(C.normalizeScript('loopback', { curve: 'Wild' }, src).error, /curve/);
  assert.match(C.normalizeScript('loopback', { interrogate: 'DeepBooru' }, src).error, /interrogator/);
  assert.match(C.normalizeScript('sd-upscale', { upscaler: 'realesrgan' }, src).error, /not wired/);
  assert.match(C.normalizeScript('sd-upscale', { scale: 1, tile_width: 1024, tile_height: 1024 }, src).error, /smaller than one/);
  assert.match(C.normalizeScript('outpaint-poor', { masked_content: 'latent noise' }, src).error || '', /latent|not/i);
});

test('SD upscale: one img2img pass per tile at the tile size, seeds seed+k, only the combined image is published', async () => {
  const h = harness();
  const r = await h.call('sd-upscale', { image_id: 'src.png', seed: 100, strength: 0.3, script: { scale: 2, overlap: 64, tile_width: 512, tile_height: 512, upscaler: 'lanczos' } });
  assert.equal(r.code, 200, JSON.stringify(r.body)); assert.equal(r.body.passes, 9); assert.equal(r.body.result_size, '1024x1024');
  const job = await h.wait(r.body.job_id);
  assert.equal(job.status, 'PASS', job.stderr);
  const p = h.passes();
  assert.equal(p.length, 9);
  p.forEach((line, k) => { assert.match(line, /--width 512 --height 512/); assert.match(line, new RegExp('--seed ' + (100 + k) + ' ')); assert.match(line, /--strength 0\.3 /); });
  assert.deepEqual(h.published, ['20991231-235959-sd-upscale'], 'exactly one run is published');
  assert.equal(fs.existsSync(h.canonicalDir), false, 'no pass published its intermediate tile (passes run nested)');
  assert.equal((job.stdout.match(/SDCPP_RUN_ID:/g) || []).length, 9, 'every pass announces its run id for Cancel');
  const out = path.join(h.runs, '20991231-235959-sd-upscale', 'sd-upscale.png');
  assert.equal(PIL('import sys\nfrom PIL import Image\nprint(*Image.open(sys.argv[1]).size)', out).trim(), '1024 1024');
  assert.deepEqual(fs.readdirSync(h.uploads), [], 'the chain work folder is removed');
});

test('Loopback: N img2img passes, each fed the previous output, strengths follow the curve, seed + i', async () => {
  const h = harness();
  const r = await h.call('loopback', { image_id: 'src.png', seed: 7, strength: 0.6, script: { loops: 3, final_strength: 0.2, curve: 'Linear' } });
  const job = await h.wait(r.body.job_id);
  assert.equal(job.status, 'PASS', job.stderr);
  const p = h.passes();
  assert.equal(p.length, 3);
  assert.match(p[0], /--strength 0\.6 .*--seed 7 /); assert.match(p[1], /--strength 0\.4 .*--seed 8 /); assert.match(p[2], /--strength 0\.2 .*--seed 9 /);
  assert.match(p[1], /mask-uploads\/chain-loopback-[^ ]+\/loop_0\.png/, 'pass 2 starts from pass 1 output');
  assert.deepEqual(job.genRecord.loopback.strengths, [0.6, 0.4, 0.2]);
});

test("Poor man's outpainting: inpaints only the tiles that touch new area, pastes back through the blurred mask, combines", async () => {
  const h = harness();
  const r = await h.call('outpaint-poor', { image_id: 'src.png', seed: 3, strength: 1, script: { pixels: 128, directions: ['left', 'right'], mask_blur: 4, masked_content: 'fill' } });
  assert.equal(r.body.result_size, '768x512');
  const job = await h.wait(r.body.job_id);
  assert.equal(job.status, 'PASS', job.stderr);
  const p = h.passes();
  assert.equal(p.length, 2); p.forEach(l => assert.match(l, /--mask .*tile_00\d_latent_mask\.png/));
  assert.match(job.stdout, /Strength clamped to sd-cli's 0\.01-0\.99 range: 1→0\.99/);
  const out = path.join(h.runs, '20991231-235959-outpaint-poor', 'outpaint-poor.png');
  const px = PIL('import sys\nfrom PIL import Image\nim=Image.open(sys.argv[1]).convert("RGB")\nprint(im.size, im.getpixel((5,256)), im.getpixel((384,256)))', out).trim();
  assert.match(px, /^\(768, 512\) \(255, 0, 255\) \(10, 120, 200\)$/, 'new left strip came from the inpaint pass; the centre kept the source');
});

test('Outpainting mk2: one inpaint pass per direction in left,right,up,down order; final size as planned', async () => {
  const h = harness();
  const r = await h.call('outpaint-mk2', { image_id: 'src.png', seed: 3, strength: 0.8, script: { pixels: 64, directions: ['up', 'left'], mask_blur: 8 } });
  assert.equal(r.code, 200, JSON.stringify(r.body));
  const job = await h.wait(r.body.job_id);
  assert.equal(job.status, 'PASS', job.stderr);
  assert.equal(h.passes().length, 2);
  const out = path.join(h.runs, '20991231-235959-outpaint-mk2', 'outpaint-mk2.png');
  assert.equal(PIL('import sys\nfrom PIL import Image\nprint(*Image.open(sys.argv[1]).size)', out).trim(), r.body.result_size.replace('x', ' '));
});

test('a failing pass fails the job and publishes nothing', async () => {
  const h = harness();
  fs.writeFileSync(path.join(h.root, 'wf', 'bin', 'sdcpp-img2img.sh'), '#!/bin/bash\necho "SDCPP_RUN_ID: 20991231-000000-x"\necho "First failed gate: remote-generate"\nexit 1\n');
  const r = await h.call('loopback', { image_id: 'src.png', seed: 1, script: { loops: 2 } });
  const job = await h.wait(r.body.job_id);
  assert.equal(job.status, 'FAIL'); assert.match(job.stderr, /gate remote-generate/);
  assert.deepEqual(h.published, []);
});
