#!/usr/bin/env node
// Bounded, matched SDCPP LoRA benchmark. Real inference runs only with --execute.
// Uses the canonical DexDiffusion API so every output has its ordinary job/run,
// privacy, image validation, cleanup, and publication receipts.
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const API = (process.env.DEXDIFFUSION_API || 'http://127.0.0.1:31337').replace(/\/$/, '');
const PROMPT = 'a red apple on a white table, studio photograph';
const DEFAULT_SEED = 1434705718;
const TARGETS = {
  'sdxl-base': {
    adapter: 'sdxl_lightning_4step_lora', weight: 0.85,
    accelerated: { steps: 4, cfg_scale: 0, sampler: 'euler', scheduler: 'sgm_uniform' },
    low: { steps: 4, cfg_scale: 0, sampler: 'euler', scheduler: 'sgm_uniform' },
    normal: { steps: 20, cfg_scale: 7, sampler: 'dpmpp2m', scheduler: 'discrete' },
  },
  sd15: {
    adapter: 'lcm_sd15', weight: 1,
    accelerated: { steps: 4, cfg_scale: 1.5, sampler: 'lcm', scheduler: 'lcm' },
    low: { steps: 4, cfg_scale: 1.5, sampler: 'lcm', scheduler: 'lcm' },
    normal: { steps: 20, cfg_scale: 7, sampler: 'dpmpp2m', scheduler: 'discrete' },
  },
};

function argsOf(argv) {
  const out = { execute: false, target: '', repeats: 2, seed: DEFAULT_SEED, backend: 'cpu' };
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === '--execute') out.execute = true;
    else if (argv[i] === '--target') out.target = argv[++i] || '';
    else if (argv[i] === '--repeats') out.repeats = Number(argv[++i]);
    else if (argv[i] === '--seed') out.seed = Number(argv[++i]);
    else if (argv[i] === '--backend') out.backend = String(argv[++i] || '').toLowerCase();
    else if (argv[i] === '--help') out.help = true;
    else throw new Error(`Unknown argument: ${argv[i]}`);
  }
  return out;
}

async function request(route, init) {
  const response = await fetch(`${API}${route}`, init);
  const body = await response.json();
  if (!response.ok) throw new Error(`${route} returned ${response.status}: ${body.error || 'request failed'}`);
  return body;
}

async function assertIdle() {
  const resources = await request('/api/resources');
  if (resources.owner || (resources.waiting || []).length || resources.external?.occupied || resources.quarantine || resources.blocked_reason) {
    throw new Error(`Inference is not idle; refusing to queue benchmark work (${JSON.stringify(resources)})`);
  }
}

function readRemoteHeadroom(previousPageouts = null) {
  const raw = execFileSync('ssh', ['westcat', 'memory_pressure -Q; vm_stat; df -k /Volumes/wc2tb; pmset -g therm 2>/dev/null; iostat -d -w 1 -c 2'], { encoding: 'utf8', timeout: 20_000 });
  const freePercent = Number((raw.match(/free percentage:\s*(\d+)%/i) || [])[1]);
  const pageouts = Number((raw.match(/^Pageouts:\s*(\d+)/m) || [])[1]);
  const volumeLine = raw.split('\n').find(line => line.includes('/Volumes/wc2tb')) || '';
  const freeKb = Number(volumeLine.trim().split(/\s+/)[3]);
  const pageoutDelta = Number.isFinite(previousPageouts) && Number.isFinite(pageouts) ? pageouts - previousPageouts : null;
  const sample = { freeMemoryPercent: Number.isFinite(freePercent) ? freePercent : null, pageouts, pageoutDeltaPages: pageoutDelta, volumeFreeBytes: Number.isFinite(freeKb) ? freeKb * 1024 : null, thermalWarnings: raw.match(/(?:CPU|GPU) (?:thermal|power) warning level[^\n]*/gi) || [], sampledAt: new Date().toISOString() };
  if (!Number.isFinite(freePercent) || !Number.isFinite(pageouts) || !Number.isFinite(freeKb)) throw new Error('Big Mac headroom sample was incomplete; refusing benchmark inference');
  if (freePercent < 25 || freeKb < 20 * 1024 * 1024 || (pageoutDelta !== null && pageoutDelta > 32768)) {
    throw new Error(`Big Mac headroom is unsafe for another model load: ${JSON.stringify(sample)}`);
  }
  return sample;
}

