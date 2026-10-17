'use strict';
// OP-4A: independent second-pass Hires (pixel space), application-level orchestration. No engine binary is changed.
//
//   1. Base image through its normal controlled backend (MFLUX or SDCPP), exactly like a Create job: the worker publishes
//      it to the canonical store and it is recorded as a completed result in its own right.
//   2. Pixel-space upscale on the MacBook (Pillow resampler) to the second-pass size.
//   3. Independent img2img refinement through bin/sdcpp-img2img.sh with the second pass's OWN prompt, negative prompt,
//      checkpoint (server-resolved path, never a client path), sampler, scheduler, steps, CFG and denoising strength.
//   4. The refined image is published separately (fresh run folder) and linked to the base: parent = base image id and
//      both carry the same workflow_id (the job id).
//
// What this is NOT: A1111's in-engine latent hires handoff or the SDXL mid-denoising refiner (OP-4B, engine work). A
// value the user did not set for the second pass is inherited from the base pass and recorded as inherited; an explicit
// value is used as given. A second pass on MFLUX is refused (no MFLUX img2img denoise path; FLUX.2 reference editing is
// a different operation). A failed refinement leaves the completed base image in place.
const fs = require('node:fs');
const path = require('node:path');
const { spawn, execFile } = require('node:child_process');

const UPSCALERS = { lanczos: 'LANCZOS', nearest: 'NEAREST', bicubic: 'BICUBIC', bilinear: 'BILINEAR' };
const KEYS = new Set(['prompt', 'negative_prompt', 'target', 'sampler', 'scheduler', 'steps', 'cfg_scale', 'denoise', 'scale', 'width', 'height', 'upscaler', 'seed']);
const UNSUPPORTED_SECOND_PASS = {
  mflux: 'MFLUX targets have no img2img denoising path; FLUX.2 reference editing is a different operation',
  'flux-fp8': 'FLUX.1 Schnell FP8 has no proven sd-cli generation on this system (historically failed)',
};

