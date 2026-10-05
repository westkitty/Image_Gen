'use strict';

// Capability truth for DexDiffusion. Status is DERIVED, never hard-coded:
//
//   UNAVAILABLE  the architecture does not provide the feature
//   DORMANT      code exists but a required runtime/model asset is absent
//   BROKEN       the most recent real runtime attempt failed (after any pass)
//   PROVEN       a real job of this capability passed on this machine
//   AVAILABLE    implementation and assets exist, but no real proof recorded
//
// Inputs: the capability registry below, an asset probe of Big Mac (read-only
// ssh, output-based because Tailscale SSH always reports exit status 0), and
// evidence recorded by the server whenever a real job finishes
// (sdcpp-workflow/state/capability-evidence.json, machine-local).
// Unit tests or source code can never make a capability PROVEN.

const fs = require('fs');
const path = require('path');
const { execFile } = require('child_process');

const STATUS = { PROVEN: 'proven', AVAILABLE: 'available', DORMANT: 'dormant', UNAVAILABLE: 'unavailable', BROKEN: 'broken' };

// needs: asset keys from probeAssets(); job: how finished jobs map onto it.
const CAPABILITIES = [
  { id: 'txt2img-mflux', label: 'txt2img · FLUX.2 Klein 4B (MFLUX)', backend: 'mflux', primary: true, needs: ['mfluxRuntime', 'mfluxModel'], job: { action: 'controlled-generate', backend: 'mflux' } },
  { id: 'txt2img-sdcpp', label: 'txt2img · SD1.5 (SDCPP)', backend: 'sdcpp', needs: ['sdCli', 'sd15Model'], job: { action: 'controlled-generate', backend: 'sdcpp', target: 'sd15' } },
  { id: 'txt2img-sdxl-photonic', label: 'txt2img · Photonic Fusion SDXL (SDCPP)', backend: 'sdcpp', needs: ['sdCli', 'photonicModel'], job: { action: 'controlled-generate', backend: 'sdcpp', target: 'sdxl-photonic' } },
  { id: 'txt2img-sdxl-base', label: 'txt2img · SDXL base 1.0 (SDCPP)', backend: 'sdcpp', needs: ['sdCli', 'sdxlBaseModel'], job: { action: 'controlled-generate', backend: 'sdcpp', target: 'sdxl-base' } },
  { id: 'txt2img-sdxl-turbo', label: 'txt2img · SDXL Turbo (SDCPP)', backend: 'sdcpp', needs: ['sdCli', 'sdxlTurboModel'], job: { action: 'controlled-generate', backend: 'sdcpp', target: 'sdxl-turbo' } },
  { id: 'img2img', label: 'img2img (SDCPP)', backend: 'sdcpp', needs: ['sdCli', 'sd15Model'], job: { action: 'img2img' } },
  { id: 'inpaint', label: 'Inpaint (SDCPP)', backend: 'sdcpp', needs: ['sdCli', 'sd15Model'], job: { action: 'inpaint' } },
  { id: 'upscale-resample', label: 'Upscale · Lanczos (MacBook)', backend: 'local', needs: [], job: { action: 'upscale' } },
  { id: 'upscale-esrgan', label: 'Upscale · Real-ESRGAN x4 (SDCPP)', backend: 'sdcpp', needs: ['sdCli', 'esrganModel'], job: { action: 'upscale-esrgan' } },
  { id: 'hires-fix', label: 'Hires fix (SDCPP + Lanczos)', backend: 'sdcpp', needs: ['sdCli', 'sd15Model'], job: { action: 'hires-fix' } },
  { id: 'batch', label: 'Batch / sweep (SDCPP)', backend: 'sdcpp', needs: ['sdCli', 'sd15Model'], job: { action: 'batch-generate' } },
  { id: 'quantity-native-batch', label: 'Quantity · native sd-cli batch (SDCPP)', backend: 'sdcpp', needs: ['sdCli', 'sd15Model'], job: { action: 'controlled-generate', capabilityId: true } },
  { id: 'hires-refine', label: 'High-Res Refine · native 2nd pass (SDCPP)', backend: 'sdcpp', needs: ['sdCli', 'sd15Model'], job: { action: 'controlled-generate', capabilityId: true } },
  { id: 'outpaint', label: 'Outpaint (canvas prep + SDCPP inpaint)', backend: 'sdcpp', needs: ['sdCli', 'sd15Model'], job: { action: 'outpaint' } },
  { id: 'controlnet', label: 'ControlNet (SD1.5 Canny)', backend: 'sdcpp', implemented: false, reason: 'ENGINE SUPPORTED — MODEL ASSET MISSING: no SD1.5 ControlNet model on Big Mac (needs e.g. control_v11p_sd15_canny)', needs: [], job: { action: 'controlnet' } },
];

