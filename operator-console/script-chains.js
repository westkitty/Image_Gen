'use strict';
// Multi-pass A1111 scripts built from the existing single-pass workers (P10/P08/P09 parity rows):
//   SD upscale             (scripts/sd_upscale.py)            EX-13/14/15  — upscale, split into overlapping tiles, img2img each, combine
//   Loopback               (scripts/loopback.py)              SC-20/21     — img2img fed back into itself with a denoising curve
//   Poor man's outpainting (scripts/poor_mans_outpainting.py) IP-14/16     — expand once, inpaint the tiles that touch new area, combine
//   Outpainting mk2        (scripts/outpainting_mk_2.py)      IP-15/16/17  — one direction at a time with spectrum-matched noise
// Pinned upstream 82a973c04367123ae98bd9abdf80d9eda9b910e2. Every pass is a real sd-cli run through bin/sdcpp-img2img.sh or
// bin/sdcpp-inpaint.sh on Big Mac (one model load per pass); the geometry runs locally (bin/sd-upscale-tiles.py,
// bin/outpaint-a1111.py). The whole chain is ONE job holding the heavy-compute lease; each pass announces its run id
// (SDCPP_RUN_ID) so Cancel stops exactly the pass that is running. Intermediate pass images stay in their run folders and
// are never published; only the final image enters the canonical store, with lineage to the source.
// Engine limits stated, not hidden: sd-cli's --strength range is 0.01-0.99 (a requested 0 or 1 is clamped and recorded),
// and the masked-content modes latent noise / latent nothing are refused (sd-cli cannot initialise the masked latent).
const fs = require('node:fs');
const path = require('node:path');
const { spawn, execFile } = require('node:child_process');
const SdUpscale = require('./public/dexdiffusion/sd-upscale.js');
const Outpaint = require('./public/dexdiffusion/outpaint-scripts.js');

const KINDS = {
  'sd-upscale': { label: 'SD upscale', lineage: 'sd-upscale' },
  loopback: { label: 'Loopback', lineage: 'loopback' },
  'outpaint-poor': { label: "Poor man's outpainting", lineage: 'outpaint-poor' },
  'outpaint-mk2': { label: 'Outpainting mk2', lineage: 'outpaint-mk2' },
};
const CURVES = ['Aggressive', 'Linear', 'Lazy'];
const STRENGTH_MIN = 0.01, STRENGTH_MAX = 0.99;
const MAX_PASSES = 64;

// loopback.py calculate_denoising_strength: pass 0 uses the initial strength; pass i >= 1 uses the curve value for i.
function loopbackStrengths(loops, initial, final, curve) {
  const out = [];
  for (let i = 0; i < loops; i++) {
    if (i === 0 || loops === 1) { out.push(initial); continue; }
    const progress = i / (loops - 1);
    const k = curve === 'Aggressive' ? Math.sin(progress * Math.PI * 0.5) : curve === 'Lazy' ? 1 - Math.cos(progress * Math.PI * 0.5) : progress;
    out.push(initial + (final - initial) * k);
  }
  return out;
}
const clampStrength = s => Math.min(STRENGTH_MAX, Math.max(STRENGTH_MIN, Math.round(s * 1000) / 1000));