export function extractMetrics(log, job, stdout) {
  // The graphical worker retains structured, prompt-redacted engine evidence
  // instead of the legacy SSH route's raw remote-command.log.
  for (const line of String(stdout || '').split('\n')) {
    if (!line.startsWith('ENGINE_RESULT: ')) continue;
    try {
      const result = JSON.parse(line.slice('ENGINE_RESULT: '.length));
      if (result.run_id === job.runId && result.status === 'complete' && Array.isArray(result.evidence)) {
        log += '\n' + result.evidence.join('\n');
      }
    } catch (_) {}
  }
  const activeBackend = (log.match(/Initializing backend:\s*([^\s]+)/) || [])[1]
    || (log.match(/^\s*backend:\s*["']?([^,"'\s]+)/m) || [])[1]
    || 'UNKNOWN';
  const tensorCounts = [...log.matchAll(/\((\d+)\s*\/\s*(\d+)\) LoRA tensors have been applied/g)]
    .map(m => `${m[1]}/${m[2]}`);
  return {
    backend: activeBackend.toLowerCase() === 'cpu' ? 'CPU' : activeBackend,
    metalDevice: (log.match(/GPU name:\s*([^\r\n]+)/) || [])[1]?.trim() || null,
    applyMode: (log.match(/lora_apply_mode:\s*(\w+)/) || [])[1] || null,
    adapterApplicationSeconds: Number((log.match(/apply_loras completed, taking ([\d.]+)s/) || [])[1] || NaN),
    samplingSeconds: Number((log.match(/sampling completed, taking ([\d.]+)s/) || [])[1] || NaN),
    samplingSteps: [...log.matchAll(/(?:^|\s)(\d+)\/(\d+)\s+-\s+([\d.]+)s\/it/g)].map(m => ({ step: Number(m[1]), total: Number(m[2]), secondsPerIteration: Number(m[3]) })),
    engineGenerationSeconds: Number((log.match(/generate_image completed in ([\d.]+)s/) || [])[1] || NaN),
    modelAndAdapterTensorLoadSeconds: [...log.matchAll(/loading tensors completed, taking ([\d.]+)s/g)].map(m => Number(m[1])),
    adapterTensorsApplied: tensorCounts,
    remoteCleanup: stdout.includes('SDCPP_REMOTE_CLEANUP: OK') ? 'verified' : (stdout.includes('SDCPP_REMOTE_CLEANUP: FAIL') ? 'failed' : 'unknown'),
    status: job.status,
  };
}

export function assertBenchmarkBackend(backend, bridgeEnabled) {
  if (bridgeEnabled && backend === 'cpu') {
    throw new Error('CPU benchmarking through the local engine bridge is unavailable: retained worker evidence does not include CPU identity. Use --backend MTL0; no inference was started.');
  }
}

async function runOne(target, arm, params, cacheClass, backend, pageoutsBefore) {
  await assertIdle();
  const headroomBefore = readRemoteHeadroom(pageoutsBefore);
  const submittedAt = Date.now();
  const response = await request('/api/actions/generate-controlled', {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify(params),
  });
  const jobId = response.job_id;
  if (!jobId) throw new Error(`Submission returned no job id: ${JSON.stringify(response)}`);
  let job;
  const deadline = Date.now() + 15 * 60_000;
  while (Date.now() < deadline) {
    await new Promise(resolve => setTimeout(resolve, 1500));
    job = await request(`/api/jobs/${encodeURIComponent(jobId)}`);
    if (['PASS', 'FAIL', 'CANCELLED', 'DONE'].includes(job.status)) break;
  }
  if (!job || !['PASS', 'DONE'].includes(job.status)) throw new Error(`Job ${jobId} did not pass (${job?.status || 'timeout'}); refusing to start another trial`);
  const runId = job.runId;
  if (!runId || !/^[0-9]{8}-[0-9]{6}-[A-Za-z0-9_-]+$/.test(runId)) throw new Error(`Job ${jobId} has no valid run id`);
  const logPath = path.join(ROOT, 'runs', runId, 'remote-command.log');
  const stdoutData = await request(`/api/jobs/${encodeURIComponent(jobId)}/log`);
  const remoteLog = fs.existsSync(logPath) ? fs.readFileSync(logPath, 'utf8') : '';
  const outputPath = job.controlledOutputImage;
  if (!outputPath || !fs.existsSync(outputPath)) throw new Error(`Job ${jobId} passed without a canonical output file`);
  const bytes = fs.readFileSync(outputPath);
  const cleanupText = `${stdoutData.stdout || ''}\n${stdoutData.stderr || ''}`;
  const measured = extractMetrics(remoteLog, job, cleanupText);
  const expected = backend === 'cpu' ? 'CPU' : 'MTL0';
  if (measured.backend.toUpperCase() !== expected) throw new Error(`${expected} benchmark expected engine backend identity; saw ${measured.backend}`);
  if (params.loras?.length && !measured.adapterTensorsApplied.some(x => x.split('/')[0] === x.split('/')[1] && Number(x.split('/')[1]) > 0)) {
    throw new Error(`Job ${jobId} passed but adapter tensor application was not verified`);
  }
  return {
    target, arm, cacheClass, jobId, runId,
    submittedAt: new Date(submittedAt).toISOString(), completedAt: new Date().toISOString(),
    endToEndSeconds: (Date.now() - submittedAt) / 1000,
    workerLifecycleSeconds: Number.isFinite(job.createdAt) && Number.isFinite(job.completedAt) ? (job.completedAt - job.createdAt) / 1000 : null,
    engine: { revision: '7f0e728', backend: measured.backend, device: backend === 'cpu' ? 'CPU' : 'Apple M4 / MTL0', applyMode: measured.applyMode },
    request: { width: params.width, height: params.height, steps: params.steps, cfg_scale: params.cfg_scale, sampler: params.sampler, scheduler: params.scheduler, seed: params.seed, adapter: params.loras?.[0] || null },
    measurements: {
      engineGenerationSeconds: Number.isFinite(measured.engineGenerationSeconds) ? measured.engineGenerationSeconds : null,
      samplingSeconds: Number.isFinite(measured.samplingSeconds) ? measured.samplingSeconds : null,
      samplingSteps: measured.samplingSteps,
      adapterApplicationSeconds: Number.isFinite(measured.adapterApplicationSeconds) ? measured.adapterApplicationSeconds : null,
      modelAndAdapterTensorLoadSeconds: measured.modelAndAdapterTensorLoadSeconds,
      adapterTensorsApplied: measured.adapterTensorsApplied,
      remoteCleanup: measured.remoteCleanup,
      headroomBefore,
      output: { filename: path.basename(outputPath), sha256: crypto.createHash('sha256').update(bytes).digest('hex'), bytes: bytes.length, width: params.width, height: params.height, imageUrl: job.controlledOutputImageUrl || null },
      visualQuality: 'pending human review',
    },
  };
}

function parameterSet(targetSpec, arm, seed, backend) {
  const recipe = arm === 'normal-quality' ? targetSpec.normal : (arm === 'low-step-control' ? targetSpec.low : targetSpec.accelerated);
  return {
    target: targetSpec.id, prompt: PROMPT, negative_prompt: '', width: 512, height: 512,
    ...recipe, seed, save_prompts: false, backend_override: backend === 'cpu' ? 'cpu' : 'MTL0',
    ...(arm === 'lora' ? { loras: [{ name: targetSpec.adapter, weight: targetSpec.weight }], lora_apply_mode: backend === 'cpu' ? 'immediately' : 'at_runtime' } : { loras: [] }),
  };
}

async function main() {
  const opt = argsOf(process.argv.slice(2));
  if (opt.help) {
    process.stdout.write('Usage: node sdcpp-lora-benchmark.mjs --target sdxl-base|sd15 [--backend cpu|MTL0] [--repeats 2|3] [--seed 1434705718] [--execute]\nWithout --execute, prints the bounded plan only.\n');
    return;
  }
  if (!TARGETS[opt.target]) throw new Error('--target must select one adapter target: sdxl-base or sd15');
  if (!Number.isInteger(opt.repeats) || opt.repeats < 2 || opt.repeats > 3) throw new Error('--repeats must be 2 or 3; larger speculative batches are refused');
  if (!Number.isInteger(opt.seed) || opt.seed < 0) throw new Error('--seed must be a non-negative integer');
  if (!['cpu', 'mtl0'].includes(opt.backend)) throw new Error('--backend must be cpu or MTL0');
  const backend = opt.backend === 'cpu' ? 'cpu' : 'MTL0';
  const targetSpec = { ...TARGETS[opt.target], id: opt.target };
  const arms = ['normal-quality', 'low-step-control', 'lora'];
  const plan = {
    schema: 'dexdiffusion.lora-benchmark.v1', target: opt.target, adapter: targetSpec.adapter,
    engine: 'stable-diffusion.cpp 7f0e728', backend: backend === 'cpu' ? 'CPU' : 'MTL0 (Apple M4)',
    prompt_sha256: crypto.createHash('sha256').update(PROMPT).digest('hex'), dimensions: [512, 512], repeats: opt.repeats,
    arms: arms.map(arm => ({ arm, parameters: { ...parameterSet(targetSpec, arm, opt.seed, backend), prompt: '[REDACTED]' } })),
    order: 'one first trial per arm in a fixed rotation, then one warmup per arm, then matched round-robin repeats; each repeat shares a seed across arms',
    cache: 'each trial starts a fresh CLI process; the first ordered trial per arm is recorded separately, but OS file-cache state is not flushed or directly measured and remains unknown',
    quality: 'images are retained in the canonical library; quality verdict requires human review',
    started_at: new Date().toISOString(), results: [], status: opt.execute ? 'running' : 'plan-only',
  };
  const date = new Date().toISOString().slice(0, 10).replaceAll('-', '');
  const backendSuffix = backend === 'cpu' ? '-cpu' : '-mtl0';
  const outPath = path.join(ROOT, 'runs', `lora-performance-${date}-${opt.target}${backendSuffix}${opt.execute ? '' : '-plan'}.json`);
  const writeReport = () => {
    fs.mkdirSync(path.dirname(outPath), { recursive: true });
    const redacted = { ...plan, arms: plan.arms, prompt_sha256: plan.prompt_sha256 };
    fs.writeFileSync(outPath, JSON.stringify(redacted, null, 2) + '\n', { mode: 0o600 });
  };
  if (!opt.execute) {
    writeReport();
    process.stdout.write(`${JSON.stringify({ status: 'PLAN_ONLY', report: outPath, arms: arms.length, trialCount: arms.length * (2 + opt.repeats), promptSaved: false })}\n`);
    return;
  }
  const version = await request('/api/version');
  if (version.cwd !== path.join(path.dirname(ROOT), 'operator-console') || version.bind !== `${API}` || !version.pid) throw new Error('DexDiffusion API identity does not match this checkout and loopback endpoint');
  const routing = await import('../../operator-console/local-engine-routing.js');
  assertBenchmarkBackend(backend, routing.default.enabled());
  let lastPageouts = null;
  const schedule = [
    { kind: 'first', index: 0 }, { kind: 'first', index: 1 }, { kind: 'first', index: 2 },
    { kind: 'warmup', index: 2 }, { kind: 'warmup', index: 0 }, { kind: 'warmup', index: 1 },
  ];
  writeReport();
  for (let round = 0; round < opt.repeats; round++) {
    for (let offset = 0; offset < arms.length; offset++) schedule.push({ kind: 'repeat', index: (offset + round) % arms.length, round });
  }
  try {
    for (const item of schedule) {
      const arm = arms[item.index];
      const seed = item.kind === 'warmup' ? opt.seed + 10_000 + item.index : (item.kind === 'repeat' ? opt.seed + 100 + item.round : opt.seed + 1 + item.index);
      const measured = await runOne(opt.target, arm, parameterSet(targetSpec, arm, seed, backend), item.kind, backend, lastPageouts);
      lastPageouts = measured.measurements.headroomBefore.pageouts;
      const headroomAfter = readRemoteHeadroom(lastPageouts);
      measured.measurements.headroomAfter = headroomAfter;
      lastPageouts = headroomAfter.pageouts;
      measured.round = item.round ?? null;
      measured.prompt_sha256 = plan.prompt_sha256;
      plan.results.push(measured);
      writeReport();
      process.stdout.write(`${JSON.stringify({ target: opt.target, arm, cacheClass: item.kind, jobId: measured.jobId, runId: measured.runId, endToEndSeconds: measured.endToEndSeconds, status: 'PASS' })}\n`);
    }
    plan.status = 'completed';
  } catch (error) {
    plan.status = 'partial';
    plan.error = String(error?.message || error).slice(0, 500);
    throw error;
  } finally {
    plan.finished_at = new Date().toISOString();
    writeReport();
    process.stdout.write(`${JSON.stringify({ status: plan.status, report: outPath, completedTrials: plan.results.length, error: plan.error || null })}\n`);
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch(error => { process.stderr.write(`${error?.stack || error}\n`); process.exitCode = 1; });
}