// -> { opts } | { error }. base: normalized controlled params; baseSpec: base target spec; targets: { id: spec }.
function normalizeSecondPass(raw, { base, baseSpec, targets, targetModels, validateSampling, canonical = s => s }) {
  if (raw == null || typeof raw !== 'object' || Array.isArray(raw)) return { error: 'second_pass must be an object' };
  for (const k of Object.keys(raw)) if (!KEYS.has(k)) return { error: `Unexpected second_pass field: ${k}` };
  const inherited = [];
  const pick = (k, fallback) => { if (raw[k] === undefined || raw[k] === '' || raw[k] === null) { inherited.push(k); return fallback; } return raw[k]; };
  const targetId = pick('target', baseSpec.backend === 'mflux' ? null : baseSpec.id);
  if (!targetId) return { error: 'Choose a second-pass checkpoint: the base target is MFLUX, which has no img2img denoising path' };
  const spec = targets[targetId];
  if (!spec) return { error: `Unknown second-pass target: ${targetId}` };
  if (spec.backend === 'mflux') return { error: `Second pass on ${targetId} is not available: ${UNSUPPORTED_SECOND_PASS.mflux}` };
  if (UNSUPPORTED_SECOND_PASS[targetId]) return { error: `Second pass on ${targetId} is not available: ${UNSUPPORTED_SECOND_PASS[targetId]}` };
  const modelPath = targetModels[spec.aliasOf || spec.id];
  if (!modelPath) return { error: `Second pass on ${targetId} is not available: no server-resolved checkpoint path for this target` };
  const steps = Number(pick('steps', base.steps || spec.defaultSteps));
  const cfg = Number(pick('cfg_scale', baseSpec.backend === 'mflux' ? spec.defaultCfgScale : (base.cfg_scale || spec.defaultCfgScale)));
  const denoise = Number(pick('denoise', 0.45));
  const upscaler = pick('upscaler', 'lanczos');
  if (!Number.isInteger(steps) || steps < 1 || steps > 150) return { error: 'second_pass.steps must be 1-150' };
  if (!(cfg >= 1 && cfg <= 30)) return { error: 'second_pass.cfg_scale must be 1-30' };
  if (!(denoise >= 0.01 && denoise <= 0.99)) return { error: 'second_pass.denoise must be 0.01-0.99 (sd-cli --strength range)' };
  if (!UPSCALERS[upscaler]) return { error: `second_pass.upscaler must be one of ${Object.keys(UPSCALERS).join(', ')} (pixel-space; model upscalers are not wired)` };
  const bw = Number(base.width || baseSpec.defaultWidth), bh = Number(base.height || baseSpec.defaultHeight);
  let w, h;
  if (raw.width !== undefined || raw.height !== undefined) {
    w = Number(raw.width); h = Number(raw.height);
    if (raw.scale !== undefined) return { error: 'Use either second_pass.scale or second_pass.width/height, not both' };
    if (!Number.isInteger(w) || !Number.isInteger(h) || w % 8 || h % 8) return { error: 'second_pass.width/height must be multiples of 8' };
  } else {
    const scale = Number(pick('scale', 1.5));
    if (!(scale >= 1 && scale <= 4)) return { error: 'second_pass.scale must be 1-4' };
    w = Math.floor((bw * scale) / 8) * 8; h = Math.floor((bh * scale) / 8) * 8;
  }
  if (w < 64 || h < 64 || w > 2048 || h > 2048) return { error: `Second-pass size ${w}x${h} is outside 64-2048` };
  if (w < bw || h < bh) return { error: 'The second pass must not be smaller than the base image' };
  const sampler = canonical(pick('sampler', baseSpec.backend === 'mflux' ? spec.defaultSampler : (base.sampler || spec.defaultSampler)));
  const scheduler = pick('scheduler', baseSpec.backend === 'mflux' ? (spec.defaultScheduler || 'discrete') : (base.scheduler || spec.defaultScheduler || 'discrete'));
  const sErr = validateSampling ? validateSampling(spec, { sampler, scheduler }) : null;
  if (sErr) return { error: 'Second pass: ' + sErr };
  const prompt = pick('prompt', base.prompt);
  const negative = pick('negative_prompt', base.negative_prompt || '');
  const seed = raw.seed !== undefined && raw.seed !== '' ? Number(raw.seed) : null;
  if (seed !== null && (!Number.isInteger(seed) || seed < 0 || seed > 2147483647)) return { error: 'second_pass.seed must be 0-2147483647' };
  if (seed === null) inherited.push('seed');
  if (!String(prompt || '').trim()) return { error: 'The second pass needs a prompt (none given and the base prompt is empty)' };
  const explicitSize = raw.width !== undefined || raw.height !== undefined;
  return { opts: { target: spec.id, modelPath, steps, cfg, denoise, upscaler, width: w, height: h, sampler, scheduler, prompt, negative, seed, inherited, baseWidth: bw, baseHeight: bh, explicitSize, geometry: hiresGeometry(bw, bh, w, h, explicitSize) } };
}

// A1111 StableDiffusionProcessingTxt2Img.calculate_target_resolution (processing.py L1223-1250 @82a973c) and
// sample_hr_pass (L1411 pixel resize to hr_upscale_to, L1427 latent truncation), done in pixel space.
// Resize-to with both sides: upscale so the image COVERS the target keeping the base aspect, then centre-crop
// (A1111 crops truncate//2 latent cells from the top/left). Scale mode: plain resize, no crop.
function hiresGeometry(bw, bh, tw, th, explicitSize) {
  if (!explicitSize) return { upscaleTo: { width: tw, height: th }, crop: null };
  let ux, uy;
  if (bw / bh < tw / th) { ux = tw; uy = Math.floor(tw * bh / bw); } else { ux = Math.floor(th * bw / bh); uy = th; }
  if (ux === tw && uy === th) return { upscaleTo: { width: tw, height: th }, crop: null };
  const tx = Math.floor((ux - tw) / 8), ty = Math.floor((uy - th) / 8);
  return { upscaleTo: { width: ux, height: uy }, crop: { x: 8 * Math.floor(tx / 2), y: 8 * Math.floor(ty / 2), width: tw, height: th } };
}