// Script-specific options. Returns { options } | { error }.
function normalizeScript(kind, raw, src) {
  const o = raw && typeof raw === 'object' && !Array.isArray(raw) ? raw : {};
  if (kind === 'sd-upscale') {
    const r = SdUpscale.normalizeSdUpscale({ overlap: o.overlap ?? 64, scale: o.scale ?? 2, upscaler: o.upscaler || 'lanczos', tileWidth: o.tile_width ?? 512, tileHeight: o.tile_height ?? 512, steps: o.steps ?? 20 });
    if (r.error) return r;
    if (r.options.upscaler === 'realesrgan') return { error: 'Real-ESRGAN as the SD upscale pre-upscaler is not wired yet: choose Lanczos, Nearest, Bicubic, Bilinear or None (upscale with Real-ESRGAN first, then SD upscale with None).' };
    const p = SdUpscale.plan(src.width, src.height, r.options);
    if (p.error) return p;
    if (p.undersized) return { error: `The upscaled image (${p.image.w}x${p.image.h}) is smaller than one ${r.options.tileWidth}x${r.options.tileHeight} tile; raise the scale or lower the tile size` };
    if (p.tileCount > MAX_PASSES) return { error: `SD upscale would run ${p.tileCount} tiles; the limit is ${MAX_PASSES}` };
    if (p.image.w > 4096 || p.image.h > 4096) return { error: `Result would be ${p.image.w}x${p.image.h}, larger than the 4096 px limit` };
    return { options: r.options, passes: p.tileCount, out: { w: p.image.w, h: p.image.h }, plan: p };
  }
  if (kind === 'loopback') {
    const loops = Number(o.loops ?? 4), final = Number(o.final_strength ?? 0.5), curve = o.curve || 'Linear';
    if (!Number.isInteger(loops) || loops < 1 || loops > 32) return { error: 'loops must be a whole number between 1 and 32' };
    if (!(final >= 0 && final <= 1)) return { error: 'final_strength must be between 0 and 1' };
    if (!CURVES.includes(curve)) return { error: `curve must be one of ${CURVES.join(', ')}` };
    if (o.interrogate && o.interrogate !== 'None') return { error: 'Append interrogated prompt (CLIP / DeepBooru) is not available: no interrogator weights are installed' };
    return { options: { loops, final_strength: final, curve }, passes: loops, out: { w: src.width, h: src.height } };
  }
  if (kind === 'outpaint-poor') {
    const r = Outpaint.normalizePoorOptions(o);
    if (r.error) return r;
    const g = Outpaint.poorGeometry(src.width, src.height, r.options);
    if (g.error) return g;
    if (g.work_count > MAX_PASSES) return { error: `Poor man's outpainting would run ${g.work_count} tiles; the limit is ${MAX_PASSES}` };
    return { options: r.options, passes: g.work_count, out: { w: g.target_w, h: g.target_h } };
  }
  if (kind === 'outpaint-mk2') {
    const r = Outpaint.normalizeMk2Options(o);
    if (r.error) return r;
    const steps = Outpaint.mk2Steps(src.width, src.height, r.options, r.options.work_w || 512, r.options.work_h || 512);
    if (steps.error) return steps;
    return { options: r.options, passes: steps.steps.length, out: { w: steps.final_w, h: steps.final_h } };
  }
  return { error: 'unknown script ' + kind };
}