// Failures of these gates are request/validation problems, not runtime breakage.
const NON_RUNTIME_GATES = new Set(['args', 'prompt', 'seed', 'width', 'height', 'steps', 'target', 'strength', 'scale', 'resample', 'overwrite', 'input-missing']);

function deriveStatus(cap, assets, evidence) {
  if (cap.implemented === false) return { status: STATUS.UNAVAILABLE, reason: cap.reason || 'not provided by the current architecture' };
  const missing = (cap.needs || []).filter(n => assets && assets[n] === false);
  if (missing.length) return { status: STATUS.DORMANT, reason: 'missing asset: ' + missing.join(', ') };
  const ev = (evidence && evidence[cap.id]) || {};
  const pass = ev.lastPass || null;
  const failure = ev.lastFail || null;
  if (failure && (!pass || failure.at > pass.at)) return { status: STATUS.BROKEN, reason: `last run failed at gate ${failure.gate || 'unknown'}`, lastFail: failure, lastPass: pass };
  if (pass) return { status: STATUS.PROVEN, lastPass: pass, lastFail: failure };
  const unknown = (cap.needs || []).filter(n => !assets || assets[n] == null);
  return { status: STATUS.AVAILABLE, reason: unknown.length ? 'no live proof recorded; assets not probed (Big Mac unreachable?)' : 'no live proof recorded yet' };
}

// A job may name its capability explicitly (native batch, High-Res Refine);
// those capabilities are never matched by action alone.
// Target-specific capabilities only match their own target, so a failure of one
// checkpoint (e.g. a missing custom model) is never recorded against another.
function capabilityForJob(job, targetBackend) {
  if (job.capabilityId) return CAPABILITIES.find(c => c.id === job.capabilityId) || null;
  const targetId = job.controlledTarget || (job.requestParams && job.requestParams.target) || null;
  return CAPABILITIES.find(c => !c.job.capabilityId && c.job.action === job.commandAction && (!c.job.backend || c.job.backend === targetBackend) && (!c.job.target || c.job.target === targetId)) || null;
}

function createEvidenceStore(file) {
  function read() {
    try { return JSON.parse(fs.readFileSync(file, 'utf8')); } catch (_) { return {}; }
  }
  function write(data) {
    fs.mkdirSync(path.dirname(file), { recursive: true });
    const tmp = file + '.tmp';
    fs.writeFileSync(tmp, JSON.stringify(data, null, 2) + '\n');
    fs.renameSync(tmp, file);
  }
  // Record a finished real job. Returns the capability id or null.
  function record(job, targetBackend) {
    const cap = capabilityForJob(job, targetBackend);
    const targetId = job.commandAction === 'controlled-generate' && (job.requestParams && job.requestParams.target || job.controlledTarget);
    if (!cap && !targetId) return null;
    const terminal = job.status === 'PASS' || job.status === 'PARTIAL' ? 'pass' : job.status === 'FAIL' ? 'fail' : null;
    if (!terminal) return null;
    if (terminal === 'fail' && NON_RUNTIME_GATES.has(String(job.firstFailedGate || ''))) return null;
    const data = read();
    const rec = { at: new Date(job.completedAt || Date.now()).toISOString(), runId: job.runId || null, jobId: job.id || null };
    if (cap) {
      const entry = data[cap.id] || {};
      if (terminal === 'pass') entry.lastPass = rec;
      else entry.lastFail = { ...rec, gate: job.firstFailedGate || null };
      data[cap.id] = entry;
    }
    // Each checkpoint needs its own normal-path proof. PARTIAL and jobs with
    // no canonical result cannot promote a model, even if a family is proven.
    if (targetId) {
      const key = 'model:' + targetId;
      const entry = data[key] || {};
      if (terminal === 'fail') entry.lastFail = { ...rec, gate: job.firstFailedGate || null };
      else if (job.status === 'PASS' && job.runId && /^\/api\/images\//.test(job.controlledOutputImageUrl || '')) {
        entry.lastPass = { ...rec, backend: targetBackend, imageUrl: job.controlledOutputImageUrl };
      }
      data[key] = entry;
    }
    write(data);
    return cap ? cap.id : null;
  }
  return { read, record, file };
}

