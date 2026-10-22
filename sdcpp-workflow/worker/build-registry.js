#!/usr/bin/env node
'use strict';
// Install-time snapshot of existing server-owned routes; never a browser payload.
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const root = path.resolve(__dirname, '../..');
const { targetModelMap } = require(path.join(root, 'operator-console/capabilities'));
const { ADAPTERS } = require(path.join(root, 'operator-console/lora-runtime-policy'));
const { SDCLI_SAMPLER, HIRES_UPSCALERS } = require(path.join(root, 'operator-console/controlled-args'));
const source = fs.readFileSync(path.join(root, 'operator-console/server.js'), 'utf8');
const declaration = source.slice(source.indexOf('const CONTROLLED_TARGETS = ['), source.indexOf('const CONTROLLED_TARGET_BY_ID'));
const targets = vm.runInNewContext(declaration + '\nCONTROLLED_TARGETS');
const models = targetModelMap(path.join(root, 'sdcpp-workflow/bin/sdcpp-controlled-generate.sh'), '/Volumes/wc2tb/ImageGen/checkpoints/sd15/v1-5-pruned-emaonly.safetensors');
const assets = JSON.parse(fs.readFileSync(path.join(root, 'docs/operations/lora-assets-20261021.json'))).assets;
const adapters = Object.fromEntries(Object.entries(ADAPTERS).map(([id, policy]) => {
  const asset = assets.find(a => a.filename.replace(/\.safetensors$/, '').toLowerCase() === id);
  if (!asset) throw new Error('missing installed adapter ' + id);
  return [id, { ...policy, path: '/Volumes/wc2tb/dex-imagegen/models/loras/' + asset.filename }];
}));
const cachePath = path.join(root, 'sdcpp-workflow/state/assets-cache.json');
const cache = fs.existsSync(cachePath) ? JSON.parse(fs.readFileSync(cachePath)) : {};
const knownFiles = new Set(targets.map(t => t.modelFile));
for (const cp of cache.checkpoints || []) {
  if (knownFiles.has(cp.filename) || !/^\/Volumes\/wc2tb\/ImageGen\/checkpoints\/(sdxl|sd15)\/[^/]+\.safetensors$/.test(cp.full_path || '')) continue;
  const family = cp.full_path.includes('/sdxl/') ? 'sdxl' : 'sd15';
  const id = family + '-auto-' + cp.filename.replace(/\.safetensors$/i, '').replace(/[^a-zA-Z0-9]+/g, '-').replace(/^-+|-+$/g, '').toLowerCase();
  models[id] = cp.full_path;
  targets.push({ id, defaultWidth: family === 'sdxl' ? 1024 : 512, defaultHeight: family === 'sdxl' ? 1024 : 512, defaultSteps: family === 'sdxl' ? 10 : 20, defaultCfgScale: family === 'sdxl' ? 6.5 : 7, defaultSampler: family === 'sdxl' ? 'dpmpp2m' : 'euler_a', minSteps:1,maxSteps:150,maxWidth:family === 'sdxl'?2048:1024,maxHeight:family === 'sdxl'?2048:1024 });
}
const result = {
  vaes: Object.fromEntries((cache.vaes || []).filter(v => /^\/Volumes\/wc2tb\//.test(v.full_path || '')).map(v => [v.id,v.full_path])),
  hires_upscalers: HIRES_UPSCALERS,
  schema: 1, sdcli: '/Users/bigmac/stable-diffusion.cpp/build/bin/sd-cli',
  image_python: '/Users/bigmac/Library/Caches/DexDiffusion/mflux/venv/bin/python',
  lora_root: '/Volumes/wc2tb/dex-imagegen/models/loras', adapters,
  models: Object.fromEntries(targets.filter(t => models[t.id] || models[t.aliasOf] || t.backend === 'mflux').map(t => [t.id, {
    ...t, engine_args: t.id === 'flux-fp8' ? ['--prediction','flux_flow','--clip-on-cpu','--type','q8_0'] : t.id === 'sdxl-turbo' ? ['--prediction','eps'] : [],
    default_clip_skip: t.id === 'sdxl-photonic' ? 2 : null, path: t.backend === 'mflux' ? '/Users/bigmac/Library/Caches/DexDiffusion/mflux/flux2-klein-4b-4bit/transformer/model.safetensors.index.json' : models[t.id] || models[t.aliasOf],
  }])),
  samplers: SDCLI_SAMPLER,
  schedulers: ['discrete', 'karras', 'exponential', 'ays', 'sgm_uniform', 'simple', 'kl_optimal', 'smoothstep', 'lcm'],
  access_probe: { checkpoint: models['sdxl-base'], ...Object.fromEntries(Object.entries(adapters).map(([id, a]) => [id, a.path])) },
};
process.stdout.write(JSON.stringify(result, null, 2) + '\n');