function mount(app, deps) {
  const D = deps;
  const BIN = path.join(D.WORKFLOW_ROOT, 'bin');
  const PY_TILES = path.join(__dirname, 'bin', 'sd-upscale-tiles.py');
  const PY_OUTPAINT = path.join(__dirname, 'bin', 'outpaint-a1111.py');
  // processing.apply_overlay for an inpainted crop: result = processed * mask_blurred + init * (1 - mask_blurred).
  const OVERLAY_PY = 'import sys\nfrom PIL import Image\np=Image.open(sys.argv[1]).convert("RGB"); i=Image.open(sys.argv[2]).convert("RGB"); m=Image.open(sys.argv[3]).convert("L")\nif p.size!=i.size: p=p.resize(i.size, Image.LANCZOS)\nImage.composite(p,i,m).save(sys.argv[4])';

  const py = (args, timeout = 300000) => new Promise((resolve, reject) => {
    execFile('python3', args, { cwd: __dirname, timeout, maxBuffer: 32 * 1024 * 1024, encoding: 'utf8' }, (err, stdout, stderr) => {
      if (err) return reject(new Error(String(stderr || err.message).trim().split('\n').slice(-2).join(' ').slice(0, 400)));
      resolve(stdout);
    });
  });

  // One sd-cli pass. Resolves { png } or rejects. Pass output is kept in job.passLog (runs/ paths are written "runs:" so the
  // final publication step never adopts a pass's intermediate image); job.stdout only gains the SDCPP_RUN_ID lines Cancel needs.
  function runPass(job, script, a, label) {
    return new Promise((resolve, reject) => {
      if (job.status !== 'running') return reject(new Error('stopped'));
      const p = a.params;
      // The workers parse with ${2:?}: an empty value is an argument error, so empty prompt / negative flags are left out (as the img2img route does).
      const args = ['--init-img', a.init, '--strength', String(clampStrength(a.strength)), ...(p.prompt ? ['--prompt', p.prompt] : []), ...(p.negative_prompt ? ['--negative', p.negative_prompt] : []),
        '--steps', String(p.steps), '--width', String(a.w), '--height', String(a.h), '--cfg', String(p.cfg_scale), '--sampler', p.sampler, '--seed', String(a.seed), '--out-name', a.name];
      if (p.scheduler) args.push('--scheduler', p.scheduler);
      if (a.mask) args.splice(2, 0, '--mask', a.mask);
      // Run as a NESTED script (DEX_TOP_PID = this server): sdcpp-lib.sh then leaves the pass image in its run folder instead of
      // publishing it to the canonical store, exactly as hires-fix / batch / xyz parents do. Only the chain's final run is published.
      const env = { ...process.env, SDCPP_REDACT_PROMPTS: p.save_prompts ? '0' : '1', DEX_TOP_PID: String(process.pid) };
      delete env.DEX_RUN_DIRS_FILE;
      const child = spawn(path.join(BIN, script), args, { cwd: D.WORKFLOW_ROOT, shell: false, env, detached: true });
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
        clearTimeout(timer);
        job.childPid = null;
        job.passLog = (job.passLog || '') + `\n--- ${label} (exit ${code}) ---\n` + (out + err).replace(/runs\//g, 'runs:').slice(-4000);
        const png = /Local PNG:\s*(\S+\.png)/.exec(out);
        if (code === 0 && png && fs.existsSync(png[1])) return resolve({ png: png[1] });
        const gate = /First failed gate:\s*(.+)/.exec(out + err);
        const tail = (err || out).trim().split('\n').slice(-3).join(' | ').replace(/runs\//g, 'runs:').slice(0, 300);
        reject(new Error(`${label} failed${gate ? ' at gate ' + gate[1].trim() : ''} (exit ${code})${tail ? ': ' + tail : ''}`));
      });
    });
  }

  async function runChain(jobId, kind, ctx) {
    const job = D.jobs[jobId];
    job.status = 'running';
    job.startedRunningAt = Date.now();
    if (D.jobStore.get(jobId) && D.jobStore.get(jobId).status === 'QUEUED') D.jobStore.transition(jobId, 'RUNNING');
    const work = fs.mkdtempSync(path.join(D.MASK_UPLOADS_DIR, `chain-${kind}-`));
    const total = ctx.passes;
    const progress = (done, label) => D.updateSequentialProgress(job, { totalRuns: total, completedRuns: done, currentRun: Math.min(total, done + 1), currentRunPercent: 0, stage: label });
    const P = ctx.params, seed0 = ctx.seed;
    const clamped = new Set();
    const strength = s => { const c = clampStrength(s); if (c !== Math.round(s * 1000) / 1000) clamped.add(`${s}→${c}`); return c; };
    let finalPng;
    try {
      if (kind === 'sd-upscale') {
        const o = ctx.options, planDir = path.join(work, 'plan'), resDir = path.join(work, 'results');
        fs.mkdirSync(resDir);
        await py([PY_TILES, 'plan', ctx.init, '--out-dir', planDir, '--tile-width', String(o.tileWidth), '--tile-height', String(o.tileHeight), '--overlap', String(o.overlap), '--scale', String(o.scale), '--upscale-resampler', o.upscaler, '--seed', String(seed0)]);
        const plan = JSON.parse(fs.readFileSync(path.join(planDir, 'plan.json'), 'utf8'));
        const tiles = plan.tiles || [];
        for (let i = 0; i < tiles.length; i++) {
          progress(i, `tile ${i + 1}/${tiles.length}`);
          const t = tiles[i], name = t.file || `tile_${String(i).padStart(3, '0')}.png`;
          const r = await runPass(job, 'sdcpp-img2img.sh', { params: P, init: path.join(planDir, name), w: o.tileWidth, h: o.tileHeight, strength: strength(ctx.strength), seed: seed0 + (t.seed_offset ?? i), name: `sdup-${i}` }, `tile ${i + 1}/${tiles.length}`);
          fs.copyFileSync(r.png, path.join(resDir, name));
        }
        finalPng = path.join(work, 'final.png');
        await py([PY_TILES, 'combine', '--plan', path.join(planDir, 'plan.json'), '--tiles-dir', resDir, '--out', finalPng]);
      } else if (kind === 'loopback') {
        const o = ctx.options, strengths = loopbackStrengths(o.loops, ctx.strength, o.final_strength, o.curve);
        let cur = ctx.init;
        for (let i = 0; i < o.loops; i++) {
          progress(i, `loop ${i + 1}/${o.loops}`);
          const r = await runPass(job, 'sdcpp-img2img.sh', { params: P, init: cur, w: ctx.src.width, h: ctx.src.height, strength: strength(strengths[i]), seed: seed0 + i, name: `loop-${i}` }, `loop ${i + 1}/${o.loops}`);
          cur = path.join(work, `loop_${i}.png`); fs.copyFileSync(r.png, cur);
        }
        job.genRecordExtra = { loopback: { loops: o.loops, final_strength: o.final_strength, curve: o.curve, strengths: strengths.map(s => Math.round(s * 1000) / 1000) } };
        finalPng = cur;
      } else if (kind === 'outpaint-poor') {
        const o = ctx.options, dir = path.join(work, 'poor');
        await py([PY_OUTPAINT, 'poor-plan', '--source', ctx.init, '--pixels', String(o.pixels), '--directions', o.directions.join(','), '--mask-blur', String(o.mask_blur), '--masked-content', o.masked_content, '--out-dir', dir]);
        const plan = JSON.parse(fs.readFileSync(path.join(dir, 'plan.json'), 'utf8'));
        const todo = plan.tiles.filter(t => t.process);
        for (let i = 0; i < todo.length; i++) {
          const t = todo[i];
          progress(i, `tile ${i + 1}/${todo.length}`);
          const r = await runPass(job, 'sdcpp-inpaint.sh', { params: P, init: path.join(dir, t.init), mask: path.join(dir, t.latent_mask), w: t.w, h: t.h, strength: strength(ctx.strength), seed: seed0 + (t.seed_offset ?? i), name: `poor-${i}` }, `tile ${i + 1}/${todo.length}`);
          await py(['-c', OVERLAY_PY, r.png, path.join(dir, t.init), path.join(dir, t.mask_blurred), path.join(dir, t.result)]);
        }
        finalPng = path.join(work, 'final.png');
        await py([PY_OUTPAINT, 'poor-combine', '--plan', path.join(dir, 'plan.json'), '--expanded', path.join(dir, plan.expanded), '--results-dir', dir, '--out', finalPng]);
      } else if (kind === 'outpaint-mk2') {
        const o = ctx.options;
        let cur = ctx.init;
        const order = ['left', 'right', 'up', 'down'].filter(d => o.directions.includes(d));
        for (let i = 0; i < order.length; i++) {
          const dir = path.join(work, `mk2-${i}`);
          progress(i, `${order[i]} ${i + 1}/${order.length}`);
          // MK2 noise seed: upstream always uses default_rng(0); o.seed (default 0) keeps that unless the user overrides it.
          const prep = ['prepare', '--source', cur, '--direction', order[i], '--pixels', String(o.pixels), '--directions', o.directions.join(','), '--mask-blur', String(o.mask_blur),
            '--noise-q', String(o.noise_q), '--color-variation', String(o.color_variation), '--seed', String(o.seed || 0), '--work-w', String(ctx.workW), '--work-h', String(ctx.workH), '--out-dir', dir];
          if (i > 0) prep.push('--orig-size', `${ctx.src.width}x${ctx.src.height}`);
          await py([PY_OUTPAINT, 'mk2-' + prep[0], ...prep.slice(1)], 600000);
          const step = JSON.parse(fs.readFileSync(path.join(dir, 'step.json'), 'utf8'));
          const r = await runPass(job, 'sdcpp-inpaint.sh', { params: P, init: path.join(dir, 'init.png'), mask: path.join(dir, 'latent_mask.png'), w: step.work_w, h: step.work_h, strength: strength(ctx.strength), seed: seed0 + i, name: `mk2-${i}` }, `${order[i]} ${i + 1}/${order.length}`);
          const over = path.join(dir, 'overlaid.png');
          await py(['-c', OVERLAY_PY, r.png, path.join(dir, 'init.png'), path.join(dir, 'mask_blurred.png'), over]);
          cur = path.join(dir, 'finished.png');
          await py([PY_OUTPAINT, 'mk2-finish', '--full', path.join(dir, 'full.png'), '--processed', over, '--step', path.join(dir, 'step.json'), '--out', cur]);
        }
        finalPng = cur;
      }
      if (job.status !== 'running') return;
      // Publish ONLY the final image: a fresh run folder whose path is the one runs/ line in job.stdout.
      const runId = `${D.runStamp()}-${KINDS[kind].lineage}`;
      const runDir = path.join(D.RUNS_DIR, runId);
      fs.mkdirSync(runDir);
      fs.copyFileSync(finalPng, path.join(runDir, `${KINDS[kind].lineage}.png`));
      fs.writeFileSync(path.join(runDir, 'run-metadata.json'), JSON.stringify({ script: kind, upstream: '82a973c04367123ae98bd9abdf80d9eda9b910e2', seed: seed0, passes: total, options: ctx.options, clamped_strength: [...clamped] }, null, 2));
      job.stdout += `${KINDS[kind].label}: ${total} pass(es) complete\nFinal: runs/${runId}/${KINDS[kind].lineage}.png\n==== PASS ====\n`;
      if (clamped.size) job.stdout += `Strength clamped to sd-cli's 0.01-0.99 range: ${[...clamped].join(', ')}\n`;
      job.runId = runId;
      job.status = 'PASS';
      progress(total, 'complete');
    } catch (err) {
      if (job.status === 'running') { job.status = 'FAIL'; job.firstFailedGate = job.firstFailedGate || 'chain-pass'; job.stderr += `\n${err.message}`; }
    } finally {
      job.completedAt = job.completedAt || Date.now();
      job.genRecord = Object.assign({}, job.genRecord, job.genRecordExtra || {});
      if (job.status === 'PASS') { D.finalizeJobImages(job, job.stdout); if (job.status === 'PASS') D.recordEditResults(job, job.stdout); }
      try { fs.rmSync(work, { recursive: true, force: true }); } catch (_) {}
      if (job.status === 'CANCELLED') { try { D.syncGenericTerminal(job); } catch (_) {} } else D.recordJobEvidence(job);
    }
  }

  function route(kind) {
    return (req, res) => {
      const body = { ...(req.body || {}) };
      const resErr = D.resolveEditResources(body);
      if (resErr) return res.status(400).json({ error: resErr, gate: 'resources' });
      const srcInfo = D.resolveImageSource(body);
      if (srcInfo.error || !srcInfo.path || !fs.existsSync(srcInfo.path)) { if (srcInfo.temp) try { fs.unlinkSync(srcInfo.temp); } catch (_) {} return res.status(404).json({ error: srcInfo.error || 'Choose a source image from the library', gate: 'source' }); }
      const dims = D.pngSize(srcInfo.path);
      if (!dims) return res.status(400).json({ error: 'The source is not a readable PNG', gate: 'source' });
      const strength = body.strength !== undefined ? Number(body.strength) : (kind === 'sd-upscale' ? 0.3 : kind === 'outpaint-mk2' ? 0.8 : kind === 'outpaint-poor' ? 0.99 : 0.5);
      if (!(strength >= 0 && strength <= 1)) return res.status(400).json({ error: 'strength must be between 0 and 1', gate: 'strength' });
      const workW = Number((body.script && body.script.work_w) || body.width) || 512, workH = Number((body.script && body.script.work_h) || body.height) || 512;
      const sc = normalizeScript(kind, body.script, { width: dims.width, height: dims.height, workW, workH });
      if (sc.error) return res.status(400).json({ error: sc.error, gate: 'script' });
      // The pass size: SD upscale uses the tile size, loopback the source size, outpaint the planned tiles/steps (validated per pass by the worker).
      const params = D.normalizeGenerationBody({ ...body, width: kind === 'sd-upscale' ? sc.options.tileWidth : kind === 'loopback' ? dims.width : workW, height: kind === 'sd-upscale' ? sc.options.tileHeight : kind === 'loopback' ? dims.height : workH });
      const genErr = D.validateGenerationParams(params);
      if (genErr) return res.status(400).json({ error: genErr, gate: 'params' });
      if (body.dry_run === true) return res.json({ ok: true, kind, passes: sc.passes, result_size: `${sc.out.w}x${sc.out.h}`, options: sc.options });
      const seed = /^\d+$/.test(String(params.seed || '')) && Number(params.seed) >= 0 ? Number(params.seed) : require('node:crypto').randomInt(0, 2147483647);
      params.seed = String(seed);
      const sensitives = [params.prompt, params.negative_prompt].filter(Boolean);
      const jobId = D.createJob(kind, `${KINDS[kind].label} · ${sc.passes} pass(es) · ${dims.width}x${dims.height} → ${sc.out.w}x${sc.out.h}`, D.sanitizeRequestParams({ ...params, strength, script: sc.options }, params.save_prompts));
      D.jobSensitives[jobId] = sensitives;
      const job = D.jobs[jobId];
      job.sourceImageId = srcInfo.imageId || null;
      job.lineageOp = KINDS[kind].lineage;
      job.genRecord = D.editGenRecord(body, params, { strength, script: { kind, ...sc.options } });
      job.tempFiles = [srcInfo.temp].filter(Boolean);
      D.withLease(jobId, () => { runChain(jobId, kind, { init: srcInfo.path, src: dims, params, seed, strength, options: sc.options, passes: sc.passes, workW, workH }).catch(e => { job.status = 'FAIL'; job.stderr += '\n' + e.message; }); });
      res.json({ job_id: jobId, status: job.status, passes: sc.passes, result_size: `${sc.out.w}x${sc.out.h}` });
    };
  }
  for (const kind of Object.keys(KINDS)) app.post('/api/scripts/' + kind, route(kind));
}

module.exports = { mount, KINDS, CURVES, loopbackStrengths, normalizeScript, clampStrength };