// Parse target -> model file from the controlled script (single source of truth).
function targetModelMap(controlledScript, remoteModel, stageRoot = '/Volumes/wc2tb/ImageGen') {
  const map = {};
  let src = '';
  try { src = fs.readFileSync(controlledScript, 'utf8'); } catch (_) { return map; }
  const body = src.slice(src.indexOf('case "$ARG_TARGET" in'));
  const re = /^ {2}([a-z0-9-]+)\)\n([\s\S]*?)\n {4};;/gm;
  let m;
  while ((m = re.exec(body))) {
    if (map[m[1]]) continue;
    const p = /TARGET_MODEL_PATH="([^"]+)"/.exec(m[2]);
    map[m[1]] = p ? p[1].replace('$MODEL_STAGE_ROOT', stageRoot).replace('$SDXL_MODEL_ROOT', '$HOME/sdcpp-staging/models').replace('$MODEL_LIBRARY_ROOT', '/Volumes/wc2tb/dex-imagegen/models') : remoteModel;
  }
  return map;
}

// Voice/music/video worker install locations: single source of truth in media.js.
const DORMANT_PATHS = require('./media').WORKER_PROBE_PATHS;

function probeAssets({ sshTarget = 'westcat', targetModels = {}, timeoutMs = 12000 } = {}) {
  const paths = [...new Set(Object.values(targetModels))];
  const checks = [
    `printf 'mfluxRuntime=%s\\n' "$(test -x "$HOME/Library/Caches/DexDiffusion/mflux/venv/bin/mflux-generate-flux2" && echo 1 || echo 0)"`,
    `printf 'mfluxModel=%s\\n' "$(test -s "$HOME/Library/Caches/DexDiffusion/mflux/flux2-klein-4b-4bit/transformer/model.safetensors.index.json" && echo 1 || echo 0)"`,
    `bd="$(cat "$HOME/sdcpp-staging/build_dir.txt" 2>/dev/null)"; printf 'sdCli=%s\\n' "$(test -n "$bd" && test -x "$bd/bin/sd-cli" && echo 1 || echo 0)"`,
    `printf 'sd15Model=%s\\n' "$(test -s "/Volumes/wc2tb/ImageGen/checkpoints/sd15/v1-5-pruned-emaonly.safetensors" && echo 1 || echo 0)"`,
    `printf 'photonicModel=%s\\n' "$(test -s "$HOME/sdcpp-staging/models/photonic_fusion_sdxl_finale_v1.safetensors" && echo 1 || echo 0)"`,
    `printf 'sdxlBaseModel=%s\\n' "$(test -s "/Volumes/wc2tb/ImageGen/checkpoints/sdxl/sd_xl_base_1.0.safetensors" && echo 1 || echo 0)"`,
    `printf 'sdxlTurboModel=%s\\n' "$(test -s "/Volumes/wc2tb/ImageGen/checkpoints/sdxl-turbo/sd_xl_turbo_1.0_fp16.safetensors" && echo 1 || echo 0)"`,
    `printf 'esrganModel=%s\\n' "$(test -s /Volumes/wc2tb/ImageGen/upscalers/RealESRGAN_x4plus.pth && echo 1 || echo 0)"`,
    ...paths.map((p, i) => `printf 'model${i}=%s\\n' "$(test -s ${JSON.stringify(p).replace(/^"\$HOME/, '"$HOME')} && echo 1 || echo 0)"`),
    `printf 'identity=%s@%s\\n' "$(whoami)" "$(hostname -s)"`,
    `printf 'wc2tb=%s\\n' "$(test -d /Volumes/wc2tb/ImageGen && echo 1 || echo 0)"`,
    `printf 'secondaryStateB64=%s\\n' "$(test -s "$HOME/Library/Caches/DexDiffusion/secondary-model/current/state.json" && /usr/bin/base64 < "$HOME/Library/Caches/DexDiffusion/secondary-model/current/state.json" | tr -d '\\n' || true)"`,
    // Dormant future workers: existence checks only (nothing is installed or started).
    ...DORMANT_PATHS.map(([k, pth]) => `printf '${k}=%s\\n' "$(test -e "${pth}" && echo 1 || echo 0)"`),
    `printf 'probe=done\\n'`,
  ].join('; ');
  return new Promise(resolve => {
    execFile('ssh', ['-o', 'BatchMode=yes', '-o', 'ConnectTimeout=6', sshTarget, checks], { timeout: timeoutMs, encoding: 'utf8' }, (err, stdout) => {
      const kv = {};
      for (const line of String(stdout || '').split('\n')) {
        const i = line.indexOf('=');
        if (i > 0) kv[line.slice(0, i)] = line.slice(i + 1).trim();
      }
      if (kv.probe !== 'done') return resolve({ reachable: false });
      const flag = k => (kv[k] === '1' ? true : kv[k] === '0' ? false : null);
      const models = {};
      paths.forEach((p, i) => { models[p] = flag(`model${i}`); });
      let secondary = {};
      try { secondary = JSON.parse(Buffer.from(kv.secondaryStateB64 || '', 'base64').toString('utf8')); } catch (_) {}
      resolve({
        reachable: true,
        mfluxRuntime: flag('mfluxRuntime'), mfluxModel: flag('mfluxModel'),
        sdCli: flag('sdCli'), sd15Model: flag('sd15Model'), photonicModel: flag('photonicModel'), sdxlBaseModel: flag('sdxlBaseModel'), sdxlTurboModel: flag('sdxlTurboModel'), esrganModel: flag('esrganModel'),
        identity: kv.identity || null, wc2tb: flag('wc2tb'),
        dormant: Object.fromEntries(DORMANT_PATHS.map(([k]) => [k, flag(k)])),
        models,
        secondaryModelState: secondary.secondaryModelState || 'inactive',
        activeSecondaryModel: secondary.activeSecondaryModel || null,
        secondarySourcePath: secondary.sourcePath || null,
        secondaryActivePath: secondary.activePath || null,
        secondaryModelIdentity: secondary.modelIdentity || null,
        secondaryLastSwitchResult: secondary.lastSwitchResult || null,
      });
    });
  });
}

// Runtime state for one model target, for the target list.
function targetRuntime(target, assets, targetModels) {
  if (!assets || !assets.reachable) return 'unknown';
  if ((target.backend || 'sdcpp') === 'mflux') {
    if (assets && (assets.mfluxRuntime === false || assets.mfluxModel === false)) return 'dormant';
    return 'available';
  }
  if (assets.sdCli === false) return 'dormant';
  const model = targetModels[target.id] || target.modelPath;
  if (model && assets.models && assets.models[model] === false) return 'model-missing';
  return 'available';
}

function targetVerification(target, assets, targetModels, evidence) {
  const runtime = targetRuntime(target, assets, targetModels);
  if (runtime === 'unknown') return { status: 'unknown', runtime, reason: 'Big Mac assets could not be verified' };
  if (runtime !== 'available') return { status: STATUS.DORMANT, runtime, reason: runtime };
  return { ...deriveStatus({ id: 'model:' + target.id, needs: [] }, assets, evidence), runtime };
}

module.exports = {
  STATUS, CAPABILITIES, NON_RUNTIME_GATES,
  deriveStatus, capabilityForJob, createEvidenceStore, targetModelMap, probeAssets, targetRuntime, targetVerification,
};