function mount(app, D) {
  const BIN = path.join(D.WORKFLOW_ROOT, 'bin');
  const UPSCALE_PY = 'import sys\nfrom PIL import Image\nm={"LANCZOS":Image.LANCZOS,"NEAREST":Image.NEAREST,"BICUBIC":Image.BICUBIC,"BILINEAR":Image.BILINEAR}[sys.argv[5]]\nim=Image.open(sys.argv[1]).convert("RGB")\nim=im.resize((int(sys.argv[3]),int(sys.argv[4])),m)\nif len(sys.argv)>9: x,y,w,h=map(int,sys.argv[6:10]); im=im.crop((x,y,x+w,y+h))\nim.save(sys.argv[2])';

  // Spawn one worker. nested=true leaves its image in its run folder (published later by us); false lets it publish itself.
  function runWorker(job, script, args, { nested, label, savePrompts }) {
    return new Promise((resolve, reject) => {
      if (job.status !== 'running') return reject(new Error('stopped'));
      const env = { ...process.env, SDCPP_REDACT_PROMPTS: savePrompts ? '0' : '1' };
      if (nested) env.DEX_TOP_PID = String(process.pid); else delete env.DEX_TOP_PID;
      delete env.DEX_RUN_DIRS_FILE;
      const child = spawn(path.join(D.WORKFLOW_ROOT, script), args, { cwd: D.WORKFLOW_ROOT, shell: false, env, detached: true });
      job.childPid = child.pid;
      let out = '', err = '';
      const timer = setTimeout(() => { try { process.kill(-child.pid, 'SIGTERM'); } catch (_) {} }, D.JOB_TIMEOUT_MS);
      timer.unref();
      child.stdout.on('data', d => {
        const t = D.redactSensitiveText(d.toString(), D.jobSensitives[job.id] || []);
        out += t;
        for (const m of t.matchAll(/SDCPP_RUN_ID:\s*(20\d{6}-\d{6}-[a-zA-Z0-9_-]+)/g)) job.stdout += `SDCPP_RUN_ID: ${m[1]}  (${label})\n`;
      });
      child.stderr.on('data', d => { err += D.redactSensitiveText(d.toString(), D.jobSensitives[job.id] || []); });
      child.on('error', e => { clearTimeout(timer); reject(e); });
      child.on('close', code => {
        clearTimeout(timer); job.childPid = null;
        job.passLog = (job.passLog || '') + `\n--- ${label} (exit ${code}) ---\n` + (out + err).replace(/runs\//g, 'runs:').slice(-4000);
        if (code === 0 && /==== PASS ====/.test(out)) return resolve(out);
        const gate = /First failed gate:\s*(.+)/.exec(out + err);
        reject(new Error(`${label} failed${gate ? ' at gate ' + gate[1].trim() : ''} (exit ${code})`));
      });
    });
  }
  const py = args => new Promise((resolve, reject) => execFile('python3', args, { timeout: 120000, encoding: 'utf8' }, (e, o, se) => (e ? reject(new Error(String(se || e.message).trim().slice(0, 300))) : resolve(o))));

  async function run(jobId, ctx) {
    const job = D.jobs[jobId];
    job.status = 'running'; job.startedRunningAt = Date.now();
    if (D.jobStore.get(jobId) && D.jobStore.get(jobId).status === 'QUEUED') D.jobStore.transition(jobId, 'RUNNING');
    job.results = [];
    const progress = (done, stage) => D.updateSequentialProgress(job, { totalRuns: 2, completedRuns: done, currentRun: Math.min(2, done + 1), currentRunPercent: 0, stage });
    const work = fs.mkdtempSync(path.join(D.MASK_UPLOADS_DIR, 'hires2-'));
    const { base, baseSpec, sp, seed } = ctx;
    let baseImg = null;
    try {
      // 1. Base pass — a normal controlled generation, published by the worker itself.
      progress(0, 'base pass');
      const baseArgs = D.buildControlledArgs(baseSpec, { ...base, seed, quantity: 1 }, { seedValue: seed, isDiscovered: !D.CONTROLLED_TARGET_BY_ID[baseSpec.id], resolveVaePath: D.resolveVaePath });
      const out = await runWorker(job, D.controlledScriptFor(baseSpec), baseArgs, { nested: false, label: 'base pass', savePrompts: base.save_prompts });
      const reported = (out.match(/CONTROLLED_OUTPUT_IMAGE:\s*(\S+)/) || [])[1];
      baseImg = reported && D.canonicalForReportedPath(reported);
      if (!baseImg) throw Object.assign(new Error('base pass finished but its image is not in the canonical store'), { gate: 'base-canonical' });
      const bdims = D.pngSize(baseImg.path) || {};
      const baseRun = (out.match(/runs\/(20\d{6}-\d{6}-[a-zA-Z0-9_-]+)/) || [])[1] || null;
      D.imageMeta.record(baseImg.id, {
        operation: 'txt2img', runId: baseRun, target: baseSpec.id, seed, width: bdims.width, height: bdims.height,
        steps: base.steps || baseSpec.defaultSteps, cfg: baseSpec.backend === 'mflux' ? undefined : base.cfg_scale,
        sampler: baseSpec.backend === 'mflux' ? undefined : D.EC.canonicalSampler(base.sampler || baseSpec.defaultSampler),
        scheduler: baseSpec.backend === 'mflux' ? undefined : base.scheduler, gen_schema: 1,
        workflow_id: jobId, workflow: 'hires-2pass', pass: 'base',
        prompt_saved: !!base.save_prompts, prompt: base.save_prompts ? base.prompt : undefined,
        negative_prompt: base.save_prompts && baseSpec.backend !== 'mflux' ? base.negative_prompt : undefined,
      });
      job.results.push({ index: 0, status: 'DONE', imageId: baseImg.id, imageUrl: D.imageStore.imageUrl(baseImg.id), seed, target: baseSpec.id, width: bdims.width, height: bdims.height, operation: 'txt2img', pass: 'base' });
      // 2. Pixel-space upscale (temporary working copy, never the canonical file).
      progress(1, 'upscale');
      const up = path.join(work, 'upscaled.png');
      const g = bdims.width && bdims.height ? hiresGeometry(bdims.width, bdims.height, sp.width, sp.height, !!sp.explicitSize) : sp.geometry;  // real base size when readable
      await py(['-c', UPSCALE_PY, baseImg.path, up, String(g.upscaleTo.width), String(g.upscaleTo.height), UPSCALERS[sp.upscaler]]
        .concat(g.crop ? [g.crop.x, g.crop.y, g.crop.width, g.crop.height].map(String) : []));
      // 3. Independent refinement pass with the second pass's own settings and checkpoint (nested: published below).
      progress(1, 'second pass');
      const secondSeed = sp.seed !== null ? sp.seed : seed;
      const a = ['--init-img', up, '--strength', String(sp.denoise), ...(sp.prompt ? ['--prompt', sp.prompt] : []), ...(sp.negative ? ['--negative', sp.negative] : []),
        '--steps', String(sp.steps), '--width', String(sp.width), '--height', String(sp.height), '--cfg', String(sp.cfg), '--sampler', D.SDCLI_SAMPLER[sp.sampler] || sp.sampler,
        '--seed', String(secondSeed), '--out-name', 'second-pass', '--model-path', sp.modelPath];
      if (sp.scheduler) a.push('--scheduler', sp.scheduler);
      const out2 = await runWorker(job, 'bin/sdcpp-img2img.sh', a, { nested: true, label: 'second pass', savePrompts: base.save_prompts });
      const png = (/Local PNG:\s*(\S+\.png)/.exec(out2) || [])[1];
      if (!png || !fs.existsSync(png)) throw Object.assign(new Error('second pass reported no image'), { gate: 'second-pass-output' });
      // sd-cli's own log (remote-stdout.log in the pass run folder) names the checkpoint it actually loaded.
      let model = null;
      try { model = (fs.readFileSync(path.join(path.dirname(png), 'remote-stdout.log'), 'utf8').match(/loading model from '([^']+)'/) || [])[1] || null; } catch (_) {}
      // 4. Publish the refined image on its own (one runs/ line → finalizeJobImages adopts exactly this run).
      const runId = `${D.runStamp()}-hires-2pass`;
      fs.mkdirSync(path.join(D.RUNS_DIR, runId));
      fs.copyFileSync(png, path.join(D.RUNS_DIR, runId, 'hires-2pass.png'));
      fs.writeFileSync(path.join(D.RUNS_DIR, runId, 'run-metadata.json'), JSON.stringify({ workflow: 'hires-2pass', workflow_id: jobId, base_image: baseImg.id, second_pass: { target: sp.target, sampler: sp.sampler, scheduler: sp.scheduler, steps: sp.steps, cfg: sp.cfg, denoise: sp.denoise, size: `${sp.width}x${sp.height}`, upscaler: sp.upscaler, seed: secondSeed, inherited: sp.inherited } }, null, 2));
      job.stdout += `Final: runs/${runId}/hires-2pass.png\n==== PASS ====\n`;
      job.status = 'PASS';
      D.finalizeJobImages(job, `runs/${runId}/`);
      const refined = D.imageStore.readRunIndex(path.join(D.RUNS_DIR, runId)).map(e => D.imageStore.resolveImage(e.image_id)).filter(Boolean)[0];
      if (!refined) throw Object.assign(new Error('refined image was not canonicalized'), { gate: 'second-pass-canonical' });
      const rdims = D.pngSize(refined.path) || {};
      D.imageMeta.record(refined.id, {
        operation: 'hires-2pass', parent: baseImg.id, runId, target: sp.target, seed: secondSeed, width: rdims.width, height: rdims.height,
        steps: sp.steps, cfg: sp.cfg, sampler: D.EC.canonicalSampler(sp.sampler), scheduler: sp.scheduler, strength: sp.denoise, gen_schema: 1,
        workflow_id: jobId, workflow: 'hires-2pass', pass: 'second',
        second_pass: { upscaler: sp.upscaler, from: `${bdims.width}x${bdims.height}`, to: `${sp.width}x${sp.height}`, denoise: sp.denoise, inherited: sp.inherited, model_loaded: model ? path.basename(model) : null },
        prompt_saved: !!base.save_prompts, prompt: base.save_prompts ? sp.prompt : undefined, negative_prompt: base.save_prompts ? sp.negative : undefined,
      });
      job.results.push({ index: 1, status: 'DONE', imageId: refined.id, imageUrl: D.imageStore.imageUrl(refined.id), seed: secondSeed, target: sp.target, width: rdims.width, height: rdims.height, operation: 'hires-2pass', pass: 'second', parentImageId: baseImg.id });
      progress(2, 'complete');
    } catch (e) {
      if (job.status === 'running' || job.status === 'PASS') {
        job.status = 'FAIL'; job.firstFailedGate = e.gate || (baseImg ? 'second-pass' : 'base-pass');
        job.stderr += '\n' + e.message + (baseImg ? `\nThe base image ${baseImg.id} is complete and kept.` : '');
      }
    } finally {
      job.completedAt = job.completedAt || Date.now();
      try { fs.rmSync(work, { recursive: true, force: true }); } catch (_) {}
      if (job.status === 'CANCELLED') { try { D.syncGenericTerminal(job); } catch (_) {} } else D.recordJobEvidence(job);
    }
  }

  app.post('/api/actions/hires-2pass', (req, res) => {
    const body = { ...(req.body || {}) };
    const raw2 = body.second_pass; delete body.second_pass;
    const dryRun = body.dry_run === true; delete body.dry_run;   // the controlled normalizer rejects unknown fields
    for (const k of Object.keys(body)) if (/^hires_/.test(k)) return res.status(400).json({ error: `${k}: in-engine Hires fields cannot be combined with the independent second pass`, gate: 'hires-2pass' });
    const base = D.normalizeControlledGenerationBody({ ...body, quantity: 1 });
    const targets = D.allControlledTargets();
    const err = D.validateControlledGenerationParams(base, targets);
    if (err) return res.status(400).json({ error: err, gate: 'base' });
    const baseSpec = targets[base.target];
    const sp = normalizeSecondPass(raw2 || {}, { base, baseSpec, targets, targetModels: D.TARGET_MODELS, validateSampling: D.validateSecondPassSampling, canonical: D.canonicalSampler });
    if (sp.error) return res.status(400).json({ error: sp.error, gate: 'second-pass' });
    if (dryRun) return res.json({ ok: true, base: { target: baseSpec.id, width: base.width || baseSpec.defaultWidth, height: base.height || baseSpec.defaultHeight }, second_pass: { ...sp.opts, modelPath: undefined, prompt: undefined, negative: undefined } });
    const seed = Number(base.seed) >= 0 ? Number(base.seed) : require('node:crypto').randomInt(0, 2147483647);
    const jobId = D.createJob('hires-2pass', `Hires 2-pass · ${baseSpec.id} → ${sp.opts.target} · ${sp.opts.baseWidth}x${sp.opts.baseHeight} → ${sp.opts.width}x${sp.opts.height}`,
      D.sanitizeRequestParams({ ...base, seed, second_pass: { ...sp.opts, modelPath: undefined, prompt: undefined, negative: undefined } }, base.save_prompts));
    D.jobSensitives[jobId] = [base.prompt, base.negative_prompt, sp.opts.prompt, sp.opts.negative].filter(Boolean);
    D.jobs[jobId].lineageOp = 'hires-2pass';
    D.withLease(jobId, () => { run(jobId, { base, baseSpec, sp: sp.opts, seed }).catch(e => { const j = D.jobs[jobId]; j.status = 'FAIL'; j.stderr += '\n' + e.message; }); });
    res.json({ job_id: jobId, status: D.jobs[jobId].status, second_pass: { target: sp.opts.target, size: `${sp.opts.width}x${sp.opts.height}`, inherited: sp.opts.inherited } });
  });
}

module.exports = { mount, normalizeSecondPass, hiresGeometry, UPSCALERS };
